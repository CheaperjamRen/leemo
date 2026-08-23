// Packaged settings and retry acceptance for r9. This script drives only
// user-visible controls against an isolated Leemo.exe and a loopback OpenAI
// mock. It never reads the user's provider config or calls an external model.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGED_EXE = path.resolve(
  process.env.LEEMO_PACKAGED_EXE || path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe"),
);
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "model-onboarding-r9-runtime-facts.json");
const ROOT_PREFIX = "leemo-e2e-r9-settings-";
const TEST_KEY = "leemo-r9-loopback-key-not-a-real-secret";
const PROVIDER_NAME = "本机验收服务";
const DISPUTED_MODEL = "mock-alpha-vision-disputed";
const RETRY_MODEL = "mock-beta-retry";
const LONG_MODEL = "mock-manual-ultra-long-model-id-that-must-not-overflow-2026";
const ORIGINAL_PROMPT = "请回复本地验收标记。";
const ATTACHMENT_PROMPT = "请读取我附上的图片，并回复本地附件验收标记。";
const SUBAGENT_EXPLICIT_PROMPT = "请使用子任务工具完成本地显式路由验收。";
const SUBAGENT_AUTO_PROMPT = "请使用子任务工具完成本地自动继承验收。";
const SUBAGENT_EXPLICIT_CHILD = "仅回复 LEEMO_R9_EXPLICIT_CHILD_OK";
const SUBAGENT_AUTO_CHILD = "仅回复 LEEMO_R9_AUTO_CHILD_OK";
const SUCCESS_MARKER = "LEEMO_R9_RETRY_OK";
const IMAGE_NAME = "leemo-r9-attachment.png";
const SCREENSHOTS = [
  "model-onboarding-r9-catalog.png",
  "model-onboarding-r9-form-top.png",
  "model-onboarding-r9-capability-disputed.png",
  "model-onboarding-r9-capability-override.png",
  "model-onboarding-r9-usage.png",
  "model-onboarding-r9-retry-ready.png",
  "model-onboarding-r9-retry.png",
  "model-onboarding-r9-retry-success.png",
  "model-onboarding-r9-after-restart.png",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const insist = (condition, message) => {
  if (!condition) throw new Error(message);
};

function validateAuditRoot(candidate) {
  const resolved = path.resolve(candidate);
  const tempRoot = fs.realpathSync(os.tmpdir());
  insist(path.dirname(resolved).toLowerCase() === tempRoot.toLowerCase(), `隔离目录不在系统临时目录一级：${resolved}`);
  insist(path.basename(resolved).startsWith(ROOT_PREFIX), `隔离目录前缀错误：${resolved}`);
  return resolved;
}

function removeAuditRoot(candidate) {
  const resolved = validateAuditRoot(candidate);
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "无法分配本机端口");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function parseJson(chunks) {
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function hasImageProbe(body) {
  return JSON.stringify(body.messages ?? []).includes("image_url");
}

function hasAttachmentMetadata(body) {
  const serialized = JSON.stringify(body.messages ?? []);
  return serialized.includes("LEEMO_ATTACHMENTS_JSON") && serialized.includes(IMAGE_NAME);
}

function messagesContain(body, text) {
  return JSON.stringify(body.messages ?? []).includes(text);
}

function writeJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function writeSuccessStream(res, model, text = SUCCESS_MARKER) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const base = {
    id: "chatcmpl-leemo-r9-settings",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
  };
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 17, completion_tokens: 5 } });
  res.end("data: [DONE]\n\n");
}

function writeToolCallStream(res, model, toolName, childPrompt) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const base = {
    id: "chatcmpl-leemo-r9-subagent",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
  };
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({
    ...base,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: `call_leemo_r9_${childPrompt.includes("EXPLICIT") ? "explicit" : "auto"}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify({
              description: "核对本地模型路由",
              prompt: childPrompt,
              subagent_type: "general-purpose",
            }),
          },
        }],
      },
      finish_reason: null,
    }],
  });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  res.end("data: [DONE]\n\n");
}

function createMockServer(state) {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/v1/models") {
        writeJson(res, 200, {
          data: [
            { id: DISPUTED_MODEL, display_name: "Alpha 图片争议模型" },
            { id: `${DISPUTED_MODEL}-2026-07-30`, display_name: "Alpha 快照" },
            { id: RETRY_MODEL, display_name: "Beta 重试模型" },
          ],
        });
        return;
      }

      const body = parseJson(chunks);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const lastMessage = messages.at(-1);
      const lastMessageText = JSON.stringify(lastMessage ?? {});
      const toolNames = Array.isArray(body.tools)
        ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
        : [];
      const request = {
        path: req.url,
        model: typeof body.model === "string" ? body.model : null,
        stream: body.stream === true,
        authorizationOk: req.headers.authorization === `Bearer ${TEST_KEY}`,
        imageProbe: hasImageProbe(body),
        reasoningProbe: typeof body.reasoning_effort === "string",
        attachmentMetadata: hasAttachmentMetadata(body),
        originalPrompt: messagesContain(body, ORIGINAL_PROMPT),
        attachmentPrompt: messagesContain(body, ATTACHMENT_PROMPT),
        subagentExplicitPrompt: messagesContain(body, SUBAGENT_EXPLICIT_PROMPT),
        subagentAutoPrompt: messagesContain(body, SUBAGENT_AUTO_PROMPT),
        explicitChildPrompt: lastMessageText.includes(SUBAGENT_EXPLICIT_CHILD),
        autoChildPrompt: lastMessageText.includes(SUBAGENT_AUTO_CHILD),
        lastRole: typeof lastMessage?.role === "string" ? lastMessage.role : null,
        hasToolResult: lastMessageText.includes("tool_call_id") || /LEEMO_R9_(?:EXPLICIT|AUTO)_CHILD_OK/.test(lastMessageText),
        agentToolName: toolNames.find((name) => name === "Task" || name === "Agent") ?? null,
      };
      state.requests.push(request);

      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        writeJson(res, 404, { error: { message: "not found" } });
        return;
      }
      if (!request.authorizationOk) {
        writeJson(res, 401, { error: { message: "invalid local test key", type: "authentication_error" } });
        return;
      }

      if (request.stream) {
        state.streamAttempts += 1;
        const subagentMode = request.subagentExplicitPrompt || request.explicitChildPrompt
          ? "explicit"
          : request.subagentAutoPrompt || request.autoChildPrompt
            ? "auto"
            : null;
        if (subagentMode) {
          const childPrompt = subagentMode === "explicit" ? SUBAGENT_EXPLICIT_CHILD : SUBAGENT_AUTO_CHILD;
          const childRequest = subagentMode === "explicit" ? request.explicitChildPrompt : request.autoChildPrompt;
          if (request.hasToolResult && !childRequest) {
            writeSuccessStream(res, request.model ?? RETRY_MODEL, `LEEMO_R9_${subagentMode.toUpperCase()}_PARENT_OK`);
            return;
          }
          if (childRequest) {
            writeSuccessStream(res, request.model ?? RETRY_MODEL, `LEEMO_R9_${subagentMode.toUpperCase()}_CHILD_OK`);
            return;
          }
          if (!request.agentToolName) {
            writeJson(res, 400, { error: { message: "Agent tool was not advertised", type: "invalid_request_error" } });
            return;
          }
          writeToolCallStream(res, request.model ?? RETRY_MODEL, request.agentToolName, childPrompt);
          return;
        }
        if (!state.allowStreamSuccess) {
          writeJson(res, 400, {
            error: {
              message: "Local retry acceptance intentionally failed the first run.",
              type: "invalid_request_error",
            },
          });
          return;
        }
        writeSuccessStream(res, request.model ?? RETRY_MODEL);
        return;
      }

      if (request.imageProbe) {
        writeJson(res, 400, {
          error: {
            message: "Local capability probe is intentionally inconclusive.",
            type: "invalid_request_error",
          },
        });
        return;
      }

      writeJson(res, 200, {
        id: "chatcmpl-leemo-r9-probe",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: request.reasoningProbe ? "4" : "OK",
            ...(request.reasoningProbe ? { reasoning_content: "2 + 2 = 4" } : {}),
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });
    });
  });
}

async function startMockServer(state) {
  const server = createMockServer(state);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "本机 mock 服务没有绑定端口");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForRenderer(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((candidate) => candidate.type === "page" && !candidate.url.startsWith("devtools://"));
      if (target) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`打包 renderer 未就绪：${lastError ?? "no page"}`);
}

async function launchApp(auditRoot, label) {
  const port = await freePort();
  const logs = [];
  const startedAt = Date.now();
  const child = spawn(PACKAGED_EXE, [
    `--remote-debugging-port=${port}`,
    `--leemo-e2e-root=${auditRoot}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
  ], {
    cwd: auditRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  await waitForRenderer(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  insist(page, `${label} 没有 renderer page`);
  // The packaged app now opens on the quiet Start surface, where a composer is
  // intentionally absent. Wait for the shared shell instead; individual
  // journeys switch to Workbench before they need the input field.
  await page.getByTestId("topbar-product-identity").waitFor({ state: "visible", timeout: 60_000 });
  return { child, browser, page, logs, port, startupMs: Date.now() - startedAt };
}

async function stopApp(instance) {
  if (!instance) return;
  await instance.page.close({ runBeforeUnload: true }).catch(() => {});
  await Promise.race([
    new Promise((resolve) => instance.child.once("exit", resolve)),
    sleep(5_000),
  ]);
  if (instance.child.exitCode === null && instance.child.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(instance.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // A graceful close can race taskkill and is already sufficient.
    }
  }
  await instance.browser.close().catch(() => {});
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), animations: "disabled" });
}

function runLayoutAcceptance(port) {
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "verify-settings-layout.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      LEEMO_CDP_PORT: String(port),
      LEEMO_AUDIT_TAG: "model-onboarding-r9-layout",
    },
    windowsHide: true,
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readProcessTreeMetrics(rootPid) {
  const command = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize
$ids = [System.Collections.Generic.HashSet[int]]::new()
[void]$ids.Add(${rootPid})
do {
  $before = $ids.Count
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ParentProcessId)) { [void]$ids.Add([int]$process.ProcessId) }
  }
} while ($ids.Count -gt $before)
$rows = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
[pscustomobject]@{
  processCount = $rows.Count
  workingSetBytes = [long](($rows | Measure-Object -Property WorkingSetSize -Sum).Sum)
} | ConvertTo-Json -Compress
`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    encoding: "utf8",
  });
  return JSON.parse(output.trim());
}

async function skipOnboarding(page) {
  const later = page.getByRole("button", { name: "稍后配置", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click();
}

async function openSettingsTab(page, label) {
  if (!await page.getByTestId("settings-window").isVisible().catch(() => false)) {
    await page.getByTestId("topbar-primary-controls").getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  const search = page.getByRole("searchbox", { name: "搜索设置" });
  if (await search.inputValue()) await search.fill("");
  await page.getByRole("tab", { name: label, exact: true }).click();
}

async function ensureWorkbench(page) {
  if (await page.getByTestId("workbench-shell").isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "切换到工作台", exact: true }).click();
  await page.getByTestId("workbench-shell").waitFor({ state: "visible" });
}

async function setUpProviderThroughUi(page, baseUrl) {
  await openSettingsTab(page, "模型");
  const catalog = page.getByTestId("provider-offer-grid");
  if (!await catalog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "添加模型服务商" }).click();
  }
  await catalog.waitFor({ state: "visible" });
  const cards = page.getByTestId("provider-offer-card");
  const providerCatalogCards = await cards.count();
  insist(providerCatalogCards >= 11, "服务商目录没有十个精选预设和自定义入口");
  await screenshot(page, SCREENSHOTS[0]);

  await page.getByRole("button", { name: "配置 自定义服务" }).click();
  const form = page.getByTestId("provider-config-form");
  await form.waitFor({ state: "visible" });
  await form.getByLabel("名称").fill(PROVIDER_NAME);
  await form.getByRole("button", { name: "OpenAI Chat", exact: true }).click();
  await form.getByLabel("Base URL").fill(baseUrl);
  await form.locator('input[aria-label="API Key"]').fill(TEST_KEY);
  await form.getByRole("tab", { name: "高级设置", exact: true }).click();
  await form.getByLabel("模型发现地址").fill(`${baseUrl}/models`);
  await screenshot(page, SCREENSHOTS[1]);
  await form.getByRole("tab", { name: "连接与模型", exact: true }).click();

  await form.getByLabel("手敲模型名").fill(LONG_MODEL);
  await form.getByRole("button", { name: "添加模型", exact: true }).click();
  await form.getByRole("button", { name: "拉取模型列表", exact: true }).click();
  await form.getByLabel(`${DISPUTED_MODEL} 可用`).waitFor({ state: "visible" });
  await form.getByLabel(`${DISPUTED_MODEL} 可用`).check();
  await form.getByLabel(`${RETRY_MODEL} 可用`).check();
  await form.getByRole("button", { name: `设为首选模型 ${DISPUTED_MODEL}` }).click();

  await form.getByRole("button", { name: "测试连接", exact: true }).click();
  const result = form.getByTestId("connection-test-result");
  try {
    await result.getByText("连接成功", { exact: true }).waitFor({ state: "visible", timeout: 45_000 });
  } catch (error) {
    await screenshot(page, "model-onboarding-r9-connection-timeout.png");
    const detail = await result.innerText().catch(() => "连接测试结果区未出现");
    throw new Error(`连接能力探测没有完成：${detail}`, { cause: error });
  }
  await result.getByText("图片：本次检测未通过 · 自动探测", { exact: true }).waitFor({ state: "visible" });
  await result.getByText("深度思考：已验证支持 · 自动探测", { exact: true }).waitFor({ state: "visible" });
  await screenshot(page, SCREENSHOTS[2]);

  await form.getByRole("button", { name: "我确认这个模型支持图片" }).click();
  await form.getByText("图片：用户已确认支持", { exact: false }).first().waitFor({ state: "visible" });
  await screenshot(page, SCREENSHOTS[3]);

  await form.getByRole("button", { name: `设为首选模型 ${RETRY_MODEL}` }).click();
  await form.getByRole("tab", { name: "高级设置", exact: true }).click();
  await form.getByLabel("子任务使用方式").selectOption("specific");
  await form.getByLabel("子任务使用模型").selectOption(DISPUTED_MODEL);
  await form.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByText("凭据已安全保存", { exact: true }).waitFor({ state: "visible" });

  await openSettingsTab(page, "用量与费用");
  await page.getByRole("heading", { name: "用量与费用" }).waitFor({ state: "visible" });
  await screenshot(page, SCREENSHOTS[4]);
  await page.getByRole("button", { name: "关闭设置" }).click();
  return providerCatalogCards;
}

async function runRetryJourney(page, state) {
  await ensureWorkbench(page);
  await page.getByRole("button", { name: "新建对话" }).click();
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.waitFor({ state: "visible" });
  await composer.fill(ORIGINAL_PROMPT);
  await screenshot(page, SCREENSHOTS[5]);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await page.getByText("任务没有完成", { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByText("原消息和附件已保留", { exact: false }).waitFor({ state: "visible" });
  await page.getByText("服务商返回错误（400）。请检查模型配置、接口地址或额度后重试。", { exact: true })
    .first()
    .waitFor({ state: "visible" });
  const failureText = await page.locator("body").innerText();
  insist(!/Claude Code|Claude Agent SDK|API Error/i.test(failureText), "失败界面泄露了底层 SDK 或原始 API 错误");
  await screenshot(page, SCREENSHOTS[6]);

  await page.getByRole("button", { name: "选择其他模型", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${DISPUTED_MODEL}`) }).click();
  await page.getByRole("button", { name: "切换模型", exact: true }).filter({ hasText: DISPUTED_MODEL }).waitFor({ state: "visible" });
  state.allowStreamSuccess = true;
  await page.getByRole("button", { name: "仍用当前模型重试", exact: true }).click();
  await page.getByText(SUCCESS_MARKER, { exact: false }).waitFor({ state: "visible", timeout: 60_000 });
  // Completed conversations deliberately do not keep a persistent "已完成"
  // badge in the title bar. The composer returning from Stop to Send is the
  // current visible terminal-state contract.
  await page.getByRole("button", { name: "发送", exact: true }).waitFor({ state: "visible" });
  insist(!await page.getByText("任务没有完成", { exact: true }).isVisible().catch(() => false), "重试成功后失败提示仍未清除");
  await screenshot(page, SCREENSHOTS[7]);
}

async function waitForBridgeTerminal(page, conversationId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const finished = await page.evaluate((id) => {
      const events = window.__leemoR9AttachmentEvents ?? [];
      return events.findLast((item) => item.conversationId === id && item.event?.type === "run.finished") ?? null;
    }, conversationId);
    if (finished) return finished.event;
    await sleep(100);
  }
  throw new Error(`等待附件 Bridge 终态超时：${conversationId}`);
}

async function setSubagentRouting(page, providerId, modelId) {
  const saved = await page.evaluate(async ({ id, subagentModelId }) => {
    const config = await window.leemoBridge.invoke("bridge:getProviderConfig", { providerId: id });
    if (!config.ok || !config.response) throw new Error(config.error || "getProviderConfig failed");
    const current = config.response;
    return window.leemoBridge.invoke("bridge:saveProvider", {
      id: current.id,
      kind: current.kind,
      name: current.name,
      baseUrl: current.baseUrl,
      apiFormat: current.apiFormat,
      category: current.category,
      models: current.models,
      modelCapabilities: current.modelCapabilities,
      modelCapabilityEvidence: current.modelCapabilityEvidence,
      taskModelRouting: {
        ...(current.taskModelRouting?.fastModelId ? { fastModelId: current.taskModelRouting.fastModelId } : {}),
        ...(subagentModelId ? { subagentModelId } : {}),
      },
      headers: current.headers,
      capabilities: current.capabilities,
      modelsUrl: current.modelsUrl,
      apiKeyUrl: current.apiKeyUrl,
    });
  }, { id: providerId, subagentModelId: modelId });
  insist(saved.ok, `更新子任务路由失败：${saved.error ?? "unknown"}`);
}

async function runSubagentRound(page, providerId, prompt) {
  await page.evaluate(() => {
    window.__leemoR9AttachmentEvents = [];
    window.__leemoR9AttachmentOff?.();
    window.__leemoR9AttachmentOff = window.leemoBridge.on("bridge:event", (payload) => {
      window.__leemoR9AttachmentEvents.push(payload);
    });
  });
  const created = await page.evaluate(async ({ id, modelId }) => {
    return window.leemoBridge.invoke("bridge:createConversation", {
      providerId: id,
      modelId,
      mode: "workbench",
      talkStyle: 1,
      webSearchEnabled: false,
      webFetchEnabled: false,
      rememberMode: false,
      permissionMode: "acceptEdits",
    });
  }, { id: providerId, modelId: RETRY_MODEL });
  insist(created.ok, `创建子任务路由验收对话失败：${created.error ?? "unknown"}`);
  const conversationId = created.response.conversationId;
  const sent = await page.evaluate(async ({ id, text }) => {
    return window.leemoBridge.invoke("bridge:send", { conversationId: id, prompt: text });
  }, { id: conversationId, text: prompt });
  insist(sent.ok, `子任务路由验收发送失败：${sent.error ?? "unknown"}`);
  const terminal = await waitForBridgeTerminal(page, conversationId, 90_000);
  const events = await page.evaluate((id) => (window.__leemoR9AttachmentEvents ?? [])
    .filter((item) => item.conversationId === id)
    .map((item) => item.event), conversationId);
  await page.evaluate(async (id) => {
    window.__leemoR9AttachmentOff?.();
    delete window.__leemoR9AttachmentOff;
    delete window.__leemoR9AttachmentEvents;
    await window.leemoBridge.invoke("bridge:disposeConversation", { conversationId: id });
  }, conversationId);
  insist(terminal.isError === false && terminal.subtype === "success", "真实子任务路由轮没有成功结束");
  insist(events.some((event) => event.type === "subagent.activity"), "真实子任务没有产生 subagent.activity 事件");
  return events;
}

async function runSubagentRoutingJourney(page, state) {
  const provider = await page.evaluate(async (providerName) => {
    const listed = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!listed.ok) throw new Error(listed.error || "listProviders failed");
    return listed.response.find((item) => item.name === providerName) ?? null;
  }, PROVIDER_NAME);
  insist(provider, "子任务路由验收找不到本地服务商");

  const explicitStart = state.requests.length;
  await setSubagentRouting(page, provider.id, DISPUTED_MODEL);
  await runSubagentRound(page, provider.id, SUBAGENT_EXPLICIT_PROMPT);
  const explicitRequests = state.requests.slice(explicitStart).filter((request) => request.stream);
  const explicitChild = explicitRequests.find((request) => request.explicitChildPrompt);
  insist(explicitChild?.model === DISPUTED_MODEL, `显式子任务没有使用指定模型：${explicitChild?.model ?? "missing"}`);

  const autoStart = state.requests.length;
  await setSubagentRouting(page, provider.id, undefined);
  await runSubagentRound(page, provider.id, SUBAGENT_AUTO_PROMPT);
  const autoRequests = state.requests.slice(autoStart).filter((request) => request.stream);
  const autoChild = autoRequests.find((request) => request.autoChildPrompt);
  insist(autoChild?.model === RETRY_MODEL, `自动子任务没有继承当前模型：${autoChild?.model ?? "missing"}`);

  await setSubagentRouting(page, provider.id, DISPUTED_MODEL);
  return {
    explicit: {
      parentModel: explicitRequests[0]?.model,
      childModel: explicitChild.model,
      agentToolName: explicitRequests[0]?.agentToolName,
    },
    automatic: {
      parentModel: autoRequests[0]?.model,
      childModel: autoChild.model,
      agentToolName: autoRequests[0]?.agentToolName,
    },
  };
}

async function runBridgeAttachmentJourney(page, imagePath, state) {
  state.allowStreamSuccess = false;
  await page.evaluate(() => {
    window.__leemoR9AttachmentEvents = [];
    window.__leemoR9AttachmentOff?.();
    window.__leemoR9AttachmentOff = window.leemoBridge.on("bridge:event", (payload) => {
      window.__leemoR9AttachmentEvents.push(payload);
    });
  });

  const context = await page.evaluate(async ({ providerName, modelId }) => {
    const listed = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!listed.ok) throw new Error(listed.error || "listProviders failed");
    const provider = listed.response.find((item) => item.name === providerName);
    if (!provider) throw new Error("local provider missing");
    const created = await window.leemoBridge.invoke("bridge:createConversation", {
      providerId: provider.id,
      modelId,
      mode: "workbench",
      talkStyle: 1,
      webSearchEnabled: false,
      webFetchEnabled: false,
      rememberMode: false,
      permissionMode: "acceptEdits",
    });
    if (!created.ok) throw new Error(created.error || "createConversation failed");
    return { providerId: provider.id, conversationId: created.response.conversationId };
  }, { providerName: PROVIDER_NAME, modelId: RETRY_MODEL });

  const attachment = {
    name: IMAGE_NAME,
    path: imagePath,
    size: fs.statSync(imagePath).size,
    mimeType: "image/png",
  };
  const firstSend = await page.evaluate(async ({ conversationId, prompt, attachment: ref }) => {
    return window.leemoBridge.invoke("bridge:send", { conversationId, prompt, attachments: [ref] });
  }, { conversationId: context.conversationId, prompt: ATTACHMENT_PROMPT, attachment });
  insist(firstSend.ok, `附件失败轮没有越过 host ack：${firstSend.error ?? "unknown"}`);
  const failed = await waitForBridgeTerminal(page, context.conversationId);
  insist(failed.isError === true && failed.subtype === "error", "附件故障轮没有进入真实失败终态");

  await page.evaluate((conversationId) => {
    window.__leemoR9AttachmentEvents = (window.__leemoR9AttachmentEvents ?? [])
      .filter((item) => item.conversationId !== conversationId);
  }, context.conversationId);
  const switched = await page.evaluate(async ({ conversationId, providerId, modelId }) => {
    return window.leemoBridge.invoke("bridge:setModel", { conversationId, providerId, modelId });
  }, { conversationId: context.conversationId, providerId: context.providerId, modelId: DISPUTED_MODEL });
  insist(switched.ok, `附件轮切换模型失败：${switched.error ?? "unknown"}`);
  state.allowStreamSuccess = true;
  const secondSend = await page.evaluate(async ({ conversationId, prompt, attachment: ref }) => {
    return window.leemoBridge.invoke("bridge:send", { conversationId, prompt, attachments: [ref] });
  }, { conversationId: context.conversationId, prompt: ATTACHMENT_PROMPT, attachment });
  insist(secondSend.ok, `附件重发没有越过 host ack：${secondSend.error ?? "unknown"}`);
  const succeeded = await waitForBridgeTerminal(page, context.conversationId);
  insist(succeeded.isError === false && succeeded.subtype === "success", "附件重发没有完成");
  await page.evaluate(async (conversationId) => {
    window.__leemoR9AttachmentOff?.();
    delete window.__leemoR9AttachmentOff;
    delete window.__leemoR9AttachmentEvents;
    await window.leemoBridge.invoke("bridge:disposeConversation", { conversationId });
  }, context.conversationId);
}

async function readPersistedFacts(page) {
  return page.evaluate(async ({ providerName }) => {
    const providers = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!providers.ok) throw new Error(providers.error || "listProviders failed");
    const provider = providers.response.find((item) => item.name === providerName);
    if (!provider) throw new Error("saved provider missing");
    const config = await window.leemoBridge.invoke("bridge:getProviderConfig", { providerId: provider.id });
    if (!config.ok || !config.response) throw new Error(config.error || "getProviderConfig failed");
    const persisted = await window.leemoPersist.invoke("loadAll", undefined);
    if (!persisted.ok) throw new Error(persisted.error || "loadAll failed");
    return { provider, config: config.response, settings: persisted.response.settings };
  }, { providerName: PROVIDER_NAME });
}

async function verifyAfterRestart(page) {
  await skipOnboarding(page);
  const persisted = await readPersistedFacts(page);
  insist(persisted.provider.models[0] === RETRY_MODEL, "服务商模型优先级没有跨重启保持");
  insist(persisted.config.hasApiKey === true && !Object.hasOwn(persisted.config, "apiKey"), "凭据没有保持 main-only 掩码边界");
  insist(persisted.config.taskModelRouting?.subagentModelId === DISPUTED_MODEL, "子任务人话配置没有跨重启保持");
  insist(
    persisted.config.modelCapabilityEvidence?.[DISPUTED_MODEL]?.image?.userOverride?.supported === true,
    "图片能力的用户纠正没有跨重启保持",
  );
  insist(
    persisted.settings?.defaultProviderId === persisted.provider.id
      && persisted.settings?.defaultModelId === RETRY_MODEL,
    "新对话默认模型没有跨重启保持",
  );

  await openSettingsTab(page, "模型");
  await page.getByText("凭据已安全保存", { exact: true }).waitFor({ state: "visible" });
  await page.getByText(RETRY_MODEL, { exact: true }).first().waitFor({ state: "visible" });
  await screenshot(page, SCREENSHOTS[8]);
  return persisted;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const screenshotName of SCREENSHOTS) fs.rmSync(path.join(OUTPUT_DIR, screenshotName), { force: true });
  fs.rmSync(FACTS_PATH, { force: true });
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  insist(fs.existsSync(PACKAGED_EXE), `找不到打包应用：${PACKAGED_EXE}`);

  const auditRoot = validateAuditRoot(fs.mkdtempSync(path.join(os.tmpdir(), ROOT_PREFIX)));
  const imagePath = path.join(auditRoot, IMAGE_NAME);
  fs.writeFileSync(
    imagePath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX8AAAAASUVORK5CYII=", "base64"),
  );
  const state = { requests: [], streamAttempts: 0, allowStreamSuccess: false };
  let mock;
  let current;
  const logs = [];

  try {
    mock = await startMockServer(state);
    current = await launchApp(auditRoot, "首次启动");
    logs.push(...current.logs);
    const coldStartupMs = current.startupMs;
    await skipOnboarding(current.page);
    const providerCatalogCards = await setUpProviderThroughUi(current.page, mock.baseUrl);
    runLayoutAcceptance(current.port);
    await runRetryJourney(current.page, state);
    await runBridgeAttachmentJourney(current.page, imagePath, state);
    const subagentRouting = await runSubagentRoutingJourney(current.page, state);
    const beforeRestart = await readPersistedFacts(current.page);
    await stopApp(current);
    logs.push(...current.logs);
    current = await launchApp(auditRoot, "重启验收");
    const warmStartupMs = current.startupMs;
    const afterRestart = await verifyAfterRestart(current.page);
    await current.page.getByRole("button", { name: "关闭设置", exact: true }).click();
    await sleep(2_000);
    const idleProcessTree = readProcessTreeMetrics(current.child.pid);

    const streamRequests = state.requests.filter((request) => request.stream);
    insist(streamRequests.length >= 4, `实际发送请求不足四次：${streamRequests.length}`);
    insist(streamRequests[0].model === RETRY_MODEL, "第一次失败没有使用当前默认模型");
    insist(streamRequests[1].model === DISPUTED_MODEL, "界面切换模型后重试没有使用新模型");
    const attachmentRequests = streamRequests.filter((request) => request.attachmentPrompt);
    insist(attachmentRequests.length >= 2, "附件 Bridge 请求没有完整走过失败与成功两轮");
    insist(attachmentRequests[0].model === RETRY_MODEL, "附件失败轮没有使用原模型");
    insist(attachmentRequests.at(-1).model === DISPUTED_MODEL, "附件重发没有使用切换后的模型");
    insist(attachmentRequests[0].attachmentMetadata, "第一次附件发送静默丢掉了附件元数据");
    insist(attachmentRequests.at(-1).attachmentMetadata, "附件重发静默丢掉了附件元数据");
    insist(state.requests.some((request) => request.imageProbe), "自动图片探测没有到达服务商");
    insist(state.requests.some((request) => request.reasoningProbe), "自动思考探测没有到达服务商");
    insist(state.requests.every((request) => request.authorizationOk), "存在未携带正确鉴权的 mock 请求");

    const allLogs = [...logs, ...current.logs].join("");
    insist(!allLogs.includes(TEST_KEY), "打包主进程日志泄露了测试 API Key");
    const serializedFacts = JSON.stringify({ beforeRestart, afterRestart });
    insist(!serializedFacts.includes(TEST_KEY), "renderer 可见状态泄露了测试 API Key");

    const facts = {
      checkedAt: new Date().toISOString(),
      packagedExecutable: path.relative(ROOT, PACKAGED_EXE).replaceAll(path.sep, "/"),
      isolatedUserData: true,
      externalApiCalls: 0,
      coldStartupMs,
      warmStartupMs,
      idleProcessTree,
      providerCatalogCards,
      remoteDiscovery: true,
      manualModel: true,
      automaticCapabilityProbes: {
        imageReachedUpstream: true,
        imageFailedAdvisoryOnly: true,
        reasoningReachedUpstream: true,
        userOverridePersisted: true,
      },
      persistedModelOrder: afterRestart.provider.models,
      subtaskRouting: {
        explicitModelPersisted: true,
        packagedAgentToolExecuted: true,
        explicit: subagentRouting.explicit,
        automatic: subagentRouting.automatic,
      },
      retry: {
        failedAfterHostAck: true,
        userFacingErrorNormalized: true,
        originalTextPreserved: true,
        uiModelSwitchAndRetry: true,
        switchedFrom: streamRequests[0].model,
        switchedTo: streamRequests[1].model,
        completed: true,
      },
      attachmentBridge: {
        failedAfterHostAck: true,
        sameAbsolutePathMetadataOnBothRounds: true,
        switchedFrom: attachmentRequests[0].model,
        switchedTo: attachmentRequests.at(-1).model,
        completed: true,
      },
      nativeAttachmentPickerAutomated: false,
      layoutFacts: "docs/research/audit-shots/model-onboarding-r9-layout-facts.json",
      mockRequests: state.requests.length,
      streamAttempts: state.streamAttempts,
      apiKeyRendererVisible: false,
      apiKeyLogged: false,
      screenshots: SCREENSHOTS,
    };
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(facts, null, 2));
  } finally {
    await stopApp(current).catch(() => {});
    await closeServer(mock?.server).catch(() => {});
    for (let attempt = 0; attempt < 20 && fs.existsSync(auditRoot); attempt += 1) {
      try {
        removeAuditRoot(auditRoot);
      } catch (error) {
        if (attempt === 19) {
          console.warn(`[settings-runtime] 隔离目录仍被 Windows 占用，延后清理：${auditRoot}`);
          break;
        }
        await sleep(500);
      }
    }
  }
}

await main();
