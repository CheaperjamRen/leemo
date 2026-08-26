import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  ListChecks,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useApprovals, useCaptures, useComposerDrafts, useContextUsage, useConversations, useSettings, useUi, useSkills, useProviders, useWorkspace, useWorkspaces, useNotebooks, useFileTree } from "../bridge/context";
import { deriveConversationMarker, deriveConversationStatus } from "../stores/conversation-status";
import {
  EMPTY_COMPOSER_DRAFT,
  resolveComposerScope,
  workspaceComposerScope,
} from "../stores/composer-drafts";
import type { AttachmentRef, WorkspaceFileRef } from "../../bridge/contract";
import Timeline from "./timeline/Timeline";
import InputArea from "./InputArea";
import MomoAvatar from "./momo/MomoAvatar";
import PreviewPane from "./PreviewPane";
import DropClassifyBar from "./DropClassifyBar";
import { isFileDataTransfer, useFileDrop } from "./useFileDrop";
import ConversationStateMark from "./ConversationStateMark";
import { orderConfiguredProviders } from "./model-picker";
import WorkbenchSidebar, { type WorkbenchConversationScope } from "./WorkbenchSidebar";
import WorkbenchActivityRail from "./WorkbenchActivityRail";
import WorkbenchStage from "./WorkbenchStage";
import TopBar from "./TopBar";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import type { ConversationTurnOptions } from "../stores/conversations";
import { resolveWorkbenchSidebarMode } from "../workbench-spatial";

const SkillsPage = lazy(() => import("../pages/SkillsPage"));
const ScheduledTasksPage = lazy(() => import("../pages/ScheduledTasksPage"));
const EnglishLearningPage = lazy(() => import("../pages/EnglishLearningPage"));
const ArtifactsPage = lazy(async () => {
  const module = await import("../pages/ArtifactsPage");
  return { default: module.ArtifactsPage };
});

const NARROW_PREVIEW_MEDIA = "(max-width: 1023.98px)";

const WORKBENCH_STARTERS = [
  {
    label: "整理资料",
    prompt: "帮我整理这些资料，提炼重点并形成清晰结构",
    Icon: ListChecks,
  },
  {
    label: "起草文档",
    prompt: "帮我起草一份文档，先和我确认目标与受众",
    Icon: FileText,
  },
  {
    label: "搜索并汇总",
    prompt: "搜索相关资料，核对来源后给我一份简明汇总",
    Icon: Search,
  },
] as const;

function WorkbenchPageLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <div
      className="grid min-h-0 flex-1 place-items-center text-sm text-[var(--leemo-ink-3)]"
      role="status"
      aria-label={`正在打开${label}`}
    >
      正在打开{label}…
    </div>
  );
}

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
  const setDefaultModel = useSettings((s) => s.setDefaultModel);
  const globalActiveId = useConversations((s) => s.activeId);
  const openTabs = useConversations((s) => s.openTabs);
  const conversations = useConversations((s) => s.byId);
  const timelines = useConversations((s) => s.timelines);
  const runIds = useConversations((s) => s.runIds);
  const pendingSends = useConversations((s) => s.pendingSends);
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const switchActive = useConversations((s) => s.switchActive);
  const activateScope = useConversations((s) => s.activateScope);
  const createConversation = useConversations((s) => s.createConversation);
  const closeTab = useConversations((s) => s.closeTab);
  const send = useConversations((s) => s.send);
  const guide = useConversations((s) => s.guide);
  const enqueueTurn = useConversations((s) => s.enqueueTurn);
  const removeQueuedTurn = useConversations((s) => s.removeQueuedTurn);
  const guideQueuedTurn = useConversations((s) => s.guideQueuedTurn);
  const retry = useConversations((s) => s.retry);
  const dismissRetry = useConversations((s) => s.dismissRetry);
  const interrupt = useConversations((s) => s.interrupt);
  const setModelForConversation = useConversations((s) => s.setModelForConversation);
  const setGoal = useConversations((s) => s.setGoal);
  const toggleGoalPaused = useConversations((s) => s.toggleGoalPaused);
  const clearGoal = useConversations((s) => s.clearGoal);
  const rawProviderList = useProviders((s) => s.list);
  const providerList = useMemo(
    () => orderConfiguredProviders(rawProviderList, providerOrder, { providerId: defaultProviderId, modelId: defaultModelId }),
    [defaultModelId, defaultProviderId, providerOrder, rawProviderList],
  );
  const workspace = useWorkspace();
  const workspaceFiles = useFileTree((state) => state.roots);
  // Same source as the buddy shell: only enabled skills reach the `/` menu.
  const skillList = useSkills((s) => s.list);
  const skillsDisabled = useSkills((s) => s.disabled);
  const enabledSkills = skillList.filter(
    (skill) => skill.available !== false && !skillsDisabled.includes(skill.id ?? skill.name),
  );

  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const openSettings = useUi((s) => s.openSettings);
  const toggleSearch = useUi((s) => s.toggleSearch);
  const sidebarPreference = useUi((s) => s.workbenchSidebarPreference);
  const setSidebarPreference = useUi((s) => s.setWorkbenchSidebarPreference);
  const previewOpen = useUi((s) => s.previewOpen);
  const previewActivePath = useUi((s) => s.previewActivePath);
  const previewWidthPx = useUi((s) => s.previewWidthPx);
  const setScopeSurface = useUi((s) => s.setScopeSurface);
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellWidth, setShellWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const sidebarCollapsed = resolveWorkbenchSidebarMode(sidebarPreference, shellWidth) === "compact";
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => setShellWidth(shell.getBoundingClientRect().width || window.innerWidth);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  const narrowPreviewActive = useNarrowPreviewLayout() && previewOpen && view === "artifacts";
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
  const stopping = useConversations((s) => activeId ? s.stoppingById[activeId] === true : false);
  const stopLocked = useConversations((s) => activeId ? s.stopLockedById[activeId] === true : false);
  const retryDraft = activeId ? pendingSends[activeId] : undefined;
  const queuedTurns = useConversations((s) => activeId ? s.queuedTurns[activeId] : undefined);
  // Model picker (轮 3 卡 F): the shell owns the subscription, InputArea renders.
  const activeMeta = activeId ? conversations[activeId] : undefined;
  const activeContextUsage = useContextUsage((state) => activeId ? state.byConversation[activeId] : undefined);
  const composerDrafts = useComposerDrafts((state) => state.drafts);
  const notes = useCaptures((state) => state.notes);
  const updateComposerDraft = useComposerDrafts((state) => state.updateDraft);
  const setComposerText = useComposerDrafts((state) => state.setText);
  const assignComposerConversation = useComposerDrafts((state) => state.assignConversation);
  const draftScope = resolveComposerScope(composerDrafts, activeId, activeWorkspaceId, activeBookId);
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;
  const composerDraft = composerDrafts[draftScope] ?? EMPTY_COMPOSER_DRAFT;
  const draft = composerDraft.text;
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
    options?: ConversationTurnOptions,
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
      if (!activeIdRef.current && draftScopeRef.current === sendingScope) {
        switchActive(conversationId);
      }
    }
    await send(conversationId, text, attachments, referencedFiles, options);
    // A later navigation still wins; this fallback covers an existing draft
    // that was assigned to a conversation before this send began.
    if (!activeIdRef.current && draftScopeRef.current === sendingScope) {
      switchActive(conversationId);
    }
  };

  const handleNewConversation = async (requestedScope?: WorkbenchConversationScope) => {
    const targetWorkspaceId = requestedScope?.workspaceId ?? activeWorkspaceId;
    const targetBookId = requestedScope ? requestedScope.bookId : activeBookId;
    const targetDraftScope = requestedScope
      ? workspaceComposerScope(targetWorkspaceId, targetBookId)
      : draftScope;
    const targetDraft = composerDrafts[targetDraftScope] ?? EMPTY_COMPOSER_DRAFT;
    const isCurrentScope = targetWorkspaceId === activeWorkspaceId && targetBookId === activeBookId;
    const carryDraft = isCurrentScope && !activeId && (
      targetDraft.text.length > 0
      || targetDraft.attachments.length > 0
      || (targetDraft.workspaceFiles?.length ?? 0) > 0
      || targetDraft.submitError !== null
    );
    try {
      const id = await createConversation({
        source: "workbench",
        workspaceId: targetWorkspaceId,
        bookId: targetBookId,
        activate: false,
      });
      if (carryDraft) assignComposerConversation(targetDraftScope, id);
      switchActive(id);
      setView("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateComposerDraft(targetDraftScope, (current) => ({ ...current, submitError: message }));
      if (/还没有(?:选择可用模型|完成登录与保存|配置 API Key)/u.test(message)) {
        openSettings("models");
      }
    }
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

  const handleQueue = (
    text: string,
    attachments?: AttachmentRef[],
    referencedFiles?: WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => {
    const conversationId = activeId ?? composerDraft.assignedConversationId;
    if (!conversationId) throw new Error("请先选择对话。");
    enqueueTurn(conversationId, text, attachments, referencedFiles, options);
  };

  const handleSaveGoal = async (text: string) => {
    const goalScope = draftScope;
    let conversationId = activeId ?? composerDraft.assignedConversationId;
    if (!conversationId) {
      conversationId = await createConversation({
        source: "workbench",
        workspaceId: activeWorkspaceId,
        bookId: activeBookId,
        activate: false,
      });
      assignComposerConversation(goalScope, conversationId);
    }
    await setGoal(conversationId, text);
    if (!activeIdRef.current && draftScopeRef.current === goalScope) switchActive(conversationId);
  };

  const primeComposer = (prompt: string): void => {
    setComposerText(draftScope, prompt);
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.focus();
    });
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
    setScopeSurface("conversation");
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
  const activeMarker = activeId && activeStatus && conversations[activeId]
    ? deriveConversationMarker({ status: activeStatus, unread: conversations[activeId].unread })
    : null;

  const artifactPreviewColumn = previewOpen ? (
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

  const chatFileSurface = previewOpen ? (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="preview-pane-column">
      <PreviewPane onRewriteSelection={handleRewriteSelection} />
    </div>
  ) : null;

  // 渲染内容区（根据 ui.view 路由）
  const content = (() => {
    if (view === "skills") {
      return (
        <Suspense fallback={<WorkbenchPageLoading label="技能" />}>
          <SkillsPage />
        </Suspense>
      );
    }
    if (view === "scheduled") {
      return (
        <Suspense fallback={<WorkbenchPageLoading label="定时任务" />}>
          <ScheduledTasksPage />
        </Suspense>
      );
    }
    if (view === "learning") {
      return (
        <Suspense fallback={<WorkbenchPageLoading label="英语学习" />}>
          <EnglishLearningPage />
        </Suspense>
      );
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
            <Suspense fallback={<WorkbenchPageLoading label="成果" />}>
              <ArtifactsPage />
            </Suspense>
          </div>
          {artifactPreviewColumn}
        </div>
      );
    }

    // chat 视图（默认）
    const conversationSurface = (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="conversation-column">
          {messages.length > 0 ? (
            <Timeline />
          ) : (
            <div className="leemo-workbench-empty flex flex-1 items-center justify-center px-6 pb-8">
              <div className="w-full max-w-[500px] text-center">
                <div className="mx-auto mb-3 w-fit"><MomoAvatar size={34} /></div>
                <p className="text-[14px] font-medium text-[var(--leemo-ink-2)]">今天想先处理什么？</p>
                {draft.trim().length === 0 && (
                  <div
                    className="leemo-workbench-starters mt-4 flex flex-wrap justify-center gap-2"
                    aria-label="开始一项工作"
                  >
                    {WORKBENCH_STARTERS.map(({ label, prompt, Icon }) => (
                      <button
                        key={label}
                        type="button"
                        className="flex h-9 items-center justify-center gap-1.5 rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3.5 text-[12px] text-[var(--leemo-ink-2)] transition-[background-color,border-color,color] hover:border-[var(--leemo-amber-line)] hover:bg-[var(--leemo-amber-bg)] hover:text-[var(--leemo-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
                        onClick={() => primeComposer(prompt)}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mt-auto shrink-0">
            <div
              className="leemo-workbench-composer-column mx-auto w-full max-w-[952px] max-[1120px]:max-w-[856px]"
              data-testid="workbench-composer-column"
            >
              {drop.pending && (
                <div className="px-8">
                  <DropClassifyBar drop={drop.pending} onConfirm={drop.confirm} onCancel={drop.cancel} />
                </div>
              )}
              <InputArea
                surface="workbench"
                conversationId={activeId}
                value={draft}
                onChange={(next) => setComposerText(draftScope, next)}
                onSend={handleSend}
                onQueue={handleQueue}
                notes={notes}
                onGuide={(text) => activeId ? guide(activeId, text) : Promise.reject(new Error("请先选择对话。"))}
                queuedTurns={queuedTurns}
                onEditQueuedTurn={(queuedTurnId) => { if (activeId) removeQueuedTurn(activeId, queuedTurnId); }}
                onDeleteQueuedTurn={(queuedTurnId) => { if (activeId) removeQueuedTurn(activeId, queuedTurnId); }}
                onGuideQueuedTurn={(queuedTurnId) => activeId
                  ? guideQueuedTurn(activeId, queuedTurnId)
                  : Promise.reject(new Error("请先选择对话。"))}
                goal={activeMeta?.goal}
                onSaveGoal={handleSaveGoal}
                onToggleGoalPaused={() => activeId ? toggleGoalPaused(activeId) : undefined}
                onDeleteGoal={() => activeId ? clearGoal(activeId) : undefined}
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
                stopping={stopping}
                stopLocked={stopLocked}
                onStop={() => { if (activeId) void interrupt(activeId); }}
                skills={enabledSkills}
                workspaceFiles={workspaceFiles}
                workspaceId={activeWorkspaceId}
                providers={providerList}
                  currentProviderId={activeMeta?.providerId ?? defaultProviderId}
                  currentModelId={activeMeta?.modelId ?? defaultModelId}
                contextUsage={activeContextUsage}
                permissionMode={permissionMode}
                  onOpenSettings={() => openSettings("models")}
                  onSelectPermissionMode={setPermissionMode}
                  onSelectModel={(providerId, modelId) => {
                    if (activeId) {
                      void setModelForConversation(activeId, providerId, modelId);
                      return;
                    }
                    setDefaultModel(providerId, modelId);
                  }}
              />
            </div>
          </div>
      </div>
    );

    return (
      <div className="relative flex min-h-0 min-w-0 flex-1" data-testid="workbench-content-surface">
        <WorkbenchStage
          conversation={conversationSurface}
          file={chatFileSurface}
          hasFile={previewOpen}
          fileKey={previewActivePath ? `${activeWorkspaceId}\u0000${previewActivePath}` : null}
          conversationMarker={activeMarker && activeStatus ? (
            <ConversationStateMark
              marker={activeMarker}
              label={contextTitle ?? "当前对话"}
              detail={activeStatus.detail}
              className="mr-0"
            />
          ) : null}
        />
      </div>
    );
  })();

  return (
    <div
      ref={shellRef}
      className="leemo-workbench-shell relative flex h-screen flex-col overflow-hidden bg-[var(--leemo-bg)]"
      data-shell="workbench"
      data-canvas="workbench"
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
      <TopBar
        navigationControl={sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}
        onOpenHistory={() => setSidebarPreference(sidebarCollapsed ? "pinned" : "compact")}
      />

      <div className="flex min-h-0 flex-1 pt-14">
        <WorkbenchSidebar onNewConversation={handleNewConversation} shellWidth={shellWidth} />

        {/* 主区域 */}
        <main className="leemo-workbench-main leemo-workbench-canvas flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--leemo-bg)]" data-surface-level="canvas" data-content-axis="primary">
        {/* 对话标签栏只属于聊天 / 文件工作区；独立页面直接使用完整内容高度。 */}
        {view === "chat" && (
        <header
          className="leemo-workbench-topbar flex h-[50px] shrink-0 items-center justify-between border-b border-[var(--leemo-line)] bg-[var(--leemo-card)]/92 pl-4 pr-3 backdrop-blur-md"
          data-testid="workbench-conversation-bar"
        >
          <div className="leemo-workbench-tabs flex h-full min-w-0 flex-1 items-end gap-1 pr-4 text-sm">
            {visibleOpenTabs.length > 1 ? (
              <>
                {visibleOpenTabs.map((id) => {
                  const conv = conversations[id];
                  if (!conv) return null;
                  const isActive = id === activeId;
                  return (
                    <div
                      key={id}
                      className={`group flex h-[38px] max-w-[220px] items-center gap-2 rounded-t-[7px] border-x border-t px-3 text-xs transition-colors ${
                        isActive
                          ? "border-[var(--leemo-line)] bg-[var(--leemo-bg)] font-medium text-[var(--leemo-ink)]"
                          : "border-transparent text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)]"
                      }`}
                    >
                      <button onClick={() => handlePickConversation(id)} className="min-w-0 flex-1 truncate">
                        {conv.title}
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); closeTab(id); }}
                        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label="关闭标签"
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  );
                })}
                <button onClick={() => void handleNewConversation()} className="leemo-icon-btn mb-1 h-7 w-7" title="新标签" aria-label="新建标签">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            ) : view === "chat" && (
              <div
                data-testid="workbench-context-title"
                data-tab-state="active"
                title={contextTitle ?? "新对话"}
                className="flex h-full min-w-0 max-w-[280px] items-center truncate px-2 text-[13px] font-medium text-[var(--leemo-ink)]"
              >
                {contextTitle ?? "新对话"}
              </div>
            )}
            {view === "chat" && activeStatus && activeMarker && (
              <span data-testid="current-conversation-status">
                <ConversationStateMark
                  marker={activeMarker}
                  label={contextTitle ?? "当前对话"}
                  detail={activeStatus.detail}
                  className="mr-0"
                />
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={toggleSearch} className="leemo-icon-btn" title="搜索" aria-label="搜索">
              <Search className="h-[17px] w-[17px]" aria-hidden />
            </button>
          </div>
        </header>
        )}

        {/* 内容区 */}
        {content}
        </main>

        <WorkbenchActivityRail shellWidth={shellWidth} />
      </div>

    </div>
  );
}
