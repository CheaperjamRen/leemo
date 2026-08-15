// Packaged, zero-cost Computer Use acceptance. A deterministic loopback model
// drives Leemo's real bundled Windows runtime against one disposable WinForms
// window, proving the user prompt -> task approval -> tools -> final approval
// -> visible result path without touching the user's applications.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXE = path.resolve(process.argv[2] || path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe"));
const FIXTURE = path.join(ROOT, "scripts", "fixtures", "computer-use-acceptance.ps1");
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "packaged-computer-journey-facts.json");
const FIRST_APPROVAL_SHOT = path.join(OUTPUT_DIR, "packaged-computer-task-approval.png");
const FINAL_APPROVAL_SHOT = path.join(OUTPUT_DIR, "packaged-computer-final-approval.png");
const COMPLETE_SHOT = path.join(OUTPUT_DIR, "packaged-computer-journey-complete.png");
const ROOT_PREFIX = "leemo-e2e-computer-journey-";
const PROVIDER_ID = "computer-journey-local";
const PROVIDER_NAME = "电脑操作旅程本机验收";
const MODEL_ID = "computer-journey-model";
const TEST_KEY = "leemo-computer-journey-local-key";
const WINDOW_TITLE = "Leemo Computer Acceptance";
const INPUT_TEXT = "Leemo 电脑操作完整旅程";
const SUCCESS_MARKER = "LEEMO_COMPUTER_JOURNEY_OK";
const PROMPT = "请在测试窗口中填写验收文字并点击确认，然后读回结果告诉我是否完成。";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const insist = (value, message) => {
  if (!value) throw new Error(message);
};

function validateAuditRoot(candidate) {
  const resolved = path.resolve(candidate);
  const temp = fs.realpathSync(os.tmpdir());
  insist(path.dirname(resolved).toLowerCase() === temp.toLowerCase(), `隔离目录不在系统临时目录一级：${resolved}`);
  insist(path.basename(resolved).startsWith(ROOT_PREFIX), `隔离目录前缀错误：${resolved}`);
  return resolved;
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "无法分配本机端口");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function collectText(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectText(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectText(item, out));
  return out;
}

function findAcceptanceWindowHandle(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!((trimmed.startsWith("{") && trimmed.endsWith("}"))
      || (trimmed.startsWith("[") && trimmed.endsWith("]")))) return "";
    try {
      return findAcceptanceWindowHandle(JSON.parse(trimmed), depth + 1);
    } catch {
      return "";
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const handle = findAcceptanceWindowHandle(item, depth + 1);
      if (handle) return handle;
    }
    return "";
  }
  if (typeof value === "object") {
    if (Array.isArray(value.windows)) {
      const match = value.windows.find((candidate) => candidate?.title === WINDOW_TITLE);
      if (typeof match?.handle === "string" && /^\d+$/.test(match.handle)) return match.handle;
    }
    for (const item of Object.values(value)) {
      const handle = findAcceptanceWindowHandle(item, depth + 1);
      if (handle) return handle;
    }
  }
  return "";
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function streamBase(model, id) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
  };
}

function writeToolCall(response, model, id, name, args) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  const base = streamBase(model, `chatcmpl-${id}`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({
    ...base,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: `call_${id}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: null,
    }],
  });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  response.end("data: [DONE]\n\n");
}

function writeText(response, model, text) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  const base = streamBase(model, "chatcmpl-computer-journey-complete");
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 30, completion_tokens: 8 } });
  response.end("data: [DONE]\n\n");
}

function createLoopbackServer(state) {
  return http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      writeJson(response, 200, { data: [{ id: MODEL_ID, display_name: "Computer Journey" }] });
      return;
    }

    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: { message: "not found" } });
        return;
      }
      if (request.headers.authorization !== `Bearer ${TEST_KEY}`) {
        writeJson(response, 401, { error: { message: "invalid local key" } });
        return;
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        writeJson(response, 400, { error: { message: "invalid json" } });
        return;
      }
      if (body.stream !== true) {
        writeJson(response, 200, {
          id: "chatcmpl-computer-probe",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL_ID,
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        });
        return;
      }

      const names = (body.tools ?? []).map((tool) => tool?.function?.name).filter((name) => typeof name === "string");
      const bySuffix = (suffix) => names.find((name) => name.endsWith(suffix));
      const transcript = collectText(body.messages ?? []).join("\n");
      state.requests.push({ stage: state.stage, names, transcript });
      const model = typeof body.model === "string" ? body.model : MODEL_ID;

      if (state.stage === 0) {
        const tool = bySuffix("window_management");
        if (!tool) return writeJson(response, 400, { error: { message: "window_management was not advertised" } });
        state.stage += 1;
        return writeToolCall(response, model, "find-window", tool, { action: "find", title: WINDOW_TITLE });
      }
      if (state.stage === 1) {
        const tool = bySuffix("ui_snapshot");
        state.windowHandle = findAcceptanceWindowHandle(body.messages ?? []);
        if (!tool || !state.windowHandle) return writeJson(response, 400, { error: { message: "acceptance window handle was not available" } });
        state.stage += 1;
        return writeToolCall(response, model, "snapshot", tool, { windowHandle: state.windowHandle, maxDepth: 4 });
      }
      if (state.stage === 2) {
        const tool = bySuffix("ui_type");
        state.snapshotObserved = transcript.includes("AcceptanceInput") && transcript.includes("AcceptanceConfirm");
        if (!tool || !state.snapshotObserved) return writeJson(response, 400, { error: { message: "acceptance controls were not observed" } });
        state.stage += 1;
        return writeToolCall(response, model, "type", tool, {
          windowHandle: state.windowHandle,
          automationId: "AcceptanceInput",
          text: INPUT_TEXT,
          clearFirst: true,
        });
      }
      if (state.stage === 3) {
        const tool = bySuffix("ui_read");
        if (!tool) return writeJson(response, 400, { error: { message: "ui_read was not advertised" } });
        state.stage += 1;
        return writeToolCall(response, model, "read-input", tool, {
          windowHandle: state.windowHandle,
          automationId: "AcceptanceInput",
        });
      }
      if (state.stage === 4) {
        const tool = bySuffix("ui_click");
        state.inputObserved = transcript.includes(INPUT_TEXT);
        if (!tool || !state.inputObserved) return writeJson(response, 400, { error: { message: "typed text was not read back" } });
        state.stage += 1;
        return writeToolCall(response, model, "final-click", tool, {
          windowHandle: state.windowHandle,
          name: "Confirm",
          automationId: "AcceptanceConfirm",
          controlType: "Button",
        });
      }
      if (state.stage === 5) {
        const tool = bySuffix("ui_read");
        if (!tool) return writeJson(response, 400, { error: { message: "ui_read was not advertised after final click" } });
        state.stage += 1;
        return writeToolCall(response, model, "read-result", tool, {
          windowHandle: state.windowHandle,
          automationId: "AcceptanceResult",
        });
      }
      if (state.stage === 6) {
        state.acceptedObserved = transcript.includes("Accepted");
        state.stage += 1;
        return writeText(response, model, state.acceptedObserved
          ? `${SUCCESS_MARKER}。已在测试窗口填写内容、确认，并读回 Accepted。`
          : "LEEMO_COMPUTER_RESULT_NOT_PROVEN");
      }
      return writeText(response, model, SUCCESS_MARKER);
    });
  });
}

async function startServer(state) {
  const server = createLoopbackServer(state);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "本机验收服务没有绑定端口");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function waitForRenderer(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      if (targets.some((target) => target.type === "page" && !target.url.startsWith("devtools://"))) return;
    } catch { /* renderer is still starting */ }
    await sleep(150);
  }
  throw new Error("打包 renderer 启动超时");
}

async function launchApp(auditRoot) {
  const port = await freePort();
  const logs = [];
  const child = spawn(EXE, [
    `--remote-debugging-port=${port}`,
    `--leemo-e2e-root=${auditRoot}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
  ], { cwd: auditRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  await waitForRenderer(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  insist(page, "隔离 Leemo 没有 renderer page");
  await page.locator('textarea[aria-label="输入消息"]').waitFor({ state: "attached", timeout: 60_000 });
  return { child, browser, page, logs };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch { /* process may have exited after the exact-PID check */ }
}

async function stopApp(instance) {
  if (!instance) return;
  await instance.page.close({ runBeforeUnload: true }).catch(() => {});
  await Promise.race([new Promise((resolve) => instance.child.once("exit", resolve)), sleep(4_000)]);
  await stopProcess(instance.child);
  await instance.browser.close().catch(() => {});
}

async function seedRuntime(page, baseUrl) {
  const result = await page.evaluate(async ({ providerId, providerName, modelId, apiKey, url }) => {
    const saved = await window.leemoBridge.invoke("bridge:saveProvider", {
      id: providerId,
      kind: "custom",
      name: providerName,
      baseUrl: url,
      apiFormat: "openai",
      category: "custom",
      apiKey,
      models: [modelId],
      capabilities: { text: true, vision: false, thinking: false },
    });
    if (!saved.ok) throw new Error(saved.error || "saveProvider failed");
    const computer = await window.leemoBridge.invoke("bridge:saveMcpServer", {
      id: "computer",
      name: "操作电脑",
      transport: "stdio",
      enabled: true,
    });
    if (!computer.ok || !computer.response.available) throw new Error(computer.error || "computer runtime unavailable");
    const loaded = await window.leemoPersist.invoke("loadAll", undefined);
    if (!loaded.ok) throw new Error(loaded.error || "loadAll failed");
    const persisted = await window.leemoPersist.invoke("saveSettings", {
      ...(loaded.response.settings || {}),
      onboardingCompleted: true,
      mode: "workbench",
      defaultProviderId: saved.response.id,
      defaultModelId: modelId,
      permissionMode: "acceptEdits",
    });
    if (!persisted.ok) throw new Error(persisted.error || "saveSettings failed");
    return { providerId: saved.response.id, computerEnabled: computer.response.enabled };
  }, { providerId: PROVIDER_ID, providerName: PROVIDER_NAME, modelId: MODEL_ID, apiKey: TEST_KEY, url: baseUrl });
  insist(result.providerId === PROVIDER_ID && result.computerEnabled === true, "本机模型或电脑操作没有保存");
}

async function ensureWorkbench(page) {
  if (await page.getByTestId("workbench-shell").isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "切换到工作台", exact: true }).click();
  await page.getByTestId("workbench-shell").waitFor({ state: "visible" });
}

async function runJourney(page) {
  await ensureWorkbench(page);
  await page.getByRole("button", { name: "新建对话" }).click();
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.fill(PROMPT);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  const firstApproval = page.locator('[data-testid="approval-card-pending"][data-tool-name$="window_management"]');
  await firstApproval.waitFor({ state: "visible", timeout: 60_000 });
  await firstApproval.getByText("本次任务内，查看、切换、输入等普通电脑操作不再重复询问；启动程序和最终动作仍会单独确认", { exact: true }).waitFor({ state: "visible" });
  await firstApproval.getByRole("button", { name: "本次任务允许电脑操作", exact: true }).waitFor({ state: "visible" });
  await firstApproval.scrollIntoViewIfNeeded();
  await page.screenshot({ path: FIRST_APPROVAL_SHOT, animations: "disabled" });
  await firstApproval.getByRole("button", { name: "本次任务允许电脑操作", exact: true }).click();

  const finalApproval = page.locator('[data-testid="approval-card-pending"][data-tool-name$="ui_click"]');
  await finalApproval.waitFor({ state: "visible", timeout: 60_000 });
  insist((await finalApproval.getAttribute("data-input-summary")) === "Confirm", "最终确认卡没有说清点击目标");
  await finalApproval.scrollIntoViewIfNeeded();
  await page.screenshot({ path: FINAL_APPROVAL_SHOT, animations: "disabled" });
  await finalApproval.getByRole("button", { name: "允许一次", exact: true }).click();

  await page.getByText(SUCCESS_MARKER, { exact: false }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByTestId("current-conversation-status").filter({ hasText: "已完成" }).waitFor({ state: "visible" });
  await page.screenshot({ path: COMPLETE_SHOT, animations: "disabled" });
  const processFold = page.getByTestId("process-fold").last();
  await processFold.locator(":scope > button").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="resolved-approval-receipt"]').length === 2);
  const receiptTexts = await page.getByTestId("resolved-approval-receipt").allTextContents();
  return { receiptCount: receiptTexts.length, receiptTexts };
}

async function main() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  insist(fs.existsSync(EXE), `找不到打包应用：${EXE}`);
  insist(fs.existsSync(FIXTURE), `找不到电脑操作测试窗口：${FIXTURE}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const auditRoot = validateAuditRoot(fs.mkdtempSync(path.join(os.tmpdir(), ROOT_PREFIX)));
  const state = {
    stage: 0,
    requests: [],
    windowHandle: "",
    snapshotObserved: false,
    inputObserved: false,
    acceptedObserved: false,
  };
  let loopback;
  let current;
  let fixture;
  const logs = [];
  try {
    loopback = await startServer(state);
    current = await launchApp(auditRoot);
    await seedRuntime(current.page, loopback.baseUrl);
    await stopApp(current);
    logs.push(...current.logs);
    current = undefined;

    fixture = spawn("powershell.exe", [
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", FIXTURE,
    ], { cwd: ROOT, windowsHide: false, stdio: "ignore" });
    await sleep(1_200);

    current = await launchApp(auditRoot);
    const { receiptCount, receiptTexts } = await runJourney(current.page);

    insist(state.stage >= 7, `模型旅程只执行到阶段 ${state.stage}`);
    insist(state.snapshotObserved, "模型没有看到真实测试窗口控件");
    insist(state.inputObserved, "模型没有读回真实输入");
    insist(state.acceptedObserved, "模型没有读回最终 Accepted 状态");
    insist(receiptCount === 2, `审批回执应为 2 条，实际为 ${receiptCount}`);
    insist(receiptTexts.some((text) => text.includes("本次任务已允许电脑操作")), "首次任务授权回执没有说清真实范围");
    insist(receiptTexts.some((text) => text.includes("已允许一次")), "最终动作回执没有保留精确授权语义");
    insist(state.requests.every((entry) => entry.names.some((name) => name.endsWith("window_management"))), "电脑操作工具没有持续注入模型上下文");
    const allLogs = [...logs, ...current.logs].join("");
    insist(!allLogs.includes(TEST_KEY), "打包主进程日志泄露了测试 API Key");

    const facts = {
      checkedAt: new Date().toISOString(),
      packagedExecutable: path.relative(ROOT, EXE).replaceAll(path.sep, "/"),
      isolatedUserData: true,
      externalApiCalls: 0,
      modelCostUsd: 0,
      modelToolRounds: state.requests.length,
      firstTaskApproval: true,
      routineStepsWithoutRepeatedApproval: true,
      finalActionConfirmation: true,
      windowObserved: state.snapshotObserved,
      textTypedAndRead: state.inputObserved,
      finalResultRead: state.acceptedObserved,
      approvalReceipts: receiptCount,
      receiptTexts,
      completed: true,
      screenshots: [path.basename(FIRST_APPROVAL_SHOT), path.basename(FINAL_APPROVAL_SHOT), path.basename(COMPLETE_SHOT)],
    };
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(facts, null, 2));
  } catch (error) {
    const last = state.requests.at(-1);
    console.error("[packaged-computer-journey] diagnostic", {
      stage: state.stage,
      requestCount: state.requests.length,
      windowHandle: state.windowHandle,
      advertisedTools: last?.names,
      transcriptTail: last?.transcript.slice(-6_000),
    });
    const tail = current?.logs.join("").slice(-10_000);
    if (tail) console.error(`[packaged-computer-journey] host log:\n${tail}`);
    throw error;
  } finally {
    await stopApp(current);
    await stopProcess(fixture);
    if (loopback?.server?.listening) await new Promise((resolve) => loopback.server.close(resolve));
    const owned = validateAuditRoot(auditRoot);
    try { fs.rmSync(owned, { recursive: true, force: true }); } catch { /* native handles may release shortly after exit */ }
  }
}

main().catch((error) => {
  console.error("[packaged-computer-journey] FAIL", error);
  process.exitCode = 1;
});
