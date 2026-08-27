import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = path.join(ROOT, "dist-electron", "main.mjs");
const require = createRequire(import.meta.url);
const electronExecutable = path.join(
  path.dirname(require.resolve("electron/package.json")),
  "dist",
  "electron.exe",
);
const packagedExecutable = process.env.LEEMO_PACKAGED_EXE
  ? path.resolve(process.env.LEEMO_PACKAGED_EXE)
  : null;
const port = Number(process.env.LEEMO_MOMO_CDP_PORT ?? 9368);
const tempParent = fs.realpathSync(os.tmpdir());
const auditRoot = fs.mkdtempSync(path.join(tempParent, "leemo-e2e-momo-relationship-"));
const outputDir = path.join(ROOT, ".tmp-visual-audit", "momo-relationship");
const factsPath = path.join(outputDir, "facts.json");
const hostLogs = [];
const FIRST_TURN_MARKER = "MOMO_E2E_NEW_SESSION";
const ASK_USER_MARKER = "MOMO_E2E_ASK_USER";
const HISTORY_MARKER = "MOMO_E2E_HISTORY";
const FIRST_TURN_REPLY = "MOMO_E2E_NEW_SESSION_OK";
const ASK_USER_REPLY = "MOMO_E2E_ASK_USER_OK";
const HISTORY_REPLY = "MOMO_E2E_HISTORY_OK";
const HISTORY_PHRASE = "最影响状态的那件事";
const draftAttachmentPath = path.join(auditRoot, "home", "Leemo", "默认工作区", "待整理想法.md");

function insist(value, message) {
  if (!value) throw new Error(message);
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function streamHeaders(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function writeSuccessStream(response, model, text) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-momo-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 18, completion_tokens: 5 } });
  response.end("data: [DONE]\n\n");
}

function writeToolCallStream(response, model, toolName, args, id) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-momo-tool-${id}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({
    ...base,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: `call_momo_${id}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: null,
    }],
  });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  response.end("data: [DONE]\n\n");
}

function prepareOutputDirectory() {
  const resolved = path.resolve(outputDir);
  const expected = `${path.resolve(ROOT, ".tmp-visual-audit")}${path.sep}`;
  insist(resolved.startsWith(expected), `拒绝清理意外的视觉验收目录：${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function forceKill(child) {
  if (!child?.pid) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  spawnSync("taskkill", ["/PID", String(child.pid), "/T"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 8_000)),
  ]);
  if (!graceful) {
    forceKill(child);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

function launch() {
  const executable = packagedExecutable ?? electronExecutable;
  const applicationArgs = packagedExecutable ? [] : [MAIN];
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, LEEMO_RENDERER_URL: _rendererUrl, ...cleanEnv } = process.env;
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    ...applicationArgs,
    `--leemo-e2e-root=${auditRoot}`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => hostLogs.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => hostLogs.push(chunk.toString()));
  return child;
}

async function waitForCdp(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Electron 调试端口没有就绪：${lastError instanceof Error ? lastError.message : "timeout"}`);
}

async function connect() {
  await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url() && !page.url().startsWith("devtools://")) return { browser, page };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await browser.close();
  throw new Error("没有找到 Leemo 主窗口。");
}

async function invokeBridge(page, channel, payload) {
  const result = await page.evaluate(
    ({ operation, request }) => window.leemoBridge.invoke(operation, request),
    { operation: channel, request: payload },
  );
  insist(result.ok, `${channel} 失败：${result.error ?? "unknown"}`);
  return result.response;
}

async function invokePersistence(page, operation, payload) {
  const result = await page.evaluate(
    ({ op, value }) => window.leemoPersist.invoke(op, value),
    { op: operation, value: payload },
  );
  insist(result.ok, `${operation} 失败：${result.error ?? "unknown"}`);
  return result.response;
}

async function screenshot(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(180);
  const metrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  insist(
    metrics.documentWidth <= metrics.viewportWidth && metrics.bodyWidth <= metrics.viewportWidth,
    `${name} 出现横向溢出：${JSON.stringify(metrics)}`,
  );
  const target = path.join(outputDir, name);
  await page.screenshot({ path: target, animations: "disabled" });
  return path.relative(ROOT, target).replaceAll(path.sep, "/");
}

async function seed(page, mockBaseUrl) {
  await page.waitForFunction(() => Boolean(window.leemoPersist && window.leemoBridge));
  const provider = await invokeBridge(page, "bridge:saveProvider", {
    kind: "custom",
    name: "momo 验收模型",
    category: "custom",
    baseUrl: mockBaseUrl,
    apiFormat: "openai",
    apiKey: "leemo-e2e-placeholder-primary",
    models: ["deepseek-v4-flash", "glm-5.2"],
    modelContextPolicies: {
      "deepseek-v4-flash": { contextWindowTokens: 200_000, autoCompactWindowTokens: 167_000 },
      "glm-5.2": { contextWindowTokens: 1_000_000, autoCompactWindowTokens: 950_000 },
    },
  });
  const secondProvider = await invokeBridge(page, "bridge:saveProvider", {
    kind: "custom",
    name: "momo 同名模型验收服务",
    category: "custom",
    baseUrl: mockBaseUrl,
    apiFormat: "openai",
    apiKey: "leemo-e2e-placeholder-secondary",
    models: ["deepseek-v4-flash"],
    modelContextPolicies: {
      "deepseek-v4-flash": { contextWindowTokens: 200_000, autoCompactWindowTokens: 167_000 },
    },
  });

  const now = Date.now();
  const meta = {
    id: "momo-history",
    title: "最近聊到的选择",
    titleManuallyUpdated: true,
    bookId: null,
    workspaceId: "leemo-home",
    source: "buddy",
    providerId: provider.id,
    modelId: "deepseek-v4-flash",
    createdAt: now - 86_400_000,
    lastActivityAt: now - 60_000,
    lastOpenedAt: now - 60_000,
    unread: false,
    pinned: false,
    archived: false,
    sessionId: "seeded-old-session",
  };
  const timeline = [
    {
      kind: "text", id: "momo-e2e-user-old", runId: "momo-e2e-old-run", role: "user",
      text: "最近脑子里事情有点多，我想先把最影响状态的那件事说清楚。",
      streaming: false, createdAt: now - 70_000,
    },
    {
      kind: "text", id: "momo-e2e-reply-old", runId: "momo-e2e-old-run", role: "momo",
      text: "可以。你先从最占注意力的地方说，我陪你把线头慢慢找出来。",
      streaming: false, createdAt: now - 60_000,
    },
  ];
  await invokePersistence(page, "saveConversation", { meta, timeline });
  await invokePersistence(page, "saveSettings", {
    surface: "buddy",
    mode: "buddy",
    themeId: "white-copper",
    onboardingCompleted: true,
    relationshipInviteDismissed: true,
    relationshipConversationId: "momo-history",
    defaultProviderId: provider.id,
    defaultModelId: "deepseek-v4-flash",
    continueInBackground: false,
  });
  return { providerId: provider.id, secondProviderId: secondProvider.id, meta, timeline };
}

async function captureReadmeScenario(page, {
  id,
  title,
  providerId,
  messages,
  screenshotName,
}) {
  const now = Date.now();
  const existing = await invokePersistence(page, "loadAll", undefined);
  for (const conversation of existing.conversations ?? []) {
    await invokePersistence(page, "deleteConversation", { conversationId: conversation.meta.id });
  }
  const timeline = messages.map((message, index) => ({
    kind: "text",
    id: `${id}-message-${index + 1}`,
    runId: `${id}-run-${Math.floor(index / 2) + 1}`,
    role: message.role,
    text: message.text,
    streaming: false,
    createdAt: now - (messages.length - index) * 60_000,
  }));
  await invokePersistence(page, "saveConversation", {
    meta: {
      id,
      title,
      titleManuallyUpdated: true,
      bookId: null,
      workspaceId: "leemo-home",
      source: "buddy",
      providerId,
      modelId: "deepseek-v4-flash",
      createdAt: now - messages.length * 60_000,
      lastActivityAt: now - 60_000,
      lastOpenedAt: now - 60_000,
      unread: false,
      pinned: false,
      archived: false,
    },
    timeline,
  });
  await invokePersistence(page, "saveSettings", {
    surface: "buddy",
    mode: "buddy",
    themeId: "white-copper",
    onboardingCompleted: true,
    relationshipInviteDismissed: true,
    relationshipConversationId: id,
    defaultProviderId: providerId,
    defaultModelId: "deepseek-v4-flash",
    continueInBackground: false,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("buddy-landing").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "继续上次聊天" }).click();
  await page.getByText(messages[0].text, { exact: true }).waitFor({ timeout: 15_000 });
  return screenshot(page, screenshotName, 1440, 900);
}

async function waitForPersistedRelationship(page, expectedId, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await invokePersistence(page, "loadAll", undefined);
    if (snapshot?.settings?.relationshipConversationId === expectedId) return snapshot;
    await page.waitForTimeout(150);
  }
  throw new Error(`新话题没有持久化为当前关系章节：${expectedId}`);
}

async function waitForChangedRelationship(page, previousId, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await invokePersistence(page, "loadAll", undefined);
    const currentId = snapshot?.settings?.relationshipConversationId;
    if (typeof currentId === "string" && currentId && currentId !== previousId) {
      return { snapshot, currentId };
    }
    await page.waitForTimeout(150);
  }
  throw new Error("新话题没有持久化为新的当前关系章节。");
}

async function waitForConversationSnapshot(page, conversationId, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await invokePersistence(page, "loadAll", undefined);
    const conversation = snapshot?.conversations?.find((entry) => entry.meta.id === conversationId);
    if (conversation && predicate(conversation, snapshot)) return { conversation, snapshot };
    await page.waitForTimeout(150);
  }
  throw new Error(`对话 ${conversationId} 没有在期限内达到持久化断言。`);
}

async function invokeMomoE2E(page, request) {
  return invokeBridge(page, "bridge:e2eMomo", request);
}

async function sendPrompt(page, prompt, expectedReply) {
  const composer = page.getByPlaceholder("输入消息…");
  await composer.fill(prompt);
  await composer.press("Enter");
  await page.getByText(expectedReply, { exact: true }).waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "停止", exact: true })
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => undefined);
}

prepareOutputDirectory();
insist(packagedExecutable || fs.existsSync(MAIN), "缺少 dist-electron/main.mjs，请先运行 npm run build:main。");

const upstreamRequests = [];
const mockState = {
  askToolAdvertised: false,
  askToolResultObserved: false,
  historyToolAdvertised: false,
  historyToolResultObserved: false,
};
const mockServer = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (request.method === "GET" && request.url === "/v1/models") {
      writeJson(response, 200, { data: [{ id: "deepseek-v4-flash", object: "model" }] });
      return;
    }
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      writeJson(response, 400, { error: { message: "invalid json" } });
      return;
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const serialized = JSON.stringify(messages);
    const last = messages.at(-1);
    const lastSerialized = JSON.stringify(last ?? {});
    const hasToolResult = last?.role === "tool"
      || lastSerialized.includes("tool_result")
      || lastSerialized.includes("tool_call_id");
    const toolNames = Array.isArray(body.tools)
      ? body.tools.map((tool) => tool?.function?.name ?? tool?.name).filter((name) => typeof name === "string")
      : [];
    const latest = [FIRST_TURN_MARKER, ASK_USER_MARKER, HISTORY_MARKER]
      .map((marker) => ({ marker, index: serialized.lastIndexOf(marker) }))
      .sort((left, right) => right.index - left.index)[0];
    const task = latest?.index >= 0 ? latest.marker : undefined;
    upstreamRequests.push({
      method: request.method,
      url: request.url,
      model: body.model,
      task,
      hasToolResult,
      toolCount: toolNames.length,
    });

    if (request.method !== "POST" || request.url !== "/v1/chat/completions" || body.stream !== true) {
      writeJson(response, 404, { error: { message: "not found" } });
      return;
    }
    const model = typeof body.model === "string" ? body.model : "deepseek-v4-flash";
    if (task === ASK_USER_MARKER) {
      const askTool = toolNames.find((name) => name === "mcp__leemo-ask-user__ask_user" || name.endsWith("__ask_user"));
      if (!hasToolResult) {
        insist(askTool, "loopback 请求没有暴露真实 ask-user 工具。");
        mockState.askToolAdvertised = true;
        writeToolCallStream(response, model, askTool, {
          questions: [{
            header: "继续方式",
            question: "先按哪个方向继续？",
            options: [
              { label: "先梳理现状", description: "把已知信息排清楚" },
              { label: "先列下一步", description: "直接形成行动清单" },
            ],
          }],
        }, "ask");
        return;
      }
      mockState.askToolResultObserved = serialized.includes("先梳理现状");
      writeSuccessStream(response, model, ASK_USER_REPLY);
      return;
    }
    if (task === HISTORY_MARKER) {
      const historyTool = toolNames.find((name) => name.endsWith("__search_relationship_history"));
      if (!hasToolResult) {
        insist(historyTool, "loopback 请求没有暴露真实 relationship-history MCP。");
        mockState.historyToolAdvertised = true;
        writeToolCallStream(response, model, historyTool, { query: HISTORY_PHRASE, limit: 3 }, "history");
        return;
      }
      mockState.historyToolResultObserved = serialized.includes(HISTORY_PHRASE)
        && serialized.includes("找到");
      writeSuccessStream(response, model, HISTORY_REPLY);
      return;
    }
    writeSuccessStream(response, model, task === FIRST_TURN_MARKER ? FIRST_TURN_REPLY : "MOMO_E2E_OK");
  });
});
await new Promise((resolve, reject) => {
  mockServer.once("error", reject);
  mockServer.listen(0, "127.0.0.1", resolve);
});
const mockAddress = mockServer.address();
insist(mockAddress && typeof mockAddress !== "string", "无法启动隔离模型端点。");
const mockBaseUrl = `http://127.0.0.1:${mockAddress.port}/v1`;

let child;
let connected;
let restarted;
const evidence = [];
let seeded;
try {
  fs.mkdirSync(path.dirname(draftAttachmentPath), { recursive: true });
  fs.writeFileSync(draftAttachmentPath, "# 隔离草稿引用\n", "utf8");
  child = launch();
  connected = await connect();
  seeded = await seed(connected.page, mockBaseUrl);
  await connected.browser.close();
  connected = undefined;
  await stopTree(child);
  child = undefined;

  child = launch();
  connected = await connect();
  const page = connected.page;
  const checks = {};
  await page.getByTestId("buddy-landing").waitFor({ timeout: 15_000 });
  insist(await page.getByText("最近脑子里事情有点多", { exact: false }).count() === 0, "欢迎首屏泄露了历史正文。");
  insist(upstreamRequests.length === 0, "普通进入搭子页触发了模型请求。");
  checks.welcomeNoModelCall = upstreamRequests.length === 0;
  await page.getByRole("button", { name: "上下文尚未读取" }).waitFor();
  evidence.push(await screenshot(page, "welcome-1440x900.png", 1440, 900));
  evidence.push(await screenshot(page, "welcome-1024x768.png", 1024, 768));

  await page.getByRole("button", { name: "继续上次聊天" }).click();
  await page.getByText("最近脑子里事情有点多", { exact: false }).waitFor();
  insist(upstreamRequests.length === 0, "展开历史触发了模型请求。");
  checks.historyNoModelCall = upstreamRequests.length === 0;
  evidence.push(await screenshot(page, "history-1440x900.png", 1440, 900));

  const estimatedScenario = await invokeMomoE2E(page, {
    operation: "sdk-scenario",
    scenario: "estimated",
    conversationId: "momo-history",
    providerId: seeded.providerId,
    modelId: "deepseek-v4-flash",
  });
  checks.normalizedEstimated = estimatedScenario.liveTokens?.[0] === 43_212
    && estimatedScenario.eventTypes?.includes("usage.final");
  insist(checks.normalizedEstimated, "estimated 场景没有经过真实 normalizeSdkStream。 ");
  const estimatedMeter = page.getByRole("button", { name: "上下文约已用 26%，整理前约剩 124K" });
  await estimatedMeter.waitFor();
  await estimatedMeter.hover();
  evidence.push(await screenshot(page, "estimated-context-1440x900.png", 1440, 900));

  const exactScenario = await invokeMomoE2E(page, {
    operation: "sdk-scenario",
    scenario: "exact",
    conversationId: "momo-history",
    providerId: seeded.providerId,
    modelId: "deepseek-v4-flash",
  });
  checks.normalizedExact = exactScenario.eventTypes?.length === 1
    && exactScenario.eventTypes[0] === "context.snapshot";
  insist(checks.normalizedExact, "exact snapshot 没有经过真实 normalizer。 ");
  const exactMeter = page.getByRole("button", { name: "上下文已用 9%，整理前剩 869K" });
  await exactMeter.waitFor();
  await exactMeter.hover();
  evidence.push(await screenshot(page, "exact-context-narrow-820x720.png", 820, 720));

  const persistedContext = await waitForConversationSnapshot(
    page,
    "momo-history",
    (conversation) => conversation.timeline.some((item) => item.kind === "context" && item.providerId === seeded.providerId),
  );
  const switchedMeta = {
    ...persistedContext.conversation.meta,
    providerId: seeded.secondProviderId,
    modelId: "deepseek-v4-flash",
    lastActivityAt: Date.now(),
  };
  await invokePersistence(page, "saveConversation", {
    meta: switchedMeta,
    timeline: persistedContext.conversation.timeline,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "继续上次聊天" }).click();
  const staleMeter = page.getByRole("button", { name: "上下文等待新模型更新" });
  await staleMeter.waitFor();
  checks.sameModelProviderStale = await staleMeter.isVisible();

  await invokeMomoE2E(page, {
    operation: "sdk-scenario",
    scenario: "exact",
    conversationId: "momo-history",
    providerId: seeded.secondProviderId,
    modelId: "deepseek-v4-flash",
  });
  const compactScenario = await invokeMomoE2E(page, {
    operation: "sdk-scenario",
    scenario: "compact-iterations",
    conversationId: "momo-history",
    providerId: seeded.secondProviderId,
    modelId: "deepseek-v4-flash",
  });
  checks.iterationsAndCompact = compactScenario.liveTokens?.[0] === 119_520
    && compactScenario.compactPostTokens?.[0] === 30_000
    && compactScenario.billing?.inputTokens === 20_000
    && compactScenario.billing?.cacheReadTokens === 200_000
    && compactScenario.billing?.contextInputTokens === undefined;
  insist(checks.iterationsAndCompact, "iterations/compact/billing 断言没有同时成立。");
  await page.getByRole("button", { name: /上下文已用 3%/ }).waitFor();
  await waitForConversationSnapshot(
    page,
    "momo-history",
    (conversation) => conversation.timeline.some((item) => item.kind === "compact" && item.postTokens === 30_000)
      && conversation.timeline.some((item) => item.kind === "usage" && item.usage.inputTokens === 20_000),
  );
  evidence.push(await screenshot(page, "compact-iterations-1440x900.png", 1440, 900));

  const composer = page.getByPlaceholder("输入消息…");
  await composer.fill("这个想法先留在输入框里 @待");
  await page.getByRole("listbox", { name: "引用工作区文件" }).waitFor();
  await page.getByRole("option", { name: /待整理想法\.md/ }).click();
  await page.getByRole("button", { name: "移除引用 待整理想法.md" }).waitFor();
  await page.getByRole("banner").getByRole("button", { name: "新话题" }).click();
  await page.getByTestId("buddy-topic-boundary").waitFor();
  evidence.push(await screenshot(page, "new-topic-boundary-1280x720.png", 1280, 720));
  insist((await composer.inputValue()).trim() === "这个想法先留在输入框里", "新话题切换丢失了输入草稿。");
  insist(upstreamRequests.length === 0, "新话题切换触发了模型请求。");
  checks.newTopicNoModelCall = upstreamRequests.length === 0;
  const { snapshot: firstPersisted, currentId: firstNewRelationshipId } = await waitForChangedRelationship(page, "momo-history");
  insist(
    firstPersisted.conversations.some((entry) => entry.meta.id === firstNewRelationshipId),
    "新话题章节没有写入本地持久化。",
  );
  await page.getByRole("button", { name: "撤销新话题" }).click();
  await page.getByTestId("buddy-topic-boundary").waitFor({ state: "detached" });
  const undoneSnapshot = await waitForPersistedRelationship(page, "momo-history");
  checks.newTopicUndoRestoredPriorChapter = !undoneSnapshot.conversations.some((entry) => entry.meta.id === firstNewRelationshipId)
    && (await composer.inputValue()).trim() === "这个想法先留在输入框里"
    && await page.getByRole("button", { name: "移除引用 待整理想法.md" }).isVisible()
    && await page.getByTestId("buddy-topic-boundary").count() === 0;
  insist(checks.newTopicUndoRestoredPriorChapter, "撤销新话题没有恢复上一章节、草稿或附件引用。");

  await page.getByRole("banner").getByRole("button", { name: "新话题" }).click();
  await page.getByTestId("buddy-topic-boundary").waitFor();
  const { snapshot: persisted, currentId: newRelationshipId } = await waitForChangedRelationship(page, "momo-history");
  const newTopicMeta = persisted.conversations.find((entry) => entry.meta.id === newRelationshipId)?.meta;
  checks.newTopicPreservedModel = newTopicMeta?.providerId === seeded.secondProviderId
    && newTopicMeta?.modelId === "deepseek-v4-flash";
  insist(checks.newTopicPreservedModel, "内部章节切换没有延续当前 provider/model 选择。");
  evidence.push(await screenshot(page, "new-topic-welcome-1440x900.png", 1440, 900));

  await connected.browser.close();
  connected = undefined;
  await stopTree(child);
  child = undefined;

  restarted = launch();
  connected = await connect();
  const restartedPage = connected.page;
  await restartedPage.getByTestId("buddy-landing").waitFor({ timeout: 15_000 });
  insist(upstreamRequests.length === 0, "重启进入当前章节触发了模型请求。");
  const restartedSnapshot = await waitForPersistedRelationship(restartedPage, newRelationshipId);
  const restartedComposer = restartedPage.getByPlaceholder("输入消息…");
  checks.restartRestoredDraft = (await restartedComposer.inputValue()).trim() === "这个想法先留在输入框里"
    && await restartedPage.getByRole("button", { name: "移除引用 待整理想法.md" }).isVisible();
  insist(checks.restartRestoredDraft, "重启没有恢复新章节的文本和安全附件引用。");
  checks.restartRestoredCurrentChapter = restartedSnapshot.settings.relationshipConversationId === newRelationshipId;
  insist(checks.restartRestoredCurrentChapter, "重启没有恢复当前关系章节。");
  checks.oldRelationshipHistoryRetained = restartedSnapshot.conversations.some((entry) => entry.meta.id === "momo-history"
    && entry.timeline.some((item) => item.kind === "text" && item.text.includes(HISTORY_PHRASE)));
  insist(checks.oldRelationshipHistoryRetained, "旧话题正文没有保留在关系历史中。");
  evidence.push(await screenshot(restartedPage, "restart-draft-1440x900.png", 1440, 900));

  await sendPrompt(restartedPage, `${FIRST_TURN_MARKER}：只回复验收标记。`, FIRST_TURN_REPLY);
  const firstTurn = await waitForConversationSnapshot(
    restartedPage,
    newRelationshipId,
    (conversation) => typeof conversation.meta.sessionId === "string"
      && conversation.timeline.some((item) => item.kind === "text" && item.text.includes(FIRST_TURN_MARKER))
      && conversation.timeline.some((item) => item.kind === "result" && item.isError === false),
    30_000,
  );
  checks.newTopicFirstTurnNewSession = firstTurn.conversation.meta.sessionId !== "seeded-old-session"
    && typeof firstTurn.conversation.meta.sessionId === "string";
  insist(checks.newTopicFirstTurnNewSession, "新章节首条发送没有建立独立 SDK session。");

  const askPrompt = `${ASK_USER_MARKER}：请用结构化问询让我选择继续方向。`;
  await restartedComposer.fill(askPrompt);
  await restartedComposer.press("Enter");
  await restartedPage.getByText("先按哪个方向继续？", { exact: true }).waitFor({ timeout: 45_000 });
  checks.askUserCardVisible = await restartedPage.locator('[data-component-role="ask-user"]').count() === 1
    && await restartedPage.getByText("正在使用第三方工具…", { exact: true }).count() === 0;
  insist(checks.askUserCardVisible, "真实 ask-user 没有形成唯一问询卡。");
  evidence.push(await screenshot(restartedPage, "ask-user-card-1280x720.png", 1280, 720));
  await restartedPage.getByRole("button", { name: /先梳理现状/ }).click();
  await restartedPage.getByRole("button", { name: "提交", exact: true }).click();
  await restartedPage.getByText(ASK_USER_REPLY, { exact: true }).waitFor({ timeout: 45_000 });
  await restartedPage.getByRole("button", { name: "停止", exact: true })
    .waitFor({ state: "hidden", timeout: 20_000 })
    .catch(() => undefined);
  checks.askUserResumed = mockState.askToolAdvertised && mockState.askToolResultObserved;
  insist(checks.askUserResumed, "ask-user 回答没有回到真实 MCP 工具结果。");

  await sendPrompt(
    restartedPage,
    `${HISTORY_MARKER}：请调用关系历史工具找回“${HISTORY_PHRASE}”。`,
    HISTORY_REPLY,
  );
  checks.relationshipHistoryMcpCalled = mockState.historyToolAdvertised && mockState.historyToolResultObserved;
  insist(checks.relationshipHistoryMcpCalled, "关系历史 MCP 没有读取到较早真实匹配。");

  const trayResult = await invokeMomoE2E(restartedPage, { operation: "tray-click" });
  checks.trayListenerRestoredWindow = trayResult.listenerCount > 0
    && trayResult.before?.visible === false
    && trayResult.after?.visible === true
    && trayResult.after?.focused === true;
  insist(checks.trayListenerRestoredWindow, "真实 Tray click listener 没有恢复并聚焦隐藏窗口。");

  await restartedPage.getByRole("button", { name: "切换到工作台" }).click();
  await restartedPage.locator('[data-shell="workbench"]').waitFor();
  await restartedPage.getByRole("button", { name: "切换到搭子" }).click();
  await restartedPage.locator('[data-shell="buddy"]').waitFor();
  checks.parentSurfaceSwitch = await restartedPage.locator('[data-shell="buddy"]').isVisible();

  const requestsBeforeReadmeShots = upstreamRequests.length;
  evidence.push(await captureReadmeScenario(restartedPage, {
    id: "readme-job-search",
    title: "把求职材料讲清楚",
    providerId: seeded.providerId,
    screenshotName: "readme-job-search-1440x900.png",
    messages: [
      { role: "user", text: "我把项目经历越改越像岗位说明书了，明明做过不少事，但不知道该先讲哪一段。" },
      { role: "momo", text: "先留一件你真正推动过的事。你当时遇到什么乱局，做了哪个判断，最后谁因此少走了弯路？" },
      { role: "user", text: "数据分析实习那段吧。需求一天一变，我后来做了个校验表，至少让大家知道数据能不能用。" },
      { role: "momo", text: "这段已经有故事了：变化很多的业务现场、你补上的判断机制、团队因此获得的确定性。接下来把一次具体冲突和结果写实。" },
    ],
  }));
  evidence.push(await captureReadmeScenario(restartedPage, {
    id: "readme-research",
    title: "把灵感变成研究问题",
    providerId: seeded.providerId,
    screenshotName: "readme-research-1440x900.png",
    messages: [
      { role: "user", text: "我最近老觉得 AI 帮人切换任务可能会把注意力越弄越碎，但这个想法太散了，不知道怎么变成能研究的问题。" },
      { role: "momo", text: "先抓一个可以观察的瞬间。你担心的变化发生在切换之前、刚切过去，还是过了一会儿才显出来？" },
      { role: "user", text: "比如任务 A 刚切到任务 B 后，人会不会更晚察觉自己其实没进入状态？" },
      { role: "momo", text: "这个已经能测了。可以记录切换后的首次有效操作、主观进入状态的时间，以及错误率，再比较有无 AI 提示时的差异。" },
    ],
  }));
  evidence.push(await captureReadmeScenario(restartedPage, {
    id: "readme-study",
    title: "把 p 值想明白",
    providerId: seeded.providerId,
    screenshotName: "readme-study-philosophy-1440x900.png",
    messages: [
      { role: "user", text: "p 值我会算，可一放回题里就又怕自己只是背了个结论。" },
      { role: "momo", text: "先看你最担心它帮你判断什么。是判断结果靠不靠谱，还是判断眼前证据和零假设有多不相容？" },
      { role: "user", text: "我其实想知道，算出一个很小的数，到底是在说明世界，还是只说明我手里的证据看起来有点反常？" },
      { role: "momo", text: "它描述的是后一件事：假设零假设成立，像你手里这样或更极端的数据有多少见。对世界的判断还要结合研究设计、效应大小和先验信息。" },
    ],
  }));
  evidence.push(await captureReadmeScenario(restartedPage, {
    id: "readme-heart",
    title: "先把感受说清楚",
    providerId: seeded.providerId,
    screenshotName: "readme-heart-to-heart-1440x900.png",
    messages: [
      { role: "user", text: "最近什么都想往前推，可越赶越像在原地打转，晚上又会怀疑是不是自己太慢。" },
      { role: "momo", text: "听起来很多事情同时在拉你。今晚先不用把全部解决，挑一件做完后能让你松一点的事，好吗？" },
      { role: "user", text: "那就先把明天要发的那份材料整理出来，其他的明天再说。" },
      { role: "momo", text: "好。你把现有内容给我，我们先整理成一个可以发出去的版本。" },
    ],
  }));
  checks.readmeScenariosNoModelCall = upstreamRequests.length === requestsBeforeReadmeShots;
  insist(checks.readmeScenariosNoModelCall, "README 场景截图触发了模型请求。");

  const dbPath = path.join(auditRoot, "user-data", "leemo.db");
  insist(fs.existsSync(dbPath), "隔离 SQLite 没有落盘。");
  checks.isolatedSqlite = fs.existsSync(dbPath);
  const requiredChecks = [
    "welcomeNoModelCall",
    "historyNoModelCall",
    "normalizedEstimated",
    "normalizedExact",
    "sameModelProviderStale",
    "iterationsAndCompact",
    "newTopicNoModelCall",
    "newTopicUndoRestoredPriorChapter",
    "newTopicPreservedModel",
    "restartRestoredDraft",
    "restartRestoredCurrentChapter",
    "oldRelationshipHistoryRetained",
    "newTopicFirstTurnNewSession",
    "askUserCardVisible",
    "askUserResumed",
    "relationshipHistoryMcpCalled",
    "trayListenerRestoredWindow",
    "parentSurfaceSwitch",
    "readmeScenariosNoModelCall",
    "isolatedSqlite",
  ];
  const pass = requiredChecks.every((key) => checks[key] === true);
  insist(pass, `验收缺项：${requiredChecks.filter((key) => checks[key] !== true).join(", ")}`);
  const facts = {
    pass,
    runtime: packagedExecutable ? "packaged" : "built-electron",
    dbPath,
    evidence,
    checks,
    upstreamModelRequests: upstreamRequests.length,
    requestLog: upstreamRequests,
  };
  fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...facts, dbPath: path.relative(ROOT, dbPath) }, null, 2));
} catch (error) {
  const failurePage = connected?.page;
  const pageText = failurePage ? await failurePage.locator("body").innerText().catch(() => "") : "";
  const snapshot = failurePage ? await invokePersistence(failurePage, "loadAll", undefined).catch(() => undefined) : undefined;
  fs.writeFileSync(path.join(outputDir, "failure-debug.json"), `${JSON.stringify({
    message: error instanceof Error ? error.message : String(error),
    mockState,
    upstreamRequests,
    pageText: pageText.slice(-8_000),
    activeConversation: snapshot?.conversations?.find((entry) => entry.meta.id === snapshot?.settings?.relationshipConversationId),
    hostLogTail: hostLogs.join("").slice(-12_000),
  }, null, 2)}\n`, "utf8");
  throw error;
} finally {
  if (connected) await connected.browser.close().catch(() => undefined);
  await stopTree(restarted ?? child).catch(() => undefined);
  await new Promise((resolve) => mockServer.close(resolve));
  const resolved = path.resolve(auditRoot);
  const expectedPrefix = `${tempParent}${path.sep}leemo-e2e-momo-relationship-`;
  if (resolved.startsWith(expectedPrefix)) fs.rmSync(resolved, { recursive: true, force: true });
}
