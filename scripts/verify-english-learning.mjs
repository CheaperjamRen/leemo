// Real Electron acceptance for the English-learning P0 path. This uses an
// isolated home/userData plus a loopback model and never reads user data or
// reaches an external model API.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";
import {
  MODEL_ID,
  PROVIDER_NAME,
  TEST_KEY,
  configureLoopbackProvider,
  openSettingsTab,
} from "./verify-memory-workspace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_PORT = Number(process.env.LEEMO_ENGLISH_VITE_PORT ?? 5198);
const CDP_PORT = Number(process.env.LEEMO_ENGLISH_CDP_PORT ?? 9343);
const RENDERER_URL = `http://127.0.0.1:${VITE_PORT}`;
const E2E_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-e2e-english-verify-"));
const children = new Set();
const FINAL_MARKER = "LEEMO_ENGLISH_BASELINE_OK";
const TODAY_MARKER = "LEEMO_ENGLISH_TODAY_OK";
const LONG_GOAL = `读懂英文论文并准确复述${"A".repeat(210)}`;
const LONG_CUE = `Explain-${"B".repeat(760)}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function insist(value, message) {
  if (!value) throw new Error(message);
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

function writeSuccess(response, text) {
  streamHeaders(response);
  const base = {
    id: "chatcmpl-leemo-english",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model: MODEL_ID,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 18, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function writeToolCall(response, toolName, args, sequence) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-leemo-english-tool-${sequence}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model: MODEL_ID,
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
          id: `call_leemo_english_${sequence}`,
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

function createMockServer(state) {
  return http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "GET" && request.url === "/v1/models") {
        writeJson(response, 200, { data: [{ id: MODEL_ID, display_name: "英语学习本机验收" }] });
        return;
      }
      const body = parseBody(chunks);
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        writeJson(response, 404, { error: { message: "not found" } });
        return;
      }
      if (request.headers.authorization !== `Bearer ${TEST_KEY}`) {
        writeJson(response, 401, { error: { message: "invalid local test key" } });
        return;
      }
      if (body.stream !== true) {
        writeJson(response, 200, {
          id: "chatcmpl-leemo-english-probe",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1_000),
          model: MODEL_ID,
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 1 },
        });
        return;
      }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      const serialized = JSON.stringify(messages);
      const toolNames = Array.isArray(body.tools)
        ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
        : [];
      state.requests += 1;
      state.lastToolNames = toolNames;
      state.lastMessage = JSON.stringify(messages.at(-1) ?? {}).slice(-2_000);
      const isBaseline = serialized.includes("开始一次英语基线诊断");
      const isToday = serialized.includes("开始今天的英语练习");
      if (!isBaseline && !isToday) {
        writeSuccess(response, "LEEMO_ENGLISH_LOCAL_OK");
        return;
      }

      const call = (expected, args, markCalled) => {
        const toolName = toolNames.find((name) => name === expected);
        if (!toolName) {
          writeJson(response, 400, { error: { message: `Required tool missing: ${expected}` } });
          return;
        }
        state.toolCalls.push(expected);
        markCalled();
        writeToolCall(response, toolName, args, state.toolCalls.length);
      };
      if (isToday) {
        if (!state.dailyPlanRead) {
          call("mcp__leemo-learning__get_plan", {}, () => { state.dailyPlanRead = true; });
          return;
        }
        if (!serialized.includes("paper-reading-baseline-v1")) {
          writeJson(response, 400, { error: { message: "New practice conversation did not receive the reusable baseline identity" } });
          return;
        }
        state.dailyPlanHadBaseline = true;
        if (!state.dailyCheckCalled) {
          call("mcp__leemo-learning__record_session", {
            kind: "check",
            skill: "reading",
            assessmentKey: "paper-reading-baseline-v1",
            correct: 4,
            total: 5,
            summary: "同型复测：能独立识别论文摘要中的主张与证据。",
          }, () => { state.dailyCheckCalled = true; });
          return;
        }
        writeSuccess(response, TODAY_MARKER);
        return;
      }

      if (!state.baselineMistakeCalled) {
        call("mcp__leemo-learning__record_mistake", {
          skill: "reading",
          cue: LONG_CUE,
          correction: "Identify the claim, evidence, and limitation.",
          explanation: "用于验证长题面与后续复习队列。",
        }, () => { state.baselineMistakeCalled = true; });
        return;
      }
      if (!state.baselineRecorded) {
        call("mcp__leemo-learning__record_session", {
          kind: "baseline",
          skill: "reading",
          assessmentKey: "paper-reading-baseline-v1",
          correct: 2,
          total: 5,
          summary: "论文阅读基线已完成。",
        }, () => { state.baselineRecorded = true; });
        return;
      }
      writeSuccess(response, FINAL_MARKER);
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
  insist(address && typeof address !== "string", "本机模型没有绑定端口");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await sleep(250);
  }
  throw new Error(`等待 ${url} 超时`);
}

async function startVite() {
  const server = await createViteServer({
    root: ROOT,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: VITE_PORT,
      strictPort: true,
    },
  });
  await server.listen();
  return server;
}

function startElectron() {
  const child = spawn(electronPath, [
    `--remote-debugging-port=${CDP_PORT}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    path.join(ROOT, "dist-electron", "main.mjs"),
    `--leemo-e2e-root=${E2E_ROOT}`,
  ], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, LEEMO_RENDERER_URL: RENDERER_URL },
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function forceTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

async function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  const graceful = await Promise.race([exited.then(() => true), sleep(8_000).then(() => false)]);
  if (!graceful) {
    forceTree(child);
    await Promise.race([exited, sleep(3_000)]);
  }
}

async function connectElectron() {
  const endpoint = `http://127.0.0.1:${CDP_PORT}`;
  await waitForUrl(`${endpoint}/json/version`);
  const browser = await chromium.connectOverCDP(endpoint);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(RENDERER_URL));
    if (page) {
      await page.waitForFunction(() => typeof window.leemoLearning?.invoke === "function");
      return { browser, page };
    }
    await sleep(200);
  }
  await browser.close();
  throw new Error("Electron renderer 没有出现");
}

async function dismissFreshOnboarding(page) {
  const onboarding = page.getByRole("dialog", { name: "首次设置" });
  await onboarding.waitFor({ state: "visible" });
  await onboarding.getByRole("button", { name: "稍后配置", exact: true }).click();
  await onboarding.waitFor({ state: "hidden" });
}

async function openEnglishPage(page) {
  const workbench = page.getByRole("button", { name: "工作台", exact: true });
  if ((await workbench.getAttribute("aria-pressed")) !== "true") await workbench.click();
  await page.getByRole("button", { name: "英语学习", exact: true }).click();
  await page.getByRole("heading", { name: "英语学习", exact: true }).waitFor();
}

async function makeProviderDefault(page) {
  await openSettingsTab(page, "模型");
  const row = page.getByTestId("provider-list-row").filter({ hasText: PROVIDER_NAME });
  await row.waitFor({ state: "visible" });
  const defaultBadge = row.getByText("默认", { exact: true });
  if (!await defaultBadge.isVisible().catch(() => false)) {
    const button = row.getByRole("button", { name: `设为默认 ${PROVIDER_NAME}`, exact: true });
    const deadline = Date.now() + 10_000;
    while (!await button.isEnabled().catch(() => false) && Date.now() < deadline) await sleep(100);
    insist(await button.isEnabled().catch(() => false), "本机验收 Provider 无法设为默认");
    await button.click();
    await defaultBadge.waitFor({ state: "visible" });
  }
  await sleep(300);
  const defaults = await page.evaluate(async ({ providerName, modelId }) => {
    const [providers, persisted] = await Promise.all([
      window.leemoBridge.invoke("bridge:listProviders", {}),
      window.leemoPersist.invoke("loadAll", {}),
    ]);
    const provider = providers.response?.find?.((item) => item.name === providerName);
    return {
      providerId: provider?.id,
      modelPresent: provider?.models?.includes?.(modelId) === true,
      defaultProviderId: persisted.response?.settings?.defaultProviderId,
      defaultModelId: persisted.response?.settings?.defaultModelId,
      providerOrder: persisted.response?.settings?.providerOrder,
    };
  }, { providerName: PROVIDER_NAME, modelId: MODEL_ID });
  insist(defaults.providerId && defaults.modelPresent, `本机验收 Provider 没有出现在运行时：${JSON.stringify(defaults)}`);
  insist(defaults.defaultProviderId === defaults.providerId && defaults.defaultModelId === MODEL_ID,
    `默认模型没有持久化：${JSON.stringify(defaults)}`);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  return defaults;
}

async function layoutFacts(page, width, height) {
  await page.setViewportSize({ width, height });
  return page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    headingVisible: Boolean(document.querySelector("h1")),
    primaryVisible: Array.from(document.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("完成基线诊断") || button.textContent?.includes("开始今日练习")),
  }));
}

async function waitForConversationMarker(page, marker, label, mockState) {
  try {
    await Promise.race([
      page.getByText(marker, { exact: false }).last().waitFor({ timeout: 60_000 }),
      page.getByRole("alert").filter({ hasText: /还没有配置 API Key|任务没有完成/ }).waitFor({ timeout: 60_000 })
        .then(async () => { throw new Error(await page.getByRole("alert").last().innerText()); }),
    ]);
  } catch (error) {
    const visibleTail = (await page.locator("body").innerText()).slice(-3_000);
    throw new Error(`${label}没有完成。mock=${JSON.stringify(mockState)}\n页面尾部：\n${visibleTail}`, { cause: error });
  }
}

async function main() {
  let vite;
  let electron;
  let connection;
  let mock;
  const mockState = {
    requests: 0,
    toolCalls: [],
    lastToolNames: [],
    lastMessage: "",
    baselineMistakeCalled: false,
    baselineRecorded: false,
    dailyPlanRead: false,
    dailyPlanHadBaseline: false,
    dailyCheckCalled: false,
  };
  try {
    await import("./build-main.mjs");
    vite = await startVite();
    await waitForUrl(RENDERER_URL);
    mock = await startMockServer(mockState);

    electron = startElectron();
    connection = await connectElectron();
    const initial = await connection.page.evaluate(async () => window.leemoLearning.invoke("snapshot", {}));
    insist(initial.ok && initial.response?.profile === null, "隔离环境不应已有英语画像");
    await dismissFreshOnboarding(connection.page);
    await configureLoopbackProvider(connection.page, mock.baseUrl);
    const defaults = await makeProviderDefault(connection.page);
    await openEnglishPage(connection.page);
    await connection.page.getByLabel("学习目标").fill(LONG_GOAL);
    await connection.page.getByRole("button", { name: "论文阅读", exact: true }).click();
    await connection.page.getByLabel("每天").selectOption("20");
    await connection.page.getByRole("button", { name: "开始诊断", exact: true }).click();
    await waitForConversationMarker(connection.page, FINAL_MARKER, "英语诊断", mockState);
    insist(!await connection.page.getByRole("button", { name: "允许一次", exact: true }).isVisible().catch(() => false), "内置学习工具错误弹出了权限申请");

    await openEnglishPage(connection.page);
    await connection.page.getByText(LONG_GOAL, { exact: true }).waitFor();
    await connection.page.getByText(LONG_CUE, { exact: true }).waitFor();
    await connection.page.getByRole("button", { name: "开始今日练习", exact: true }).waitFor();
    const completed = await connection.page.evaluate(async () => window.leemoLearning.invoke("snapshot", {}));
    insist(completed.ok, `诊断后读取失败：${completed.error ?? "unknown"}`);
    insist(completed.response?.profile?.focus === "academic", "可见表单没有保存论文阅读重点");
    insist(completed.response?.summary?.hasBaseline === true, "学习工具没有写入基线");
    insist(completed.response?.summary?.totalItems === 1, "学习工具没有写入复习项");
    insist(completed.response?.recentSessions?.[0]?.assessmentKey === "paper-reading-baseline-v1", "基线缺少稳定测评标识");
    insist(completed.response?.baselines?.[0]?.assessmentKey === "paper-reading-baseline-v1", "新对话无法读取可复测基线身份");

    await connection.page.getByRole("button", { name: "开始今日练习", exact: true }).click();
    await waitForConversationMarker(connection.page, TODAY_MARKER, "今日英语练习", mockState);
    insist(mockState.dailyPlanRead && mockState.dailyPlanHadBaseline, "新练习对话没有通过 get_plan 取得基线身份");
    insist(mockState.dailyCheckCalled, "新练习对话没有写入同型复测");
    insist(!await connection.page.getByRole("button", { name: "允许一次", exact: true }).isVisible().catch(() => false), "今日练习错误弹出了权限申请");

    await openEnglishPage(connection.page);
    const checked = await connection.page.evaluate(async () => window.leemoLearning.invoke("snapshot", {}));
    insist(checked.ok, `复测后读取失败：${checked.error ?? "unknown"}`);
    insist(checked.response?.evidence?.[0]?.assessmentKey === "paper-reading-baseline-v1", "同型复测没有生成可比较证据");
    insist(checked.response?.evidence?.[0]?.delta === 40, "同型复测的进步值不正确");

    const desktop = await layoutFacts(connection.page, 1440, 900);
    const narrow = await layoutFacts(connection.page, 720, 640);
    for (const [label, facts] of [["1440x900", desktop], ["720x640", narrow]]) {
      insist(facts.document.scrollWidth === facts.document.clientWidth, `${label} 出现横向溢出`);
      insist(facts.headingVisible && facts.primaryVisible, `${label} 核心内容不可见`);
    }

    await connection.browser.close();
    await stopTree(electron);
    await sleep(500);

    electron = startElectron();
    connection = await connectElectron();
    const restored = await connection.page.evaluate(async () => window.leemoLearning.invoke("snapshot", {}));
    insist(restored.ok, `重启后读取失败：${restored.error ?? "unknown"}`);
    insist(restored.response?.profile?.goal === LONG_GOAL, "重启后英语目标丢失");
    insist(restored.response?.profile?.dailyMinutes === 20, "重启后每日时长丢失");
    insist(restored.response?.summary?.hasBaseline === true, "重启后英语基线丢失");
    insist(restored.response?.summary?.totalItems === 1, "重启后复习队列丢失");
    insist(restored.response?.evidence?.[0]?.delta === 40, "重启后同型复测证据丢失");
    insist(fs.existsSync(path.join(E2E_ROOT, "user-data", "leemo.db")), "隔离 SQLite 没有落盘");

    console.log(JSON.stringify({
      pass: true,
      renderer: RENDERER_URL,
      isolated: true,
      desktop,
      narrow,
      visibleSetup: true,
      defaults,
      toolCalls: mockState.toolCalls,
      loopbackRequests: mockState.requests,
      restartRestored: true,
    }, null, 2));
  } finally {
    await connection?.browser?.close().catch(() => undefined);
    await stopTree(electron);
    await vite?.close().catch(() => undefined);
    await closeServer(mock?.server).catch(() => undefined);
  }
}

try {
  await main();
} finally {
  for (const child of children) forceTree(child);
  const tempRoot = path.resolve(os.tmpdir());
  const ownedRoot = path.resolve(E2E_ROOT);
  if (ownedRoot.startsWith(`${tempRoot}${path.sep}leemo-e2e-english-verify-`)) {
    fs.rmSync(ownedRoot, { recursive: true, force: true });
  }
}
