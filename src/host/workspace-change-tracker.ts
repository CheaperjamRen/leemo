import { promises as fs, watch as watchFs, type FSWatcher } from "node:fs";
import path from "node:path";

export type WorkspaceFileChange = {
  path: string;
  change: "added" | "modified" | "deleted";
};

export type WorkspaceChangeSnapshot = {
  files: string[];
  complete: boolean;
};

export interface WorkspaceChangeTrackerIO {
  snapshot(
    root: string,
    ignoreDirectory: (relativePath: string) => boolean,
    maxFiles: number,
  ): Promise<WorkspaceChangeSnapshot>;
  watch(root: string, onPath: (filename: string | Buffer | null) => void): { close(): void };
  settle(ms: number): Promise<void>;
}

export interface WorkspaceChangeTracker {
  /** Baseline filenames are captured before the SDK is allowed to execute the tool. */
  ready: Promise<void>;
  /** Tool inputs provide a deterministic fallback when the OS watcher coalesces an event. */
  notePath(filePath: string): void;
  /** Idempotent: interrupt and normal stream cleanup may race to close the same round. */
  finish(): Promise<{ changes: WorkspaceFileChange[]; omitted: number }>;
}

const ALWAYS_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".leemo",
  ".claude",
  "node_modules",
  ".next",
  ".nuxt",
  "dist-electron",
  "coverage",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".venv",
  "venv",
]);

const DEFAULT_MAX_SNAPSHOT_FILES = 50_000;
const DEFAULT_MAX_CHANGES = 100;
const DEFAULT_SETTLE_MS = 60;

function slash(relativePath: string): string {
  return relativePath.split(path.sep).join("/").replaceAll("\\", "/");
}

function pathSegments(relativePath: string): string[] {
  return slash(relativePath).split("/").filter(Boolean);
}

function isIgnoredRelative(relativePath: string, ignoreLegacyRootMemory: boolean): boolean {
  const segments = pathSegments(relativePath);
  if (segments.length === 0) return true;
  const lower = segments.map((segment) => segment.toLocaleLowerCase());
  if (lower.some((segment) => ALWAYS_IGNORED_DIRECTORY_NAMES.has(segment))) return true;
  return ignoreLegacyRootMemory && lower[0] === "memory";
}

function relativeInside(root: string, candidate: string): string | undefined {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }
  return slash(relative);
}

async function snapshotFiles(
  root: string,
  ignoreDirectory: (relativePath: string) => boolean,
  maxFiles: number,
): Promise<WorkspaceChangeSnapshot> {
  const files: string[] = [];
  const pending = [{ absolute: path.resolve(root), relative: "" }];
  let complete = true;

  while (pending.length > 0 && files.length < maxFiles) {
    const current = pending.pop();
    if (!current) break;
    let entries;
    try {
      entries = await fs.readdir(current.absolute, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoreDirectory(relative)) {
          pending.push({ absolute: path.join(current.absolute, entry.name), relative });
        }
        continue;
      }
      files.push(relative);
      if (files.length >= maxFiles) {
        complete = false;
        break;
      }
    }
  }

  return { files, complete };
}

const nodeIO: WorkspaceChangeTrackerIO = {
  snapshot: snapshotFiles,
  watch(root, onPath) {
    let watcher: FSWatcher | undefined;
    try {
      watcher = watchFs(root, { recursive: true }, (_eventType, filename) => onPath(filename));
      watcher.on("error", () => {});
    } catch {
      // Snapshot diffs and explicit tool paths still cover add/delete and native edits.
    }
    return { close: () => watcher?.close() };
  },
  settle: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function createWorkspaceChangeTracker(
  root: string,
  options: {
    ignoreLegacyRootMemory?: boolean;
    maxChanges?: number;
    maxSnapshotFiles?: number;
    settleMs?: number;
    io?: WorkspaceChangeTrackerIO;
  } = {},
): WorkspaceChangeTracker {
  const resolvedRoot = path.resolve(root);
  const io = options.io ?? nodeIO;
  const ignoreLegacyRootMemory = options.ignoreLegacyRootMemory === true;
  const maxChanges = Math.max(1, options.maxChanges ?? DEFAULT_MAX_CHANGES);
  const maxSnapshotFiles = Math.max(maxChanges, options.maxSnapshotFiles ?? DEFAULT_MAX_SNAPSHOT_FILES);
  const settleMs = Math.max(0, options.settleMs ?? DEFAULT_SETTLE_MS);
  const touched = new Map<string, number>();
  let touchIndex = 0;

  const normalizeCandidate = (candidate: string): string | undefined => {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(resolvedRoot, candidate);
    const relative = relativeInside(resolvedRoot, absolute);
    if (!relative || isIgnoredRelative(relative, ignoreLegacyRootMemory)) return undefined;
    return relative;
  };
  const notePath = (candidate: string): void => {
    const relative = normalizeCandidate(candidate);
    if (relative !== undefined && !touched.has(relative)) touched.set(relative, touchIndex++);
  };
  const ignoreDirectory = (relative: string): boolean =>
    isIgnoredRelative(relative, ignoreLegacyRootMemory);

  const watcher = io.watch(resolvedRoot, (filename) => {
    if (filename === null) return;
    notePath(Buffer.isBuffer(filename) ? filename.toString() : filename);
  });
  const baselinePromise = io.snapshot(resolvedRoot, ignoreDirectory, maxSnapshotFiles);
  const ready = baselinePromise.then(() => undefined, () => undefined);
  let finishPromise: Promise<{ changes: WorkspaceFileChange[]; omitted: number }> | undefined;

  return {
    ready,
    notePath,
    finish() {
      if (finishPromise) return finishPromise;
      finishPromise = (async () => {
        const baseline = await baselinePromise.catch(() => ({ files: [], complete: false }));
        await io.settle(settleMs);
        watcher.close();
        const final = await io.snapshot(resolvedRoot, ignoreDirectory, maxSnapshotFiles)
          .catch(() => ({ files: [], complete: false }));
        const before = new Set(baseline.files
          .map((file) => normalizeCandidate(file))
          .filter((file): file is string => file !== undefined));
        const after = new Set(final.files
          .map((file) => normalizeCandidate(file))
          .filter((file): file is string => file !== undefined));
        const changes = new Map<string, WorkspaceFileChange["change"]>();

        for (const relative of touched.keys()) {
          const existedBefore = before.has(relative);
          const existsAfter = after.has(relative);
          if (existedBefore && existsAfter) changes.set(relative, "modified");
          else if (!existedBefore && existsAfter) changes.set(relative, baseline.complete ? "added" : "modified");
          else if (existedBefore && !existsAfter && final.complete) changes.set(relative, "deleted");
        }
        if (baseline.complete) {
          for (const relative of [...after].sort()) {
            if (!before.has(relative) && !changes.has(relative)) changes.set(relative, "added");
          }
        }
        if (final.complete) {
          for (const relative of [...before].sort()) {
            if (!after.has(relative) && !changes.has(relative)) changes.set(relative, "deleted");
          }
        }

        const all = [...changes].map(([filePath, change]) => ({ path: filePath, change }));
        return {
          changes: all.slice(0, maxChanges),
          omitted: Math.max(0, all.length - maxChanges),
        };
      })();
      return finishPromise;
    },
  };
}
