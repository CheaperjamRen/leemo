// Release acceptance for the successful first-run journey in the packaged app.
// The key is loaded into this process only, typed into the password field, and
// never logged or written to evidence. The packaged child starts with provider
// environment variables stripped, so the wizard genuinely begins at zero.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const EXE = process.argv[2];
if (!EXE || !fs.existsSync(EXE)) {
  console.error(`Usage: node scripts/verify-packaged-onboarding-success.mjs <Leemo.exe>\nReceived: ${EXE ?? "(none)"}`);
  process.exit(2);
}

process.loadEnvFile(path.join(ROOT, ".env"));
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is unavailable; successful onboarding acceptance was not run.");
  process.exit(2);
}

const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "onboarding-r8-valid-facts.json");
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-packaged-onboarding-"));
const USER_DATA_DIR = path.join(TEMP_ROOT, "user-data");
const PROVIDER_ENV_KEYS = [
  "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
  "GLM_API_KEY", "GLM_MODEL",
  "KIMI_API_KEY", "KIMI_MODEL",
  "DASHSCOPE_API_KEY", "QWEN_MODEL", "QWEN_BASE_URL",
];
const FLAGS = [
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
];

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const insist = (value, message) => {
  if (!value) throw new Error(message);
};

const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : undefined;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

function childEnvironment() {
  const env = { ...process.env };
  for (const key of PROVIDER_ENV_KEYS) delete env[key];
  return env;
}

function forceKillTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

async function connect(port) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((target) => target.type === "page" && /^file:/.test(target.url))) break;
    } catch {
      // Packaged Electron is still starting.
    }
    await sleep(300);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => /^file:/.test(candidate.url()));
  if (!page) throw new Error("Packaged renderer did not expose a file:// page");
  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");
  return { browser, page };
}

async function launch(label) {
  const port = await findFreePort();
  const logs = [];
  const child = spawn(
    EXE,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${USER_DATA_DIR}`, ...FLAGS],
    {
      cwd: TEMP_ROOT,
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    },
  );
  const collect = (chunk) => logs.push(chunk.toString());
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const connection = await connect(port);
  console.log(`[packaged-onboarding] ready: ${label}`);
  return { child, logs, ...connection };
}

async function stop(instance) {
  if (!instance) return;
  if (instance.child.exitCode === null) {
    const exited = new Promise((resolve) => instance.child.once("exit", resolve));
    // Chromium must flush Local State before the next process tries to decrypt
    // safeStorage. A Windows /F kill makes a valid encrypted provider look lost.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(instance.child.pid), "/T"], { stdio: "ignore" });
    } else {
      instance.child.kill("SIGTERM");
    }
    const graceful = await Promise.race([exited.then(() => true), sleep(10_000).then(() => false)]);
    if (!graceful) {
      forceKillTree(instance.child);
      await Promise.race([exited, sleep(5_000)]);
    }
  }
  await instance.browser.close().catch(() => {});
  await sleep(600);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), animations: "disabled" });
}

async function configuredProviders(page) {
  return page.evaluate(async () => {
    const result = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!result.ok) throw new Error(result.error ?? "bridge:listProviders failed");
    const providers = result.response;
    return providers.filter((provider) => provider.configured).map((provider) => provider.id);
  });
}

let first;
let reopened;
try {
  first = await launch("fresh packaged profile");
  const dialog = first.page.getByRole("dialog", { name: "首次设置" });
  await dialog.waitFor({ state: "visible" });
  insist(/providers:\s*0 家已配置/.test(first.logs.join("")), "Fresh packaged profile inherited a provider");

  const keyInput = dialog.getByRole("textbox", { name: "API Key" });
  await keyInput.fill(apiKey);
  await dialog.getByRole("button", { name: "测试并继续" }).click();
  await dialog.getByText("momo 已经准备好了", { exact: true }).waitFor({ state: "visible", timeout: 90_000 });
  await dialog.getByText(/模型连接已验证/).waitFor({ state: "visible" });
  await dialog.getByText(/示例本子「例：高等数学」已放进工作台/).waitFor({ state: "visible" });
  await screenshot(first.page, "onboarding-r8-valid-connected.png");

  const configuredAfterConnect = await configuredProviders(first.page);
  insist(configuredAfterConnect.includes("deepseek"), "Successful connection did not save DeepSeek");
  await dialog.getByRole("button", { name: "和 momo 说第一句" }).click();
  await dialog.waitFor({ state: "hidden" });
  const composer = first.page.locator('textarea[aria-label="输入消息"]');
  await composer.waitFor({ state: "visible" });
  insist(await composer.evaluate((element) => element === document.activeElement), "First-run flow did not focus the composer");

  const prompt = "请只回复四个字：连接成功";
  await composer.fill(prompt);
  await first.page.getByRole("button", { name: "发送" }).click();
  await first.page.waitForFunction(() => {
    // A finished empty composer correctly renders a disabled send button. The
    // completion signal is that the busy-only stop control has switched back
    // to send, not that an empty composer can submit again.
    const sendReturned = [...document.querySelectorAll("button")]
      .some((button) => button.getAttribute("aria-label") === "发送");
    const replies = [...document.querySelectorAll('svg[aria-label="momo 的头像"]')]
      .map((avatar) => avatar.closest(".flex.items-start")?.textContent?.trim() ?? "")
      .filter(Boolean);
    return sendReturned && replies.some((reply) => /连接成功/.test(reply));
  }, undefined, { timeout: 120_000 });
  const firstReply = await first.page.evaluate(() => (
    [...document.querySelectorAll('svg[aria-label="momo 的头像"]')]
      .map((avatar) => avatar.closest(".flex.items-start")?.textContent?.trim() ?? "")
      .filter((text) => /连接成功/.test(text))
      .at(-1) ?? ""
  ));
  insist(firstReply.length > 0 && firstReply !== prompt, "First model reply was empty or only echoed the user prompt");
  await screenshot(first.page, "onboarding-r8-valid-first-reply.png");
  const firstLogs = first.logs.join("");
  insist(!firstLogs.includes(apiKey), "Provider key leaked into packaged app logs");
  await stop(first);
  first = undefined;

  reopened = await launch("same profile after restart");
  await reopened.page.locator('textarea[aria-label="输入消息"]').waitFor({ state: "visible" });
  insist(!(await reopened.page.getByRole("dialog", { name: "首次设置" }).count()), "Completed onboarding reopened after restart");
  const configuredAfterRestart = await configuredProviders(reopened.page);
  insist(configuredAfterRestart.includes("deepseek"), "Encrypted provider was not restored after restart");
  const reopenedLogs = reopened.logs.join("");
  insist(/secrets source=encrypted/.test(reopenedLogs), "Restart did not restore the provider from encrypted storage");
  insist(!reopenedLogs.includes(apiKey), "Provider key leaked into restart logs");
  await screenshot(reopened.page, "onboarding-r8-valid-reopened.png");

  const facts = {
    checkedAt: new Date().toISOString(),
    executable: EXE,
    isolatedUserData: true,
    configuredProvidersAtStart: 0,
    provider: "deepseek",
    billableModelCalls: 2,
    keyRecordedInEvidence: false,
    connectionVerified: true,
    starterNotebookReady: true,
    composerFocused: true,
    firstReplyNonEmpty: true,
    firstReplyPreview: firstReply.slice(0, 80),
    encryptedProviderRestoredAfterRestart: true,
    onboardingStayedClosedAfterRestart: true,
    evidence: [
      "onboarding-r8-valid-connected.png",
      "onboarding-r8-valid-first-reply.png",
      "onboarding-r8-valid-reopened.png",
    ],
  };
  fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  console.error("[packaged-onboarding] FAIL", error);
  const diagnosticLogs = [first, reopened]
    .flatMap((instance) => instance?.logs.join("").split(/\r?\n/) ?? [])
    .filter((line) => /\[leemo:main\] (secrets source|providers:|persistence:)/.test(line))
    .map((line) => line.replaceAll(apiKey, "[REDACTED]"));
  const secretFile = path.join(USER_DATA_DIR, "leemo-secrets.enc");
  console.error("[packaged-onboarding] diagnostic", {
    expectedSecretFileExists: fs.existsSync(secretFile),
    expectedSecretFileBytes: fs.existsSync(secretFile) ? fs.statSync(secretFile).size : 0,
    log: diagnosticLogs,
  });
  if (reopened?.page) {
    await screenshot(reopened.page, "onboarding-r8-valid-failure.png").catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await stop(first).catch(() => {});
  await stop(reopened).catch(() => {});
  const resolved = path.resolve(TEMP_ROOT);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("leemo-packaged-onboarding-")) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* process release can lag */ }
  }
}
