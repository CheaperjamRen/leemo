// Leemo — Workspace Manager (启动轮 3 卡 G). 本子 = 目录 (06 §五/§2.2/§7.4).
//
// The user-visible workspace is <home>/Leemo — the SAME directory as momo's
// memory bank, on purpose: 本子、默认工作区和 Leemo internals all live under it.
//
// THREE LOAD-BEARING DECISIONS:
//  1. A notebook IS a directory. Its id always remains the directory name, so
//     file ownership never drifts when the user edits a display title. A small
//     root-owned sidecar stores presentation-only title/archive state; it never
//     renames, moves or deletes the real folder.
//  2. Paths crossing IPC are workspace-RELATIVE with "/" separators. The
//     renderer never holds an absolute path, and every op funnels through
//     resolveInside() before touching fs — the renderer is a sandboxed,
//     untrusted input surface (same fail-closed discipline as B3's approval
//     payloads).
//  3. Pure + injected IO, so this is unit-testable with no real filesystem and
//     stays Electron-free (mirrors memory-bank.ts / skills.ts).

import path from "node:path";
import { DEFAULT_WORKSPACE_DIR } from "../bridge/contract";

export { DEFAULT_WORKSPACE_DIR };

/** Injected filesystem seam (sync — these are small, local, UI-driven ops). */
export interface WorkspaceIO {
  exists(p: string): boolean;
  isDirectory(p: string): boolean;
  mkdirp(dir: string): void;
  readdir(dir: string): { name: string; isDirectory: boolean }[];
  stat(p: string): { mtimeMs: number; size: number };
  readFile(p: string): string;
  writeFile(p: string, contents: string): void;
  /** Replace an existing text file without truncating it in place. The
   * implementation must stage in the same directory, re-check `expectedText`
   * immediately before replacement, and preserve the original permissions. */
  replaceTextFile(p: string, contents: string, expectedText: string): void;
  /** Raw bytes, for the preview pane's text-vs-binary decision (轮 4). When
   *  `maxBytes` is given the implementation MUST stop there — the point is to
   *  not pull a 400 MB file into memory just to discover it is unpreviewable.
   *  Returning fewer bytes than the file holds is expected, not an error. */
  readBinary(p: string, maxBytes?: number): Buffer;
  copyFile(from: string, to: string): void;
  rename(from: string, to: string): void;
  /** Remove one directory only when it is empty. Migration must never use a
   * recursive delete: a conflict left in Inbox is user data, not cleanup. */
  removeEmptyDir(dir: string): void;
}

/** Where a file lands when momo (or the user) can't say which notebook it
 * belongs to. A real directory, listed in the tree, but NOT a notebook. */
export const LEGACY_INBOX_DIR = "Inbox";

/** @deprecated Use DEFAULT_WORKSPACE_DIR. Kept for one compatibility cycle so
 * older internal callers still resolve to the new user-visible directory. */
export const INBOX_DIR = DEFAULT_WORKSPACE_DIR;

/** Directory names under the root that are never notebooks:
 *  - memory/   momo's memory bank files (own settings entry; not user filing)
 *  - .leemo/   Leemo-owned memory and user Skill internals
 *  - .claude/  one-cycle legacy Skill path, hidden during migration
 *  - 默认工作区/ and legacy Inbox/ — unfiled buckets, never notebooks */
const RESERVED_NAMES = new Set(["memory", ".leemo", ".claude", DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR]);

/** Notebook colors — decoration only, so a stable hash of the name is enough
 *  and no per-notebook state has to be stored anywhere. */
const COLORS = ["blue", "green", "red"] as const;
export type NotebookColor = (typeof COLORS)[number];

export interface NotebookInfo {
  id: string;
  title: string;
  /** Absolute path — main-process side only; never sent to the renderer as a
   *  path it is expected to send back. */
  dir: string;
  color: NotebookColor;
  /** Whether the notebook's temporal ledger currently contains a live fact. */
  hasMemory: boolean;
  /** Sidebar-only lifecycle state. Archiving never touches the real folder. */
  archived: boolean;
}

/** Structurally compatible with the renderer's FileNode, defined here so the
 *  host imports no renderer types (same layering rule as persistence/schema). */
export interface WorkspaceFileNode {
  /** Workspace-relative, "/"-separated. First segment === book id. */
  path: string;
  name: string;
  kind: "file" | "dir";
  bookId: string | null;
  children?: WorkspaceFileNode[];
  isNew?: boolean;
}

export interface PlacedFile {
  path: string;
  name: string;
  bookId: string | null;
}

export function workspaceRootFor(home: string): string {
  return path.join(home, "Leemo");
}

export interface WorkspaceMigrationReport {
  renamedLegacyRoot: boolean;
  moves: Array<{ from: string; to: string }>;
  conflicts: string[];
}

const migrationRel = (...parts: string[]): string => parts.join("/");

/** Move the old unfiled bucket into the approved default workspace without
 * overwriting a byte. When both directories exist, each non-conflicting top
 * level entry is renamed as a unit; a conflicting entry stays in Inbox so the
 * user can reconcile it deliberately. */
export function migrateLegacyInbox(root: string, io: WorkspaceIO): WorkspaceMigrationReport {
  const report: WorkspaceMigrationReport = {
    renamedLegacyRoot: false,
    moves: [],
    conflicts: [],
  };
  const legacy = path.join(root, LEGACY_INBOX_DIR);
  const current = path.join(root, DEFAULT_WORKSPACE_DIR);
  if (!io.exists(legacy) || !io.isDirectory(legacy)) return report;

  if (!io.exists(current)) {
    io.rename(legacy, current);
    report.renamedLegacyRoot = true;
    report.moves.push({ from: LEGACY_INBOX_DIR, to: DEFAULT_WORKSPACE_DIR });
    return report;
  }

  if (!io.isDirectory(current)) {
    report.conflicts.push(LEGACY_INBOX_DIR);
    return report;
  }

  for (const entry of io.readdir(legacy).sort(byName)) {
    const from = path.join(legacy, entry.name);
    const to = path.join(current, entry.name);
    const fromRel = migrationRel(LEGACY_INBOX_DIR, entry.name);
    if (io.exists(to)) {
      report.conflicts.push(fromRel);
      continue;
    }
    io.rename(from, to);
    report.moves.push({
      from: fromRel,
      to: migrationRel(DEFAULT_WORKSPACE_DIR, entry.name),
    });
  }

  if (io.readdir(legacy).length === 0) io.removeEmptyDir(legacy);
  return report;
}

/** Route a new relative write made from momo's root conversation. Existing
 * workspace containers preserve the user's explicit destination; ordinary
 * relative paths get the physical default workspace prefix. Suspicious paths
 * are deliberately left untouched so the approval boundary can reject them. */
export function routeRootWritePath(
  relativePath: string,
  containers: readonly string[],
  pathExists?: (normalizedRelativePath: string) => boolean,
): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) return relativePath;
  if (
    path.isAbsolute(relativePath)
    || relativePath.startsWith("/")
    || relativePath.startsWith("\\")
    || /^[A-Za-z]:[\\/]/.test(relativePath)
  ) return relativePath;

  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return relativePath;
  }
  const normalized = segments.join("/");
  const first = segments[0];
  if (first.startsWith(".")) return normalized;
  if (pathExists?.(normalized)) return normalized;

  const known = new Set([DEFAULT_WORKSPACE_DIR, ...containers].map((name) => name.toLocaleLowerCase()));
  if (known.has(first.toLocaleLowerCase())) return normalized;
  return `${DEFAULT_WORKSPACE_DIR}/${normalized}`;
}

function stableColor(name: string): NotebookColor {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** True for a name that may be used as a single directory segment under the
 *  root. Rejects separators, drive letters, dot-relative names and reserved
 *  names — the guard that makes "notebookId" safe to concatenate. */
function isValidSegment(name: string): boolean {
  if (!name || name.trim() !== name) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  // Windows-illegal characters and control chars: mkdir otherwise fails deep
  // inside fs. Spaces and hyphens are FINE in a name ("高等数学 2024",
  // "my-notes") — only leading/trailing space is rejected, by trim() above.
  if (/[<>:"|?*]/.test(name)) return false;
  if (/[\u0000-\u001f]/.test(name)) return false;
  return name.length <= 80;
}

/** Resolve a workspace-relative path to an absolute one, or throw.
 *
 *  THE security boundary for every renderer-supplied path. Rejects absolute
 *  paths, drive letters, backslash disguises and any `..` that would climb out,
 *  then verifies the resolved result really is under root (belt AND braces:
 *  the string checks catch intent, the prefix check catches anything clever). */
export function resolveInside(root: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim() === "") {
    throw new Error("路径不能为空");
  }
  const rel = relPath.trim();
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:/.test(rel)) {
    throw new Error(`只接受工作区内的相对路径：${relPath}`);
  }
  const segments = rel.split(/[/\\]+/).filter((s) => s.length > 0);
  if (segments.length === 0 || segments.some((s) => s === "." || s === "..")) {
    throw new Error(`路径不合法：${relPath}`);
  }
  const resolved = path.resolve(root, ...segments);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error(`路径越出了工作区：${relPath}`);
  }
  return resolved;
}

export interface WorkspaceOpenFileOptions {
  canonicalize(p: string): string;
  isFile(p: string): boolean;
}

/** Resolve a renderer-supplied file for launching with its system app.
 * Lexical containment alone is insufficient here: a symlink or junction may
 * live under the workspace while pointing outside it. Compare canonical paths
 * before allowing Electron to hand the target to the operating system. */
export function resolveWorkspaceOpenFile(
  root: string,
  relPath: string,
  io: Pick<WorkspaceIO, "exists">,
  options: WorkspaceOpenFileOptions,
): string {
  const target = resolveInside(root, relPath);
  if (!io.exists(target)) throw new Error(`读不到这个文件：${relPath}`);

  const canonicalRoot = options.canonicalize(path.resolve(root));
  const canonicalTarget = options.canonicalize(target);
  const relative = path.relative(canonicalRoot, canonicalTarget);
  if (
    relative === ""
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error("这个文件的真实位置越出了当前工作区，不能打开。");
  }
  if (!options.isFile(canonicalTarget)) {
    throw new Error("只能用系统默认程序打开普通文件。");
  }
  return canonicalTarget;
}

export type WorkspaceRevealPlan =
  | { kind: "show-item"; path: string }
  | { kind: "open-directory"; path: string };

/** Translate the user-facing "在文件夹中显示" command into the matching OS
 * action. Existing files are selected in Explorer; directories are opened.
 * A stale path falls back to its nearest existing parent instead of silently
 * trying to launch a file or reporting success for a no-op. */
export function planWorkspaceReveal(
  root: string,
  relPath: string,
  io: Pick<WorkspaceIO, "exists" | "isDirectory">,
): WorkspaceRevealPlan {
  const rootResolved = path.resolve(root);
  if (typeof relPath !== "string" || relPath.trim() === "") {
    return { kind: "open-directory", path: rootResolved };
  }

  const target = resolveInside(rootResolved, relPath);
  if (io.exists(target)) {
    return io.isDirectory(target)
      ? { kind: "open-directory", path: target }
      : { kind: "show-item", path: target };
  }

  let parent = path.dirname(target);
  while (parent !== rootResolved && (!io.exists(parent) || !io.isDirectory(parent))) {
    parent = path.dirname(parent);
  }
  return { kind: "open-directory", path: parent };
}

/** Absolute dir of a notebook id, validated. Throws for unknown/escaping ids. */
function notebookDir(root: string, io: WorkspaceIO, id: string): string {
  if (!isValidSegment(id) || RESERVED_NAMES.has(id)) {
    throw new Error(`本子名不合法：${id}`);
  }
  const dir = path.join(root, id);
  if (!io.exists(dir) || !io.isDirectory(dir)) throw new Error(`没有这个本子：${id}`);
  return dir;
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

function ledgerHasCurrentMemory(ledger: string, io: WorkspaceIO): boolean {
  if (!io.exists(ledger)) return false;
  const latest = new Map<string, string>();
  try {
    for (const rawLine of io.readFile(ledger).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const event = JSON.parse(line) as {
          version?: unknown;
          action?: unknown;
          after?: Array<{ id?: unknown; status?: unknown }>;
        };
        if (event.version !== 1 || typeof event.action !== "string" || !Array.isArray(event.after)) continue;
        for (const record of event.after) {
          if (typeof record?.id === "string" && typeof record.status === "string") {
            latest.set(record.id, record.status);
          }
        }
      } catch {
        // A damaged row must not hide valid rows that follow it.
      }
    }
  } catch {
    return false;
  }
  return [...latest.values()].some((status) => status === "current");
}

const NOTEBOOK_PRESENTATION_FILE = "notebooks.json";

interface NotebookPresentation {
  title?: string;
  archived?: boolean;
}

interface NotebookPresentationFile {
  version: 1;
  notebooks: Record<string, NotebookPresentation>;
}

function presentationPath(root: string): string {
  return path.join(root, ".leemo", NOTEBOOK_PRESENTATION_FILE);
}

function validDisplayTitle(value: unknown): value is string {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && value.length <= 80
    && !/[\u0000-\u001f]/.test(value);
}

function readNotebookPresentation(root: string, io: WorkspaceIO): Record<string, NotebookPresentation> {
  const file = presentationPath(root);
  if (!io.exists(file)) return {};
  try {
    const parsed = JSON.parse(io.readFile(file)) as Partial<NotebookPresentationFile>;
    if (parsed.version !== 1 || !parsed.notebooks || typeof parsed.notebooks !== "object") return {};
    const result: Record<string, NotebookPresentation> = {};
    for (const [id, value] of Object.entries(parsed.notebooks)) {
      if (!isValidSegment(id) || RESERVED_NAMES.has(id) || !value || typeof value !== "object") continue;
      const candidate = value as NotebookPresentation;
      result[id] = {
        ...(validDisplayTitle(candidate.title) ? { title: candidate.title } : {}),
        ...(typeof candidate.archived === "boolean" ? { archived: candidate.archived } : {}),
      };
    }
    return result;
  } catch {
    return {};
  }
}

function writeNotebookPresentation(
  root: string,
  notebooks: Record<string, NotebookPresentation>,
  io: WorkspaceIO,
): void {
  const file = presentationPath(root);
  const previous = io.exists(file) ? io.readFile(file) : null;
  const contents = `${JSON.stringify({ version: 1, notebooks } satisfies NotebookPresentationFile, null, 2)}\n`;
  io.mkdirp(path.dirname(file));
  if (previous === null) io.writeFile(file, contents);
  else io.replaceTextFile(file, contents, previous);
}

/** Make sure the workspace root and default workspace exist. Idempotent. */
export function ensureWorkspace(root: string, io: WorkspaceIO): void {
  io.mkdirp(root);
  io.mkdirp(path.join(root, DEFAULT_WORKSPACE_DIR));
}

/**
 * Every directory directly under the root that is a notebook. A missing
 * workspace is the normal first-run state — empty list, not an error.
 */
export function listNotebooks(root: string, io: WorkspaceIO): NotebookInfo[] {
  if (!io.exists(root)) return [];
  let entries: { name: string; isDirectory: boolean }[];
  try {
    entries = io.readdir(root);
  } catch {
    return [];
  }

  const presentation = readNotebookPresentation(root, io);
  return entries
    .filter((e) => e.isDirectory && !e.name.startsWith(".") && !RESERVED_NAMES.has(e.name))
    .map((e) => {
      const dir = path.join(root, e.name);
      const display = presentation[e.name];
      return {
        id: e.name,
        title: display?.title ?? e.name,
        dir,
        color: stableColor(e.name),
        hasMemory: ledgerHasCurrentMemory(path.join(dir, ".leemo", "memory", "ledger.jsonl"), io),
        archived: display?.archived ?? false,
      };
    })
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/** Create a notebook = create its directory. */
export function createNotebook(root: string, title: string, io: WorkspaceIO): NotebookInfo {
  const name = typeof title === "string" ? title.trim() : "";
  if (!isValidSegment(name)) throw new Error(`本子名不能用「${title}」，换一个（不能含 / \\ : 等符号）`);
  if (RESERVED_NAMES.has(name)) throw new Error(`「${name}」是 Leemo 保留的名字，换一个`);
  const dir = path.join(root, name);
  if (io.exists(dir)) throw new Error(`已经有一个叫「${name}」的本子了`);
  io.mkdirp(dir);
  return { id: name, title: name, dir, color: stableColor(name), hasMemory: false, archived: false };
}

/** Update presentation-only state for a real notebook. The physical directory
 * remains the stable identity and is never renamed or removed here. */
export function updateNotebookPresentation(
  root: string,
  id: string,
  input: { title?: string; archived?: boolean },
  io: WorkspaceIO,
): NotebookInfo {
  notebookDir(root, io, id);
  const presentation = readNotebookPresentation(root, io);
  const current = presentation[id] ?? {};
  const next: NotebookPresentation = { ...current };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!validDisplayTitle(title)) throw new Error("本子显示名称不能为空，且不能超过 80 个字。");
    next.title = title === id ? undefined : title;
  }
  if (input.archived !== undefined) next.archived = input.archived;
  if (next.title === undefined && next.archived !== true) delete presentation[id];
  else presentation[id] = next;
  writeNotebookPresentation(root, presentation, io);
  const updated = listNotebooks(root, io).find((book) => book.id === id);
  if (!updated) throw new Error(`没有这个本子：${id}`);
  return updated;
}

export const STARTER_NOTEBOOK_TITLE = "例：高等数学";

const STARTER_NOTEBOOK_FILES: Readonly<Record<string, string>> = {
  "从这里开始.md": `# 高等数学复习

## 本周目标

- [ ] 复习函数与极限
- [ ] 整理两道典型例题
- [ ] 把没想通的地方问 momo

## 待问 momo

- 为什么等价无穷小只能在乘除里直接替换？
`,
  "错题清单.md": `# 错题清单

| 日期 | 题目 | 错因 | 下次提醒 |
| --- | --- | --- | --- |
| 示例 | 极限计算 | 忘记检查定义域 | 先写条件再变形 |
`,
  "CLAUDE.md": `# 本子约定

这个本子用于高等数学复习。回答时先讲清直觉，再给严谨推导；遇到错题时帮我归纳错因，但不要替我跳过关键步骤。
`,
};

/** Prepare the deletable first-run example without exposing arbitrary writes to
 * the renderer. Existing user edits win: only missing files are seeded. */
export function ensureStarterNotebook(root: string, io: WorkspaceIO): NotebookInfo {
  ensureWorkspace(root, io);
  const dir = path.join(root, STARTER_NOTEBOOK_TITLE);
  if (io.exists(dir) && !io.isDirectory(dir)) {
    throw new Error(`没法创建示例本子：「${STARTER_NOTEBOOK_TITLE}」已被同名文件占用`);
  }
  io.mkdirp(dir);
  for (const [name, contents] of Object.entries(STARTER_NOTEBOOK_FILES)) {
    const target = path.join(dir, name);
    if (!io.exists(target)) io.writeFile(target, contents);
  }
  return {
    id: STARTER_NOTEBOOK_TITLE,
    title: STARTER_NOTEBOOK_TITLE,
    dir,
    color: stableColor(STARTER_NOTEBOOK_TITLE),
    hasMemory: false,
    archived: false,
  };
}

const NEW_FILE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TREE_DEPTH = 6;

/**
 * The real ~/Leemo/ tree as the UI mirror. Notebooks and 默认工作区 are visible;
 * `.leemo` (product internals), legacy `.claude` and `memory` (momo's own bank, with its
 * own settings entry) are hidden. Dirs before files, each alphabetical.
 */
export function readTree(
  root: string,
  io: WorkspaceIO,
  opts: { now?: number; notebookRoot?: boolean } = {},
): WorkspaceFileNode[] {
  if (!io.exists(root)) return [];
  const now = opts.now ?? Date.now();

  const walk = (absDir: string, relDir: string, depth: number): WorkspaceFileNode[] => {
    let entries: { name: string; isDirectory: boolean }[];
    try {
      entries = io.readdir(absDir);
    } catch {
      return []; // unreadable subtree: show nothing there rather than failing all
    }

    const visible = entries.filter((e) => {
      if (e.name.startsWith(".")) return false;
      // Only the TOP level has reserved names; a user's own "memory" folder
      // inside a notebook is just a folder.
      if (depth === 0 && e.isDirectory && e.name !== DEFAULT_WORKSPACE_DIR && RESERVED_NAMES.has(e.name)) {
        return false;
      }
      return true;
    });

    const dirs = visible.filter((e) => e.isDirectory).sort(byName);
    const files = visible.filter((e) => !e.isDirectory).sort(byName);

    const nodeFor = (e: { name: string; isDirectory: boolean }): WorkspaceFileNode => {
      const abs = path.join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      // First segment is the book id — except 默认工作区, which is unfiled.
      const first = rel.split("/")[0];
      const bookId = opts.notebookRoot === false || first === DEFAULT_WORKSPACE_DIR ? null : first;

      if (e.isDirectory) {
        return {
          path: rel,
          name: e.name,
          kind: "dir",
          bookId,
          children: depth + 1 < MAX_TREE_DEPTH ? walk(abs, rel, depth + 1) : [],
        };
      }
      let isNew = false;
      try {
        isNew = now - io.stat(abs).mtimeMs < NEW_FILE_WINDOW_MS;
      } catch {
        // vanished mid-scan: just not new
      }
      return { path: rel, name: e.name, kind: "file", bookId, ...(isNew ? { isNew } : {}) };
    };

    return [...dirs.map(nodeFor), ...files.map(nodeFor)];
  };

  return walk(root, "", 0);
}

/** Pick a non-colliding filename in `dir`: "a.md" → "a (2).md" → "a (3).md". */
function uniqueName(dir: string, name: string, io: WorkspaceIO): string {
  if (!io.exists(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!io.exists(path.join(dir, candidate))) return candidate;
  }
  throw new Error(`「${name}」重名太多了，先清理一下`);
}

export interface DropRequest {
  /** ABSOLUTE OS paths, from the preload's webUtils.getPathForFile (the only
   *  way to learn a dropped file's path since Electron 32 removed File.path). */
  sources: string[];
  /** Target notebook, or null → 默认工作区. */
  notebookId: string | null;
}

export interface DropOptions {
  /** External workspaces have no Leemo 默认工作区 bucket: null lands at root. */
  directRoot?: boolean;
}

/**
 * File the dropped files (06 §2.2). COPY, not move: the user dragged from
 * Downloads and would not expect the original to disappear.
 */
export function dropFiles(root: string, req: DropRequest, io: WorkspaceIO, options: DropOptions = {}): PlacedFile[] {
  if (options.directRoot && req.notebookId !== null) {
    throw new Error("外部工作区没有本子，请直接放到当前文件夹。");
  }
  const targetDir = req.notebookId === null
    ? options.directRoot ? root : path.join(root, DEFAULT_WORKSPACE_DIR)
    : notebookDir(root, io, req.notebookId);
  const bookId = req.notebookId === null ? null : req.notebookId;
  const relBase = req.notebookId === null
    ? options.directRoot ? "" : DEFAULT_WORKSPACE_DIR
    : req.notebookId;
  io.mkdirp(targetDir);

  const placed: PlacedFile[] = [];
  for (const source of req.sources) {
    if (typeof source !== "string" || source.trim() === "") continue;
    if (!io.exists(source)) throw new Error(`找不到这个文件：${source}`);
    if (io.isDirectory(source)) throw new Error(`暂时只能拖文件，不能拖文件夹：${path.basename(source)}`);
    const name = uniqueName(targetDir, path.basename(source), io);
    io.copyFile(source, path.join(targetDir, name));
    placed.push({ path: relBase ? `${relBase}/${name}` : name, name, bookId });
  }
  return placed;
}

/** Move a file already inside the workspace into a notebook (右键→移入本子). */
export function moveFile(
  root: string,
  req: { path: string; notebookId: string | null },
  io: WorkspaceIO,
): PlacedFile {
  const from = resolveInside(root, req.path);
  if (!io.exists(from)) throw new Error(`找不到这个文件：${req.path}`);
  if (io.isDirectory(from)) throw new Error("暂时只能移动文件，不能移动文件夹");

  const targetDir = req.notebookId === null
    ? path.join(root, DEFAULT_WORKSPACE_DIR)
    : notebookDir(root, io, req.notebookId);
  io.mkdirp(targetDir);
  const relBase = req.notebookId === null ? DEFAULT_WORKSPACE_DIR : req.notebookId;
  const name = uniqueName(targetDir, path.basename(from), io);
  io.rename(from, path.join(targetDir, name));
  return { path: `${relBase}/${name}`, name, bookId: req.notebookId };
}

/**
 * momo's "which notebook is this?" guess (06 §2.2), as a deterministic local
 * heuristic rather than a model call: a drag-and-drop must answer instantly,
 * and the design only asks for a suggestion the user then confirms. Swapping in
 * a real model call later changes this function only.
 */
export function suggestNotebook(
  fileName: string,
  notebooks: { id: string; title: string }[],
): string | null {
  const ext = path.extname(fileName);
  const stem = (ext ? fileName.slice(0, -ext.length) : fileName).toLowerCase().trim();
  if (stem.length < 2) return null;

  for (const book of notebooks) {
    const title = book.title.toLowerCase().trim();
    if (title.length < 2) continue;
    // Either direction: "高等数学-第三章.pdf" mentions the book, and "数据结构.md"
    // is mentioned BY the book.
    if (stem.includes(title) || title.includes(stem)) return book.id;
  }
  return null;
}

export interface NotebookMemory {
  /** Contents of <notebook>/CLAUDE.md, or undefined when it does not exist. */
  text?: string;
  dir: string;
  title: string;
}

/**
 * Read a notebook's mid-term memory layer (06 §7.4). Returns undefined for an
 * unknown or escaping id: this runs on the create-conversation path, where a
 * stale notebook id must not be able to break chat. Read fresh every time so a
 * new conversation sees what momo just wrote (same rule as the global bank).
 */
export function readNotebookMemory(
  root: string,
  notebookId: string,
  io: WorkspaceIO,
): NotebookMemory | undefined {
  if (!isValidSegment(notebookId) || RESERVED_NAMES.has(notebookId)) return undefined;
  const dir = path.join(root, notebookId);
  if (!io.exists(dir) || !io.isDirectory(dir)) return undefined;

  const file = path.join(dir, "CLAUDE.md");
  let text: string | undefined;
  try {
    if (io.exists(file)) text = io.readFile(file);
  } catch {
    text = undefined; // unreadable → no mid-term memory this conversation
  }
  return { ...(text !== undefined ? { text } : {}), dir, title: notebookId };
}

/** Read a workspace file as text (preview pane). Guarded by resolveInside. */
export function readTextFile(root: string, relPath: string, io: WorkspaceIO): string {
  const abs = resolveInside(root, relPath);
  if (!io.exists(abs) || io.isDirectory(abs)) throw new Error(`读不到这个文件：${relPath}`);
  return io.readFile(abs);
}

// ── 预览区取内容（轮 4「预览区通电」）───────────────────────────────────────
//
// `readTextFile` above is not enough for a preview pane, for two reasons the
// user would see immediately:
//   1. A PDF is bytes. `readFileSync(p, "utf8")` on one returns lossy mojibake
//      — it cannot be re-encoded back into a valid PDF, so PDF.js gets garbage.
//   2. A 400 MB video decoded as utf8 would be sent across IPC as a ~400 MB
//      string before anyone noticed it is unpreviewable.
// So the decision of WHAT a file is happens here, in main, where the bytes are
// — not in the renderer after a blind read.

/** Text above this is truncated rather than shipped whole: past a couple of MB
 *  the pane is unreadable anyway and the IPC copy starts to be felt. */
export const PREVIEW_TEXT_MAX_BYTES = 2 * 1024 * 1024;

/** Binary payloads (PDF) above this are refused outright. PDF.js would hold the
 *  decoded document in renderer memory on top of the base64 transfer copy. */
export const PREVIEW_BINARY_MAX_BYTES = 25 * 1024 * 1024;

const PROTECTED_EDITOR_ROOTS = new Set([".leemo", ".claude"]);

export interface MarkdownWriteOptions {
  /** The home workspace still contains the pre-governance `memory/` bank. An
   * external project may legitimately use the same ordinary folder name. */
  protectLegacyMemory?: boolean;
  /** Resolve existing paths through links before writing. The Electron host
   * supplies native realpath; tests may inject a deterministic equivalent. */
  canonicalize?: (path: string) => string;
}

/** Save an existing Markdown document from the preview editor.
 *
 * This is intentionally narrower than an arbitrary renderer-side write API:
 * only existing Markdown files outside Leemo's private directories are
 * accepted. `expectedText` is the exact version the user started editing, so
 * an external change is never overwritten silently. */
export function writeMarkdownFile(
  root: string,
  relPath: string,
  text: string,
  expectedText: string,
  io: WorkspaceIO,
  options: MarkdownWriteOptions = {},
): Extract<PreviewPayload, { kind: "text" }> {
  const abs = resolveInside(root, relPath);
  const size = Buffer.byteLength(text, "utf8");
  if (size > PREVIEW_TEXT_MAX_BYTES) {
    throw new Error("这份 Markdown 太大了，无法从预览编辑器安全保存。");
  }
  if (!io.exists(abs) || io.isDirectory(abs)) throw new Error(`读不到这个文件：${relPath}`);

  const canonicalRoot = options.canonicalize ? options.canonicalize(root) : path.resolve(root);
  const canonicalTarget = options.canonicalize ? options.canonicalize(abs) : abs;
  const canonicalRelative = path.relative(canonicalRoot, canonicalTarget);
  if (
    canonicalRelative === ""
    || canonicalRelative === ".."
    || canonicalRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(canonicalRelative)
  ) {
    throw new Error("这个文件的真实位置越出了当前工作区，不能从预览编辑器修改。");
  }

  // All policy checks use the normalized, canonical target. Otherwise leading
  // spaces or an in-workspace symlink could disguise `.leemo` or a non-Markdown
  // file while still reaching it during the actual write.
  const firstSegment = canonicalRelative.split(/[/\\]+/).filter(Boolean)[0]?.toLocaleLowerCase();
  const protectedLegacyMemory = options.protectLegacyMemory !== false && firstSegment === "memory";
  if (firstSegment && (PROTECTED_EDITOR_ROOTS.has(firstSegment) || protectedLegacyMemory)) {
    throw new Error("这是 Leemo 的内部文件，不能从预览编辑器修改。");
  }
  if (!/\.(?:md|markdown)$/i.test(canonicalRelative)) {
    throw new Error("当前只支持在这里编辑 Markdown 文件。");
  }
  if (io.stat(canonicalTarget).size > PREVIEW_TEXT_MAX_BYTES || io.readFile(canonicalTarget) !== expectedText) {
    throw new Error("文件已在其他地方发生了变化。你的草稿还在，请重新载入后再保存。");
  }

  io.replaceTextFile(canonicalTarget, text, expectedText);
  return { kind: "text", text, truncated: false, size };
}

/** What the preview pane gets back. A discriminated union rather than
 *  `{ text, isBinary }`: "unpreviewable" is a first-class state with its own
 *  reason to show, and the pane must never fall through to rendering bytes as
 *  text (02 §十九 八态齐全禁空白屏). */
export type PreviewPayload =
  | { kind: "text"; text: string; truncated: boolean; size: number }
  | { kind: "binary"; mimeType: string; base64: string; size: number; mtimeMs: number }
  | { kind: "unpreviewable"; reason: string; size: number };

const PDF_MAGIC = Buffer.from("%PDF-");
const RASTER_IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

function rasterImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return null;
}

/**
 * Is this buffer text? A NUL byte is the classic tell (no text encoding we care
 * about emits one), and a strict utf8 round-trip catches the rest: Buffer's
 * utf8 decoder substitutes U+FFFD for every invalid sequence, so re-encoding a
 * decoded string and comparing lengths detects the substitution without needing
 * a charset detector.
 *
 * GB18030-encoded Chinese text is the known false negative — it is not valid
 * utf8, so it lands in "unpreviewable" rather than being shown as mojibake.
 * That is the deliberate trade: a clear "can't preview this" beats a pane full
 * of 锟斤拷.
 */
export function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  const decoded = sample.toString("utf8");
  // When the sample is a PREFIX of a bigger file, trailing U+FFFDs are a
  // sampling artefact: a 3-byte CJK char straddling the 8 KiB cut always
  // produces one. Anywhere else, a U+FFFD means the bytes really are not utf8.
  const meaningful = sample.length === buf.length ? decoded : decoded.replace(/�+$/, "");
  return !meaningful.includes("�");
}

/**
 * Read a workspace file for the preview pane, deciding text vs binary vs
 * "don't preview this" from the actual bytes.
 *
 * PDFs and common raster images come back as bounded base64 payloads. Other
 * binary formats remain an explicit refusal with a human reason.
 */
export function readPreview(root: string, relPath: string, io: WorkspaceIO): PreviewPayload {
  const abs = resolveInside(root, relPath);
  if (!io.exists(abs)) throw new Error(`读不到这个文件：${relPath}`);
  if (io.isDirectory(abs)) throw new Error(`这是个文件夹，不是文件：${relPath}`);

  const metadata = io.stat(abs);
  const { size, mtimeMs } = metadata;
  const extension = path.extname(relPath).toLowerCase();
  const isPdf = extension === ".pdf";
  const expectedImageMime = RASTER_IMAGE_MIME_BY_EXTENSION[extension];

  if (isPdf) {
    if (size > PREVIEW_BINARY_MAX_BYTES) {
      return {
        kind: "unpreviewable",
        reason: `PDF 太大了（${formatSize(size)}），超过 ${formatSize(PREVIEW_BINARY_MAX_BYTES)} 不在这里预览`,
        size,
      };
    }
    const buf = io.readBinary(abs);
    // Extension-only trust would hand PDF.js a renamed .zip and surface as an
    // opaque worker error; check the magic and say the real thing instead.
    if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      return { kind: "unpreviewable", reason: "文件名是 .pdf，但内容不是 PDF", size };
    }
    return { kind: "binary", mimeType: "application/pdf", base64: buf.toString("base64"), size, mtimeMs };
  }

  if (expectedImageMime) {
    if (size > PREVIEW_BINARY_MAX_BYTES) {
      return {
        kind: "unpreviewable",
        reason: `图片太大了（${formatSize(size)}），超过 ${formatSize(PREVIEW_BINARY_MAX_BYTES)} 不在这里预览`,
        size,
      };
    }
    const buf = io.readBinary(abs);
    const detectedMime = rasterImageMime(buf);
    if (!detectedMime || detectedMime !== expectedImageMime) {
      return { kind: "unpreviewable", reason: "文件名看起来是图片，但内容不是对应的图片格式", size };
    }
    return { kind: "binary", mimeType: detectedMime, base64: buf.toString("base64"), size, mtimeMs };
  }

  // Read at most one byte past the cap: that extra byte is how we know whether
  // truncation happened without reading a 400 MB file to find out.
  const buf = io.readBinary(abs, PREVIEW_TEXT_MAX_BYTES + 1);
  if (buf.length === 0) return { kind: "text", text: "", truncated: false, size };
  if (!looksLikeText(buf)) {
    return { kind: "unpreviewable", reason: "这是二进制文件，没法当文本预览", size };
  }
  const truncated = buf.length > PREVIEW_TEXT_MAX_BYTES;
  const text = buf.subarray(0, PREVIEW_TEXT_MAX_BYTES).toString("utf8");
  return {
    kind: "text",
    // A truncated read can cut a multi-byte char in half; drop the resulting
    // replacement char rather than showing a stray U+FFFD at the end.
    text: truncated ? text.replace(/�$/, "") : text,
    truncated,
    size,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
