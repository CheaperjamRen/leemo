// Zero-cost Electron acceptance for key-free local model providers. The run is
// isolated under the OS temp directory and never reads the user's Leemo data.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAIN = path.join(ROOT, "dist-electron", "main.mjs");
const MODEL = "leemo-local-acceptance";
const MARKER = "LEEMO_LOCAL_PROVIDER_OK";
const CATALOG_SCREENSHOT = path.join(os.tmpdir(), "leemo-provider-catalog-acceptance.png");
const SCREENSHOT = path.join(os.tmpdir(), "leemo-local-provider-acceptance.png");
const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-e2e-local-provider-"));
const requests = [];

function insist(value, message) {
  if (!value) throw new Error(message);
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "无法取得本机端口");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function stream(res, model) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const base = {
    id: "chatcmpl-leemo-local",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
  };
  for (const payload of [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: MARKER }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { ...base, choices: [], usage: { prompt_tokens: 8, completion_tokens: 4 } },
  ]) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  res.end("data: [DONE]\n\n");
}

async function startMock() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        json(res, 400, { error: { message: "invalid json" } });
        return;
      }
      const authorization = req.headers.authorization ?? null;
      requests.push({ method: req.method, url: req.url, authorization, stream: body.stream === true });

      if (req.method === "GET" && req.url === "/v1/models") {
        json(res, 200, { data: [{ id: MODEL, object: "model", owned_by: "local" }] });
        return;
      }
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        json(res, 404, { error: { message: "not found" } });
        return;
      }
      if (body.stream === true) {
        if (authorization !== "Bearer leemo-local") {
          json(res, 401, { error: { message: "runtime gateway token missing" } });
          return;
        }
        stream(res, body.model ?? MODEL);
        return;
      }
      if (authorization !== null) {
        json(res, 400, { error: { message: "setup probe must not invent user credentials" } });
        return;
      }
      const serialized = JSON.stringify(body.messages ?? []);
      const isImage = serialized.includes("image_url");
      const isReasoning = typeof body.reasoning_effort === "string";
      json(res, 200, {
        id: "chatcmpl-leemo-local-probe",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? MODEL,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: isImage ? "red and blue" : isReasoning ? "4" : "OK",
            ...(isReasoning ? { reasoning_content: "2 + 2 = 4" } : {}),
          },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      });
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  insist(address && typeof address !== "string", "本地模拟服务启动失败");
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function connect(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => !candidate.url().startsWith("devtools://"));
      if (page) return { browser, page };
      await browser.close();
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("60 秒内没有连上 Leemo renderer");
}

async function launch() {
  const port = await freePort();
  const logs = [];
  const { LEEMO_RENDERER_URL: _renderer, ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    MAIN,
    `--leemo-e2e-root=${auditRoot}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
  ], { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const connected = await connect(port);
  return { ...connected, child, logs };
}

async function stop(app) {
  if (!app) return;
  await app.browser.close().catch(() => {});
  if (app.child.exitCode === null && app.child.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(app.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // The renderer can close before taskkill reaches it.
    }
  }
}

async function dismissOnboarding(page) {
  const dialog = page.getByRole("dialog", { name: "首次设置" });
  const deadline = Date.now() + 25_000;
  let lastClosedAt = Date.now();
  while (Date.now() < deadline) {
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole("button", { name: "稍后配置", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      lastClosedAt = Date.now();
    } else if (Date.now() - lastClosedAt >= 8_000) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("首次设置弹窗没有稳定关闭");
}

async function openModels(page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "模型", exact: true }).click();
}

async function configureLocalProvider(page, baseUrl) {
  await openModels(page);
  const catalog = page.getByTestId("provider-offer-grid");
  if (!await catalog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "添加模型服务商" }).click();
  }
  await catalog.waitFor({ state: "visible" });
  insist(await catalog.getByTestId("provider-offer-card").count() === 11, "服务商目录没有 10 个精选预设和自定义入口");
  await page.screenshot({ path: CATALOG_SCREENSHOT, animations: "disabled" });
  await catalog.getByRole("button", { name: "配置 Ollama" }).click();

  const form = page.getByTestId("provider-config-form");
  await form.waitFor({ state: "visible" });
  insist(!await form.getByLabel("API Key").isVisible().catch(() => false), "本地配置仍要求 API Key");
  await form.getByLabel("本地服务地址").fill(baseUrl);
  await form.locator("summary", { hasText: "高级设置" }).click();
  await form.getByLabel("模型发现地址").fill(`${baseUrl}/models`);
  await form.getByRole("button", { name: "读取本机模型" }).click();
  const model = form.getByLabel(`${MODEL} 可用`);
  await model.waitFor({ state: "visible" });
  await model.check();
  await form.getByRole("button", { name: "测试连接", exact: true }).click();
  await form.getByText("连接成功", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await form.getByText("本地服务：可用", { exact: true }).waitFor({ state: "visible" });
  await page.screenshot({ path: SCREENSHOT, animations: "disabled" });
  await form.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("button", { name: "选择 Ollama" }).waitFor({ state: "visible" });
}

async function runConversation(page, prompt) {
  if (await page.getByTestId("settings-window").isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  }
  if (!await page.getByTestId("workbench-shell").isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "切换到工作台", exact: true }).click();
  }
  await page.getByRole("button", { name: "新建对话" }).click();
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText(MARKER, { exact: false }).waitFor({ state: "visible", timeout: 60_000 });
  await page.getByTestId("current-conversation-status").filter({ hasText: "已完成" }).waitFor({ state: "visible" });
}

async function persistedLocalProvider(page) {
  return page.evaluate(async () => {
    const result = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!result.ok) throw new Error(result.error || "listProviders failed");
    return result.response.find((provider) => provider.kind === "ollama") ?? null;
  });
}

let mock;
let app;
const logs = [];
try {
  insist(fs.existsSync(MAIN), `找不到主进程构建：${MAIN}`);
  mock = await startMock();
  app = await launch();
  logs.push(...app.logs);
  await dismissOnboarding(app.page);
  await configureLocalProvider(app.page, mock.baseUrl);
  await runConversation(app.page, "请回复本地模型验收标记。");
  await stop(app);
  logs.push(...app.logs);

  app = await launch();
  await dismissOnboarding(app.page);
  const persisted = await persistedLocalProvider(app.page);
  insist(persisted?.configured === true, "重启后 Ollama 不再可用");
  insist(persisted.authMode === "none" && persisted.models.includes(MODEL), "重启后本地模型配置不完整");
  await runConversation(app.page, "重启后再次回复本地模型验收标记。");

  const discovery = requests.filter((request) => request.method === "GET");
  const probes = requests.filter((request) => request.method === "POST" && !request.stream);
  const runtime = requests.filter((request) => request.stream);
  insist(discovery.length >= 1 && probes.length >= 3 && runtime.length >= 2, "本地模型用户路径没有完整抵达模拟服务");
  insist([...discovery, ...probes].every((request) => request.authorization === null), "设置探测错误地携带了虚构用户凭据");
  insist(runtime.every((request) => request.authorization === "Bearer leemo-local"), "运行网关没有使用内部本地令牌");
  insist([...logs, ...app.logs].every((line) => !/uncaught|unhandled|fatal/i.test(line)), "主进程日志出现未处理错误");
  console.log(JSON.stringify({
    passed: true,
    catalogCards: 11,
    keyFreeSetup: true,
    conversationCompleted: true,
    restartRecovered: true,
    externalRequests: 0,
    screenshots: [CATALOG_SCREENSHOT, SCREENSHOT],
  }, null, 2));
} catch (error) {
  const tail = [...logs, ...(app?.logs ?? [])].join("").slice(-5_000);
  throw new Error(`${error instanceof Error ? error.message : String(error)}${tail ? `\nHost log:\n${tail}` : ""}`, { cause: error });
} finally {
  await stop(app).catch(() => {});
  if (mock?.server.listening) await new Promise((resolve) => mock.server.close(resolve));
  fs.rmSync(auditRoot, { recursive: true, force: true });
}
