// Packaged r9 continuity acceptance. Runs the real unpacked packaged binary,
// redirects both Electron data and ~/Leemo into one validated temp root, drives
// user-visible controls, restarts the same isolated profile, then removes it.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { parseEnv } = require("node:util");

let chromium;

const ROOT = path.resolve(__dirname, "..");
const PACKAGED_EXE = path.resolve(process.argv[2] || path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe"));
const SETUP = path.resolve(process.argv[3] || path.join(ROOT, "dist-package", "Leemo Setup 0.0.1.exe"));
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "r9b-packaged-continuity-facts.json");
const STATE_PATH = path.join(OUTPUT_DIR, "r9b-packaged-continuity-state.json");
const LOCK_PATH = path.join(OUTPUT_DIR, "r9b-packaged-continuity.lock");
let TEMP_PARENT;
let TEMP_ROOT;
let ISOLATED_HOME;
let USER_DATA_DIR;
let APPDATA_DIR;
let LOCALAPPDATA_DIR;
let WORKSPACE_ROOT;
let NOTEBOOK_DIR;
let ARTIFACT_PATH;
const ORIGINAL_HOME = os.homedir();
const NONCE = Date.now().toString(36).slice(-7);
const CANCEL_MARKER = `LEEMO-CANCEL-${NONCE}`;
const NOTEBOOK = `r9-continuity-${NONCE}`;
const CWD_SENTINEL_NAME = `.leemo-e2e-cwd-${NONCE}`;
const ARTIFACT_NAME = `continuity-${NONCE}.md`;
const ARTIFACT_RELATIVE_PATH = `${NOTEBOOK}/${ARTIFACT_NAME}`;
const ARTIFACT_HEADING = `r9 连续性验收 ${NONCE}`;
const ARTIFACT_TABLE = [
  "| 字段 | 内容 |",
  "| --- | --- |",
  `| 标识 | ${NONCE} |`,
];
const BROKEN_PROVIDER_ID = `r9-broken-${NONCE}`;
const BROKEN_MODEL_ID = `broken-model-${NONCE}`;
const FLAGS = [
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
];
const SCREENSHOTS = [
  "r9b-packaged-success-artifact.png",
  "r9b-packaged-after-restart.png",
  "r9b-packaged-failed-state.png",
  "r9b-packaged-canceled-state.png",
  "r9b-packaged-canceled-after-restart.png",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const insist = (value, message) => {
  if (!value) throw new Error(message);
};

function errorDetails(error, depth = 0) {
  if (depth > 5) return "(error cause depth exceeded)";
  if (error instanceof AggregateError) {
    const own = error.stack || error.message;
    const causes = [...error.errors].map(
      (cause, index) => `\nCaused by [${index + 1}]:\n${errorDetails(cause, depth + 1)}`,
    );
    return `${own}${causes.join("")}`;
  }
  if (error instanceof Error) {
    const own = error.stack || error.message;
    return error.cause ? `${own}\nCaused by:\n${errorDetails(error.cause, depth + 1)}` : own;
  }
  return String(error);
}

function stage(label) {
  console.log(`[r9-continuity] stage: ${label}`);
}

function initializeIsolationPaths() {
  // Electron resolves os.tmpdir() from TEMP/TMP. Give the child this dedicated
  // parent, then pass one direct child to the main-process isolation validator.
  TEMP_PARENT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-e2e-parent-"));
  TEMP_ROOT = fs.mkdtempSync(path.join(TEMP_PARENT, "leemo-e2e-r9-continuity-"));
  ISOLATED_HOME = path.join(TEMP_ROOT, "home");
  USER_DATA_DIR = path.join(TEMP_ROOT, "user-data");
  APPDATA_DIR = path.join(TEMP_ROOT, "appdata");
  LOCALAPPDATA_DIR = path.join(TEMP_ROOT, "localappdata");
  WORKSPACE_ROOT = path.join(ISOLATED_HOME, "Leemo");
  NOTEBOOK_DIR = path.join(WORKSPACE_ROOT, NOTEBOOK);
  ARTIFACT_PATH = path.join(NOTEBOOK_DIR, ARTIFACT_NAME);
}

function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}

function hostUtilityEnvironment() {
  const inherited = [
    "SystemRoot", "WINDIR", "ComSpec", "Path", "PATH", "PATHEXT",
    "ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS", "OS", "TEMP", "TMP",
  ];
  const env = {};
  for (const name of inherited) {
    if (typeof process.env[name] === "string") env[name] = process.env[name];
  }
  return env;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
  ], { env: hostUtilityEnvironment(), windowsHide: true, stdio: "ignore" });
  return result.status === 0;
}

function acquireEvidenceLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(LOCK_PATH, "wx");
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
        fs.fsyncSync(descriptor);
        return descriptor;
      } catch (error) {
        fs.closeSync(descriptor);
        fs.rmSync(LOCK_PATH, { force: true });
        throw error;
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
      } catch {
        owner = undefined;
      }
      if (processExists(Number(owner?.pid))) {
        throw new Error(`另一个连续性验收仍在运行（PID ${owner.pid}）`);
      }
      // A contender can observe the file in the tiny window between exclusive
      // creation and owner metadata being flushed. Treat a fresh unreadable
      // lock as initializing instead of deleting a live run's lock.
      if (!owner && Date.now() - fs.statSync(LOCK_PATH).mtimeMs < 10_000) {
        throw new Error("另一个连续性验收正在初始化");
      }
      fs.rmSync(LOCK_PATH, { force: true });
    }
  }
  throw new Error("无法取得连续性验收锁");
}

function releaseEvidenceLock(descriptor) {
  if (descriptor === undefined) return;
  fs.closeSync(descriptor);
  fs.rmSync(LOCK_PATH, { force: true });
}

function safeRemove(target, expectedParent, prefix) {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(expectedParent) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error(`拒绝删除未验证路径：${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function safeRemoveEventually(target, expectedParent, prefix) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      safeRemove(target, expectedParent, prefix);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error?.code)) throw error;
      await sleep(500);
    }
  }
  throw lastError;
}

function directoryStats(root) {
  let files = 0;
  let bytes = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(candidate).size;
      }
    }
  }
  return { files, bytes };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function loadTestProvider() {
  const envPath = path.join(ROOT, ".env");
  insist(fs.existsSync(envPath), "仓库 .env 不存在，无法选择测试 Provider");
  const fileEnv = parseEnv(fs.readFileSync(envPath, "utf8"));
  const candidates = [
    { id: "deepseek", keyName: "DEEPSEEK_API_KEY" },
    { id: "glm", keyName: "GLM_API_KEY" },
    { id: "kimi", keyName: "KIMI_API_KEY" },
    { id: "qwen", keyName: "DASHSCOPE_API_KEY" },
  ];
  const selected = candidates.find(({ keyName }) => typeof fileEnv[keyName] === "string" && fileEnv[keyName].length >= 8);
  insist(selected, "仓库 .env 没有可用于打包验收的 Provider key");
  const secretValues = Object.entries({ ...process.env, ...fileEnv })
    .filter(([key, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(key) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => value);
  return { id: selected.id, apiKey: fileEnv[selected.keyName], secretValues };
}

function appEnvironment() {
  const inherited = [
    "SystemRoot", "WINDIR", "ComSpec", "Path", "PATH", "PATHEXT",
    "ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS", "OS",
  ];
  const env = {};
  for (const name of inherited) {
    if (typeof process.env[name] === "string") env[name] = process.env[name];
  }
  env.USERPROFILE = ISOLATED_HOME;
  env.HOME = ISOLATED_HOME;
  env.APPDATA = APPDATA_DIR;
  env.LOCALAPPDATA = LOCALAPPDATA_DIR;
  env.TEMP = TEMP_PARENT;
  env.TMP = TEMP_PARENT;
  env.USERNAME = "LeemoE2E";
  env.HOMEDRIVE = path.parse(ISOLATED_HOME).root.replace(/[\\/]$/, "");
  env.HOMEPATH = ISOLATED_HOME.slice(env.HOMEDRIVE.length);
  return env;
}

function processTreeMemory(pid) {
  const command = [
    `$rootPid=${Number(pid)}`,
    "$all=Get-CimInstance Win32_Process",
    "$ids=@($rootPid)",
    "do {$children=@($all | Where-Object {$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId} | Select-Object -ExpandProperty ProcessId);$before=$ids.Count;$ids=@($ids+$children | Select-Object -Unique)} while($ids.Count -gt $before)",
    "$procs=@(Get-Process -Id $ids -ErrorAction SilentlyContinue)",
    "[pscustomobject]@{processes=$procs.Count;workingSetBytes=($procs | Measure-Object WorkingSet64 -Sum).Sum} | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    env: hostUtilityEnvironment(),
    windowsHide: true,
  });
  try {
    return JSON.parse((result.stdout || "").trim());
  } catch {
    return { processes: null, workingSetBytes: null, error: (result.stderr || "memory probe failed").trim() };
  }
}

async function connect(port) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((target) => target.type === "page" && /^file:/.test(target.url))) break;
    } catch {
      // Electron is still starting.
    }
    await sleep(300);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => /^file:/.test(candidate.url()));
  if (!page) throw new Error("打包渲染端没有出现 file:// 页面");
  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");
  return { browser, page };
}

function runPowerShell(command, label) {
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    env: hostUtilityEnvironment(),
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || `exit ${result.status}`).trim();
    throw new Error(`${label}失败：${detail}`);
  }
  return result.stdout || "";
}

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseProcessIds(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\r?\n/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseProcessIdentities(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  return trimmed.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\|(.+)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    return Number.isInteger(pid) && pid > 0 ? [{ pid, createdAt: match[2] }] : [];
  });
}

function descendantProcessIdentities(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
  const command = [
    `$rootPid=${rootPid}`,
    "$all=@(Get-CimInstance Win32_Process)",
    "$ids=@($rootPid)",
    "do {$children=@($all | Where-Object {$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId} | Select-Object -ExpandProperty ProcessId);$before=$ids.Count;$ids=@($ids+$children | Select-Object -Unique)} while($ids.Count -gt $before)",
    "$all | Where-Object {$ids -contains $_.ProcessId} | ForEach-Object {\"$($_.ProcessId)|$($_.CreationDate.ToUniversalTime().Ticks)\"}",
  ].join("; ");
  return parseProcessIdentities(runPowerShell(command, "枚举应用进程树"));
}

function activeKnownProcessIds(processes) {
  const entries = [...processes.entries()]
    .filter(([pid, createdAt]) => Number.isInteger(pid) && pid > 0 && typeof createdAt === "string" && createdAt);
  if (entries.length === 0) return [];
  const expected = entries.map(([pid, createdAt]) => `${pid}=${powershellLiteral(createdAt)}`).join(";");
  const command = [
    `$expected=@{${expected}}`,
    "Get-CimInstance Win32_Process | Where-Object {$id=[int]$_.ProcessId;$created=[string]$_.CreationDate.ToUniversalTime().Ticks;$expected.ContainsKey($id) -and $expected[$id] -eq $created} | Select-Object -ExpandProperty ProcessId",
  ].join("; ");
  return parseProcessIds(runPowerShell(command, "检查应用进程残留"));
}

function commandLineProcessIds(marker, label = "检查命令行进程") {
  const command = `$needle=${powershellLiteral(marker)}; Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($needle)} | Select-Object -ExpandProperty ProcessId`;
  return parseProcessIds(runPowerShell(command, label));
}

function trackDescendants(instance) {
  if (!instance?.child?.pid) return;
  for (const processIdentity of descendantProcessIdentities(instance.child.pid)) {
    instance.trackedProcesses.set(processIdentity.pid, processIdentity.createdAt);
  }
}

function isolatedProcessIds(instance) {
  const tracked = instance ? activeKnownProcessIds(instance.trackedProcesses) : [];
  const marked = commandLineProcessIds(`--leemo-e2e-root=${TEMP_ROOT}`, "检查 E2E 标记进程");
  return [...new Set([...tracked, ...marked])];
}

function forceKillTree(child) {
  if (!child || child.exitCode !== null) return;
  const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
    encoding: "utf8",
    env: hostUtilityEnvironment(),
    windowsHide: true,
  });
  if (result.error) throw result.error;
}

function forceKillPids(ids) {
  for (const pid of [...new Set(ids)]) {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      encoding: "utf8",
      env: hostUtilityEnvironment(),
      windowsHide: true,
    });
    if (result.error) throw result.error;
  }
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    sleep(timeoutMs).then(() => false),
  ]);
}

async function waitForLog(logs, pattern, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = logs.join("");
    if (pattern.test(output)) return output;
    await sleep(100);
  }
  throw new Error(`主进程未输出隔离证明：${pattern}`);
}

async function launch(executable, label) {
  const port = await findFreePort();
  const logs = [];
  const startedAt = Date.now();
  const child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, `--leemo-e2e-root=${TEMP_ROOT}`, ...FLAGS],
    {
      cwd: TEMP_ROOT,
      env: appEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const collect = (chunk) => logs.push(chunk.toString());
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const spawnFailure = new Promise((_, reject) => {
    child.once("error", (error) => reject(new Error(`打包应用启动失败：${error.message}`, { cause: error })));
  });
  const earlyExit = new Promise((_, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`打包应用在连接前退出：code=${code ?? "null"}, signal=${signal ?? "none"}`));
    });
  });
  let connection;
  try {
    connection = await Promise.race([connect(port), spawnFailure, earlyExit]);
    await connection.page.locator('textarea[aria-label="输入消息"]').waitFor({ state: "visible", timeout: 90_000 });
    const output = await waitForLog(logs, /\[leemo:main\] E2E isolation:/);
    insist(output.includes(`home=${ISOLATED_HOME}`), "主进程没有采用隔离 home");
    insist(output.includes(`userData=${USER_DATA_DIR}`), "主进程没有采用隔离 userData");
    const workspace = await connection.page.evaluate(async () => {
      const response = await window.leemoWorkspace.invoke("listNotebooks", undefined);
      if (!response.ok) throw new Error(response.error || "listNotebooks failed");
      return response.response.root;
    });
    insist(path.resolve(workspace) === path.resolve(WORKSPACE_ROOT), `工作区未隔离：${workspace}`);
    const startupMs = Date.now() - startedAt;
    console.log(`[r9-continuity] ${label} ready in ${(startupMs / 1000).toFixed(1)}s`);
    const instance = { child, logs, startupMs, trackedProcesses: new Map(), ...connection };
    trackDescendants(instance);
    return instance;
  } catch (error) {
    await connection?.browser?.close().catch(() => {});
    try { forceKillTree(child); } catch {}
    await waitForChildExit(child, 5_000);
    throw error;
  }
}

async function stop(instance) {
  if (!instance) return;
  trackDescendants(instance);
  if (instance.child.exitCode === null) {
    await instance.page.close({ runBeforeUnload: true }).catch(() => {});
    const graceful = await waitForChildExit(instance.child, 12_000);
    if (!graceful) {
      forceKillTree(instance.child);
      await waitForChildExit(instance.child, 5_000);
    }
  }
  await instance.browser.close().catch(() => {});
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && isolatedProcessIds(instance).length > 0) await sleep(250);
  let residue = isolatedProcessIds(instance);
  if (residue.length > 0) {
    forceKillPids(residue);
    const forcedDeadline = Date.now() + 5_000;
    while (Date.now() < forcedDeadline && isolatedProcessIds(instance).length > 0) await sleep(250);
    residue = isolatedProcessIds(instance);
  }
  insist(residue.length === 0, `隔离进程树未退出：${residue.join(",")}`);
}

async function waitForCommandMarker(marker, present, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let matches = [];
  while (Date.now() < deadline) {
    matches = commandLineProcessIds(marker, "检查中断验收子进程");
    if ((present && matches.length > 0) || (!present && matches.length === 0)) return matches;
    await sleep(200);
  }
  throw new Error(present
    ? `没有观察到中断验收命令进程：${marker}`
    : `中断后命令进程仍在运行：${matches.join(",")}`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), animations: "disabled" });
}

async function ensureWorkbench(page) {
  if (await page.getByTestId("workbench-shell").isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "切换到工作台", exact: true }).click();
  await page.getByTestId("workbench-shell").waitFor({ state: "visible" });
}

async function verifyModelAvailable(page, modelId) {
  const picker = page.getByRole("button", { name: "切换模型", exact: true });
  await picker.click();
  const escapedModelId = modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const option = page.getByRole("button", { name: new RegExp(`^${escapedModelId}(?:\\s|$)`) });
  try {
    await option.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const visibleButtons = (await page.getByRole("button").allTextContents())
      .map((label) => label.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(-30);
    throw new Error(`模型菜单没有出现 ${modelId}；可见按钮：${visibleButtons.join(" | ")}`, { cause: error });
  }
  await picker.click();
}

async function selectNotebook(page, notebook) {
  const selector = page.getByRole("button", { name: /^选择本子，当前 / });
  const expected = `选择本子，当前 ${notebook}`;
  if ((await selector.getAttribute("aria-label")) === expected) return;
  await selector.click();
  await page.getByRole("menuitem", { name: `打开本子 ${notebook}` }).click();
  await page.getByRole("button", { name: expected }).waitFor({ state: "visible", timeout: 30_000 });
}

async function createConversation(page, notebook) {
  await ensureWorkbench(page);
  if (notebook) await selectNotebook(page, notebook);
  await page.getByRole("button", { name: "新建对话" }).click();
  await page.getByTestId("workbench-context-title").filter({ hasText: "新对话" }).waitFor({ state: "visible" });
}

async function submit(page, prompt) {
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送" }).click();
}

async function visibleApprovalCard(page) {
  const cards = page.getByTestId("approval-card-pending");
  const visible = [];
  for (let index = 0; index < await cards.count(); index += 1) {
    const candidate = cards.nth(index);
    if (await candidate.isVisible()) visible.push(candidate);
  }
  insist(visible.length <= 1, `同时出现 ${visible.length} 个待审批请求，拒绝自动放行`);
  return visible[0];
}

async function approvalCardData(card) {
  return {
    approvalId: await card.getAttribute("data-approval-id"),
    runId: await card.getAttribute("data-run-id"),
    conversationId: await card.getAttribute("data-conversation-id"),
    toolName: await card.getAttribute("data-tool-name"),
    inputSummary: await card.getAttribute("data-input-summary"),
  };
}

async function allowExactApproval(card, expectation) {
  const actual = await approvalCardData(card);
  insist(actual.approvalId && actual.runId && actual.conversationId, "审批请求缺少稳定身份字段");
  insist(actual.toolName === expectation.toolName, `审批工具不符：${actual.toolName}`);
  insist(actual.inputSummary === expectation.inputSummary, `审批内容不符：${actual.inputSummary}`);
  await card.getByRole("button", { name: "允许一次", exact: true }).click();
  return actual;
}

async function approveExact(page, expectation, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const card = await visibleApprovalCard(page);
    if (card) return allowExactApproval(card, expectation);
    await sleep(250);
  }
  throw new Error(`没有出现白名单审批：${expectation.toolName} / ${expectation.inputSummary}`);
}

async function waitForTerminal(page, options = {}) {
  const expected = options.expected || ["已完成", "失败", "已中断"];
  const deadline = Date.now() + (options.timeoutMs || 180_000);
  let approvals = 0;
  while (Date.now() < deadline) {
    const card = await visibleApprovalCard(page);
    if (card) {
      insist(options.approval, "出现了未声明的审批请求，拒绝自动放行");
      insist(approvals === 0, "同一验收任务出现了超出白名单的第二次审批");
      await allowExactApproval(card, options.approval);
      approvals += 1;
    }
    const snapshot = await persistenceSnapshot(page);
    const conversation = options.prompt ? conversationForPrompt(snapshot, options.prompt) : null;
    const terminal = conversation?.timeline.findLast((item) => item.kind === "result" || item.kind === "error");
    const label = terminal?.kind === "error"
      ? "失败"
      : terminal?.interrupted
        ? "已中断"
        : terminal?.isError
          ? "失败"
          : terminal
            ? "已完成"
            : "";
    if (expected.includes(label)) return { label, approvals };
    await sleep(250);
  }
  const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(-2_000);
  throw new Error(`等待任务终态超时；期望=${expected.join("/")}；界面末尾=${body}`);
}

async function persistenceSnapshot(page) {
  return page.evaluate(async () => {
    const response = await window.leemoPersist.invoke("loadAll", undefined);
    if (!response.ok) throw new Error(response.error || "loadAll failed");
    return response.response;
  });
}

function conversationForPrompt(snapshot, prompt) {
  return snapshot.conversations.find((conversation) =>
    conversation.timeline.some((item) => item.kind === "text" && item.role === "user" && item.text === prompt),
  );
}

async function verifyArtifactUi(page, sourceTitle) {
  await ensureWorkbench(page);
  await page.getByTitle("成果").click();
  await page.getByRole("heading", { name: "成果", exact: true }).waitFor({ state: "visible" });
  const artifactCard = page.getByTestId("artifact-card").filter({ hasText: ARTIFACT_NAME });
  await artifactCard.getByText(ARTIFACT_NAME, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await artifactCard.getByRole("button", { name: `预览 ${ARTIFACT_NAME}` }).click();
  const preview = page.getByTestId("preview-pane-column");
  await preview.waitFor({ state: "visible" });
  await preview.getByRole("heading", { name: ARTIFACT_HEADING, exact: true }).waitFor({ state: "visible" });
  await preview.locator("table").waitFor({ state: "visible" });
  await preview.getByRole("cell", { name: NONCE, exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: `回到 ${ARTIFACT_NAME} 的来源对话` }).click();
  await page.locator('textarea[aria-label="输入消息"]').waitFor({ state: "visible" });
  if (sourceTitle) {
    await page.getByTestId("workbench-context-title").filter({ hasText: sourceTitle }).waitFor({ state: "visible" });
  }
}

async function configuredProviders(page) {
  return page.evaluate(async () => {
    const response = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!response.ok) throw new Error(response.error || "listProviders failed");
    return response.response.filter((provider) => provider.configured);
  });
}

async function seedGoodProvider(page, testProvider) {
  return page.evaluate(async ({ providerId, apiKey }) => {
    const listed = await window.leemoBridge.invoke("bridge:listProviders", undefined);
    if (!listed.ok) throw new Error(listed.error || "listProviders failed");
    const spec = listed.response.find((provider) => provider.id === providerId);
    if (!spec) throw new Error(`Provider catalog missing ${providerId}`);
    const saved = await window.leemoBridge.invoke("bridge:saveProvider", {
      id: spec.id,
      kind: spec.kind,
      name: spec.name,
      baseUrl: spec.baseUrl,
      apiFormat: spec.apiFormat,
      category: spec.category,
      apiKey,
      models: spec.models,
      modelCapabilities: spec.modelCapabilities,
      capabilities: spec.capabilities,
      apiKeyUrl: spec.apiKeyUrl,
    });
    if (!saved.ok) throw new Error(saved.error || "saveProvider failed");
    const loaded = await window.leemoPersist.invoke("loadAll", undefined);
    if (!loaded.ok) throw new Error(loaded.error || "loadAll failed");
    const modelId = saved.response.models[0];
    if (!modelId) throw new Error(`${providerId} has no model`);
    const persisted = await window.leemoPersist.invoke("saveSettings", {
      ...(loaded.response.settings || {}),
      onboardingCompleted: true,
      mode: "workbench",
      defaultProviderId: saved.response.id,
      defaultModelId: modelId,
    });
    if (!persisted.ok) throw new Error(persisted.error || "saveSettings failed");
    return saved.response;
  }, { providerId: testProvider.id, apiKey: testProvider.apiKey });
}

async function selectBrokenDefault(page) {
  return page.evaluate(async ({ providerId, modelId }) => {
    const saved = await window.leemoBridge.invoke("bridge:saveProvider", {
      id: providerId,
      kind: "custom",
      name: "r9 failure probe",
      baseUrl: "http://127.0.0.1:9",
      apiFormat: "anthropic",
      category: "custom",
      apiKey: "r9-local-failure-probe",
      models: [modelId],
      capabilities: { text: true, vision: false, thinking: false },
    });
    if (!saved.ok) throw new Error(saved.error || "saveProvider failed");
    const loaded = await window.leemoPersist.invoke("loadAll", undefined);
    if (!loaded.ok) throw new Error(loaded.error || "loadAll failed");
    const next = {
      ...(loaded.response.settings || {}),
      onboardingCompleted: true,
      mode: "workbench",
      defaultProviderId: providerId,
      defaultModelId: modelId,
    };
    const persisted = await window.leemoPersist.invoke("saveSettings", next);
    if (!persisted.ok) throw new Error(persisted.error || "saveSettings failed");
    return saved.response;
  }, { providerId: BROKEN_PROVIDER_ID, modelId: BROKEN_MODEL_ID });
}

async function restoreGoodDefault(page, providerId, modelId) {
  await page.evaluate(async ({ badProviderId, providerId: goodProviderId, modelId: goodModelId }) => {
    const loaded = await window.leemoPersist.invoke("loadAll", undefined);
    if (!loaded.ok) throw new Error(loaded.error || "loadAll failed");
    const persisted = await window.leemoPersist.invoke("saveSettings", {
      ...(loaded.response.settings || {}),
      onboardingCompleted: true,
      mode: "workbench",
      defaultProviderId: goodProviderId,
      defaultModelId: goodModelId,
    });
    if (!persisted.ok) throw new Error(persisted.error || "saveSettings failed");
    const removed = await window.leemoBridge.invoke("bridge:deleteProvider", { providerId: badProviderId });
    if (!removed.ok) throw new Error(removed.error || "deleteProvider failed");
  }, { badProviderId: BROKEN_PROVIDER_ID, providerId, modelId });
}

async function main() {
  let current;
  let facts;
  let failure;
  let lockDescriptor;
  let ownsEvidence = false;
  const instances = [];
  let secretValues = [];

  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    lockDescriptor = acquireEvidenceLock();
    ownsEvidence = true;
    for (const name of SCREENSHOTS) fs.rmSync(path.join(OUTPUT_DIR, name), { force: true });
    fs.rmSync(FACTS_PATH, { force: true });
    fs.rmSync(STATE_PATH, { force: true });
    const checkedAt = new Date().toISOString();
    writeJsonAtomic(STATE_PATH, { status: "running", runId: NONCE, startedAt: checkedAt });

    ({ chromium } = require("playwright"));
    initializeIsolationPaths();
    insist(fs.existsSync(PACKAGED_EXE), `找不到打包应用：${PACKAGED_EXE}`);
    for (const target of [ISOLATED_HOME, APPDATA_DIR, LOCALAPPDATA_DIR, WORKSPACE_ROOT, NOTEBOOK_DIR]) {
      fs.mkdirSync(target, { recursive: true });
    }
    fs.writeFileSync(path.join(NOTEBOOK_DIR, CWD_SENTINEL_NAME), NONCE, "utf8");
    const testProvider = loadTestProvider();
    secretValues = testProvider.secretValues;
    const packageStats = directoryStats(path.dirname(PACKAGED_EXE));
    facts = {
      checkedAt,
      runId: NONCE,
      packagedExecutable: PACKAGED_EXE,
      installer: fs.existsSync(SETUP) ? SETUP : null,
      installerBytes: fs.existsSync(SETUP) ? fs.statSync(SETUP).size : null,
      unpackedFiles: packageStats.files,
      unpackedBytes: packageStats.bytes,
      isolatedUserData: true,
      isolatedHome: true,
      appAndUtilityEnvironmentsAllowlisted: true,
      realWorkspaceEnumeratedByHarness: false,
      temporaryNotebook: NOTEBOOK,
      artifactRelativePath: ARTIFACT_RELATIVE_PATH,
      evidence: [],
    };
    current = await launch(PACKAGED_EXE, "cold packaged start");
    instances.push(current);
    facts.coldStartupMs = current.startupMs;
    stage("seed isolated provider");
    const goodProvider = await seedGoodProvider(current.page, testProvider);
    const goodModel = goodProvider.models[0];
    insist(goodModel, `Provider ${goodProvider.id} 没有模型`);
    await current.page.reload();
    await current.page.locator('textarea[aria-label="输入消息"]').waitFor({ state: "visible", timeout: 90_000 });
    await ensureWorkbench(current.page);
    const configured = await configuredProviders(current.page);
    insist(configured.some((provider) => provider.id === goodProvider.id), "测试 Provider 没有进入隔离配置");
    const configuredSnapshot = await persistenceSnapshot(current.page);
    insist(
      configuredSnapshot.settings?.defaultProviderId === goodProvider.id
        && configuredSnapshot.settings?.defaultModelId === goodModel,
      "测试 Provider/模型没有成为隔离配置的默认值",
    );
    facts.providerId = goodProvider.id;
    facts.modelId = goodModel;
    await verifyModelAvailable(current.page, goodModel);
    stage("run successful Bash + Write task");

    const getLocationCommand = `powershell -NoProfile -Command "if (-not (Test-Path '${CWD_SENTINEL_NAME}')) { exit 41 }; (Get-Location).Path"`;
    const successPrompt = [
      "请严格按顺序完成这个真实验收任务，不要只描述：",
      `1. 必须先使用 Bash 工具执行 ${getLocationCommand}；Bash 的 command 参数必须逐字等于这段字符串，禁止添加 cd、&& 或任何前后缀；如果需要确认就停下来等我。`,
      `2. 必须使用 Write 工具在当前本子「${NOTEBOOK}」根目录创建文件「${ARTIFACT_NAME}」。`,
      `3. 文件第一行必须是“# ${ARTIFACT_HEADING}”，并原样包含下面三行 GFM 表格：\n${ARTIFACT_TABLE.join("\n")}`,
      "4. 不要修改其它文件，写完后简短报告结果。",
    ].join("\n");
    await createConversation(current.page, NOTEBOOK);
    await submit(current.page, successPrompt);
    const successTerminal = await waitForTerminal(current.page, {
      expected: ["已完成"],
      approval: { toolName: "Bash", inputSummary: getLocationCommand },
      prompt: successPrompt,
    });
    insist(successTerminal.approvals === 1, "成功任务没有且仅有一次精确 Bash 审批");
    insist(fs.existsSync(ARTIFACT_PATH), `模型没有创建真实成果：${ARTIFACT_PATH}`);
    const artifactText = fs.readFileSync(ARTIFACT_PATH, "utf8");
    insist(artifactText.split(/\r?\n/, 1)[0] === `# ${ARTIFACT_HEADING}`, "成果第一行不是约定标题");
    insist(
      artifactText.replace(/\r\n/g, "\n").includes(ARTIFACT_TABLE.join("\n")),
      "成果没有原样包含约定的 GFM 表格",
    );
    await sleep(1_500);
    const successSnapshot = await persistenceSnapshot(current.page);
    const successConversation = conversationForPrompt(successSnapshot, successPrompt);
    insist(successConversation, "成功任务没有进入持久化时间线");
    insist(successConversation.meta.providerId === goodProvider.id && successConversation.meta.modelId === goodModel, "对话没有使用已选择的 Provider/模型");
    const successBash = successConversation.timeline.find((item) => item.kind === "tool" && item.name === "Bash");
    const successWrite = successConversation.timeline.find((item) => item.kind === "tool" && item.name === "Write");
    insist(successBash?.status === "ok" && successBash.input?.command === getLocationCommand, "时间线没有精确成功的 Bash 调用");
    const cwdOutput = (successBash.summary || "").replace(/\\\\/g, "\\").toLowerCase();
    insist(cwdOutput.includes(NOTEBOOK_DIR.toLowerCase()), `Get-Location 没有返回隔离本子路径：${successBash.summary || "(empty)"}`);
    insist(successWrite?.status === "ok" && path.resolve(successWrite.input?.file_path || "") === path.resolve(ARTIFACT_PATH), "时间线没有精确成功的 Write 调用");
    const successResult = successConversation.timeline.findLast((item) => item.kind === "result");
    insist(successResult && !successResult.isError && !successResult.interrupted, "成功任务终止事件不可信");
    const escapedWriteClaims = (successResult.pathAudit?.claimed || []).filter(
      (claim) => claim.writeClaim === true && claim.withinCwd === false,
    );
    insist(
      escapedWriteClaims.length === 0,
      `成功任务出现工作区越界告警：${escapedWriteClaims.map((claim) => claim.path).join("、")}`,
    );
    await verifyArtifactUi(current.page, successConversation.meta.title);
    insist(
      await current.page.getByText("声称写到工作区外", { exact: false }).count() === 0,
      "成功任务界面仍显示工作区越界告警",
    );
    await screenshot(current.page, "r9b-packaged-success-artifact.png");
    facts.evidence.push("r9b-packaged-success-artifact.png");
    facts.success = {
      conversationId: successConversation.meta.id,
      title: successConversation.meta.title,
      approvalsHandled: successTerminal.approvals,
      completedStatusVisible: true,
      bashVerified: true,
      conversationCwdVerified: true,
      writeVerified: true,
      noWorkspaceEscapeWarning: true,
      artifactCreated: true,
      artifactPreviewVisible: true,
      gfmTableRendered: true,
      sourceReturnVisible: true,
    };
    stage("restart and restore successful task");

    await stop(current);
    current = undefined;

    current = await launch(PACKAGED_EXE, "restart with persisted task");
    instances.push(current);
    facts.warmStartupMs = current.startupMs;
    await ensureWorkbench(current.page);
    await selectNotebook(current.page, NOTEBOOK);
    await waitForTerminal(current.page, { expected: ["已完成"], prompt: successPrompt, timeoutMs: 30_000 });
    await verifyArtifactUi(current.page, successConversation.meta.title);
    await screenshot(current.page, "r9b-packaged-after-restart.png");
    facts.evidence.push("r9b-packaged-after-restart.png");
    await sleep(3_000);
    facts.idleMemory = processTreeMemory(current.child.pid);
    facts.restart = {
      completedStatusRestored: true,
      artifactRestored: true,
      previewReopenable: true,
      sourceReturnRestored: true,
    };

    await selectBrokenDefault(current.page);
    await stop(current);
    current = undefined;

    current = await launch(PACKAGED_EXE, "isolated failure path");
    instances.push(current);
    await ensureWorkbench(current.page);
    await verifyModelAvailable(current.page, BROKEN_MODEL_ID);
    stage("run recoverable failure task");
    const failurePrompt = `制造一次可恢复的失败 ${NONCE}：只回复“不会成功”。`;
    await createConversation(current.page, NOTEBOOK);
    await submit(current.page, failurePrompt);
    const failureTerminal = await waitForTerminal(current.page, { expected: ["失败"], prompt: failurePrompt, timeoutMs: 90_000 });
    insist(failureTerminal.label === "失败", "网络失败被错误显示为完成或运行中");
    await sleep(1_200);
    const failedSnapshot = await persistenceSnapshot(current.page);
    const failedConversation = conversationForPrompt(failedSnapshot, failurePrompt);
    insist(failedConversation?.meta.bookId === NOTEBOOK, "失败任务没有留在隔离本子");
    insist(
      failedConversation.meta.providerId === BROKEN_PROVIDER_ID
        && failedConversation.meta.modelId === BROKEN_MODEL_ID,
      "失败任务没有实际使用隔离的故障 Provider/模型",
    );
    await screenshot(current.page, "r9b-packaged-failed-state.png");
    facts.evidence.push("r9b-packaged-failed-state.png");
    facts.failure = {
      conversationId: failedConversation.meta.id,
      title: failedConversation.meta.title,
      failedStatusVisible: true,
      notCompletedOrRunning: true,
    };
    await restoreGoodDefault(current.page, goodProvider.id, goodModel);
    await stop(current);
    current = undefined;

    current = await launch(PACKAGED_EXE, "restored failure and cancellation path");
    instances.push(current);
    await ensureWorkbench(current.page);
    await selectNotebook(current.page, NOTEBOOK);
    await verifyModelAvailable(current.page, goodModel);
    await waitForTerminal(current.page, { expected: ["失败"], prompt: failurePrompt, timeoutMs: 30_000 });
    stage("run and interrupt long Bash task");
    const sleepCommand = `powershell -NoProfile -Command "Start-Sleep -Seconds 30; Write-Host '${CANCEL_MARKER}'"`;
    const cancelPrompt = [
      `这是中断验收 ${NONCE}。`,
      `必须使用 Bash 工具执行 ${sleepCommand}；Bash 的 command 参数必须逐字等于这段字符串，禁止添加 cd、&& 或任何前后缀；不要改文件，命令结束后再回复。`,
    ].join("\n");
    await createConversation(current.page, NOTEBOOK);
    await submit(current.page, cancelPrompt);
    await approveExact(current.page, { toolName: "Bash", inputSummary: sleepCommand });
    const startedCancellationProcesses = await waitForCommandMarker(CANCEL_MARKER, true, 20_000);
    const stopButton = current.page.getByRole("button", { name: "停止", exact: true });
    await stopButton.waitFor({ state: "visible", timeout: 20_000 });
    await sleep(500);
    await stopButton.click();
    const cancelTerminal = await waitForTerminal(current.page, { expected: ["已中断"], prompt: cancelPrompt, timeoutMs: 60_000 });
    insist(cancelTerminal.label === "已中断", "用户中断被错误显示为完成或运行中");
    const processesAtInterruptedTerminal = commandLineProcessIds(
      CANCEL_MARKER,
      "检查中断终态出现时的命令进程",
    );
    insist(
      processesAtInterruptedTerminal.length === 0,
      `界面已显示中断，但命令进程仍在运行：${processesAtInterruptedTerminal.join(",")}`,
    );
    await screenshot(current.page, "r9b-packaged-canceled-state.png");
    facts.evidence.push("r9b-packaged-canceled-state.png");

    // Submit before polling the old process or sleeping. This is the actual
    // user race: the composer becomes available as soon as the interrupted
    // terminal arrives, so the host must already have made the old SDK tree
    // unable to share/mutate the resumed session.
    stage("send again immediately in the interrupted conversation");
    const recoveryPrompt = `停止后恢复验收 ${NONCE}：不要使用工具，只回复“已经恢复”。`;
    await submit(current.page, recoveryPrompt);
    const recoveryTerminal = await waitForTerminal(current.page, { expected: ["已完成"], prompt: recoveryPrompt, timeoutMs: 90_000 });
    insist(recoveryTerminal.label === "已完成", "停止后同一对话无法立即继续");
    await waitForCommandMarker(CANCEL_MARKER, false, 20_000);
    await sleep(1_000);
    const recoveredSnapshot = await persistenceSnapshot(current.page);
    const recoveredConversation = conversationForPrompt(recoveredSnapshot, cancelPrompt);
    insist(recoveredConversation?.meta.bookId === NOTEBOOK, "中断任务没有留在隔离本子");
    insist(
      recoveredConversation.meta.providerId === goodProvider.id
        && recoveredConversation.meta.modelId === goodModel,
      "中断任务没有实际使用恢复后的 Provider/模型",
    );
    insist(
      recoveredConversation.timeline.some(
        (item) => item.kind === "text" && item.role === "user" && item.text === recoveryPrompt,
      ),
      "停止后的恢复消息没有进入时间线",
    );
    const recoveryResults = recoveredConversation.timeline.filter((item) => item.kind === "result");
    insist(
      recoveryResults.some((item) => item.interrupted === true)
        && recoveryResults.at(-1)?.isError === false
        && recoveryResults.at(-1)?.interrupted === false,
      "停止后的时间线没有同时保留中断轮与恢复成功轮",
    );
    facts.cancellation = {
      conversationId: recoveredConversation.meta.id,
      title: recoveredConversation.meta.title,
      approvalsHandled: 1,
      commandProcessObserved: startedCancellationProcesses.length > 0,
      commandProcessTerminated: true,
      canceledStatusVisible: true,
      notCompletedOrRunning: true,
      immediateRecoveryCompleted: true,
    };

    await stop(current);
    current = undefined;
    current = await launch(PACKAGED_EXE, "restart with persisted cancellation");
    instances.push(current);
    await ensureWorkbench(current.page);
    await selectNotebook(current.page, NOTEBOOK);
    await waitForTerminal(current.page, { expected: ["已完成"], prompt: recoveryPrompt, timeoutMs: 30_000 });
    stage("verify cancellation after restart");
    const restartedRecoverySnapshot = await persistenceSnapshot(current.page);
    const restartedRecoveryConversation = conversationForPrompt(restartedRecoverySnapshot, cancelPrompt);
    const restartedRecoveryResults = restartedRecoveryConversation?.timeline.filter((item) => item.kind === "result") || [];
    insist(
      restartedRecoveryResults.some((item) => item.interrupted === true)
        && restartedRecoveryResults.at(-1)?.isError === false
        && restartedRecoveryResults.at(-1)?.interrupted === false,
      "重启后没有同时恢复中断轮与后续成功轮",
    );
    await screenshot(current.page, "r9b-packaged-canceled-after-restart.png");
    facts.evidence.push("r9b-packaged-canceled-after-restart.png");
    facts.cancellation.interruptedAndRecoveryRestoredAfterRestart = true;
    await stop(current);
    current = undefined;

    const allLogs = instances.flatMap((instance) => instance.logs).join("");
    const scannedEvidence = `${allLogs}\n${artifactText}\n${JSON.stringify([successSnapshot, failedSnapshot, recoveredSnapshot, restartedRecoverySnapshot])}`;
    facts.secretLeakDetected = secretValues.some((secret) => scannedEvidence.includes(secret));
    insist(!facts.secretLeakDetected, "Provider 或宿主密钥出现在日志、时间线或成果中");
    const normalizedEvidence = scannedEvidence.replace(/\\\\/g, "\\").toLowerCase();
    const realWorkspaceText = path.join(ORIGINAL_HOME, "Leemo").toLowerCase();
    facts.realWorkspacePathDetectedInEvidence = normalizedEvidence.includes(realWorkspaceText);
    insist(!facts.realWorkspacePathDetectedInEvidence, "日志、时间线或成果中出现了真实用户本子路径");
  } catch (error) {
    failure = error;
  }

  try {
    await stop(current);
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "验收失败，且应用清理失败")
      : error;
  }
  current = undefined;

  if (TEMP_ROOT) {
    try {
      let residue = commandLineProcessIds(`--leemo-e2e-root=${TEMP_ROOT}`, "最终检查 E2E 进程残留");
      if (residue.length > 0) {
        forceKillPids(residue);
        await sleep(1_000);
        residue = commandLineProcessIds(`--leemo-e2e-root=${TEMP_ROOT}`, "复查 E2E 进程残留");
      }
      insist(residue.length === 0, `验收结束后仍有 E2E 进程：${residue.join(",")}`);
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], "验收失败，且仍有进程残留")
        : error;
    }
  }

  if (TEMP_PARENT) {
    try {
      await safeRemoveEventually(TEMP_PARENT, os.tmpdir(), "leemo-e2e-parent-");
      if (facts) facts.temporaryIsolationRemoved = !fs.existsSync(TEMP_PARENT);
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], "验收失败，且临时隔离目录清理失败")
        : error;
    }
  }

  if (!failure && facts) {
    try {
      writeJsonAtomic(FACTS_PATH, facts);
      writeJsonAtomic(STATE_PATH, { status: "succeeded", runId: NONCE, finishedAt: new Date().toISOString() });
    } catch (error) {
      failure = error;
    }
  }

  const writeFailureEvidence = () => {
    if (!ownsEvidence) return;
    fs.rmSync(FACTS_PATH, { force: true });
    const fallback = failure ? errorDetails(failure) : "验收未完成";
    const redacted = secretValues.reduce((text, secret) => text.split(secret).join("[REDACTED]"), fallback);
    writeJsonAtomic(STATE_PATH, { status: "failed", runId: NONCE, error: redacted });
  };
  if (failure || !facts) writeFailureEvidence();

  let releaseFailure = false;
  try {
    releaseEvidenceLock(lockDescriptor);
    lockDescriptor = undefined;
  } catch (error) {
    releaseFailure = true;
    failure = failure
      ? new AggregateError([failure, error], "验收失败，且验收锁清理失败")
      : error;
  }
  if (releaseFailure) writeFailureEvidence();

  if (failure || !facts) {
    const rawFailure = failure ? errorDetails(failure) : "验收未完成";
    const redactedFailure = secretValues.reduce(
      (text, secret) => text.split(secret).join("[REDACTED]"),
      rawFailure,
    );
    console.error(`[r9-continuity] FAIL ${redactedFailure}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(facts, null, 2));
  }
}

main().catch(() => {
  console.error("[r9-continuity] 未处理的验收失败；为避免泄露密钥，不输出原始异常");
  process.exitCode = 1;
});
