import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const executable = path.resolve(process.argv[2] || path.join(root, "dist-package", "win-unpacked", "Leemo.exe"));
const outputDir = path.join(root, "docs", "research", "audit-shots");
const screenshotPath = path.join(outputDir, "packaged-computer-use-settings.png");
const factsPath = path.join(outputDir, "packaged-computer-use-facts.json");
const isolationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-e2e-computer-ui-"));
const secretsPath = path.join(isolationRoot, "user-data", "leemo-secrets.enc");

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
  insist(address && typeof address !== "string", "Cannot allocate a local CDP port");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForCDP(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // App is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged Leemo did not expose CDP ${port}`);
}

function fileFact(target) {
  if (!fs.existsSync(target)) return { exists: false };
  const bytes = fs.readFileSync(target);
  const stat = fs.statSync(target);
  return {
    exists: true,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    modifiedAt: stat.mtime.toISOString(),
  };
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function stopExactProcess(child, page) {
  if (!child || child.exitCode !== null) return;
  await page?.close({ runBeforeUnload: true }).catch(() => {});
  if (await waitForExit(child, 5_000)) return;
  if (!child.pid) throw new Error("Packaged Leemo has no process id for scoped cleanup");
  try {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    // A graceful exit can race the exact-PID cleanup.
  }
  insist(await waitForExit(child, 5_000), `Packaged Leemo PID ${child.pid} did not exit`);
}

async function openComputerSettings(page) {
  const dialog = page.getByRole("dialog", { name: "首次设置", exact: true });
  await dialog.waitFor({ state: "attached", timeout: 3_000 }).catch(() => {});
  const later = page.getByRole("button", { name: "稍后配置", exact: true });
  if (await later.isVisible().catch(() => false)) await later.click();
  if (!(await page.getByTestId("settings-window").count())) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "连接器", exact: true }).click();
  const section = page.locator("#settings-computer");
  await section.waitFor({ state: "visible" });
  await section.scrollIntoViewIfNeeded();
  return section;
}

async function launchAndInspect(label, action) {
  const port = await freePort();
  const logs = [];
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    "--disable-features=CalculateNativeWinOcclusion",
    `--leemo-e2e-root=${isolationRoot}`,
  ], { cwd: path.dirname(executable), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
  let browser;
  let page;
  try {
    await waitForCDP(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts().flatMap((context) => context.pages())
      .find((candidate) => !candidate.url().startsWith("devtools:"));
    insist(page, "Packaged renderer page is missing");
    await page.setViewportSize({ width: 1280, height: 860 });
    const result = await action(page);
    return {
      ...result,
      processId: child.pid,
      secrets: fileFact(secretsPath),
      startupLog: logs.join("").split(/\r?\n/).filter((line) => /E2E isolation|secrets source/.test(line)),
    };
  } finally {
    await stopExactProcess(child, page);
    await browser?.close().catch(() => {});
    console.log(JSON.stringify({ label, processId: child.pid, exitCode: child.exitCode, secrets: fileFact(secretsPath) }));
  }
}

fs.mkdirSync(outputDir, { recursive: true });
const facts = { checkedAt: new Date().toISOString(), modelCalls: 0, firstRun: {}, enabledRestart: {}, disabledRestart: {} };

try {
  facts.firstRun = await launchAndInspect("enable", async (page) => {
    const section = await openComputerSettings(page);
    const toggle = section.getByRole("checkbox", { name: "操作电脑 启用" });
    insist(!(await toggle.isChecked()), "Computer control must be opt-in on a fresh profile");
    const text = (await section.textContent()) || "";
    insist(text.includes("屏幕内容会发送给当前模型"), "Screen-sharing disclosure is missing");
    insist(text.includes("密码、验证码和登录由你接管"), "Human takeover boundary is missing");
    insist(!/MCP|UI Automation|Computer Use/.test(text), "Internal implementation language leaked into settings");

    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#settings-computer input[type="checkbox"]')?.checked === true);
    await section.getByRole("button", { name: "检查电脑操作", exact: true }).click();
    const ready = section.getByText(/电脑操作已就绪 · \d+ 项能力/);
    await ready.waitFor({ state: "visible", timeout: 30_000 });
    const readyText = (await ready.textContent())?.trim() || "";
    const toolCount = Number(readyText.match(/(\d+) 项能力/)?.[1] || 0);
    insist(toolCount >= 10, `Packaged desktop probe returned only ${toolCount} tools`);
    await page.screenshot({ path: screenshotPath });
    return { defaultEnabled: false, readyText, toolCount };
  });

  facts.enabledRestart = await launchAndInspect("enabled-restart", async (page) => {
    const section = await openComputerSettings(page);
    const toggle = section.getByRole("checkbox", { name: "操作电脑 启用" });
    insist(await toggle.isChecked(), "Enabled computer control did not survive restart");
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#settings-computer input[type="checkbox"]')?.checked === false);
    return { persistedEnabled: true, disabledForNextRestart: true };
  });

  facts.disabledRestart = await launchAndInspect("disabled-restart", async (page) => {
    const section = await openComputerSettings(page);
    const toggle = section.getByRole("checkbox", { name: "操作电脑 启用" });
    insist(!(await toggle.isChecked()), "Disabled computer control did not survive restart");
    return { persistedDisabled: true };
  });

  fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`);
  console.log(JSON.stringify(facts));
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), isolationRoot, secrets: fileFact(secretsPath), facts }, null, 2));
  throw error;
} finally {
  const canonicalTemp = fs.realpathSync(os.tmpdir());
  const canonicalRoot = fs.realpathSync(isolationRoot);
  if (process.env.LEEMO_KEEP_E2E_ROOT !== "1"
    && path.dirname(canonicalRoot).toLowerCase() === canonicalTemp.toLowerCase()
    && path.basename(canonicalRoot).startsWith("leemo-e2e-computer-ui-")) {
    fs.rmSync(canonicalRoot, { recursive: true, force: true });
  }
}
