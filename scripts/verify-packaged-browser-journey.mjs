// Packaged, zero-cost browser journey acceptance. It drives the visible Leemo
// UI against an isolated profile while a loopback OpenAI-compatible server
// deterministically selects the real bundled browser and ask-user tools.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  configureLoopbackProvider,
  skipOnboarding,
  TEST_KEY as CONFIG_TEST_KEY,
} from "./verify-memory-workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXE = path.resolve(process.argv[2] || path.join(ROOT, "dist-rc", "win-unpacked", "Leemo.exe"));
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "packaged-browser-journey-facts.json");
const TAKEOVER_SHOT = path.join(OUTPUT_DIR, "packaged-browser-takeover.png");
const FINAL_ACTION_SHOT = path.join(OUTPUT_DIR, "packaged-browser-final-confirmation.png");
const COMPLETE_SHOT = path.join(OUTPUT_DIR, "packaged-browser-journey-complete.png");
const ROOT_PREFIX = "leemo-e2e-browser-journey-";
const MODEL_ID = "browser-journey-model";
const TEST_KEY = CONFIG_TEST_KEY;
const SUCCESS_MARKER = "LEEMO_BROWSER_JOURNEY_OK";
const PROMPT = "请打开本地申请页，检查内容并继续；遇到需要我接管的步骤就停下来，最终提交前按 Leemo 的规则确认。";

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
  const base = streamBase(model, "chatcmpl-browser-journey-complete");
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 30, completion_tokens: 8 } });
  response.end("data: [DONE]\n\n");
}

function createLoopbackServer(state) {
  return http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/journey") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head><title>Leemo browser journey</title></head>
        <body style="font-family:system-ui;padding:48px;background:#f5f6f7;color:#202124">
          <main style="max-width:720px;margin:auto;background:#fff;border:1px solid #ddd;padding:32px">
            <p>Local acceptance</p><h1>实习申请确认</h1>
            <p>资料已填写，页面要求用户完成一次身份验证后再提交。</p>
            <button id="submit" type="button">提交求职申请</button>
            <p id="status">尚未提交</p>
          </main>
          <script>document.querySelector('#submit').addEventListener('click',()=>{document.querySelector('#status').textContent='Application submitted locally';});</script>
        </body></html>`);
      return;
    }
    if (request.method === "GET" && request.url === "/v1/models") {
      writeJson(response, 200, { data: [{ id: MODEL_ID, display_name: "Browser Journey" }] });
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
          id: "chatcmpl-browser-probe",
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
        const tool = bySuffix("browser_navigate");
        if (!tool) return writeJson(response, 400, { error: { message: "browser_navigate was not advertised" } });
        state.stage += 1;
        return writeToolCall(response, model, "navigate", tool, { url: state.pageUrl });
      }
      if (state.stage === 1) {
        const tool = bySuffix("browser_snapshot");
        if (!tool) return writeJson(response, 400, { error: { message: "browser_snapshot was not advertised" } });
        state.stage += 1;
        return writeToolCall(response, model, "snapshot", tool, {});
      }
      if (state.stage === 2) {
        const tool = bySuffix("browser_take_screenshot");
        if (!tool) return writeJson(response, 400, { error: { message: "browser_take_screenshot was not advertised" } });
        state.submitLine = transcript.split(/\r?\n/).find((line) => line.includes("提交求职申请")) ?? "";
        const afterButtonLabel = state.submitLine.slice(state.submitLine.indexOf("提交求职申请"));
        state.submitTarget = afterButtonLabel.match(/\[ref=([^\]]+)\]/)?.[1] ?? "";
        state.stage += 1;
        return writeToolCall(response, model, "screenshot", tool, { type: "png" });
      }
      if (state.stage === 3) {
        const tool = bySuffix("ask_user");
        if (!tool) return writeJson(response, 400, { error: { message: "ask_user was not advertised" } });
        state.stage += 1;
        return writeToolCall(response, model, "takeover", tool, {
          questions: [{
            header: "需要你接管",
            question: "页面要求登录或身份验证，处理完成后继续吗？",
            options: [
              { label: "我已处理，继续", description: "保留当前页面，从这里接着完成任务" },
              { label: "先暂停", description: "停在当前进度，暂不继续" },
            ],
            multiSelect: false,
          }],
        });
      }
      if (state.stage === 4) {
        const tool = bySuffix("browser_click");
        const target = state.submitTarget;
        if (!tool || !target) return writeJson(response, 400, { error: { message: "final browser target was not available" } });
        state.stage += 1;
        return writeToolCall(response, model, "final-click", tool, { element: "提交求职申请", target });
      }
      if (state.stage === 5) {
        const tool = bySuffix("browser_snapshot");
        if (!tool) return writeJson(response, 400, { error: { message: "browser_snapshot was not advertised after final click" } });
        state.stage += 1;
        return writeToolCall(response, model, "verify-final-click", tool, {});
      }
      if (state.stage === 6) {
        state.finalClickObserved = transcript.includes("Application submitted locally");
        state.stage += 1;
        return writeText(response, model, state.finalClickObserved
          ? `${SUCCESS_MARKER}。本地申请页已完成最终提交。`
          : "LEEMO_BROWSER_CLICK_NOT_PROVEN");
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
  state.pageUrl = `http://127.0.0.1:${address.port}/journey`;
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
  let browser;
  try {
    await waitForRenderer(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    insist(page, "隔离 Leemo 没有 renderer page");
    await page.getByTestId("topbar-primary-controls").waitFor({ state: "attached", timeout: 60_000 });
    return { child, browser, page, logs };
  } catch (error) {
    if (child.exitCode === null && child.pid) {
      try {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch { /* process can exit while startup failure is being handled */ }
    }
    await browser?.close().catch(() => {});
    throw error;
  }
}

async function stopApp(instance) {
  if (!instance) return;
  await instance.page.close({ runBeforeUnload: true }).catch(() => {});
  await Promise.race([new Promise((resolve) => instance.child.once("exit", resolve)), sleep(4_000)]);
  if (instance.child.exitCode === null && instance.child.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(instance.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch { /* graceful close raced the scoped taskkill */ }
  }
  await instance.browser.close().catch(() => {});
}

async function enableManagedBrowser(page) {
  await page.getByTestId("topbar-primary-controls").getByRole("button", { name: "设置", exact: true }).click();
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "连接器", exact: true }).click();
  const section = page.locator("#settings-browser");
  await section.waitFor({ state: "visible" });
  const managed = section.getByRole("button", { name: "Leemo 浏览器", exact: true });
  if (await managed.getAttribute("aria-pressed") !== "true") await managed.click();
  const enabled = section.getByLabel("浏览器自动化 启用");
  if (!await enabled.isChecked()) await enabled.check();
  await section.getByRole("button", { name: "检查浏览器", exact: true }).click();
  await section.getByText(/浏览器已就绪 · \d+ 项能力/).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
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

  const question = page.getByText("页面要求登录或身份验证，处理完成后继续吗？", { exact: true });
  await question.waitFor({ state: "visible", timeout: 90_000 });
  const expand = page.getByTestId("process-fold-toggle").last();
  if (await expand.getAttribute("aria-expanded") !== "true") await expand.click();
  const capture = page.getByRole("img", { name: "浏览器截图" }).last();
  await capture.waitFor({ state: "visible", timeout: 30_000 });
  await question.scrollIntoViewIfNeeded();
  await page.screenshot({ path: TAKEOVER_SHOT, animations: "disabled" });

  await page.getByRole("button", { name: /我已处理，继续/ }).click();
  await page.getByRole("button", { name: "提交", exact: true }).click();

  const approval = page.getByTestId("approval-card-pending");
  await approval.waitFor({ state: "visible", timeout: 45_000 });
  insist((await approval.getAttribute("data-tool-name"))?.endsWith("browser_click"), "最终确认卡没有绑定网页点击");
  insist((await approval.getAttribute("data-input-summary")) === "提交求职申请", "最终确认卡没有说清提交目标");
  await approval.scrollIntoViewIfNeeded();
  await page.screenshot({ path: FINAL_ACTION_SHOT, animations: "disabled" });
  await approval.getByRole("button", { name: "允许一次", exact: true }).click();

  await page.getByText(SUCCESS_MARKER, { exact: false }).waitFor({ state: "visible", timeout: 45_000 });
  await page.locator('[data-testid="process-fold"][data-state="terminal"]').last().waitFor({ state: "visible" });
  await page.screenshot({ path: COMPLETE_SHOT, animations: "disabled" });
}

async function main() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  insist(fs.existsSync(EXE), `找不到打包应用：${EXE}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const auditRoot = validateAuditRoot(fs.mkdtempSync(path.join(os.tmpdir(), ROOT_PREFIX)));
  const state = {
    stage: 0,
    requests: [],
    pageUrl: "",
    submitLine: "",
    submitTarget: "",
    finalClickObserved: false,
  };
  let loopback;
  let current;
  const logs = [];
  try {
    loopback = await startServer(state);
    current = await launchApp(auditRoot);
    await skipOnboarding(current.page);
    await configureLoopbackProvider(current.page, loopback.baseUrl);
    const desktop = await current.page.evaluate(() => window.leemoDesktop.configure({ continueInBackground: false }));
    insist(desktop.ok, desktop.error || "后台运行设置没有保存");
    const secretsPath = path.join(auditRoot, "user-data", "leemo-secrets.enc");
    insist(fs.existsSync(secretsPath) && fs.statSync(secretsPath).size > 0, "服务商保存成功后没有形成加密配置文件");
    await stopApp(current);
    insist(fs.existsSync(secretsPath) && fs.statSync(secretsPath).size > 0, "关闭应用后加密服务商配置丢失");
    logs.push(...current.logs);
    current = await launchApp(auditRoot);
    const configuredProviders = await current.page.evaluate(async () => {
      const result = await window.leemoBridge.invoke("bridge:listProviders", undefined);
      if (!result.ok) throw new Error(result.error || "listProviders failed");
      return result.response.filter((provider) => provider.configured).map((provider) => provider.id);
    });
    insist(configuredProviders.length === 1, `重启后服务商配置没有恢复：${configuredProviders.join(",") || "空"}`);
    await enableManagedBrowser(current.page);
    await runJourney(current.page);

    insist(state.stage >= 7, `模型旅程只执行到阶段 ${state.stage}`);
    insist(state.finalClickObserved, "最终网页提交没有在真实工具结果中得到证明");
    insist(state.requests.every((request) => request.names.some((name) => name.endsWith("browser_navigate"))), "浏览器工具没有持续注入模型上下文");
    const allLogs = [...logs, ...current.logs].join("");
    insist(!allLogs.includes(CONFIG_TEST_KEY), "打包主进程日志泄露了测试 API Key");

    const facts = {
      checkedAt: new Date().toISOString(),
      packagedExecutable: path.relative(ROOT, EXE).replaceAll(path.sep, "/"),
      isolatedUserData: true,
      externalApiCalls: 0,
      modelCostUsd: 0,
      browserToolRounds: state.requests.length,
      managedBrowserConnected: true,
      screenshotVisibleInTimeline: true,
      humanTakeoverCard: true,
      resumedSameTask: true,
      finalActionConfirmation: true,
      finalClickObserved: true,
      completed: true,
      screenshots: [path.basename(TAKEOVER_SHOT), path.basename(FINAL_ACTION_SHOT), path.basename(COMPLETE_SHOT)],
    };
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(facts, null, 2));
  } catch (error) {
    const last = state.requests.at(-1);
    console.error("[packaged-browser-journey] diagnostic", {
      stage: state.stage,
      requestCount: state.requests.length,
      submitLine: state.submitLine,
      submitTarget: state.submitTarget,
      advertisedTools: last?.names,
      transcriptTail: last?.transcript.slice(-6_000),
    });
    const tail = current?.logs.join("").slice(-10_000);
    if (tail) console.error(`[packaged-browser-journey] host log:\n${tail}`);
    const bodyText = await current?.page.locator("body").innerText().catch(() => "");
    if (bodyText) console.error(`[packaged-browser-journey] visible UI:\n${bodyText.slice(-8_000)}`);
    await current?.page.screenshot({
      path: path.join(OUTPUT_DIR, "packaged-browser-journey-failure.png"),
      animations: "disabled",
    }).catch(() => {});
    throw error;
  } finally {
    await stopApp(current);
    if (loopback?.server?.listening) {
      await new Promise((resolve) => loopback.server.close(resolve));
    }
    const owned = validateAuditRoot(auditRoot);
    try { fs.rmSync(owned, { recursive: true, force: true }); } catch { /* browser profile release can lag */ }
  }
}

main().catch((error) => {
  console.error("[packaged-browser-journey] FAIL", error);
  process.exitCode = 1;
});
