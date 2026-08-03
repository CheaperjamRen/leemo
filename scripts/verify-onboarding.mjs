// Reproducible first-run acceptance for the real Electron app.
//
// The harness launches with isolated userData, strips provider environment
// variables, and runs from a temporary cwd so the repository's development
// .env cannot silently turn a "fresh install" into an existing configured
// account. Electron's Windows `home` path cannot be redirected by environment
// variables (see probe-fresh-home.mjs), so this zero-cost failure path never
// advances to starter-notebook creation; that missing-only write is covered by
// host tests. Here we exercise automatic open, disabled submit without a key,
// a rejected fake key, no accidental save, and reappearing after "later" plus
// an app restart.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import electronPath from "electron";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_PORT = Number(process.env.LEEMO_ONBOARDING_VITE_PORT ?? 5198);
const CDP_PORT = Number(process.env.LEEMO_ONBOARDING_CDP_PORT ?? 9335);
const RENDERER_URL = `http://localhost:${VITE_PORT}`;
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "onboarding-r8-facts.json");
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-onboarding-verify-"));
const USER_DATA_DIR = path.join(TEMP_ROOT, "user-data");

fs.mkdirSync(USER_DATA_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const children = new Set();
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function insist(value, message) {
  if (!value) throw new Error(message);
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

function cleanup() {
  for (const child of children) killTree(child);
  const tempParent = path.resolve(os.tmpdir());
  const resolved = path.resolve(TEMP_ROOT);
  if (path.dirname(resolved) === tempParent && path.basename(resolved).startsWith("leemo-onboarding-verify-")) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(300);
  }
  throw new Error(`Vite did not start at ${url}`);
}

function startVite() {
  const child = spawn("npm", ["run", "dev", "--", "--port", String(VITE_PORT), "--strictPort"], {
    cwd: ROOT,
    shell: process.platform === "win32",
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.add(child);
  return child;
}

function isolatedEnvironment() {
  const env = {
    ...process.env,
    LEEMO_RENDERER_URL: RENDERER_URL,
  };
  for (const key of [
    "DEEPSEEK_API_KEY", "DEEPSEEK_MODEL",
    "GLM_API_KEY", "GLM_MODEL",
    "KIMI_API_KEY", "KIMI_MODEL",
    "DASHSCOPE_API_KEY", "QWEN_MODEL", "QWEN_BASE_URL",
  ]) delete env[key];
  return env;
}

async function connectToRenderer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      if (targets.some((target) => target.type === "page" && target.url.startsWith(RENDERER_URL))) break;
    } catch {
      // Electron is still starting.
    }
    await sleep(300);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const page = browser.contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(RENDERER_URL));
  if (!page) throw new Error("Could not find the isolated Electron renderer");
  await page.waitForLoadState("domcontentloaded");
  return { browser, page };
}

async function startElectron(label) {
  const logs = [];
  const child = spawn(
    electronPath,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DATA_DIR}`,
      "--disable-features=CalculateNativeWinOcclusion",
      "--disable-backgrounding-occluded-windows",
      path.join(ROOT, "dist-electron", "main.mjs"),
    ],
    {
      cwd: TEMP_ROOT,
      env: isolatedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.add(child);
  const collect = (chunk) => {
    const text = chunk.toString();
    logs.push(text);
    process.stdout.write(text);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("exit", () => children.delete(child));
  const connection = await connectToRenderer();
  console.log(`[onboarding] Electron ready (${label})`);
  return { child, logs, ...connection };
}

async function stopElectron(instance) {
  await instance.browser.close().catch(() => {});
  const exited = new Promise((resolve) => instance.child.once("exit", resolve));
  killTree(instance.child);
  await Promise.race([exited, sleep(8_000)]);
  children.delete(instance.child);
  await sleep(600);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), animations: "disabled" });
}

let first;
let second;
try {
  startVite();
  await import("./build-main.mjs");
  await waitForUrl(RENDERER_URL);

  first = await startElectron("fresh profile");
  const dialog = first.page.getByRole("dialog", { name: "首次设置" });
  await dialog.waitFor({ state: "visible" });

  const deepSeek = dialog.getByRole("button", { name: /DeepSeek/ });
  const apiKeyInput = dialog.getByRole("textbox", { name: "API Key" });
  const modelSelect = dialog.getByRole("combobox", { name: "用于对话的模型" });
  const continueButton = dialog.getByRole("button", { name: "测试并继续" });
  const apiKeyLink = dialog.getByRole("link", { name: /获取 API Key/ });
  const initialFacts = {
    viewport: await first.page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })),
    dialog: await dialog.evaluate((element) => {
      const rect = element.firstElementChild?.getBoundingClientRect();
      return rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null;
    }),
    selectedProvider: await deepSeek.getAttribute("aria-pressed"),
    recommendedVisible: await dialog.getByText("推荐", { exact: true }).isVisible(),
    providerCount: await dialog.locator('section[aria-label="模型供应商"] button').count(),
    apiKeyLink: await apiKeyLink.getAttribute("href"),
    modelOptions: await modelSelect.locator("option").allTextContents(),
    continueDisabledWithoutKey: await continueButton.isDisabled(),
  };
  insist(initialFacts.selectedProvider === "true", "DeepSeek is not selected on first run");
  insist(initialFacts.recommendedVisible, "DeepSeek recommendation is not visible");
  insist(initialFacts.providerCount >= 4, "Provider choices are missing");
  insist(initialFacts.continueDisabledWithoutKey, "Connection test is enabled without an API key");
  insist(initialFacts.apiKeyLink?.startsWith("https://"), "API key guide link is missing");
  insist(initialFacts.modelOptions.length > 0, "Default model choices are missing");
  await screenshot(first.page, "onboarding-r8-connect.png");

  await apiKeyInput.fill("leemo-invalid-onboarding-acceptance-key");
  await continueButton.click();
  const alert = dialog.getByRole("alert");
  await alert.waitFor({ state: "visible", timeout: 90_000 });
  const invalidKeyError = (await alert.innerText()).trim();
  insist(invalidKeyError.length > 0, "Invalid key failure has no user-facing explanation");
  insist(!(await dialog.getByText("momo 已经准备好了").count()), "Invalid key advanced to the ready stage");
  await screenshot(first.page, "onboarding-r8-invalid-key.png");

  await dialog.getByRole("button", { name: "稍后配置" }).click();
  await dialog.waitFor({ state: "hidden" });
  const firstLogs = first.logs.join("");
  insist(/providers:\s*0 家已配置/.test(firstLogs), "Fresh profile unexpectedly inherited a configured provider");
  await stopElectron(first);
  first = undefined;

  second = await startElectron("after later + restart");
  const reopened = second.page.getByRole("dialog", { name: "首次设置" });
  await reopened.waitFor({ state: "visible" });
  const secondLogs = second.logs.join("");
  insist(/providers:\s*0 家已配置/.test(secondLogs), "Rejected key was unexpectedly saved across restart");
  await screenshot(second.page, "onboarding-r8-reopened.png");

  const facts = {
    checkedAt: new Date().toISOString(),
    isolatedUserData: true,
    configuredProvidersAtStart: 0,
    billableModelCalls: 0,
    connectionAttempts: 1,
    workspaceWritePathReached: false,
    initial: initialFacts,
    invalidKey: {
      stayedOnConnectStage: true,
      error: invalidKeyError,
      providerSaved: false,
    },
    laterConfiguration: {
      closedWithoutCompleting: true,
      reopenedAfterRestart: true,
    },
    evidence: [
      "onboarding-r8-connect.png",
      "onboarding-r8-invalid-key.png",
      "onboarding-r8-reopened.png",
    ],
  };
  fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  console.error("[onboarding] FAIL", error);
  process.exitCode = 1;
} finally {
  if (first) await stopElectron(first).catch(() => {});
  if (second) await stopElectron(second).catch(() => {});
  cleanup();
}
