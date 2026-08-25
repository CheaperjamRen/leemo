import type { StoreApi } from "zustand/vanilla";
import type { BridgeClient } from "./client";
import type { ConversationsState } from "../stores/conversations";
import { foldConversationEnvelope } from "../stores/conversations";
import type { ApprovalsState } from "../stores/approvals";
import type { WikiState } from "../stores/wiki-entries";
import type { ArtifactsState } from "../stores/artifacts";
import { deriveArtifact, findArtifactTool } from "../stores/artifacts";
import type { NotebooksState } from "../stores/notebooks";
import type { WorkspacesState } from "../stores/workspaces";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import type { PreviewContentState } from "../stores/preview-content";
import { previewDraftKey } from "../stores/preview-content";
import type { FileTreeState } from "../stores/file-tree";
import type { NotificationsState } from "../stores/notifications";
import type { ContextUsageState } from "../stores/context-usage";
import { foldContextUsage } from "../stores/context-usage";
import type { BridgeEventEnvelope, ApprovalExpired, ApprovalRequest, AskUserPayload } from "../../bridge/contract";

export interface BridgeStores {
  conversations: StoreApi<ConversationsState>;
  approvals: StoreApi<ApprovalsState>;
  wikiEntries: StoreApi<WikiState>;
  /** 轮 4「成果页通电」: `registerArtifact` 存在已久，但生产代码从来没调用过 ——
   *  成果页因此永远是空的。这里是它唯一的接线点。Optional 是为了那些只关心对话
   *  流的既有测试不必全部改签名。 */
  artifacts?: StoreApi<ArtifactsState>;
  /** 只读 `list`：`deriveArtifact` 用本子 id 判断产物归属（bookForPath 拿路径第一段
   *  跟它比）。没有它产物照样登记，只是全部落在"未分类"。 */
  notebooks?: StoreApi<NotebooksState>;
  /** Approved display roots are used only to normalize tool output paths. */
  workspaces?: StoreApi<WorkspacesState>;
  /** Refresh an already-open preview after momo changes its backing file. */
  previewContent?: StoreApi<PreviewContentState>;
  /** Keep the visible workspace tree aligned with successful file changes. */
  fileTree?: StoreApi<FileTreeState>;
  /** Shared history + toast sink for work that finishes outside the visible
   * conversation. Optional for isolated bridge tests and lightweight embeds. */
  notifications?: StoreApi<NotificationsState>;
  /** Real current prompt size for the composer meter. Optional for legacy
   * isolated tests; BridgeProvider always supplies it. */
  contextUsage?: StoreApi<ContextUsageState>;
}

/**
 * Unified Bridge subscription wiring (Batch 0c).
 *
 * Establishes four subscriptions:
 * - bridge:event → route by conversationId (main → conversations, wiki shadow → wikiEntries)
 * - bridge:approvalRequest → fold to approvals with runId lookup
 * - bridge:approvalExpired → settle an unanswered permission card
 * - bridge:askUser → fold to approvals with runId lookup
 *
 * Returns aggregate unsubscribe function for cleanup.
 */
export function wireBridgeSubscriptions(
  client: BridgeClient,
  stores: BridgeStores,
): () => void {
  const {
    conversations,
    approvals,
    wikiEntries,
    artifacts,
    notebooks,
    workspaces,
    previewContent,
    fileTree,
    notifications,
    contextUsage,
  } = stores;

  function conversationLabel(conversationId: string): string {
    const title = conversations.getState().byId[conversationId]?.title?.trim();
    return title || "后台任务";
  }

  function isBackgroundConversation(conversationId: string): boolean {
    const state = conversations.getState();
    return Boolean(state.byId[conversationId]) && state.activeId !== conversationId;
  }

  function refreshChangedFile(
    conversationId: string,
    workspacePath: string,
    change: "added" | "modified" | "deleted",
  ): void {
    const conversation = conversations.getState().byId[conversationId];
    if (!conversation) return;
    const conversationWorkspaceId = conversation.workspaceId ?? HOME_WORKSPACE_ID;
    const activeWorkspaceId = workspaces?.getState().activeId ?? HOME_WORKSPACE_ID;
    if (conversationWorkspaceId !== activeWorkspaceId) return;

    const previewState = previewContent?.getState();
    const draftKey = previewDraftKey(conversationWorkspaceId, workspacePath);
    const draft = previewState?.drafts?.[draftKey];
    if (change === "deleted" && draft && draft.status !== "clean") {
      previewContent?.setState((state) => {
        const current = state.drafts[draftKey];
        if (!current) return state;
        return {
          drafts: {
            ...state.drafts,
            [draftKey]: {
              ...current,
              status: "error",
              error: "原文件已被删除；你的未保存草稿仍保留在这里。请复制内容或另存后再关闭。",
            },
          },
        };
      });
    } else if (previewState && Object.prototype.hasOwnProperty.call(previewState.byPath, workspacePath)) {
      void previewState.load(workspacePath, { force: true });
    }
    void fileTree?.getState().refresh();
  }

  /**
   * 轮 4「成果页通电」: 一次工具调用收尾时，看它是不是产出了一份成果。
   *
   * 为什么在 fold **之后** 才做：`tool.finished` 事件本身只带
   * `{ toolUseId, isError, contentSummary }` —— 没有工具名、没有 input，而
   * `deriveArtifact` 两样都要（判 Write/Edit/可视化，取 file_path）。那两样在
   * `tool.started` 里，已经被 message-model 折进 timeline 的同一条 tool item。
   * 所以正确的取法是折完之后按 toolUseId 回查那条 item，而不是另存一份影子表。
   */
  function registerArtifactFor(conversationId: string, toolUseId: string): void {
    if (!artifacts) return;
    const convState = conversations.getState();
    const item = findArtifactTool(convState.timelines[conversationId] ?? [], toolUseId);
    if (!item) return;
    const conversation = convState.byId[conversationId];
    const workspaceId = conversation?.workspaceId;
    const effectiveWorkspaceId = workspaceId ?? HOME_WORKSPACE_ID;
    const isExternal = effectiveWorkspaceId !== HOME_WORKSPACE_ID;
    const workspaceRoot = isExternal
      ? workspaces?.getState().list.find((entry) => entry.id === effectiveWorkspaceId)?.displayPath
      : notebooks?.getState().root;

    const entry = deriveArtifact(item, {
      conversationId,
      // 这一轮的 runId 已经被 fold 记在 item 上；用它而不是 store 里的当前值 ——
      // run 结束时 runIds 会被清成 null，而成果要能说清是哪一轮产的。
      runId: item.runId,
      books: isExternal ? [] : notebooks?.getState().list ?? [],
      now: Date.now(),
      // 工作区根目录用来把模型写出的绝对路径折回相对路径；拿不到就一律记成
      // escaped（"工作区外"角标），这比假装它在本子里要诚实。
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(conversation ? { bookId: conversation.bookId } : {}),
    });
    if (entry) artifacts.getState().registerArtifact(entry);
  }

  // bridge:event subscription - route by conversationId
  const unsubEvent = client.subscribe("bridge:event", (envelope: BridgeEventEnvelope) => {
    const { conversationId, event } = envelope;

    // Check if this is a wiki shadow conversation
    const wikiState = wikiEntries.getState();
    const isWikiShadow = wikiState.active?.shadowConversationId === conversationId;

    if (isWikiShadow) {
      // Route to wikiEntries.receiveEvent
      wikiState.receiveEvent(conversationId, event);
    } else {
      // Route to conversations (main dialogue)
      const convState = conversations.getState();
      if (!convState.byId[conversationId]) {
        // Unknown conversationId - safely discard
        return;
      }

      conversations.setState((state) =>
        foldConversationEnvelope(state, envelope, Date.now())
      );
      if (event.type === "context.snapshot" || event.type === "compact.boundary") {
        contextUsage?.setState((state) => foldContextUsage(state, event, conversationId));
      }

      // 成果登记只对主对话做。小 wiki 是独立轻 session（02 §九「不进主对话历史」），
      // 它那一轮里万一有工具写文件，也不该出现在成果架上。
      if (event.type === "tool.finished" && !event.isError) {
        registerArtifactFor(conversationId, event.toolUseId);
      }
      if (event.type === "file.changed") {
        refreshChangedFile(conversationId, event.workspacePath ?? event.path, event.change);
      }
    }

    // Terminal error/interruption: cancel approvals
    if (event.type === "run.finished") {
      if (event.subtype === "interrupted" || event.isError) {
        const approvalsState = approvals.getState();
        approvalsState.cancelForConversation(conversationId);
      }
      if (
        !isWikiShadow
        && event.subtype !== "interrupted"
        && isBackgroundConversation(conversationId)
      ) {
        notifications?.getState().push({
          text: event.isError
            ? `「${conversationLabel(conversationId)}」没有完成`
            : `「${conversationLabel(conversationId)}」已完成`,
          kind: event.isError ? "generic" : "task-done",
          conversationId,
        });
      }
      // The fold above clears this conversation's run id synchronously. Queue
      // dispatch lives in the store so it keeps working when another
      // conversation is visible; the subscription only supplies the terminal
      // signal. A rejected pre-ack send remains at the queue head for recovery.
      if (!isWikiShadow && !event.isError && event.subtype === "success") {
        const flushQueuedTurns = conversations.getState().flushQueuedTurns;
        if (flushQueuedTurns) void flushQueuedTurns(conversationId);
      }
    }
  });

  // bridge:approvalRequest subscription
  const unsubApproval = client.subscribe("bridge:approvalRequest", (request: ApprovalRequest) => {
    const { conversationId } = request;
    const convState = conversations.getState();
    const runId = convState.runIds[conversationId] ?? null;

    if (!runId) return; // No active run to attach to

    approvals.setState((state) => {
      const pending: ApprovalsState["pendingByConversation"][string] = {
        kind: "approval",
        id: request.id,
        conversationId: request.conversationId,
        runId,
        toolName: request.toolName,
        inputSummary: request.inputSummary,
        risk: request.risk,
        taskScope: request.taskScope,
        toolUseId: request.toolUseId,
        receivedAt: Date.now(),
      };

      return {
        ...state,
        pendingByConversation: {
          ...state.pendingByConversation,
          [conversationId]: pending,
        },
      };
    });
    if (isBackgroundConversation(conversationId)) {
      notifications?.getState().push({
        text: `「${conversationLabel(conversationId)}」需要你确认`,
        kind: "approval-needed",
        conversationId,
      });
    }
  });

  const unsubApprovalExpired = client.subscribe("bridge:approvalExpired", (payload: ApprovalExpired) => {
    approvals.getState().expire(payload.id);
  });

  // bridge:askUser subscription
  const unsubAskUser = client.subscribe("bridge:askUser", (payload: AskUserPayload) => {
    const { conversationId } = payload;
    const convState = conversations.getState();
    const runId = convState.runIds[conversationId] ?? null;

    if (!runId) return; // No active run to attach to

    approvals.setState((state) => {
      const question: ApprovalsState["pendingByConversation"][string] = {
        kind: "question",
        id: payload.id,
        conversationId: payload.conversationId,
        runId,
        questions: payload.questions,
        receivedAt: Date.now(),
      };

      return {
        ...state,
        pendingByConversation: {
          ...state.pendingByConversation,
          [conversationId]: question,
        },
      };
    });
    if (isBackgroundConversation(conversationId)) {
      notifications?.getState().push({
        text: `「${conversationLabel(conversationId)}」在等你回答`,
        kind: "approval-needed",
        conversationId,
      });
    }
  });

  // Return aggregate unsubscribe
  return () => {
    unsubEvent();
    unsubApproval();
    unsubApprovalExpired();
    unsubAskUser();
  };
}
