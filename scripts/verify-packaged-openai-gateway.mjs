// Self-contained packaged OpenAI gateway acceptance. This harness launches the
// exact win-unpacked executable under a fresh --leemo-e2e-root, starts a free
// local OpenAI mock, and proves one real Claude Code SDK round reaches the
// packaged renderer's IPC event stream. No external API or user config is used.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const auditTag = process.env.LEEMO_AUDIT_TAG || "openai-gateway-r9-packaged";
const outputDir = path.resolve("docs/research/audit-shots");
const executablePath = path.resolve(
  process.env.LEEMO_PACKAGED_EXE || "dist-package/win-unpacked/Leemo.exe",
);
const installerPath = path.resolve(
  process.env.LEEMO_INSTALLER_EXE || "dist-package/Leemo Setup 0.0.1.exe",
);
const marker = "LEEMO_OPENAI_GATEWAY_OK";
const testKey = "leemo-e2e-local-key";
const testHeader = "leemo-e2e-local-header";
const modelId = "mock-openai-model";
const rootPrefix = "leemo-e2e-r9-openai-";
const factsPath = path.join(outputDir, `${auditTag}-facts.json`);
const pendingFactsPath = `${factsPath}.${process.pid}.tmp`;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function validateAuditRoot(candidate) {
  const resolved = path.resolve(candidate);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(`Refusing E2E root outside the system temp directory: ${resolved}`);
  }
  if (!path.basename(resolved).startsWith(rootPrefix)) {
    throw new Error(`Refusing E2E root without the expected prefix: ${resolved}`);
  }
  return resolved;
}

async function freeLoopbackPort() {
  const server = http.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not reserve a CDP port");
    return address.port;
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

async function waitForPackagedPage(cdpPort, expectedUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
      if (page) {
        if (page.url.toLocaleLowerCase() !== expectedUrl.toLocaleLowerCase()) {
          throw new Error(`CDP page is not the expected packaged app: ${page.url}`);
        }
        return page;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Packaged renderer did not become ready: ${lastError ?? "no page"}`);
}

async function waitForLogLine(logPath, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    if (text.includes(expected)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function removeOwnedAuditRoot(candidate, timeoutMs = 10_000) {
  const ownedRoot = validateAuditRoot(candidate);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      fs.rmSync(ownedRoot, { recursive: true, force: true });
      if (!fs.existsSync(ownedRoot)) return;
    } catch (error) {
      lastError = error;
    }
    // Yield to Node so ChildProcess exit/close events and Chromium handle
    // teardown can complete; fs.rmSync(maxRetries) would block those events.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Owned E2E root survived cleanup: ${lastError ?? ownedRoot}`);
}

function createMockServer(captured) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        // The assertions below turn malformed input into a readable failure.
      }
      captured.push({
        path: req.url,
        model: body.model,
        authorizationOk: req.headers.authorization === `Bearer ${testKey}`,
        customHeaderOk: req.headers["x-leemo-e2e"] === testHeader,
      });

      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const write = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
      const base = {
        id: "chatcmpl-leemo-e2e",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
      };
      write({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
      write({ ...base, choices: [{ index: 0, delta: { content: marker }, finish_reason: null }] });
      write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      write({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } });
      res.end("data: [DONE]\n\n");
    });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function main() {
  let auditRoot;
  let stdoutFd;
  let stderrFd;
  let mockServer;
  let appProcess;
  let appProcessEnded;
  let socket;
  let evaluateRuntime;
  let savedProviderId;
  let facts;
  let runError;
  const cleanupErrors = [];
  const startedAt = Date.now();

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    // A failed rerun must never leave a previous green result looking current.
    fs.rmSync(factsPath, { force: true });
    fs.rmSync(pendingFactsPath, { force: true });

    if (process.platform !== "win32") {
      throw new Error("This packaged acceptance currently targets the Windows build");
    }
    if (!fs.existsSync(executablePath)) throw new Error(`Packaged executable is missing: ${executablePath}`);
    if (!fs.existsSync(installerPath)) throw new Error(`Installer is missing: ${installerPath}`);

    const executableSha256 = sha256(executablePath);
    const installerSha256 = sha256(installerPath);
    const expectedInstallerSha256 = process.env.LEEMO_EXPECTED_INSTALLER_SHA256?.trim().toUpperCase();
    if (expectedInstallerSha256 && installerSha256 !== expectedInstallerSha256) {
      throw new Error(`Installer hash mismatch: expected ${expectedInstallerSha256}, got ${installerSha256}`);
    }

    auditRoot = validateAuditRoot(fs.mkdtempSync(path.join(os.tmpdir(), rootPrefix)));
    const stdoutPath = path.join(auditRoot, "stdout.log");
    const stderrPath = path.join(auditRoot, "stderr.log");
    stdoutFd = fs.openSync(stdoutPath, "w");
    stderrFd = fs.openSync(stderrPath, "w");
    const cdpPort = await freeLoopbackPort();
    const expectedRendererUrl = pathToFileURL(
      path.join(path.dirname(executablePath), "resources", "app.asar", "dist", "index.html"),
    ).href;

    const captured = [];
    mockServer = createMockServer(captured);
    await new Promise((resolve, reject) => {
      mockServer.once("error", reject);
      mockServer.listen(0, "127.0.0.1", resolve);
    });
    const mockAddress = mockServer.address();
    if (!mockAddress || typeof mockAddress === "string") throw new Error("Local OpenAI mock did not bind");
    const mockBaseUrl = `http://127.0.0.1:${mockAddress.port}/v1`;

    appProcess = spawn(executablePath, [
      `--remote-debugging-port=${cdpPort}`,
      `--leemo-e2e-root=${auditRoot}`,
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
    ], {
      cwd: auditRoot,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    appProcessEnded = new Promise((resolve) => {
      appProcess.once("error", (error) => resolve({ type: "error", error }));
      appProcess.once("exit", (code, signal) => resolve({ type: "exit", code, signal }));
    });
    if (!appProcess.pid) throw new Error("Packaged executable did not return a process id");

    const startup = await Promise.race([
      waitForPackagedPage(cdpPort, expectedRendererUrl).then((page) => ({ page })),
      appProcessEnded.then((ended) => ({ ended })),
    ]);
    if ("ended" in startup) {
      if (startup.ended.type === "error") throw startup.ended.error;
      throw new Error(`Packaged executable exited before renderer startup (code=${startup.ended.code}, signal=${startup.ended.signal})`);
    }
    const page = startup.page;
    const expectedIsolationLine = `[leemo:main] E2E isolation: home=${path.join(auditRoot, "home")}, userData=${path.join(auditRoot, "user-data")}`;
    const isolationLogMatchesRoot = await waitForLogLine(stdoutPath, expectedIsolationLine);
    if (!isolationLogMatchesRoot) {
      throw new Error("Packaged main process did not confirm the owned E2E root");
    }

    socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    let nextId = 0;
    const pending = new Map();
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    evaluateRuntime = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };

    await send("Runtime.enable");
    await evaluateRuntime(`(() => {
      window.__leemoGatewayAuditEvents = [];
      window.__leemoGatewayAuditOff?.();
      window.__leemoGatewayAuditOff = window.leemoBridge.on('bridge:event', (payload) => {
        const event = payload?.event ?? {};
        window.__leemoGatewayAuditEvents.push({
          conversationId: payload?.conversationId,
          type: event.type,
          subtype: event.subtype,
          isError: event.isError,
          text: event.text,
          finalText: event.finalText,
          message: event.message,
        });
      });
      return true;
    })()`);

    const saveResult = await evaluateRuntime(`window.leemoBridge.invoke('bridge:saveProvider', ${JSON.stringify({
      kind: "custom",
      name: "Local OpenAI E2E",
      baseUrl: mockBaseUrl,
      apiFormat: "openai",
      apiKey: testKey,
      models: [modelId],
      modelCapabilities: { [modelId]: { thinking: false, vision: false } },
      headers: { "X-Leemo-E2E": testHeader },
    })})`);
    if (!saveResult?.ok) throw new Error(`Packaged provider save failed: ${saveResult?.error ?? "unknown error"}`);
    savedProviderId = saveResult.response?.id;
    if (!savedProviderId) throw new Error("Packaged provider save returned no id");

    const createResult = await evaluateRuntime(`window.leemoBridge.invoke('bridge:createConversation', ${JSON.stringify({
      providerId: "__PROVIDER_ID__",
      modelId,
      mode: "buddy",
      talkStyle: 1,
      webSearchEnabled: false,
      webFetchEnabled: false,
      rememberMode: false,
      permissionMode: "bypassPermissions",
    }).replace("__PROVIDER_ID__", savedProviderId)})`);
    if (!createResult?.ok) throw new Error(`Packaged conversation create failed: ${createResult?.error ?? "unknown error"}`);
    const conversationId = createResult.response?.conversationId;
    if (!conversationId) throw new Error("Packaged conversation create returned no id");

    const sendResult = await evaluateRuntime(`window.leemoBridge.invoke('bridge:send', ${JSON.stringify({
      conversationId: "__CONVERSATION_ID__",
      prompt: "Return the local acceptance marker.",
    }).replace("__CONVERSATION_ID__", conversationId)})`);
    if (!sendResult?.ok) throw new Error(`Packaged conversation send failed: ${sendResult?.error ?? "unknown error"}`);

    const deadline = Date.now() + 30_000;
    let events = [];
    while (Date.now() < deadline) {
      events = await evaluateRuntime(`window.__leemoGatewayAuditEvents.filter((event) => event.conversationId === ${JSON.stringify(conversationId)})`);
      if (events.some((event) => event.type === "run.finished")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const finished = events.findLast((event) => event.type === "run.finished");
    const text = events.filter((event) => event.type === "text.delta").map((event) => event.text ?? "").join("");
    const upstream = captured.at(-1);
    const candidateFacts = {
      packaged: true,
      packagedExecutable: path.relative(process.cwd(), executablePath).replaceAll(path.sep, "/"),
      executableSha256,
      installerSha256,
      rendererLoadedFromAsar: page.url.toLocaleLowerCase() === expectedRendererUrl.toLocaleLowerCase(),
      isolatedE2eRoot: isolationLogMatchesRoot,
      testProviderDeleted: false,
      elapsedMs: 0,
      upstreamRequestCount: captured.length,
      exactModelForwarded: upstream?.model === modelId,
      authorizationForwarded: upstream?.authorizationOk === true,
      customHeaderForwarded: upstream?.customHeaderOk === true,
      ipcTextMarkerReceived: text.includes(marker) || finished?.finalText?.includes(marker) === true,
      finished: finished ? { subtype: finished.subtype, isError: finished.isError } : null,
      ipcErrors: events.filter((event) => event.type === "error").map((event) => event.message),
    };
    if (!finished || finished.isError || finished.subtype !== "success") {
      throw new Error("Packaged OpenAI round did not finish successfully");
    }
    if (!candidateFacts.rendererLoadedFromAsar || !candidateFacts.isolatedE2eRoot) {
      throw new Error("Packaged runtime identity or isolation was not proven");
    }
    if (!candidateFacts.exactModelForwarded || !candidateFacts.authorizationForwarded || !candidateFacts.customHeaderForwarded || !candidateFacts.ipcTextMarkerReceived) {
      throw new Error("Packaged OpenAI round failed one or more gateway assertions");
    }

    const deleteResult = await evaluateRuntime(
      `window.leemoBridge.invoke('bridge:deleteProvider', ${JSON.stringify({ providerId: savedProviderId })})`,
    );
    if (!deleteResult?.ok) {
      throw new Error(`Packaged test-provider cleanup failed: ${deleteResult?.error ?? "unknown error"}`);
    }
    savedProviderId = undefined;
    candidateFacts.testProviderDeleted = true;
    facts = candidateFacts;
  } catch (error) {
    runError = error;
  } finally {
    if (evaluateRuntime) {
      try {
        if (savedProviderId) {
          await evaluateRuntime(`window.leemoBridge.invoke('bridge:deleteProvider', ${JSON.stringify({ providerId: savedProviderId })})`);
        }
        await evaluateRuntime("window.__leemoGatewayAuditOff?.(); true");
      } catch {
        // Destroying the isolated root below is the authoritative fallback.
      }
    }
    try {
      socket?.close();
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (appProcess?.pid) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(appProcess.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        // taskkill returns non-zero when the app already exited on its own.
      }
    }
    if (appProcessEnded) {
      const ended = await Promise.race([
        appProcessEnded.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
      ]);
      if (!ended) cleanupErrors.push(new Error("Packaged process did not exit within 5 seconds"));
    }

    try {
      await closeServer(mockServer);
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const fd of [stdoutFd, stderrFd]) {
      if (fd === undefined) continue;
      try {
        fs.closeSync(fd);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (auditRoot) {
      try {
        await removeOwnedAuditRoot(auditRoot);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  if (runError || cleanupErrors.length > 0) {
    fs.rmSync(pendingFactsPath, { force: true });
    fs.rmSync(factsPath, { force: true });
    console.error("[openai-gateway-e2e] packaged acceptance failed");
    throw new AggregateError(
      [runError, ...cleanupErrors].filter(Boolean),
      "Packaged OpenAI gateway acceptance or cleanup failed",
    );
  }
  if (!facts) throw new Error("Packaged acceptance produced no facts");

  facts.elapsedMs = Date.now() - startedAt;
  try {
    fs.writeFileSync(pendingFactsPath, JSON.stringify(facts, null, 2) + "\n");
    fs.renameSync(pendingFactsPath, factsPath);
  } finally {
    fs.rmSync(pendingFactsPath, { force: true });
  }
  console.log(JSON.stringify(facts, null, 2));
}

await main();
