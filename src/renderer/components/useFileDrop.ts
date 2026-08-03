import { useCallback, useEffect, useRef, useState } from "react";
import { useFileTree, useNotebooks, useWorkspace, useWorkspaces } from "../bridge/context";
import type { PendingDrop } from "./DropClassifyBar";

/** Native dragover events often expose only the `Files` type until drop; the
 * final drop also exposes `files`. Keep this test shared by both shells so the
 * workspace layer never starts swallowing text dragged inside the composer. */
export function isFileDataTransfer(transfer: Pick<DataTransfer, "types" | "files">): boolean {
  return Array.from(transfer.types ?? []).includes("Files") || transfer.files.length > 0;
}

/**
 * 06 §2.2 归类 routing, shared by both shells so they behave identically:
 *
 *   • a drop WITH an active 本子 → lands in it directly, no question asked
 *   • a drop with no notebook    → momo proposes, the user confirms (bar)
 *   • can't tell / user declines → 默认工作区
 *
 * The OS path of a dropped File can only be read in the preload
 * (`webUtils.getPathForFile`) — Electron 32 removed `File.path` — so the
 * renderer asks the workspace client for it.
 */
export function useFileDrop(): {
  pending: PendingDrop | null;
  /** Attach to a drop target. Returns true when a drop was actually handled. */
  handleDrop(files: FileList | File[]): boolean;
  confirm(notebookId: string | null): void;
  cancel(): void;
  enabled: boolean;
} {
  const workspace = useWorkspace();
  const activeNotebook = useNotebooks((s) => s.activeId);
  const activeWorkspace = useWorkspaces((s) =>
    s.list.find((entry) => entry.id === s.activeId) ?? null,
  );
  const dropFiles = useFileTree((s) => s.dropFiles);
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const activeBookId = activeWorkspace?.kind === "home" ? activeNotebook : null;
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  const activeBookIdRef = useRef(activeBookId);
  activeBookIdRef.current = activeBookId;
  const suggestionGenerationRef = useRef(0);

  useEffect(() => {
    // A confirmation belongs to the exact book visible at drop time. Switching
    // either its physical root or managed book cancels an already-visible bar
    // and any suggestion still awaiting main-process IO.
    suggestionGenerationRef.current += 1;
    setPending((current) => current?.workspaceId === activeWorkspaceId
      && current.bookId === activeBookId ? current : null);
  }, [activeBookId, activeWorkspaceId]);

  const handleDrop = useCallback(
    (files: FileList | File[]): boolean => {
      if (!workspace) return false;
      const list = Array.from(files);
      const sources = list.map((f) => workspace.pathForFile(f)).filter((p) => p !== "");
      const workspaceId = activeWorkspace?.id;
      if (sources.length === 0 || !workspaceId) return false;
      const bookId = activeWorkspace.kind === "home" ? activeNotebook : null;
      const generation = ++suggestionGenerationRef.current;
      setPending(null);

      if (activeWorkspace?.kind === "external") {
        // External projects have no Leemo notebook layer and no 默认工作区
        // bucket. A drop lands at the selected project root immediately.
        void dropFiles(sources, null, workspaceId).catch(() => {});
        return true;
      }

      if (activeNotebook) {
        // 06 §2.2: 拖入当前本子 → 直落该本子目录. No confirmation — the user
        // already told us where they are.
        void dropFiles(sources, activeNotebook, workspaceId).catch(() => {});
        return true;
      }

      const fileName = list[0]?.name ?? "文件";
      // Ask main for the suggestion (it knows the notebook list); show the bar
      // either way, since with no notebook context we must not guess silently.
      void workspace
        .suggestNotebook(fileName, workspaceId)
        .then((suggestion) => {
          if (
            suggestionGenerationRef.current === generation
            && activeWorkspaceIdRef.current === workspaceId
            && activeBookIdRef.current === bookId
          ) setPending({ sources, workspaceId, bookId, fileName, suggestion });
        })
        .catch(() => {
          if (
            suggestionGenerationRef.current === generation
            && activeWorkspaceIdRef.current === workspaceId
            && activeBookIdRef.current === bookId
          ) setPending({ sources, workspaceId, bookId, fileName, suggestion: null });
        });
      return true;
    },
    [workspace, activeNotebook, activeWorkspace, dropFiles],
  );

  const confirm = useCallback(
    (notebookId: string | null) => {
      const drop = pending;
      setPending(null);
      suggestionGenerationRef.current += 1;
      if (
        !drop
        || drop.workspaceId !== activeWorkspaceIdRef.current
        || drop.bookId !== activeBookIdRef.current
      ) return;
      void dropFiles(drop.sources, notebookId, drop.workspaceId).catch(() => {});
    },
    [pending, dropFiles],
  );

  // "不用了" drops nothing: the user's files are untouched (we copy, never move,
  // and we have not copied yet).
  const cancel = useCallback(() => {
    suggestionGenerationRef.current += 1;
    setPending(null);
  }, []);

  const visiblePending = pending?.workspaceId === activeWorkspaceId
    && pending.bookId === activeBookId ? pending : null;
  return { pending: visiblePending, handleDrop, confirm, cancel, enabled: Boolean(workspace) };
}
