/**
 * Renderer-side Workspace port (轮 3 卡 G). 本子 = 目录 under ~/Leemo (06 §五).
 *
 * Deliberately NOT part of the frozen bridge contract: 10 号 §S11 states that
 * filesystem facts (directory/file listings) live outside the 09 conversation
 * contract, and `leemo:persist` already established this shape — an independent
 * preload surface with one multiplexed invoke.
 *
 * PATH DISCIPLINE: every `path` here is workspace-RELATIVE with "/" separators
 * ("数据结构/第五章/笔记.md"). The renderer never holds or sends an absolute
 * path; main re-validates each one against the workspace root before touching
 * the filesystem. `dir` on a notebook is display-only (shown in the UI, used for
 * "在文件夹中显示") and is never sent back as an operand.
 */

export type NotebookColor = "blue" | "green" | "red";

export interface WorkspaceNotebook {
  /** Directory name — also the id AND the title (no sidecar metadata exists). */
  id: string;
  title: string;
  /** Absolute path, display-only. */
  dir: string;
  color: NotebookColor;
  /** Whether <notebook>/CLAUDE.md exists (06 §7.4 中期记忆层). */
  hasMemory: boolean;
}

export interface WorkspaceFileNode {
  path: string;
  name: string;
  kind: "file" | "dir";
  /** First path segment, i.e. the owning notebook — null for 默认工作区. */
  bookId: string | null;
  children?: WorkspaceFileNode[];
  isNew?: boolean;
}

export interface PlacedFile {
  path: string;
  name: string;
  bookId: string | null;
}

/** A main-process-approved workspace projection. `displayPath` is for people;
 * every operation goes back through the opaque id. */
export interface WorkspaceRootInfo {
  id: string;
  name: string;
  displayPath: string;
  kind: "home" | "external";
  available: boolean;
  lastOpenedAt: number;
}

/**
 * What the preview pane receives for one file (轮 4「预览区通电」).
 *
 * Structurally mirrors `PreviewPayload` in src/host/workspace.ts — declared here
 * rather than imported for the same layering reason as WorkspaceFileNode: the
 * renderer imports no host code. `base64` (not a Buffer) because this crosses
 * IPC as JSON.
 */
export type PreviewPayload =
  | { kind: "text"; text: string; truncated: boolean; size: number }
  | { kind: "binary"; mimeType: string; base64: string; size: number }
  | { kind: "unpreviewable"; reason: string; size: number };

export type MarkdownWriteResult = Extract<PreviewPayload, { kind: "text" }>;

export interface WorkspaceClient {
  listWorkspaces?(): Promise<WorkspaceRootInfo[]>;
  /** Opens Electron's native directory picker. Renderer cannot supply a path. */
  pickWorkspace?(): Promise<WorkspaceRootInfo | null>;
  touchWorkspace?(id: string): Promise<WorkspaceRootInfo>;
  /** Removes a recent entry only; never deletes the folder or its contents. */
  forgetWorkspace?(id: string): Promise<boolean>;
  listNotebooks(): Promise<{ root: string; notebooks: WorkspaceNotebook[] }>;
  /** Creates the real directory. Throws with a human-readable reason (duplicate
   *  name, illegal characters) rather than failing silently. */
  createNotebook(title: string): Promise<WorkspaceNotebook>;
  /** Idempotently creates the fixed, deletable first-run example. This is a
   * narrow template operation, not a renderer-facing arbitrary file write. */
  ensureStarterNotebook(): Promise<WorkspaceNotebook>;
  readTree(workspaceId?: string): Promise<WorkspaceFileNode[]>;
  /** File OS files into a notebook, or 默认工作区 when notebookId is null.
   *  `sources` are absolute OS paths obtained via `pathForFile`. */
  dropFiles(sources: string[], notebookId: string | null, workspaceId?: string): Promise<PlacedFile[]>;
  /** Move a file already inside the selected workspace (右键 → 移入本子). */
  moveFile(path: string, notebookId: string | null, workspaceId?: string): Promise<PlacedFile>;
  /** momo's guess at where a dropped file belongs; null = "can't tell" → 默认工作区. */
  suggestNotebook(fileName: string, workspaceId?: string): Promise<string | null>;
  readTextFile(path: string, workspaceId?: string): Promise<string>;
  /** Preview-pane read (轮 4). Returns what the file IS — main classifies from
   *  the bytes, so the pane never has to guess from an extension. */
  readPreview(path: string, workspaceId?: string): Promise<PreviewPayload>;
  /** Save an existing, fully loaded Markdown file. Main compares
   * `expectedText` with disk before writing so outside edits are not lost. */
  writeMarkdownFile?(
    path: string,
    text: string,
    expectedText: string,
    workspaceId?: string,
  ): Promise<MarkdownWriteResult>;
  /** Reveal in the OS file manager; omit the path for the workspace root. */
  reveal(path?: string, workspaceId?: string): Promise<void>;
  /** Persists the current OS clipboard bitmap as a short-lived local file.
   * This keeps pasted screenshots on the same path-verified attachment route
   * as files chosen with the native picker. */
  stageClipboardImage?(): Promise<{
    name: string;
    path: string;
    size: number;
    mimeType: "image/png";
  }>;
  /** Deletes only a screenshot owned by this Leemo process's guarded cache.
   * Main rejects normal user files and other process sessions. */
  releaseClipboardImage?(path: string): Promise<void>;
  /** Absolute OS path of a dropped File (Electron `webUtils`), or "" when the
   *  drag carried no real file. Synchronous — it reads an object we already
   *  hold, it does not grant the renderer arbitrary path access. */
  pathForFile(file: File): string;
}
