import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface HumanFolderEntry {
  id: string;
  name: string;
  /** Display-only. Renderer actions use the opaque id. */
  displayPath: string;
  available: boolean;
  lastOpenedAt: number;
}

export interface ResolvedHumanFolder extends HumanFolderEntry {
  /** Main-process filesystem operand. Never accepted back from renderer. */
  root: string;
}

interface StoredHumanFolder {
  id: string;
  name: string;
  root: string;
  lastOpenedAt: number;
}

interface RegistryFile {
  version: 1;
  folders: StoredHumanFolder[];
}

export interface HumanFolderRegistry {
  list(): HumanFolderEntry[];
  register(candidate: string): HumanFolderEntry;
  touch(id: string): HumanFolderEntry;
  forget(id: string): boolean;
  resolve(id: string): ResolvedHumanFolder;
}

export interface HumanFolderRegistryOptions {
  registryFile: string;
  now?: () => number;
}

function pathKey(candidate: string): string {
  const normalized = path.normalize(candidate).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function folderId(root: string): string {
  return `human-folder-${createHash("sha256").update(pathKey(root)).digest("hex").slice(0, 20)}`;
}

function canonicalDirectory(candidate: string): string {
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error("文件夹路径不能为空");
  const resolved = path.resolve(candidate.trim());
  if (!fs.existsSync(resolved)) throw new Error("找不到这个文件夹，请重新选择。");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("读不到这个文件夹，请检查访问权限。");
  }
  if (!stat.isDirectory()) throw new Error("选择的路径不是文件夹。");
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    throw new Error("无法确认这个文件夹的真实位置。");
  }
}

function usableDirectory(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isStoredHumanFolder(value: unknown): value is StoredHumanFolder {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StoredHumanFolder>;
  return typeof item.id === "string"
    && /^human-folder-[a-f0-9]{20}$/.test(item.id)
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

export function createHumanFolderRegistry(options: HumanFolderRegistryOptions): HumanFolderRegistry {
  const now = options.now ?? Date.now;

  const read = (): StoredHumanFolder[] => {
    if (!fs.existsSync(options.registryFile)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(options.registryFile, "utf8")) as Partial<RegistryFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.folders)) return [];
      const byId = new Map<string, StoredHumanFolder>();
      for (const value of parsed.folders) {
        if (!isStoredHumanFolder(value) || folderId(value.root) !== value.id) continue;
        const previous = byId.get(value.id);
        if (!previous || value.lastOpenedAt >= previous.lastOpenedAt) byId.set(value.id, value);
      }
      return [...byId.values()];
    } catch {
      return [];
    }
  };

  const write = (folders: StoredHumanFolder[]): void => {
    const payload: RegistryFile = {
      version: 1,
      folders: [...folders].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt),
    };
    writeAtomic(options.registryFile, `${JSON.stringify(payload, null, 2)}\n`);
  };

  const project = (stored: StoredHumanFolder): HumanFolderEntry => ({
    id: stored.id,
    name: stored.name,
    displayPath: stored.root,
    available: usableDirectory(stored.root),
    lastOpenedAt: stored.lastOpenedAt,
  });

  const resolveStored = (id: string): StoredHumanFolder => {
    const stored = read().find((item) => item.id === id);
    if (!stored) throw new Error("没有保存这个常用文件夹，请重新添加。");
    return stored;
  };

  return {
    list() {
      return read().sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).map(project);
    },

    register(candidate) {
      const root = canonicalDirectory(candidate);
      const id = folderId(root);
      const current = read();
      const previous = current.find((item) => item.id === id);
      const record: StoredHumanFolder = {
        id,
        name: previous?.name ?? (path.basename(root) || "常用文件夹"),
        root,
        lastOpenedAt: now(),
      };
      write([...current.filter((item) => item.id !== id), record]);
      return project(record);
    },

    touch(id) {
      const target = resolveStored(id);
      const next = { ...target, lastOpenedAt: now() };
      write([...read().filter((item) => item.id !== id), next]);
      return project(next);
    },

    forget(id) {
      const current = read();
      if (!current.some((item) => item.id === id)) return false;
      write(current.filter((item) => item.id !== id));
      return true;
    },

    resolve(id) {
      const stored = resolveStored(id);
      if (!usableDirectory(stored.root)) throw new Error("找不到这个文件夹，请重新添加或从列表移除。");
      const root = canonicalDirectory(stored.root);
      if (folderId(root) !== stored.id) throw new Error("这个文件夹的位置发生了变化，请重新添加。");
      return { ...project(stored), available: true, root };
    },
  };
}
