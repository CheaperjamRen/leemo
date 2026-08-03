import { describe, expect, it, vi } from "vitest";
import type {
  BridgeClient,
} from "../bridge/client";
import type {
  MemoryChangeResult,
  MemoryScopeView,
  MemoryView,
} from "../../bridge/contract";
import { createMemoryStore } from "./memory";

const GLOBAL: MemoryScopeView = { type: "global" };
const NOTEBOOK: MemoryScopeView = { type: "notebook", notebookId: "秋招" };
const RECORD: MemoryView = {
  id: "memory-1",
  scope: GLOBAL,
  kind: "preference",
  topic: "回答方式",
  statement: "用户喜欢先看结论",
  learnedAt: 1_785_300_660_000,
  lastConfirmedAt: 1_785_300_660_000,
  sourceType: "explicit-user",
  sourceConversationId: "conversation-1",
  sourceMessageId: "u0",
  status: "current",
  pinned: false,
};

const NOTEBOOK_RECORD: MemoryView = {
  ...RECORD,
  id: "memory-notebook",
  scope: NOTEBOOK,
  kind: "goal",
  topic: "本子目标",
  statement: "本周完成两次模拟面试",
};

function fakeClient(
  invoke: (channel: string, request: unknown) => Promise<unknown>,
): BridgeClient {
  return {
    invoke: vi.fn(invoke) as BridgeClient["invoke"],
    subscribe: vi.fn(() => () => undefined) as BridgeClient["subscribe"],
  };
}

describe("memory store", () => {
  it("refreshes key-free memory views for the requested scopes", async () => {
    const client = fakeClient(async (channel, request) => {
      expect(channel).toBe("bridge:listMemory");
      expect(request).toEqual({ scopes: [GLOBAL] });
      return [RECORD];
    });
    const store = createMemoryStore(client);

    await store.getState().refresh([GLOBAL]);

    expect(store.getState()).toMatchObject({ records: [RECORD], loading: false, listError: null });
  });

  it("keeps the newest refresh when an older request resolves later", async () => {
    let resolveOld!: (records: MemoryView[]) => void;
    let resolveNew!: (records: MemoryView[]) => void;
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return new Promise<MemoryView[]>((resolve) => {
        if (calls === 1) resolveOld = resolve;
        else resolveNew = resolve;
      });
    });
    const store = createMemoryStore(client);

    const oldRefresh = store.getState().refresh([GLOBAL]);
    const newRefresh = store.getState().refresh([GLOBAL, NOTEBOOK]);
    resolveNew([NOTEBOOK_RECORD]);
    await newRefresh;
    resolveOld([RECORD]);
    await oldRefresh;

    expect(store.getState().records).toEqual([NOTEBOOK_RECORD]);
    expect(store.getState().loading).toBe(false);
  });

  it("does not expose a stale refresh failure after a newer refresh succeeds", async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (records: MemoryView[]) => void;
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return new Promise<MemoryView[]>((resolve, reject) => {
        if (calls === 1) rejectOld = reject;
        else resolveNew = resolve;
      });
    });
    const store = createMemoryStore(client);

    const oldRefresh = store.getState().refresh([GLOBAL]);
    const newRefresh = store.getState().refresh([GLOBAL, NOTEBOOK]);
    resolveNew([NOTEBOOK_RECORD]);
    await newRefresh;
    rejectOld(new Error("旧范围读取失败"));
    await oldRefresh;

    expect(store.getState().records).toEqual([NOTEBOOK_RECORD]);
    expect(store.getState().listError).toBeNull();
  });

  it("does not let an in-flight list response roll back a completed mutation", async () => {
    let resolveStale!: (records: MemoryView[]) => void;
    let listCalls = 0;
    const pinned = { ...RECORD, pinned: true };
    const client = fakeClient(async (channel) => {
      if (channel === "bridge:listMemory") {
        listCalls += 1;
        if (listCalls === 1) return [RECORD];
        return new Promise<MemoryView[]>((resolve) => { resolveStale = resolve; });
      }
      if (channel === "bridge:pinMemory") {
        return { changeId: "pin-1", action: "pinned", label: RECORD.statement, memory: pinned };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });
    const store = createMemoryStore(client);
    await store.getState().refresh([GLOBAL]);

    const staleRefresh = store.getState().refresh([GLOBAL]);
    await store.getState().pin(GLOBAL, RECORD.id, true);
    resolveStale([RECORD]);
    await staleRefresh;

    expect(store.getState().records).toEqual([pinned]);
    expect(store.getState().loading).toBe(false);
  });

  it("keeps only the latest history response for each memory", async () => {
    let resolveOld!: (history: MemoryView[]) => void;
    let resolveNew!: (history: MemoryView[]) => void;
    let calls = 0;
    const client = fakeClient(async (channel) => {
      expect(channel).toBe("bridge:memoryHistory");
      calls += 1;
      return new Promise<MemoryView[]>((resolve) => {
        if (calls === 1) resolveOld = resolve;
        else resolveNew = resolve;
      });
    });
    const store = createMemoryStore(client);

    const oldHistory = store.getState().loadHistory(GLOBAL, RECORD.id);
    const newHistory = store.getState().loadHistory(GLOBAL, RECORD.id);
    resolveNew([NOTEBOOK_RECORD]);
    await newHistory;
    resolveOld([RECORD]);
    await oldHistory;

    expect(store.getState().historyById[RECORD.id]).toEqual([NOTEBOOK_RECORD]);
    expect(store.getState().historyLoadingIds).not.toContain(RECORD.id);
    expect(store.getState().historyErrors[RECORD.id]).toBeUndefined();
  });

  it("does not expose an older history failure over a newer success", async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (history: MemoryView[]) => void;
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      return new Promise<MemoryView[]>((resolve, reject) => {
        if (calls === 1) rejectOld = reject;
        else resolveNew = resolve;
      });
    });
    const store = createMemoryStore(client);

    const oldHistory = store.getState().loadHistory(GLOBAL, RECORD.id);
    const newHistory = store.getState().loadHistory(GLOBAL, RECORD.id);
    resolveNew([NOTEBOOK_RECORD]);
    await newHistory;
    rejectOld(new Error("旧历史读取失败"));
    await expect(oldHistory).rejects.toThrow("旧历史读取失败");

    expect(store.getState().historyById[RECORD.id]).toEqual([NOTEBOOK_RECORD]);
    expect(store.getState().historyErrors[RECORD.id]).toBeUndefined();
  });

  it("updates the matching record from the mutation response", async () => {
    const updated: MemoryView = {
      ...RECORD,
      id: "memory-2",
      statement: "用户希望先看结论和下一步",
    };
    const change: MemoryChangeResult = {
      changeId: "change-2",
      action: "updated",
      label: updated.statement,
      memory: updated,
    };
    const client = fakeClient(async (channel) => {
      if (channel === "bridge:listMemory") return [RECORD];
      expect(channel).toBe("bridge:updateMemory");
      return change;
    });
    const store = createMemoryStore(client);
    await store.getState().refresh([GLOBAL]);

    await store.getState().update({
      scope: GLOBAL,
      id: RECORD.id,
      statement: updated.statement,
    });

    expect(store.getState().records).toEqual([updated]);
    expect(store.getState().mutationErrors).toEqual({});
  });

  it("tracks undo pending state and never reports a failed undo as success", async () => {
    let release!: (value: { ok: boolean; targetChangeId: string }) => void;
    const response = new Promise<{ ok: boolean; targetChangeId: string }>((resolve) => {
      release = resolve;
    });
    const client = fakeClient(async (channel, request) => {
      expect(channel).toBe("bridge:undoMemory");
      expect(request).toEqual({
        conversationId: "conversation-1",
        scope: GLOBAL,
        targetChangeId: "change-1",
      });
      return response;
    });
    const store = createMemoryStore(client);

    const pending = store.getState().undo({
      conversationId: "conversation-1",
      scope: GLOBAL,
      targetChangeId: "change-1",
    });
    expect(store.getState().pendingUndoIds).toContain("change-1");

    release({ ok: false, targetChangeId: "change-1" });
    await expect(pending).resolves.toBe(false);
    expect(store.getState().pendingUndoIds).not.toContain("change-1");
    expect(store.getState().undoneChangeIds).not.toContain("change-1");
    expect(store.getState().undoErrors["change-1"]).toMatch(/无法撤销/);
  });

  it("marks a successful undo locally while the durable timeline event arrives", async () => {
    const client = fakeClient(async () => ({
      ok: true,
      changeId: "undo-1",
      targetChangeId: "change-1",
      action: "undone",
    }));
    const store = createMemoryStore(client);

    await expect(store.getState().undo({
      conversationId: "conversation-1",
      scope: GLOBAL,
      targetChangeId: "change-1",
    })).resolves.toBe(true);

    expect(store.getState().pendingUndoIds).not.toContain("change-1");
    expect(store.getState().undoneChangeIds).toContain("change-1");
    expect(store.getState().undoErrors["change-1"]).toBeUndefined();
  });

  it("refreshes only the undone scope so settings cannot show a stale fact", async () => {
    let listCalls = 0;
    const client = fakeClient(async (channel, request) => {
      if (channel === "bridge:listMemory") {
        listCalls += 1;
        if (listCalls === 1) return [RECORD, NOTEBOOK_RECORD];
        expect(request).toEqual({ scopes: [GLOBAL] });
        return [];
      }
      expect(channel).toBe("bridge:undoMemory");
      return {
        ok: true,
        changeId: "undo-1",
        targetChangeId: "change-1",
        action: "undone",
      };
    });
    const store = createMemoryStore(client);
    await store.getState().refresh([GLOBAL, NOTEBOOK]);

    await expect(store.getState().undo({
      conversationId: "conversation-1",
      scope: GLOBAL,
      targetChangeId: "change-1",
    })).resolves.toBe(true);

    expect(store.getState().records).toEqual([NOTEBOOK_RECORD]);
    expect(listCalls).toBe(2);
  });

  it("does not let a late undo refresh overwrite a newer full refresh", async () => {
    let listCalls = 0;
    let resolveUndoRefresh!: (records: MemoryView[]) => void;
    let resolveNewRefresh!: (records: MemoryView[]) => void;
    const newest = { ...RECORD, statement: "来自最新刷新" };
    const client = fakeClient(async (channel) => {
      if (channel === "bridge:listMemory") {
        listCalls += 1;
        if (listCalls === 1) return [RECORD];
        if (listCalls === 2) return new Promise<MemoryView[]>((resolve) => { resolveUndoRefresh = resolve; });
        return new Promise<MemoryView[]>((resolve) => { resolveNewRefresh = resolve; });
      }
      expect(channel).toBe("bridge:undoMemory");
      return {
        ok: true,
        changeId: "undo-1",
        targetChangeId: "change-1",
        action: "undone",
      };
    });
    const store = createMemoryStore(client);
    await store.getState().refresh([GLOBAL]);

    const undo = store.getState().undo({
      conversationId: "conversation-1",
      scope: GLOBAL,
      targetChangeId: "change-1",
    });
    await Promise.resolve();
    const newestRefresh = store.getState().refresh([GLOBAL]);
    resolveNewRefresh([newest]);
    await newestRefresh;
    resolveUndoRefresh([RECORD]);
    await expect(undo).resolves.toBe(true);

    expect(store.getState().records).toEqual([newest]);
    expect(store.getState().listError).toBeNull();
  });

  it("does not let a late undo refresh failure pollute a newer successful refresh", async () => {
    let listCalls = 0;
    let rejectUndoRefresh!: (error: Error) => void;
    let resolveNewRefresh!: (records: MemoryView[]) => void;
    const newest = { ...RECORD, statement: "来自最新刷新" };
    const client = fakeClient(async (channel) => {
      if (channel === "bridge:listMemory") {
        listCalls += 1;
        if (listCalls === 1) return [RECORD];
        if (listCalls === 2) return new Promise<MemoryView[]>((_resolve, reject) => { rejectUndoRefresh = reject; });
        return new Promise<MemoryView[]>((resolve) => { resolveNewRefresh = resolve; });
      }
      expect(channel).toBe("bridge:undoMemory");
      return { ok: true, changeId: "undo-1", targetChangeId: "change-1", action: "undone" };
    });
    const store = createMemoryStore(client);
    await store.getState().refresh([GLOBAL]);

    const undo = store.getState().undo({ scope: GLOBAL, targetChangeId: "change-1" });
    await Promise.resolve();
    const newestRefresh = store.getState().refresh([GLOBAL]);
    resolveNewRefresh([newest]);
    await newestRefresh;
    rejectUndoRefresh(new Error("撤销后的旧读取失败"));
    await expect(undo).resolves.toBe(true);

    expect(store.getState().records).toEqual([newest]);
    expect(store.getState().listError).toBeNull();
  });

  it("does not let a late undo refresh clear a newer refresh failure", async () => {
    let listCalls = 0;
    let resolveUndoRefresh!: (records: MemoryView[]) => void;
    let rejectNewRefresh!: (error: Error) => void;
    const client = fakeClient(async (channel) => {
      if (channel === "bridge:listMemory") {
        listCalls += 1;
        if (listCalls === 1) return [RECORD];
        if (listCalls === 2) return new Promise<MemoryView[]>((resolve) => { resolveUndoRefresh = resolve; });
        return new Promise<MemoryView[]>((_resolve, reject) => { rejectNewRefresh = reject; });
      }
      expect(channel).toBe("bridge:undoMemory");
      return { ok: true, changeId: "undo-1", targetChangeId: "change-1", action: "undone" };
    });
    const store = createMemoryStore(client);
    await store.getState().refresh([GLOBAL]);

    const undo = store.getState().undo({ scope: GLOBAL, targetChangeId: "change-1" });
    await Promise.resolve();
    const newestRefresh = store.getState().refresh([GLOBAL]);
    rejectNewRefresh(new Error("最新刷新失败"));
    await newestRefresh;
    resolveUndoRefresh([RECORD]);
    await expect(undo).resolves.toBe(true);

    expect(store.getState().records).toEqual([RECORD]);
    expect(store.getState().listError).toBe("最新刷新失败");
  });

  it("surfaces an open-directory failure in the memory settings state", async () => {
    const client = fakeClient(async (channel) => {
      expect(channel).toBe("bridge:openMemoryDir");
      throw new Error("系统无法打开记忆目录");
    });
    const store = createMemoryStore(client);

    await expect(store.getState().openDirectory(GLOBAL)).rejects.toThrow(/无法打开/);
    expect(store.getState().directoryError).toBe("系统无法打开记忆目录");
  });
});
