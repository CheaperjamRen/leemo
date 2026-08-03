import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  type OpenDialogOptions,
} from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { atomicReplaceTextFile } from "./atomic-text-file";
import { attachUnsavedDraftGuard } from "./unsaved-draft-guard";
import { createBridgeHost, type BridgeHost } from "../host/bridge-host";
import { buildCatalog } from "../host/provider-catalog";
import {
  createMemoryGovernance,
  type MemoryGovernance,
  type MemoryIO,
  type MemoryScope,
} from "../host/memory-governance";
import { ensureSkillsPlugin, skillsRootFor, type SkillsIO } from "../host/skills";
import { createSkillAdminService } from "../host/skill-admin-service";
import {
  workspaceRootFor,
  ensureWorkspace,
  migrateLegacyInbox,
  routeRootWritePath,
  listNotebooks,
  createNotebook,
  ensureStarterNotebook,
  readTree,
  dropFiles,
  moveFile,
  suggestNotebook,
  readTextFile,
  readPreview,
  writeMarkdownFile,
  resolveInside,
  planWorkspaceReveal,
  type WorkspaceIO,
} from "../host/workspace";
import { loadOrMigrateSecrets, saveSecrets, type SecretsIO } from "./secrets";
import type { ProviderConfigFile } from "../host/provider-config";
import { openDatabase } from "./persistence/db";
import { createPersistence, type Persistence } from "./persistence/schema";
import {
  createRegisteredWorkspacePersistence,
} from "./persistence/workspace-persistence";
import { resolveCliBinary } from "./cli-binary";
import { createOfficeSkillProvisioner } from "./office-skill-provisioner";
import { createBundledSkillProvisioner } from "./bundled-skill-provisioner";
import { migrateLegacySkills } from "./skill-path-migration";
import {
  buildComputerMcpRuntime,
  buildPlaywrightMcpRuntime,
  detectBrowserChannel,
  resolveComputerMcpExecutable,
} from "./mcp-runtime";
import type { BridgeInvokeMap } from "../bridge/contract";
import { applyE2EIsolationFromArgv, resolveE2EWorkspaceCandidate } from "./e2e-isolation";
import {
  HOME_WORKSPACE_ID,
  createWorkspaceRegistry,
  registerPickedWorkspace,
} from "./workspace-registry";
import { createScheduledTaskScheduler, type ScheduledTaskScheduler } from "./scheduled-task-scheduler";
import {
  assertClipboardImageDimensions,
  cleanupStaleClipboardAttachments,
  isOwnedClipboardPngPath,
  releaseClipboardPng,
  stageClipboardPng,
} from "./clipboard-attachment";
import {
  nextRunAtForSchedule,
  normalizeScheduledTaskDraft,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskRun,
} from "../scheduled-tasks";
import { createLearningService } from "./learning-service";
import type { LearningProfileDraft } from "../learning";
import {
  resolveBundledSkillRoot,
  resolveOfficeBundleRoot,
} from "./bundled-resource-roots";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // dist-electron/
const NODE_REQUIRE = createRequire(import.meta.url);
const E2E_ISOLATION = applyE2EIsolationFromArgv(app, process.argv, os.tmpdir());
const E2E_WORKSPACE_CANDIDATE = resolveE2EWorkspaceCandidate(process.argv, E2E_ISOLATION?.root);
const CLIPBOARD_ATTACHMENT_SESSION_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const CLIPBOARD_ATTACHMENT_PROTECTED_PREFIX = `${CLIPBOARD_ATTACHMENT_SESSION_ID}-`;
const HAS_SINGLE_INSTANCE_LOCK = Boolean(E2E_ISOLATION) || app.requestSingleInstanceLock();
if (!HAS_SINGLE_INSTANCE_LOCK) app.quit();
if (E2E_ISOLATION) {
  console.log(
    `[leemo:main] E2E isolation: home=${E2E_ISOLATION.home}, userData=${E2E_ISOLATION.userData}`,
  );
}

// ── 为什么 dev 下 userData 仍叫 "Electron"（轮 4 卡 H 顺手项，实证后决定不改）──
//
// 现象：dev 下 `app.getName()` 是 Electron 默认名，userData 落在
// `%APPDATA%\Electron\`。目录名难看，也与别的 Electron 应用共用路径。
//
// 试过、都不成：
//  • package.json 加 `productName` → dev 无效（Electron 读的是它自己那份
//    package.json，`app.getName()` 仍是 Electron）。
//  • `app.setName()` 放 whenReady 里 → 太晚，userData 已解析完，仍是 Electron。
//  • `app.setName()` 放模块顶层 → 路径确实变 Leemo，但**加密件全部解不开**：
//    Windows DPAPI 的密钥派生绑 app 身份且在进程初始化时定死。实机第一次就栽在
//    这儿：文件搬过去了，日志里 `secrets source` 从 encrypted 掉成 env-plaintext。
//  • ready 之后把名字临时改回旧值再解密 → 同样失败（不是每次调用现读身份）。
//
// 于是同一进程内无解。剩下的路是"起子进程用旧身份解密、把明文管道回来"——
// 为了一个装饰性的目录名，去搭一套进程间传明文密钥的机制，不值得。
//
// 而这个问题**对真实用户不存在**：electron-builder.yml 里 `productName: Leemo`
// 本来就有，打包产物的 app 名原生就是 Leemo，全新安装也没有旧加密件要迁。它只
// 影响我这台开发机的既有数据。故 dev 保持现状，迁移模块（src/main/userdata-
// migration.ts，含 DPAPI 两步与 17 条测试）留着 —— 打包里程碑真要迁历史数据时
// 用得上，届时可以从"打包后的新身份进程 + 一次性导入"这条路走。


/** Synchronous fs seam handed to loadOrMigrateSecrets. */
const nodeIO: SecretsIO = {
  exists: (p) => fs.existsSync(p),
  read: (p) => fs.readFileSync(p),
  write: (p, data) => fs.writeFileSync(p, data),
};

/** Where per-provider SDK state (CLAUDE_CONFIG_DIR) lives. Dev reuses the repo's
 *  gitignored .leemo-workspace/; packaged uses userData.
 *
 *  轮 7 A1: this used to ALSO return a `sandboxDir` that served as the SDK cwd.
 *  It no longer does — momo works in the user-visible workspace (`~/Leemo`), see
 *  HostDeps.workspaceRoot. `dataDir` stays here because it is genuinely internal
 *  (per-provider config dirs, not user documents). */
function resolveDataDir(): string {
  const base = app.isPackaged
    ? path.join(app.getPath("userData"), "workspace")
    : path.resolve(HERE, "..", ".leemo-workspace");
  const dataDir = path.join(base, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

/**
 * Build-time Office bundle hook. The product owner maintains the skill bundle
 * under bundled-skills/office/release before packaging. Packaged builds read
 * the source from app.asar and expand it once into app data without a network request.
 */
function resolveBundledOfficeSkillsRoot(): string {
  return resolveOfficeBundleRoot({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    mainDirectory: HERE,
  });
}

/** Build-time curated Skill library. In a packaged build it lives inside
 * app.asar, keeping hundreds of source files out of the installer's loose-file
 * extraction path. The provisioner copies it once to a real app-data plugin so
 * Skill scripts can execute normally. */
function resolveBundledSkillLibraryRoot(): string {
  return resolveBundledSkillRoot({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    mainDirectory: HERE,
  });
}

/** momo's memory bank lives in the user-visible workspace (06 §7.4), NOT in the
 *  SDK sandbox: the user must be able to open, read and edit these files. The
 *  host reads the index itself and injects it as prompt layer ⑧ (方案 C) —
 *  `settingSources` cannot point at a path, and repointing `cwd` here would
 *  weaken the Phase 0 sandbox isolation. */
// 轮 3 卡 G: this is the SAME directory as the workspace root — 06 §五 puts
// 本子/默认工作区/Leemo internals all live under ~/Leemo. Defined via workspaceRootFor so
// the two can never drift apart.
function memoryDir(): string {
  return workspaceRootFor(app.getPath("home"));
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

/** A previous crash can leave an SDK-owned round cache behind. It contains only
 * a bounded copy of governed memory, never the ledger, and has no value after
 * restart. Remove exactly this app-private directory before accepting work. */
function clearNativeMemoryCache(dataDir: string): void {
  try {
    fs.rmSync(path.join(dataDir, "native-memory"), { recursive: true, force: true });
  } catch (error: unknown) {
    console.warn("[leemo:main] could not clear stale native-memory cache:", error);
  }
}

const memoryIO: MemoryIO = {
  exists: (p) => fs.existsSync(p),
  readFile: (p) => fs.readFileSync(p, "utf8"),
  writeFile: (p, contents) => fs.writeFileSync(p, contents, "utf8"),
  appendFile: (p, contents) => fs.appendFileSync(p, contents, "utf8"),
  mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
  readdir: (p) => fs.readdirSync(p),
  rename: (from, to) => fs.renameSync(from, to),
  walkFiles,
  remove: (target) => fs.rmSync(target, { recursive: true, force: true }),
};

/** Synchronous fs seam handed to the Workspace Manager (轮 3 卡 G). Same shape
 *  discipline as the others: real fs lives here, the host module stays pure. */
const workspaceIO: WorkspaceIO = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
  readdir: (p) =>
    fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    })),
  stat: (p) => {
    const s = fs.statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  },
  readFile: (p) => fs.readFileSync(p, "utf8"),
  writeFile: (p, contents) => fs.writeFileSync(p, contents, "utf8"),
  replaceTextFile: atomicReplaceTextFile,
  // 轮 4「预览区通电」: bounded raw read. Opens a descriptor and reads at most
  // maxBytes rather than readFileSync-then-slice — the whole point is to never
  // materialise a huge file in main's heap just to classify it.
  readBinary: (p, maxBytes) => {
    if (maxBytes === undefined) return fs.readFileSync(p);
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.allocUnsafe(maxBytes);
      const read = fs.readSync(fd, buf, 0, maxBytes, 0);
      // subarray, not slice: a copy here would double the peak for a 2 MB read.
      return buf.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  },
  // COPY semantics for drops (06 §2.2): the user's original download survives.
  copyFile: (from, to) => fs.copyFileSync(from, to),
  rename: (from, to) => {
    try {
      fs.renameSync(from, to);
    } catch (e: unknown) {
      // Cross-device (e.g. the workspace on another drive): rename fails with
      // EXDEV. Fall back to copy+unlink so "移入本子" still works there.
      if ((e as { code?: string }).code !== "EXDEV") throw e;
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
    }
  },
  removeEmptyDir: (dir) => fs.rmdirSync(dir),
};

/** Synchronous fs seam handed to the skills module (卡 E). */
const skillsIO: SkillsIO = {
  readdir: (p) => fs.readdirSync(p),
  readFile: (p) => fs.readFileSync(p, "utf8"),
  exists: (p) => fs.existsSync(p),
  writeFile: (p, contents) => fs.writeFileSync(p, contents, "utf8"),
  mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
  remove: (p) => fs.rmSync(p, { recursive: true, force: true }),
  rename: (from, to) => fs.renameSync(from, to),
};

/** Initialize the workspace plus Leemo's governed memory source. Legacy files
 * are migrated once; the old five-file bank is never seeded again. */
function initializeWorkspaceMemory(
  resolveWorkspaceRoot?: (workspaceId: string) => string | undefined,
): MemoryGovernance {
  // The workspace root + 默认工作区 must exist before anything can be
  // filed into it (06 §2.2's fallback bucket cannot be the thing that fails).
  try {
    const migration = migrateLegacyInbox(memoryDir(), workspaceIO);
    if (migration.renamedLegacyRoot || migration.moves.length > 0 || migration.conflicts.length > 0) {
      console.log(
        `[leemo:main] default workspace migration: moved=${migration.moves.length}, conflicts=${migration.conflicts.length}`,
      );
    }
    ensureWorkspace(memoryDir(), workspaceIO);
  } catch (e: unknown) {
    console.error("[leemo:main] could not create workspace dirs:", e);
  }
  const governance = createMemoryGovernance({ workspaceRoot: memoryDir(), io: memoryIO, resolveWorkspaceRoot });
  const notebooks = listNotebooks(memoryDir(), workspaceIO);
  try {
    const migration = governance.migrateLegacyLayout(notebooks.map((notebook) => notebook.id));
    console.log(
      `[leemo:main] memory migration: imported=${migration.imported}, archived=${migration.archived.length}, artifacts=${migration.movedArtifacts.length}, errors=${migration.errors.length}`,
    );
    const scopes: MemoryScope[] = [
      { type: "global" },
      ...notebooks.map((notebook): MemoryScope => ({ type: "notebook", notebookId: notebook.id })),
    ];
    const rebuilt = governance.rebuildViews(scopes);
    if (rebuilt.diagnostics.length > 0) {
      console.warn(`[leemo:main] memory ledger diagnostics: ${rebuilt.diagnostics.length}`);
    }
  } catch (e: unknown) {
    console.error("[leemo:main] could not migrate/rebuild governed memory:", e);
  }
  // 卡 E: the product-owned .leemo directory doubles as an engine-local plugin so Skills are
  // discoverable under settingSources:[] (方案 G). Scaffold it here, next to the
  // memory bank, for the same reason — momo is told this path exists, so it has
  // to. A failure just means no skills this run; chat is unaffected.
  try {
    const migrated = migrateLegacySkills(memoryDir());
    if (migrated.copied > 0 || migrated.failed > 0) {
      console.log(
        `[leemo:main] legacy skills copied=${migrated.copied} skipped=${migrated.skipped} failed=${migrated.failed}`,
      );
    }
    ensureSkillsPlugin(memoryDir(), skillsIO);
  } catch (e: unknown) {
    console.error("[leemo:main] could not scaffold skills plugin:", e);
  }
  return governance;
}

let host: BridgeHost | null = null;

function disposeHost(): void {
  const activeHost = host;
  host = null;
  activeHost?.dispose();
}
let persistence: Persistence | null = null;
let win: BrowserWindow | null = null;
let scheduledTaskScheduler: ScheduledTaskScheduler | null = null;
let clipboardCleanupTimer: NodeJS.Timeout | null = null;
const activeClipboardAttachments = new Map<string, string[]>();

function clipboardAttachmentRoot(): string {
  if (E2E_ISOLATION) return path.join(E2E_ISOLATION.root, "temp", "clipboard-attachments");
  return path.join(app.getPath("temp"), "Leemo", "clipboard-attachments");
}

function removeTrackedClipboardPath(target: string): void {
  for (const [conversationId, paths] of activeClipboardAttachments) {
    const remaining = paths.filter((candidate) => candidate !== target);
    if (remaining.length === 0) activeClipboardAttachments.delete(conversationId);
    else if (remaining.length !== paths.length) activeClipboardAttachments.set(conversationId, remaining);
  }
}

function releaseClipboardPaths(paths: readonly string[]): void {
  for (const target of paths) {
    void releaseClipboardPng(
      clipboardAttachmentRoot(),
      target,
      CLIPBOARD_ATTACHMENT_SESSION_ID,
    );
  }
}

function releaseTrackedClipboardAttachments(conversationId: string): void {
  const paths = activeClipboardAttachments.get(conversationId) ?? [];
  activeClipboardAttachments.delete(conversationId);
  releaseClipboardPaths(paths);
}

if (HAS_SINGLE_INSTANCE_LOCK) {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

/** One-time backend assembly: reuse the transport-agnostic bridge host, swap
 *  the WS transport edge for ipcMain/webContents. Runs once on app ready. */
function setupHost(): void {
  if (!E2E_ISOLATION) {
    try {
      process.loadEnvFile(); // first-run migration source; not required afterwards
    } catch {
      // no .env — the encrypted store is the source of truth.
    }
  }

  const secretsPath = path.join(app.getPath("userData"), "leemo-secrets.enc");
  const { config: providerConfig, source } = loadOrMigrateSecrets({
    safeStorage,
    io: nodeIO,
    secretsPath,
    envSource: process.env,
  });
  // Non-sensitive: log the SOURCE only, never a key.
  console.log(`[leemo:main] secrets source=${source} (store: ${secretsPath})`);

  // 轮 3 卡 F: the catalog lists every preset family whether or not it has a key,
  // so the settings page can offer the unconfigured ones. Keys come from the
  // encrypted config first, env only as the bootstrap channel.
  // Mutable so `bridge:saveProvider` takes effect WITHOUT a restart: the store's
  // write() below re-runs buildCatalog and the host reads through a getter.
  let liveConfig = providerConfig;
  let catalog = buildCatalog(process.env as Record<string, string | undefined>, liveConfig);
  const providerStore = {
    read: () => liveConfig,
    write: (next: ProviderConfigFile) => {
      // Persist FIRST: if the platform cannot encrypt, saveSecrets throws and we
      // must not leave the in-memory catalog claiming a key that was never saved
      // (the user would see "saved", restart, and find it gone).
      saveSecrets({ safeStorage, io: nodeIO, secretsPath }, next);
      liveConfig = next;
      catalog = buildCatalog(process.env as Record<string, string | undefined>, liveConfig);
    },
  };
  const ready = catalog.filter((e) => e.spec.configured);
  const pending = catalog.filter((e) => !e.spec.configured);
  // Ids only — never a key.
  console.log(
    `[leemo:main] providers: ${ready.length} 家已配置` +
      `${ready.length ? ` (${ready.map((e) => e.provider.id).join(", ")})` : ""}` +
      `, ${pending.length} 家待配置` +
      `${pending.length ? ` (${pending.map((e) => e.provider.id).join(", ")})` : ""}`,
  );
  if (ready.length === 0) {
    console.warn(
      "[leemo:main] 还没有可用的模型服务 —— 在设置页接入云端 API 或本地模型即可开始对话" +
        "（云端服务也可先把 Key 写进 .env，首次启动会迁进加密存储）。",
    );
  }

  // 轮 5 打包：打包态必须显式告诉 SDK 原生 CLI 在哪。它自己解出来的是 asar 内部
  // 路径 —— existsSync 为真、spawn 必失败（见 cli-binary.ts 头注）。dev 态为
  // undefined，SDK 自己解析，行为不变。
  const cliExecutablePath = resolveCliBinary({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    arch: process.arch,
    probe: { exists: (p) => fs.existsSync(p), join: (...parts) => path.join(...parts) },
  });
  if (app.isPackaged) {
    // 打包态的头号可疑点，值得一条日志：没解到就等于"能开窗、发消息就崩"。
    console.log(
      `[leemo:main] cli binary: ${cliExecutablePath ?? "未解到（将由 SDK 自行解析，打包态大概率会失败）"}`,
    );
  }

  const dataDir = resolveDataDir();
  const officeSkills = createOfficeSkillProvisioner({
    configDir: path.join(dataDir, "office-skills"),
    bundledRoot: resolveBundledOfficeSkillsRoot(),
  });
  const bundledSkills = createBundledSkillProvisioner({
    configDir: path.join(dataDir, "bundled-skills"),
    bundledRoot: resolveBundledSkillLibraryRoot(),
  });
  // Never delay first paint. Conversation assembly joins this same promise if
  // the user gets there first, so a bundled skill is ready without a manual
  // install step; the bundle is local and does not require GitHub/VPN access.
  void officeSkills.ensureReady().then((snapshot) => {
    if (snapshot.status === "ready") {
      console.log(
        `[leemo:main] Office skills ready (${snapshot.source ?? "local"}; ${snapshot.revision ?? "local"})`,
      );
    } else if (snapshot.status === "error") {
      console.warn(`[leemo:main] Office skills unavailable: ${snapshot.error}`);
    }
  });
  void bundledSkills.ensureReady().then((snapshot) => {
    if (snapshot.status === "ready") {
      console.log(
        `[leemo:main] bundled skills ready (${snapshot.skills.length}; ${snapshot.revision})`,
      );
    } else if (snapshot.status === "error") {
      console.warn(`[leemo:main] bundled skills unavailable: ${snapshot.error}`);
    }
  });
  clearNativeMemoryCache(dataDir);
  const builtinMcpRuntime = {};
  try {
    const packageJsonPath = NODE_REQUIRE.resolve("@playwright/mcp/package.json");
    const browser = detectBrowserChannel(process.env, (candidate) => fs.existsSync(candidate));
    Object.assign(builtinMcpRuntime, buildPlaywrightMcpRuntime({
      packageJsonPath,
      executablePath: process.execPath,
      dataDir: path.join(dataDir, "mcp", "playwright"),
      browser,
    }));
    console.log(`[leemo:main] built-in browser MCP ready (${browser})`);
  } catch (error: unknown) {
    // Browser MCP is optional at boot: chat and custom MCPs remain usable, and
    // settings will mark the built-in entry unavailable instead of lying.
    console.error("[leemo:main] built-in browser MCP unavailable:", error);
  }
  if (process.platform === "win32") {
    const computerExecutable = resolveComputerMcpExecutable({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir: HERE,
    });
    if (fs.existsSync(computerExecutable)) {
      Object.assign(builtinMcpRuntime, buildComputerMcpRuntime({ executablePath: computerExecutable }));
      console.log("[leemo:main] built-in Windows computer control ready");
    } else {
      console.error(`[leemo:main] built-in Windows computer control unavailable: ${computerExecutable}`);
    }
  }
  let workspaceRegistryRef: ReturnType<typeof createWorkspaceRegistry> | undefined;
  const memoryGovernance = initializeWorkspaceMemory((workspaceId) => {
    try {
      const workspace = workspaceRegistryRef?.resolve(workspaceId);
      return workspace?.kind === "external" ? workspace.root : undefined;
    } catch {
      return undefined;
    }
  });
  const readCurrentMemory = (scope: MemoryScope): string | undefined => {
    if (memoryGovernance.list(scope).records.length === 0) return undefined;
    return memoryIO.readFile(memoryGovernance.ensureScope(scope).currentView);
  };
  console.log(
    `[leemo:main] governed memory: ${memoryGovernance.list({ type: "global" }).records.length} current global facts`,
  );

  console.log(`[leemo:main] skills dir: ${skillsRootFor(memoryDir())}`);
  // Non-sensitive: notebook COUNT and root only (a notebook name can be
  // personal — a course, a client project — so names stay out of the log).
  console.log(
    `[leemo:main] workspace: ${memoryDir()} (${listNotebooks(memoryDir(), workspaceIO).length} 个本子)`,
  );
  const workspaceRegistry = createWorkspaceRegistry({
    homeRoot: memoryDir(),
    registryFile: path.join(app.getPath("userData"), "workspaces.json"),
  });
  workspaceRegistryRef = workspaceRegistry;

  // One local database owns every durable renderer/host record. Create it
  // before the bridge host so approval brokers and usage channels receive the
  // exact same instance later exposed through the renderer persistence IPC.
  const dbPath = path.join(app.getPath("userData"), "leemo.db");
  const sqlitePersistence = createPersistence(openDatabase(dbPath));
  const activePersistence = createRegisteredWorkspacePersistence(sqlitePersistence, workspaceRegistry);
  const learningService = createLearningService(activePersistence);
  persistence = activePersistence;
  console.log(`[leemo:main] persistence: workspace records + SQLite index (${dbPath})`);
  scheduledTaskScheduler = createScheduledTaskScheduler({
    persistence: activePersistence,
    onDue: (payload) => {
      if (win && !win.isDestroyed()) win.webContents.send("leemo:scheduler:due", payload);
    },
  });

  host = createBridgeHost({
    // Getter, not the array: `saveProvider` swaps `catalog` above and every later
    // read must see the new one.
    catalog: () => catalog,
    providerStore,
    dataDir,
    // 轮 7 A1: momo 在用户看得见的工作区里干活。没有本子的对话（主人格）就在根上，
    // 所以它天然看得见所有本子 —— 它们是它的子目录。
    workspaceRoot: memoryDir(),
    resolveWorkspace: (id) => {
      const resolved = workspaceRegistry.resolve(id);
      return {
        id: resolved.id,
        name: resolved.name,
        root: resolved.root,
        kind: resolved.kind,
      };
    },
    routeRootArtifactPath: (relativePath) => routeRootWritePath(
      relativePath,
      listNotebooks(memoryDir(), workspaceIO).map((notebook) => notebook.id),
      // Do not use root-file existence as a routing signal here. Native Write
      // can expose its target before the HTTP PreToolUse decision, which would
      // misclassify every new global artifact as an intentional root file.
      // Existing files still have an unambiguous path through Edit.
    ),
    ...(E2E_ISOLATION ? { filesystemBoundary: memoryDir() } : {}),
    readGlobalMemory: () => readCurrentMemory({ type: "global" }),
    memoryDir: memoryDir(),
    skillAdmin: createSkillAdminService({ memoryDir: memoryDir(), fetchFn: fetch }),
    officeSkills,
    bundledSkills,
    pickSkillSource: async (kind) => {
      const options: OpenDialogOptions = kind === "archive"
        ? {
            title: "选择 Skill ZIP",
            buttonLabel: "检查这个 ZIP",
            properties: ["openFile"],
            filters: [{ name: "Skill ZIP", extensions: ["zip"] }],
          }
        : {
            title: "选择 Skill 文件夹",
            buttonLabel: "检查这个文件夹",
            properties: ["openDirectory"],
          };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    },
    memoryGovernance,
    skillsIO,
    resolveNotebook: (id) => {
      const notebook = listNotebooks(memoryDir(), workspaceIO).find((candidate) => candidate.id === id);
      return notebook ? { title: notebook.title, dir: notebook.dir } : undefined;
    },
    readNotebookMemory: (id) => readCurrentMemory({ type: "notebook", notebookId: id }),
    // shell.openPath is main-process only; the host stays Electron-free and
    // takes it as an injected capability.
    openPath: (p) => shell.openPath(p),
    // 打包态才有值（spread：dev 下这个键必须真的不存在）。
    ...(cliExecutablePath !== undefined ? { cliExecutablePath } : {}),
    builtinMcpRuntime,
    approvalPersistence: activePersistence,
    readUsageSummary: (query) => activePersistence.usageSummary(query),
    learningService,
    // Guard against a destroyed window: events only flow after the renderer
    // invokes send (post-load), so the window is normally alive here.
    push: (channel, payload) => {
      if (channel === "bridge:event") {
        const envelope = payload as {
          conversationId?: string;
          event?: { type?: string; subtype?: string; isError?: boolean };
        };
        if (
          envelope.conversationId
          && envelope.event?.type === "run.finished"
          && (!envelope.event.isError || envelope.event.subtype === "interrupted")
        ) {
          releaseTrackedClipboardAttachments(envelope.conversationId);
        }
      }
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
  });

  // Single multiplexed invoke channel: renderer sends {channel, req}; host
  // routes it. Errors cross as data ({ok:false}) so Electron never mangles a
  // thrown Error across the IPC boundary.
  ipcMain.handle(
    "leemo:invoke",
    async (_e, msg: { channel: keyof BridgeInvokeMap; req: unknown }) => {
      let clipboardSend: {
        conversationId: string;
        previous?: string[];
        next: string[];
      } | undefined;
      try {
        if (msg.channel === "bridge:send") {
          const request = msg.req as BridgeInvokeMap["bridge:send"]["request"];
          const ownedPaths = [...new Set((request.attachments ?? [])
            .map((attachment) => attachment.path)
            .filter((target) => isOwnedClipboardPngPath(
              clipboardAttachmentRoot(),
              target,
              CLIPBOARD_ATTACHMENT_SESSION_ID,
            )))];
          clipboardSend = {
            conversationId: request.conversationId,
            previous: activeClipboardAttachments.get(request.conversationId),
            next: ownedPaths,
          };
          // This is a lease, not deletion. The previous failed turn remains on
          // disk until the host acknowledges this replacement send.
          if (ownedPaths.length > 0) {
            activeClipboardAttachments.set(request.conversationId, ownedPaths);
          } else {
            activeClipboardAttachments.delete(request.conversationId);
          }
        }
        const response = await host!.handleInvoke(msg.channel, msg.req as never);
        if (clipboardSend?.previous) {
          const retained = new Set(clipboardSend.next);
          releaseClipboardPaths(clipboardSend.previous.filter((target) => !retained.has(target)));
        }
        return { ok: true, response };
      } catch (e: unknown) {
        if (clipboardSend) {
          if (clipboardSend.previous) {
            activeClipboardAttachments.set(clipboardSend.conversationId, clipboardSend.previous);
          } else {
            activeClipboardAttachments.delete(clipboardSend.conversationId);
          }
        }
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  // Persistence: renderer-driven SQLite (main owns the DB; the renderer owns the
  // reducer and hands over already-folded snapshots). Separate channel from the
  // frozen bridge contract — persistence is not part of the AI conversation
  // boundary. The DB always lives in userData so it survives dev↔packaged and
  // app restarts (acceptance: SQLite file in userData; refresh/restart不丢).
  ipcMain.handle(
    "leemo:persist",
    async (_e, msg: { op: string; payload: unknown }) => {
      try {
        switch (msg.op) {
          case "loadAll":
            return { ok: true, response: persistence!.loadAll() };
          case "saveConversation": {
            const p = msg.payload as {
              meta: Parameters<Persistence["saveConversation"]>[0];
              timeline: Parameters<Persistence["saveConversation"]>[1];
            };
            persistence!.saveConversation(p.meta, p.timeline);
            return { ok: true };
          }
          case "moveConversation": {
            const p = msg.payload as {
              sourceWorkspaceId: string;
              meta: Parameters<Persistence["moveConversation"]>[1];
              timeline: Parameters<Persistence["moveConversation"]>[2];
            };
            if (!p || typeof p.sourceWorkspaceId !== "string" || !p.meta || !Array.isArray(p.timeline)) {
              throw new Error("移动对话的数据不完整，请重试。");
            }
            persistence!.moveConversation(p.sourceWorkspaceId, p.meta, p.timeline);
            return { ok: true };
          }
          case "deleteConversation": {
            const p = msg.payload as { conversationId?: unknown } | undefined;
            if (!p || typeof p.conversationId !== "string" || !p.conversationId) {
              throw new Error("删除对话的数据不完整，请重试。");
            }
            persistence!.deleteConversation(p.conversationId);
            return { ok: true };
          }
          case "saveWikiEntry":
            persistence!.saveWikiEntry(msg.payload as Parameters<Persistence["saveWikiEntry"]>[0]);
            return { ok: true };
          // 轮 7 A3: 设置落盘。此前 settings store 全字段重启即丢 —— 用户打开
          // 联网、换人设卡、改权限档，下次启动一律回到默认。
          case "saveSettings":
            persistence!.saveSettings(msg.payload as Record<string, unknown>);
            return { ok: true };
          default:
            return { ok: false, error: `unknown persist op: ${msg.op}` };
        }
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    "leemo:learning",
    async (_e, msg: { op: string; payload: unknown }) => {
      try {
        switch (msg.op) {
          case "snapshot":
            return { ok: true, response: learningService.getSnapshot() };
          case "saveProfile":
            return { ok: true, response: learningService.saveProfile(msg.payload as LearningProfileDraft) };
          default:
            return { ok: false, error: `unknown learning op: ${msg.op}` };
        }
      } catch (error: unknown) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Local scheduled tasks live on their own narrow preload surface. The main
  // process owns time, persistence, and recovery; the renderer only supplies
  // the three user-facing choices and executes a claimed run through the
  // existing conversation/tool path.
  const timezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const requireScheduledTask = (id: string): ScheduledTask => {
    const task = activePersistence.getScheduledTask(id);
    if (!task) throw new Error("没有这个定时任务，它可能已经被删除。");
    return task;
  };
  const taskHasActiveRun = (id: string): boolean => activePersistence
    .listScheduledTaskRuns(id, 500)
    .some((run) => run.status === "queued" || run.status === "running");
  const saveTaskDraft = (draft: ScheduledTaskDraft, existing?: ScheduledTask): ScheduledTask => {
    const current = Date.now();
    const clean = normalizeScheduledTaskDraft(draft, current, timezone());
    // Validate the opaque workspace id on every user mutation. A drive may have
    // disappeared since the picker registered it; storing an arbitrary path is
    // never an escape hatch.
    workspaceRegistry.resolve(clean.workspaceId);
    const nextRunAt = nextRunAtForSchedule(clean.schedule, current);
    if (nextRunAt === null) throw new Error("这个时间已经过去，请选择未来的时间。");
    const workspaceChanged = existing && existing.workspaceId !== clean.workspaceId;
    return {
      id: existing?.id ?? randomUUID(),
      name: clean.name,
      prompt: clean.prompt,
      schedule: clean.schedule,
      timezone: clean.timezone,
      nextRunAt,
      workspaceId: clean.workspaceId,
      status: existing?.status === "paused" ? "paused" : "active",
      ...(!workspaceChanged && existing?.conversationId ? { conversationId: existing.conversationId } : {}),
      createdAt: existing?.createdAt ?? current,
      updatedAt: current,
      ...(existing?.lastRunAt === undefined ? {} : { lastRunAt: existing.lastRunAt }),
    };
  };
  const queueManualRun = (task: ScheduledTask, trigger: "manual" | "catch-up"): ScheduledTaskRun => {
    if (taskHasActiveRun(task.id)) throw new Error("这个任务已经在运行，请等它结束后再试。");
    workspaceRegistry.resolve(task.workspaceId);
    const current = Date.now();
    const run: ScheduledTaskRun = {
      id: randomUUID(),
      taskId: task.id,
      scheduledFor: current,
      trigger,
      status: "queued",
      createdAt: current,
    };
    activePersistence.saveScheduledTaskRun(run);
    return run;
  };

  ipcMain.handle(
    "leemo:scheduler",
    async (_e, msg: { op: string; payload: unknown }) => {
      try {
        switch (msg.op) {
          case "list":
            return {
              ok: true,
              response: {
                tasks: activePersistence.listScheduledTasks(),
                runs: activePersistence.listScheduledTaskRuns(undefined, 200),
              },
            };
          case "create": {
            const task = saveTaskDraft(msg.payload as ScheduledTaskDraft);
            activePersistence.saveScheduledTask(task);
            scheduledTaskScheduler?.refresh();
            return { ok: true, response: task };
          }
          case "update": {
            const payload = msg.payload as { id: string; draft: ScheduledTaskDraft };
            const existing = requireScheduledTask(payload.id);
            if (taskHasActiveRun(existing.id)) throw new Error("任务运行时不能修改，请等它结束后再试。");
            const task = saveTaskDraft(payload.draft, existing);
            activePersistence.saveScheduledTask(task);
            scheduledTaskScheduler?.refresh();
            return { ok: true, response: task };
          }
          case "setPaused": {
            const payload = msg.payload as { id: string; paused: boolean };
            const existing = requireScheduledTask(payload.id);
            const current = Date.now();
            const nextRunAt = payload.paused
              ? existing.nextRunAt
              : nextRunAtForSchedule(existing.schedule, current);
            if (!payload.paused && nextRunAt === null) {
              throw new Error("这次任务的时间已经过去，请编辑时间后再开启。");
            }
            const task: ScheduledTask = {
              ...existing,
              status: payload.paused ? "paused" : "active",
              nextRunAt,
              updatedAt: current,
            };
            activePersistence.saveScheduledTask(task);
            scheduledTaskScheduler?.refresh();
            return { ok: true, response: task };
          }
          case "delete": {
            const { id } = msg.payload as { id: string };
            requireScheduledTask(id);
            if (taskHasActiveRun(id)) throw new Error("任务运行时不能删除，请等它结束后再试。");
            activePersistence.deleteScheduledTask(id);
            scheduledTaskScheduler?.refresh();
            return { ok: true };
          }
          case "runNow": {
            const { id } = msg.payload as { id: string };
            return { ok: true, response: queueManualRun(requireScheduledTask(id), "manual") };
          }
          case "runMissed": {
            const { runId } = msg.payload as { runId: string };
            const missed = activePersistence.getScheduledTaskRun(runId);
            if (!missed || missed.status !== "missed") throw new Error("这条错过记录已经处理过了。");
            const task = requireScheduledTask(missed.taskId);
            const queued = queueManualRun(task, "catch-up");
            activePersistence.saveScheduledTaskRun({ ...missed, status: "skipped", completedAt: Date.now() });
            return { ok: true, response: queued };
          }
          case "skipMissed": {
            const { runId } = msg.payload as { runId: string };
            const missed = activePersistence.getScheduledTaskRun(runId);
            if (!missed || missed.status !== "missed") throw new Error("这条错过记录已经处理过了。");
            activePersistence.saveScheduledTaskRun({ ...missed, status: "skipped", completedAt: Date.now() });
            return { ok: true };
          }
          case "claim": {
            const { runId } = msg.payload as { runId: string };
            return { ok: true, response: activePersistence.claimScheduledTaskRun(runId, Date.now()) ?? null };
          }
          case "complete": {
            const payload = msg.payload as {
              runId: string;
              status: "succeeded" | "failed";
              conversationId?: string;
              error?: string;
            };
            const run = activePersistence.getScheduledTaskRun(payload.runId);
            if (!run) throw new Error("找不到这次运行记录。");
            const completed: ScheduledTaskRun = {
              ...run,
              status: payload.status,
              completedAt: Date.now(),
              ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
              ...(payload.status === "failed"
                ? { error: Array.from((payload.error ?? "任务没有完成").trim()).slice(0, 500).join("") }
                : { error: undefined }),
            };
            activePersistence.completeScheduledTaskRun(completed);
            const task = activePersistence.getScheduledTask(run.taskId);
            if (task) {
              activePersistence.saveScheduledTask({
                ...task,
                ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
                lastRunAt: run.scheduledFor,
                updatedAt: Date.now(),
              });
            }
            return { ok: true };
          }
          case "attachConversation": {
            const payload = msg.payload as { taskId: string; conversationId: string };
            const task = requireScheduledTask(payload.taskId);
            if (!payload.conversationId.trim()) throw new Error("对话 id 不能为空。");
            activePersistence.saveScheduledTask({
              ...task,
              conversationId: payload.conversationId,
              updatedAt: Date.now(),
            });
            return { ok: true };
          }
          default:
            return { ok: false, error: `unknown scheduler op: ${msg.op}` };
        }
      } catch (error: unknown) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Workspace Manager (轮 3 卡 G): 本子 = 目录 under ~/Leemo. A SEPARATE channel
  // from the frozen bridge contract, following the leemo:persist precedent —
  // 10 号 §S11 states filesystem facts are not part of the 09 conversation
  // contract. Every renderer-supplied path is workspace-RELATIVE and passes
  // through resolveInside() before any fs call (see workspace.ts).
  const workspaceRoot = memoryDir();
  ipcMain.handle(
    "leemo:workspace",
    async (_e, msg: { op: string; payload: unknown }) => {
      try {
        switch (msg.op) {
          case "listWorkspaces":
            return { ok: true, response: workspaceRegistry.list() };
          case "pickWorkspace": {
            const options: OpenDialogOptions = {
              title: "打开文件夹作为工作区",
              buttonLabel: "打开文件夹",
              properties: ["openDirectory"],
            };
            const picked = await registerPickedWorkspace(workspaceRegistry, async () => {
              if (E2E_WORKSPACE_CANDIDATE) return E2E_WORKSPACE_CANDIDATE;
              const result = win
                ? await dialog.showOpenDialog(win, options)
                : await dialog.showOpenDialog(options);
              return result.canceled ? null : result.filePaths[0] ?? null;
            });
            return { ok: true, response: picked };
          }
          case "touchWorkspace": {
            const { id } = msg.payload as { id: string };
            return { ok: true, response: workspaceRegistry.touch(id) };
          }
          case "forgetWorkspace": {
            const { id } = msg.payload as { id: string };
            return { ok: true, response: workspaceRegistry.forget(id) };
          }
          case "listNotebooks":
            // dir is included: the UI shows it, and "在文件夹中显示" needs it.
            return { ok: true, response: { root: workspaceRoot, notebooks: listNotebooks(workspaceRoot, workspaceIO) } };
          case "createNotebook": {
            const { title } = msg.payload as { title: string };
            return { ok: true, response: createNotebook(workspaceRoot, title, workspaceIO) };
          }
          case "ensureStarterNotebook":
            return { ok: true, response: ensureStarterNotebook(workspaceRoot, workspaceIO) };
          case "readTree": {
            const requested = (msg.payload as { workspaceId?: string } | undefined)?.workspaceId
              ?? HOME_WORKSPACE_ID;
            const target = workspaceRegistry.resolve(requested);
            return {
              ok: true,
              response: readTree(target.root, workspaceIO, { notebookRoot: target.kind === "home" }),
            };
          }
          case "dropFiles": {
            const p = msg.payload as { sources: string[]; notebookId: string | null; workspaceId?: string };
            const target = workspaceRegistry.resolve(p.workspaceId ?? HOME_WORKSPACE_ID);
            if (target.kind === "external" && p.notebookId !== null) {
              throw new Error("外部工作区里的文件夹不是本子，请直接放到当前文件夹。");
            }
            return {
              ok: true,
              response: dropFiles(target.root, p, workspaceIO, { directRoot: target.kind === "external" }),
            };
          }
          case "moveFile": {
            const p = msg.payload as { path: string; notebookId: string | null; workspaceId?: string };
            const target = workspaceRegistry.resolve(p.workspaceId ?? HOME_WORKSPACE_ID);
            if (target.kind === "external") {
              throw new Error("外部工作区暂不使用本子归类，请直接在项目文件夹中整理文件。");
            }
            return { ok: true, response: moveFile(target.root, p, workspaceIO) };
          }
          case "suggestNotebook": {
            const { fileName, workspaceId } = msg.payload as { fileName: string; workspaceId?: string };
            const target = workspaceRegistry.resolve(workspaceId ?? HOME_WORKSPACE_ID);
            if (target.kind === "external") return { ok: true, response: null };
            const books = listNotebooks(target.root, workspaceIO);
            return { ok: true, response: suggestNotebook(fileName, books) };
          }
          case "readTextFile": {
            const { path: rel, workspaceId } = msg.payload as { path: string; workspaceId?: string };
            const target = workspaceRegistry.resolve(workspaceId ?? HOME_WORKSPACE_ID);
            return { ok: true, response: readTextFile(target.root, rel, workspaceIO) };
          }
          case "readPreview": {
            // 轮 4「预览区通电」: text/binary/unpreviewable decided in main, where
            // the bytes are (see readPreview's header for why not in the pane).
            const { path: rel, workspaceId } = msg.payload as { path: string; workspaceId?: string };
            const target = workspaceRegistry.resolve(workspaceId ?? HOME_WORKSPACE_ID);
            return { ok: true, response: readPreview(target.root, rel, workspaceIO) };
          }
          case "writeMarkdownFile": {
            const payload = msg.payload as {
              path: string;
              text: string;
              expectedText: string;
              workspaceId?: string;
            };
            const target = workspaceRegistry.resolve(payload.workspaceId ?? HOME_WORKSPACE_ID);
            return {
              ok: true,
              response: writeMarkdownFile(
                target.root,
                payload.path,
                payload.text,
                payload.expectedText,
                workspaceIO,
                {
                  protectLegacyMemory: target.kind === "home",
                  canonicalize: fs.realpathSync.native,
                },
              ),
            };
          }
          case "stageClipboardImage": {
            const image = clipboard.readImage();
            if (image.isEmpty()) throw new Error("剪贴板里没有可用的图片。");
            // NativeImage.toPNG() allocates from decoded pixels. Reject an
            // implausibly large bitmap before encoding so one paste cannot
            // stall the main process or create a huge temporary allocation.
            assertClipboardImageDimensions(image.getSize());
            return {
              ok: true,
              response: await stageClipboardPng(clipboardAttachmentRoot(), image.toPNG(), {
                sessionId: CLIPBOARD_ATTACHMENT_SESSION_ID,
              }),
            };
          }
          case "releaseClipboardImage": {
            const { path: target } = msg.payload as { path: string };
            const released = await releaseClipboardPng(
              clipboardAttachmentRoot(),
              target,
              CLIPBOARD_ATTACHMENT_SESSION_ID,
            );
            if (released) removeTrackedClipboardPath(target);
            return { ok: true, response: released };
          }
          case "reveal": {
            // Match the command shown to the user: select a file in Explorer,
            // or open a directory. Guarded like every other op — a renderer
            // must not be able to shell-open C:\.
            const { path: rel, workspaceId } = msg.payload as { path: string; workspaceId?: string };
            const target = workspaceRegistry.resolve(workspaceId ?? HOME_WORKSPACE_ID);
            const reveal = planWorkspaceReveal(target.root, rel, workspaceIO);
            if (reveal.kind === "show-item") {
              shell.showItemInFolder(reveal.path);
            } else {
              const error = await shell.openPath(reveal.path);
              if (error) throw new Error(`无法打开文件夹：${error}`);
            }
            return { ok: true };
          }
          default:
            return { ok: false, error: `unknown workspace op: ${msg.op}` };
        }
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 640,
    backgroundColor: "#FAF6EE",
    webPreferences: {
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const guardedWindow = win;

  attachUnsavedDraftGuard(guardedWindow.webContents, () => dialog.showMessageBoxSync(guardedWindow, {
    type: "warning",
    title: "有未保存的修改",
    message: "还有 Markdown 修改没有保存。",
    detail: "现在退出会丢失这些草稿。",
    buttons: ["继续编辑", "退出并丢弃修改"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }) === 1);

  const devUrl = process.env.LEEMO_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(path.join(HERE, "..", "dist", "index.html"));
  }

  // Markdown sources must behave like desktop-app links: keep Leemo in place
  // and hand normal web URLs to the user's default browser. Deny every popup
  // in-webContents so untrusted model output cannot open an Electron window.
  const openExternalHttp = (candidate: string): void => {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      void shell.openExternal(url.toString()).catch((error: unknown) => {
        console.error("[leemo:main] could not open external link:", error);
      });
    } catch {
      // Invalid or relative href: ReactMarkdown normally filters these already;
      // the main-process boundary remains defensive.
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttp(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      const current = new URL(win?.webContents.getURL() ?? "file:///");
      const target = new URL(targetUrl);
      if (target.href === current.href) return;
      if (
        (current.protocol === "http:" || current.protocol === "https:")
        && target.origin === current.origin
        && target.protocol === current.protocol
      ) return;
    } catch {
      // A malformed navigation is blocked below.
    }
    event.preventDefault();
    openExternalHttp(targetUrl);
  });

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(() => {
  if (!HAS_SINGLE_INSTANCE_LOCK) return;
  // 必须早于 setupHost —— 它会去读加密件、开 SQLite。迁移晚一步，用户就会看到
  // 一个空库、然后我们又把空库写回去。
  setupHost();
  cleanupStaleClipboardAttachments(clipboardAttachmentRoot(), Date.now(), {
    protectedPrefix: CLIPBOARD_ATTACHMENT_PROTECTED_PREFIX,
  });
  clipboardCleanupTimer = setInterval(() => {
    cleanupStaleClipboardAttachments(clipboardAttachmentRoot(), Date.now(), {
      protectedPrefix: CLIPBOARD_ATTACHMENT_PROTECTED_PREFIX,
    });
  }, 60 * 60 * 1000);
  clipboardCleanupTimer.unref();
  createWindow();
  scheduledTaskScheduler?.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    disposeHost(); // tear down SDK child processes before app.quit()
    app.quit();
  }
});

// `before-quit` fires before windows ask whether a dirty draft may unload. If
// the user chooses "继续编辑", quit is cancelled; irreversible cleanup must
// therefore wait until Electron knows the app will really exit.
app.on("will-quit", () => {
  if (clipboardCleanupTimer) clearInterval(clipboardCleanupTimer);
  clipboardCleanupTimer = null;
  scheduledTaskScheduler?.stop();
  scheduledTaskScheduler = null;
  disposeHost();
});
