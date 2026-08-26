import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = path.join(ROOT, "dist-electron", "main.mjs");
const require = createRequire(import.meta.url);
const electronExecutable = path.join(path.dirname(require.resolve("electron/package.json")), "dist", "electron.exe");
const packagedExecutable = process.env.LEEMO_PACKAGED_EXE
  ? path.resolve(process.env.LEEMO_PACKAGED_EXE)
  : null;
async function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("无法分配调试端口"));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const cdpPort = process.env.LEEMO_CRITICAL_CDP_PORT
  ? Number(process.env.LEEMO_CRITICAL_CDP_PORT)
  : await allocateLoopbackPort();
const isolationRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "leemo-e2e-critical-runtime-"));
const evidenceDir = path.join(ROOT, ".tmp-visual-audit", "critical-runtime");
fs.mkdirSync(evidenceDir, { recursive: true });
const hostLogs = [];
const openResponses = new Set();
let hangingRequestsRemaining = 1;

function insist(value, message) {
  if (!value) throw new Error(message);
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    writeJson(response, 200, { data: [{ id: "runtime-probe" }] });
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  request.resume();
  request.on("end", () => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const base = { id: "critical-runtime", object: "chat.completion.chunk", created: 1, model: "runtime-probe" };
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "已开始" }, finish_reason: null }] })}\n\n`);
    if (hangingRequestsRemaining > 0) {
      hangingRequestsRemaining -= 1;
      openResponses.add(response);
      response.once("close", () => openResponses.delete(response));
      return;
    }
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 18, completion_tokens: 2 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
});

function forceKill(child) {
  if (!child?.pid) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function removeIsolationRoot() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.promises.rm(isolationRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

function launch() {
  const executable = packagedExecutable ?? electronExecutable;
  const applicationArgs = packagedExecutable ? [] : [MAIN];
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, LEEMO_RENDERER_URL: _rendererUrl, ...cleanEnv } = process.env;
  const child = spawn(executable, [
    `--remote-debugging-port=${cdpPort}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    ...applicationArgs,
    `--leemo-e2e-root=${isolationRoot}`,
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
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Electron 调试端口没有就绪。");
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const child = launch();
  let browser;
  let gracefulExit = false;
  try {
    await waitForCdp();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const context = browser.contexts()[0];
    const deadline = Date.now() + 15_000;
    let page;
    while (!page && Date.now() < deadline) {
      page = context.pages().find((candidate) => !candidate.url().startsWith("devtools://"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    insist(page, "没有找到 Leemo 主窗口。");
    await page.waitForFunction(() => Boolean(window.leemoBridge && window.leemoPersist));

    const invoke = async (channel, request) => {
      const result = await page.evaluate(({ channel, request }) => window.leemoBridge.invoke(channel, request), { channel, request });
      insist(result.ok, `${channel} 失败：${result.error ?? "unknown"}`);
      return result.response;
    };
    const persist = async (operation, request) => {
      const result = await page.evaluate(({ operation, request }) => window.leemoPersist.invoke(operation, request), { operation, request });
      insist(result.ok, `${operation} 失败：${result.error ?? "unknown"}`);
      return result.response;
    };

    const provider = await invoke("bridge:saveProvider", {
      kind: "custom",
      name: "运行验收",
      category: "custom",
      baseUrl,
      apiFormat: "openai",
      apiKey: "runtime-probe-key",
      models: ["runtime-probe"],
      modelContextPolicies: {
        "runtime-probe": { contextWindowTokens: 1_000_000, autoCompactWindowTokens: 950_000 },
      },
    });
    await persist("saveSettings", {
      onboardingCompleted: true,
      surface: "buddy",
      mode: "buddy",
      defaultProviderId: provider.id,
      defaultModelId: "runtime-probe",
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.leemoBridge && window.leemoPersist));
    await page.evaluate(() => {
      window.__criticalEvents = [];
      window.__criticalOff = window.leemoBridge.on("bridge:event", (payload) => window.__criticalEvents.push(payload));
    });

    const createConversation = () => invoke("bridge:createConversation", {
      providerId: provider.id,
      modelId: "runtime-probe",
      mode: "buddy",
      talkStyle: 1,
      webSearchEnabled: false,
      webFetchEnabled: false,
      rememberMode: false,
      permissionMode: "acceptEdits",
    });
    await page.getByRole("textbox", { name: "输入消息" }).fill("请保持运行，等待我停止。");
    await page.getByRole("button", { name: "发送" }).click();
    const stopButton = page.getByRole("button", { name: "停止" });
    await stopButton.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__criticalEvents
      ?.some((entry) => entry.event.type === "text.delta"), undefined, { timeout: 30_000 });
    const hangingConversationId = await page.evaluate(() => window.__criticalEvents
      ?.find((entry) => entry.event.type === "text.delta")?.conversationId);
    insist(hangingConversationId, "运行中的 UI 对话没有收到模型事件。");

    const stopStarted = Date.now();
    await stopButton.click();
    const stoppingButton = page.getByRole("button", { name: "正在停止" });
    await stoppingButton.waitFor({ timeout: 500 });
    insist(await stoppingButton.isDisabled(), "停止按钮没有在第一次点击后锁定。");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(evidenceDir, "stopping-1440x900.png"), animations: "disabled" });
    const settingsStarted = Date.now();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByRole("dialog", { name: "设置" }).waitFor({ timeout: 3_000 });
    await page.getByText("通用", { exact: true }).first().waitFor({ timeout: 3_000 });
    const settingsMs = Date.now() - settingsStarted;
    await page.screenshot({ path: path.join(evidenceDir, "settings-during-stop-1440x900.png"), animations: "disabled" });
    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.waitForFunction((id) => window.__criticalEvents?.some((entry) => entry.conversationId === id && entry.event.type === "run.finished" && entry.event.subtype === "interrupted"), hangingConversationId, { timeout: 5_000 });
    const interruptMs = Date.now() - stopStarted;
    insist(settingsMs <= 2_000, `模型运行/停止中打开设置过慢：${settingsMs}ms`);
    insist(interruptMs <= 4_000, `单击停止清理过慢：${interruptMs}ms`);

    const completed = await createConversation();
    await invoke("bridge:send", { conversationId: completed.conversationId, prompt: "请回复完成。" });
    await page.waitForFunction((id) => window.__criticalEvents?.some((entry) => entry.conversationId === id && entry.event.type === "run.finished"), completed.conversationId, { timeout: 30_000 });
    const snapshot = await page.evaluate((id) => window.__criticalEvents
      ?.filter((entry) => entry.conversationId === id && entry.event.type === "context.snapshot")
      .map((entry) => entry.event)
      .at(-1), completed.conversationId);
    insist(snapshot?.rawMaxTokens === 1_000_000, `模型上限没有采用设置值：${JSON.stringify(snapshot)}`);
    insist(snapshot?.maxTokens === 950_000, `整理窗口没有采用设置值：${JSON.stringify(snapshot)}`);
    insist(snapshot?.autoCompactThreshold > 900_000 && snapshot?.autoCompactThreshold <= 950_000, `实际整理阈值异常：${JSON.stringify(snapshot)}`);
    insist(snapshot?.model === "runtime-probe", `上下文模型身份串线：${JSON.stringify(snapshot)}`);

    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const first = await cdp.send("Performance.getMetrics");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const second = await cdp.send("Performance.getMetrics");
    const metric = (snapshotValue, name) => snapshotValue.metrics.find((entry) => entry.name === name)?.value ?? 0;
    const rendererTaskMs2s = Math.round((metric(second, "TaskDuration") - metric(first, "TaskDuration")) * 1_000);
    insist(rendererTaskMs2s < 750, `空闲渲染任务占用异常：2 秒内 ${rendererTaskMs2s}ms`);

    console.log(JSON.stringify({ settingsMs, interruptMs, context: snapshot, rendererTaskMs2s }, null, 2));
    const backgroundSetting = await page.evaluate(() => window.leemoDesktop?.configure({ continueInBackground: false }));
    insist(backgroundSetting?.ok === true, `无法准备正常退出验收：${JSON.stringify(backgroundSetting)}`);
    await page.evaluate(() => window.close());
    gracefulExit = await waitForChildExit(child, 12_000);
    insist(gracefulExit, "正常关窗后 Leemo 未完成后台清理并退出");
  } finally {
    await browser?.close().catch(() => {});
    for (const response of openResponses) response.destroy();
    if (!gracefulExit) forceKill(child);
  }
}

try {
  await main();
} finally {
  await new Promise((resolve) => server.close(resolve));
  await removeIsolationRoot();
}
