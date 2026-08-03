import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../bridge/client";
import type { LeemoEvent } from "../../bridge/contract";
import { createWikiEntriesStore, type WikiState } from "./wiki-entries";

function bridge(options: { create?: () => Promise<{ conversationId: string }>; send?: () => Promise<void>; dispose?: () => Promise<void> } = {}) {
  const calls: { channel: string; request: unknown }[] = [];
  const client = {
    invoke: vi.fn(async (channel: string, request: unknown) => {
      calls.push({ channel, request });
      if (channel === "bridge:createConversation") return options.create ? options.create() : { conversationId: "wiki-cid-1" };
      if (channel === "bridge:send") return options.send ? options.send() : undefined;
      if (channel === "bridge:disposeConversation") return options.dispose ? options.dispose() : undefined;
      return undefined;
    }),
    subscribe: vi.fn(() => () => { throw new Error("B2 must not subscribe"); }),
  } as unknown as BridgeClient;
  return { client, calls };
}

const defaults = { providerId: "provider-a", modelId: "model-a" };
const deps = (now = 100) => ({ now: () => now, resolveConversationDefaults: () => defaults });

function event(type: LeemoEvent["type"], extra: Record<string, unknown> = {}): LeemoEvent {
  return { type, ...extra } as LeemoEvent;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("wiki entries store", () => {
  it("starts empty and openPopup preserves turns when reusing the same selection", () => {
    const { client } = bridge();
    const store = createWikiEntriesStore(client, deps());
    expect(store.getState().entries).toEqual([]);
    expect(store.getState().active).toBeNull();
    store.getState().openPopup("math/notes.md", "a quoted line");
    const first = store.getState().active;
    expect(first).toMatchObject({ shadowConversationId: null, streaming: false, detailed: false });
    expect(store.getState().entries).toHaveLength(1);
    store.setState((state) => ({ entries: [{ ...state.entries[0], turns: [{ question: "q", answer: "a" }] }] }));
    store.getState().openPopup("math/notes.md", "a quoted line");
    expect(store.getState().active?.entryId).toBe(first?.entryId);
    expect(store.getState().entries[0].turns).toEqual([{ question: "q", answer: "a" }]);
  });

  it("creates a wiki shadow conversation with dynamic defaults and sends in order", async () => {
    const { client, calls } = bridge();
    let current = { providerId: "provider-b", modelId: "model-b" };
    const store = createWikiEntriesStore(client, { now: () => 123, resolveConversationDefaults: () => current });
    store.getState().openPopup("notes.md", "quote");
    current = { providerId: "provider-c", modelId: "model-c" };
    await store.getState().ask("What does this mean?");
    expect(calls).toEqual([
      { channel: "bridge:createConversation", request: { providerId: "provider-c", modelId: "model-c", purpose: "wiki", workspaceId: "leemo-home" } },
      { channel: "bridge:send", request: { conversationId: "wiki-cid-1", prompt: expect.stringContaining("quote") } },
    ]);
    expect(store.getState().active).toMatchObject({ shadowConversationId: "wiki-cid-1", streaming: true });
    store.getState().receiveEvent("wiki-cid-1", event("run.finished", { subtype: "success", isError: false, finalText: "answer", pathAudit: { claimed: [] } }));
    await store.getState().ask("And this?");
    expect(calls.filter((x) => x.channel === "bridge:createConversation")).toHaveLength(1);
    expect(calls.at(-1)).toEqual({ channel: "bridge:send", request: { conversationId: "wiki-cid-1", prompt: expect.stringContaining("And this?") } });
  });

  it("disposes the existing shadow when directly replacing an active popup", async () => {
    const { client, calls } = bridge();
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("old.md", "old quote");
    await store.getState().ask("old question");
    const oldCid = store.getState().active?.shadowConversationId;
    expect(oldCid).toBe("wiki-cid-1");
    store.setState((state) => ({ entries: state.entries.map((entry) => ({ ...entry, turns: [{ question: "kept", answer: "answer" }] })) }));

    store.getState().openPopup("new.md", "new quote");

    expect(callsFor(client, "bridge:disposeConversation")).toEqual([
      ["bridge:disposeConversation", { conversationId: "wiki-cid-1" }],
    ]);
    expect(store.getState().active).toMatchObject({ shadowConversationId: null, streaming: false, detailed: false });
    expect(store.getState().entries.map((entry) => entry.turns)).toEqual([
      [{ question: "kept", answer: "answer" }],
      [],
    ]);
  });

  it("uses the detailed prompt prefix and commits only completed streamed turns", async () => {
    const { client } = bridge();
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    store.getState().toggleDetailed(true);
    await store.getState().ask("Explain");
    const cid = store.getState().active?.shadowConversationId as string;
    store.getState().receiveEvent(cid, event("text.delta", { text: "first " }));
    expect(store.getState().entries[0].turns).toEqual([]);
    store.getState().receiveEvent(cid, event("text.delta", { text: "answer" }));
    store.getState().receiveEvent(cid, event("text.final", { text: "first answer" }));
    expect(store.getState().entries[0].turns).toEqual([]);
    store.getState().receiveEvent(cid, event("run.finished", { subtype: "success", isError: false, finalText: "first answer", pathAudit: { claimed: [] } }));
    expect(store.getState().entries[0].turns).toEqual([{ question: "Explain", answer: "first answer" }]);
    expect(store.getState().active?.streaming).toBe(false);
    expect(store.getState().active?.detailed).toBe(true);
  });

  it("routes only the exact shadow cid and ignores main/old events after close", async () => {
    const { client } = bridge();
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    await store.getState().ask("Q");
    const cid = store.getState().active?.shadowConversationId as string;
    store.getState().receiveEvent("main-cid", event("text.delta", { text: "wrong" }));
    expect(store.getState().entries[0].turns).toEqual([]);
    store.getState().closePopup();
    expect(callsFor(client, "bridge:disposeConversation")).toHaveLength(1);
    store.getState().receiveEvent(cid, event("text.final", { text: "stale" }));
    store.getState().receiveEvent(cid, event("run.finished", { subtype: "success", isError: false, finalText: "stale", pathAudit: { claimed: [] } }));
    expect(store.getState().active).toBeNull();
    expect(store.getState().entries[0].turns).toEqual([]);
  });

  it("does not invoke on no active/blank question and disposes exactly once only for a shadow", async () => {
    const { client } = bridge();
    const store = createWikiEntriesStore(client, deps());
    await store.getState().ask(" ");
    store.getState().openPopup("f.md", "quote");
    await store.getState().ask(" ");
    expect(client.invoke).not.toHaveBeenCalled();
    store.getState().closePopup();
    expect(callsFor(client, "bridge:disposeConversation")).toHaveLength(0);
    store.getState().openPopup("f.md", "quote");
    await store.getState().ask("Q");
    store.getState().closePopup(); store.getState().closePopup();
    expect(callsFor(client, "bridge:disposeConversation")).toHaveLength(1);
  });

  it("serializes a concurrent first ask and does not overwrite an in-flight turn", async () => {
    const created = deferred<{ conversationId: string }>();
    const calls: { channel: string; request: unknown }[] = [];
    const client = {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request });
        if (channel === "bridge:createConversation") return created.promise;
        return Promise.resolve(undefined);
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    const first = store.getState().ask("first");
    const second = store.getState().ask("second");
    expect(calls.filter((call) => call.channel === "bridge:createConversation")).toHaveLength(1);
    created.resolve({ conversationId: "wiki-race-cid" });
    await Promise.all([first, second]);
    expect(calls.filter((call) => call.channel === "bridge:send")).toHaveLength(1);

    store.getState().receiveEvent("wiki-race-cid", event("run.finished", { subtype: "success", isError: false, finalText: "done", pathAudit: { claimed: [] } }));
    await store.getState().ask("after terminal");
    expect(calls.filter((call) => call.channel === "bridge:send")).toHaveLength(2);
  });

  it("disposes a stale create after close and reopen, without attaching it to the new popup", async () => {
    const created = deferred<{ conversationId: string }>();
    const calls: { channel: string; request: unknown }[] = [];
    const client = {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request });
        if (channel === "bridge:createConversation") return created.promise;
        return Promise.resolve(undefined);
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    const staleAsk = store.getState().ask("old");
    store.getState().closePopup();
    store.getState().openPopup("f.md", "quote");
    created.resolve({ conversationId: "stale-cid" });
    await staleAsk;
    expect(store.getState().active).toMatchObject({ shadowConversationId: null, streaming: false });
    expect(calls).toContainEqual({ channel: "bridge:disposeConversation", request: { conversationId: "stale-cid" } });
    expect(calls.filter((call) => call.channel === "bridge:send")).toHaveLength(0);
  });
  it("ignores stale send rejection cleanup after close/reopen and commits the new popup turn", async () => {
    const oldSend = deferred<void>();
    const calls: { channel: string; request: any }[] = [];
    let nextConversation = 0;
    const client = {
      invoke: vi.fn((channel: string, request: any) => {
        calls.push({ channel, request });
        if (channel === "bridge:createConversation") return Promise.resolve({ conversationId: `wiki-cid-${++nextConversation}` });
        if (channel === "bridge:send" && request.conversationId === "wiki-cid-1") return oldSend.promise;
        return Promise.resolve(undefined);
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    const oldAsk = store.getState().ask("old");
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().active).toMatchObject({ shadowConversationId: "wiki-cid-1", streaming: true });

    store.getState().closePopup();
    store.getState().openPopup("f.md", "quote");
    await store.getState().ask("new");
    expect(store.getState().active).toMatchObject({ shadowConversationId: "wiki-cid-2", streaming: true });

    oldSend.reject(new Error("stale send failed"));
    await expect(oldAsk).rejects.toThrow("stale send failed");
    store.getState().receiveEvent("wiki-cid-2", event("run.finished", { subtype: "success", isError: false, finalText: "new answer", pathAudit: { claimed: [] } }));
    expect(store.getState().active?.streaming).toBe(false);
    expect(store.getState().entries[0].turns).toEqual([{ question: "new", answer: "new answer" }]);
  });

  it("allows a new generation to create while an old generation create is unresolved", async () => {
    const oldCreate = deferred<{ conversationId: string }>();
    const newCreate = deferred<{ conversationId: string }>();
    const calls: { channel: string; request: any }[] = [];
    let createCount = 0;
    const client = {
      invoke: vi.fn((channel: string, request: any) => {
        calls.push({ channel, request });
        if (channel === "bridge:createConversation") return ++createCount === 1 ? oldCreate.promise : newCreate.promise;
        return Promise.resolve(undefined);
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("old.md", "old quote");
    const oldAsk = store.getState().ask("old");
    store.getState().closePopup();
    store.getState().openPopup("new.md", "new quote");
    const newAsk = store.getState().ask("new");
    expect(calls.filter((call) => call.channel === "bridge:createConversation")).toHaveLength(2);

    newCreate.resolve({ conversationId: "new-cid" });
    await newAsk;
    expect(calls).toContainEqual({
      channel: "bridge:send",
      request: {
        conversationId: "new-cid",
        prompt: expect.stringMatching(/"workspacePath": "new\.md"[\s\S]*"selectedText": "new quote"[\s\S]*用户的问题：new/),
      },
    });
    oldCreate.resolve({ conversationId: "old-cid" });
    await oldAsk;
    expect(calls).toContainEqual({ channel: "bridge:disposeConversation", request: { conversationId: "old-cid" } });
  });
  it("does not let an earlier same-cid send rejection clear the next turn", async () => {
    const firstSend = deferred<void>();
    const calls: { channel: string; request: any }[] = [];
    const client = {
      invoke: vi.fn((channel: string, request: any) => {
        calls.push({ channel, request });
        if (channel === "bridge:createConversation") return Promise.resolve({ conversationId: "same-cid" });
        if (channel === "bridge:send" && request.prompt.endsWith("one")) return firstSend.promise;
        return Promise.resolve(undefined);
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    const firstAsk = store.getState().ask("one");
    await Promise.resolve();
    await Promise.resolve();
    store.getState().receiveEvent("same-cid", event("run.finished", { subtype: "success", isError: false, finalText: "one answer", pathAudit: { claimed: [] } }));
    await store.getState().ask("two");
    firstSend.reject(new Error("first send failed"));
    await expect(firstAsk).rejects.toThrow("first send failed");
    store.getState().receiveEvent("same-cid", event("run.finished", { subtype: "success", isError: false, finalText: "two answer", pathAudit: { claimed: [] } }));
    expect(store.getState().entries[0].turns).toEqual([
      { question: "one", answer: "one answer" },
      { question: "two", answer: "two answer" },
    ]);
  });
  it("clears terminal non-success states without committing turns", async () => {
    for (const [subtype, isError] of [["cancelled", false], ["unknown", false], ["interrupted", false], ["error", true]] as const) {
      const { client } = bridge();
      const store = createWikiEntriesStore(client, deps());
      store.getState().openPopup(`${subtype}.md`, "quote");
      await store.getState().ask("Q");
      const cid = store.getState().active?.shadowConversationId as string;
      store.getState().receiveEvent(cid, event("run.finished", { subtype, isError, finalText: "not committed", pathAudit: { claimed: [] } }));
      expect(store.getState().entries[0].turns).toEqual([]);
      expect(store.getState().active).toMatchObject({
        shadowConversationId: null,
        streaming: false,
        error: "not committed",
        failedQuestion: "Q",
      });
    }
  });

  it("invalidates and disposes an errored cid before the next turn", async () => {
    const dispose = vi.fn(async () => { throw new Error("dispose failed"); });
    let createCount = 0;
    const { client, calls } = bridge({
      create: async () => ({ conversationId: `wiki-error-cid-${++createCount}` }),
      dispose,
    });
    const store = createWikiEntriesStore(client, deps());
    store.getState().openPopup("f.md", "quote");
    await store.getState().ask("first");
    expect(store.getState().active?.shadowConversationId).toBe("wiki-error-cid-1");

    store.getState().receiveEvent("wiki-error-cid-1", event("error", { message: "failed" }));
    expect(store.getState().active).toMatchObject({
      shadowConversationId: null,
      streaming: false,
      error: "failed",
      failedQuestion: "first",
    });
    expect(callsFor(client, "bridge:disposeConversation")).toEqual([
      ["bridge:disposeConversation", { conversationId: "wiki-error-cid-1" }],
    ]);
    expect(dispose).toHaveBeenCalledTimes(1);

    await store.getState().ask("second");
    expect(store.getState().active?.shadowConversationId).toBe("wiki-error-cid-2");
    store.getState().receiveEvent("wiki-error-cid-1", event("run.finished", { subtype: "success", isError: false, finalText: "stale", pathAudit: { claimed: [] } }));
    expect(store.getState().active).toMatchObject({ shadowConversationId: "wiki-error-cid-2", streaming: true });
    store.getState().receiveEvent("wiki-error-cid-2", event("run.finished", { subtype: "success", isError: false, finalText: "second answer", pathAudit: { claimed: [] } }));
    expect(store.getState().entries[0].turns).toEqual([{ question: "second", answer: "second answer" }]);
  });

  it("keeps stable state on failed create/send and never creates phantom turns", async () => {
    const create = bridge({ create: async () => { throw new Error("create failed"); } });
    const store = createWikiEntriesStore(create.client, deps());
    store.getState().openPopup("f.md", "quote");
    await expect(store.getState().ask("Q")).rejects.toThrow("create failed");
    expect(store.getState().active).toMatchObject({ shadowConversationId: null, streaming: false });
    expect(store.getState().entries[0].turns).toEqual([]);

    const send = bridge({ send: async () => { throw new Error("send failed"); } });
    const second = createWikiEntriesStore(send.client, deps());
    second.getState().openPopup("f.md", "quote");
    await expect(second.getState().ask("Q")).rejects.toThrow("send failed");
    expect(second.getState().active).toMatchObject({ shadowConversationId: "wiki-cid-1", streaming: false });
    expect(second.getState().entries[0].turns).toEqual([]);
  });

  it("hydrate seeds persisted entries and they remain queryable by openPopup", () => {
    const { client } = bridge();
    const store = createWikiEntriesStore(client, deps());
    const persisted = [
      { id: "wiki-1", filePath: "math/notes.md", quotedText: "定理 5.1", turns: [{ question: "为什么", answer: "因为" }], createdAt: 500 },
    ];
    store.getState().hydrate(persisted);
    expect(store.getState().entries).toEqual(persisted);
    // Reopening the same selection reuses the restored entry (turns preserved).
    store.getState().openPopup("math/notes.md", "定理 5.1");
    expect(store.getState().entries).toHaveLength(1);
    expect(store.getState().entries[0].turns).toEqual([{ question: "为什么", answer: "因为" }]);
  });
});
function callsFor(client: BridgeClient, channel: string) {
  return (client.invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([called]) => called === channel);
}
