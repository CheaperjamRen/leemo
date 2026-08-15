import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXE = path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe");
const AUDIT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-gemini-packaged-"));

function insist(value, message) {
  if (!value) throw new Error(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function connect(port, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`打包版 Leemo 在开放调试端口前退出（exit ${child.exitCode}）`);
    }
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => !candidate.url().startsWith("devtools://"));
      if (page) return { browser, page };
      await browser.close();
    } catch {
      // The packaged app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("60 秒内没有连上打包版 Leemo");
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

async function stop(app) {
  await app?.browser?.close().catch(() => {});
  if (app?.child?.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(app.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // Electron may have already closed its process tree.
    }
  }
}

let app;
const logs = [];
try {
  insist(fs.existsSync(EXE), "找不到打包版 Leemo.exe，请先运行 npm run electron:pack");
  const port = await freePort();
  const { ELECTRON_RUN_AS_NODE: _runAsNode, LEEMO_RENDERER_URL: _renderer, ...env } = process.env;
  const child = spawn(EXE, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(AUDIT_ROOT, "chromium")}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
  ], {
    cwd: AUDIT_ROOT,
    env,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  const connected = await connect(port, child);
  app = { child, ...connected };
  const { page } = app;
  await dismissOnboarding(page);

  const backend = await page.evaluate(async () => {
    const providersFrame = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!providersFrame.ok) throw new Error(providersFrame.error || "listProviders failed");
    const provider = providersFrame.response.find((candidate) => candidate.kind === "gemini-subscription");
    if (!provider) return { provider: null, status: null };
    const statusFrame = await window.leemoBridge.invoke("bridge:getProviderLoginStatus", {
      providerId: provider.id,
    });
    if (!statusFrame.ok) throw new Error(statusFrame.error || "getProviderLoginStatus failed");
    return { provider, status: statusFrame.response };
  });
  insist(backend.provider?.name === "Gemini 订阅", "后端目录没有 Gemini 订阅");
  insist(backend.provider?.authMode === "oauth-subscription", "Gemini 订阅仍要求 API Key");
  insist(backend.status?.state === "connected", `本机 Gemini 登录态未识别：${JSON.stringify(backend.status)}`);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "模型", exact: true }).click();
  const catalog = page.getByTestId("provider-offer-grid");
  await catalog.waitFor({ state: "visible" });
  await catalog.getByRole("heading", { name: "已有订阅", exact: true }).waitFor({ state: "visible" });
  const card = catalog.getByRole("button", { name: "配置 Gemini 订阅", exact: true });
  await card.waitFor({ state: "visible" });
  await card.click();

  const form = page.getByTestId("provider-config-form");
  await form.waitFor({ state: "visible" });
  await form.getByText("订阅已连接", { exact: true }).first().waitFor({ state: "visible" });
  insist(!await form.getByLabel("API Key").isVisible().catch(() => false), "Gemini 订阅配置错误展示 API Key");
  insist(!await form.getByLabel("Base URL").isVisible().catch(() => false), "Gemini 订阅配置错误展示 Base URL");

  console.log(JSON.stringify({
    passed: true,
    packagedExecutable: EXE,
    provider: {
      id: backend.provider.id,
      kind: backend.provider.kind,
      engine: backend.provider.executionEngine,
      authMode: backend.provider.authMode,
    },
    loginState: backend.status.state,
    visibleGroup: "已有订阅",
    visibleCard: "Gemini 订阅",
    formStatus: "订阅已连接",
    apiKeyFieldVisible: false,
    baseUrlFieldVisible: false,
    modelRequestSent: false,
  }, null, 2));
} catch (error) {
  const tail = logs.join("").slice(-5_000);
  throw new Error(`${error instanceof Error ? error.message : String(error)}${tail ? `\nHost log:\n${tail}` : ""}`, {
    cause: error,
  });
} finally {
  await stop(app);
  await new Promise((resolve) => setTimeout(resolve, 600));
  fs.rmSync(AUDIT_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
