import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = path.join(ROOT, "dist-electron", "main.mjs");
const require = createRequire(import.meta.url);
const electronExecutable = path.join(path.dirname(require.resolve("electron/package.json")), "dist", "electron.exe");
const rendererUrl = process.env.LEEMO_RENDERER_URL ?? "http://127.0.0.1:5199/";
const port = Number(process.env.LEEMO_GLOBAL_OVERVIEW_CDP_PORT ?? 9357);
const tempParent = path.resolve(os.tmpdir());
const auditRoot = fs.mkdtempSync(path.join(tempParent, "leemo-e2e-global-overview-"));
const outputDir = path.join(ROOT, ".tmp-visual-audit", "global-pending-overview");
const screenshotPath = path.join(outputDir, "start-electron-restarted-1440x900.png");

function insist(value, message) {
  if (!value) throw new Error(message);
}

function killTree(child) {
  if (!child?.pid) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

async function waitForCdp(timeoutMs = 20_000) {
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

function launch() {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...cleanEnv } = process.env;
  const child = spawn(electronExecutable, [
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    MAIN,
    `--leemo-e2e-root=${auditRoot}`,
  ], {
    cwd: ROOT,
    env: { ...cleanEnv, LEEMO_RENDERER_URL: rendererUrl },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return child;
}

async function connect() {
  await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().startsWith(rendererUrl)) return { browser, page };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await browser.close();
  throw new Error("没有找到 Leemo 主窗口。");
}

const now = Date.now();
const conversation = {
  id: "electron-overview-source",
  title: "Electron 全局看板重启验收",
  titleManuallyUpdated: true,
  bookId: null,
  workspaceId: "leemo-home",
  source: "workbench",
  providerId: "fixture-provider",
  modelId: "fixture-model",
  createdAt: now - 60_000,
  lastActivityAt: now,
  unread: false,
  pinned: false,
  archived: false,
  lastOpenedAt: now,
};
const timeline = [
  { kind: "text", id: "electron-user", runId: "electron-run", role: "user", text: "验证全局看板重启恢复", streaming: false, createdAt: now - 1_000 },
  { kind: "result", id: "electron-result", runId: "electron-run", isError: false, interrupted: false, finalText: "已写入真实 SQLite。", pathAudit: { claimed: [] }, createdAt: now },
];
const overviewState = {
  version: 1,
  snapshot: {
    version: 1,
    id: "electron-overview-snapshot",
    generatedAt: now,
    trigger: "manual",
    providerId: "fixture-provider",
    modelId: "fixture-model",
    items: [{
      id: "electron-line",
      anchorSourceId: "conversation:electron-overview-source",
      sourceIds: ["conversation:electron-overview-source"],
      title: "全局看板真实重启恢复",
      progressSummary: "真实主进程已把快照写入 SQLite。",
      nextStep: "重启后仍能打开来源会话",
      projectLabel: "Leemo 验收",
      priority: "now",
    }],
    uncertainSourceIds: [],
  },
  overrides: [],
};

let child;
let connected;
let restarted;
try {
  fs.mkdirSync(outputDir, { recursive: true });
  child = launch();
  connected = await connect();
  await connected.page.setViewportSize({ width: 1440, height: 900 });
  await connected.page.waitForFunction(() => Boolean(window.leemoPersist));
  const seeded = await connected.page.evaluate(async ({ meta, items, overview }) => {
    const settings = await window.leemoPersist.invoke("saveSettings", {
      surface: "start",
      mode: "buddy",
      onboardingCompleted: true,
      globalOverviewAutoEnabled: false,
      globalOverviewAutoTime: "09:00",
    });
    const savedConversation = await window.leemoPersist.invoke("saveConversation", { meta, timeline: items });
    const savedOverview = await window.leemoPersist.invoke("saveGlobalPendingOverview", overview);
    return { settings, savedConversation, savedOverview };
  }, { meta: conversation, items: timeline, overview: overviewState });
  insist(
    seeded.settings.ok && seeded.savedConversation.ok && seeded.savedOverview.ok,
    `真实 IPC 写入失败：${JSON.stringify(seeded)}`,
  );
  await connected.browser.close();
  killTree(child);
  child = undefined;
  await new Promise((resolve) => setTimeout(resolve, 700));

  restarted = launch();
  connected = await connect();
  await connected.page.setViewportSize({ width: 1440, height: 900 });
  await connected.page.getByText("全局看板真实重启恢复").waitFor({ timeout: 15_000 });
  await connected.page.screenshot({ path: screenshotPath, animations: "disabled" });
  insist(await connected.page.getByLabel("输入消息").count() === 0, "开始表面意外出现模型输入框。");
  await connected.page.getByRole("button", { name: "打开事项 全局看板真实重启恢复" }).click();
  await connected.page.getByRole("button", { name: "打开来源 会话：Electron 全局看板重启验收" }).click();
  await connected.page.getByText("验证全局看板重启恢复").waitFor({ timeout: 10_000 });
  const dbPath = path.join(auditRoot, "user-data", "leemo.db");
  insist(fs.existsSync(dbPath), "隔离 SQLite 没有落盘。");
  console.log(JSON.stringify({
    pass: true,
    dbPath,
    screenshot: path.relative(ROOT, screenshotPath).replaceAll(path.sep, "/"),
    restoredSnapshot: true,
    openedRealConversation: true,
  }, null, 2));
} finally {
  if (connected) await connected.browser.close().catch(() => undefined);
  killTree(restarted ?? child);
  const resolved = path.resolve(auditRoot);
  const expectedPrefix = `${tempParent}${path.sep}leemo-e2e-global-overview-`;
  if (resolved.startsWith(expectedPrefix)) fs.rmSync(resolved, { recursive: true, force: true });
}
