import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The bridge dev harness loads the gateway through dynamic imports, but the
// vendored transformer still uses @vendor/@ aliases. Keep this entry point on
// the same runtime resolver as gateway:dev so a dev-only import error cannot
// masquerade as a broken desktop feature.
register("../gateway/alias-hook.mjs", import.meta.url);

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // no .env — fall through
  }

  // The ws dev harness has no Electron safeStorage, so it stays env-only: no
  // config file argument, `.env` is the whole bootstrap channel here. The four
  // presets are listed either way (轮 3 卡 F) — an unconfigured family is an
  // offer, not an error, so this no longer exits.
  const { buildCatalog } = await import("./provider-catalog");
  const catalog = buildCatalog(process.env as Record<string, string | undefined>);
  const ready = catalog.filter((e) => e.spec.configured);
  if (ready.length === 0) {
    console.warn(
      "[bridge:dev] 还没有可用的模型服务 —— listProviders 仍会返回预置目录，" +
        "但建对话会被拒。桌面设置可接入本地模型；这个 dev harness 可把云端 Key 写进 .env。"
    );
  }

  const dataDir = path.join(ROOT, ".leemo-workspace", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.rmSync(path.join(dataDir, "native-memory"), { recursive: true, force: true });

  const { createMemoryGovernance } = await import("./memory-governance");
  const {
    ensureWorkspace,
    migrateLegacyInbox,
    listNotebooks,
    routeRootWritePath,
  } = await import("./workspace");
  const { ensureSkillsPlugin, skillsRootFor } = await import("./skills");
  const { createSkillAdminService } = await import("./skill-admin-service");
  const { createOfficeSkillProvisioner } = await import("../main/office-skill-provisioner");
  const { createSuperpowersSkillProvisioner } = await import("../main/superpowers-skill-provisioner");
  const { atomicReplaceTextFile } = await import("../main/atomic-text-file");
  const memoryDir = path.join(os.homedir(), "Leemo");
  const memoryIO = {
    exists: (p: string): boolean => fs.existsSync(p),
    readFile: (p: string): string => fs.readFileSync(p, "utf8"),
    writeFile: (p: string, contents: string): void => fs.writeFileSync(p, contents, "utf8"),
    appendFile: (p: string, contents: string): void => fs.appendFileSync(p, contents, "utf8"),
    mkdirp: (p: string): void => void fs.mkdirSync(p, { recursive: true }),
    readdir: (p: string): string[] => fs.readdirSync(p),
    rename: (from: string, to: string): void => fs.renameSync(from, to),
    walkFiles: (root: string): string[] => {
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const target = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(target);
          else if (entry.isFile()) files.push(target);
        }
      };
      walk(root);
      return files;
    },
    remove: (target: string): void => fs.rmSync(target, { recursive: true, force: true }),
  };
  const workspaceIO = {
    exists: (p: string): boolean => fs.existsSync(p),
    isDirectory: (p: string): boolean => {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    },
    mkdirp: (p: string): void => void fs.mkdirSync(p, { recursive: true }),
    readdir: (p: string) => fs.readdirSync(p, { withFileTypes: true })
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() })),
    stat: (p: string) => {
      const stat = fs.statSync(p);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    },
    readFile: (p: string): string => fs.readFileSync(p, "utf8"),
    writeFile: (p: string, contents: string): void => fs.writeFileSync(p, contents, "utf8"),
    replaceTextFile: atomicReplaceTextFile,
    readBinary: (p: string, maxBytes?: number): Buffer => {
      const bytes = fs.readFileSync(p);
      return maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes);
    },
    copyFile: (from: string, to: string): void => fs.copyFileSync(from, to),
    rename: (from: string, to: string): void => fs.renameSync(from, to),
    removeEmptyDir: (p: string): void => fs.rmdirSync(p),
  };
  const skillsIO = {
    readdir: (p: string): string[] => fs.readdirSync(p),
    readFile: (p: string): string => fs.readFileSync(p, "utf8"),
    exists: (p: string): boolean => fs.existsSync(p),
    writeFile: (p: string, contents: string): void => fs.writeFileSync(p, contents, "utf8"),
    mkdirp: (p: string): void => void fs.mkdirSync(p, { recursive: true }),
    remove: (p: string): void => fs.rmSync(p, { recursive: true, force: true }),
    rename: (from: string, to: string): void => fs.renameSync(from, to),
  };
  migrateLegacyInbox(memoryDir, workspaceIO);
  ensureWorkspace(memoryDir, workspaceIO);
  const memoryGovernance = createMemoryGovernance({ workspaceRoot: memoryDir, io: memoryIO });
  const notebooks = listNotebooks(memoryDir, workspaceIO);
  const migration = memoryGovernance.migrateLegacyLayout(notebooks.map((notebook) => notebook.id));
  memoryGovernance.rebuildViews([
    { type: "global" },
    ...notebooks.map((notebook) => ({ type: "notebook" as const, notebookId: notebook.id })),
  ]);
  const readCurrentMemory = (scope: { type: "global" } | { type: "notebook"; notebookId: string }) => {
    if (memoryGovernance.list(scope).records.length === 0) return undefined;
    return memoryIO.readFile(memoryGovernance.ensureScope(scope).currentView);
  };
  // 卡 E: scaffold <memoryDir>/.leemo as a local plugin so Skills are
  // discoverable with settingSources:[] intact (方案 G).
  try {
    ensureSkillsPlugin(memoryDir, skillsIO);
  } catch (e: unknown) {
    console.error("[bridge:dev] could not scaffold skills plugin:", e);
  }
  const officeSkills = createOfficeSkillProvisioner({
    configDir: path.join(dataDir, "office-skills"),
    bundledRoot: path.join(ROOT, "bundled-skills", "office", "release"),
  });
  void officeSkills.ensureReady().then((snapshot) => {
    console.log(
      `[bridge:dev] Office skills: ${snapshot.status}${snapshot.status === "ready" ? ` (${snapshot.source ?? "local"})` : ""}`,
    );
  });
  const superpowersSkills = createSuperpowersSkillProvisioner({
    configDir: dataDir,
    bundledRoot: path.join(ROOT, "bundled-skills", "superpowers", "release"),
  });
  void superpowersSkills.ensureReady().then((snapshot) => {
    console.log(
      `[bridge:dev] Superpowers skills: ${snapshot.status}${snapshot.status === "ready" ? ` (${snapshot.skills.length})` : ""}`,
    );
  });

  const { createBridgeHost } = await import("./bridge-host");
  const { startWsServer } = await import("./ws-server");

  const port = Number(process.env.LEEMO_BRIDGE_PORT ?? 8787);

  // Create server first to get the push function, then wire it into host.
  // We use a deferred push so host and server can reference each other.
  let pushFn: Awaited<ReturnType<typeof startWsServer>>["push"] | undefined;

  const host = createBridgeHost({
    catalog,
    dataDir,
    // 轮 7 A1: 与 main.ts 同一语义 —— momo 在用户可见的 ~/Leemo 里干活，不再有沙箱。
    workspaceRoot: memoryDir,
    routeRootArtifactPath: (relativePath) => routeRootWritePath(
      relativePath,
      listNotebooks(memoryDir, workspaceIO).map((notebook) => notebook.id),
    ),
    readGlobalMemory: () => readCurrentMemory({ type: "global" }),
    memoryDir,
    skillAdmin: createSkillAdminService({ memoryDir }),
    officeSkills,
    superpowersSkills,
    memoryGovernance,
    skillsIO,
    resolveNotebook: (id) => {
      const notebook = listNotebooks(memoryDir, workspaceIO).find((candidate) => candidate.id === id);
      return notebook ? { title: notebook.title, dir: notebook.dir } : undefined;
    },
    readNotebookMemory: (id) => readCurrentMemory({ type: "notebook", notebookId: id }),
    // No shell in the ws dev harness — bridge:openSkillsDir is a no-op there.
    push: (channel, payload) => pushFn?.(channel, payload),
  });

  const srv = await startWsServer({ host, port });
  pushFn = srv.push;

  console.log(`[bridge:dev] listening on ws://127.0.0.1:${srv.port}`);
  console.log(
    `[bridge:dev] providers: ${ready.length} 家已配置` +
      `${ready.length ? ` (${ready.map((e) => e.provider.id).join(", ")})` : ""}` +
      `, ${catalog.length - ready.length} 家待配置`
  );
  console.log(`[bridge:dev] workspace: ${memoryDir}`);
  console.log(
    `[bridge:dev] governed memory: imported=${migration.imported}, errors=${migration.errors.length}, current=${memoryGovernance.list({ type: "global" }).records.length}`,
  );
  console.log(`[bridge:dev] skills dir: ${skillsRootFor(memoryDir)}`);

  const shutdown = () => {
    console.log("\n[bridge:dev] shutting down…");
    host.dispose();
    srv.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  console.error(`[bridge:dev] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
