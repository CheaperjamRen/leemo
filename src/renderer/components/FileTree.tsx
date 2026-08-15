import { useFileTree } from "../bridge/context";
import { useUi } from "../bridge/context";
import { useNotebooks } from "../bridge/context";
import { useWorkspace } from "../bridge/context";
import { useWorkspaces } from "../bridge/context";
import type { FileNode } from "../stores/file-tree";
import { X } from "lucide-react";

export function kindFromName(name: string): "markdown" | "pdf" | "html" | "other" {
  if (/\.(?:md|markdown)$/i.test(name)) return "markdown";
  if (/\.html?$/i.test(name)) return "html";
  if (/\.pdf$/i.test(name)) return "pdf";
  return "other";
}

function FileRow({
  node,
  reveal,
  allowNotebookMove,
  onOpenFile,
}: {
  node: FileNode;
  reveal: (path: string) => Promise<void>;
  allowNotebookMove: boolean;
  onOpenFile?: () => void;
}) {
  const expandedPaths = useFileTree((s) => s.expandedPaths);
  const toggleExpand = useFileTree((s) => s.toggleExpand);
  const moveToBook = useFileTree((s) => s.moveToBook);
  const openPreview = useUi((s) => s.openPreview);
  const previewActivePath = useUi((s) => s.previewActivePath);
  const notebooks = useNotebooks((s) => s.list);

  const isExpanded = expandedPaths.has(node.path);
  const isActive = previewActivePath === node.path;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Context menu handled inline via state in parent; here we use a simple approach
  };

  if (node.kind === "dir") {
    return (
      <div>
        <button
          className="flex h-7 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-[11.5px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
          onClick={() => toggleExpand(node.path)}
          data-testid={`dir-row-${node.path}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-3 w-3 shrink-0" aria-hidden>
            {isExpanded ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
          </svg>
        </button>
        {isExpanded && node.children && (
          <div className="ml-3">
            {node.children.map((child) => (
              <FileRow key={child.path} node={child} reveal={reveal} allowNotebookMove={allowNotebookMove} onOpenFile={onOpenFile} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <ContextMenuWrapper
      node={node}
      moveToBook={moveToBook}
      notebooks={notebooks}
      reveal={reveal}
      allowNotebookMove={allowNotebookMove}
    >
      <button
        className={`flex h-7 w-full items-center gap-1.5 rounded-[6px] border px-2 text-left text-[11.5px] transition-colors ${isActive
          ? "border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-soft)] text-[var(--leemo-ink)]"
          : "border-transparent text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
        }`}
        onClick={() => {
          openPreview(node.path, node.name, kindFromName(node.name));
          onOpenFile?.();
        }}
        data-testid={`file-row-${node.path}`}
        aria-current={isActive ? "page" : undefined}
        onContextMenu={handleContextMenu}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {node.isNew && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--leemo-amber)]" data-testid="new-indicator" />
        )}
        {node.referenced && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0 text-[var(--leemo-ink-3)]" data-testid="referenced-indicator" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
    </ContextMenuWrapper>
  );
}

function ContextMenuWrapper({
  node,
  moveToBook,
  notebooks,
  reveal,
  allowNotebookMove,
  children,
}: {
  reveal: (path: string) => Promise<void>;
  node: FileNode;
  moveToBook: (path: string, bookId: string | null) => Promise<void>;
  notebooks: { id: string; title: string }[];
  allowNotebookMove: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [subOpen, setSubOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSubOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
    >
      {children}
      {open && (
        <div
          className="absolute left-2 top-full z-50 min-w-[160px] rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-bg)] py-1 shadow-lg"
          data-testid="context-menu"
        >
          {allowNotebookMove && <div className="relative">
            <button
              className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
              onClick={() => setSubOpen((v) => !v)}
            >
              移入本子
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-3 w-3" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            {subOpen && (
              <div className="absolute left-full top-0 min-w-[140px] rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-bg)] py-1 shadow-lg">
                {notebooks.map((nb) => (
                  <button
                    key={nb.id}
                    className="w-full px-3 py-1.5 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                    onClick={() => {
                      // Now a REAL filesystem move (轮 3 卡 G). A rejection is
                      // already recorded in the store's `error` and surfaced by
                      // the banner below, so it must not become an unhandled
                      // rejection here.
                      void moveToBook(node.path, nb.id).catch(() => {});
                      setOpen(false);
                      setSubOpen(false);
                    }}
                    data-testid={`move-to-book-${nb.id}`}
                  >
                    {nb.title}
                  </button>
                ))}
              </div>
            )}
          </div>}
          <div className="my-1 border-t border-[var(--leemo-line)]" />
          <button className="w-full cursor-not-allowed px-3 py-1.5 text-left text-xs text-[var(--leemo-ink-3)] opacity-40" disabled title="Phase-1" data-testid="rename-btn">
            重命名
          </button>
          <button className="w-full cursor-not-allowed px-3 py-1.5 text-left text-xs text-[var(--leemo-ink-3)] opacity-40" disabled title="Phase-1" data-testid="delete-btn">
            删除
          </button>
          {/* 轮 3 卡 G: this one is real now — the workspace is a real directory,
              so revealing it is a guarded Explorer action. Rename and
              delete stay Phase-1 (both need to repoint existing bookIds). */}
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
            data-testid="show-in-folder-btn"
            onClick={() => {
              void reveal(node.path);
              setOpen(false);
            }}
          >
            在文件夹显示
          </button>
        </div>
      )}
    </div>
  );
}

import React from "react";

export interface FileTreeProps {
  /** The workbench activity panel owns its outer close affordance. */
  embedded?: boolean;
  onClose?: () => void;
  /** Optional callback used by an overlay activity panel after opening a file. */
  onOpenFile?: () => void;
}

export default function FileTree({ embedded = false, onClose, onOpenFile }: FileTreeProps = {}) {
  const roots = useFileTree((s) => s.roots);
  const error = useFileTree((s) => s.error);
  const loading = useFileTree((s) => s.loading);
  const refresh = useFileTree((s) => s.refresh);
  const workspace = useWorkspace();
  const activeWorkspace = useWorkspaces((s) =>
    s.list.find((entry) => entry.id === s.activeId) ?? null,
  );
  const activeNotebook = useNotebooks((s) => s.activeId);
  const dropFiles = useFileTree((s) => s.dropFiles);
  const closeFiles = useUi((s) => s.closeFiles);
  const [dragOver, setDragOver] = React.useState(false);
  const visibleRoots = activeWorkspace?.kind === "home" && activeNotebook
    ? roots.filter((node) => node.bookId === activeNotebook)
    : roots;

  const reveal = React.useCallback(
    async (path: string) => {
      // No workspace (browser dev) → nothing to reveal; silently ignore rather
      // than throwing at a click handler.
      await workspace?.reveal(path, activeWorkspace?.id).catch(() => {});
    },
    [activeWorkspace?.id, workspace],
  );

  // Dropping ONTO the tree files into the active 本子, or 默认工作区 when none is
  // active (06 §2.2). The absolute OS path can only be read in the preload
  // (Electron 32 removed File.path), so pathForFile does it for us.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // The workbench root has its own drop classifier. This drawer owns drops
    // inside the file tree, so bubbling would copy the same OS files twice.
    e.stopPropagation();
    setDragOver(false);
    if (!workspace) return;
    const sources = Array.from(e.dataTransfer.files)
      .map((f) => workspace.pathForFile(f))
      .filter((p) => p !== "");
    if (sources.length === 0) return;
    void dropFiles(sources, activeWorkspace?.kind === "external" ? null : activeNotebook).catch(() => {});
  };

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${dragOver ? "bg-[var(--leemo-amber-bg)]" : ""}`}
      onDragOver={(e) => {
        if (!workspace) return;
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      data-testid="file-tree-drop-zone"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--leemo-line)] px-3">
        <span className="text-[11px] text-[var(--leemo-ink-3)]">
          {activeWorkspace?.kind === "external"
            ? activeWorkspace.name
            : activeNotebook ?? "全部文件"}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="leemo-icon-btn h-6 w-6"
            title="在文件夹中打开本子"
            aria-label="在文件夹中打开本子"
            onClick={() => void workspace?.reveal(
              activeWorkspace?.kind === "home" ? activeNotebook ?? undefined : undefined,
              activeWorkspace?.id,
            ).catch(() => {})}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
            </svg>
          </button>
          {/* No fs.watch (轮 3 卡 G 抉择②) — Windows watch events are noisy, so
              refresh is explicit and also fires after every mutation. */}
          <button
            className="leemo-icon-btn h-6 w-6"
            title="刷新"
            aria-label="刷新文件树"
            onClick={() => void refresh()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
          {!embedded && (
            <button
              className="leemo-icon-btn h-6 w-6"
              title="关闭全部文件"
              aria-label="关闭文件树"
              onClick={onClose ?? closeFiles}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="shrink-0 border-b border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-bg)] px-3 py-1.5 text-[11px] text-[var(--leemo-ink-2)]"
          data-testid="file-tree-error"
        >
          {error}
        </div>
      )}

      {visibleRoots.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-[var(--leemo-ink-3)]">
          {loading
            ? "读取中…"
            : activeWorkspace?.kind === "external"
              ? "这个文件夹里还没有文件，拖一个进来试试"
              : "本子里还没有文件，拖一个进来试试"}
        </div>
      ) : (
        <div className="flex flex-col overflow-y-auto p-2" data-testid="file-tree">
          {visibleRoots.map((node) => (
            <FileRow
              key={node.path}
              node={node}
              reveal={reveal}
              allowNotebookMove={activeWorkspace?.kind !== "external"}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
