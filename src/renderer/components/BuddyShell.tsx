import { useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./TopBar";
import Greeting from "./Greeting";
import ChipRow from "./ChipRow";
import InputArea from "./InputArea";
import PinnedPlan from "./PinnedPlan";
import HistoryDrawer from "./HistoryDrawer";
import Timeline from "./timeline/Timeline";
import LiveStatusBar from "./timeline/LiveStatusBar";
import DropClassifyBar from "./DropClassifyBar";
import { isFileDataTransfer, useFileDrop } from "./useFileDrop";
import { useComposerDrafts, useConversations, useSettings, useSkills, useProviders, useUi, useWorkspace, useFileTree, useWorkspaces } from "../bridge/context";
import type { AttachmentRef, WorkspaceFileRef } from "../../bridge/contract";
import { orderConfiguredProviders } from "./model-picker";
import {
  EMPTY_COMPOSER_DRAFT,
  resolveComposerScope,
} from "../stores/composer-drafts";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";

export default function BuddyShell() {
  const [drawer, setDrawer] = useState(false);
  const globalActiveId = useConversations((s) => s.activeId);
  const conversations = useConversations((s) => s.byId);
  const activateScope = useConversations((s) => s.activateScope);
  const activeId = globalActiveId
    && (conversations[globalActiveId]?.workspaceId ?? HOME_WORKSPACE_ID) === HOME_WORKSPACE_ID
    && conversations[globalActiveId]?.bookId === null
    ? globalActiveId
    : null;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  useEffect(() => {
    if (globalActiveId !== activeId) activateScope(HOME_WORKSPACE_ID, null);
  }, [activateScope, activeId, globalActiveId]);
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
  const retry = useConversations((s) => s.retry);
  const dismissRetry = useConversations((s) => s.dismissRetry);
  const interrupt = useConversations((s) => s.interrupt);
  const timeline = useConversations((s) => activeId ? s.timelines[activeId] : undefined);
  const activeRunId = useConversations((s) => activeId ? s.runIds[activeId] : null);
  const retryDraft = useConversations((s) => activeId ? s.pendingSends[activeId] : undefined);
  // Model picker (轮 3 卡 F): the shell owns the subscription, InputArea renders.
  const activeMeta = useConversations((s) => (activeId ? s.byId[activeId] : undefined));
  const permissionMode = useSettings((s) => s.permissionMode);
  const setPermissionMode = useSettings((s) => s.setPermissionMode);
  const providerOrder = useSettings((s) => s.providerOrder);
  const defaultProviderId = useSettings((s) => s.defaultProviderId);
  const defaultModelId = useSettings((s) => s.defaultModelId);
  const setModelForConversation = useConversations((s) => s.setModelForConversation);
  const rawProviderList = useProviders((s) => s.list);
  const providerList = useMemo(
    () => orderConfiguredProviders(rawProviderList, providerOrder, { providerId: defaultProviderId, modelId: defaultModelId }),
    [defaultModelId, defaultProviderId, providerOrder, rawProviderList],
  );
  const openSettings = useUi((s) => s.openSettings);
  const workspace = useWorkspace();
  const workspaceFiles = useFileTree((state) => state.roots);
  const activeWorkspaceId = useWorkspaces((state) => state.activeId);
  // Only ENABLED skills are offered — the `/` menu and the chips must not hand
  // the user a command the next conversation would reject.
  const skillList = useSkills((s) => s.list);
  const skillsDisabled = useSkills((s) => s.disabled);
  const enabledSkills = skillList.filter(
    (skill) => skill.available !== false && !skillsDisabled.includes(skill.id ?? skill.name),
  );
  const messages = timeline ?? [];
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

  const sendFromBuddy = async (
    text: string,
    attachments?: AttachmentRef[],
    referencedFiles?: WorkspaceFileRef[],
  ) => {
    const sendingScope = draftScope;
    let conversationId = activeId ?? composerDraft.assignedConversationId;
    if (!conversationId) {
      conversationId = await createConversation({
        source: "buddy",
        workspaceId: HOME_WORKSPACE_ID,
        bookId: null,
        activate: false,
      });
      assignComposerConversation(sendingScope, conversationId);
    }
    await send(conversationId, text, attachments, referencedFiles);
    if (!activeIdRef.current && draftScopeRef.current === sendingScope) {
      switchActive(conversationId);
    }
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

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-[var(--leemo-bg)]"
      onDragOver={(e) => {
        if (drop.enabled && isFileDataTransfer(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={(e) => {
        // 06 §2.2: 拖到搭子态 → momo 判断归属 + 一句话确认.
        if (!drop.enabled) return;
        if (drop.handleDrop(e.dataTransfer.files)) e.preventDefault();
      }}
    >
      <TopBar onOpenHistory={() => setDrawer(true)} />
      <main className="relative z-10 flex min-h-0 flex-1 flex-col px-4 pt-14 sm:px-6">
        {hasMessages ? (
          // Timeline is a bounded flex child (flex-1 min-h-0) so it scrolls
          // internally and never shoves the input area out of the viewport.
          // It centers to 720px on its own — no extra wrapper. Approval AND
          // question cards render inline inside it now (TurnBlock), next to
          // the step that raised them: nothing is pinned above the input
          // anymore — a pinned copy on top of the inline one is exactly the
          // "same card twice" duplicate-render bug this round fixed.
          <Timeline />
        ) : (
          <Greeting hour={new Date().getHours()} />
        )}
        <div className="mt-auto shrink-0 pb-5 pt-2 sm:pb-7">
          <div className="mx-auto w-full max-w-[720px] px-1 sm:px-6">
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
              <ChipRow
                onPick={(next) => setComposerText(draftScope, next)}
                skills={enabledSkills}
                disabled={composerDraft.submitPending}
              />
            )}
            <InputArea conversationId={activeId} value={draft}
              onChange={(next) => setComposerText(draftScope, next)} onSend={sendFromBuddy}
              draftScope={draftScope}
              draftState={composerDraft}
              onDraftStateChange={(update) => updateComposerDraft(draftScope, update)}
              retryDraft={retryDraft}
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
              currentProviderId={activeMeta?.providerId ?? null}
              currentModelId={activeMeta?.modelId ?? null}
              permissionMode={permissionMode}
              onOpenSettings={() => openSettings("models")}
              onOpenPermissionSettings={() => openSettings("permissions")}
              onDisableFullAccess={() => setPermissionMode("acceptEdits")}
              onSelectModel={(providerId, modelId) => {
                if (activeId) void setModelForConversation(activeId, providerId, modelId);
              }} />
          </div>
        </div>
      </main>
      <HistoryDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}
