import { useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  CalendarClock,
  ChevronDown,
  Folder,
  FolderOpen,
  Languages,
  LayoutGrid,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Unlink,
  Wrench,
  X,
} from "lucide-react";
import {
  useApprovals,
  useConversations,
  useFileTree,
  useNotebooks,
  usePreviewContent,
  useSettings,
  useUi,
  useWorkspace,
  useWorkspaces,
} from "../bridge/context";
import { deriveConversationStatus } from "../stores/conversation-status";
import { scopeKeyForSelection } from "../stores/workbench-scope";
import { WORKBENCH_SIDEBAR_WIDTH } from "../stores/ui";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import { startStore } from "../stores/start";
import {
  WORKBENCH_COMPACT_SIDEBAR_WIDTH,
  resolveWorkbenchSidebarMode,
} from "../workbench-spatial";
import ConversationListItem, { type ConversationMoveTarget } from "./ConversationListItem";
import AnchoredLayer from "./AnchoredLayer";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { deriveWorkbenchSidebarModel } from "./workbench-sidebar-model";

interface ScopeTarget {
  kind: "managed" | "external";
  workspaceId: string;
  bookId: string | null;
  label: string;
  available: boolean;
  archived: boolean;
}

interface PendingScopeChange {
  target: ScopeTarget;
  sourceWorkspaceId: string;
  dirtyCount: number;
  afterChange?: () => void | Promise<void>;
}

export interface WorkbenchConversationScope {
  workspaceId: string;
  bookId: string | null;
}

export interface WorkbenchSidebarProps {
  onNewConversation: (scope?: WorkbenchConversationScope) => void | Promise<void>;
  shellWidth?: number;
}

const isSameScope = (left: ScopeTarget, right: ScopeTarget): boolean =>
  left.workspaceId === right.workspaceId && left.bookId === right.bookId;

const scopeMenuItemClass = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)] disabled:opacity-45";

export default function WorkbenchSidebar({ onNewConversation, shellWidth }: WorkbenchSidebarProps): React.JSX.Element {
  const sidebarPreference = useUi((state) => state.workbenchSidebarPreference);
  const sidebarWidth = useUi((state) => state.workbenchSidebarWidth);
  const setSidebarWidth = useUi((state) => state.setWorkbenchSidebarWidth);
  const activateWorkbenchScope = useUi((state) => state.activateWorkbenchScope);
  const view = useUi((state) => state.view);
  const setView = useUi((state) => state.setView);
  const openSettings = useUi((state) => state.openSettings);
  const transitioning = useUi((state) => state.workspaceTransitioning);
  const setTransitioning = useUi((state) => state.setWorkspaceTransitioning);
  const setSurface = useSettings((state) => state.setSurface);

  const conversations = useConversations((state) => state.byId);
  const order = useConversations((state) => state.order);
  const activeConversationId = useConversations((state) => state.activeId);
  const timelines = useConversations((state) => state.timelines);
  const runIds = useConversations((state) => state.runIds);
  const pendingByConversation = useApprovals((state) => state.pendingByConversation);
  const switchActive = useConversations((state) => state.switchActive);
  const renameTitle = useConversations((state) => state.renameTitle);
  const setConversationUnread = useConversations((state) => state.setConversationUnread);
  const pinConversation = useConversations((state) => state.pinConversation);
  const archiveConversation = useConversations((state) => state.archiveConversation);
  const moveConversation = useConversations((state) => state.moveConversation);
  const deleteConversation = useConversations((state) => state.deleteConversation);

  const workspaceList = useWorkspaces((state) => state.list);
  const activeWorkspaceId = useWorkspaces((state) => state.activeId);
  const selectWorkspace = useWorkspaces((state) => state.select);
  const renameWorkspace = useWorkspaces((state) => state.rename);
  const setWorkspaceArchived = useWorkspaces((state) => state.setArchived);
  const forgetWorkspace = useWorkspaces((state) => state.forget);
  const openWorkspaceFolder = useWorkspaces((state) => state.openFolder);
  const notebookList = useNotebooks((state) => state.list);
  const activeNotebookId = useNotebooks((state) => state.activeId);
  const setNotebook = useNotebooks((state) => state.setActive);
  const renameNotebook = useNotebooks((state) => state.renameNotebook);
  const setNotebookArchived = useNotebooks((state) => state.setNotebookArchived);
  const workspaceClient = useWorkspace();
  const activateScope = useConversations((state) => state.activateScope);
  const clearPreviewContent = usePreviewContent((state) => state.clear);
  const drafts = usePreviewContent((state) => state.drafts);
  const saveDraft = usePreviewContent((state) => state.saveDraft);
  const discardWorkspaceDrafts = usePreviewContent((state) => state.discardWorkspaceDrafts);
  const refreshTree = useFileTree((state) => state.refresh);
  const workspaceError = useWorkspaces((state) => state.error);
  const notebookError = useNotebooks((state) => state.error);

  const [scopeMenu, setScopeMenu] = useState<{ target: ScopeTarget; anchor: HTMLElement } | null>(null);
  const [renamingScope, setRenamingScope] = useState(false);
  const [scopeName, setScopeName] = useState("");
  const [scopeActionBusy, setScopeActionBusy] = useState(false);
  const [scopeActionError, setScopeActionError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<PendingScopeChange | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const currentShellWidth = shellWidth ?? (typeof window === "undefined" ? 1280 : window.innerWidth);
  const sidebarCollapsed = resolveWorkbenchSidebarMode(sidebarPreference, currentShellWidth) === "compact";
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const currentTarget: ScopeTarget = {
    kind: activeWorkspaceId === HOME_WORKSPACE_ID ? "managed" : "external",
    workspaceId: activeWorkspaceId,
    bookId: activeWorkspaceId === HOME_WORKSPACE_ID ? activeNotebookId : null,
    label: activeWorkspaceId === HOME_WORKSPACE_ID
      ? notebookList.find((book) => book.id === activeNotebookId)?.title ?? "Leemo 工作台"
      : workspaceList.find((entry) => entry.id === activeWorkspaceId)?.name ?? "本子",
    available: true,
    archived: false,
  };

  const targets = useMemo<ScopeTarget[]>(() => [
    ...notebookList.map((book) => ({
      kind: "managed" as const,
      workspaceId: HOME_WORKSPACE_ID,
      bookId: book.id,
      label: book.title,
      available: true,
      archived: book.archived ?? false,
    })),
    ...workspaceList
      .filter((entry) => entry.kind === "external")
      .map((entry) => ({
        kind: "external" as const,
        workspaceId: entry.id,
        bookId: null,
        label: entry.name,
        available: entry.available,
        archived: entry.archived ?? false,
      })),
  ], [notebookList, workspaceList]);
  const visibleTargets = targets.filter((target) => !target.archived);

  const globalTarget: ScopeTarget = {
    kind: "managed",
    workspaceId: HOME_WORKSPACE_ID,
    bookId: null,
    label: "与 momo 的对话",
    available: true,
    archived: false,
  };

  const targetByScope = useMemo(() => new Map([
    [scopeKeyForSelection({ workspaceId: globalTarget.workspaceId, notebookId: globalTarget.bookId }), globalTarget],
    ...visibleTargets.map((target) => [
      scopeKeyForSelection({ workspaceId: target.workspaceId, notebookId: target.bookId }),
      target,
    ] as const),
  ]), [visibleTargets]);
  const sidebarModel = useMemo(() => deriveWorkbenchSidebarModel({
    conversations,
    order,
    visibleScopeKeys: new Set(targetByScope.keys()),
  }), [conversations, order, targetByScope]);
  const conversationsFor = (target: ScopeTarget): string[] => sidebarModel.byScope[
    scopeKeyForSelection({ workspaceId: target.workspaceId, notebookId: target.bookId })
  ] ?? [];

  const moveTargets = useMemo<ConversationMoveTarget[]>(() => [
    ...notebookList.filter((book) => !book.archived).map((book) => ({ workspaceId: HOME_WORKSPACE_ID, bookId: book.id, label: book.title })),
    ...workspaceList
      .filter((entry) => entry.kind === "external" && entry.available && !entry.archived)
      .map((entry) => ({ workspaceId: entry.id, bookId: null, label: entry.name })),
  ], [notebookList, workspaceList]);

  const currentDraftEntries = Object.entries(drafts)
    .filter(([key]) => key.startsWith(`${activeWorkspaceId}\u0000`));
  const dirtyDraftPaths = currentDraftEntries
    .filter(([, draft]) => draft.status !== "clean")
    .map(([key]) => key.slice(`${activeWorkspaceId}\u0000`.length));
  const draftDecisionBusy = transitioning || currentDraftEntries.some(([, draft]) => draft.status === "saving");

  const refreshScopeFiles = async (): Promise<void> => {
    clearPreviewContent();
    await refreshTree();
  };

  const executeScopeChange = async (
    target: ScopeTarget,
    sourceWorkspaceId: string,
    afterChange?: () => void | Promise<void>,
  ): Promise<void> => {
    if (!target.available || transitioning) return;
    setTransitioning(true);
    try {
      let succeeded = true;
      if (target.workspaceId !== HOME_WORKSPACE_ID) {
        succeeded = await selectWorkspace(target.workspaceId);
        if (succeeded) setNotebook(null);
      } else {
        if (activeWorkspaceId !== HOME_WORKSPACE_ID) succeeded = await selectWorkspace(HOME_WORKSPACE_ID);
        if (succeeded) setNotebook(target.bookId);
      }
      if (!succeeded) return;
      activateScope(target.workspaceId, target.bookId);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: target.workspaceId, notebookId: target.bookId }));
      await refreshScopeFiles();
      discardWorkspaceDrafts(sourceWorkspaceId);
      await afterChange?.();
    } finally {
      setTransitioning(false);
    }
  };

  const requestScopeChange = (
    target: ScopeTarget,
    afterChange?: () => void | Promise<void>,
  ): void => {
    if (!target.available || transitioning) return;
    if (isSameScope(target, currentTarget)) {
      void afterChange?.();
      return;
    }
    if (dirtyDraftPaths.length > 0) {
      setDecisionError(null);
      setPendingDecision({
        target,
        sourceWorkspaceId: activeWorkspaceId,
        dirtyCount: dirtyDraftPaths.length,
        ...(afterChange ? { afterChange } : {}),
      });
      return;
    }
    void executeScopeChange(target, activeWorkspaceId, afterChange);
  };

  const resolveDirtyScopeChange = async (resolution: "save" | "discard"): Promise<void> => {
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
      setPendingDecision(null);
      await executeScopeChange(decision.target, decision.sourceWorkspaceId, decision.afterChange);
    } finally {
      setTransitioning(false);
    }
  };

  const pickConversation = (id: string, target: ScopeTarget): void => {
    requestScopeChange(target, () => {
      switchActive(id);
      setView("chat");
    });
  };

  const closeScopeMenu = (): void => {
    setScopeMenu(null);
    setRenamingScope(false);
    setScopeName("");
    setScopeActionError(null);
  };

  const leaveCurrentScope = async (target: ScopeTarget): Promise<void> => {
    if (!isSameScope(target, currentTarget)) return;
    await executeScopeChange(globalTarget, activeWorkspaceId);
  };

  const saveScopeName = async (): Promise<void> => {
    if (!scopeMenu || scopeActionBusy) return;
    const name = scopeName.trim();
    if (!name) {
      setScopeActionError("显示名称不能为空。");
      return;
    }
    setScopeActionBusy(true);
    const succeeded = scopeMenu.target.kind === "managed"
      ? await renameNotebook(scopeMenu.target.bookId!, name)
      : await renameWorkspace(scopeMenu.target.workspaceId, name);
    setScopeActionBusy(false);
    if (succeeded) closeScopeMenu();
    else setScopeActionError(scopeMenu.target.kind === "managed" ? notebookError : workspaceError);
  };

  const setScopeArchived = async (target: ScopeTarget, archived: boolean): Promise<void> => {
    if (scopeActionBusy) return;
    if (archived && isSameScope(target, currentTarget) && dirtyDraftPaths.length > 0) {
      setScopeActionError("先保存当前文件，再归档这个本子。");
      return;
    }
    setScopeActionBusy(true);
    const succeeded = target.kind === "managed"
      ? await setNotebookArchived(target.bookId!, archived)
      : await setWorkspaceArchived(target.workspaceId, archived);
    if (succeeded && archived) await leaveCurrentScope(target);
    setScopeActionBusy(false);
    if (succeeded) closeScopeMenu();
    else setScopeActionError(target.kind === "managed" ? notebookError : workspaceError);
  };

  const revealScope = async (target: ScopeTarget): Promise<void> => {
    if (!workspaceClient) {
      setScopeActionError("当前环境不能打开资源管理器。");
      return;
    }
    setScopeActionBusy(true);
    try {
      await workspaceClient.reveal(
        target.kind === "managed" ? target.bookId ?? undefined : undefined,
        target.workspaceId,
      );
      closeScopeMenu();
    } catch (error: unknown) {
      setScopeActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setScopeActionBusy(false);
    }
  };

  const removeExternalScope = async (target: ScopeTarget): Promise<void> => {
    if (scopeActionBusy || target.kind !== "external") return;
    if (isSameScope(target, currentTarget) && dirtyDraftPaths.length > 0) {
      setScopeActionError("先保存当前文件，再从 Leemo 移除这个本子。");
      return;
    }
    setScopeActionBusy(true);
    const removed = await forgetWorkspace(target.workspaceId);
    if (removed) await leaveCurrentScope(target);
    setScopeActionBusy(false);
    if (removed) closeScopeMenu();
    else setScopeActionError(workspaceError);
  };

  const relocateExternalScope = async (target: ScopeTarget): Promise<void> => {
    if (scopeActionBusy || target.kind !== "external") return;
    setScopeActionBusy(true);
    const replacementId = await openWorkspaceFolder();
    if (replacementId) {
      await forgetWorkspace(target.workspaceId);
      setNotebook(null);
      activateScope(replacementId, null);
      activateWorkbenchScope(scopeKeyForSelection({ workspaceId: replacementId, notebookId: null }));
      await refreshScopeFiles();
      closeScopeMenu();
    }
    setScopeActionBusy(false);
  };

  const renderConversation = (id: string, target: ScopeTarget, showContext = false) => {
    const conversation = conversations[id];
    if (!conversation) return null;
    return (
      <ConversationListItem
        key={id}
        conversation={conversation}
        active={id === activeConversationId}
        variant="workbench"
        onPick={() => pickConversation(id, target)}
        onRename={(title) => renameTitle(id, title)}
        onUnread={(unread) => setConversationUnread(id, unread)}
        onPin={(pinned) => pinConversation(id, pinned)}
        onArchive={(archived) => archiveConversation(id, archived)}
        onDelete={() => deleteConversation(id)}
        moveTargets={moveTargets.filter((target) => target.workspaceId !== (conversation.workspaceId ?? HOME_WORKSPACE_ID) || target.bookId !== conversation.bookId)}
        onMove={(target) => moveConversation(id, target)}
        status={deriveConversationStatus({
          timeline: timelines[id] ?? [],
          activeRunId: runIds[id] ?? null,
          pending: pendingByConversation[id] ?? null,
        })}
        contextLabel={showContext ? target.label : undefined}
      />
    );
  };

  const renderScopeSection = (target: ScopeTarget, includeChildren: boolean) => {
    const key = `${target.workspaceId}\u0000${target.bookId ?? ""}`;
    const current = isSameScope(target, currentTarget);
    const menuOpen = scopeMenu !== null && isSameScope(scopeMenu.target, target);
    const ids = conversationsFor(target);
    return (
      <div key={key} className="min-w-0">
        <div
          className={`leemo-workbench-scope-row group flex min-w-0 items-center transition-colors ${current ? "" : "hover:bg-[var(--leemo-side-hover)]"}`}
          data-active={current ? "true" : "false"}
        >
          <button
            type="button"
            aria-label={`打开本子 ${target.label}`}
            aria-current={current ? "page" : undefined}
            disabled={!target.available || transitioning}
            onClick={() => requestScopeChange(target)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
            title={target.available ? target.label : "找不到文件夹"}
          >
            <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center ${current ? "text-[var(--leemo-amber)]" : "text-[var(--leemo-ink-2)]"}`}>
              {current ? <FolderOpen className="h-4 w-4" aria-hidden /> : <Folder className="h-4 w-4" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--leemo-ink)]">{target.label}</span>
            {!target.available && <span className="shrink-0 text-[10px] text-[var(--leemo-ink-3)]">不可用</span>}
            {current && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />}
          </button>
          <button
            type="button"
            aria-label={`${target.label}本子菜单`}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setScopeMenu(menuOpen ? null : { target, anchor: event.currentTarget });
              setRenamingScope(false);
              setScopeName(target.label);
              setScopeActionError(null);
            }}
            className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--leemo-ink-3)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--leemo-card)] hover:text-[var(--leemo-ink)] focus-visible:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <AnchoredLayer
          open={menuOpen}
          anchor={scopeMenu?.anchor ?? null}
          preferred="bottom-end"
          onDismiss={closeScopeMenu}
          role="menu"
          ariaLabel={`${target.label}本子操作`}
          className="w-[224px] rounded-[10px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] p-1.5 shadow-[0_16px_38px_rgba(24,35,48,0.16)]"
        >
          {renamingScope ? (
            <form
              onSubmit={(event) => { event.preventDefault(); void saveScopeName(); }}
              className="p-1"
            >
              <label className="mb-1.5 block text-[11px] font-medium text-[var(--leemo-ink-2)]">显示名称</label>
              <input
                aria-label="显示名称"
                autoFocus
                value={scopeName}
                onChange={(event) => setScopeName(event.target.value)}
                className="h-8 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-2 text-xs text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber-line)] focus:ring-2 focus:ring-[var(--leemo-focus-ring)]"
              />
              <div className="mt-2 flex justify-end gap-1.5">
                <button type="button" className="h-7 rounded-md px-2 text-[11px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]" onClick={() => setRenamingScope(false)}>取消</button>
                <button type="submit" disabled={scopeActionBusy || !scopeName.trim()} className="h-7 rounded-md bg-[var(--leemo-ink)] px-2.5 text-[11px] font-medium text-white disabled:opacity-45">保存</button>
              </div>
            </form>
          ) : (
            <>
              <button type="button" role="menuitem" className={scopeMenuItemClass} onClick={() => setRenamingScope(true)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                重命名显示名称
              </button>
              {target.available && (
                <button type="button" role="menuitem" className={scopeMenuItemClass} onClick={() => void revealScope(target)}>
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                  在资源管理器中显示
                </button>
              )}
              {!target.available && target.kind === "external" && (
                <button type="button" role="menuitem" className={scopeMenuItemClass} onClick={() => void relocateExternalScope(target)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  重新定位文件夹
                </button>
              )}
              <button type="button" role="menuitem" className={scopeMenuItemClass} onClick={() => void setScopeArchived(target, true)}>
                <Archive className="h-3.5 w-3.5" aria-hidden />
                归档本子
              </button>
              {target.kind === "external" && (
                <button type="button" role="menuitem" className={`${scopeMenuItemClass} text-[var(--leemo-danger,#b42318)]`} onClick={() => void removeExternalScope(target)}>
                  <Unlink className="h-3.5 w-3.5" aria-hidden />
                  从 Leemo 移除
                </button>
              )}
            </>
          )}
          {scopeActionError && <p role="alert" className="px-2 pb-1 pt-1.5 text-[10px] leading-4 text-[var(--leemo-danger,#b42318)]">{scopeActionError}</p>}
        </AnchoredLayer>
        {includeChildren && current && (
          <div className="ml-3 border-l border-[var(--leemo-line)] pl-2" role="group" aria-label={`${target.label}的对话`}>
            {ids.length === 0 ? (
              <p className="px-2.5 py-2 text-[11px] text-[var(--leemo-ink-3)]">还没有对话</p>
            ) : (
              <div className="space-y-0.5">{ids.map((id) => renderConversation(id, target))}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const toolButtons = [
    // Keep unfinished scenario surfaces registered here, but out of the dock
    // until their user journey is ready for everyday use.
    { id: "learning" as const, label: "英语学习", shortLabel: "英语", visible: false, Icon: Languages },
    { id: "start" as const, label: "开始", shortLabel: "开始", visible: true, Icon: LayoutGrid },
    { id: "skills" as const, label: "技能", shortLabel: "技能", visible: true, Icon: Wrench },
    { id: "scheduled" as const, label: "定时任务", shortLabel: "定时", visible: true, Icon: CalendarClock },
  ];
  const shortcutButtons = toolButtons.filter((button) => button.visible);
  const openShortcut = (id: (typeof shortcutButtons)[number]["id"]) => {
    if (id === "start") {
      startStore.getState().open("home");
      setSurface("start");
      return;
    }
    setView(id);
  };

  return (
    <aside
      className={`leemo-workbench-sidebar relative flex shrink-0 flex-col border-r border-[var(--leemo-line)] ${sidebarCollapsed ? "w-[52px]" : ""}`}
      style={{ width: sidebarCollapsed ? WORKBENCH_COMPACT_SIDEBAR_WIDTH : dragWidth ?? sidebarWidth }}
      aria-label="工作台侧栏"
      data-testid="workbench-sidebar"
    >
      {sidebarCollapsed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center">
          <div className="flex w-full shrink-0 flex-col items-center border-b border-[var(--leemo-line)] py-2">
            <button type="button" onClick={() => void onNewConversation()} className="leemo-icon-btn" aria-label="新建对话" title="新对话">
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-auto flex w-full shrink-0 flex-col items-center gap-1 border-t border-[var(--leemo-line)] py-2">
            {shortcutButtons.map(({ id, label, Icon }) => (
              <button key={id} type="button" onClick={() => openShortcut(id)} className={`leemo-icon-btn ${id !== "start" && view === id ? "bg-[var(--leemo-card)] text-[var(--leemo-ink)] shadow-sm" : ""}`} aria-label={label} aria-current={id !== "start" && view === id ? "page" : undefined} title={label}>
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
            <button type="button" onClick={() => openSettings()} className="leemo-icon-btn" aria-label="设置" title="设置">
              <Settings className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="leemo-workbench-sidebar__header shrink-0 border-b border-[var(--leemo-line)] p-3">
            <button
              type="button"
              onClick={() => void onNewConversation()}
              className="leemo-workbench-new-chat flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[9px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 text-left text-[13px] font-medium text-[var(--leemo-ink)] transition hover:border-[var(--leemo-amber-line)] hover:bg-[var(--leemo-amber-bg)]"
              title="新对话"
              aria-label="新建对话"
            >
              <Plus className="h-4 w-4 shrink-0 text-[var(--leemo-ink-2)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate">新对话</span>
              <kbd className="hidden rounded border border-[var(--leemo-line-soft)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--leemo-ink-3)] min-[300px]:inline">Ctrl N</kbd>
            </button>
          </div>

          {sidebarModel.pinned.length > 0 && (
            <section
              className="leemo-workbench-sidebar__pinned flex max-h-[180px] shrink-0 flex-col border-b border-[var(--leemo-line)] px-2 py-2"
              aria-label="置顶对话"
            >
              <div className="flex shrink-0 items-center justify-between px-2 pb-1 text-[12px] font-medium text-[var(--leemo-ink-2)]">
                <span>置顶</span>
                <span className="text-[10px] font-normal text-[var(--leemo-ink-3)]">{sidebarModel.pinned.length}</span>
              </div>
              <div className="min-h-0 overflow-y-auto pr-0.5">
                <div className="space-y-0.5">
                  {sidebarModel.pinned.map(({ id, scopeKey }) => {
                    const target = targetByScope.get(scopeKey);
                    return target ? renderConversation(id, target, true) : null;
                  })}
                </div>
              </div>
            </section>
          )}

          <section className="leemo-workbench-sidebar__notebooks flex min-h-[120px] max-h-[55%] shrink-0 flex-col overflow-visible px-2 py-2" data-testid="workbench-notebook-map" aria-label="本子">
            <div className="relative z-50 flex shrink-0 items-center justify-between px-2 pb-1 text-[12px] font-medium text-[var(--leemo-ink-2)]">
              <span>本子</span>
              <span className="flex items-center gap-1.5">
                <span>{visibleTargets.length}</span>
                <WorkspaceSwitcher compact />
              </span>
            </div>
            <div data-testid="workbench-notebook-list" className="min-h-0 overflow-y-auto pr-0.5">
              {visibleTargets.length === 0 ? (
                <div className="leemo-sidebar-empty" data-testid="workbench-notebook-empty">
                  <span className="leemo-sidebar-empty__icon" aria-hidden>
                    <BookOpen />
                  </span>
                  <span className="min-w-0">
                    <span className="leemo-sidebar-empty__title">还没有本子</span>
                    <span className="leemo-sidebar-empty__hint">用右上角 + 创建或连接</span>
                  </span>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {visibleTargets.map((target) => renderScopeSection(target, true))}
                </div>
              )}
            </div>
          </section>

          <section className="leemo-workbench-sidebar__global flex min-h-[164px] flex-1 flex-col overflow-visible border-t border-[var(--leemo-line)] px-2 py-2" data-testid="workbench-global-map" aria-label="与 momo 的对话">
            <div className="flex shrink-0 items-center justify-between px-2 pb-1 text-[12px] font-medium text-[var(--leemo-ink-2)]">
              <span>与 momo 的对话</span>
              <button
                type="button"
                onClick={() => requestScopeChange(globalTarget, () => onNewConversation({
                  workspaceId: globalTarget.workspaceId,
                  bookId: globalTarget.bookId,
                }))}
                className="grid h-5 w-5 place-items-center rounded text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
                aria-label="新建全局对话"
                title="新建对话"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div data-testid="workbench-global-list" className="min-h-0 flex-1 overflow-y-auto pr-0.5">
              {conversationsFor(globalTarget).length === 0 ? (
                <div className="leemo-sidebar-empty" data-testid="workbench-global-empty">
                  <span className="leemo-sidebar-empty__icon" aria-hidden>
                    <MessageCircle />
                  </span>
                  <span className="min-w-0">
                    <span className="leemo-sidebar-empty__title">还没有对话</span>
                    <span className="leemo-sidebar-empty__hint">点 + 开始一段全局对话</span>
                  </span>
                </div>
              ) : (
                <div className="space-y-0.5">{conversationsFor(globalTarget).map((id) => renderConversation(id, globalTarget))}</div>
              )}
            </div>
          </section>

          <nav className="leemo-workbench-sidebar__dock grid min-h-14 shrink-0 grid-cols-4 gap-1 border-t border-[var(--leemo-line)] p-1.5" aria-label="工作台快捷入口">
            {shortcutButtons.map(({ id, label, shortLabel, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => openShortcut(id)}
                className={`flex h-[42px] min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 transition-colors ${id !== "start" && view === id ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] ring-1 ring-inset ring-[var(--leemo-line-soft)]" : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"}`}
                title={label}
                aria-label={label}
                aria-current={id !== "start" && view === id ? "page" : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="max-w-full truncate text-[11px] leading-none">{shortLabel}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => openSettings()}
              className="flex h-[42px] min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)]"
              title="设置"
              aria-label="设置"
            >
              <Settings className="h-4 w-4 shrink-0" aria-hidden />
              <span className="max-w-full truncate text-[11px] leading-none">设置</span>
            </button>
          </nav>
        </div>
      )}

      {pendingDecision && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/25 px-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="sidebar-draft-dialog-title" className="w-full max-w-[400px] rounded-lg border border-[var(--leemo-line)] bg-white p-5 shadow-2xl">
            <h2 id="sidebar-draft-dialog-title" className="text-base font-semibold text-[var(--leemo-ink)]">有未保存的修改</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--leemo-ink-2)]">还有 {pendingDecision.dirtyCount} 份 Markdown 修改没有保存。切换本子前先处理，避免草稿丢失。</p>
            {decisionError && <p role="alert" className="mt-2 text-xs leading-5 text-[var(--leemo-danger,#B42318)]">{decisionError}</p>}
            <div className="mt-5 flex flex-col justify-end gap-2 min-[440px]:flex-row">
              <button type="button" autoFocus disabled={transitioning} onClick={() => { setPendingDecision(null); setDecisionError(null); }} className="h-9 rounded-md border border-[var(--leemo-line)] px-3 text-sm text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-50">继续编辑</button>
              <button type="button" disabled={draftDecisionBusy} onClick={() => void resolveDirtyScopeChange("discard")} className="h-9 rounded-md border border-[var(--leemo-line)] px-3 text-sm text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-50">不保存并继续</button>
              <button type="button" disabled={draftDecisionBusy} onClick={() => void resolveDirtyScopeChange("save")} className="h-9 rounded-md bg-[var(--leemo-ink)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{transitioning ? "正在保存…" : "保存并继续"}</button>
            </div>
          </div>
        </div>
      )}
      {transitioning && !pendingDecision && <div role="status" aria-label="正在切换本子" className="fixed inset-0 z-[89] cursor-wait" />}
      {(workspaceError || notebookError) && <div className="sr-only" role="alert">{notebookError ?? workspaceError}</div>}
      {!sidebarCollapsed && (
        <div
          role="separator"
          aria-label="调整侧栏宽度"
          aria-orientation="vertical"
          aria-valuemin={WORKBENCH_SIDEBAR_WIDTH.min}
          aria-valuemax={WORKBENCH_SIDEBAR_WIDTH.max}
          aria-valuenow={Math.round(dragWidth ?? sidebarWidth)}
          tabIndex={0}
          className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent hover:after:bg-[var(--leemo-amber-line)] focus-visible:after:bg-[var(--leemo-amber-line)]"
          onDoubleClick={() => setSidebarWidth(WORKBENCH_SIDEBAR_WIDTH.default)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setSidebarWidth(sidebarWidth - 8);
            if (event.key === "ArrowRight") setSidebarWidth(sidebarWidth + 8);
            if (event.key === "Home") setSidebarWidth(WORKBENCH_SIDEBAR_WIDTH.default);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { startX: event.clientX, startWidth: sidebarWidth, width: sidebarWidth };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            const width = Math.min(
              WORKBENCH_SIDEBAR_WIDTH.max,
              Math.max(WORKBENCH_SIDEBAR_WIDTH.min, drag.startWidth + event.clientX - drag.startX),
            );
            drag.width = width;
            setDragWidth(width);
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            dragRef.current = null;
            setDragWidth(null);
            setSidebarWidth(drag.width);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragWidth(null);
          }}
        />
      )}
    </aside>
  );
}
