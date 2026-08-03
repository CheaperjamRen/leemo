import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const HOME_WORKSPACE_ID = "leemo-home";

export interface WorkspaceRegistryEntry {
  id: string;
  name: string;
  /** Display-only. Renderer operations use id, never this path. */
  displayPath: string;
  kind: "home" | "external";
  available: boolean;
  lastOpenedAt: number;
}

export interface ResolvedWorkspace extends WorkspaceRegistryEntry {
  /** Main-process filesystem operand. Never accepted back from renderer. */
  root: string;
}

interface StoredWorkspace {
  id: string;
  name: string;
  root: string;
  lastOpenedAt: number;
}

interface RegistryFile {
  version: 1;
  workspaces: StoredWorkspace[];
}

export interface WorkspaceRegistry {
  list(): WorkspaceRegistryEntry[];
  register(candidate: string): WorkspaceRegistryEntry;
  touch(id: string): WorkspaceRegistryEntry;
  forget(id: string): boolean;
  resolve(id: string): ResolvedWorkspace;
}

export interface WorkspaceRegistryOptions {
  homeRoot: string;
  registryFile: string;
  now?: () => number;
}

export async function registerPickedWorkspace(
  registry: WorkspaceRegistry,
  pickDirectory: () => Promise<string | null>,
): Promise<WorkspaceRegistryEntry | null> {
  const selected = await pickDirectory();
  return selected === null ? null : registry.register(selected);
}

function canonicalDirectory(candidate: string): string {
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error("文件夹路径不能为空");
  const resolved = path.resolve(candidate.trim());
  if (!fs.existsSync(resolved)) throw new Error("找不到这个工作区，请重新选择文件夹。");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("读不到这个工作区，请检查文件夹权限。");
  }
  if (!stat.isDirectory()) throw new Error("选择的路径不是文件夹。");
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    throw new Error("无法确认这个工作区的真实位置。");
  }
}

function pathKey(candidate: string): string {
  const normalized = path.normalize(candidate).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function workspaceId(root: string): string {
  return `workspace-${createHash("sha256").update(pathKey(root)).digest("hex").slice(0, 20)}`;
}

function usableDirectory(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function storedWorkspace(value: unknown): value is StoredWorkspace {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredWorkspace>;
  return typeof item.id === "string"
    && /^workspace-[a-f0-9]{20}$/.test(item.id)
    && typeof item.name === "string"
    && item.name.length > 0
    && typeof item.root === "string"
    && path.isAbsolute(item.root)
    && typeof item.lastOpenedAt === "number"
    && Number.isFinite(item.lastOpenedAt);
}

function writeAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, contents, "utf8");
  try {
    fs.renameSync(temporary, file);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
    fs.rmSync(file, { force: true });
    fs.renameSync(temporary, file);
  }
}

export function createWorkspaceRegistry(options: WorkspaceRegistryOptions): WorkspaceRegistry {
  const { registryFile } = options;
  const now = options.now ?? Date.now;
  const homeRoot = canonicalDirectory(options.homeRoot);

  const read = (): StoredWorkspace[] => {
    if (!fs.existsSync(registryFile)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(registryFile, "utf8")) as Partial<RegistryFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)) return [];
      const byId = new Map<string, StoredWorkspace>();
      for (const value of parsed.workspaces) {
        if (!storedWorkspace(value)) continue;
        // A hand-edited/corrupt file must not let an id point at a different
        // path. Recompute the opaque id from the stored canonical path.
        if (workspaceId(value.root) !== value.id) continue;
        const previous = byId.get(value.id);
        if (!previous || value.lastOpenedAt >= previous.lastOpenedAt) byId.set(value.id, value);
      }
      return [...byId.values()];
    } catch {
      return [];
    }
  };

  const write = (workspaces: StoredWorkspace[]): void => {
    const file: RegistryFile = {
      version: 1,
      workspaces: [...workspaces].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt),
    };
    writeAtomic(registryFile, `${JSON.stringify(file, null, 2)}\n`);
  };

  const home = (): ResolvedWorkspace => ({
    id: HOME_WORKSPACE_ID,
    name: path.basename(homeRoot) || "Leemo",
    displayPath: homeRoot,
    kind: "home",
    available: true,
    lastOpenedAt: 0,
    root: homeRoot,
  });

  const homeEntry = (): WorkspaceRegistryEntry => {
    const { root: _root, ...entry } = home();
    return entry;
  };

  const project = (stored: StoredWorkspace): WorkspaceRegistryEntry => ({
    id: stored.id,
    name: stored.name,
    displayPath: stored.root,
    kind: "external",
    available: usableDirectory(stored.root),
    lastOpenedAt: stored.lastOpenedAt,
  });

  const resolveStored = (id: string): StoredWorkspace => {
    const stored = read().find((item) => item.id === id);
    if (!stored) throw new Error("没有登记这个工作区，请重新打开文件夹。");
    return stored;
  };

  return {
    list() {
      return [homeEntry(), ...read().sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).map(project)];
    },

    register(candidate) {
      const root = canonicalDirectory(candidate);
      if (pathKey(root) === pathKey(homeRoot)) return homeEntry();
      const id = workspaceId(root);
      const existing = read();
      const record: StoredWorkspace = {
        id,
        name: path.basename(root) || "外部工作区",
        root,
        lastOpenedAt: now(),
      };
      write([...existing.filter((item) => item.id !== id), record]);
      return project(record);
    },

    touch(id) {
      if (id === HOME_WORKSPACE_ID) return homeEntry();
      const target = resolveStored(id);
      const next = { ...target, lastOpenedAt: now() };
      write([...read().filter((item) => item.id !== id), next]);
      return project(next);
    },

    forget(id) {
      if (id === HOME_WORKSPACE_ID) throw new Error("Leemo 主工作区不能移除。");
      const current = read();
      if (!current.some((item) => item.id === id)) return false;
      write(current.filter((item) => item.id !== id));
      return true;
    },

    resolve(id) {
      if (id === HOME_WORKSPACE_ID) return home();
      const stored = resolveStored(id);
      if (!usableDirectory(stored.root)) throw new Error("找不到这个工作区，请重新选择文件夹。");
      const root = canonicalDirectory(stored.root);
      if (workspaceId(root) !== stored.id) {
        throw new Error("这个工作区的位置发生了变化，请重新打开文件夹。");
      }
      return { ...project(stored), available: true, root };
    },
  };
}
