import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./TopBar";
import ChipRow from "./ChipRow";
import InputArea from "./InputArea";
import PinnedPlan from "./PinnedPlan";
import HistoryDrawer from "./HistoryDrawer";
import Timeline from "./timeline/Timeline";
import LiveStatusBar from "./timeline/LiveStatusBar";
import DropClassifyBar from "./DropClassifyBar";
import { isFileDataTransfer, useFileDrop } from "./useFileDrop";
import { useApprovals, useArtifacts, useCaptures, useComposerDrafts, useContextUsage, useConversations, useConversationsApi, useScheduledTasks, useSettings, useSkills, useProviders, useUi, useWorkspace, useFileTree, useWorkspaces } from "../bridge/context";
import type { AttachmentRef, WorkspaceFileRef } from "../../bridge/contract";
import { orderConfiguredProviders } from "./model-picker";
import {
  EMPTY_COMPOSER_DRAFT,
  resolveComposerScope,
} from "../stores/composer-drafts";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import type { ConversationTurnOptions } from "../stores/conversations";
import {
  buildDailyReviewPrompt,
  hasDailyReviewToday,
} from "../stores/daily-review";
import {
  RELATIONSHIP_CONVERSATION_TITLE,
  RELATIONSHIP_ONBOARDING_LABEL,
  buildRelationshipOnboardingPrompt,
  findRelationshipConversation,
  isGlobalBuddyConversation,
} from "../stores/relationship-onboarding";
import {
  canReuseEmptyRelationshipChapter,
  deriveRelationshipChapters,
  projectRelationshipTimelineWindow,
  relationshipRunCountFromEnd,
} from "../stores/relationship-chapters";
import { buildGreeting } from "../stores/settings";
import Clock from "./Clock";
import MomoAvatar from "./momo/MomoAvatar";
import { LEEMO_ASK_USER_TOOL_NAME } from "../bridge/tool-names";
import "./BuddyShell.css";

const RELATIONSHIP_PAGE_SIZE = 40;

function BuddyRelationshipTimeline({
  activeId,
  activeRunId,
  historyFocus,
  runLimit,
  onLoadOlder,
}: {
  activeId: string | null;
  activeRunId: string | null;
  historyFocus: { runId: string; nonce: number } | null;
  runLimit: number;
  onLoadOlder: () => void;
}): React.JSX.Element {
  // Keep the relationship projection beside the timeline that actually grows.
  // The shell, top navigation and composer stay responsive while this small
  // subtree receives streamed text.
  const conversations = useConversations((state) => state.byId);
  const timelines = useConversations((state) => state.timelines);
  const chapters = useMemo(() => deriveRelationshipChapters({
    conversations,
    timelines,
    activeId,
  }), [activeId, conversations, timelines]);
  const window = useMemo(
    () => projectRelationshipTimelineWindow(chapters, runLimit),
    [chapters, runLimit],
  );

  return (
    <Timeline
      items={window.items}
      activeConversationId={activeId}
      activeRunId={activeRunId}
      pageKey={`buddy-relationship:${activeId ?? "empty"}`}
      focusRequest={historyFocus}
      chapterMarkers={window.chapterMarkers}
      hasOlder={window.hasOlder}
      onLoadOlder={onLoadOlder}
    />
  );
}

export default function BuddyShell() {
  const [drawer, setDrawer] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [newTopicBusy, setNewTopicBusy] = useState(false);
  const [newTopicError, setNewTopicError] = useState<string | null>(null);
  const [dailyReviewBusy, setDailyReviewBusy] = useState(false);
  const [dailyReviewError, setDailyReviewError] = useState<string | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [historyFocus, setHistoryFocus] = useState<{ runId: string; nonce: number } | null>(null);
  const [relationshipRunLimit, setRelationshipRunLimit] = useState(RELATIONSHIP_PAGE_SIZE);
  const dailyReviewInFlight = useRef(false);
  const relationshipInFlight = useRef(false);
  const newTopicInFlight = useRef(false);
  const globalActiveId = useConversations((s) => s.activeId);
  const conversations = useConversations((s) => s.byId);
  const relationshipInviteDismissed = useSettings((s) => s.relationshipInviteDismissed);
  const relationshipConversationId = useSettings((s) => s.relationshipConversationId);
  const dismissRelationshipInvite = useSettings((s) => s.dismissRelationshipInvite);
  const setRelationshipConversationId = useSettings((s) => s.setRelationshipConversationId);
  const relationshipConversation = useMemo(
    () => findRelationshipConversation(conversations, relationshipConversationId),
    [conversations, relationshipConversationId],
  );
  const activeId = relationshipConversation?.id ?? null;
  const previousRelationshipId = useMemo(() => Object.values(conversations)
    .filter((conversation) => isGlobalBuddyConversation(conversation) && conversation.id !== activeId)
    .sort((left, right) => right.createdAt - left.createdAt || right.lastActivityAt - left.lastActivityAt)[0]?.id ?? null,
  [activeId, conversations]);
  const activeChapterEmpty = useConversations((state) => Boolean(
    activeId
      && (state.timelines[activeId]?.length ?? 0) === 0
      && (state.queuedTurns[activeId]?.length ?? 0) === 0
      && !state.runIds[activeId]
      && !state.pendingSends[activeId],
  ));
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const composerDrafts = useComposerDrafts((state) => state.drafts);
  const updateComposerDraft = useComposerDrafts((state) => state.updateDraft);
  const setComposerText = useComposerDrafts((state) => state.setText);
  const assignComposerConversation = useComposerDrafts((state) => state.assignConversation);
  const draftScope = resolveComposerScope(composerDrafts, activeId, HOME_WORKSPACE_ID);
  const draftScopeRef = useRef(draftScope);
  draftScopeRef.current = draftScope;
  const composerDraft = composerDrafts[draftScope] ?? EMPTY_COMPOSER_DRAFT;
  const draft = composerDraft.text;
  const createConversation = useConversations((s) => s.createConversation);
  const discardEmptyConversation = useConversations((s) => s.discardEmptyConversation);
  const conversationsApi = useConversationsApi();
  const switchActive = useConversations((s) => s.switchActive);
  const send = useConversations((s) => s.send);
  const guide = useConversations((s) => s.guide);
  const enqueueTurn = useConversations((s) => s.enqueueTurn);
  const removeQueuedTurn = useConversations((s) => s.removeQueuedTurn);
  const guideQueuedTurn = useConversations((s) => s.guideQueuedTurn);
  const renameTitle = useConversations((s) => s.renameTitle);
  const retry = useConversations((s) => s.retry);
  const dismissRetry = useConversations((s) => s.dismissRetry);
  const interrupt = useConversations((s) => s.interrupt);
  const activeRunId = useConversations((s) => activeId ? s.runIds[activeId] : null);
  const stopping = useConversations((s) => activeId ? s.stoppingById[activeId] === true : false);
  const stopLocked = useConversations((s) => activeId ? s.stopLockedById[activeId] === true : false);
  const pendingInteraction = useApprovals((s) => activeId ? s.pendingByConversation[activeId] : null);
  const retryDraft = useConversations((s) => activeId ? s.pendingSends[activeId] : undefined);
  const queuedTurns = useConversations((s) => activeId ? s.queuedTurns[activeId] : undefined);
  useEffect(() => setRelationshipRunLimit(RELATIONSHIP_PAGE_SIZE), [activeId]);
  const artifacts = useArtifacts((s) => s.entries);
  const scheduledTasks = useScheduledTasks((s) => s.tasks);
  const scheduledRuns = useScheduledTasks((s) => s.runs);
  // Model picker (轮 3 卡 F): the shell owns the subscription, InputArea renders.
  const activeMeta = useConversations((s) => (activeId ? s.byId[activeId] : undefined));
  const activeContextUsage = useContextUsage((state) => activeId ? state.byConversation[activeId] : undefined);
  const permissionMode = useSettings((s) => s.permissionMode);
  const setPermissionMode = useSettings((s) => s.setPermissionMode);
  const providerOrder = useSettings((s) => s.providerOrder);
  const defaultProviderId = useSettings((s) => s.defaultProviderId);
  const defaultModelId = useSettings((s) => s.defaultModelId);
  const setDefaultModel = useSettings((s) => s.setDefaultModel);
  const setModelForConversation = useConversations((s) => s.setModelForConversation);
  const setGoal = useConversations((s) => s.setGoal);
  const toggleGoalPaused = useConversations((s) => s.toggleGoalPaused);
  const clearGoal = useConversations((s) => s.clearGoal);
  useEffect(() => {
    if (!relationshipConversation) return;
    if (relationshipConversationId !== relationshipConversation.id) {
      setRelationshipConversationId(relationshipConversation.id);
    }
    if (globalActiveId !== relationshipConversation.id) {
      switchActive(relationshipConversation.id);
    }
  }, [globalActiveId, relationshipConversation, relationshipConversationId, setRelationshipConversationId, switchActive]);
  const rawProviderList = useProviders((s) => s.list);
  const providerList = useMemo(
    () => orderConfiguredProviders(rawProviderList, providerOrder, { providerId: defaultProviderId, modelId: defaultModelId }),
    [defaultModelId, defaultProviderId, providerOrder, rawProviderList],
  );
  const openSettings = useUi((s) => s.openSettings);
  const workspace = useWorkspace();
  const workspaceFiles = useFileTree((state) => state.roots);
  const notes = useCaptures((state) => state.notes);
  const activeWorkspaceId = useWorkspaces((state) => state.activeId);
  // Only ENABLED skills are offered — the `/` menu and the chips must not hand
  // the user a command the next conversation would reject.
  const skillList = useSkills((s) => s.list);
  const skillsDisabled = useSkills((s) => s.disabled);
  const enabledSkills = skillList.filter(
    (skill) => skill.available !== false && !skillsDisabled.includes(skill.id ?? skill.name),
  );
  const retryRecoveryRendered = useConversations((state) => Boolean(
    activeId
      && retryDraft?.errorMessage
      && (state.timelines[activeId] ?? []).some((item) => item.kind === "result"
        && item.runId === retryDraft.runId
        && item.isError
        && !item.interrupted),
  ));
  const hasMessages = useConversations((state) => Object.values(state.byId).some((conversation) => (
    isGlobalBuddyConversation(conversation)
      && (state.timelines[conversation.id]?.length ?? 0) > 0
  )));
  const interactionNeedsTranscript = Boolean(activeRunId || pendingInteraction || retryDraft?.errorMessage);
  const showTimeline = interactionNeedsTranscript || (hasMessages && historyVisible);
  const newTopicUnavailable = Boolean(
    activeRunId
      || pendingInteraction
      || queuedTurns?.length
      || composerDraft.submitPending
      || relationshipBusy
      || dailyReviewBusy
      || newTopicBusy,
  );
  const drop = useFileDrop();
  const runningTool = useConversations((state) => {
    if (!activeId || !activeRunId) return undefined;
    const activeTimeline = state.timelines[activeId] ?? [];
    for (let i = activeTimeline.length - 1; i >= 0; i--) {
      const item = activeTimeline[i];
      if (
        item.kind === "tool"
        && item.status === "running"
        && item.name !== LEEMO_ASK_USER_TOOL_NAME
      ) return item.name;
    }
    return undefined;
  });

  const ensureRelationshipConversation = useCallback(async (): Promise<string> => {
    const existing = findRelationshipConversation(conversations, relationshipConversationId);
    let conversationId = existing?.id;
    if (!conversationId) {
      conversationId = await createConversation({
        source: "buddy",
        workspaceId: HOME_WORKSPACE_ID,
        bookId: null,
        activate: false,
        durableRelationshipChapter: true,
      });
      renameTitle(conversationId, RELATIONSHIP_CONVERSATION_TITLE);
    }
    setRelationshipConversationId(conversationId);
    if (activeIdRef.current !== conversationId) switchActive(conversationId);
    return conversationId;
  }, [conversations, createConversation, relationshipConversationId, renameTitle, setRelationshipConversationId, switchActive]);

  const sendFromBuddy = async (
    text: string,
    attachments?: AttachmentRef[],
    referencedFiles?: WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => {
    setHistoryVisible(true);
    const sendingScope = draftScope;
    const conversationId = await ensureRelationshipConversation();
    assignComposerConversation(sendingScope, conversationId);
    await send(conversationId, text, attachments, referencedFiles, options);
    if (!activeIdRef.current && draftScopeRef.current === sendingScope) {
      switchActive(conversationId);
    }
  };

  const queueFromBuddy = (
    text: string,
    attachments?: AttachmentRef[],
    referencedFiles?: WorkspaceFileRef[],
    options?: ConversationTurnOptions,
  ) => {
    const conversationId = activeId ?? composerDraft.assignedConversationId;
    if (!conversationId) throw new Error("请先选择对话。");
    enqueueTurn(conversationId, text, attachments, referencedFiles, options);
  };

  const saveGoalFromBuddy = async (text: string) => {
    const goalScope = draftScope;
    const conversationId = await ensureRelationshipConversation();
    assignComposerConversation(goalScope, conversationId);
    await setGoal(conversationId, text);
    if (!activeIdRef.current && draftScopeRef.current === goalScope) switchActive(conversationId);
  };

  const startDailyReview = useCallback(async () => {
    if (dailyReviewInFlight.current) return;
    setHistoryVisible(true);
    dailyReviewInFlight.current = true;
    setDailyReviewBusy(true);
    setDailyReviewError(null);
    try {
      const now = Date.now();
      const conversationId = await ensureRelationshipConversation();
      const snapshot = conversationsApi.getState();
      if (hasDailyReviewToday(snapshot.timelines[conversationId], now) || snapshot.runIds[conversationId]) return;

      const prompt = buildDailyReviewPrompt({
        now,
        conversations: snapshot.byId,
        order: snapshot.order,
        timelines: snapshot.timelines,
        artifacts,
        scheduledTasks,
        scheduledRuns,
      });
      await send(conversationId, prompt, undefined, undefined, { displayText: "回顾今天" });
    } catch (error: unknown) {
      setDailyReviewError(error instanceof Error ? error.message : "暂时无法生成今天的回顾，请稍后重试。");
    } finally {
      dailyReviewInFlight.current = false;
      setDailyReviewBusy(false);
    }
  }, [
    artifacts,
    conversationsApi,
    ensureRelationshipConversation,
    scheduledRuns,
    scheduledTasks,
    send,
  ]);

  const startRelationshipOnboarding = useCallback(async () => {
    if (relationshipInFlight.current) return;
    setHistoryVisible(true);
    relationshipInFlight.current = true;
    setRelationshipBusy(true);
    setRelationshipError(null);
    dismissRelationshipInvite();
    try {
      const conversationId = await ensureRelationshipConversation();
      if (conversationsApi.getState().runIds[conversationId]) return;
      await send(
        conversationId,
        buildRelationshipOnboardingPrompt(),
        undefined,
        undefined,
        { displayText: RELATIONSHIP_ONBOARDING_LABEL },
      );
    } catch (error: unknown) {
      setRelationshipError(error instanceof Error ? error.message : "暂时没能开始这段对话，请再试一次。");
    } finally {
      relationshipInFlight.current = false;
      setRelationshipBusy(false);
    }
  }, [
    dismissRelationshipInvite,
    conversationsApi,
    ensureRelationshipConversation,
    send,
  ]);

  const startNewTopic = useCallback(async () => {
    if (newTopicInFlight.current || newTopicUnavailable) return;
    newTopicInFlight.current = true;
    setNewTopicBusy(true);
    setNewTopicError(null);
    const sourceDraftScope = draftScopeRef.current;
    try {
      const snapshot = conversationsApi.getState();
      const relationshipChapters = deriveRelationshipChapters({
        conversations: snapshot.byId,
        timelines: snapshot.timelines,
        activeId,
      });
      const activeChapter = relationshipChapters.find((chapter) => chapter.active);
      const conversationId = canReuseEmptyRelationshipChapter(activeChapter)
        ? activeChapter!.conversation.id
        : await createConversation({
          source: "buddy",
          workspaceId: HOME_WORKSPACE_ID,
          bookId: null,
          activate: false,
          durableRelationshipChapter: true,
          ...(activeMeta ? {
            modelSelection: {
              providerId: activeMeta.providerId,
              modelId: activeMeta.modelId,
            },
          } : {}),
        });
      assignComposerConversation(sourceDraftScope, conversationId);
      setRelationshipConversationId(conversationId);
      switchActive(conversationId);
      setHistoryVisible(true);
      setHistoryFocus(null);
    } catch (error: unknown) {
      setNewTopicError(error instanceof Error ? error.message : "暂时无法准备新话题，请稍后再试。");
    } finally {
      newTopicInFlight.current = false;
      setNewTopicBusy(false);
    }
  }, [
    activeId,
    activeMeta,
    assignComposerConversation,
    createConversation,
    pendingInteraction,
    conversationsApi,
    newTopicUnavailable,
    setRelationshipConversationId,
    switchActive,
  ]);

  const undoNewTopic = useCallback(async () => {
    if (
      newTopicInFlight.current
      || !activeId
      || !previousRelationshipId
      || !activeChapterEmpty
    ) return;
    newTopicInFlight.current = true;
    setNewTopicBusy(true);
    setNewTopicError(null);
    const sourceDraftScope = draftScopeRef.current;
    try {
      const discarded = await discardEmptyConversation(activeId);
      if (!discarded) throw new Error("这个新话题已经有内容，无法撤销章节边界。");
      assignComposerConversation(sourceDraftScope, previousRelationshipId);
      setRelationshipConversationId(previousRelationshipId);
      switchActive(previousRelationshipId);
      setHistoryVisible(true);
      setHistoryFocus(null);
    } catch (error: unknown) {
      setNewTopicError(error instanceof Error ? error.message : "暂时无法撤销新话题，请稍后重试。");
    } finally {
      newTopicInFlight.current = false;
      setNewTopicBusy(false);
    }
  }, [
    activeChapterEmpty,
    activeId,
    assignComposerConversation,
    discardEmptyConversation,
    previousRelationshipId,
    setRelationshipConversationId,
    switchActive,
  ]);

  const dismissRetryAndRelease = () => {
    if (!activeId) return;
    for (const attachment of retryDraft?.attachments ?? []) {
      if (workspace?.releaseClipboardImage) {
        void workspace.releaseClipboardImage(attachment.path).catch(() => {});
      }
    }
    dismissRetry(activeId);
  };

  return (
    <div
      className="leemo-buddy-shell flex h-screen flex-col overflow-hidden bg-[var(--leemo-bg)]"
      data-shell="buddy"
      style={{ overflow: "clip" }}
      onDragOver={(e) => {
        if (drop.enabled && isFileDataTransfer(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={(e) => {
        // 06 §2.2: 拖到搭子态 → momo 判断归属 + 一句话确认.
        if (!drop.enabled) return;
        if (drop.handleDrop(e.dataTransfer.files)) e.preventDefault();
      }}
    >
      <TopBar
        onOpenHistory={() => setDrawer(true)}
        onDailyReview={() => { void startDailyReview(); }}
        dailyReviewBusy={dailyReviewBusy}
        onStartRelationship={() => { void startRelationshipOnboarding(); }}
        relationshipBusy={relationshipBusy}
        onStartNewTopic={() => { void startNewTopic(); }}
        newTopicDisabled={newTopicUnavailable}
      />
      <main className="leemo-buddy-main relative z-10 flex min-h-0 flex-1 flex-col px-4 sm:px-6">
        {dailyReviewError && (
          <div
            role="alert"
            className="mx-auto mt-3 max-w-[720px] rounded-md border border-[var(--leemo-danger)]/20 bg-[var(--leemo-card)] px-3 py-2 text-[12.5px] text-[var(--leemo-danger)]"
          >
            {dailyReviewError}
          </div>
        )}
        {relationshipError && (
          <div
            role="alert"
            className="mx-auto mt-3 max-w-[720px] rounded-md border border-[var(--leemo-danger)]/20 bg-[var(--leemo-card)] px-3 py-2 text-[12.5px] text-[var(--leemo-danger)]"
          >
            {relationshipError}
          </div>
        )}
        {newTopicError && (
          <div
            role="alert"
            className="mx-auto mt-3 max-w-[720px] rounded-md border border-[var(--leemo-danger)]/20 bg-[var(--leemo-card)] px-3 py-2 text-[12.5px] text-[var(--leemo-danger)]"
          >
            {newTopicError}
          </div>
        )}
        {showTimeline ? (
          // Timeline is a bounded flex child (flex-1 min-h-0) so it scrolls
          // internally and never shoves the input area out of the viewport.
          // It centers to 720px on its own — no extra wrapper. Approval AND
          // question cards render inline inside it now (TurnBlock), next to
          // the step that raised them: nothing is pinned above the input
          // anymore — a pinned copy on top of the inline one is exactly the
          // "same card twice" duplicate-render bug this round fixed.
          <BuddyRelationshipTimeline
            activeId={activeId}
            activeRunId={activeRunId}
            historyFocus={historyFocus}
            runLimit={relationshipRunLimit}
            onLoadOlder={() => setRelationshipRunLimit((count) => count + RELATIONSHIP_PAGE_SIZE)}
          />
        ) : (
          <section
            className="leemo-buddy-landing"
            data-testid="buddy-landing"
            aria-labelledby="buddy-greeting"
          >
            <Clock className="leemo-buddy-clock leemo-rise" />
            <div className="leemo-buddy-intro leemo-rise">
              <MomoAvatar size={42} />
              <h1 id="buddy-greeting" data-testid="buddy-greeting">
                {buildGreeting(new Date().getHours())}
              </h1>
            </div>
            {hasMessages && (
              <div className="leemo-buddy-landing-actions leemo-rise">
                <button
                  type="button"
                  className="leemo-buddy-continue"
                  onClick={() => setHistoryVisible(true)}
                >
                  继续上次聊天
                </button>
                <button
                  type="button"
                  className="leemo-buddy-new-topic"
                  disabled={newTopicUnavailable}
                  onClick={() => { void startNewTopic(); }}
                >
                  新话题
                </button>
              </div>
            )}
          </section>
        )}
        {showTimeline && activeChapterEmpty && previousRelationshipId && (
          <div className="leemo-buddy-topic-boundary" data-testid="buddy-topic-boundary">
            <span aria-hidden />
            <p>新话题从这里开始</p>
            <button
              type="button"
              aria-label="撤销新话题"
              disabled={newTopicBusy}
              onClick={() => { void undoNewTopic(); }}
            >
              {newTopicBusy ? "正在撤销…" : "撤销"}
            </button>
            <span aria-hidden />
          </div>
        )}
        <div className="leemo-buddy-composer-dock mt-auto shrink-0" data-testid="buddy-composer-dock">
          <div className="leemo-buddy-composer-track mx-auto w-full px-1 sm:px-6">
            {drop.pending && (
              <DropClassifyBar drop={drop.pending} onConfirm={drop.confirm} onCancel={drop.cancel} />
            )}
            <PinnedPlan />
            {runningTool && (
              <div className="px-1 pb-1">
                <LiveStatusBar toolName={runningTool} />
              </div>
            )}
            {!showTimeline && (
              <>
                {!relationshipInviteDismissed && !relationshipConversation && (
                  <section className="leemo-buddy-relationship-invite" data-testid="buddy-relationship-invite">
                    <MomoAvatar size={28} />
                    <div className="min-w-0">
                      <p className="leemo-buddy-invite-title">想让我更懂你一点？</p>
                      <p className="leemo-buddy-invite-copy">聊聊最近的状态，以及你喜欢的相处和配合方式。</p>
                    </div>
                    <div className="leemo-buddy-invite-actions">
                      <button
                        type="button"
                        disabled={relationshipBusy}
                        onClick={() => { void startRelationshipOnboarding(); }}
                        className="leemo-buddy-invite-primary disabled:cursor-wait disabled:opacity-45"
                      >
                        现在聊聊
                      </button>
                      <button
                        type="button"
                        aria-label="稍后再说"
                        onClick={dismissRelationshipInvite}
                        className="leemo-buddy-invite-secondary"
                      >
                        稍后再说
                      </button>
                    </div>
                  </section>
                )}
                <div className="leemo-buddy-scene-hints" role="group" aria-label="你可以这样开始">
                  <ChipRow
                    onPick={(next) => setComposerText(draftScope, next)}
                    disabled={composerDraft.submitPending}
                  />
                </div>
              </>
            )}
            <InputArea surface="buddy" conversationId={activeId} value={draft}
              onChange={(next) => setComposerText(draftScope, next)} onSend={sendFromBuddy}
              onQueue={queueFromBuddy}
              notes={notes}
              onGuide={(text) => activeId ? guide(activeId, text) : Promise.reject(new Error("请先选择对话。"))}
              queuedTurns={queuedTurns}
              onEditQueuedTurn={(queuedTurnId) => { if (activeId) removeQueuedTurn(activeId, queuedTurnId); }}
              onDeleteQueuedTurn={(queuedTurnId) => { if (activeId) removeQueuedTurn(activeId, queuedTurnId); }}
              onGuideQueuedTurn={(queuedTurnId) => activeId
                ? guideQueuedTurn(activeId, queuedTurnId)
                : Promise.reject(new Error("请先选择对话。"))}
              goal={activeMeta?.goal}
              onSaveGoal={saveGoalFromBuddy}
              onToggleGoalPaused={() => activeId ? toggleGoalPaused(activeId) : undefined}
              onDeleteGoal={() => activeId ? clearGoal(activeId) : undefined}
              draftScope={draftScope}
              draftState={composerDraft}
              onDraftStateChange={(update) => updateComposerDraft(draftScope, update)}
              retryDraft={retryDraft}
              retryRecoveryRendered={retryRecoveryRendered}
              onRetry={() => activeId ? retry(activeId) : undefined}
              onDismissRetry={dismissRetryAndRelease}
              busy={activeRunId !== null}
              stopping={stopping}
              stopLocked={stopLocked}
              onStop={() => { if (activeId) void interrupt(activeId); }}
              resolveFilePath={workspace ? (file) => workspace.pathForFile(file) : undefined}
              stageClipboardImage={workspace?.stageClipboardImage
                ? () => workspace.stageClipboardImage!()
                : undefined}
              releaseClipboardImage={workspace?.releaseClipboardImage
                ? (path) => workspace.releaseClipboardImage!(path)
                : undefined}
              skills={enabledSkills}
              workspaceFiles={activeWorkspaceId === HOME_WORKSPACE_ID ? workspaceFiles : []}
              workspaceId={HOME_WORKSPACE_ID}
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
              }} />
          </div>
        </div>
      </main>
      <HistoryDrawer
        open={drawer}
        relationshipId={activeId}
        onClose={() => setDrawer(false)}
        onPickChapter={(conversationId) => {
          const snapshot = conversationsApi.getState();
          const target = (snapshot.timelines[conversationId] ?? []).find((item) => (
            item.kind !== "compact" && typeof item.runId === "string" && item.runId.length > 0
          ));
          if (!target || target.kind === "compact") return;
          const relationshipChapters = deriveRelationshipChapters({
            conversations: snapshot.byId,
            timelines: snapshot.timelines,
            activeId,
          });
          const requiredRuns = relationshipRunCountFromEnd(relationshipChapters, target.runId);
          if (requiredRuns !== undefined) {
            setRelationshipRunLimit((count) => Math.max(count, requiredRuns));
          }
          setHistoryVisible(true);
          setHistoryFocus({ runId: target.runId, nonce: Date.now() });
        }}
      />
    </div>
  );
}
