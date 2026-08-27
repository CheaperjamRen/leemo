import { describe, expect, it, vi } from "vitest";
import type { BridgeEventEnvelope } from "../../bridge/contract";
import type { WorkOverviewSnapshot } from "../../bridge/work-overview";
import type { BridgeClient } from "../bridge/client";
import type { TimelineItem } from "./message-model";
import {
  createConversationsStore,
  deriveConversationTitle,
  foldConversationEnvelope,
  type ConversationDefaults,
} from "./conversations";
import { wireBridgeSubscriptions } from "../bridge/wiring";
import { createApprovalsStore } from "./approvals";
import { createWikiEntriesStore } from "./wiki-entries";

const DEFAULTS: ConversationDefaults = { providerId: "provider-a", modelId: "model-a" };

function makeClient(ids = ["conv-a", "conv-b", "conv-c", "conv-d", "conv-e", "conv-f"]) {
  let nextId = 0;
  let eventListener: ((envelope: BridgeEventEnvelope) => void) | undefined;
  const calls: { channel: string; request: unknown }[] = [];
  // 轮 7 A3: lets a test make bridge:updateContext reject for ONE conversation,
  // mirroring "the host tore that one down" (restart / dispose).
  const failingUpdates = new Set<string>();
  const client = {
    invoke: vi.fn(async (channel: string, request: unknown) => {
      calls.push({ channel, request });
      if (channel === "bridge:createConversation") return { conversationId: ids[nextId++] };
      if (channel === "bridge:guide") return { delivery: "applied" };
      if (channel === "bridge:interrupt") return { state: "stopped" };
      if (
        channel === "bridge:updateContext" &&
        failingUpdates.has((request as { conversationId: string }).conversationId)
      ) {
        throw new Error("unknown conversation");
      }
      return undefined;
    }),
    subscribe: vi.fn((channel: string, callback: any) => {
      if (channel === "bridge:event") eventListener = callback;
      return () => {};
    }),
  } as unknown as BridgeClient;
  return {
    client,
    calls,
    emit: (envelope: BridgeEventEnvelope) => eventListener?.(envelope),
    failUpdateFor: (cid: string) => failingUpdates.add(cid),
  };
}

async function registerTwo() {
  const bridge = makeClient();
  let now = 100;
  const conversationsStore = createConversationsStore(bridge.client, {
    resolveConversationDefaults: () => DEFAULTS,
    now: () => ++now,
  });
  const approvalsStore = createApprovalsStore(bridge.client, {});
  const wikiEntriesStore = createWikiEntriesStore(bridge.client, {
    resolveConversationDefaults: () => DEFAULTS,
  });

  // Wire subscriptions
  wireBridgeSubscriptions(bridge.client, {
    conversations: conversationsStore,
    approvals: approvalsStore,
    wikiEntries: wikiEntriesStore,
  });

  const a = await conversationsStore.getState().createConversation({ source: "buddy" });
  const b = await conversationsStore.getState().createConversation({ source: "workbench", bookId: "book-1" });
  return { bridge, store: conversationsStore, a, b };
}

function latestByKind(items: TimelineItem[], kind: TimelineItem["kind"]) {
  return [...items].reverse().find((item) => item.kind === kind);
}

describe("conversations store", () => {
  it("starts as a true empty registry without a fabricated conv-1", () => {
    const { client } = makeClient();
    const state = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS }).getState();

    expect(state.byId).toEqual({});
    expect(state.order).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.openTabs).toEqual([]);
    expect(state.timelines).toEqual({});
    expect(state.runIds).toEqual({});
    expect(state.stoppingById).toEqual({});
    expect(state.stopLockedById).toEqual({});
  });

  it("keeps buddy conversations global even when the workbench still has an active book", async () => {
    const bridge = makeClient(["buddy-global"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveActiveWorkspaceId: () => "workspace-project",
      resolveActiveNotebook: () => "高等数学",
    });

    const id = await store.getState().createConversation({ source: "buddy" });

    expect(store.getState().byId[id]).toMatchObject({
      workspaceId: "leemo-home",
      bookId: null,
    });
    expect(bridge.calls).toContainEqual({
      channel: "bridge:createConversation",
      request: expect.not.objectContaining({ notebookId: expect.anything() }),
    });
  });

  it("persists an explicit unread toggle and lets opening clear it again", async () => {
    const bridge = makeClient(["manual-unread"]);
    const persistence = {
      saveConversation: vi.fn(async () => undefined),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persistence as never,
    });
    const id = await store.getState().createConversation({ source: "buddy" });

    await store.getState().setConversationUnread(id, true);
    expect(store.getState().byId[id]?.unread).toBe(true);
    expect(persistence.saveConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ id, unread: true }),
      [],
    );

    store.getState().switchActive(id);
    expect(store.getState().byId[id]?.unread).toBe(false);
    expect(persistence.saveConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ id, unread: false }),
      [],
    );
  });

  it("does not claim an unread toggle succeeded when persistence rejects", async () => {
    const bridge = makeClient(["manual-unread-fail"]);
    const persistence = {
      saveConversation: vi.fn(async () => { throw new Error("磁盘不可写"); }),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persistence as never,
    });
    const id = await store.getState().createConversation({ source: "buddy" });

    await expect(store.getState().setConversationUnread(id, true)).rejects.toThrow("磁盘不可写");
    expect(store.getState().byId[id]?.unread).toBe(false);
  });

  it("restores the last opened unarchived conversation in the exact book scope", () => {
    const { client } = makeClient();
    let now = 1_000;
    const persisted = {
      loadAll: vi.fn(),
      saveConversation: vi.fn(async () => undefined),
      saveWikiEntry: vi.fn(),
      saveSettings: vi.fn(),
      moveConversation: vi.fn(),
      deleteConversation: vi.fn(),
    };
    const store = createConversationsStore(client, {
      resolveConversationDefaults: () => DEFAULTS,
      now: () => ++now,
      persistence: persisted,
    } as never);
    const meta = (
      id: string,
      bookId: string | null,
      lastActivityAt: number,
      lastOpenedAt: number,
      archived = false,
    ): import("./conversations").ConversationMeta => ({
      id,
      title: id,
      titleManuallyUpdated: true,
      bookId,
      workspaceId: "leemo-home",
      source: "workbench",
      providerId: "p",
      modelId: "m",
      createdAt: 1,
      lastActivityAt,
      lastOpenedAt,
      pinned: false,
      archived,
      unread: false,
    });
    store.getState().hydrate([
      { meta: meta("opened", "高等数学", 10, 300), timeline: [] },
      { meta: meta("new-message", "高等数学", 900, 200), timeline: [] },
      { meta: meta("archived", "高等数学", 1_000, 500, true), timeline: [] },
      { meta: meta("other-book", "求职", 2_000, 900), timeline: [] },
    ]);

    store.getState().activateScope("leemo-home", "高等数学");

    expect(store.getState().activeId).toBe("opened");
    expect(store.getState().byId.opened.lastOpenedAt).toBe(1_001);
    expect(persisted.saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "opened", lastOpenedAt: 1_001 }),
      [],
    );
  });

  it("persists pin and archive before changing the visible conversation state", async () => {
    const bridge = makeClient();
    const persist = {
      loadAll: vi.fn(),
      saveConversation: vi.fn(async () => undefined),
      saveWikiEntry: vi.fn(),
      saveSettings: vi.fn(),
      moveConversation: vi.fn(),
      deleteConversation: vi.fn(),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persist,
    } as never);
    const first = await store.getState().createConversation({ source: "workbench", bookId: "高等数学" });
    const second = await store.getState().createConversation({ source: "workbench", bookId: "高等数学" });
    const actions = store.getState() as unknown as {
      pinConversation(id: string, pinned: boolean): Promise<void>;
      archiveConversation(id: string, archived: boolean): Promise<void>;
    };

    await actions.pinConversation(first, true);
    expect(store.getState().byId[first].pinned).toBe(true);

    await actions.archiveConversation(second, true);
    expect(store.getState().byId[second].archived).toBe(true);
    expect(store.getState().activeId).toBe(first);

    persist.saveConversation.mockRejectedValueOnce(new Error("disk full"));
    await expect(actions.pinConversation(first, false)).rejects.toThrow("disk full");
    expect(store.getState().byId[first].pinned).toBe(true);
  });

  it("does not overwrite newer conversation metadata while a lifecycle save is pending", async () => {
    const bridge = makeClient();
    let releaseSave: (() => void) | undefined;
    const persist = {
      saveConversation: vi.fn(() => new Promise<void>((resolve) => { releaseSave = resolve; })),
      moveConversation: vi.fn(),
      deleteConversation: vi.fn(),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persist,
    });
    const id = await store.getState().createConversation({ source: "buddy" });

    const pendingPin = store.getState().pinConversation(id, true);
    store.getState().renameTitle(id, "等待落盘时改的新标题");
    releaseSave?.();
    await pendingPin;

    expect(store.getState().byId[id]).toMatchObject({
      title: "等待落盘时改的新标题",
      pinned: true,
    });
  });

  it("moves only after host disposal and reclaims the conversation in its new book", async () => {
    const order: string[] = [];
    const bridge = makeClient();
    bridge.client.invoke = vi.fn(async (channel: string, request: unknown) => {
      order.push(channel);
      if (channel === "bridge:createConversation") {
        const requested = request as { conversationId?: string };
        return { conversationId: requested.conversationId ?? `created-${order.length}` };
      }
      return undefined;
    }) as never;
    const persist = {
      loadAll: vi.fn(),
      saveConversation: vi.fn(async () => undefined),
      saveWikiEntry: vi.fn(),
      saveSettings: vi.fn(),
      moveConversation: vi.fn(async () => { order.push("persist:move"); }),
      deleteConversation: vi.fn(),
    };
    const onConversationMoved = vi.fn();
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persist,
      onConversationMoved,
      now: () => 500,
    } as never);
    store.getState().hydrate([
      {
        meta: {
          id: "move-me", title: "要移动", titleManuallyUpdated: true, bookId: "高等数学",
          workspaceId: "leemo-home", source: "workbench", providerId: "p", modelId: "m",
          createdAt: 1, lastActivityAt: 10, lastOpenedAt: 10, pinned: false, archived: false, unread: false,
        },
        timeline: [{ kind: "text", id: "u1", runId: "run-1", role: "user", text: "继续", streaming: false }],
      },
      {
        meta: {
          id: "stay", title: "留下", titleManuallyUpdated: true, bookId: "高等数学",
          workspaceId: "leemo-home", source: "workbench", providerId: "p", modelId: "m",
          createdAt: 1, lastActivityAt: 5, lastOpenedAt: 5, pinned: false, archived: false, unread: false,
        },
        timeline: [],
      },
    ]);
    store.getState().switchActive("move-me");
    const actions = store.getState() as unknown as {
      moveConversation(id: string, target: { workspaceId: string; bookId: string | null }): Promise<void>;
    };

    await actions.moveConversation("move-me", { workspaceId: "workspace-external", bookId: null });

    expect(order.slice(0, 2)).toEqual(["bridge:disposeConversation", "persist:move"]);
    expect(persist.moveConversation).toHaveBeenCalledWith(
      "leemo-home",
      expect.objectContaining({
        id: "move-me",
        workspaceId: "workspace-external",
        bookId: null,
        lastActivityAt: 500,
      }),
      expect.any(Array),
    );
    expect(store.getState().byId["move-me"]).toMatchObject({ workspaceId: "workspace-external", bookId: null });
    expect(store.getState().activeId).toBe("stay");
    expect(onConversationMoved).toHaveBeenCalledWith("move-me");

    order.length = 0;
    await store.getState().send("move-me", "在新本子继续");
    expect(bridge.client.invoke).toHaveBeenCalledWith("bridge:createConversation", expect.objectContaining({
      conversationId: "move-me",
      workspaceId: "workspace-external",
    }));
  });

  it("deletes durably, keeps state on failure, and blocks destructive actions while running", async () => {
    const bridge = makeClient();
    const persist = {
      loadAll: vi.fn(),
      saveConversation: vi.fn(async () => undefined),
      saveWikiEntry: vi.fn(),
      saveSettings: vi.fn(),
      moveConversation: vi.fn(async () => undefined),
      deleteConversation: vi.fn(async () => undefined),
    };
    const onConversationDeleted = vi.fn();
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persist,
      onConversationDeleted,
    } as never);
    const first = await store.getState().createConversation({ source: "workbench", bookId: "高等数学" });
    const second = await store.getState().createConversation({ source: "workbench", bookId: "高等数学" });
    const actions = store.getState() as unknown as {
      deleteConversation(id: string): Promise<void>;
      moveConversation(id: string, target: { workspaceId: string; bookId: string | null }): Promise<void>;
    };

    store.setState((state) => ({ runIds: { ...state.runIds, [second]: "run-live" } }));
    await expect(actions.deleteConversation(second)).rejects.toThrow(/进行中/);
    await expect(actions.moveConversation(second, { workspaceId: "leemo-home", bookId: null })).rejects.toThrow(/进行中/);
    expect(persist.deleteConversation).not.toHaveBeenCalled();
    expect(persist.moveConversation).not.toHaveBeenCalled();

    persist.deleteConversation.mockRejectedValueOnce(new Error("cannot delete"));
    await expect(actions.deleteConversation(first)).rejects.toThrow("cannot delete");
    expect(store.getState().byId[first]).toBeDefined();

    await actions.deleteConversation(first);
    expect(persist.deleteConversation).toHaveBeenLastCalledWith(first);
    expect(onConversationDeleted).toHaveBeenCalledWith(first);
    expect(store.getState().byId[first]).toBeUndefined();
    expect(store.getState().order).not.toContain(first);
  });

  it("does not archive a restored conversation while its host claim is still pending", async () => {
    const bridge = makeClient();
    let markClaimStarted!: () => void;
    let releaseClaim!: () => void;
    const claimStarted = new Promise<void>((resolve) => { markClaimStarted = resolve; });
    const claimGate = new Promise<void>((resolve) => { releaseClaim = resolve; });
    bridge.client.invoke = vi.fn(async (channel: string, request: unknown) => {
      if (channel === "bridge:createConversation") {
        const conversationId = (request as { conversationId: string }).conversationId;
        markClaimStarted();
        await claimGate;
        return { conversationId };
      }
      return undefined;
    }) as never;
    const persist = {
      saveConversation: vi.fn(async () => undefined),
      moveConversation: vi.fn(),
      deleteConversation: vi.fn(),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persist,
    });
    store.getState().hydrate([{
      meta: {
        id: "restored", title: "恢复的对话", titleManuallyUpdated: true, bookId: null,
        source: "buddy", providerId: "p", modelId: "m", createdAt: 1,
        lastActivityAt: 1, unread: false,
      },
      timeline: [],
    }]);

    const sending = store.getState().send("restored", "继续执行");
    await claimStarted;
    await expect(store.getState().archiveConversation("restored", true)).rejects.toThrow(/进行中/);
    expect(persist.saveConversation).not.toHaveBeenCalled();
    releaseClaim();
    await sending;
  });

  it("does not start a send while archive persistence is pending", async () => {
    const bridge = makeClient(["lock-me"]);
    let markSaveStarted!: () => void;
    let releaseSave!: () => void;
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const persist = {
      saveConversation: vi.fn(async () => {
        markSaveStarted();
        await saveGate;
      }),
      moveConversation: vi.fn(),
      deleteConversation: vi.fn(),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persist,
    });
    const id = await store.getState().createConversation({ source: "buddy" });

    const archiving = store.getState().archiveConversation(id, true);
    await saveStarted;
    const sendOutcome = await store.getState().send(id, "不该穿过归档锁")
      .then(() => "resolved", () => "rejected");
    releaseSave();
    await archiving;

    expect(sendOutcome).toBe("rejected");
    expect(store.getState().timelines[id]).toEqual([]);
  });

  it("does not reuse a run id that already exists after hydrate", async () => {
    // runSeq used to be a plain closure counter starting at 0, so after
    // hydrating a restored conversation the next send re-issued "run-1" — the
    // new user message got grouped into the OLD turn and the timeline read as
    // if the message belonged to a finished round.
    const bridge = makeClient(["conv-h"]);
    const store = createConversationsStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });
    const restored: import("./conversations").ConversationMeta = {
      id: "conv-h", title: "旧对话", titleManuallyUpdated: false, bookId: null, source: "buddy",
      providerId: "p", modelId: "m", createdAt: 1, lastActivityAt: 1, unread: false,
    };
    store.getState().hydrate([
      {
        meta: restored,
        timeline: [
          { kind: "text", id: "u0", runId: "run-1", role: "user", text: "旧问题", streaming: false },
          { kind: "text", id: "m0", runId: "run-1", role: "momo", text: "旧回答", streaming: false },
        ],
      },
    ]);

    await store.getState().send("conv-h", "新问题");

    const timeline = store.getState().timelines["conv-h"];
    const fresh = timeline[timeline.length - 1];
    if (fresh.kind === "compact") throw new Error("expected the sent user message");
    expect(fresh.runId).not.toBe("run-1");
    expect(store.getState().runIds["conv-h"]).toBe(fresh.runId);
  });

  it("keeps run ids unique across conversations after hydrate", async () => {
    const bridge = makeClient(["conv-new"]);
    const store = createConversationsStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });
    const meta = (id: string): import("./conversations").ConversationMeta => ({
      id, title: "t", titleManuallyUpdated: false, bookId: null, source: "buddy",
      providerId: "p", modelId: "m", createdAt: 1, lastActivityAt: 1, unread: false,
    });
    store.getState().hydrate([
      { meta: meta("c-a"), timeline: [{ kind: "text", id: "x", runId: "run-7", role: "user", text: "a", streaming: false }] },
      { meta: meta("c-b"), timeline: [{ kind: "text", id: "y", runId: "run-3", role: "user", text: "b", streaming: false }] },
    ]);

    await store.getState().send("c-a", "再问");
    const used = new Set(
      Object.values(store.getState().timelines)
        .flat()
        .flatMap((i) => (i.kind === "compact" ? [] : [i.runId])),
    );
    // 3 distinct runs: the two restored ones plus the new one.
    expect(used.size).toBe(3);
  });

  it("hands momo's persona context to the host on create (轮 2 卡 A)", async () => {
    const bridge = makeClient(["conv-p"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolvePersonaContext: () => ({
        mode: "workbench",
        personaText: "你是严谨导师。",
        talkStyle: 1,
        webSearchEnabled: false,
      }),
    });

    await store.getState().createConversation({ source: "workbench" });

    // personaText is the RESOLVED card body — the host has no card registry, so
    // sending personaCardId would leave layer ④ unresolvable.
    expect(bridge.calls[0]).toEqual({
      channel: "bridge:createConversation",
      request: {
        providerId: "provider-a",
        modelId: "model-a",
        purpose: "main",
        mode: "workbench",
        personaText: "你是严谨导师。",
        talkStyle: 1,
        webSearchEnabled: false,
      },
    });
  });

  it("omits persona fields when no resolver is wired (back-compat)", async () => {
    const bridge = makeClient(["conv-q"]);
    const store = createConversationsStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });
    await store.getState().createConversation({ source: "buddy" });
    expect(bridge.calls[0].request).toEqual({
      providerId: "provider-a",
      modelId: "model-a",
      purpose: "main",
    });
  });

  it("sends the enabled skills allow-list on create (轮 2 卡 E)", async () => {
    const bridge = makeClient(["conv-s"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveEnabledSkills: () => ["leemo:pdf"],
    });
    await store.getState().createConversation({ source: "buddy" });
    expect((bridge.calls[0].request as { enabledSkills?: string[] }).enabledSkills).toEqual([
      "leemo:pdf",
    ]);
  });

  it("sends an EMPTY array when the user disabled every skill (≠ omitting it)", async () => {
    // sdk.d.ts:1877 — an omitted `skills` means "CLI defaults apply", NOT
    // skills-off. So "all switched off" has to travel as [], or a disabled skill
    // keeps firing.
    const bridge = makeClient(["conv-s0"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveEnabledSkills: () => [],
    });
    await store.getState().createConversation({ source: "buddy" });
    const request = bridge.calls[0].request as Record<string, unknown>;
    expect("enabledSkills" in request).toBe(true);
    expect(request.enabledSkills).toEqual([]);
  });

  it("OMITS enabledSkills when the resolver returns undefined (no skills installed)", async () => {
    const bridge = makeClient(["conv-s1"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveEnabledSkills: () => undefined,
    });
    await store.getState().createConversation({ source: "buddy" });
    expect("enabledSkills" in (bridge.calls[0].request as Record<string, unknown>)).toBe(false);
  });

  it("omits enabledSkills entirely when no resolver is wired (back-compat)", async () => {
    const bridge = makeClient(["conv-s2"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    await store.getState().createConversation({ source: "buddy" });
    expect("enabledSkills" in (bridge.calls[0].request as Record<string, unknown>)).toBe(false);
  });

  it("resolves enabled skills per create, so a toggle takes effect next conversation", async () => {
    const bridge = makeClient(["cs1", "cs2"]);
    let enabled = ["leemo:pdf"];
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveEnabledSkills: () => enabled,
    });
    await store.getState().createConversation({ source: "buddy" });
    enabled = []; // user switches it off on the SkillsPage
    await store.getState().createConversation({ source: "buddy" });
    expect((bridge.calls[0].request as { enabledSkills: string[] }).enabledSkills).toEqual([
      "leemo:pdf",
    ]);
    expect((bridge.calls[1].request as { enabledSkills: string[] }).enabledSkills).toEqual([]);
  });

  it("resolves persona context per create, so settings changes take effect", async () => {
    const bridge = makeClient(["c1", "c2"]);
    let mode: "buddy" | "workbench" = "buddy";
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolvePersonaContext: () => ({ mode, personaText: "你是 momo。", talkStyle: 2, webSearchEnabled: false }),
    });

    await store.getState().createConversation({ source: "buddy" });
    mode = "workbench"; // user flips the mode between conversations
    await store.getState().createConversation({ source: "workbench" });

    expect((bridge.calls[0].request as { mode: string }).mode).toBe("buddy");
    expect((bridge.calls[1].request as { mode: string }).mode).toBe("workbench");
  });

  it("binds workbench conversations to the active workspace and keeps buddy conversations global", async () => {
    const bridge = makeClient(["work-conv", "buddy-conv"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveActiveWorkspaceId: () => "workspace-123",
    });

    const workId = await store.getState().createConversation({ source: "workbench" });
    const buddyId = await store.getState().createConversation({ source: "buddy" });

    expect(bridge.calls[0].request).toMatchObject({ workspaceId: "workspace-123" });
    expect(store.getState().byId[workId].workspaceId).toBe("workspace-123");
    expect(bridge.calls[1].request).toMatchObject({ workspaceId: "leemo-home" });
    expect(store.getState().byId[buddyId].workspaceId).toBe("leemo-home");
  });

  it("reclaims a restored conversation in its original workspace", async () => {
    const bridge = makeClient(["ignored"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      resolveActiveWorkspaceId: () => "leemo-home",
    });
    store.getState().hydrate([{
      meta: {
        id: "external-conv",
        title: "项目记录",
        titleManuallyUpdated: false,
        bookId: null,
        workspaceId: "workspace-123",
        source: "workbench",
        providerId: "provider-a",
        modelId: "model-a",
        createdAt: 1,
        lastActivityAt: 2,
        unread: false,
      },
      timeline: [],
    }]);

    await store.getState().send("external-conv", "继续");

    const claim = bridge.calls.find((call) => call.channel === "bridge:createConversation");
    expect(claim?.request).toMatchObject({
      conversationId: "external-conv",
      workspaceId: "workspace-123",
    });
  });

  // ── 轮 7 A3: broadcastContext ─────────────────────────────────────────────
  //
  // 「per create」不够 —— 用户会在**已经开着的**对话里改设置然后接着问。实测过
  // 那条路：开关开了，momo 仍说「这轮对话里我的网络访问是关的」。
  describe("broadcastContext (轮 7 A3)", () => {
    it("pushes the current context to every host-live conversation", async () => {
      const bridge = makeClient(["c1", "c2"]);
      let searchOn = false;
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolvePersonaContext: () => ({
          mode: "buddy", personaText: "你是 momo。", talkStyle: 2, webSearchEnabled: searchOn,
        }),
      });
      await store.getState().createConversation({ source: "buddy" });
      await store.getState().createConversation({ source: "buddy" });

      searchOn = true; // 用户在设置页打开联网
      const reached = await store.getState().broadcastContext();

      expect(reached.sort()).toEqual(["c1", "c2"]);
      const updates = bridge.calls.filter((c) => c.channel === "bridge:updateContext");
      expect(updates).toHaveLength(2);
      // 送的是**当前**值，不是建对话时那份快照。
      for (const u of updates) {
        expect(u.request).toMatchObject({ webSearchEnabled: true });
      }
    });

    it("reaches nothing when no conversation exists (so the UI can say just「已保存」)", async () => {
      const bridge = makeClient([]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolvePersonaContext: () => ({
          mode: "buddy", personaText: "你是 momo。", talkStyle: 2, webSearchEnabled: true,
        }),
      });
      expect(await store.getState().broadcastContext()).toEqual([]);
      expect(bridge.calls.filter((c) => c.channel === "bridge:updateContext")).toHaveLength(0);
    });

    it("one failing conversation does not stop the others", async () => {
      const bridge = makeClient(["c1", "c2"]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolvePersonaContext: () => ({
          mode: "buddy", personaText: "你是 momo。", talkStyle: 2, webSearchEnabled: true,
        }),
      });
      await store.getState().createConversation({ source: "buddy" });
      await store.getState().createConversation({ source: "buddy" });
      // c1 was torn down host-side (restart, dispose) — a broadcast must not die on it.
      bridge.failUpdateFor?.("c1");
      const reached = await store.getState().broadcastContext();
      expect(reached).toEqual(["c2"]);
    });

    it("does nothing when there is no persona resolver (fixture/browser dev)", async () => {
      const bridge = makeClient(["c1"]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      await store.getState().createConversation({ source: "buddy" });
      expect(await store.getState().broadcastContext()).toEqual([]);
    });
  });

  it("resolves defaults dynamically and atomically registers only a successful main conversation", async () => {
    const bridge = makeClient(["conv-one"]);
    let defaults = { providerId: "provider-a", modelId: "model-a" };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => defaults,
      now: () => 123,
    });

    defaults = { providerId: "provider-b", modelId: "model-b" };
    await expect(store.getState().createConversation({ source: "workbench", bookId: "book-7" })).resolves.toBe("conv-one");

    expect(bridge.calls[0]).toEqual({
      channel: "bridge:createConversation",
      request: {
        providerId: "provider-b",
        modelId: "model-b",
        purpose: "main",
        // 轮 3 卡 G: an explicit bookId now also crosses as notebookId, so the
        // host can overlay <notebook>/CLAUDE.md as prompt layer ⑨.
        notebookId: "book-7",
      },
    });
    expect(store.getState()).toMatchObject({
      activeId: "conv-one",
      order: ["conv-one"],
      openTabs: [],
      timelines: { "conv-one": [] },
      runIds: { "conv-one": null },
      byId: {
        "conv-one": {
          id: "conv-one", title: "新对话", titleManuallyUpdated: false,
          source: "workbench", bookId: "book-7", providerId: "provider-b", modelId: "model-b",
          createdAt: 123, lastActivityAt: 123, unread: false,
        },
      },
    });

    const rejected = createConversationsStore({
      invoke: async () => { throw new Error("offline"); },
      subscribe: () => () => {},
    } as unknown as BridgeClient, { resolveConversationDefaults: () => DEFAULTS });
    await expect(rejected.getState().createConversation({ source: "buddy" })).rejects.toThrow("offline");
    expect(rejected.getState().byId).toEqual({});
  });

  it("sends only to the named conversation, assigns different local run IDs, and invokes its explicit id", async () => {
    const { bridge, store, a, b } = await registerTwo();

    await store.getState().send(a, "first task");
    await store.getState().send(b, "second task");
    const state = store.getState();
    const aUser = state.timelines[a][0] as Extract<TimelineItem, { kind: "text" }>;
    const bUser = state.timelines[b][0] as Extract<TimelineItem, { kind: "text" }>;

    expect(aUser).toMatchObject({ kind: "text", role: "user", text: "first task", runId: state.runIds[a] });
    expect(bUser).toMatchObject({ kind: "text", role: "user", text: "second task", runId: state.runIds[b] });
    expect(state.runIds[a]).not.toBe(state.runIds[b]);
    expect(bridge.calls.filter((call) => call.channel === "bridge:send")).toEqual([
      { channel: "bridge:send", request: { conversationId: a, prompt: "first task", sourceMessageId: "u0" } },
      { channel: "bridge:send", request: { conversationId: b, prompt: "second task", sourceMessageId: "u0" } },
    ]);
  });

  it("applies the composer's real plan mode before sending the turn", async () => {
    const { bridge, store, a } = await registerTwo();

    await store.getState().send(a, "先给方案，不要改文件", undefined, undefined, {
      permissionMode: "plan",
    });

    const updateIndex = bridge.calls.findIndex((call) => call.channel === "bridge:updateContext");
    const sendIndex = bridge.calls.findIndex((call) => call.channel === "bridge:send");
    expect(bridge.calls[updateIndex]).toEqual({
      channel: "bridge:updateContext",
      request: { conversationId: a, permissionMode: "plan" },
    });
    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(sendIndex).toBeGreaterThan(updateIndex);
  });

  it("persists a conversation goal and sends it only while the goal is active", async () => {
    const { bridge, store, a, b } = await registerTwo();
    const goals = store.getState() as ReturnType<typeof store.getState> & {
      setGoal: (conversationId: string, text: string) => Promise<void>;
      toggleGoalPaused: (conversationId: string) => Promise<void>;
    };

    await goals.setGoal(a, "完成主界面视觉复现");
    await goals.setGoal(b, "整理下一轮内测清单");
    await goals.toggleGoalPaused(b);

    expect(store.getState().byId[a]).toMatchObject({
      goal: { text: "完成主界面视觉复现", status: "active" },
    });
    expect(store.getState().byId[b]).toMatchObject({
      goal: { text: "整理下一轮内测清单", status: "paused" },
    });

    await store.getState().send(a, "继续实现");
    await store.getState().send(b, "先处理别的事情");

    const sends = bridge.calls.filter((call) => call.channel === "bridge:send");
    expect(sends.at(-2)).toMatchObject({ request: { goalText: "完成主界面视觉复现" } });
    expect(sends.at(-1)).not.toHaveProperty("request.goalText");
  });

  it("forwards note reference ids without adding note bodies to the visible timeline", async () => {
    const { bridge, store, a } = await registerTwo();

    await store.getState().send(a, "帮我比较这两条", undefined, undefined, {
      noteReferences: ["note-1", "note-2"],
    });

    expect(bridge.calls.filter((call) => call.channel === "bridge:send").at(-1)).toEqual({
      channel: "bridge:send",
      request: {
        conversationId: a,
        prompt: "帮我比较这两条",
        sourceMessageId: "u0",
        noteReferences: ["note-1", "note-2"],
      },
    });
    expect(store.getState().timelines[a].at(-1)).toMatchObject({ text: "帮我比较这两条" });
  });

  it("adds guidance to the active run without replacing its run id", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "先整理资料");
    const runId = store.getState().runIds[a];

    await expect(store.getState().guide(a, "补充：先看第三章")).resolves.toEqual({ delivery: "applied" });

    expect(store.getState().runIds[a]).toBe(runId);
    expect(store.getState().timelines[a].at(-1)).toMatchObject({
      kind: "text", role: "user", text: "补充：先看第三章", runId,
    });
    expect(bridge.calls.at(-1)).toEqual({
      channel: "bridge:guide",
      request: { conversationId: a, prompt: "补充：先看第三章" },
    });
  });

  it("forwards real attachment refs but persists only safe display metadata", async () => {
    const { bridge, store, a } = await registerTwo();
    const attachments = [{
      name: "简历.pdf",
      path: "C:\\Users\\Rengar\\Downloads\\简历.pdf",
      size: 2048,
      mimeType: "application/pdf",
    }];

    await store.getState().send(a, "帮我改简历", attachments);

    expect(bridge.calls.filter((call) => call.channel === "bridge:send").at(-1)).toEqual({
      channel: "bridge:send",
      request: { conversationId: a, prompt: "帮我改简历", sourceMessageId: "u0", attachments },
    });
    const user = store.getState().timelines[a].at(-1);
    expect(user).toMatchObject({
      kind: "text",
      role: "user",
      attachments: [{ name: "简历.pdf", size: 2048, mimeType: "application/pdf" }],
    });
    expect(JSON.stringify(user)).not.toContain("C:\\\\Users");
  });

  it("keeps workspace references relative in renderer state and forwards them separately", async () => {
    const { bridge, store, a } = await registerTwo();
    const workspaceFiles = [{ name: "计划.md", workspaceId: "leemo-home", workspacePath: "课程/计划.md" }];

    await store.getState().send(a, "继续整理", undefined, workspaceFiles);

    expect(bridge.calls.filter((call) => call.channel === "bridge:send").at(-1)).toEqual({
      channel: "bridge:send",
      request: { conversationId: a, prompt: "继续整理", sourceMessageId: "u0", workspaceFiles },
    });
    expect(store.getState().timelines[a].at(-1)).toMatchObject({
      kind: "text",
      attachments: [{
        name: "计划.md",
        sourceKind: "workspace",
        workspaceId: "leemo-home",
        workspacePath: "课程/计划.md",
      }],
    });
    expect(JSON.stringify(store.getState().timelines[a].at(-1))).not.toMatch(/[A-Z]:\\/i);
  });

  it("can keep an app-generated prompt out of the visible conversation", async () => {
    const { bridge, store, a } = await registerTwo();

    await store.getState().send(
      a,
      "<records>今天处理了简历和两条任务记录</records>",
      undefined,
      undefined,
      { displayText: "回顾今天" },
    );

    expect(bridge.calls.filter((call) => call.channel === "bridge:send").at(-1)).toEqual({
      channel: "bridge:send",
      request: {
        conversationId: a,
        prompt: "<records>今天处理了简历和两条任务记录</records>",
        sourceMessageId: "u0",
      },
    });
    expect(store.getState().timelines[a].at(-1)).toMatchObject({
      kind: "text",
      role: "user",
      text: "回顾今天",
    });
  });

  it("rolls back the optimistic turn when the host rejects the send", async () => {
    const bridge = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:createConversation") return { conversationId: "conv-fail" };
        if (channel === "bridge:send") throw new Error("附件已经被移动");
        return undefined;
      }),
      subscribe: () => () => {},
    } as unknown as BridgeClient;
    const store = createConversationsStore(bridge, { resolveConversationDefaults: () => DEFAULTS });
    const id = await store.getState().createConversation({ source: "workbench" });

    await expect(store.getState().send(id, "看看")).rejects.toThrow("附件已经被移动");
    expect(store.getState().timelines[id]).toEqual([]);
    expect(store.getState().runIds[id]).toBeNull();
    expect(store.getState().pendingSends[id]).toBeUndefined();
  });

  it("disposes a never-sent empty conversation but protects conversations with content", async () => {
    const { bridge, store, a, b } = await registerTwo();

    await expect(store.getState().discardEmptyConversation(a)).resolves.toBe(true);
    expect(store.getState().byId[a]).toBeUndefined();
    expect(store.getState().timelines[a]).toBeUndefined();
    expect(store.getState().order).not.toContain(a);
    expect(bridge.calls).toContainEqual({
      channel: "bridge:disposeConversation",
      request: { conversationId: a },
    });

    await store.getState().send(b, "保留这条真实消息");
    await expect(store.getState().discardEmptyConversation(b)).resolves.toBe(false);
    expect(store.getState().byId[b]).toBeDefined();
    expect(store.getState().timelines[b]).toHaveLength(1);
  });

  it("restores the previous retry draft when a replacement send is rejected before acknowledgement", async () => {
    const { bridge, store, a } = await registerTwo();
    const originalAttachments = [{
      name: "原始截图.png",
      path: "C:\\Temp\\Leemo\\original.png",
      size: 128,
      mimeType: "image/png",
    }];
    await store.getState().send(a, "先识别这张图", originalAttachments);
    bridge.emit({ conversationId: a, event: { type: "error", message: "模型服务暂时不可用" } });
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "error", isError: true, finalText: "", pathAudit: { claimed: [] },
    } });
    const previousPending = store.getState().pendingSends[a];
    const previousTimeline = store.getState().timelines[a];
    expect(previousPending).toMatchObject({
      text: "先识别这张图",
      attachments: originalAttachments,
      errorMessage: "模型服务暂时不可用",
    });

    vi.mocked(bridge.client.invoke).mockRejectedValueOnce(new Error("新附件已经被移动"));
    await expect(store.getState().send(a, "改做另一件事")).rejects.toThrow("新附件已经被移动");

    expect(store.getState().pendingSends[a]).toEqual(previousPending);
    expect(store.getState().timelines[a]).toEqual(previousTimeline);
    expect(store.getState().runIds[a]).toBeNull();
  });

  it("rejects a second turn while the same conversation is still running", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "第一轮还在执行");
    const firstRunId = store.getState().runIds[a];
    const firstPending = store.getState().pendingSends[a];
    const firstTimeline = store.getState().timelines[a];

    await expect(store.getState().send(a, "不应并发的第二轮")).rejects.toThrow(
      "这个对话仍在执行，请等待完成或先停止后再发送。",
    );

    expect(store.getState().runIds[a]).toBe(firstRunId);
    expect(store.getState().pendingSends[a]).toEqual(firstPending);
    expect(store.getState().timelines[a]).toEqual(firstTimeline);
    expect(bridge.calls.filter((call) => call.channel === "bridge:send")).toHaveLength(1);
  });

  it("queues the complete next turn in memory without interrupting the active run", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "第一轮还在执行");
    const attachments = [{
      name: "岗位截图.png",
      path: "C:\\Temp\\岗位截图.png",
      size: 2048,
      mimeType: "image/png",
    }];
    const workspaceFiles = [{
      name: "简历.md",
      workspaceId: "workspace-job",
      workspacePath: "求职/简历.md",
    }];

    const queuedId = store.getState().enqueueTurn(
      a,
      "下一轮按岗位要求改简历",
      attachments,
      workspaceFiles,
      { noteReferences: ["note-job"], allowSubagents: false },
    );

    expect(store.getState().queuedTurns[a]).toEqual([{
      id: queuedId,
      text: "下一轮按岗位要求改简历",
      attachments,
      workspaceFiles,
      noteReferences: ["note-job"],
      allowSubagents: false,
    }]);
    expect(bridge.calls.filter((call) => call.channel === "bridge:send")).toHaveLength(1);
  });

  it("flushes a background conversation queue after every terminal event and preserves all turn inputs", async () => {
    const { bridge, store, a, b } = await registerTwo();
    await store.getState().send(a, "A 第一轮");
    store.getState().switchActive(b);
    const attachments = [{ name: "JD.pdf", path: "C:\\Temp\\JD.pdf", size: 512, mimeType: "application/pdf" }];
    const workspaceFiles = [{ name: "简历.md", workspaceId: "workspace-job", workspacePath: "求职/简历.md" }];
    store.getState().enqueueTurn(a, "A 第二轮", attachments, workspaceFiles, {
      noteReferences: ["note-1"],
      allowSubagents: false,
    });

    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "A done", pathAudit: { claimed: [] },
    } });

    await vi.waitFor(() => expect(bridge.calls.filter((call) => call.channel === "bridge:send")).toHaveLength(2));
    expect(bridge.calls.filter((call) => call.channel === "bridge:send").at(-1)).toEqual({
      channel: "bridge:send",
      request: {
        conversationId: a,
        prompt: "A 第二轮",
        sourceMessageId: "u2",
        attachments,
        workspaceFiles,
        noteReferences: ["note-1"],
        allowSubagents: false,
      },
    });
    expect(store.getState().queuedTurns[a]).toEqual([]);
    expect(store.getState().activeId).toBe(b);
  });

  it("advances exactly one queued turn after each terminal event", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "第一轮");
    store.getState().enqueueTurn(a, "第二轮");
    store.getState().enqueueTurn(a, "第三轮");

    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "first done", pathAudit: { claimed: [] },
    } });
    await vi.waitFor(() => expect(bridge.calls.filter((call) => call.channel === "bridge:send")).toHaveLength(2));
    expect(store.getState().queuedTurns[a]?.map((turn) => turn.text)).toEqual(["第三轮"]);

    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "second done", pathAudit: { claimed: [] },
    } });
    await vi.waitFor(() => expect(bridge.calls.filter((call) => call.channel === "bridge:send")).toHaveLength(3));
    expect(store.getState().queuedTurns[a]).toEqual([]);
  });

  it("keeps a failed auto-send at the queue head with a readable error", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "第一轮");
    store.getState().enqueueTurn(a, "下一轮仍要保留");
    vi.mocked(bridge.client.invoke).mockRejectedValueOnce(new Error("附件已经被移动"));

    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "first done", pathAudit: { claimed: [] },
    } });

    await vi.waitFor(() => expect(store.getState().queuedTurns[a]?.[0]?.errorMessage).toBe("附件已经被移动"));
    expect(store.getState().queuedTurns[a]?.[0]).toMatchObject({ text: "下一轮仍要保留" });
  });

  it("turns only a pure-text queued turn into native guidance", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "第一轮");
    const pureId = store.getState().enqueueTurn(a, "优先保留原文件");

    await expect(store.getState().guideQueuedTurn(a, pureId)).resolves.toEqual({ delivery: "applied" });
    expect(store.getState().queuedTurns[a]).toEqual([]);
    expect(bridge.calls.filter((call) => call.channel === "bridge:guide").at(-1)).toEqual({
      channel: "bridge:guide",
      request: { conversationId: a, prompt: "优先保留原文件" },
    });

    const richId = store.getState().enqueueTurn(a, "结合附件继续", [{
      name: "资料.pdf", path: "C:\\Temp\\资料.pdf", size: 1,
    }]);
    await expect(store.getState().guideQueuedTurn(a, richId)).rejects.toThrow("含附件、文件或便签的消息不能转为引导");
    expect(store.getState().queuedTurns[a]).toHaveLength(1);
  });

  it("allows only one restored-conversation claim while the first send is awaiting the host", async () => {
    let resolveClaim!: () => void;
    const claimPending = new Promise<void>((resolve) => { resolveClaim = resolve; });
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "bridge:createConversation") await claimPending;
      return undefined;
    });
    const bridge = {
      invoke,
      subscribe: () => () => {},
    } as unknown as BridgeClient;
    const store = createConversationsStore(bridge, { resolveConversationDefaults: () => DEFAULTS });
    store.getState().hydrate([{
      meta: {
        id: "restored-claim", title: "恢复的对话", titleManuallyUpdated: true,
        bookId: null, source: "buddy", providerId: "provider-a", modelId: "model-a",
        createdAt: 1, lastActivityAt: 1, unread: false,
      },
      timeline: [],
    }]);

    const first = store.getState().send("restored-claim", "第一轮");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:createConversation",
      expect.objectContaining({ conversationId: "restored-claim" }),
    ));
    const secondCheck = expect(store.getState().send("restored-claim", "并发第二轮")).rejects.toThrow(
      "这个对话仍在执行，请等待完成或先停止后再发送。",
    );
    resolveClaim();

    await Promise.all([first, secondCheck]);
    expect(invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);
    expect(invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(1);
    expect(store.getState().timelines["restored-claim"]).toEqual([
      expect.objectContaining({ kind: "text", role: "user", text: "第一轮" }),
    ]);
    expect(store.getState().pendingSends["restored-claim"]?.runId)
      .toBe(store.getState().runIds["restored-claim"]);
  });

  it("keeps the full retryable draft in memory across the host acknowledgement", async () => {
    let acknowledge!: () => void;
    const acknowledged = new Promise<void>((resolve) => { acknowledge = resolve; });
    const bridge = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:createConversation") return { conversationId: "conv-pending" };
        if (channel === "bridge:send") await acknowledged;
        return undefined;
      }),
      subscribe: () => () => {},
    } as unknown as BridgeClient;
    const store = createConversationsStore(bridge, { resolveConversationDefaults: () => DEFAULTS });
    const id = await store.getState().createConversation({ source: "workbench" });
    const attachments = [{
      name: "截图.png",
      path: "C:\\Users\\Rengar\\Pictures\\截图.png",
      size: 4096,
      mimeType: "image/png",
    }];

    const sending = store.getState().send(id, "看一下这张图", attachments);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().pendingSends[id]).toMatchObject({
      runId: store.getState().runIds[id],
      text: "看一下这张图",
      attachments,
      providerId: DEFAULTS.providerId,
      modelId: DEFAULTS.modelId,
    });
    acknowledge();
    await sending;
    expect(store.getState().pendingSends[id]?.attachments).toEqual(attachments);
  });

  it("turns a post-ack run error into a retry draft and clears it only after success or interruption", async () => {
    const { bridge, store, a } = await registerTwo();
    const attachments = [{
      name: "照片.jpg",
      path: "C:\\Users\\Rengar\\Pictures\\照片.jpg",
      size: 1024,
      mimeType: "image/jpeg",
    }];
    await store.getState().send(a, "识别这里", attachments);
    const failedRunId = store.getState().runIds[a];

    bridge.emit({ conversationId: a, event: { type: "error", message: "服务暂时不可用" } });
    expect(store.getState().pendingSends[a]).toMatchObject({
      runId: failedRunId,
      errorMessage: "服务暂时不可用",
    });
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "error", isError: true, finalText: "", pathAudit: { claimed: [] },
    } });
    expect(store.getState().runIds[a]).toBeNull();
    expect(store.getState().pendingSends[a]).toMatchObject({
      runId: failedRunId,
      text: "识别这里",
      attachments,
      errorMessage: "服务暂时不可用",
    });

    await store.getState().retry(a);
    expect(store.getState().pendingSends[a]?.errorMessage).toBeUndefined();
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "完成", pathAudit: { claimed: [] },
    } });
    expect(store.getState().pendingSends[a]).toBeUndefined();

    await store.getState().send(a, "再试一次", attachments);
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "interrupted", isError: false, finalText: "", pathAudit: { claimed: [] },
    } });
    expect(store.getState().pendingSends[a]).toBeUndefined();
  });

  it("offers retry only for failures the host classified as retryable", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "先试一次");
    bridge.emit({ conversationId: a, event: {
      type: "run.finished",
      subtype: "error_during_execution",
      outcome: "overloaded",
      retryable: true,
      statusCode: 529,
      isError: true,
      finalText: "服务商当前过载（529）。自动重试仍未恢复，请稍后重试或换一个模型。",
      pathAudit: { claimed: [] },
    } });
    expect(store.getState().pendingSends[a]?.errorMessage).toMatch(/过载/);

    await store.getState().send(a, "不允许写入");
    bridge.emit({ conversationId: a, event: {
      type: "run.finished",
      subtype: "error_during_execution",
      outcome: "permission-denied",
      retryable: false,
      isError: true,
      finalText: "这项操作没有获得允许。",
      pathAudit: { claimed: [] },
    } });
    expect(store.getState().pendingSends[a]).toBeUndefined();
  });

  it("preserves the turn's disabled-helper choice when retrying a failed run", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "这轮不要召集助手", undefined, undefined, {
      allowSubagents: false,
    });
    bridge.emit({ conversationId: a, event: { type: "error", message: "服务暂时不可用" } });
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "error", isError: true, finalText: "", pathAudit: { claimed: [] },
    } });

    await store.getState().retry(a);

    const sends = bridge.calls.filter((call) => call.channel === "bridge:send");
    expect(sends).toHaveLength(2);
    expect(sends[0].request).toMatchObject({ allowSubagents: false });
    expect(sends[1].request).toMatchObject({ allowSubagents: false });
  });

  it("retries with the complete draft through the conversation's newly selected model", async () => {
    const { bridge, store, a } = await registerTwo();
    const attachments = [{
      name: "原图.png",
      path: "C:\\Users\\Rengar\\Pictures\\原图.png",
      size: 512,
      mimeType: "image/png",
    }];
    await store.getState().send(a, "读图", attachments);
    bridge.emit({ conversationId: a, event: { type: "error", message: "当前模型请求失败" } });
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "error", isError: true, finalText: "", pathAudit: { claimed: [] },
    } });
    await store.getState().setModelForConversation(a, "provider-b", "vision-b");

    await store.getState().retry(a);

    expect(bridge.calls.filter((call) => call.channel === "bridge:send").at(-1)).toEqual({
      channel: "bridge:send",
      request: { conversationId: a, prompt: "读图", sourceMessageId: "u3", attachments },
    });
    expect(store.getState().pendingSends[a]).toMatchObject({
      providerId: "provider-b",
      modelId: "vision-b",
      attachments,
    });
  });

  it("dismisses a failed retry draft without persisting it through hydrate", async () => {
    const { bridge, store, a } = await registerTwo();
    await store.getState().send(a, "临时问题");
    bridge.emit({ conversationId: a, event: { type: "error", message: "失败" } });
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "error", isError: true, finalText: "", pathAudit: { claimed: [] },
    } });
    expect(store.getState().pendingSends[a]).toBeDefined();

    store.getState().dismissRetry(a);
    expect(store.getState().pendingSends[a]).toBeUndefined();

    await store.getState().send(a, "不会落盘");
    expect(store.getState().pendingSends[a]).toBeDefined();
    store.getState().hydrate([]);
    expect(store.getState().pendingSends).toEqual({});
  });

  it("routes interleaved A/B events by envelope cid rather than activeId", async () => {
    const { bridge, store, a, b } = await registerTwo();
    await store.getState().send(a, "A starts");
    await store.getState().send(b, "B starts");
    store.getState().switchActive(b);

    bridge.emit({ conversationId: a, event: { type: "text.delta", text: "A delta" } });
    bridge.emit({ conversationId: b, event: { type: "text.delta", text: "B delta" } });

    expect(store.getState().activeId).toBe(b);
    expect(store.getState().timelines[a]).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", role: "momo", text: "A delta", runId: store.getState().runIds[a] }),
    ]));
    expect(store.getState().timelines[b]).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", role: "momo", text: "B delta", runId: store.getState().runIds[b] }),
    ]));
  });

  it("folds A finish with A's old run, clears only A, marks it unread, and switchActive clears it without IPC", async () => {
    const { bridge, store, a, b } = await registerTwo();
    await store.getState().send(a, "A starts");
    await store.getState().send(b, "B starts");
    store.getState().switchActive(b);
    const oldARun = store.getState().runIds[a];
    const oldBRun = store.getState().runIds[b];
    const callsBeforeFinish = bridge.calls.length;

    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "A done", pathAudit: { claimed: [] },
    } });

    const state = store.getState();
    expect(latestByKind(state.timelines[a], "result")).toMatchObject({ kind: "result", runId: oldARun, finalText: "A done" });
    expect(state.runIds[a]).toBeNull();
    expect(state.runIds[b]).toBe(oldBRun);
    expect(state.byId[a].unread).toBe(true);
    expect(state.byId[b].unread).toBe(false);
    store.getState().switchActive(a);
    expect(store.getState().byId[a].unread).toBe(false);
    expect(bridge.calls).toHaveLength(callsBeforeFinish);
  });

  it("derives a useful local title instead of copying request boilerplate and absolute paths", () => {
    expect(deriveConversationTitle("请帮我把 E:\\Leemo\\src\\main\\main.ts 里的外链问题修好，并跑测试"))
      .toBe("把 main.ts 里的外链问题修好");
    expect(deriveConversationTitle("需求：分析这份简历，找出最影响求职的问题"))
      .toBe("分析这份简历");
    expect(deriveConversationTitle("", ["秋招简历.pdf"]))
      .toBe("秋招简历.pdf");
  });

  it("auto-titles locally, then preserves a manually renamed title", async () => {
    const { bridge, store, a } = await registerTwo();
    const prompt = "请帮我分析这份课程报告，给出修改建议";

    await store.getState().send(a, prompt);
    expect(store.getState().byId[a].title).toBe("分析这份课程报告");
    bridge.emit({ conversationId: a, event: {
      type: "run.finished", subtype: "success", isError: false, finalText: "完成", pathAudit: { claimed: [] },
    } });
    store.getState().renameTitle(a, "我自己命名");
    await store.getState().send(a, "this must not replace the title");
    expect(store.getState().byId[a]).toMatchObject({ title: "我自己命名", titleManuallyUpdated: true });
  });

  it("rejects a blank manual title and trims a valid one", async () => {
    const { store, a } = await registerTwo();
    store.getState().renameTitle(a, "   ");
    expect(store.getState().byId[a].title).toBe("新对话");
    store.getState().renameTitle(a, "  秋招准备  ");
    expect(store.getState().byId[a]).toMatchObject({ title: "秋招准备", titleManuallyUpdated: true });
  });

  it("moves activity to the front without duplicate order entries", async () => {
    const { bridge, store, a, b } = await registerTwo();
    expect(store.getState().order).toEqual([b, a]);

    await store.getState().send(a, "A moves front");
    expect(store.getState().order).toEqual([a, b]);
    bridge.emit({ conversationId: b, event: { type: "text.delta", text: "B moves front" } });
    expect(store.getState().order).toEqual([b, a]);
    expect(new Set(store.getState().order).size).toBe(store.getState().order.length);
  });

  it("deduplicates tabs, caps at five, and selects the specified neighbor when closing active tabs", async () => {
    const bridge = makeClient(["a", "b", "c", "d", "e", "f"]);
    const store = createConversationsStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });
    const ids = await Promise.all(Array.from({ length: 6 }, () => store.getState().createConversation({ source: "workbench" })));
    for (const id of ids) store.getState().openTab(id);
    store.getState().openTab(ids[0]);
    expect(store.getState().openTabs).toEqual(ids.slice(0, 5));

    store.getState().switchActive(ids[2]);
    store.setState((state) => ({
      byId: {
        ...state.byId,
        [ids[1]]: { ...state.byId[ids[1]], unread: true },
      },
    }));
    store.getState().closeTab(ids[2]);
    expect(store.getState().activeId).toBe(ids[1]);
    expect(store.getState().byId[ids[1]].unread).toBe(false);
    expect(store.getState().openTabs).not.toContain(ids[2]);

    store.getState().switchActive(ids[0]);
    store.getState().closeTab(ids[0]);
    expect(store.getState().activeId).toBe(ids[1]);

    for (const id of [...store.getState().openTabs]) store.getState().closeTab(id);
    expect(store.getState()).toMatchObject({ openTabs: [], activeId: null });
  });

  it("updates model only for the explicit registered id, interrupts explicitly, and rejects unknown async actions before IPC", async () => {
    const { bridge, store, a, b } = await registerTwo();
    await store.getState().setModelForConversation(b, "provider-b", "model-b2");
    await store.getState().interrupt(a);
    expect(store.getState().byId[a].modelId).toBe(DEFAULTS.modelId);
    expect(store.getState().byId[b]).toMatchObject({ providerId: "provider-b", modelId: "model-b2" });
    expect(bridge.calls.slice(-2)).toEqual([
      { channel: "bridge:setModel", request: { conversationId: b, providerId: "provider-b", modelId: "model-b2" } },
      { channel: "bridge:interrupt", request: { conversationId: a } },
    ]);

    const callsBefore = bridge.calls.length;
    await expect(store.getState().send("missing", "nope")).rejects.toThrow(/unknown conversation/i);
    await expect(store.getState().interrupt("missing")).rejects.toThrow(/unknown conversation/i);
    await expect(store.getState().setModelForConversation("missing", "provider", "m")).rejects.toThrow(/unknown conversation/i);
    expect(bridge.calls).toHaveLength(callsBefore);
    expect(store.getState().timelines.missing).toBeUndefined();
  });

  it("deduplicates Stop while host cleanup is pending and clears the stopping acknowledgement afterward", async () => {
    let releaseStop!: () => void;
    const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: "conv-stop" };
      if (channel === "bridge:interrupt") {
        await stopGate;
        return { state: "stopped" };
      }
      return undefined;
    });
    const store = createConversationsStore({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as unknown as BridgeClient, { resolveConversationDefaults: () => DEFAULTS });
    const conversationId = await store.getState().createConversation({ source: "buddy" });

    const firstStop = store.getState().interrupt(conversationId);
    await Promise.resolve();
    expect(store.getState().stoppingById[conversationId]).toBe(true);
    await store.getState().interrupt(conversationId);
    expect(invoke.mock.calls.filter(([channel]) => channel === "bridge:interrupt")).toHaveLength(1);

    releaseStop();
    await firstStop;
    expect(store.getState().stoppingById[conversationId]).toBeUndefined();
  });

  it("keeps an unverified Stop visibly locked and ignores later Stop clicks", async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: "conv-locked" };
      if (channel === "bridge:interrupt") return { state: "locked" };
      return undefined;
    });
    const store = createConversationsStore({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as unknown as BridgeClient, { resolveConversationDefaults: () => DEFAULTS });
    const conversationId = await store.getState().createConversation({ source: "buddy" });

    await store.getState().interrupt(conversationId);
    expect(store.getState().stopLockedById[conversationId]).toBe(true);
    await store.getState().interrupt(conversationId);
    expect(invoke.mock.calls.filter(([channel]) => channel === "bridge:interrupt")).toHaveLength(1);
  });

  it("keeps failed setModel updates out of state", async () => {
    const bridge = makeClient(["conv-a"]);
    const client = {
      ...bridge.client,
      invoke: async (channel: string, request: unknown) => {
        if (channel === "bridge:setModel") throw new Error("model unavailable");
        return (bridge.client.invoke as unknown as (channel: string, request: unknown) => Promise<unknown>)(channel, request);
      },
    } as unknown as BridgeClient;
    const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
    const id = await store.getState().createConversation({ source: "buddy" });

    await expect(store.getState().setModelForConversation(id, "broken-provider", "broken-model")).rejects.toThrow("model unavailable");
    expect(store.getState().byId[id]).toMatchObject({ providerId: DEFAULTS.providerId, modelId: DEFAULTS.modelId });
  });

  it("exposes a pure fold independent from activeId and ignores unknown envelopes without inventing state", async () => {
    const { store, a, b } = await registerTwo();
    await store.getState().send(a, "A run");
    store.getState().switchActive(b);
    const before = store.getState();

    const folded = foldConversationEnvelope(before, { conversationId: a, event: { type: "text.delta", text: "A background" } }, 999);
    expect(folded.timelines?.[a]).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", role: "momo", text: "A background", runId: before.runIds[a] }),
    ]));
    expect(folded.byId?.[a]).toMatchObject({ lastActivityAt: 999 });
    expect(folded.order?.[0]).toBe(a);

    expect(foldConversationEnvelope(before, { conversationId: "unknown", event: { type: "text.delta", text: "ignored" } }, 1000)).toEqual({});
  });

  it("publishes a relationship chapter only after its durable commit succeeds", async () => {
    const bridge = makeClient(["relationship-durable"]);
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const persistence = {
      saveConversation: vi.fn(async () => undefined),
      saveRelationshipChapter: vi.fn(async () => saveGate),
      moveConversation: vi.fn(async () => undefined),
      deleteConversation: vi.fn(async () => undefined),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence,
    });

    const creating = store.getState().createConversation({
      source: "buddy",
      durableRelationshipChapter: true,
    });
    await vi.waitFor(() => expect(persistence.saveRelationshipChapter).toHaveBeenCalledTimes(1));
    expect(store.getState().byId["relationship-durable"]).toBeUndefined();

    releaseSave();
    await expect(creating).resolves.toBe("relationship-durable");
    expect(store.getState().byId["relationship-durable"]).toBeDefined();
  });

  it("disposes the host and keeps renderer state unchanged when a relationship commit fails", async () => {
    const bridge = makeClient(["relationship-failed"]);
    const persistence = {
      saveConversation: vi.fn(async () => undefined),
      saveRelationshipChapter: vi.fn(async () => { throw new Error("磁盘不可写"); }),
      moveConversation: vi.fn(async () => undefined),
      deleteConversation: vi.fn(async () => undefined),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence,
    });

    await expect(store.getState().createConversation({
      source: "buddy",
      durableRelationshipChapter: true,
    })).rejects.toThrow("磁盘不可写");

    expect(store.getState().byId["relationship-failed"]).toBeUndefined();
    expect(store.getState().order).not.toContain("relationship-failed");
    expect(bridge.calls).toContainEqual({
      channel: "bridge:disposeConversation",
      request: { conversationId: "relationship-failed" },
    });
  });

  it("persists the real envelope conversation id and receipt time on an overview revision", async () => {
    const bridge = makeClient(["conv-a"]);
    const store = createConversationsStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });
    const conversationId = await store.getState().createConversation({ source: "workbench" });
    store.setState((state) => ({
      runIds: { ...state.runIds, [conversationId]: "run-2" },
    }));

    store.setState((state) => foldConversationEnvelope(state, {
      conversationId: "conv-a",
      event: {
        type: "tool.started",
        toolUseId: "overview-2",
        name: "mcp__leemo-work-overview__set_work_overview",
        input: { currentPhase: "验收中", updateReason: "phase-changed" },
        subagent: false,
      },
    }, 150));
    store.setState((state) => foldConversationEnvelope(state, {
      conversationId: "conv-a",
      event: {
        type: "tool.finished",
        toolUseId: "overview-2",
        isError: false,
        contentSummary: "工作概览已更新。",
      },
    }, 200));

    expect(store.getState().timelines[conversationId].at(-1)).toMatchObject({
      kind: "overview",
      createdAt: 200,
      overview: {
        revision: 1,
        scopeConversationId: "conv-a",
        sourceRunId: "run-2",
        sourceToolUseId: "overview-2",
        updatedAt: 200,
      },
    });
  });

  it("rejects overview refresh for unknown or actively running conversations without sending", async () => {
    const bridge = makeClient(["refresh-guard"]);
    const store = createConversationsStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });

    await expect(store.getState().refreshWorkOverview("missing")).rejects.toThrow(/unknown conversation/i);
    expect(bridge.calls).toHaveLength(0);

    const conversationId = await store.getState().createConversation({ source: "workbench" });
    store.setState((state) => ({
      runIds: { ...state.runIds, [conversationId]: "run-active" },
    }));
    const callsBeforeRefresh = bridge.calls.length;

    await expect(store.getState().refreshWorkOverview(conversationId)).rejects.toThrow(
      "任务进行中，完成后会自动更新概览。",
    );
    expect(bridge.calls).toHaveLength(callsBeforeRefresh);
    expect(store.getState().timelines[conversationId]).toEqual([]);
  });

  it("refreshes through one normal visible send and preserves its retry and permission semantics", async () => {
    const bridge = makeClient(["refresh-idle"]);
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => ({ providerId: "provider-selected", modelId: "model-selected" }),
      resolvePersonaContext: () => ({
        mode: "workbench",
        personaText: "",
        talkStyle: 2,
        webSearchEnabled: false,
        permissionMode: "plan",
      }),
    });
    const approvalsStore = createApprovalsStore(bridge.client, {});
    const wikiEntriesStore = createWikiEntriesStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    wireBridgeSubscriptions(bridge.client, {
      conversations: store,
      approvals: approvalsStore,
      wikiEntries: wikiEntriesStore,
    });
    const conversationId = await store.getState().createConversation({ source: "workbench" });
    store.setState((state) => ({
      byId: {
        ...state.byId,
        [conversationId]: {
          ...state.byId[conversationId],
          goal: {
            text: "持续完成整个项目",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    }));

    await store.getState().refreshWorkOverview(conversationId);

    const sends = bridge.calls.filter((call) => call.channel === "bridge:send");
    expect(sends).toHaveLength(1);
    expect(sends[0].request).toMatchObject({
      conversationId,
      sourceMessageId: "u0",
      allowSubagents: false,
    });
    expect(sends[0].request).not.toHaveProperty("goalText");
    const prompt = (sends[0].request as { prompt: string }).prompt;
    expect(prompt.length).toBeLessThanOrEqual(800);
    expect(prompt).toMatch(/manual-refresh/);
    expect(prompt).toMatch(/本会话/);
    expect(prompt).toMatch(/真实证据/);
    expect(prompt).toMatch(/set_work_overview/);
    expect(prompt).toMatch(/简短回执/);
    expect(store.getState().timelines[conversationId]).toEqual([
      expect.objectContaining({ kind: "text", role: "user", text: "更新工作概览" }),
    ]);
    expect(store.getState().timelines[conversationId][0]).not.toMatchObject({ text: prompt });
    expect(store.getState().pendingSends[conversationId]).toMatchObject({
      text: prompt,
      displayText: "更新工作概览",
      providerId: "provider-selected",
      modelId: "model-selected",
      allowSubagents: false,
    });
    expect(bridge.calls).toContainEqual({
      channel: "bridge:createConversation",
      request: expect.objectContaining({
        providerId: "provider-selected",
        modelId: "model-selected",
        permissionMode: "plan",
      }),
    });
    expect(bridge.calls.some((call) => call.channel === "bridge:updateContext")).toBe(false);

    bridge.emit({ conversationId, event: { type: "error", message: "服务暂时不可用" } });
    bridge.emit({ conversationId, event: {
      type: "run.finished",
      subtype: "error",
      isError: true,
      finalText: "",
      pathAudit: { claimed: [] },
    } });
    await store.getState().retry(conversationId);

    const retriedSends = bridge.calls.filter((call) => call.channel === "bridge:send");
    expect(retriedSends).toHaveLength(2);
    expect(retriedSends[1].request).toMatchObject({
      conversationId,
      prompt,
      allowSubagents: false,
    });
    expect(retriedSends[1].request).not.toHaveProperty("goalText");
    expect(store.getState().timelines[conversationId].filter((item) => item.kind === "text" && item.role === "user").at(-1))
      .toMatchObject({ text: "更新工作概览" });
  });

  it("persists a local correction, hydrates it, and protects user-owned fields from a later model patch", async () => {
    const bridge = makeClient(["correct-local"]);
    const persistence = {
      saveConversation: vi.fn(async (
        _meta: import("./conversations").ConversationMeta,
        _timeline: TimelineItem[],
      ): Promise<void> => undefined),
    };
    const store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persistence as never,
      now: () => 500,
    });
    const conversationId = await store.getState().createConversation({ source: "workbench" });
    const initialOverview: WorkOverviewSnapshot = {
      revision: 1,
      scopeConversationId: conversationId,
      sourceRunId: "run-1",
      sourceToolUseId: "overview-1",
      updatedAt: 400,
      updateReason: "objective-set",
      basisEventIds: ["run-1", "overview-1"],
      actor: "momo",
      objective: "模型原目标",
      objectiveSource: "semantic",
      successCriteria: ["模型原标准"],
      currentPhase: "实现中",
      currentFocus: "旧重点",
      nextKnown: [],
      blockers: [],
      decisions: [],
      completedHighlights: [],
      fieldAuthority: { objective: "momo", successCriteria: "momo" },
    };
    const initialTimeline: TimelineItem[] = [{
      kind: "overview",
      id: "m0",
      runId: "run-1",
      toolUseId: "overview-1",
      overview: initialOverview,
      createdAt: 400,
    }];
    store.setState((state) => ({
      timelines: { ...state.timelines, [conversationId]: initialTimeline },
    }));
    const bridgeCallsBeforeCorrection = bridge.calls.length;

    await store.getState().correctWorkOverview(conversationId, {
      objective: "用户确认的目标",
      successCriteria: ["用户确认标准一", "用户确认标准二"],
    });

    expect(bridge.calls).toHaveLength(bridgeCallsBeforeCorrection);
    const corrected = store.getState().timelines[conversationId].at(-1);
    expect(store.getState().timelines[conversationId]).toHaveLength(2);
    expect(corrected).toMatchObject({
      kind: "overview",
      runId: "",
      toolUseId: "",
      createdAt: 500,
      overview: {
        revision: 2,
        scopeConversationId: conversationId,
        sourceRunId: "",
        sourceToolUseId: "",
        updatedAt: 500,
        updateReason: "user-correction",
        actor: "user",
        objective: "用户确认的目标",
        successCriteria: ["用户确认标准一", "用户确认标准二"],
        fieldAuthority: { objective: "user", successCriteria: "user" },
      },
    });
    expect((corrected as Extract<TimelineItem, { kind: "overview" }>).overview.basisEventIds).toEqual([
      expect.stringMatching(/^local-correction-500-\d+$/),
    ]);
    expect(persistence.saveConversation).toHaveBeenCalledTimes(1);
    const [savedMeta, savedTimeline] = persistence.saveConversation.mock.calls[0];
    expect(savedTimeline).toHaveLength(2);

    const restored = createConversationsStore(makeClient().client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    restored.getState().hydrate([{ meta: savedMeta, timeline: savedTimeline }]);
    restored.setState((state) => ({
      runIds: { ...state.runIds, [conversationId]: "run-model" },
    }));
    restored.setState((state) => foldConversationEnvelope(state, {
      conversationId,
      event: {
        type: "tool.started",
        toolUseId: "overview-model",
        name: "mcp__leemo-work-overview__set_work_overview",
        input: {
          objective: "模型试图覆盖目标",
          successCriteria: ["模型试图覆盖标准"],
          currentPhase: "验收中",
          currentFocus: "检查恢复结果",
          updateReason: "phase-changed",
        },
        subagent: false,
      },
    }, 600));
    restored.setState((state) => foldConversationEnvelope(state, {
      conversationId,
      event: {
        type: "tool.finished",
        toolUseId: "overview-model",
        isError: false,
        contentSummary: "工作概览已更新。",
      },
    }, 601));

    expect(restored.getState().timelines[conversationId].at(-1)).toMatchObject({
      kind: "overview",
      overview: {
        revision: 3,
        objective: "用户确认的目标",
        successCriteria: ["用户确认标准一", "用户确认标准二"],
        currentPhase: "验收中",
        currentFocus: "检查恢复结果",
        fieldAuthority: { objective: "user", successCriteria: "user" },
      },
    });
  });

  it("rejects active or conflicted local corrections and repairs persistence without ghost revisions", async () => {
    const bridge = makeClient(["correct-clear"]);
    const persistence = {
      saveConversation: vi.fn(async (
        _meta: import("./conversations").ConversationMeta,
        _timeline: TimelineItem[],
      ): Promise<void> => undefined),
    };
    let armPostLockRun = false;
    let store: ReturnType<typeof createConversationsStore>;
    store = createConversationsStore(bridge.client, {
      resolveConversationDefaults: () => DEFAULTS,
      persistence: persistence as never,
      now: () => {
        if (armPostLockRun) {
          armPostLockRun = false;
          store.setState((state) => ({
            runIds: { ...state.runIds, "correct-clear": "run-raced" },
          }));
        }
        return 700;
      },
    });
    const conversationId = await store.getState().createConversation({ source: "workbench" });
    const original: WorkOverviewSnapshot = {
      revision: 1,
      scopeConversationId: conversationId,
      sourceRunId: "run-1",
      sourceToolUseId: "overview-1",
      updatedAt: 600,
      updateReason: "objective-set",
      basisEventIds: ["run-1", "overview-1"],
      actor: "momo",
      objective: "需要清空",
      objectiveSource: "semantic",
      successCriteria: ["也需要清空"],
      nextKnown: [],
      blockers: [],
      decisions: [],
      completedHighlights: [],
      fieldAuthority: { objective: "momo", successCriteria: "momo" },
    };
    const timeline: TimelineItem[] = [{
      kind: "overview",
      id: "m0",
      runId: "run-1",
      toolUseId: "overview-1",
      overview: original,
      createdAt: 600,
    }];
    store.setState((state) => ({ timelines: { ...state.timelines, [conversationId]: timeline } }));

    store.setState((state) => ({ runIds: { ...state.runIds, [conversationId]: "run-active" } }));
    await expect(store.getState().correctWorkOverview(conversationId, { objective: "不应写入" }))
      .rejects.toThrow("任务进行中，完成后再编辑工作概览。");
    expect(persistence.saveConversation).not.toHaveBeenCalled();
    expect(store.getState().timelines[conversationId]).toBe(timeline);

    store.setState((state) => ({ runIds: { ...state.runIds, [conversationId]: null } }));
    armPostLockRun = true;
    await expect(store.getState().correctWorkOverview(conversationId, { objective: "竞态也不应写入" }))
      .rejects.toThrow("任务进行中，完成后再编辑工作概览。");
    expect(persistence.saveConversation).not.toHaveBeenCalled();
    expect(store.getState().timelines[conversationId]).toBe(timeline);

    store.setState((state) => ({ runIds: { ...state.runIds, [conversationId]: null } }));
    await expect(store.getState().correctWorkOverview(conversationId, {
      currentPhase: "本地修正不拥有这个字段",
    } as never)).rejects.toThrow("本地修正只支持目标、完成标准和显式清除");
    expect(store.getState().timelines[conversationId]).toBe(timeline);

    await store.getState().correctWorkOverview(conversationId, {
      clearFields: ["objective", "successCriteria"],
    });
    expect(store.getState().timelines[conversationId].at(-1)).toMatchObject({
      kind: "overview",
      overview: {
        revision: 2,
        successCriteria: [],
        fieldAuthority: { objective: "user", successCriteria: "user" },
      },
    });
    expect((store.getState().timelines[conversationId].at(-1) as Extract<TimelineItem, { kind: "overview" }>).overview.objective)
      .toBeUndefined();

    let resolveCandidateSave!: () => void;
    persistence.saveConversation.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveCandidateSave = resolve;
    }));
    const conflictedCorrection = store.getState().correctWorkOverview(conversationId, {
      objective: "不应出现的冲突修正",
    });
    await vi.waitFor(() => expect(persistence.saveConversation).toHaveBeenCalledTimes(2));
    const candidateTimeline = persistence.saveConversation.mock.calls[1][1];
    expect(candidateTimeline.at(-1)).toMatchObject({
      kind: "overview",
      overview: { objective: "不应出现的冲突修正", updateReason: "user-correction" },
    });

    store.setState((state) => foldConversationEnvelope(state, {
      conversationId,
      event: { type: "text.delta", text: "延迟到达的真实事件" },
    }, 701));
    const delayedMeta = store.getState().byId[conversationId];
    const delayedTimeline = store.getState().timelines[conversationId];
    const overviewCountBeforeConflict = delayedTimeline.filter((item) => item.kind === "overview").length;
    resolveCandidateSave();

    await expect(conflictedCorrection).rejects.toThrow("对话刚刚发生变化，请重试编辑工作概览。");
    expect(persistence.saveConversation).toHaveBeenCalledTimes(3);
    const [repairMeta, repairTimeline] = persistence.saveConversation.mock.calls[2];
    expect(repairMeta).toBe(delayedMeta);
    expect(repairTimeline).toBe(delayedTimeline);
    expect(store.getState().timelines[conversationId]).toBe(delayedTimeline);
    expect(delayedTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", role: "momo", text: "延迟到达的真实事件" }),
    ]));
    expect(delayedTimeline.filter((item) => item.kind === "overview")).toHaveLength(overviewCountBeforeConflict);
    expect(delayedTimeline.some((item) => item.kind === "overview" && item.overview.objective === "不应出现的冲突修正"))
      .toBe(false);

    const restored = createConversationsStore(makeClient().client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    restored.getState().hydrate([{ meta: repairMeta, timeline: repairTimeline }]);
    const restoredTimeline = restored.getState().timelines[conversationId];
    expect(restoredTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", role: "momo", text: "延迟到达的真实事件" }),
    ]));
    expect(restoredTimeline.some((item) => item.kind === "overview" && item.overview.objective === "不应出现的冲突修正"))
      .toBe(false);

    const beforeFailedCorrection = store.getState().timelines[conversationId];
    const savesBeforeFailure = persistence.saveConversation.mock.calls.length;
    let rejectSave!: (error: Error) => void;
    persistence.saveConversation.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    }));
    const failedCorrection = store.getState().correctWorkOverview(conversationId, { objective: "不应显示" });
    await vi.waitFor(() => expect(persistence.saveConversation).toHaveBeenCalledTimes(savesBeforeFailure + 1));
    expect(store.getState().timelines[conversationId]).toBe(beforeFailedCorrection);
    rejectSave(new Error("磁盘不可写"));
    await expect(failedCorrection).rejects.toThrow("磁盘不可写");
    expect(persistence.saveConversation).toHaveBeenCalledTimes(savesBeforeFailure + 1);
    expect(store.getState().timelines[conversationId]).toBe(beforeFailedCorrection);
  });

  describe("本子 binding → prompt layer ⑨ (轮 3 卡 G)", () => {
    const createReq = (bridge: ReturnType<typeof makeClient>) =>
      bridge.calls.find((c) => c.channel === "bridge:createConversation")!.request as Record<string, unknown>;

    it("inherits the active 本子 as bookId AND sends notebookId to the host", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolveActiveNotebook: () => "高等数学",
      });
      const id = await store.getState().createConversation({ source: "workbench" });
      expect(store.getState().byId[id].bookId).toBe("高等数学");
      // The ID crosses, never the file contents — the host reads CLAUDE.md.
      expect(createReq(bridge).notebookId).toBe("高等数学");
    });

    it("omits notebookId entirely for an unfiled conversation (搭子态 default)", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolveActiveNotebook: () => null,
      });
      const id = await store.getState().createConversation({ source: "buddy" });
      expect(store.getState().byId[id].bookId).toBeNull();
      expect("notebookId" in createReq(bridge)).toBe(false);
    });

    it("an explicit bookId wins over the active notebook", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolveActiveNotebook: () => "活跃本子",
      });
      const id = await store.getState().createConversation({ source: "workbench", bookId: "指定本子" });
      expect(store.getState().byId[id].bookId).toBe("指定本子");
      expect(createReq(bridge).notebookId).toBe("指定本子");
    });

    it("explicit bookId:null means unfiled even when a notebook is active", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolveActiveNotebook: () => "活跃本子",
      });
      const id = await store.getState().createConversation({ source: "buddy", bookId: null });
      expect(store.getState().byId[id].bookId).toBeNull();
      expect("notebookId" in createReq(bridge)).toBe(false);
    });

    it("re-claiming a hydrated conversation carries its notebook (restart keeps layer ⑨)", async () => {
      // Without this, 本子约定 would apply before a restart and silently not
      // after — the conversation resumes but loses its mid-term memory layer.
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      store.getState().hydrate([
        {
          meta: {
            id: "conv-old",
            title: "旧对话",
            titleManuallyUpdated: false,
            bookId: "数据结构",
            source: "workbench",
            providerId: DEFAULTS.providerId,
            modelId: DEFAULTS.modelId,
            createdAt: 1,
            lastActivityAt: 1,
            unread: false,
            sessionId: "sess-1",
          },
          timeline: [],
        },
      ]);
      await store.getState().send("conv-old", "接着聊");
      const claim = createReq(bridge);
      expect(claim.conversationId).toBe("conv-old");
      expect(claim.notebookId).toBe("数据结构");
      expect(claim.resumeSessionId).toBe("sess-1");
    });
  });

  describe("hydrate (SQLite restore)", () => {
    const metaA: import("./conversations").ConversationMeta = {
      id: "c-old-a", title: "旧对话A", titleManuallyUpdated: false, bookId: null,
      source: "buddy", providerId: "deepseek", modelId: "deepseek-chat",
      createdAt: 1000, lastActivityAt: 3000, unread: false,
    };
    const metaB: import("./conversations").ConversationMeta = {
      id: "c-old-b", title: "旧对话B", titleManuallyUpdated: true, bookId: "book-1",
      source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
      createdAt: 1500, lastActivityAt: 2000, unread: false,
    };
    const tlA: TimelineItem[] = [
      { kind: "text", id: "u0", runId: "r1", role: "user", text: "问", streaming: false },
      { kind: "text", id: "m1", runId: "r1", role: "momo", text: "答", streaming: false },
    ];

    it("seeds byId/order/timelines with runIds nulled and newest as active", () => {
      const { client } = makeClient();
      const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
      store.getState().hydrate([
        { meta: metaA, timeline: tlA },
        { meta: metaB, timeline: [] },
      ]);
      const s = store.getState();
      expect(s.order).toEqual(["c-old-a", "c-old-b"]);
      expect(s.byId["c-old-a"]).toEqual({
        ...metaA,
        lastOpenedAt: metaA.lastActivityAt,
        pinned: false,
        archived: false,
      });
      expect(s.timelines["c-old-a"]).toEqual(tlA);
      expect(s.runIds["c-old-a"]).toBeNull();
      expect(s.runIds["c-old-b"]).toBeNull();
      expect(s.activeId).toBe("c-old-a"); // order[0]
      expect(s.openTabs).toEqual([]);
    });

    it("settles stale running markers and adds one truthful restart interruption receipt", () => {
      const { client } = makeClient();
      const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
      store.getState().hydrate([{
        meta: { ...metaA, sessionId: "session-before-exit" },
        timeline: [
          { kind: "text", id: "m-stream", runId: "run-8", role: "momo", text: "写到一半", streaming: true },
          { kind: "thinking", id: "t-stream", runId: "run-8", text: "还在处理", streaming: true },
          { kind: "tool", id: "tool-running", runId: "run-8", toolUseId: "tool-8", name: "Read", input: {}, status: "running" },
          {
            kind: "activity", id: "agent-running", runId: "run-8", parentToolUseId: "agent-8",
            status: "running", childToolUseIds: ["child-8"],
            tools: [{ toolUseId: "child-8", name: "Search", status: "running" }], transcript: [],
          },
          { kind: "retry", id: "retry-running", runId: "run-8", attempt: 2, maxAttempts: 5, summary: "正在重连 2/5", detail: "network", state: "retrying" },
        ],
      }]);

      const restored = store.getState().timelines[metaA.id];
      expect(restored).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "m-stream", streaming: false }),
        expect.objectContaining({ id: "t-stream", streaming: false }),
        expect.objectContaining({ id: "tool-running", status: "error" }),
        expect.objectContaining({ id: "agent-running", status: "error", tools: [expect.objectContaining({ status: "error" })] }),
        expect.objectContaining({ id: "retry-running", state: "failed" }),
        expect.objectContaining({
          kind: "error",
          runId: "run-8",
          message: "上次任务因 Leemo 退出而中断",
        }),
      ]));
      expect(restored.filter((item) => item.kind === "error" && item.message === "上次任务因 Leemo 退出而中断")).toHaveLength(1);
      expect(store.getState().runIds[metaA.id]).toBeNull();
      expect(store.getState().byId[metaA.id].sessionId).toBe("session-before-exit");
    });

    it("preserves a memory receipt and its undone state across restart hydration", () => {
      const { client } = makeClient();
      const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
      const memory: TimelineItem = {
        kind: "memory",
        id: "memory-receipt",
        runId: "run-8",
        changeId: "change-1",
        action: "remembered",
        label: "用户喜欢先看结论",
        scope: { type: "global" },
        undone: true,
        undoChangeId: "undo-1",
      };

      store.getState().hydrate([{
        meta: metaA,
        timeline: [...tlA, memory],
      }]);

      expect(store.getState().timelines[metaA.id]).toContainEqual(memory);
      expect(store.getState().runIds[metaA.id]).toBeNull();
    });

    it("upgrades legacy first-24-character auto titles while preserving manual titles", () => {
      const { client } = makeClient();
      const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
      const prompt = "现在联网搜一下 2026 年秋招产品经理岗位，并整理适合我的公司";
      const legacyTitle = Array.from(prompt).slice(0, 24).join("");
      store.getState().hydrate([
        {
          meta: { ...metaA, id: "auto", title: legacyTitle, titleManuallyUpdated: false },
          timeline: [{ kind: "text", id: "u-auto", runId: "run-10", role: "user", text: prompt, streaming: false }],
        },
        {
          meta: { ...metaB, id: "manual", title: legacyTitle, titleManuallyUpdated: true },
          timeline: [{ kind: "text", id: "u-manual", runId: "run-11", role: "user", text: prompt, streaming: false }],
        },
      ]);
      expect(store.getState().byId.auto.title).toBe("搜索 2026 年秋招产品经理岗位");
      expect(store.getState().byId.manual.title).toBe(legacyTitle);
    });

    it("hydrating an empty snapshot leaves a true empty registry", () => {
      const { client } = makeClient();
      const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
      store.getState().hydrate([]);
      const s = store.getState();
      expect(s.order).toEqual([]);
      expect(s.activeId).toBeNull();
    });

    it("a hydrated conversation keeps working: send appends to its restored timeline", async () => {
      const { client } = makeClient(["fresh-1"]);
      const store = createConversationsStore(client, { resolveConversationDefaults: () => DEFAULTS });
      store.getState().hydrate([{ meta: metaA, timeline: tlA }]);
      await store.getState().send("c-old-a", "追问");
      const tl = store.getState().timelines["c-old-a"];
      expect(tl.length).toBe(tlA.length + 1);
      expect(tl[tl.length - 1]).toMatchObject({ role: "user", text: "追问" });
    });
  });

  // 轮 2 卡 C — 重启后续聊.
  //
  // Conversation ids are minted by the host, whose registry is pure memory.
  // Everything the renderer hydrates therefore points at a conversation NO live
  // host object answers to, and `bridge:send` died with `unknown conversation`.
  // The store now re-claims the id on demand, handing back the persisted session
  // so momo actually remembers the thread instead of merely accepting messages.
  describe("re-claiming a hydrated conversation before sending (卡 C)", () => {
    const persisted: import("./conversations").ConversationMeta = {
      id: "c-restart", title: "重启前的对话", titleManuallyUpdated: false, bookId: null,
      source: "buddy", providerId: "deepseek", modelId: "deepseek-v4-flash",
      createdAt: 1000, lastActivityAt: 3000, unread: false,
      sessionId: "sess-before-restart",
    };
    const tl: TimelineItem[] = [
      { kind: "text", id: "u0", runId: "r1", role: "user", text: "我养了一只叫团子的猫", streaming: false },
    ];

    it("claims the SAME id with the persisted session before the first send", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      store.getState().hydrate([{ meta: persisted, timeline: tl }]);

      await store.getState().send("c-restart", "团子是什么颜色的？");

      expect(bridge.calls[0]).toEqual({
        channel: "bridge:createConversation",
        request: {
          conversationId: "c-restart",
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          purpose: "main",
          resumeSessionId: "sess-before-restart",
        },
      });
      // The cid must NOT change — the timeline and the SQLite primary key are
      // keyed on it.
      expect(bridge.calls[1]).toEqual({
        channel: "bridge:send",
        request: { conversationId: "c-restart", prompt: "团子是什么颜色的？", sourceMessageId: "u1" },
      });
      expect(store.getState().byId["c-restart"]).toBeDefined();
    });

    it("carries the persona context into the re-claim (momo stays momo after a restart)", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
        resolvePersonaContext: () => ({
          mode: "workbench", personaText: "你是 momo。", talkStyle: 3, webSearchEnabled: true,
        }),
      });
      store.getState().hydrate([{ meta: persisted, timeline: tl }]);
      await store.getState().send("c-restart", "继续");

      expect(bridge.calls[0].request).toMatchObject({
        mode: "workbench", personaText: "你是 momo。", talkStyle: 3, webSearchEnabled: true,
      });
    });

    it("claims only ONCE — the second send goes straight through", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      store.getState().hydrate([{ meta: persisted, timeline: tl }]);

      await store.getState().send("c-restart", "一");
      store.setState((state) => foldConversationEnvelope(
        state,
        {
          conversationId: "c-restart",
          event: {
            type: "run.finished", subtype: "success", isError: false,
            finalText: "完成", pathAudit: { claimed: [] },
          },
        },
        999,
      ));
      await store.getState().send("c-restart", "二");

      const claims = bridge.calls.filter((c) => c.channel === "bridge:createConversation");
      expect(claims).toHaveLength(1);
    });

    it("omits resumeSessionId when the persisted conversation has no session", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      // Pre-卡C rows have no session_id at all: still claimable, just amnesic.
      store.getState().hydrate([{ meta: { ...persisted, sessionId: undefined }, timeline: tl }]);
      await store.getState().send("c-restart", "hi");

      expect(bridge.calls[0].request).not.toHaveProperty("resumeSessionId");
      expect(bridge.calls[0].request).toMatchObject({ conversationId: "c-restart" });
    });

    it("does NOT re-claim a conversation this process created", async () => {
      const bridge = makeClient(["conv-fresh"]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      const cid = await store.getState().createConversation({ source: "buddy" });
      await store.getState().send(cid, "hi");

      const claims = bridge.calls.filter((c) => c.channel === "bridge:createConversation");
      expect(claims).toHaveLength(1); // the original create, no extra claim
      expect(claims[0].request).not.toHaveProperty("conversationId");
    });

    it("leaves state untouched when the claim fails (no phantom user message)", async () => {
      const failing = {
        invoke: async (channel: string) => {
          if (channel === "bridge:createConversation") throw new Error("host offline");
          return undefined;
        },
        subscribe: () => () => {},
      } as unknown as BridgeClient;
      const store = createConversationsStore(failing, { resolveConversationDefaults: () => DEFAULTS });
      store.getState().hydrate([{ meta: persisted, timeline: tl }]);

      await expect(store.getState().send("c-restart", "追问")).rejects.toThrow("host offline");
      expect(store.getState().timelines["c-restart"]).toEqual(tl);
      expect(store.getState().runIds["c-restart"]).toBeNull();
    });

    it("records the sessionId reported by run.finished so the NEXT restart can resume", async () => {
      const bridge = makeClient(["conv-x"]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      const approvals = createApprovalsStore(bridge.client, {});
      const wiki = createWikiEntriesStore(bridge.client, { resolveConversationDefaults: () => DEFAULTS });
      wireBridgeSubscriptions(bridge.client, { conversations: store, approvals, wikiEntries: wiki });

      const cid = await store.getState().createConversation({ source: "buddy" });
      expect(store.getState().byId[cid].sessionId).toBeUndefined();

      await store.getState().send(cid, "记住：团子是橘色的");
      bridge.emit({
        conversationId: cid,
        event: {
          type: "run.finished", subtype: "success", isError: false,
          finalText: "记住了", pathAudit: { claimed: [] }, sessionId: "sess-just-minted",
          sessionProviderId: "provider-a",
        },
      });

      // meta is a NEW object → the persistence sync's reference check fires and
      // the session id reaches SQLite without any extra save plumbing.
      expect(store.getState().byId[cid].sessionId).toBe("sess-just-minted");
      expect(store.getState().byId[cid].sessionProviderId).toBe("provider-a");
    });

    it("keeps the last trusted session when a later provider run fails", async () => {
      const bridge = makeClient(["conv-trusted"]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      const cid = await store.getState().createConversation({ source: "buddy" });
      store.setState((state) => ({
        byId: {
          ...state.byId,
          [cid]: {
            ...state.byId[cid],
            sessionId: "session-interview",
            sessionProviderId: "glm",
          },
        },
      }));

      store.setState((state) => foldConversationEnvelope(state, {
        conversationId: cid,
        event: {
          type: "run.finished",
          subtype: "error",
          isError: true,
          outcome: "failed",
          retryable: false,
          finalText: "",
          pathAudit: { claimed: [] },
          sessionId: "session-permission-failure",
          sessionProviderId: "tokenflux",
        },
      }, 1_000));

      expect(store.getState().byId[cid]).toMatchObject({
        sessionId: "session-interview",
        sessionProviderId: "glm",
      });
    });

    it("does not resume a session that belongs to another provider", async () => {
      const bridge = makeClient();
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      store.getState().hydrate([{
        meta: {
          ...persisted,
          providerId: "glm",
          modelId: "glm-5.3-flash",
          sessionId: "session-owned-by-tokenflux",
          sessionProviderId: "tokenflux",
        },
        timeline: tl,
      }]);

      await store.getState().send("c-restart", "继续");

      expect(bridge.calls[0].request).not.toHaveProperty("resumeSessionId");
      expect(bridge.calls[0].request).toMatchObject({ providerId: "glm" });
    });

    it("keeps the previous sessionId when a run reports none", async () => {
      const bridge = makeClient(["conv-y"]);
      const store = createConversationsStore(bridge.client, {
        resolveConversationDefaults: () => DEFAULTS,
      });
      const cid = await store.getState().createConversation({ source: "buddy" });
      store.setState((s) => ({
        byId: { ...s.byId, [cid]: { ...s.byId[cid], sessionId: "sess-known" } },
      }));

      store.setState((s) =>
        foldConversationEnvelope(
          s,
          {
            conversationId: cid,
            event: {
              type: "run.finished", subtype: "success", isError: false,
              finalText: "", pathAudit: { claimed: [] },
            },
          },
          999,
        ),
      );
      expect(store.getState().byId[cid].sessionId).toBe("sess-known");
    });
  });
});

describe("workspace conversation activation", () => {
  const meta = (id: string, lastActivityAt: number, workspaceId?: string, bookId: string | null = null) => ({
    id,
    title: id,
    titleManuallyUpdated: true,
    bookId,
    source: "workbench" as const,
    providerId: "provider-a",
    modelId: "model-a",
    createdAt: lastActivityAt,
    lastActivityAt,
    unread: false,
    ...(workspaceId ? { workspaceId } : {}),
  });

  it("activates the newest conversation in the selected workspace and treats legacy rows as home", () => {
    const store = createConversationsStore(makeClient().client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    store.getState().hydrate([
      { meta: meta("home-legacy", 100), timeline: [] },
      { meta: meta("project-old", 200, "workspace-project"), timeline: [] },
      { meta: meta("project-new", 300, "workspace-project"), timeline: [] },
    ]);

    const projectMeta = store.getState().byId["project-new"];
    store.getState().activateWorkspace("workspace-project");
    expect(store.getState().activeId).toBe("project-new");
    expect(store.getState().byId["project-new"]).toBe(projectMeta);

    store.getState().activateWorkspace("leemo-home");
    expect(store.getState().activeId).toBe("home-legacy");

    store.getState().activateWorkspace("workspace-empty");
    expect(store.getState().activeId).toBeNull();
  });

  it("activates only the newest conversation inside the selected book", () => {
    const store = createConversationsStore(makeClient().client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    store.getState().hydrate([
      { meta: meta("global-new", 500), timeline: [] },
      { meta: meta("calculus-old", 200, undefined, "高等数学"), timeline: [] },
      { meta: meta("career-new", 400, undefined, "秋招"), timeline: [] },
      { meta: meta("calculus-new", 300, undefined, "高等数学"), timeline: [] },
    ]);

    store.getState().activateScope("leemo-home", "高等数学");
    expect(store.getState().activeId).toBe("calculus-new");

    store.getState().activateScope("leemo-home", null);
    expect(store.getState().activeId).toBe("global-new");
  });

  it("never activates a hidden tab from another book when closing the active tab", () => {
    const store = createConversationsStore(makeClient().client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    store.getState().hydrate([
      { meta: meta("calculus-a", 100, undefined, "高等数学"), timeline: [] },
      { meta: meta("career", 200, undefined, "秋招"), timeline: [] },
      { meta: meta("calculus-b", 300, undefined, "高等数学"), timeline: [] },
    ]);
    store.getState().openTab("calculus-a");
    store.getState().openTab("career");
    store.getState().openTab("calculus-b");
    store.getState().switchActive("calculus-b");

    store.getState().closeTab("calculus-b");
    expect(store.getState().activeId).toBe("calculus-a");
  });

  it("never activates a hidden tab from another workspace when closing the active tab", () => {
    const store = createConversationsStore(makeClient().client, {
      resolveConversationDefaults: () => DEFAULTS,
    });
    store.getState().hydrate([
      { meta: meta("home", 100), timeline: [] },
      { meta: meta("project-a", 200, "workspace-project"), timeline: [] },
      { meta: meta("project-b", 300, "workspace-project"), timeline: [] },
    ]);
    store.getState().openTab("project-a");
    store.getState().openTab("home");
    store.getState().openTab("project-b");
    store.getState().switchActive("project-b");

    store.getState().closeTab("project-b");
    expect(store.getState().activeId).toBe("project-a");

    store.getState().closeTab("project-a");
    expect(store.getState().activeId).toBeNull();
    expect(store.getState().openTabs).toEqual(["home"]);
  });
});
