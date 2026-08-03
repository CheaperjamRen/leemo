// Zero-model-cost Electron acceptance for workspace @ references and preview
// selection handoff. Uses an isolated temp home so it never touches real data.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import electronPath from "electron";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAIN = path.join(ROOT, "dist-electron", "main.mjs");
const SCREENSHOT = path.join(os.tmpdir(), "leemo-file-reference-acceptance.png");
const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-e2e-file-reference-"));
const workspaceRoot = path.join(auditRoot, "home", "Leemo");
const testDir = path.join(workspaceRoot, "默认工作区");
const testPath = path.join(testDir, "引用验收.md");

function insist(value, message) {
  if (!value) throw new Error(message);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      insist(address && typeof address !== "string", "无法取得 CDP 端口");
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
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

async function dismissOnboarding(page) {
  const onboarding = page.getByRole("dialog", { name: "首次设置" });
  if (!await onboarding.isVisible({ timeout: 10_000 }).catch(() => false)) return;

  const deadline = Date.now() + 25_000;
  let lastClosedAt = 0;
  while (Date.now() < deadline) {
    if (await onboarding.isVisible().catch(() => false)) {
      await onboarding.getByRole("button", { name: "稍后配置", exact: true }).click();
      await onboarding.waitFor({ state: "hidden" });
      lastClosedAt = Date.now();
    } else if (lastClosedAt > 0 && Date.now() - lastClosedAt >= 8_000) {
      return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("首次设置弹窗没有稳定关闭");
}

fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(testPath, "# 引用验收\n\n这段文字会从真实 Markdown 预览交给 momo 改写。\n", "utf8");
const port = await freePort();
const logs = [];
const { LEEMO_RENDERER_URL: _ignoredRendererUrl, ELECTRON_RUN_AS_NODE: _ignoredRunAsNode, ...cleanEnv } = process.env;
const child = spawn(electronPath, [
  `--remote-debugging-port=${port}`,
  MAIN,
  `--leemo-e2e-root=${auditRoot}`,
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
], {
  cwd: ROOT,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: cleanEnv,
});
child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

let browser;
try {
  const connected = await connect(port);
  browser = connected.browser;
  const page = connected.page;
  await page.bringToFront();

  await dismissOnboarding(page);
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.waitFor({ state: "visible", timeout: 30_000 });

  await composer.fill("请总结 @引用");
  const mentionMenu = page.getByRole("listbox", { name: "引用工作区文件" });
  await mentionMenu.waitFor({ state: "visible" });
  await dismissOnboarding(page);
  await page.getByRole("option", { name: /引用验收\.md/ }).click();
  insist((await composer.inputValue()) === "请总结 ", "选择文件后没有只移除当前 @ 查询");
  await page.getByText("引用验收.md", { exact: true }).waitFor({ state: "visible" });

  await page.getByRole("button", { name: "工作台", exact: true }).click();
  await page.getByRole("button", { name: "文件树", exact: true }).click();
  const directory = page.getByTestId("dir-row-默认工作区");
  await directory.waitFor({ state: "visible" });
  await directory.click();
  await page.getByTestId("file-row-默认工作区/引用验收.md").click();
  const preview = page.getByTestId("preview-markdown");
  await preview.getByText(/这段文字会从真实 Markdown 预览交给 momo 改写/).waitFor();

  await preview.evaluate((root) => {
    const paragraph = [...root.querySelectorAll("p")]
      .find((candidate) => candidate.textContent?.includes("真实 Markdown"));
    if (!paragraph) throw new Error("找不到验收段落");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const selectionMenu = page.getByTestId("selection-menu");
  await selectionMenu.waitFor({ state: "visible" });
  await selectionMenu.getByRole("button", { name: "改写", exact: true }).click();
  await composer.waitFor({ state: "visible" });
  insist(
    (await composer.inputValue()).includes("请改写我在「引用验收.md」里选中的这段内容"),
    "选区改写没有进入 momo 输入框",
  );
  await page.screenshot({ path: SCREENSHOT });
  insist(logs.every((line) => !/uncaught|unhandled|fatal/i.test(line)), "主进程日志出现未处理错误");
  console.log(JSON.stringify({
    passed: true,
    workspaceReference: true,
    previewSelectionHandoff: true,
    screenshot: SCREENSHOT,
  }, null, 2));
} catch (error) {
  const tail = logs.join("").slice(-4_000);
  throw new Error(`${error instanceof Error ? error.message : String(error)}${tail ? `\nHost log:\n${tail}` : ""}`, { cause: error });
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null && child.pid) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // The app may already have exited with the renderer.
    }
  }
  fs.rmSync(auditRoot, { recursive: true, force: true });
}
