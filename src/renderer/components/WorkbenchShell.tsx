import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Bell,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutGrid,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Wrench,
  X,
} from "lucide-react";
import { useApprovals, useComposerDrafts, useConversations, useSettings, useNotifications, useUi, useSkills, useProviders, useWorkspace, useWorkspaces, useNotebooks, useFileTree } from "../bridge/context";
import { deriveConversationStatus } from "../stores/conversation-status";
import {
  EMPTY_COMPOSER_DRAFT,
  resolveComposerScope,
} from "../stores/composer-drafts";
import type { AttachmentRef, WorkspaceFileRef } from "../../bridge/contract";
import Timeline from "./timeline/Timeline";
import InputArea from "./InputArea";
import MomoAvatar from "./momo/MomoAvatar";
import SkillsPage from "../pages/SkillsPage";
import { ArtifactsPage } from "../pages/ArtifactsPage";
import ScheduledTasksPage from "../pages/ScheduledTasksPage";
import EnglishLearningPage from "../pages/EnglishLearningPage";
import PreviewPane from "./PreviewPane";
import FileTree from "./FileTree";
import DropClassifyBar from "./DropClassifyBar";
import { isFileDataTransfer, useFileDrop } from "./useFileDrop";
import ConversationListItem from "./ConversationListItem";
import { orderConfiguredProviders } from "./model-picker";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import ModeSwitcher from "./ModeSwitcher";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";

const NARROW_PREVIEW_MEDIA = "(max-width: 1023.98px)";

function useNarrowPreviewLayout(): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window.matchMedia === "function") {
      return window.matchMedia(NARROW_PREVIEW_MEDIA).matches;
    }
    return window.innerWidth < 1024;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      const update = () => setMatches(window.innerWidth < 1024);
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const query = window.matchMedia(NARROW_PREVIEW_MEDIA);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return matches;
}

export default function WorkbenchShell() {
  const permissionMode = useSettings((s) => s.permissionMode);
  const setPermissionMode = useSettings((s) => s.setPermissionMode);
  const providerOrder = useSettings((s) => s.providerOrder);
  const defaultProviderId = useSettings((s) => s.defaultProviderId);
  const defaultModelId = useSettings((s) => s.defaultModelId);
  const globalActiveId = useConversations((s) => s.activeId);
  const openTabs = useConversations((s) => s.openTabs);
  const conversations = useConversations((s) => s.byId);
  const order = useConversations((s) => s.order);
  const timelines = useConversations((s) => s.timelines);
  const runIds = useConversations((s) => s.runIds);
  const pendingSends = useConversations((s) => s.pendingSends);
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const switchActive = useConversations((s) => s.switchActive);
  const activateScope = useConversations((s) => s.activateScope);
  const createConversation = useConversations((s) => s.createConversation);
  const closeTab = useConversations((s) => s.closeTab);
  const renameTitle = useConversations((s) => s.renameTitle);
  const pinConversation = useConversations((s) => s.pinConversation);
  const archiveConversation = useConversations((s) => s.archiveConversation);
  const moveConversation = useConversations((s) => s.moveConversation);
  const deleteConversation = useConversations((s) => s.deleteConversation);
  const send = useConversations((s) => s.send);
  const retry = useConversations((s) => s.retry);
  const dismissRetry = useConversations((s) => s.dismissRetry);
  const interrupt = useConversations((s) => s.interrupt);
  const setModelForConversation = useConversations((s) => s.setModelForConversation);
  const rawProviderList = useProviders((s) => s.list);
  const providerList = useMemo(
    () => orderConfiguredProviders(rawProviderList, providerOrder, { providerId: defaultProviderId, modelId: defaultModelId }),
    [defaultModelId, defaultProviderId, providerOrder, rawProviderList],
  );
  const workspace = useWorkspace();
  const workspaceFiles = useFileTree((state) => state.roots);
  const unreadCount = useNotifications((s) => s.unreadCount);
  // Same source as the buddy shell: only enabled skills reach the `/` menu.
  const skillList = useSkills((s) => s.list);
  const skillsDisabled = useSkills((s) => s.disabled);
  const enabledSkills = skillList.filter(
    (skill) => skill.available !== false && !skillsDisabled.includes(skill.id ?? skill.name),
  );

  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const openSettings = useUi((s) => s.openSettings);
  const toggleSearch = useUi((s) => s.toggleSearch);
  const toggleNotifPanel = useUi((s) => s.toggleNotifPanel);
  const previewOpen = useUi((s) => s.previewOpen);
  const closePreview = useUi((s) => s.closePreview);
  const previewActivePath = useUi((s) => s.previewActivePath);
  const previewWidthPx = useUi((s) => s.previewWidthPx);
  const filesOpen = useUi((s) => s.filesOpen);
  const toggleFiles = useUi((s) => s.toggleFiles);
  const narrowPreviewActive = useNarrowPreviewLayout() && previewOpen;
  const previewColumnRef = useRef<HTMLDivElement>(null);
  const previewReturnFocusRef = useRef<HTMLElement | null>(null);
  const narrowPreviewWasActiveRef = useRef(false);
  const previousPreviewActivePathRef = useRef<string | null>(null);
  useEffect(() => {
    const wasActive = narrowPreviewWasActiveRef.current;
    const activePathChanged = previousPreviewActivePathRef.current !== previewActivePath;
    if (narrowPreviewActive && !wasActive) {
      const activeElement = document.activeElement;
      previewReturnFocusRef.current = activeElement instanceof HTMLElement
        && activeElement !== document.body
        && !previewColumnRef.current?.contains(activeElement)
        ? activeElement
        : null;
      previewColumnRef.current?.focus();
    } else if (
      narrowPreviewActive
      && wasActive
      && activePathChanged
      && !previewColumnRef.current?.contains(document.activeElement)
    ) {
      previewColumnRef.current?.focus();
    } else if (!narrowPreviewActive && wasActive) {
      const returnTarget = previewReturnFocusRef.current;
      previewReturnFocusRef.current = null;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
      } else if (!previewOpen) {
        document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.focus();
      }
    }
    narrowPreviewWasActiveRef.current = narrowPreviewActive;
    previousPreviewActivePathRef.current = previewActivePath;
  }, [narrowPreviewActive, previewActivePath, previewOpen]);
  const workspaceList = useWorkspaces((state) => state.list);
  const activeWorkspaceId = useWorkspaces((state) => state.activeId);
  const activeWorkspaceKind = workspaceList.find((entry) => entry.id === activeWorkspaceId)?.kind ?? "home";
  const notebookList = useNotebooks((state) => state.list);
  const activeNotebookId = useNotebooks((state) => state.activeId);
  const activeBookId = activeWorkspaceKind === "home" ? activeNotebookId : null;
  const activeId = globalActiveId
    && (conversations[globalActiveId]?.workspaceId ?? HOME_WORKSPACE_ID) === activeWorkspaceId
    && conversations[globalActiveId]?.bookId === activeBookId
    ? globalActiveId
    : null;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    if (globalActiveId !== activeId) activateScope(activeWorkspaceId, activeBookId);
  }, [activateScope, activeBookId, activeId, activeWorkspaceId, globalActiveId]);
  const timeline = activeId ? timelines[activeId] : undefined;
  const activeRunId = activeId ? runIds[activeId] ?? null : null;
  const retryDraft = activeId ? pendingSends[activeId] : undefined;
  // Model picker (轮 3 卡 F): the shell owns the subscription, InputArea renders.
  const activeMeta = activeId ? conversations[activeId] : undefined;
  const composerDrafts = useComposerDrafts((state) => state.drafts);
  const updateComposerDraft = useComposerDrafts((state) => state.updateDraft);
  const setComposerText = useComposerDrafts((state) => state.setText);
  const assignComposerConversation = useComposerDrafts((state) => state.assignConversation);
  const draftScope = resolveComposerScope(composerDrafts, activeId, activeWorkspaceId, activeBookId);
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;
  const composerDraft = composerDrafts[draftScope] ?? EMPTY_COMPOSER_DRAFT;
  const draft = composerDraft.text;
  const scopedConversationIds = useMemo(() => order.filter((id) =>
    (conversations[id]?.workspaceId ?? HOME_WORKSPACE_ID) === activeWorkspaceId
      && conversations[id]?.bookId === activeBookId
  ), [activeBookId, activeWorkspaceId, conversations, order]);
  const orderPinnedFirst = (ids: string[]) => [...ids].sort((left, right) =>
    Number(conversations[right]?.pinned ?? false) - Number(conversations[left]?.pinned ?? false)
  );
  const visibleConversationIds = useMemo(
    () => orderPinnedFirst(scopedConversationIds.filter((id) => !conversations[id]?.archived)),
    [conversations, scopedConversationIds],
  );
  const archivedConversationIds = useMemo(
    () => orderPinnedFirst(scopedConversationIds.filter((id) => conversations[id]?.archived)),
    [conversations, scopedConversationIds],
  );
  const moveTargets = useMemo(() => {
    const managed = notebookList.map((book) => ({
      workspaceId: HOME_WORKSPACE_ID,
      bookId: book.id,
      label: book.title,
    }));
    const external = workspaceList
      .filter((entry) => entry.kind === "external" && entry.available)
      .map((entry) => ({ workspaceId: entry.id, bookId: null, label: entry.name }));
    return [...managed, ...external].filter((target) =>
      target.workspaceId !== activeWorkspaceId || target.bookId !== activeBookId
    );
  }, [activeBookId, activeWorkspaceId, notebookList, workspaceList]);
  const [showArchived, setShowArchived] = useState(false);
  const visibleOpenTabs = useMemo(() => openTabs.filter((id) =>
    (conversations[id]?.workspaceId ?? HOME_WORKSPACE_ID) === activeWorkspaceId
      && conversations[id]?.bookId === activeBookId
  ), [activeBookId, activeWorkspaceId, conversations, openTabs]);

  const messages = timeline ?? [];
  // 06 §2.2 归类: drop anywhere in the shell. With an active 本子 the file lands
  // straight in it; otherwise momo proposes and the user confirms.
  const drop = useFileDrop();

  const handleSend = async (
    text: string,
    attachments?: AttachmentRef[],
    referencedFiles?: WorkspaceFileRef[],
  ) => {
    const sendingScope = draftScope;
    const sendingWorkspaceId = activeWorkspaceId;
    let conversationId = activeId ?? composerDraft.assignedConversationId;
    if (!conversationId) {
      conversationId = await createConversation({
        source: "workbench",
        workspaceId: sendingWorkspaceId,
        bookId: activeBookId,
        activate: false,
      });
      assignComposerConversation(sendingScope, conversationId);
    }
    await send(conversationId, text, attachments, referencedFiles);
    // Creating a conversation is not the user's success boundary. Keep the
    // unsent draft visible until the host accepts the first turn, then enter
    // that conversation unless the user deliberately navigated elsewhere.
    if (!activeIdRef.current && draftScopeRef.current === sendingScope) {
      switchActive(conversationId);
    }
  };

  const handleNewConversation = async () => {
    const carryDraft = !activeId && (
      composerDraft.text.length > 0
      || composerDraft.attachments.length > 0
      || (composerDraft.workspaceFiles?.length ?? 0) > 0
      || composerDraft.submitError !== null
    );
    const id = await createConversation({
      source: "workbench",
      workspaceId: activeWorkspaceId,
      bookId: activeBookId,
      activate: false,
    });
    if (carryDraft) assignComposerConversation(draftScope, id);
    switchActive(id);
    setView("chat");
  };

  const handlePickConversation = (id: string) => {
    switchActive(id);
    setView("chat");
  };

  const dismissRetryAndRelease = () => {
    if (!activeId) return;
    for (const attachment of retryDraft?.attachments ?? []) {
      if (workspace?.releaseClipboardImage) {
        void workspace.releaseClipboardImage(attachment.path).catch(() => {});
      }
    }
    dismissRetry(activeId);
  };

  const handleRewriteSelection = (source: {
    workspaceId: string;
    filePath: string;
    selectedText: string;
  }) => {
    if (source.workspaceId !== activeWorkspaceId) return;
    const fileName = source.filePath.split("/").pop() ?? source.filePath;
    const quote = source.selectedText
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
    const instruction = `请改写我在「${fileName}」里选中的这段内容，并更新到原文件：\n\n${quote}`;
    updateComposerDraft(draftScope, (current) => {
      const files = current.workspaceFiles ?? [];
      const duplicate = files.some((file) =>
        file.workspaceId === source.workspaceId && file.workspacePath === source.filePath
      );
      const atLimit = current.attachments.length + files.length + current.pendingStageCount >= 20;
      if (atLimit && !duplicate) {
        return { ...current, submitError: "一次最多添加 20 个附件。" };
      }
      return {
        ...current,
        text: current.text.trim()
          ? `${current.text.trimEnd()}\n\n${instruction}`
          : instruction,
        workspaceFiles: duplicate
          ? files
          : [...files, {
              id: `${Date.now()}-${Math.random()}`,
              name: fileName,
              workspaceId: source.workspaceId,
              workspacePath: source.filePath,
            }],
        submitError: null,
      };
    });
    setView("chat");
    if (narrowPreviewActive) closePreview();
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.focus();
    });
  };

  const contextTitle = view === "chat" && activeId
    ? conversations[activeId]?.title ?? null
    : null;
  const activeStatus = activeId
    ? deriveConversationStatus({
        timeline: timelines[activeId] ?? [],
        activeRunId: runIds[activeId] ?? null,
        pending: pendingByConversation[activeId] ?? null,
      })
    : null;

  const previewColumn = previewOpen ? (
    <div
      ref={previewColumnRef}
      className="flex shrink-0 flex-col border-l border-[var(--leemo-line)] max-[1024px]:absolute max-[1024px]:inset-y-0 max-[1024px]:right-0 max-[1024px]:z-20 max-[1024px]:!w-full max-[1024px]:bg-[var(--leemo-bg)] max-[1024px]:shadow-[-12px_0_32px_rgba(32,32,31,0.08)]"
      style={{ width: previewWidthPx }}
      data-testid="preview-pane-column"
      role="region"
      aria-label="文件预览"
      tabIndex={narrowPreviewActive ? -1 : undefined}
    >
      <PreviewPane onRewriteSelection={handleRewriteSelection} />
    </div>
  ) : null;

  // 渲染内容区（根据 ui.view 路由）
  const content = (() => {
    if (view === "skills") {
      return <SkillsPage />;
    }
    if (view === "scheduled") {
      return <ScheduledTasksPage />;
    }
    if (view === "learning") {
      return <EnglishLearningPage />;
    }
    if (view === "artifacts") {
      return (
        <div className="relative flex min-h-0 min-w-0 flex-1" data-testid="workbench-content-surface">
          <div
            className="flex min-h-0 min-w-0 flex-1"
            data-testid="artifacts-content-column"
            inert={narrowPreviewActive || undefined}
            aria-hidden={narrowPreviewActive || undefined}
          >
            <ArtifactsPage />
          </div>
          {previewColumn}
        </div>
      );
    }

    // chat 视图（默认）
    return (
      <div className="relative flex min-h-0 flex-1" data-testid="workbench-content-surface">
        {/* 主内容列 */}
        <div
          className="flex min-w-0 flex-1 flex-col"
          data-testid="conversation-column"
          inert={narrowPreviewActive || undefined}
          aria-hidden={narrowPreviewActive || undefined}
        >
          {messages.length > 0 ? (
            <Timeline />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 pb-8">
              <div className="text-center">
                <div className="mx-auto mb-4 w-fit"><MomoAvatar size={52} /></div>
                <p className="text-[15px] font-medium text-[var(--leemo-ink-2)]">今天想先处理什么？</p>
              </div>
            </div>
          )}
          <div className="mt-auto shrink-0">
            <div
              className="mx-auto w-full max-w-[880px]"
              data-testid="workbench-composer-column"
            >
              {drop.pending && (
                <div className="px-8">
                  <DropClassifyBar drop={drop.pending} onConfirm={drop.confirm} onCancel={drop.cancel} />
                </div>
              )}
              <InputArea
                conversationId={activeId}
                value={draft}
                onChange={(next) => setComposerText(draftScope, next)}
                onSend={handleSend}
                draftScope={draftScope}
                draftState={composerDraft}
                onDraftStateChange={(update) => updateComposerDraft(draftScope, update)}
                retryDraft={retryDraft}
                onRetry={() => activeId ? retry(activeId) : undefined}
                onDismissRetry={dismissRetryAndRelease}
                resolveFilePath={workspace ? (file) => workspace.pathForFile(file) : undefined}
                stageClipboardImage={workspace?.stageClipboardImage
                  ? () => workspace.stageClipboardImage!()
                  : undefined}
                releaseClipboardImage={workspace?.releaseClipboardImage
                  ? (path) => workspace.releaseClipboardImage!(path)
                  : undefined}
                busy={activeRunId !== null}
                onStop={() => { if (activeId) void interrupt(activeId); }}
                skills={enabledSkills}
                workspaceFiles={workspaceFiles}
                workspaceId={activeWorkspaceId}
                providers={providerList}
                currentProviderId={activeMeta?.providerId ?? null}
                currentModelId={activeMeta?.modelId ?? null}
                permissionMode={permissionMode}
                onOpenSettings={() => openSettings("models")}
                onOpenPermissionSettings={() => openSettings("permissions")}
                onDisableFullAccess={() => setPermissionMode("acceptEdits")}
                onSelectModel={(providerId, modelId) => {
                  if (activeId) void setModelForConversation(activeId, providerId, modelId);
                }}
              />
            </div>
          </div>
        </div>
        {/* 预览列 */}
        {previewColumn}
        {/* 文件树列 */}
        {filesOpen && (
          <div
            className="absolute inset-y-0 right-0 z-30 flex w-[280px] flex-col border-l border-[var(--leemo-line)] bg-[var(--leemo-side)] shadow-[-12px_0_32px_rgba(32,32,31,0.08)] max-[700px]:w-[min(82vw,280px)]"
            data-testid="file-tree-column"
            aria-label="全部文件"
          >
            <FileTree />
          </div>
        )}
      </div>
    );
  })();

  return (
    <div
      className="flex h-screen overflow-hidden bg-[var(--leemo-bg)]"
      data-shell="workbench"
      data-testid="workbench-shell"
      onDragOver={(e) => {
        if (drop.enabled && isFileDataTransfer(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!drop.enabled) return;
        // Only claim the event when a real OS file came with it, so text drags
        // into the composer keep working.
        if (drop.handleDrop(e.dataTransfer.files)) e.preventDefault();
      }}
    >
      {/* 侧栏 */}
      <aside
        className={`flex shrink-0 flex-col border-r border-[var(--leemo-line)] bg-[var(--leemo-side)] transition-[width] duration-200 ${
          sidebarCollapsed ? "w-[48px]" : "w-[260px] max-[900px]:w-[180px]"
        }`}
        aria-label="工作台侧栏"
      >
        {sidebarCollapsed ? (
          <div className="flex min-h-0 flex-1 flex-col items-center">
            <div className="flex h-14 w-full shrink-0 items-center justify-center border-b border-[var(--leemo-line)]">
              <button type="button" onClick={toggleSidebar} className="leemo-icon-btn" aria-label="展开侧栏" title="展开侧栏">
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col items-center gap-1 py-2">
              <button type="button" onClick={() => void handleNewConversation()} className="leemo-icon-btn" aria-label="新建对话" title="新对话">
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex w-full shrink-0 flex-col items-center gap-1 border-t border-[var(--leemo-line)] py-2">
              {[
                { id: "learning" as const, label: "英语学习", Icon: Languages },
                { id: "skills" as const, label: "技能", Icon: Wrench },
                { id: "scheduled" as const, label: "定时任务", Icon: CalendarClock },
                { id: "artifacts" as const, label: "成果", Icon: LayoutGrid },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  className={`leemo-icon-btn ${view === id ? "bg-[var(--leemo-card)] text-[var(--leemo-ink)] shadow-sm" : ""}`}
                  aria-label={label}
                  aria-current={view === id ? "page" : undefined}
                  title={label}
                >
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
            {/* 侧栏头部：logo + 新建按钮 */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--leemo-line)] px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <MomoAvatar size={24} />
                <WorkspaceSwitcher />
              </div>
              <button
                onClick={() => void handleNewConversation()}
                className="leemo-icon-btn"
                title="新对话"
                aria-label="新建对话"
              >
                <Plus className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* 对话列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {visibleConversationIds.length === 0 ? (
                <div className="px-2 py-8 text-center text-xs text-[var(--leemo-ink-3)]">
                  还没有对话
                </div>
              ) : (
                <div className="space-y-0.5">
                  {visibleConversationIds.map((id) => {
                    const conv = conversations[id];
                    if (!conv) return null;
                    const isActive = id === activeId;
                    return (
                      <ConversationListItem
                        key={id}
                        conversation={conv}
                        active={isActive}
                        variant="workbench"
                        onPick={() => handlePickConversation(id)}
                        onRename={(title) => renameTitle(id, title)}
                        onPin={(pinned) => pinConversation(id, pinned)}
                        onArchive={(archived) => archiveConversation(id, archived)}
                        onDelete={() => deleteConversation(id)}
                        moveTargets={moveTargets}
                        onMove={(target) => moveConversation(id, target)}
                        status={deriveConversationStatus({
                          timeline: timelines[id] ?? [],
                          activeRunId: runIds[id] ?? null,
                          pending: pendingByConversation[id] ?? null,
                        })}
                      />
                    );
                  })}
                </div>
              )}

              {archivedConversationIds.length > 0 && (
                <div className="mt-3 border-t border-[var(--leemo-line)] pt-2">
                  <button
                    type="button"
                    onClick={() => setShowArchived((open) => !open)}
                    aria-expanded={showArchived}
                    className="flex w-full items-center gap-1.5 rounded-[5px] px-2 py-1.5 text-left text-[11px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
                  >
                    {showArchived
                      ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                      : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                    <Archive className="h-3.5 w-3.5" aria-hidden />
                    <span>已归档 {archivedConversationIds.length}</span>
                  </button>
                  {showArchived && (
                    <div className="mt-1 space-y-0.5 opacity-80">
                      {archivedConversationIds.map((id) => {
                        const conv = conversations[id];
                        if (!conv) return null;
                        return (
                          <ConversationListItem
                            key={id}
                            conversation={conv}
                            active={false}
                            variant="workbench"
                            onPick={() => handlePickConversation(id)}
                            onRename={(title) => renameTitle(id, title)}
                            onPin={(pinned) => pinConversation(id, pinned)}
                            onArchive={(archived) => archiveConversation(id, archived)}
                            onDelete={() => deleteConversation(id)}
                            moveTargets={moveTargets}
                            onMove={(target) => moveConversation(id, target)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 侧栏底部：设置入口 */}
            <div className="shrink-0 border-t border-[var(--leemo-line)] p-2">
              <button
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                  view === "learning"
                    ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm ring-1 ring-inset ring-[var(--leemo-line-soft)]"
                    : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                }`}
                title="英语学习"
                aria-current={view === "learning" ? "page" : undefined}
                onClick={() => setView("learning")}
              >
                <Languages className="h-4 w-4" aria-hidden />
                <span className="text-xs">英语学习</span>
              </button>
              <button
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                  view === "skills"
                    ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm ring-1 ring-inset ring-[var(--leemo-line-soft)]"
                    : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                }`}
                title="技能"
                aria-current={view === "skills" ? "page" : undefined}
                onClick={() => setView("skills")}
              >
                <Wrench className="h-4 w-4" aria-hidden />
                <span className="text-xs">技能</span>
              </button>
              <button
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                  view === "scheduled"
                    ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm ring-1 ring-inset ring-[var(--leemo-line-soft)]"
                    : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                }`}
                title="定时任务"
                aria-current={view === "scheduled" ? "page" : undefined}
                onClick={() => setView("scheduled")}
              >
                <CalendarClock className="h-4 w-4" aria-hidden />
                <span className="text-xs">定时任务</span>
              </button>
              <button
                onClick={() => setView("artifacts")}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 transition-colors ${
                  view === "artifacts"
                    ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm ring-1 ring-inset ring-[var(--leemo-line-soft)]"
                    : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                }`}
                title="成果"
                aria-current={view === "artifacts" ? "page" : undefined}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                <span className="text-xs">成果</span>
              </button>
              <button
                onClick={() => openSettings()}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)]"
                title="设置"
              >
                <Settings className="h-4 w-4" aria-hidden />
                <span className="text-xs text-[var(--leemo-ink-2)]">设置</span>
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* 主区域 */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--leemo-bg)]">
        {/* 顶栏 */}
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--leemo-line)] bg-[var(--leemo-card)]/80 px-5 backdrop-blur-md">
          <div className="flex min-w-0 flex-1 items-center gap-2 pr-4 text-sm">
            {!sidebarCollapsed && (
              <button type="button" onClick={toggleSidebar} className="leemo-icon-btn -ml-1" aria-label="收起侧栏" title="收起侧栏">
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              </button>
            )}
            {contextTitle && (
              <span
                data-testid="workbench-context-title"
                title={contextTitle}
                className="min-w-0 truncate text-[var(--leemo-ink-2)]"
              >
                {contextTitle}
              </span>
            )}
            {view === "chat" && activeStatus && (
              <span
                data-testid="current-conversation-status"
                title={activeStatus.detail}
                className={`shrink-0 text-[11px] ${
                  activeStatus.kind === "failed"
                    ? "text-[var(--leemo-danger)]"
                    : activeStatus.kind === "completed"
                      ? "text-[var(--leemo-ok)]"
                      : activeStatus.kind === "running" || activeStatus.kind === "blocked"
                        ? "text-[var(--leemo-amber)]"
                        : "text-[var(--leemo-ink-3)]"
                }`}
              >
                {activeStatus.label}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button onClick={toggleFiles} className="leemo-icon-btn" title="文件树" aria-label="文件树">
              <Folder className="h-[17px] w-[17px]" aria-hidden />
            </button>
            <button onClick={toggleSearch} className="leemo-icon-btn" title="搜索" aria-label="搜索">
              <Search className="h-[17px] w-[17px]" aria-hidden />
            </button>

            <button onClick={toggleNotifPanel} className="leemo-icon-btn relative" title="通知" aria-label="通知">
              <Bell className="h-[17px] w-[17px]" aria-hidden />
              {unreadCount > 0 && (
                <span
                  data-testid="notif-badge"
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--leemo-amber)] px-1 text-[10px] font-medium text-white"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            <div className="h-5 w-px bg-[var(--leemo-line)]" />

            <ModeSwitcher />

          </div>
        </header>

        {/* 标签条（超过1个标签时显示） */}
        {visibleOpenTabs.length > 1 && (
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--leemo-line)] bg-[var(--leemo-side)] px-3">
            {visibleOpenTabs.map((id) => {
              const conv = conversations[id];
              if (!conv) return null;
              const isActive = id === activeId;
              return (
                <div
                  key={id}
                  className={`group flex h-full items-center gap-2 rounded-t-lg px-3 text-xs transition-colors ${
                    isActive
                      ? "border-b-2 border-[var(--leemo-amber)] bg-[var(--leemo-bg)] font-medium text-[var(--leemo-ink)]"
                      : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)]"
                  }`}
                >
                  <button onClick={() => handlePickConversation(id)} className="min-w-0 flex-1 truncate">
                    {conv.title}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(id); }}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="关闭标签"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              );
            })}
            <button onClick={() => void handleNewConversation()} className="leemo-icon-btn h-7 w-7" title="新标签">
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}

        {/* 内容区 */}
        {content}
      </main>

    </div>
  );
}
