// Packaged r10 workspace + governed-memory acceptance.
// Drives only visible controls against an isolated Leemo.exe and a loopback
// OpenAI-compatible mock. No user profile, external API, or paid model is used.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const PACKAGED_EXE = path.resolve(
  process.env.LEEMO_PACKAGED_EXE || path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe"),
);
export const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
export const MODEL_ID = "mock-r10-memory";
export const PROVIDER_NAME = "本机记忆验收";
export const TEST_KEY = "leemo-r10-loopback-key-not-a-real-secret";
export const WORKSPACE_NOTEBOOK = "记忆验收";
export const WORKSPACE_FACT = "用户的猫叫拿铁，领养纪念日是 4 月 17 日";

export const PROMPTS = {
  globalArtifact: "R10_TASK_GLOBAL：请在当前无本子工作区新建 r10-global-artifact.md，内容是全局产物验收。完成后简短回复。",
  notebookArtifact: "R10_TASK_NOTEBOOK：请在当前本子新建 r10-notebook-artifact.md，内容是本子产物验收。完成后简短回复。",
  remember: `R10_TASK_REMEMBER：请长期记住：${WORKSPACE_FACT}。记好后简短回复。`,
  recallAfterUndo: "R10_TASK_UNDO_RECALL：请从长期记忆核对我的猫和领养纪念日；找不到就如实说找不到。",
  rememberDisabled: "R10_TASK_MEMORY_DISABLED：请长期记住用户最喜欢的临时编号是 SHOULD_NOT_PERSIST_7413。",
};

const FINAL = {
  globalArtifact: "R10_GLOBAL_ARTIFACT_OK",
  notebookArtifact: "R10_NOTEBOOK_ARTIFACT_OK",
  remember: "R10_MEMORY_SAVED_OK",
  recallAfterUndo: "R10_UNDO_RECALL_EMPTY",
  rememberDisabled: "R10_MEMORY_DISABLED_OK",
};

const GLOBAL_ARTIFACT_CONTENT = "# 全局产物验收\n\nR10_GLOBAL_ARTIFACT_CONTENT\n";
const NOTEBOOK_ARTIFACT_CONTENT = "# 本子产物验收\n\nR10_NOTEBOOK_ARTIFACT_CONTENT\n";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function validateAuditRoot(candidate, prefix) {
  const resolved = path.resolve(candidate);
  const tempRoot = fs.realpathSync(os.tmpdir());
  insist(path.dirname(resolved).toLowerCase() === tempRoot.toLowerCase(), `隔离目录不在系统临时目录一级：${resolved}`);
  insist(path.basename(resolved).startsWith(prefix), `隔离目录前缀错误：${resolved}`);
  return resolved;
}

function removeAuditRoot(candidate, prefix) {
  fs.rmSync(validateAuditRoot(candidate, prefix), { recursive: true, force: true });
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

function parseBody(chunks) {
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
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

function writeSuccess(response, model, text) {
  streamHeaders(response);
  const base = {
    id: "chatcmpl-leemo-r10-memory",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 16, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function writeToolCall(response, model, toolName, args, sequence) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-leemo-r10-tool-${sequence}`,
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
          id: `call_leemo_r10_${sequence}`,
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

function toolResultRequest(lastMessage) {
  const serialized = JSON.stringify(lastMessage ?? {});
  return lastMessage?.role === "tool" || serialized.includes("tool_call_id") || serialized.includes("tool_result");
}

function requiredTool(toolNames, expected) {
  const exact = toolNames.find((name) => name === expected);
  if (exact) return exact;
  if (expected === "Write") return toolNames.find((name) => /(?:^|__)write$/i.test(name));
  return undefined;
}

function routeStream(response, body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serialized = JSON.stringify(messages);
  const lastMessage = messages.at(-1);
  const lastSerialized = JSON.stringify(lastMessage ?? {});
  const toolNames = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
    : [];
  const model = typeof body.model === "string" ? body.model : MODEL_ID;
  const hasToolResult = toolResultRequest(lastMessage);
  const call = (expected, args) => {
    const toolName = requiredTool(toolNames, expected);
    if (!toolName) {
      writeJson(response, 400, { error: { message: `Required tool missing: ${expected}` } });
      return;
    }
    state.toolCalls.push({ expected, toolName, args });
    writeToolCall(response, model, toolName, args, state.toolCalls.length);
  };

  if (serialized.includes("R10_TASK_GLOBAL")) {
    if (!hasToolResult) call("Write", { file_path: "r10-global-artifact.md", content: GLOBAL_ARTIFACT_CONTENT });
    else writeSuccess(response, model, FINAL.globalArtifact);
    return;
  }
  if (serialized.includes("R10_TASK_NOTEBOOK")) {
    if (!hasToolResult) call("Write", { file_path: "r10-notebook-artifact.md", content: NOTEBOOK_ARTIFACT_CONTENT });
    else writeSuccess(response, model, FINAL.notebookArtifact);
    return;
  }
  if (serialized.includes("R10_TASK_REMEMBER")) {
    if (!hasToolResult) call("mcp__leemo-memory__remember", {
      topic: "宠物领养纪念日",
      statement: WORKSPACE_FACT,
      kind: "profile",
      scope: "global",
    });
    else writeSuccess(response, model, FINAL.remember);
    return;
  }
  if (serialized.includes("R10_TASK_UNDO_RECALL")) {
    if (!hasToolResult) call("mcp__leemo-memory__recall", { query: "猫 领养纪念日", scope: "global" });
    else writeSuccess(response, model, lastSerialized.includes("拿铁") ? "R10_UNDO_RECALL_LEAK" : FINAL.recallAfterUndo);
    return;
  }
  if (serialized.includes("R10_TASK_MEMORY_DISABLED")) {
    writeSuccess(response, model, FINAL.rememberDisabled);
    return;
  }
  if (serialized.includes("R10_RESTART_REMEMBER_OLD")) {
    if (!hasToolResult) call("mcp__leemo-memory__remember", {
      topic: "当前学习工作状态",
      statement: "用户目前在海城大学读书",
      kind: "state",
      scope: "global",
    });
    else writeSuccess(response, model, "R10_RESTART_OLD_SAVED");
    return;
  }
  if (serialized.includes("R10_RESTART_REMEMBER_NEW")) {
    if (!hasToolResult) call("mcp__leemo-memory__remember", {
      topic: "当前学习工作状态",
      statement: "用户已从海城大学毕业，目前在星河科技工作",
      kind: "state",
      scope: "global",
    });
    else writeSuccess(response, model, "R10_RESTART_NEW_SAVED");
    return;
  }
  if (serialized.includes("R10_RESTART_NOTEBOOK_A")) {
    if (!hasToolResult) call("mcp__leemo-memory__remember", {
      topic: "本子目标",
      statement: "春招本子的目标是完成三次模拟面试",
      kind: "notebook",
      scope: "notebook",
    });
    else writeSuccess(response, model, "R10_RESTART_NOTEBOOK_SAVED");
    return;
  }
  if (serialized.includes("R10_RESTART_RECALL_CURRENT")) {
    if (!hasToolResult) call("mcp__leemo-memory__recall", { query: "学习 工作 状态", scope: "global" });
    else writeSuccess(response, model, lastSerialized.includes("星河科技") && !lastSerialized.includes("目前在海城大学读书")
      ? "R10_RESTART_CURRENT_OK 星河科技"
      : "R10_RESTART_CURRENT_WRONG");
    return;
  }
  if (serialized.includes("R10_RESTART_GLOBAL_IN_NOTEBOOK")) {
    if (!hasToolResult) call("mcp__leemo-memory__recall", { query: "学习 工作 状态", scope: "global" });
    else writeSuccess(response, model, lastSerialized.includes("星河科技")
      ? "R10_RESTART_GLOBAL_OK 星河科技"
      : "R10_RESTART_GLOBAL_MISSING");
    return;
  }
  if (serialized.includes("R10_RESTART_NOTEBOOK_LEAK")) {
    if (!hasToolResult) call("mcp__leemo-memory__recall", { query: "本子目标 模拟面试", scope: "notebook" });
    else writeSuccess(response, model, lastSerialized.includes("三次模拟面试")
      ? "R10_RESTART_NOTEBOOK_LEAKED"
      : "R10_RESTART_NOTEBOOK_ISOLATED");
    return;
  }
  if (serialized.includes("R10_RESTART_ARTIFACT")) {
    if (!hasToolResult) call("Write", { file_path: "restart-research-note.md", content: "R10_RESTART_RESEARCH_ARTIFACT\n" });
    else writeSuccess(response, model, "R10_RESTART_ARTIFACT_OK");
    return;
  }
  writeSuccess(response, model, "R10_LOCAL_MOCK_OK");
}

function createMockServer(state, streamRouter = routeStream) {
  return http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "GET" && request.url === "/v1/models") {
        writeJson(response, 200, { data: [{ id: MODEL_ID, display_name: "R10 本机验收模型" }] });
        return;
      }
      const body = parseBody(chunks);
      state.requests.push({
        path: request.url,
        model: body.model,
        stream: body.stream === true,
        messages: body.messages,
        authorizationOk: request.headers.authorization === `Bearer ${TEST_KEY}`,
      });
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: { message: "not found" } });
        return;
      }
      if (request.headers.authorization !== `Bearer ${TEST_KEY}`) {
        writeJson(response, 401, { error: { message: "invalid local test key" } });
        return;
      }
      if (body.stream === true) streamRouter(response, body, state);
      else writeJson(response, 200, {
        id: "chatcmpl-leemo-r10-probe",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: body.model ?? MODEL_ID,
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      });
    });
  });
}

async function startMock(state, streamRouter) {
  const server = createMockServer(state, streamRouter);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "本机 mock 未绑定端口");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function connectRenderer(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      lastTargets = targets;
      if (targets.some((target) => target.type === "page" && !target.url.startsWith("devtools://"))) break;
    } catch {
      // Electron is still starting.
    }
    await sleep(150);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pageDeadline = Date.now() + 10_000;
  let page;
  while (!page && Date.now() < pageDeadline) {
    page = browser.contexts().flatMap((context) => context.pages())[0];
    if (!page) await sleep(50);
  }
  insist(
    page,
    `打包应用没有 renderer page（targets=${lastTargets.map((target) => `${target.type}:${target.url}`).join(",")} contexts=${browser.contexts().length}）`,
  );
  const rendererErrors = [];
  page.on("pageerror", (error) => rendererErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push(`console.error: ${message.text()}`);
  });
  await page.locator('textarea[aria-label="输入消息"]').waitFor({ state: "attached", timeout: 60_000 });
  return { browser, page, rendererErrors };
}

async function launchApp(auditRoot, label, extraArgs = []) {
  const port = await freePort();
  const logs = [];
  const startedAt = Date.now();
  const child = spawn(PACKAGED_EXE, [
    `--remote-debugging-port=${port}`,
    `--leemo-e2e-root=${auditRoot}`,
    ...extraArgs,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
  ], {
    cwd: auditRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  try {
    const { browser, page, rendererErrors } = await connectRenderer(port);
    const workspaceRoot = await page.evaluate(async () => {
      const response = await window.leemoWorkspace.invoke("listNotebooks", undefined);
      if (!response.ok) throw new Error(response.error || "listNotebooks failed");
      return response.response.root;
    });
    return { child, browser, page, rendererErrors, logs, port, workspaceRoot, label, startupMs: Date.now() - startedAt };
  } catch (error) {
    if (child.exitCode === null && child.pid) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        // The process may already have exited while CDP was attaching.
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const logTail = logs.join("").trim().slice(-4_000);
    throw new Error(logTail ? `${message}\npackaged host log:\n${logTail}` : message, { cause: error });
  }
}

async function stopApp(instance) {
  if (!instance) return;
  await instance.page.close({ runBeforeUnload: true }).catch(() => {});
  await Promise.race([
    new Promise((resolve) => instance.child.once("exit", resolve)),
    sleep(6_000),
  ]);
  if (instance.child.exitCode === null && instance.child.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(instance.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // Graceful close can race taskkill.
    }
  }
  await instance.browser.close().catch(() => {});
}

export async function skipOnboarding(page) {
  const later = page.getByRole("button", { name: "稍后配置", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click();
}

export async function openSettingsTab(page, label) {
  if (!await page.getByTestId("settings-window").isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  const search = page.getByRole("searchbox", { name: "搜索设置" });
  if (await search.inputValue()) await search.fill("");
  await page.getByRole("tab", { name: label, exact: true }).click();
}

export async function configureLoopbackProvider(page, baseUrl) {
  await openSettingsTab(page, "模型");
  const add = page.getByRole("button", { name: "添加模型服务商" });
  if (await add.isVisible().catch(() => false)) await add.click();
  await page.getByRole("button", { name: "配置 自定义服务" }).click();
  const form = page.getByTestId("provider-config-form");
  await form.waitFor({ state: "visible" });
  await form.getByLabel("名称").fill(PROVIDER_NAME);
  await form.getByRole("button", { name: "OpenAI 兼容", exact: true }).click();
  await form.getByLabel("Base URL").fill(baseUrl);
  await form.locator('input[aria-label="API Key"]').fill(TEST_KEY);
  const advanced = form.locator("summary", { hasText: "高级设置" });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await form.getByLabel("手敲模型名").fill(MODEL_ID);
  await form.getByRole("button", { name: "添加模型", exact: true }).click();
  await form.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByText("凭据已安全保存", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}

export async function ensureWorkbench(page) {
  if (await page.getByTestId("workbench-shell").isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.getByTestId("workbench-shell").waitFor({ state: "visible" });
}

export async function createNotebook(page, title) {
  await page.getByRole("button", { name: /^选择本子，当前 / }).click();
  await page.getByRole("menuitem", { name: "新建本子", exact: true }).click();
  const input = page.getByLabel("新本子名称");
  await input.fill(title);
  await page.getByRole("button", { name: "创建本子", exact: true }).click();
  const trigger = page.getByRole("button", { name: `选择本子，当前 ${title}` });
  await trigger.waitFor({ state: "visible" });
  return trigger;
}

export async function selectNotebook(page, title) {
  const current = page.getByRole("button", { name: /^选择本子，当前 / });
  const currentLabel = await current.getAttribute("aria-label");
  const expected = title ? `选择本子，当前 ${title}` : "选择本子，当前 Leemo 工作台";
  if (currentLabel === expected) return;
  await current.click();
  const target = title
    ? page.getByRole("menuitem", { name: `打开本子 ${title}` })
    : page.getByRole("menuitem", { name: "回到 Leemo 工作台" });
  await target.click();
  await page.getByRole("button", { name: expected }).waitFor({ state: "visible" });
}

export async function newConversation(page) {
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await page.getByTestId("current-conversation-status").filter({ hasText: "待开始" }).waitFor({ state: "visible" });
}

export async function runVisiblePrompt(page, prompt, finalMarker, timeoutMs = 90_000) {
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const approvals = page.getByRole("button", { name: "允许一次", exact: true });
    for (let index = 0; index < await approvals.count(); index += 1) {
      const candidate = approvals.nth(index);
      if (await candidate.isVisible().catch(() => false)) await candidate.click();
    }
    if (await page.getByText(finalMarker, { exact: false }).last().isVisible().catch(() => false)) {
      await page.getByTestId("current-conversation-status").filter({ hasText: "已完成" }).waitFor({ state: "visible" });
      return;
    }
    if (await page.getByText("任务没有完成", { exact: true }).isVisible().catch(() => false)) {
      throw new Error(`用户路径失败：${(await page.locator("body").innerText()).slice(-1_500)}`);
    }
    await sleep(150);
  }
  throw new Error(`等待用户路径结果超时：${finalMarker}`);
}

export async function listMemory(page, scopes, includeInactive = false) {
  return page.evaluate(async ({ selectedScopes, inactive }) => {
    const response = await window.leemoBridge.invoke("bridge:listMemory", {
      scopes: selectedScopes,
      ...(inactive ? { includeInactive: true } : {}),
    });
    if (!response.ok) throw new Error(response.error || "listMemory failed");
    return response.response;
  }, { selectedScopes: scopes, inactive: includeInactive });
}

export async function setRememberMode(page, enabled) {
  await openSettingsTab(page, "个性化");
  const toggle = page.getByRole("checkbox", { name: "启用自动记忆" });
  if ((await toggle.isChecked()) !== enabled) {
    // The input is intentionally visually hidden; users click its visible
    // label shell. Drive that same surface instead of force-clicking internals.
    await toggle.locator("..").click();
    insist((await toggle.isChecked()) === enabled, "自动记忆开关没有切换到预期状态");
  }
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}

export function scopeFiles(workspaceRoot, scope) {
  const directory = scope.type === "global"
    ? path.join(workspaceRoot, ".leemo", "memory", "global")
    : path.join(workspaceRoot, scope.notebookId, ".leemo", "memory");
  return fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
    : [];
}

async function setAuditViewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(80);
  const actual = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  insist(actual.width === width && actual.height === height, `视口设置失败：${actual.width}x${actual.height}`);
  return actual;
}

async function layoutFacts(page, targetSelector) {
  return page.evaluate((selector) => {
    const target = document.querySelector(selector);
    const textarea = document.querySelector('textarea[aria-label="输入消息"]');
    const conversationColumn = document.querySelector('[data-testid="conversation-column"]');
    const targetRect = target?.getBoundingClientRect();
    const textareaRect = textarea?.getBoundingClientRect();
    const conversationRect = conversationColumn?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentHorizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      targetHorizontalOverflow: target instanceof HTMLElement
        ? Math.max(0, target.scrollWidth - target.clientWidth)
        : null,
      targetInsideViewport: targetRect
        ? targetRect.left >= -1 && targetRect.right <= window.innerWidth + 1
        : null,
      composerInsideViewport: textareaRect
        ? textareaRect.left >= -1
          && textareaRect.right <= window.innerWidth + 1
          && textareaRect.top >= -1
          && textareaRect.bottom <= window.innerHeight + 1
        : null,
      conversationColumnWidth: conversationRect?.width ?? null,
    };
  }, targetSelector);
}

function insistLayout(facts, label, { composer = false, minimumConversationWidth = null } = {}) {
  insist(facts.documentHorizontalOverflow === 0, `${label} 文档横向溢出 ${facts.documentHorizontalOverflow}px`);
  if (facts.targetHorizontalOverflow !== null) {
    insist(facts.targetHorizontalOverflow <= 1, `${label} 主容器横向溢出 ${facts.targetHorizontalOverflow}px`);
  }
  if (facts.targetInsideViewport !== null) insist(facts.targetInsideViewport, `${label} 主容器越出视口`);
  if (composer) insist(facts.composerInsideViewport === true, `${label} 输入框没有完整展示`);
  if (minimumConversationWidth !== null) {
    insist(
      facts.conversationColumnWidth !== null && facts.conversationColumnWidth >= minimumConversationWidth,
      `${label} 对话区过窄：${facts.conversationColumnWidth ?? "不存在"}px`,
    );
  }
}

async function captureMemoryVisualStates(page) {
  const paths = {
    history: path.join(OUTPUT_DIR, "r10-memory-history-1440x900.png"),
    editor: path.join(OUTPUT_DIR, "r10-memory-editor-720x640.png"),
    receipt: path.join(OUTPUT_DIR, "r10-memory-receipt-720x640.png"),
  };

  await setAuditViewport(page, 1440, 900);
  await openSettingsTab(page, "个性化");
  await page.getByText(WORKSPACE_FACT, { exact: true }).waitFor({ state: "visible" });
  const historyButton = page.getByRole("button", { name: /查看记忆历史：/ }).first();
  await historyButton.click();
  await page.waitForTimeout(80);
  const historyLayout = await layoutFacts(page, '[data-testid="settings-window"]');
  insistLayout(historyLayout, "1440x900 记忆历史");
  await page.screenshot({ path: paths.history, animations: "disabled" });

  await historyButton.click();
  await setAuditViewport(page, 720, 640);
  await page.getByRole("button", { name: /编辑记忆：/ }).first().click();
  const editor = page.getByRole("textbox", { name: "编辑记忆内容" });
  await editor.fill(`${WORKSPACE_FACT} SUPERCALIFRAGILISTICEXPIALIDOCIOUS0123456789`);
  const editorLayout = await layoutFacts(page, '[data-testid="settings-window"]');
  insistLayout(editorLayout, "720x640 记忆编辑");
  await page.screenshot({ path: paths.editor, animations: "disabled" });
  await page.getByRole("button", { name: "取消记忆修改" }).click();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();

  const receiptLayout = await layoutFacts(page, "main");
  insistLayout(receiptLayout, "720x640 记忆回执", { composer: true, minimumConversationWidth: 320 });
  await page.screenshot({ path: paths.receipt, animations: "disabled" });
  await setAuditViewport(page, 1440, 900);

  return {
    screenshots: Object.fromEntries(Object.entries(paths).map(([key, value]) => [
      key,
      path.relative(ROOT, value).replaceAll(path.sep, "/"),
    ])),
    historyLayout,
    editorLayout,
    receiptLayout,
  };
}

async function captureEmptyMemoryState(page) {
  const screenshotPath = path.join(OUTPUT_DIR, "r10-memory-empty-720x640.png");
  await setAuditViewport(page, 720, 640);
  await openSettingsTab(page, "个性化");
  await page.waitForTimeout(400);
  const settingsText = await page.getByTestId("settings-window").innerText();
  insist(settingsText.includes("momo 还没有需要长期记住的内容"), `撤销后的设置页不是空态：${settingsText.slice(-1_500)}`);
  const layout = await layoutFacts(page, '[data-testid="settings-window"]');
  insistLayout(layout, "720x640 记忆空态");
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await setAuditViewport(page, 1440, 900);
  return {
    screenshot: path.relative(ROOT, screenshotPath).replaceAll(path.sep, "/"),
    layout,
  };
}

export async function createMemoryAcceptanceHarness({
  prefix = "leemo-e2e-r10-memory-",
  seedWorkspace,
  streamRouter,
  launchArgs,
} = {}) {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  insist(fs.existsSync(PACKAGED_EXE), `找不到打包应用：${PACKAGED_EXE}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const auditRoot = validateAuditRoot(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), prefix);
  const workspaceRoot = path.join(auditRoot, "home", "Leemo");
  if (seedWorkspace) {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    await seedWorkspace(workspaceRoot);
  }
  const state = { requests: [], toolCalls: [] };
  const mock = await startMock(state, streamRouter);
  const resolvedLaunchArgs = (label) => typeof launchArgs === "function"
    ? launchArgs(auditRoot, label)
    : launchArgs ?? [];
  let current;
  return {
    auditRoot,
    workspaceRoot,
    state,
    baseUrl: mock.baseUrl,
    get current() { return current; },
    async start(label = "首次启动") {
      current = await launchApp(auditRoot, label, resolvedLaunchArgs(label));
      insist(path.resolve(current.workspaceRoot) === path.resolve(workspaceRoot), `工作区未隔离：${current.workspaceRoot}`);
      await skipOnboarding(current.page);
      return current;
    },
    async restart(label = "重启验收") {
      await stopApp(current);
      current = await launchApp(auditRoot, label, resolvedLaunchArgs(label));
      insist(path.resolve(current.workspaceRoot) === path.resolve(workspaceRoot), `重启后工作区未隔离：${current.workspaceRoot}`);
      await skipOnboarding(current.page);
      return current;
    },
    async stop() {
      await stopApp(current);
      current = undefined;
    },
    async close() {
      await stopApp(current).catch(() => {});
      await closeServer(mock.server).catch(() => {});
      if (process.env.LEEMO_KEEP_AUDIT !== "1") removeAuditRoot(auditRoot, prefix);
    },
  };
}

export async function runWorkspaceAcceptance() {
  const factsPath = path.join(OUTPUT_DIR, "r10-memory-workspace-facts.json");
  const screenshotPath = path.join(OUTPUT_DIR, "r10-memory-workspace.png");
  const harness = await createMemoryAcceptanceHarness();
  try {
    const app = await harness.start();
    const { page } = app;
    await configureLoopbackProvider(page, harness.baseUrl);
    await ensureWorkbench(page);
    await createNotebook(page, WORKSPACE_NOTEBOOK);

    await selectNotebook(page, null);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.globalArtifact, FINAL.globalArtifact);
    const globalArtifact = path.join(harness.workspaceRoot, "默认工作区", "r10-global-artifact.md");
    insist(fs.readFileSync(globalArtifact, "utf8") === GLOBAL_ARTIFACT_CONTENT, "无本子产物没有进入默认工作区");
    insist(!fs.existsSync(path.join(harness.workspaceRoot, "r10-global-artifact.md")), "无本子产物错误落在工作区根目录");

    await selectNotebook(page, WORKSPACE_NOTEBOOK);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.notebookArtifact, FINAL.notebookArtifact);
    const notebookArtifact = path.join(harness.workspaceRoot, WORKSPACE_NOTEBOOK, "r10-notebook-artifact.md");
    insist(fs.readFileSync(notebookArtifact, "utf8") === NOTEBOOK_ARTIFACT_CONTENT, "本子产物没有留在当前本子");

    await selectNotebook(page, null);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.remember, FINAL.remember);
    const receipt = page.locator("[data-memory-receipt]").last();
    await receipt.waitFor({ state: "visible" });
    insist((await receipt.innerText()).includes("拿铁"), "显式记住后没有轻量回执");
    const visualStates = await captureMemoryVisualStates(page);
    const beforeUndo = await listMemory(page, [{ type: "global" }]);
    insist(beforeUndo.some((record) => record.statement === WORKSPACE_FACT), "显式记住没有进入治理账本");
    await receipt.getByRole("button", { name: "撤销这条记忆" }).click();
    await receipt.getByText("已撤销", { exact: true }).waitFor({ state: "visible" });
    const afterUndo = await listMemory(page, [{ type: "global" }]);
    insist(!afterUndo.some((record) => record.statement === WORKSPACE_FACT), "撤销后记忆仍为当前有效");
    const emptyState = await captureEmptyMemoryState(page);

    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.recallAfterUndo, FINAL.recallAfterUndo);
    await setRememberMode(page, false);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.rememberDisabled, FINAL.rememberDisabled);
    const afterDisabled = await listMemory(page, [{ type: "global" }], true);
    insist(!afterDisabled.some((record) => record.statement?.includes("SHOULD_NOT_PERSIST_7413")), "关闭自动记忆后仍写入新条目");

    const scopeRuntimeFiles = scopeFiles(harness.workspaceRoot, { type: "global" });
    insist(JSON.stringify(scopeRuntimeFiles) === JSON.stringify(["MEMORY.md", "ledger.jsonl"]), `全局记忆运行文件失控：${scopeRuntimeFiles.join(",")}`);
    const workspaceText = fs.readFileSync(path.join(harness.workspaceRoot, ".leemo", "memory", "global", "ledger.jsonl"), "utf8");
    insist(!workspaceText.includes(TEST_KEY), "记忆账本含测试 API Key");
    const ordinaryRequests = harness.state.requests.filter((request) => JSON.stringify(request.messages).includes("R10_TASK_GLOBAL"));
    insist(!JSON.stringify(ordinaryRequests).includes("ledger.jsonl"), "普通产物 prompt 泄露记忆账本元数据");
    insist(!JSON.stringify(ordinaryRequests).includes("sourceMessageId"), "普通产物 prompt 泄露记忆来源元数据");
    insist(harness.state.requests.every((request) => request.authorizationOk), "本机请求缺少隔离测试鉴权");
    insist(app.rendererErrors.length === 0, `renderer 控制台出现错误：${app.rendererErrors.join(" | ")}`);

    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    const facts = {
      checkedAt: new Date().toISOString(),
      isolatedRoot: harness.auditRoot,
      externalApiCalls: 0,
      defaultWorkspaceArtifact: path.relative(harness.workspaceRoot, globalArtifact),
      notebookArtifact: path.relative(harness.workspaceRoot, notebookArtifact),
      receiptVisible: true,
      visualStates,
      emptyState,
      undoRemovedCurrentMemory: true,
      freshConversationRecallAfterUndo: "empty",
      rememberModeOffPreventedWrite: true,
      scopeRuntimeFiles,
      ordinaryPromptContainsLedgerMetadata: false,
      rendererConsoleErrors: app.rendererErrors.length,
      screenshot: path.relative(ROOT, screenshotPath).replaceAll(path.sep, "/"),
      mockRequests: harness.state.requests.length,
      toolCalls: harness.state.toolCalls.map(({ expected, toolName }) => ({ expected, toolName })),
    };
    fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(facts, null, 2));
    return facts;
  } catch (error) {
    const logs = harness.current?.logs?.join("")?.trim();
    if (logs) console.error(`[r10-memory-workspace] packaged host log:\n${logs.slice(-8_000)}`);
    throw error;
  } finally {
    await harness.close();
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) await runWorkspaceAcceptance();
