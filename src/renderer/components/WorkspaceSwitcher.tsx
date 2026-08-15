import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, Check, ChevronDown, Folder, FolderOpen, House, Plus, X } from "lucide-react";
import {
  useConversations,
  useFileTree,
  useNotebooks,
  usePreviewContent,
  useUi,
  useWorkspaces,
} from "../bridge/context";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import { scopeKeyForSelection } from "../stores/workbench-scope";
import AnchoredLayer from "./AnchoredLayer";

type BookAction =
  | { kind: "select-global" }
  | { kind: "select-managed"; id: string }
  | { kind: "select-external"; id: string }
  | { kind: "create"; title: string }
  | { kind: "open" }
  | { kind: "remove"; id: string };

interface PendingBookDecision {
  action: BookAction;
  sourceWorkspaceId: string;
  dirtyCount: number;
}

export default function WorkspaceSwitcher({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const workspaces = useWorkspaces((state) => state.list);
  const activeWorkspaceId = useWorkspaces((state) => state.activeId);
  const workspaceStatus = useWorkspaces((state) => state.status);
  const workspaceError = useWorkspaces((state) => state.error);
  const justOpenedId = useWorkspaces((state) => state.justOpenedId);
  const openFolder = useWorkspaces((state) => state.openFolder);
  const selectWorkspace = useWorkspaces((state) => state.select);
  const forgetWorkspace = useWorkspaces((state) => state.forget);
  const setWorkspaceArchived = useWorkspaces((state) => state.setArchived);
  const notebooks = useNotebooks((state) => state.list);
  const activeNotebookId = useNotebooks((state) => state.activeId);
  const notebookError = useNotebooks((state) => state.error);
  const setNotebook = useNotebooks((state) => state.setActive);
  const createNotebook = useNotebooks((state) => state.createNotebook);
  const setNotebookArchived = useNotebooks((state) => state.setNotebookArchived);
  const activateScope = useConversations((state) => state.activateScope);
  const refreshTree = useFileTree((state) => state.refresh);
  const activateWorkbenchScope = useUi((state) => state.activateWorkbenchScope);
  const transitioning = useUi((state) => state.workspaceTransitioning);
  const setTransitioning = useUi((state) => state.setWorkspaceTransitioning);
  const drafts = usePreviewContent((state) => state.drafts);
  const saveDraft = usePreviewContent((state) => state.saveDraft);
  const discardWorkspaceDrafts = usePreviewContent((state) => state.discardWorkspaceDrafts);
  const clearPreviewContent = usePreviewContent((state) => state.clear);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBookName, setNewBookName] = useState("");
  const [pendingDecision, setPendingDecision] = useState<PendingBookDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeWorkspace = workspaces.find((entry) => entry.id === activeWorkspaceId)
    ?? workspaces[0];
  const activeManagedBook = activeWorkspaceId === HOME_WORKSPACE_ID
    ? notebooks.find((entry) => entry.id === activeNotebookId)
    : undefined;
  const managedBooks = notebooks.filter((entry) => !entry.archived);
  const externalBooks = workspaces.filter((entry) => entry.kind === "external" && !entry.archived);
  const archivedManagedBooks = notebooks.filter((entry) => entry.archived);
  const archivedExternalBooks = workspaces.filter((entry) => entry.kind === "external" && entry.archived);
  const currentLabel = activeWorkspace?.kind === "external"
    ? activeWorkspace.name
    : activeManagedBook?.title ?? "Leemo 工作台";
  const currentPath = activeWorkspace?.kind === "external"
    ? activeWorkspace.displayPath
    : activeManagedBook?.dir ?? "不进入具体本子";

  const draftPrefix = `${activeWorkspaceId}\u0000`;
  const currentDraftEntries = Object.entries(drafts)
    .filter(([key]) => key.startsWith(draftPrefix))
    .map(([key, draft]) => ({ path: key.slice(draftPrefix.length), draft }));
  const dirtyDraftPaths = currentDraftEntries
    .filter(({ draft }) => draft.status !== "clean")
    .map(({ path }) => path);
  const draftDecisionBusy = transitioning
    || currentDraftEntries.some(({ draft }) => draft.status === "saving");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (creating) {
        setCreating(false);
        setNewBookName("");
      } else {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [creating, open]);

  useEffect(() => {
    if ((transitioning || pendingDecision) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [pendingDecision, transitioning]);

  const refreshBookFiles = async (): Promise<void> => {
    clearPreviewContent();
    await refreshTree();
  };

  const ensureHomeWorkspace = async (): Promise<boolean> => (
    activeWorkspaceId === HOME_WORKSPACE_ID || await selectWorkspace(HOME_WORKSPACE_ID)
  );

  const applyAction = async (action: BookAction, sourceWorkspaceId: string): Promise<boolean> => {
    if (action.kind === "select-global") {
      if (!await ensureHomeWorkspace()) return false;
      setNotebook(null);
      activateScope(HOME_WORKSPACE_ID, null);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: HOME_WORKSPACE_ID, notebookId: null }));
      await refreshBookFiles();
      setOpen(false);
      return true;
    }

    if (action.kind === "select-managed") {
      if (!await ensureHomeWorkspace()) return false;
      setNotebook(action.id);
      activateScope(HOME_WORKSPACE_ID, action.id);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: HOME_WORKSPACE_ID, notebookId: action.id }));
      await refreshBookFiles();
      setOpen(false);
      return true;
    }

    if (action.kind === "select-external") {
      if (!await selectWorkspace(action.id)) return false;
      setNotebook(null);
      activateScope(action.id, null);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: action.id, notebookId: null }));
      await refreshBookFiles();
      setOpen(false);
      return true;
    }

    if (action.kind === "create") {
      try {
        const id = await createNotebook(action.title);
        if (!await ensureHomeWorkspace()) return false;
        setNotebook(id);
        activateScope(HOME_WORKSPACE_ID, id);
        activateWorkbenchScope(scopeKeyForSelection({ workspaceId: HOME_WORKSPACE_ID, notebookId: id }));
        await refreshBookFiles();
        setCreating(false);
        setNewBookName("");
        setOpen(false);
        return true;
      } catch {
        return false;
      }
    }

    if (action.kind === "open") {
      const id = await openFolder();
      if (id === null) return false;
      setNotebook(null);
      activateScope(id, null);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: id, notebookId: null }));
      await refreshBookFiles();
      setOpen(true);
      return true;
    }

    const wasActive = action.id === sourceWorkspaceId;
    if (!await forgetWorkspace(action.id)) return false;
    if (wasActive) {
      setNotebook(null);
      activateScope(HOME_WORKSPACE_ID, null);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: HOME_WORKSPACE_ID, notebookId: null }));
      await refreshBookFiles();
    }
    return true;
  };

  const changesBookScope = (action: BookAction, sourceWorkspaceId: string): boolean =>
    action.kind !== "remove" || action.id === sourceWorkspaceId;

  const runDirectAction = async (action: BookAction, sourceWorkspaceId: string): Promise<void> => {
    if (transitioning) return;
    setOpen(false);
    setTransitioning(true);
    try {
      const succeeded = await applyAction(action, sourceWorkspaceId);
      if (succeeded && changesBookScope(action, sourceWorkspaceId)) {
        discardWorkspaceDrafts(sourceWorkspaceId);
      } else if (!succeeded && action.kind !== "open") {
        setOpen(true);
      }
    } finally {
      setTransitioning(false);
    }
  };

  const actionIsCurrent = (action: BookAction): boolean => {
    if (action.kind === "select-global") {
      return activeWorkspaceId === HOME_WORKSPACE_ID && activeNotebookId === null;
    }
    if (action.kind === "select-managed") {
      return activeWorkspaceId === HOME_WORKSPACE_ID && activeNotebookId === action.id;
    }
    return action.kind === "select-external" && activeWorkspaceId === action.id;
  };

  const requestAction = (action: BookAction): void => {
    if (transitioning) return;
    if (actionIsCurrent(action)) {
      setOpen(false);
      return;
    }
    const sourceWorkspaceId = activeWorkspaceId;
    if (dirtyDraftPaths.length > 0) {
      setDecisionError(null);
      setPendingDecision({ action, sourceWorkspaceId, dirtyCount: dirtyDraftPaths.length });
      setOpen(false);
      return;
    }
    void runDirectAction(action, sourceWorkspaceId);
  };

  const resolveAndContinue = async (resolution: "save" | "discard"): Promise<void> => {
    if (!pendingDecision || draftDecisionBusy) return;
    const decision = pendingDecision;
    setTransitioning(true);
    setDecisionError(null);
    try {
      if (resolution === "save") {
        for (const path of dirtyDraftPaths) {
          if (!await saveDraft(path)) {
            setDecisionError("有文件保存失败，草稿仍保留。");
            return;
          }
        }
      }

      const succeeded = await applyAction(decision.action, decision.sourceWorkspaceId);
      if (succeeded && changesBookScope(decision.action, decision.sourceWorkspaceId)) {
        discardWorkspaceDrafts(decision.sourceWorkspaceId);
      } else if (!succeeded && decision.action.kind !== "open") {
        setOpen(true);
      }
      setPendingDecision(null);
    } finally {
      setTransitioning(false);
    }
  };

  const submitCreate = (): void => {
    const title = newBookName.trim();
    if (!title) return;
    requestAction({ kind: "create", title });
  };

  return (
    <div className={`relative ${compact ? "shrink-0" : "min-w-0 flex-1"}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`选择本子，当前 ${currentLabel}`}
        aria-expanded={open}
        disabled={transitioning}
        onClick={() => setOpen((value) => !value)}
        title={currentPath}
        className={compact
          ? "grid h-5 w-5 place-items-center rounded text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
          : "flex h-8 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-sm font-medium text-[var(--leemo-ink)] transition-colors hover:bg-[var(--leemo-side-hover)]"}
      >
        {compact ? (
          <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
        ) : (
          <>
            <Folder aria-hidden="true" size={15} strokeWidth={1.8} className="shrink-0 text-[var(--leemo-ink-2)]" />
            <span className="min-w-0 truncate">{currentLabel}</span>
            <ChevronDown aria-hidden="true" size={13} className="shrink-0 text-[var(--leemo-ink-3)]" />
          </>
        )}
      </button>

      <AnchoredLayer
        open={open}
        anchor={triggerRef}
        preferred="bottom-start"
        gap={6}
        padding={10}
        onDismiss={() => setOpen(false)}
        role="menu"
        ariaLabel="本子"
        className="w-[300px] max-w-[calc(100vw-24px)] rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1.5 shadow-[0_18px_50px_rgba(32,32,31,0.16)]"
      >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <p className="text-[10px] font-medium text-[var(--leemo-ink-3)]">本子</p>
            <span className="text-[10px] text-[var(--leemo-ink-3)]">{managedBooks.length + externalBooks.length} 个</span>
          </div>

          {(activeWorkspaceId !== HOME_WORKSPACE_ID || activeNotebookId !== null) && (
            <button
              type="button"
              role="menuitem"
              aria-label="回到 Leemo 工作台"
              onClick={() => requestAction({ kind: "select-global" })}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-work-hover)]"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--leemo-panel)] text-[var(--leemo-ink-2)]">
                <House aria-hidden="true" size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Leemo 工作台</span>
                <span className="mt-0.5 block text-[10px] text-[var(--leemo-ink-3)]">暂时不进入具体本子</span>
              </span>
            </button>
          )}

          <div className="max-h-64 overflow-y-auto">
            {managedBooks.map((entry) => {
              const active = activeWorkspaceId === HOME_WORKSPACE_ID && entry.id === activeNotebookId;
              return (
                <button
                  key={`managed:${entry.id}`}
                  type="button"
                  role="menuitem"
                  aria-label={`打开本子 ${entry.title}`}
                  onClick={() => requestAction({ kind: "select-managed", id: entry.id })}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-[var(--leemo-work-hover)]"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--leemo-panel)] text-[var(--leemo-amber)]">
                    {active ? <Check aria-hidden="true" size={14} /> : <Folder aria-hidden="true" size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--leemo-ink)]">{entry.title}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--leemo-ink-3)]">
                      {entry.hasMemory ? "momo 已了解这个本子" : "Leemo 管理的文件夹"}
                    </span>
                  </span>
                </button>
              );
            })}

            {externalBooks.map((entry) => {
              const active = entry.id === activeWorkspaceId;
              return (
                <div key={`external:${entry.id}`} className="group flex items-center rounded-md hover:bg-[var(--leemo-work-hover)]">
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`打开本子 ${entry.name}`}
                    disabled={!entry.available || workspaceStatus === "loading" || transitioning}
                    onClick={() => requestAction({ kind: "select-external", id: entry.id })}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--leemo-panel)] text-[var(--leemo-amber)]">
                      {active ? <Check aria-hidden="true" size={14} /> : <Folder aria-hidden="true" size={14} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--leemo-ink)]">{entry.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[var(--leemo-ink-3)]">
                        {entry.available ? entry.displayPath : "找不到文件夹"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`从本子列表移除 ${entry.name}`}
                    title="从本子列表移除"
                    disabled={workspaceStatus === "loading" || transitioning}
                    onClick={() => requestAction({ kind: "remove", id: entry.id })}
                    className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--leemo-ink-3)] opacity-0 transition-opacity hover:bg-white hover:text-[var(--leemo-ink)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                  >
                    <X aria-hidden="true" size={14} />
                  </button>
                </div>
              );
            })}

            {managedBooks.length + externalBooks.length === 0 && (
              <p className="px-2 py-5 text-center text-xs text-[var(--leemo-ink-3)]">还没有本子</p>
            )}
            {archivedManagedBooks.length + archivedExternalBooks.length > 0 && (
              <div className="mt-1 border-t border-[var(--leemo-line-soft)] pt-1">
                <p className="px-2 py-1 text-[10px] font-medium text-[var(--leemo-ink-3)]">已归档</p>
                {archivedManagedBooks.map((entry) => (
                  <button
                    key={`archived-managed:${entry.id}`}
                    type="button"
                    role="menuitem"
                    onClick={() => void setNotebookArchived(entry.id, false)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-work-hover)]"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">恢复 {entry.title}</span>
                  </button>
                ))}
                {archivedExternalBooks.map((entry) => (
                  <button
                    key={`archived-external:${entry.id}`}
                    type="button"
                    role="menuitem"
                    onClick={() => void setWorkspaceArchived(entry.id, false)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-work-hover)]"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">恢复 {entry.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-1 border-t border-[var(--leemo-line-soft)] pt-1">
            {creating ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCreate();
                }}
                className="flex items-center gap-1 p-1"
              >
                <input
                  autoFocus
                  value={newBookName}
                  onChange={(event) => setNewBookName(event.target.value)}
                  placeholder="给本子起个名字"
                  aria-label="新本子名称"
                  className="h-8 min-w-0 flex-1 rounded-md border border-[var(--leemo-line)] px-2 text-xs text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber-line)]"
                />
                <button
                  type="submit"
                  aria-label="创建本子"
                  disabled={!newBookName.trim() || transitioning}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--leemo-ink)] text-white disabled:opacity-40"
                >
                  <Check aria-hidden="true" size={14} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                role="menuitem"
                aria-label="新建本子"
                disabled={workspaceStatus === "loading" || transitioning}
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-[var(--leemo-ink)] hover:bg-[var(--leemo-work-hover)] disabled:opacity-50"
              >
                <Plus aria-hidden="true" size={15} className="text-[var(--leemo-ink-2)]" />
                新建本子
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              aria-label="打开已有文件夹"
              disabled={workspaceStatus === "loading" || transitioning}
              onClick={() => requestAction({ kind: "open" })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-[var(--leemo-ink)] hover:bg-[var(--leemo-work-hover)] disabled:opacity-50"
            >
              <FolderOpen aria-hidden="true" size={15} className="text-[var(--leemo-ink-2)]" />
              {workspaceStatus === "loading" ? "正在打开…" : "打开已有文件夹"}
            </button>
          </div>

          {justOpenedId && (
            <p role="status" className="mx-2 mb-1 mt-1.5 text-[10px] leading-4 text-[var(--leemo-ink-3)]">
              已作为本子打开。对话和本地记忆会跟着这个文件夹。
            </p>
          )}
          {(workspaceError || notebookError) && (
            <p role="alert" className="mx-2 mb-1 mt-1.5 text-[10px] leading-4 text-[var(--leemo-danger,#B42318)]">
              {notebookError ?? workspaceError}
            </p>
          )}
      </AnchoredLayer>

      {transitioning && !pendingDecision && (
        <div role="status" aria-label="正在切换本子" className="fixed inset-0 z-[89] cursor-wait" />
      )}

      {pendingDecision && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/25 px-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="book-draft-dialog-title"
            className="w-full max-w-[400px] rounded-lg border border-[var(--leemo-line)] bg-white p-5 shadow-2xl"
          >
            <h2 id="book-draft-dialog-title" className="text-base font-semibold text-[var(--leemo-ink)]">
              有未保存的修改
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--leemo-ink-2)]">
              还有 {pendingDecision.dirtyCount} 份 Markdown 修改没有保存。切换本子前先处理，避免草稿丢失。
            </p>
            {decisionError && (
              <p role="alert" className="mt-2 text-xs leading-5 text-[var(--leemo-danger,#B42318)]">
                {decisionError}
              </p>
            )}
            <div className="mt-5 flex flex-col justify-end gap-2 min-[440px]:flex-row">
              <button
                type="button"
                autoFocus
                disabled={transitioning}
                onClick={() => {
                  setPendingDecision(null);
                  setDecisionError(null);
                }}
                className="h-9 rounded-md border border-[var(--leemo-line)] px-3 text-sm text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-50"
              >
                继续编辑
              </button>
              <button
                type="button"
                disabled={draftDecisionBusy}
                onClick={() => void resolveAndContinue("discard")}
                className="h-9 rounded-md border border-[var(--leemo-line)] px-3 text-sm text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-50"
              >
                不保存并继续
              </button>
              <button
                type="button"
                disabled={draftDecisionBusy}
                onClick={() => void resolveAndContinue("save")}
                className="h-9 rounded-md bg-[var(--leemo-ink)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {transitioning ? "正在保存…" : "保存并继续"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
