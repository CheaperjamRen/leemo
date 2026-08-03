import { describe, it, expect, vi } from "vitest";
import { createConversationsStore, type ConversationMeta } from "../stores/conversations";
import { createWikiEntriesStore, type WikiEntry } from "../stores/wiki-entries";
import type { TimelineItem } from "../stores/message-model";
import { createSettingsStore } from "../stores/settings";
import { createWorkspacesStore, HOME_WORKSPACE } from "../stores/workspaces";
import type { BridgeClient } from "../bridge/client";
import type { PersistenceClient } from "./client";
import { startPersistenceSync } from "./sync";

const DEFAULTS = { providerId: "deepseek", modelId: "deepseek-chat" };
const immediate = (fn: () => void) => {
  fn();
  return () => {};
};

function mockBridge(ids = ["c1", "c2"]) {
  let n = 0;
  return {
    invoke: vi.fn(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: ids[n++] };
      return undefined;
    }),
    subscribe: vi.fn(() => () => {}),
  } as unknown as BridgeClient;
}

function mockPersist() {
  return {
    loadAll: vi.fn(async () => ({ conversations: [], wikiEntries: [] })),
    saveConversation: vi.fn(async (_meta: ConversationMeta, _timeline: TimelineItem[]) => {}),
    moveConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    saveWikiEntry: vi.fn(async (_entry: WikiEntry) => {}),
    saveSettings: vi.fn(async (_s: Record<string, unknown>) => {}),
  } satisfies PersistenceClient;
}

function makeStores(bridge = mockBridge()) {
  return {
    conversations: createConversationsStore(bridge, { resolveConversationDefaults: () => DEFAULTS }),
    wikiEntries: createWikiEntriesStore(bridge, { resolveConversationDefaults: () => DEFAULTS }),
  };
}

const META: ConversationMeta = {
  id: "c-old", title: "旧", titleManuallyUpdated: false, bookId: null,
  source: "buddy", providerId: "deepseek", modelId: "deepseek-chat",
  createdAt: 1, lastActivityAt: 2, unread: false,
};

describe("startPersistenceSync", () => {
  it("saves a conversation once it has a message (skips empty shells)", async () => {
    const bridge = mockBridge();
    const stores = makeStores(bridge);
    const persist = mockPersist();
    const stop = startPersistenceSync(stores, persist, { schedule: immediate });

    const cid = await stores.conversations.getState().createConversation({ source: "buddy" });
    expect(persist.saveConversation).not.toHaveBeenCalled(); // empty timeline shell

    await stores.conversations.getState().send(cid, "hi");
    expect(persist.saveConversation).toHaveBeenCalled();
    const lastCall = persist.saveConversation.mock.calls.at(-1)!;
    const [meta, timeline] = lastCall as unknown as [ConversationMeta, TimelineItem[]];
    expect(meta.id).toBe(cid);
    expect(timeline.some((t) => t.kind === "text" && t.role === "user" && t.text === "hi")).toBe(true);
    stop();
  });

  it("does not re-save hydrated conversations that never change", () => {
    const stores = makeStores();
    const tl: TimelineItem[] = [{ kind: "text", id: "u0", runId: "r1", role: "user", text: "q", streaming: false }];
    stores.conversations.getState().hydrate([{ meta: META, timeline: tl }]);
    const persist = mockPersist();
    const stop = startPersistenceSync(stores, persist, { schedule: immediate });
    expect(persist.saveConversation).not.toHaveBeenCalled();
    stop();
  });

  it("saves a wiki entry once it holds Q&A, never while empty", () => {
    const stores = makeStores();
    const persist = mockPersist();
    const stop = startPersistenceSync(stores, persist, { schedule: immediate });

    stores.wikiEntries.getState().openPopup("notes.md", "quote"); // empty entry
    expect(persist.saveWikiEntry).not.toHaveBeenCalled();

    // Reducer commits a turn on run.finished; simulate the resulting entry state.
    stores.wikiEntries.setState((s) => ({
      entries: s.entries.map((e) => ({ ...e, turns: [{ question: "q", answer: "a" }] })),
    }));
    expect(persist.saveWikiEntry).toHaveBeenCalledTimes(1);
    expect(persist.saveWikiEntry.mock.calls[0]![0].turns).toHaveLength(1);
    stop();
  });

  it("stop() halts all further persistence", async () => {
    const bridge = mockBridge();
    const stores = makeStores(bridge);
    const persist = mockPersist();
    const stop = startPersistenceSync(stores, persist, { schedule: immediate });
    stop();
    const cid = await stores.conversations.getState().createConversation({ source: "buddy" });
    await stores.conversations.getState().send(cid, "hi");
    expect(persist.saveConversation).not.toHaveBeenCalled();
  });

  it("a persistence rejection is contained (does not throw into the store)", async () => {
    const bridge = mockBridge();
    const stores = makeStores(bridge);
    const persist = mockPersist();
    persist.saveConversation.mockRejectedValue(new Error("disk full"));
    const errors: unknown[] = [];
    const stop = startPersistenceSync(stores, persist, { schedule: immediate, onError: (e) => errors.push(e) });
    const cid = await stores.conversations.getState().createConversation({ source: "buddy" });
    await stores.conversations.getState().send(cid, "hi");
    await Promise.resolve();
    expect(errors.length).toBeGreaterThan(0);
    stop();
  });

  it("flushes a terminal result immediately instead of losing it on a fast close", async () => {
    const bridge = mockBridge();
    const stores = makeStores(bridge);
    const persist = mockPersist();
    let pending: (() => void) | undefined;
    const cancel = vi.fn();
    const stop = startPersistenceSync(stores, persist, {
      schedule: (fn) => { pending = fn; return cancel; },
    });
    const cid = await stores.conversations.getState().createConversation({ source: "buddy" });
    await stores.conversations.getState().send(cid, "hi");
    expect(persist.saveConversation).not.toHaveBeenCalled();
    const runId = stores.conversations.getState().runIds[cid]!;

    stores.conversations.setState((state) => ({
      timelines: {
        ...state.timelines,
        [cid]: [...state.timelines[cid], {
          kind: "result",
          id: "result-1",
          runId,
          isError: false,
          interrupted: false,
          finalText: "done",
          pathAudit: { claimed: [] },
        }],
      },
      runIds: { ...state.runIds, [cid]: null },
    }));

    expect(cancel).toHaveBeenCalled();
    expect(persist.saveConversation).toHaveBeenCalledTimes(1);
    expect(persist.saveConversation.mock.calls[0][1].at(-1)).toMatchObject({ kind: "result", finalText: "done" });
    // The old debounce callback is harmless after the immediate flush.
    pending?.();
    expect(persist.saveConversation).toHaveBeenCalledTimes(1);
    stop();
  });

  it("drains a non-terminal dirty conversation when sync is stopped", async () => {
    const stores = makeStores();
    const persist = mockPersist();
    const stop = startPersistenceSync(stores, persist, { schedule: () => () => undefined });
    const cid = await stores.conversations.getState().createConversation({ source: "buddy" });
    await stores.conversations.getState().send(cid, "save before close");
    expect(persist.saveConversation).not.toHaveBeenCalled();
    stop();
    expect(persist.saveConversation).toHaveBeenCalledTimes(1);
  });

  it("does not write a pending conversation after its external book is removed", () => {
    const stores = makeStores();
    const timeline: TimelineItem[] = [{ kind: "text", id: "u0", runId: "r1", role: "user", text: "q", streaming: false }];
    const external = {
      id: "external-book",
      name: "毕业设计",
      displayPath: "C:\\books\\毕业设计",
      kind: "external" as const,
      available: true,
      lastOpenedAt: 1,
    };
    stores.conversations.getState().hydrate([{
      meta: { ...META, workspaceId: external.id },
      timeline,
    }]);
    const workspaces = createWorkspacesStore(undefined, [HOME_WORKSPACE, external]);
    const persist = mockPersist();
    let pending: (() => void) | undefined;
    const stop = startPersistenceSync({ ...stores, workspaces }, persist, {
      schedule: (fn) => { pending = fn; return () => undefined; },
    });

    stores.conversations.setState((state) => ({
      byId: { ...state.byId, [META.id]: { ...state.byId[META.id], lastOpenedAt: 3 } },
    }));
    workspaces.setState({ list: [HOME_WORKSPACE], activeId: HOME_WORKSPACE.id });
    pending?.();

    expect(persist.saveConversation).not.toHaveBeenCalled();
    stop();
    expect(persist.saveConversation).not.toHaveBeenCalled();
  });

  // ── 轮 7 A3: settings 落盘 ────────────────────────────────────────────────
  //
  // 用户抱怨的第二条（联网搜索不起效）有三分之一是这里：settings store 全字段
  // 重启即丢，所以他打开联网、下次启动又是关的。
  describe("settings", () => {
    it("persists a settings change immediately (not debounced)", () => {
      const settings = createSettingsStore();
      const persist = mockPersist();
      // NOTE: no `schedule` override — a settings write must not depend on the
      // debounce at all, so this test would fail if it were routed through it.
      const stop = startPersistenceSync({ ...makeStores(), settings }, persist);
      settings.getState().setWebEnabled(true);
      expect(persist.saveSettings).toHaveBeenCalledTimes(1);
      expect(persist.saveSettings.mock.calls[0][0]).toMatchObject({ webEnabled: true });
      stop();
    });

    it("does not write on a state change that touches nothing persisted", () => {
      const settings = createSettingsStore();
      const persist = mockPersist();
      const stop = startPersistenceSync({ ...makeStores(), settings }, persist);
      // Same value ⇒ a new state object but an identical persisted projection.
      settings.getState().setWebEnabled(false);
      expect(persist.saveSettings).not.toHaveBeenCalled();
      stop();
    });

    it("does not write back the hydrated baseline (the ordering trap)", () => {
      // If sync primed its baseline BEFORE hydrate ran, the first unrelated
      // change would ship the DEFAULTS back over the user's saved values. The
      // bootstrap hydrates first; this pins that the baseline is taken from
      // whatever state exists when sync starts.
      const settings = createSettingsStore();
      settings.getState().hydrate({ webEnabled: true, talkStyle: 1 });
      const persist = mockPersist();
      const stop = startPersistenceSync({ ...makeStores(), settings }, persist);
      expect(persist.saveSettings).not.toHaveBeenCalled();
      stop();
    });

    it("stops writing after unsubscribe", () => {
      const settings = createSettingsStore();
      const persist = mockPersist();
      const stop = startPersistenceSync({ ...makeStores(), settings }, persist);
      stop();
      settings.getState().setWebEnabled(true);
      expect(persist.saveSettings).not.toHaveBeenCalled();
    });

    it("persists user persona cards but never freezes the built-in card list", () => {
      const settings = createSettingsStore();
      const persist = mockPersist();
      const stop = startPersistenceSync({ ...makeStores(), settings }, persist);
      settings.getState().upsertPersonaCard({ name: "自定义", tagline: "我的卡", promptText: "照我的描述行动。" });
      const saved = persist.saveSettings.mock.calls[0][0];
      // Built-in cards are CODE: persisting them would freeze today's list into
      // the DB and shadow future built-in edits.
      expect(saved).not.toHaveProperty("personaCards");
      expect(saved).not.toHaveProperty("searchKeySources");
      expect(saved.userPersonaCards).toEqual([
        expect.objectContaining({ name: "自定义", builtin: false }),
      ]);
      expect(saved.userPersonaCards).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "momo" }),
      ]));
      stop();
    });
  });
});
