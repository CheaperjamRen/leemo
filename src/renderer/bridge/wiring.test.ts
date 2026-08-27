import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { wireBridgeSubscriptions } from "./wiring";
import type { BridgeClient } from "./client";
import type { ConversationsState } from "../stores/conversations";
import { createConversationsStore } from "../stores/conversations";
import type { ApprovalsState } from "../stores/approvals";
import type { WikiState } from "../stores/wiki-entries";
import type { ArtifactsState } from "../stores/artifacts";
import {
  createArtifactsStore,
  LEEMO_DOCUMENT_CREATE_TOOL_NAMES,
  LEEMO_VISUALIZATION_TOOL_NAME,
} from "../stores/artifacts";
import type { NotebooksState } from "../stores/notebooks";
import { createNotebooksStore } from "../stores/notebooks";
import { previewDraftKey } from "../stores/preview-content";
import { createNotificationsStore } from "../stores/notifications";
import { createContextUsageStore } from "../stores/context-usage";
import { deriveContextUsageFromTimelines } from "../stores/context-usage";
import type { BridgeEventEnvelope, ApprovalExpired, ApprovalRequest, AskUserPayload } from "../../bridge/contract";
import { normalizeSdkStream } from "../../bridge/events";

describe("wireBridgeSubscriptions", () => {
  let mockClient: BridgeClient;
  let conversationsStore: StoreApi<ConversationsState>;
  let approvalsStore: StoreApi<ApprovalsState>;
  let wikiEntriesStore: StoreApi<WikiState>;
  let cancelForConversation: ReturnType<typeof vi.fn>;
  let expire: ReturnType<typeof vi.fn>;

  let eventSubscriber: ((envelope: BridgeEventEnvelope) => void) | null = null;
  let approvalSubscriber: ((request: ApprovalRequest) => void) | null = null;
  let approvalExpiredSubscriber: ((payload: ApprovalExpired) => void) | null = null;
  let askUserSubscriber: ((payload: AskUserPayload) => void) | null = null;

  beforeEach(() => {
    eventSubscriber = null;
    approvalSubscriber = null;
    approvalExpiredSubscriber = null;
    askUserSubscriber = null;
    cancelForConversation = vi.fn();
    expire = vi.fn();

    mockClient = {
      subscribe: vi.fn((channel, callback) => {
        if (channel === "bridge:event") eventSubscriber = callback as any;
        if (channel === "bridge:approvalRequest") approvalSubscriber = callback as any;
        if (channel === "bridge:approvalExpired") approvalExpiredSubscriber = callback as any;
        if (channel === "bridge:askUser") askUserSubscriber = callback as any;
        return vi.fn();
      }),
      invoke: vi.fn(),
    } as any;

    conversationsStore = {
      getState: vi.fn(() => ({
        byId: {
          "c1": { id: "c1", title: "后台整理" },
          "c2": { id: "c2", title: "当前对话" },
        },
        activeId: "c2",
        runIds: { "c1": "run-1", "c2": null },
        timelines: { "c1": [], "c2": [] },
      })),
      setState: vi.fn(),
    } as any;

    approvalsStore = {
      getState: vi.fn(() => ({
        pendingByConversation: {},
        resolvedByRun: {},
        cancelForConversation,
        expire,
      })),
      setState: vi.fn(),
    } as any;

    wikiEntriesStore = {
      getState: vi.fn(() => ({ entries: [], active: null, receiveEvent: vi.fn() })),
      setState: vi.fn(),
    } as any;
  });

  it("subscribes to all four channels", () => {
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    expect(mockClient.subscribe).toHaveBeenCalledWith("bridge:event", expect.any(Function));
    expect(mockClient.subscribe).toHaveBeenCalledWith("bridge:approvalRequest", expect.any(Function));
    expect(mockClient.subscribe).toHaveBeenCalledWith("bridge:approvalExpired", expect.any(Function));
    expect(mockClient.subscribe).toHaveBeenCalledWith("bridge:askUser", expect.any(Function));
  });

  it("routes main conversation events to conversations store", async () => {
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    const envelope: BridgeEventEnvelope = {
      conversationId: "c1",
      event: { type: "text.delta", text: "hello" },
    };

    eventSubscriber!(envelope);

    await vi.waitFor(() => {
      expect(conversationsStore.setState).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  it("routes live, final, exact, and compaction context events into the shared meter", () => {
    const contextUsage = createContextUsageStore();
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      contextUsage,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: {
        type: "context.live",
        currentTokens: 101,
        providerId: "deepseek",
        model: "deepseek-v4-flash",
      },
    });
    expect(contextUsage.getState().byConversation.c1).toMatchObject({
      currentTokens: 101,
      accuracy: "estimated",
    });

    eventSubscriber!({
      conversationId: "c1",
      event: {
        type: "usage.final",
        usage: {
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          inputTokens: 99_999,
          outputTokens: 99_999,
          cacheReadTokens: 99_999,
          cacheCreationTokens: 99_999,
          contextInputTokens: 5,
          contextCacheReadTokens: 95,
          contextCacheCreationTokens: 0,
          contextOutputTokens: 2,
          costSource: "unpriced",
          tokensEstimated: false,
        },
      },
    });
    expect(contextUsage.getState().byConversation.c1).toMatchObject({
      currentTokens: 102,
      accuracy: "estimated",
    });

    eventSubscriber!({
      conversationId: "c1",
      event: {
        type: "context.snapshot",
        currentTokens: 105,
        maxTokens: 200,
        rawMaxTokens: 200,
        autoCompactThreshold: 180,
        isAutoCompactEnabled: true,
        providerId: "deepseek",
        model: "deepseek-v4-flash",
      },
    });
    expect(contextUsage.getState().byConversation.c1.currentTokens).toBe(105);

    eventSubscriber!({
      conversationId: "c1",
      event: { type: "compact.boundary", trigger: "auto", preTokens: 105, postTokens: 24 },
    });
    expect(contextUsage.getState().byConversation.c1).toEqual({
      currentTokens: 24,
      capacityTokens: 180,
      rawMaxTokens: 200,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      accuracy: "exact",
      updatedAt: expect.any(Number),
      justCompacted: true,
    });
  });

  it("records one concise notification when a non-active conversation finishes", () => {
    const notifications = createNotificationsStore();
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      notifications,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: {
        type: "run.finished",
        subtype: "success",
        isError: false,
        finalText: "private result",
        pathAudit: { claimed: [] },
      },
    });

    expect(notifications.getState().items).toHaveLength(1);
    expect(notifications.getState().items[0]).toMatchObject({
      text: "「后台整理」已完成",
      kind: "task-done",
      conversationId: "c1",
    });
    expect(JSON.stringify(notifications.getState().items[0])).not.toContain("private result");
  });

  it("asks the conversation store to flush that conversation after a successful terminal event", () => {
    const flushQueuedTurns = vi.fn(async () => undefined);
    conversationsStore.getState = vi.fn(() => ({
      byId: { c1: { id: "c1", title: "后台整理" } },
      activeId: "c1",
      runIds: { c1: "run-1" },
      timelines: { c1: [] },
      flushQueuedTurns,
    })) as never;
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: { type: "run.finished", subtype: "success", isError: false, finalText: "done", pathAudit: { claimed: [] } },
    });

    expect(flushQueuedTurns).toHaveBeenCalledWith("c1");
  });

  it("keeps queued turns waiting when the current turn fails or is interrupted", () => {
    const flushQueuedTurns = vi.fn(async () => undefined);
    conversationsStore.getState = vi.fn(() => ({
      byId: { c1: { id: "c1", title: "后台整理" } },
      activeId: "c1",
      runIds: { c1: "run-1" },
      timelines: { c1: [] },
      flushQueuedTurns,
    })) as never;
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: { type: "run.finished", subtype: "error", isError: true, finalText: "failed", pathAudit: { claimed: [] } },
    });
    eventSubscriber!({
      conversationId: "c1",
      event: { type: "run.finished", subtype: "interrupted", isError: false, finalText: "", pathAudit: { claimed: [] } },
    });

    expect(flushQueuedTurns).not.toHaveBeenCalled();
  });

  it("does not create redundant history for the visible conversation or an interrupted run", () => {
    const notifications = createNotificationsStore();
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      notifications,
    });

    eventSubscriber!({
      conversationId: "c2",
      event: { type: "run.finished", subtype: "success", isError: false, finalText: "done", pathAudit: { claimed: [] } },
    });
    eventSubscriber!({
      conversationId: "c1",
      event: { type: "run.finished", subtype: "interrupted", isError: true, finalText: "", pathAudit: { claimed: [] } },
    });

    expect(notifications.getState().items).toEqual([]);
  });

  it("records a waiting notification only when approval is outside the active conversation", () => {
    const notifications = createNotificationsStore();
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      notifications,
    });

    approvalSubscriber!({
      id: "approval-1",
      conversationId: "c1",
      toolName: "Write",
      inputSummary: "修改文件",
      risk: "moderate",
    });

    expect(notifications.getState().items[0]).toMatchObject({
      text: "「后台整理」需要你确认",
      kind: "approval-needed",
      conversationId: "c1",
    });
  });

  it("routes wiki shadow events to wikiEntries store, not conversations", async () => {
    const receiveEvent = vi.fn();
    wikiEntriesStore.getState = vi.fn(() => ({
      entries: [{ id: "wiki-1", filePath: "/test.txt", quotedText: "...", turns: [], createdAt: 1000 }],
      active: { entryId: "wiki-1", shadowConversationId: "c-wiki-shadow", streaming: true, detailed: false },
      receiveEvent,
    })) as any;

    conversationsStore.getState = vi.fn(() => ({
      byId: { "c1": { id: "c1" } },
      runIds: {},
      timelines: {},
    })) as any;

    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    const envelope: BridgeEventEnvelope = {
      conversationId: "c-wiki-shadow",
      event: { type: "text.delta", text: "wiki response" },
    };

    eventSubscriber!(envelope);

    await vi.waitFor(() => {
      expect(receiveEvent).toHaveBeenCalledWith("c-wiki-shadow", envelope.event);
    });
    expect(conversationsStore.setState).not.toHaveBeenCalled();
  });

  it("safely discards events for unknown conversationId", () => {
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    const envelope: BridgeEventEnvelope = {
      conversationId: "unknown",
      event: { type: "text.delta", text: "orphan" },
    };

    expect(() => eventSubscriber!(envelope)).not.toThrow();
    expect(conversationsStore.setState).not.toHaveBeenCalled();
  });

  it("refreshes the active file tree and an already-open preview after momo changes a file", () => {
    const load = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    conversationsStore.getState = vi.fn(() => ({
      byId: { c1: { id: "c1", workspaceId: "project-a" } },
      runIds: { c1: "run-1" },
      timelines: { c1: [] },
    })) as any;

    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      workspaces: { getState: vi.fn(() => ({ activeId: "project-a" })) } as any,
      previewContent: {
        getState: vi.fn(() => ({ byPath: { "notes.md": { status: "ready" } }, load })),
      } as any,
      fileTree: { getState: vi.fn(() => ({ refresh })) } as any,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: { type: "file.changed", path: "notes.md", workspacePath: "notes.md", change: "modified" },
    });

    expect(load).toHaveBeenCalledWith("notes.md", { force: true });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh the visible workspace for a background conversation in another workspace", () => {
    const load = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    conversationsStore.getState = vi.fn(() => ({
      byId: { c1: { id: "c1", workspaceId: "project-b" } },
      runIds: { c1: "run-1" },
      timelines: { c1: [] },
    })) as any;

    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      workspaces: { getState: vi.fn(() => ({ activeId: "project-a" })) } as any,
      previewContent: {
        getState: vi.fn(() => ({ byPath: { "notes.md": { status: "ready" } }, load })),
      } as any,
      fileTree: { getState: vi.fn(() => ({ refresh })) } as any,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: { type: "file.changed", path: "notes.md", workspacePath: "notes.md", change: "modified" },
    });

    expect(load).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps an unsaved Markdown draft accessible when momo deletes its source file", () => {
    const load = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const key = previewDraftKey("project-a", "notes.md");
    let previewState = {
      byPath: { "notes.md": { status: "ready" as const } },
      drafts: {
        [key]: {
          originalText: "old",
          text: "my unsaved edit",
          status: "dirty" as const,
        },
      },
      load,
    };
    const previewStore = {
      getState: vi.fn(() => previewState),
      setState: vi.fn((update: (state: typeof previewState) => Partial<typeof previewState>) => {
        previewState = { ...previewState, ...update(previewState) };
      }),
    };
    conversationsStore.getState = vi.fn(() => ({
      byId: { c1: { id: "c1", workspaceId: "project-a" } },
      runIds: { c1: "run-1" },
      timelines: { c1: [] },
    })) as any;

    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
      workspaces: { getState: vi.fn(() => ({ activeId: "project-a" })) } as any,
      previewContent: previewStore as any,
      fileTree: { getState: vi.fn(() => ({ refresh })) } as any,
    });

    eventSubscriber!({
      conversationId: "c1",
      event: { type: "file.changed", path: "notes.md", workspacePath: "notes.md", change: "deleted" },
    });

    expect(load).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
    expect(previewState.drafts[key]).toMatchObject({
      text: "my unsaved edit",
      status: "error",
      error: expect.stringContaining("未保存草稿仍保留"),
    });
  });

  it("folds approval request to approvals store with runId lookup", () => {
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    const request: ApprovalRequest = {
      id: "appr-1",
      conversationId: "c1",
      toolName: "bash",
      inputSummary: "rm -rf /",
      risk: "dangerous",
    };

    approvalSubscriber!(request);

    expect(approvalsStore.setState).toHaveBeenCalledWith(expect.any(Function));
  });

  it("expires the matching renderer approval when the host timeout fires", () => {
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    approvalExpiredSubscriber!({ id: "appr-1", conversationId: "c1" });

    expect(expire).toHaveBeenCalledWith("appr-1");
  });

  it("folds askUser to approvals store with runId lookup", () => {
    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    const payload: AskUserPayload = {
      id: "ask-1",
      conversationId: "c1",
      questions: [{ question: "Proceed?", options: [{ label: "yes" }, { label: "no" }] }],
    };

    askUserSubscriber!(payload);

    expect(approvalsStore.setState).toHaveBeenCalledWith(expect.any(Function));
  });

  it("returns aggregate unsubscribe function", () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    const unsub3 = vi.fn();
    const unsub4 = vi.fn();

    mockClient.subscribe = vi.fn((channel) => {
      if (channel === "bridge:event") return unsub1;
      if (channel === "bridge:approvalRequest") return unsub2;
      if (channel === "bridge:approvalExpired") return unsub3;
      if (channel === "bridge:askUser") return unsub4;
      return vi.fn();
    }) as any;

    const cleanup = wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });

    cleanup();

    expect(unsub1).toHaveBeenCalled();
    expect(unsub2).toHaveBeenCalled();
    expect(unsub3).toHaveBeenCalled();
    expect(unsub4).toHaveBeenCalled();
  });

  it("cancels approvals on run.finished with interrupted subtype", () => {
    approvalsStore.getState = vi.fn(() => ({
      pendingByConversation: { "c1": { id: "appr-1", conversationId: "c1" } },
      cancelForConversation,
    })) as any;

    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore as any,
      wikiEntries: wikiEntriesStore,
    });

    const envelope: BridgeEventEnvelope = {
      conversationId: "c1",
      event: { type: "run.finished", subtype: "interrupted", isError: false, finalText: "", pathAudit: { claimed: [] } },
    };

    eventSubscriber!(envelope);

    expect(cancelForConversation).toHaveBeenCalledWith("c1");
  });

  it("cancels approvals on run.finished with error", () => {
    approvalsStore.getState = vi.fn(() => ({
      pendingByConversation: {},
      cancelForConversation,
    })) as any;

    wireBridgeSubscriptions(mockClient, {
      conversations: conversationsStore,
      approvals: approvalsStore as any,
      wikiEntries: wikiEntriesStore,
    });

    const envelope: BridgeEventEnvelope = {
      conversationId: "c1",
      event: { type: "run.finished", subtype: "success", isError: true, finalText: "timeout", pathAudit: { claimed: [] } },
    };

    eventSubscriber!(envelope);

    expect(cancelForConversation).toHaveBeenCalledWith("c1");
  });
});

describe("context stream integration — normalize → route → restart", () => {
  it("keeps a later exact snapshot authoritative after terminal billing is persisted", async () => {
    let emit: ((envelope: BridgeEventEnvelope) => void) | undefined;
    const client = {
      subscribe: vi.fn((channel: string, callback: unknown) => {
        if (channel === "bridge:event") emit = callback as (envelope: BridgeEventEnvelope) => void;
        return () => {};
      }),
      invoke: vi.fn(),
    } as unknown as BridgeClient;
    const conversations = createConversationsStore(client, {
      resolveConversationDefaults: () => ({ providerId: "deepseek", modelId: "deepseek-v4-flash" }),
    });
    conversations.setState({
      byId: {
        c1: {
          id: "c1", title: "长对话", titleManuallyUpdated: true, bookId: null,
          source: "buddy", providerId: "deepseek", modelId: "deepseek-v4-flash",
          createdAt: 1, lastActivityAt: 1, unread: false,
        },
      },
      order: ["c1"],
      timelines: { c1: [] },
      runIds: { c1: "run-1" },
    });
    const contextUsage = createContextUsageStore();
    wireBridgeSubscriptions(client, {
      conversations,
      approvals: { getState: () => ({ pendingByConversation: {}, cancelForConversation: vi.fn() }), setState: vi.fn() } as never,
      wikiEntries: { getState: () => ({ entries: [], active: null, receiveEvent: vi.fn() }), setState: vi.fn() } as never,
      contextUsage,
    });

    const raw = [
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "继续" }],
          usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 25 },
        },
      },
      {
        type: "result", subtype: "success", is_error: false, result: "继续",
        usage: { input_tokens: 50_000, cache_read_input_tokens: 45_000, cache_creation_input_tokens: 0, output_tokens: 5_000 },
      },
      {
        type: "leemo_context_snapshot",
        contextUsage: {
          totalTokens: 1_030, maxTokens: 200_000, rawMaxTokens: 200_000,
          model: "deepseek-v4-flash", isAutoCompactEnabled: true, autoCompactThreshold: 180_000,
        },
      },
    ];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const message of raw) yield message;
      },
    };
    for await (const event of normalizeSdkStream(stream as never, {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      cwd: ".",
    })) {
      emit?.({ conversationId: "c1", event });
    }

    expect(contextUsage.getState().byConversation.c1).toMatchObject({
      currentTokens: 1_030,
      accuracy: "exact",
      capacityTokens: 180_000,
    });
    const restored = deriveContextUsageFromTimelines(conversations.getState().timelines);
    expect(restored.byConversation.c1).toMatchObject({
      currentTokens: 1_030,
      accuracy: "exact",
      capacityTokens: 180_000,
    });
  });

  it("assistant → compact → result 在 live store 与重启后都保留整理后真值", async () => {
    let emit: ((envelope: BridgeEventEnvelope) => void) | undefined;
    const client = {
      subscribe: vi.fn((channel: string, callback: unknown) => {
        if (channel === "bridge:event") emit = callback as (envelope: BridgeEventEnvelope) => void;
        return () => {};
      }),
      invoke: vi.fn(),
    } as unknown as BridgeClient;
    const conversations = createConversationsStore(client, {
      resolveConversationDefaults: () => ({ providerId: "deepseek", modelId: "deepseek-v4-flash" }),
    });
    conversations.setState({
      byId: {
        c1: {
          id: "c1", title: "长对话", titleManuallyUpdated: true, bookId: null,
          source: "buddy", providerId: "deepseek", modelId: "deepseek-v4-flash",
          createdAt: 1, lastActivityAt: 1, unread: false,
        },
      },
      order: ["c1"],
      timelines: { c1: [] },
      runIds: { c1: "run-1" },
    });
    const contextUsage = createContextUsageStore();
    wireBridgeSubscriptions(client, {
      conversations,
      approvals: { getState: () => ({ pendingByConversation: {}, cancelForConversation: vi.fn() }), setState: vi.fn() } as never,
      wikiEntries: { getState: () => ({ entries: [], active: null, receiveEvent: vi.fn() }), setState: vi.fn() } as never,
      contextUsage,
    });
    const raw = [
      {
        type: "assistant", parent_tool_use_id: null,
        message: {
          role: "assistant", content: [{ type: "text", text: "整理" }],
          usage: { input_tokens: 10, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 0, output_tokens: 0 },
        },
      },
      {
        type: "system", subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 150_010, post_tokens: 30_000 },
      },
      {
        type: "result", subtype: "success", is_error: false, result: "完成",
        usage: { input_tokens: 10, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 0, output_tokens: 0 },
      },
    ];
    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const message of raw) yield message;
      },
    };
    for await (const event of normalizeSdkStream(stream as never, {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      cwd: ".",
    })) {
      emit?.({ conversationId: "c1", event });
    }

    expect(contextUsage.getState().byConversation.c1).toMatchObject({
      currentTokens: 30_000,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      accuracy: "exact",
      justCompacted: true,
    });
    expect(deriveContextUsageFromTimelines(conversations.getState().timelines).byConversation.c1).toMatchObject({
      currentTokens: 30_000,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      accuracy: "exact",
      justCompacted: true,
    });
  });
});

// ── 轮 4「成果页通电」──────────────────────────────────────────────────────
//
// 通电前：artifacts store 有 registerArtifact，但**生产代码从来没调用过它**，
// 成果页因此永远是空的。这一组用真 store（不是 mock）—— 判据是"跑完一轮工具
// 之后成果表里真有东西"，用 mock 的 setState 就永远看不到 timeline，也就测不到。
describe("wireBridgeSubscriptions — 成果登记 (tool.finished → registerArtifact)", () => {
  let client: BridgeClient;
  let emit: (envelope: BridgeEventEnvelope) => void;
  let conversations: StoreApi<ConversationsState>;
  let artifacts: StoreApi<ArtifactsState>;
  let notebooks: StoreApi<NotebooksState>;

  const CONV = "c1";

  function seed(opts: { books?: { id: string }[]; root?: string; workspaceId?: string; externalRoot?: string; bookId?: string | null } = {}) {
    let cb: ((e: BridgeEventEnvelope) => void) | null = null;
    client = {
      subscribe: vi.fn((channel: string, callback: unknown) => {
        if (channel === "bridge:event") cb = callback as (e: BridgeEventEnvelope) => void;
        return vi.fn();
      }),
      invoke: vi.fn(),
    } as unknown as BridgeClient;

    conversations = createConversationsStore(client, {
      resolveConversationDefaults: () => ({ providerId: "p", modelId: "m" }),
    });
    // 只需要 byId 里有这条对话，fold 才不会当成未知 id 丢掉。
    conversations.setState({
      byId: {
        [CONV]: {
          id: CONV, title: "t", titleManuallyUpdated: false, bookId: opts.bookId ?? null, source: "workbench",
          providerId: "p", modelId: "m", createdAt: 0, lastActivityAt: 0, unread: false,
          ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
        },
      },
      order: [CONV],
      timelines: { [CONV]: [] },
      runIds: { [CONV]: null },
    });

    artifacts = createArtifactsStore();
    notebooks = createNotebooksStore(undefined, []);
    notebooks.setState({
      list: (opts.books ?? [{ id: "math" }]).map((b) => ({
        id: b.id, title: b.id, dir: `/root/${b.id}`, color: "blue" as const, hasMemory: false,
      })),
      root: opts.root ?? "",
    });

    wireBridgeSubscriptions(client, {
      conversations,
      approvals: { getState: () => ({ cancelForConversation: vi.fn() }), setState: vi.fn() } as unknown as StoreApi<ApprovalsState>,
      wikiEntries: { getState: () => ({ entries: [], active: null, receiveEvent: vi.fn() }), setState: vi.fn() } as unknown as StoreApi<WikiState>,
      artifacts,
      notebooks,
      ...(opts.workspaceId ? {
        workspaces: {
          getState: () => ({
            list: [{
              id: opts.workspaceId!,
              name: "Demo",
              displayPath: opts.externalRoot ?? "",
              kind: "external" as const,
              available: true,
              lastOpenedAt: 1,
            }],
          }),
        } as never,
      } : {}),
    });
    emit = cb!;
  }

  /** 一轮完整的工具调用：run 起、tool 起、tool 收。tool.finished 本身不带工具名
   *  与 input，所以缺了 tool.started 那一步就什么也推不出来 —— 这正是接线点必须
   *  在 fold 之后的原因。 */
  function runTool(opts: {
    name?: string;
    input?: unknown;
    toolUseId?: string;
    isError?: boolean;
  } = {}) {
    const toolUseId = opts.toolUseId ?? "tu-1";
    emit({ conversationId: CONV, event: { type: "run.started", runId: "run-1" } as never });
    emit({
      conversationId: CONV,
      event: {
        type: "tool.started",
        toolUseId,
        name: opts.name ?? "Write",
        input: opts.input ?? { file_path: "math/notes.md" },
        subagent: false,
      },
    });
    emit({
      conversationId: CONV,
      event: { type: "tool.finished", toolUseId, isError: opts.isError ?? false, contentSummary: "ok" },
    });
  }

  it("registers an artifact when a Write finishes — 成果页从此有真东西", () => {
    seed();
    runTool();

    const entries = artifacts.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "file",
      path: "math/notes.md",
      title: "notes.md",
      bookId: "math",
      sourceConversationId: CONV,
      escaped: false,
    });
  });

  it("carries the run that produced it, not the store's current run (which is null once the run ends)", () => {
    seed();
    runTool();
    emit({
      conversationId: CONV,
      event: { type: "run.finished", subtype: "success", isError: false, finalText: "", pathAudit: { claimed: [] } } as never,
    });
    // 一物三址要能追回是哪一轮产的；run 结束后 runIds 被清成 null。
    expect(conversations.getState().runIds[CONV]).toBeNull();
    const toolItem = conversations.getState().timelines[CONV]!.find((it) => it.kind === "tool");
    const runId = toolItem && toolItem.kind === "tool" ? toolItem.runId : undefined;
    expect(runId).toBeTruthy();
    expect(artifacts.getState().entries[0]?.sourceRunId).toBe(runId);
  });

  it("registers Edit too, and the visualization tool as its own kind", () => {
    seed();
    runTool({ name: "Edit", toolUseId: "tu-e", input: { file_path: "math/draft.md" } });
    runTool({ name: LEEMO_VISUALIZATION_TOOL_NAME, toolUseId: "tu-v", input: { path: "math/chart.html" } });

    const kinds = artifacts.getState().entries.map((e) => [e.kind, e.path]);
    expect(kinds).toEqual(expect.arrayContaining([
      ["file", "math/draft.md"],
      ["visualization", "math/chart.html"],
    ]));
  });

  it("registers a root document at its routed default-workspace path", () => {
    seed({ root: "C:\\Users\\me\\Leemo", bookId: null });
    runTool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createWord,
      input: { file_path: "周报.docx" },
    });

    expect(artifacts.getState().entries).toEqual([
      expect.objectContaining({ path: "默认工作区/周报.docx", bookId: null, escaped: false }),
    ]);
  });

  it("registers a root visualization at its actual routed default-workspace path", () => {
    seed({ root: "C:\\Users\\me\\Leemo", bookId: null });
    runTool({
      name: LEEMO_VISUALIZATION_TOOL_NAME,
      input: { file_path: "英语学习/本周进度.html" },
    });

    expect(artifacts.getState().entries).toEqual([
      expect.objectContaining({
        kind: "visualization",
        path: "默认工作区/英语学习/本周进度.html",
        bookId: null,
        escaped: false,
      }),
    ]);
  });

  it("registers a Word edit as the new copy rather than the source", () => {
    seed({ root: "C:\\Users\\me\\Leemo", bookId: null });
    runTool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.editWord,
      input: { file_path: "默认工作区/简历.docx" },
    });
    expect(artifacts.getState().entries).toEqual([
      expect.objectContaining({ path: "默认工作区/简历-修改版.docx" }),
    ]);
  });

  it("registers a file written by a subagent instead of losing it inside the activity card", () => {
    seed();
    conversations.setState((state) => ({ runIds: { ...state.runIds, [CONV]: "run-agent" } }));
    emit({ conversationId: CONV, event: { type: "subagent.activity", parentToolUseId: "agent-1" } });
    emit({
      conversationId: CONV,
      event: {
        type: "tool.started",
        toolUseId: "child-write",
        name: "Write",
        input: { file_path: "math/subagent.md" },
        subagent: true,
        parentToolUseId: "agent-1",
      },
    });
    emit({
      conversationId: CONV,
      event: {
        type: "tool.finished",
        toolUseId: "child-write",
        isError: false,
        contentSummary: "written",
        parentToolUseId: "agent-1",
      },
    });

    expect(artifacts.getState().entries).toEqual([
      expect.objectContaining({
        id: `${CONV}:child-write`,
        path: "math/subagent.md",
        sourceRunId: "run-agent",
      }),
    ]);
  });

  it("registers nothing for a FAILED tool — a write that errored produced no 成果", () => {
    seed();
    runTool({ isError: true });
    expect(artifacts.getState().entries).toEqual([]);
  });

  it("registers nothing for a tool that produces no file (Read/Bash/WebSearch)", () => {
    seed();
    runTool({ name: "Read", toolUseId: "tu-r", input: { file_path: "math/notes.md" } });
    runTool({ name: "Bash", toolUseId: "tu-b", input: { command: "ls" } });
    expect(artifacts.getState().entries).toEqual([]);
  });

  it("folds an absolute path back into the workspace when the root is known", () => {
    seed({ root: "C:\\Users\\me\\Leemo" });
    runTool({ input: { file_path: "C:\\Users\\me\\Leemo\\math\\notes.md" } });

    expect(artifacts.getState().entries[0]).toMatchObject({
      path: "math/notes.md", bookId: "math", escaped: false,
    });
  });

  it("registers a live artifact against the conversation's external workspace", () => {
    seed({
      root: "C:\\Users\\me\\Leemo",
      workspaceId: "workspace-project",
      externalRoot: "D:\\Projects\\demo",
    });
    runTool({ input: { file_path: "D:\\Projects\\demo\\README.md" } });

    expect(artifacts.getState().entries[0]).toMatchObject({
      path: "README.md",
      bookId: null,
      escaped: false,
      workspaceId: "workspace-project",
    });
  });

  it("flags a file written OUTSIDE the workspace as escaped, with no book", () => {
    seed({ root: "C:\\Users\\me\\Leemo" });
    runTool({ input: { file_path: "C:\\Windows\\Temp\\x.md" } });

    expect(artifacts.getState().entries[0]).toMatchObject({ escaped: true, bookId: null });
  });

  it("does not register the same file twice when momo writes it again", () => {
    seed();
    runTool({ toolUseId: "tu-1" });
    runTool({ toolUseId: "tu-2" });
    // 同一份产物写两次是一件成果，不是两件（store 的 samePath 去重）。
    expect(artifacts.getState().entries).toHaveLength(1);
  });

  it("works without the artifacts/notebooks stores at all (older callers must not crash)", () => {
    let cb: ((e: BridgeEventEnvelope) => void) | null = null;
    const c = {
      subscribe: vi.fn((channel: string, callback: unknown) => {
        if (channel === "bridge:event") cb = callback as (e: BridgeEventEnvelope) => void;
        return vi.fn();
      }),
      invoke: vi.fn(),
    } as unknown as BridgeClient;
    const convs = createConversationsStore(c, { resolveConversationDefaults: () => ({ providerId: "p", modelId: "m" }) });
    convs.setState({ byId: { [CONV]: { id: CONV } as never }, timelines: { [CONV]: [] }, runIds: { [CONV]: null } });

    wireBridgeSubscriptions(c, {
      conversations: convs,
      approvals: { getState: () => ({ cancelForConversation: vi.fn() }), setState: vi.fn() } as unknown as StoreApi<ApprovalsState>,
      wikiEntries: { getState: () => ({ entries: [], active: null, receiveEvent: vi.fn() }), setState: vi.fn() } as unknown as StoreApi<WikiState>,
    });

    expect(() => {
      cb!({ conversationId: CONV, event: { type: "tool.started", toolUseId: "t", name: "Write", input: { file_path: "a.md" }, subagent: false } });
      cb!({ conversationId: CONV, event: { type: "tool.finished", toolUseId: "t", isError: false, contentSummary: "" } });
    }).not.toThrow();
  });
});
