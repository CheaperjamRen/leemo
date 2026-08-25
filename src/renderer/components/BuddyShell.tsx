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
import { useArtifacts, useCaptures, useComposerDrafts, useContextUsage, useConversations, useScheduledTasks, useSettings, useSkills, useProviders, useUi, useWorkspace, useFileTree, useWorkspaces } from "../bridge/context";
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
import { buildGreeting } from "../stores/settings";
import Clock from "./Clock";
import MomoAvatar from "./momo/MomoAvatar";
import "./BuddyShell.css";

export default function BuddyShell() {
  const [drawer, setDrawer] = useState(false);
  const [dailyReviewBusy, setDailyReviewBusy] = useState(false);
  const [dailyReviewError, setDailyReviewError] = useState<string | null>(null);
  const [relationshipBusy, setRelationshipBusy] = useState(false);
  const [relationshipError, setRelationshipError] = useState<string | null>(null);
  const [historyFocus, setHistoryFocus] = useState<{ runId: string; nonce: number } | null>(null);
  const dailyReviewInFlight = useRef(false);
  const relationshipInFlight = useRef(false);
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
  const retryDraft = useConversations((s) => activeId ? s.pendingSends[activeId] : undefined);
  const queuedTurns = useConversations((s) => activeId ? s.queuedTurns[activeId] : undefined);
  const conversationOrder = useConversations((s) => s.order);
  const timelines = useConversations((s) => s.timelines);
  const runIds = useConversations((s) => s.runIds);
  const relationshipChapters = useMemo(() => Object.values(conversations)
    .filter(isGlobalBuddyConversation)
    .sort((left, right) => {
      if (left.id === activeId) return 1;
      if (right.id === activeId) return -1;
      return left.createdAt - right.createdAt || left.lastActivityAt - right.lastActivityAt;
    }), [activeId, conversations]);
  const relationshipTimeline = useMemo(
    () => relationshipChapters.flatMap((conversation) => timelines[conversation.id] ?? []),
    [relationshipChapters, timelines],
  );
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
  const messages = relationshipTimeline;
  const retryRecoveryRendered = Boolean(
    retryDraft?.errorMessage
      && messages.some((item) => item.kind === "result"
        && item.runId === retryDraft.runId
        && item.isError
        && !item.interrupted),
  );
  const hasMessages = messages.length > 0;
  const drop = useFileDrop();
  const runningTool = (() => {
    if (!activeRunId) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const item = messages[i];
      if (item.kind === "tool" && item.status === "running") return item.name;
    }
    return undefined;
  })();

  const ensureRelationshipConversation = useCallback(async (): Promise<string> => {
    const existing = findRelationshipConversation(conversations, relationshipConversationId);
    let conversationId = existing?.id;
    if (!conversationId) {
      conversationId = await createConversation({
        source: "buddy",
        workspaceId: HOME_WORKSPACE_ID,
        bookId: null,
        activate: false,
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
    dailyReviewInFlight.current = true;
    setDailyReviewBusy(true);
    setDailyReviewError(null);
    try {
      const now = Date.now();
      const conversationId = await ensureRelationshipConversation();
      if (hasDailyReviewToday(timelines[conversationId], now) || runIds[conversationId]) return;

      const prompt = buildDailyReviewPrompt({
        now,
        conversations,
        order: conversationOrder,
        timelines,
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
    conversationOrder,
    conversations,
    ensureRelationshipConversation,
    scheduledRuns,
    scheduledTasks,
    send,
    timelines,
    runIds,
  ]);

  const startRelationshipOnboarding = useCallback(async () => {
    if (relationshipInFlight.current) return;
    relationshipInFlight.current = true;
    setRelationshipBusy(true);
    setRelationshipError(null);
    dismissRelationshipInvite();
    try {
      const conversationId = await ensureRelationshipConversation();
      if (runIds[conversationId]) return;
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
    ensureRelationshipConversation,
    runIds,
    send,
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
        {hasMessages ? (
          // Timeline is a bounded flex child (flex-1 min-h-0) so it scrolls
          // internally and never shoves the input area out of the viewport.
          // It centers to 720px on its own — no extra wrapper. Approval AND
          // question cards render inline inside it now (TurnBlock), next to
          // the step that raised them: nothing is pinned above the input
          // anymore — a pinned copy on top of the inline one is exactly the
          // "same card twice" duplicate-render bug this round fixed.
          <Timeline
            items={relationshipTimeline}
            activeConversationId={activeId}
            activeRunId={activeRunId}
            pageKey={`buddy-relationship:${activeId ?? "empty"}`}
            pageSize={40}
            focusRequest={historyFocus}
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
          </section>
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
            {!hasMessages && (
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
              busy={activeRunId !== null} onStop={() => { if (activeId) void interrupt(activeId); }}
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
          const target = (timelines[conversationId] ?? []).find((item) => (
            item.kind !== "compact" && typeof item.runId === "string" && item.runId.length > 0
          ));
          if (!target || target.kind === "compact") return;
          setHistoryFocus({ runId: target.runId, nonce: Date.now() });
        }}
      />
    </div>
  );
}
