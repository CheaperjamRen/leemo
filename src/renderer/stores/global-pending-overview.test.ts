import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../bridge/client";
import type {
  GlobalOverviewFact,
  GlobalOverviewSnapshot,
  PersistedGlobalOverviewState,
} from "../../bridge/global-pending-overview";
import {
  createGlobalPendingOverviewStore,
  deriveGlobalOverviewDisplayItems,
} from "./global-pending-overview";

const fact: GlobalOverviewFact = {
  id: "task:t1",
  kind: "task",
  label: "完成产品故事",
  state: "open",
  updatedAt: 10,
  relatedIds: [],
  evidence: ["待办仍未完成"],
};

function snapshot(generatedAt = 100): GlobalOverviewSnapshot {
  return {
    version: 1,
    id: "snapshot-old",
    generatedAt,
    trigger: "manual",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    items: [{
      id: "item-1",
      anchorSourceId: "task:t1",
      sourceIds: ["task:t1"],
      title: "完成产品故事",
      progressSummary: "仍待完成",
      priority: "now",
    }],
    uncertainSourceIds: [],
  };
}

function client(invoke: ReturnType<typeof vi.fn>): BridgeClient {
  return { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient;
}

function deps(overrides: Partial<Parameters<typeof createGlobalPendingOverviewStore>[1]> = {}) {
  return {
    getProviderSelection: () => ({ providerId: "deepseek", modelId: "deepseek-chat" }),
    getFactPack: () => ({ generatedAt: 1_000, facts: [fact] }),
    getAutoSettings: () => ({ enabled: false, localTime: "09:00" }),
    persistence: { saveGlobalPendingOverview: vi.fn(async () => {}) },
    now: () => new Date(2026, 7, 18, 10, 0, 0).getTime(),
    ...overrides,
  };
}

describe("global pending overview store", () => {
  it("does not call a model without a provider or a bounded fact pack", async () => {
    const invoke = vi.fn();
    const noProvider = createGlobalPendingOverviewStore(client(invoke), deps({ getProviderSelection: () => null }));
    await noProvider.getState().refresh("manual");
    expect(noProvider.getState()).toMatchObject({ status: "error", error: "请先选择一个可用模型。" });

    const noFacts = createGlobalPendingOverviewStore(client(invoke), deps({
      getFactPack: () => ({ generatedAt: 1_000, facts: [] }),
    }));
    await noFacts.getState().refresh("manual");
    expect(noFacts.getState()).toMatchObject({ status: "error", error: "目前没有需要梳理的事项。" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("saves a validated success once and deduplicates concurrent refresh clicks", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const next = snapshot(2_000);
    const invoke = vi.fn(async () => {
      await pending;
      return { ok: true, snapshot: next };
    });
    const persistence = { saveGlobalPendingOverview: vi.fn(async (_state: PersistedGlobalOverviewState) => {}) };
    const store = createGlobalPendingOverviewStore(client(invoke), deps({ persistence }));

    const first = store.getState().refresh("manual");
    const second = store.getState().refresh("manual");
    release();
    await Promise.all([first, second]);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(persistence.saveGlobalPendingOverview).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      status: "idle",
      error: null,
      persisted: { snapshot: next },
    });
  });

  it("keeps the last successful snapshot on model or durability failure", async () => {
    const old: PersistedGlobalOverviewState = { version: 1, snapshot: snapshot(), overrides: [] };
    const modelFailure = createGlobalPendingOverviewStore(client(vi.fn(async () => ({
      ok: false,
      message: "网络暂时不可用",
      retryable: true,
    }))), deps());
    modelFailure.getState().hydrate(old);
    await modelFailure.getState().refresh("manual");
    expect(modelFailure.getState().persisted.snapshot).toEqual(old.snapshot);
    expect(modelFailure.getState()).toMatchObject({ status: "error", error: "网络暂时不可用" });

    const durabilityFailure = createGlobalPendingOverviewStore(client(vi.fn(async () => ({
      ok: true,
      snapshot: snapshot(2_000),
    }))), deps({
      persistence: { saveGlobalPendingOverview: vi.fn(async () => { throw new Error("disk full"); }) },
    }));
    durabilityFailure.getState().hydrate(old);
    await durabilityFailure.getState().refresh("manual");
    expect(durabilityFailure.getState().persisted.snapshot).toEqual(old.snapshot);
    expect(durabilityFailure.getState()).toMatchObject({ status: "error", error: "新看板没有保存成功，旧看板已保留。" });
  });

  it("persists user corrections and lets newer source activity revive an ended item", async () => {
    const persistence = { saveGlobalPendingOverview: vi.fn(async () => {}) };
    let currentFacts = [fact];
    const store = createGlobalPendingOverviewStore(client(vi.fn()), deps({
      persistence,
      getFactPack: () => ({ generatedAt: 1_000, facts: currentFacts }),
    }));
    store.getState().hydrate({ version: 1, snapshot: snapshot(), overrides: [] });

    await store.getState().setPriority("task:t1", "later");
    expect(store.getState().persisted.overrides).toEqual([expect.objectContaining({
      anchorSourceId: "task:t1",
      action: "priority",
      value: "later",
      sourceUpdatedAt: 10,
    })]);

    await store.getState().end("task:t1");
    expect(deriveGlobalOverviewDisplayItems(snapshot(), currentFacts, store.getState().persisted.overrides)).toEqual([]);
    currentFacts = [{ ...fact, updatedAt: store.getState().persisted.overrides[0].updatedAt + 1 }];
    expect(deriveGlobalOverviewDisplayItems(snapshot(), currentFacts, store.getState().persisted.overrides)).toHaveLength(1);

    await store.getState().restore("task:t1");
    expect(store.getState().persisted.overrides).toEqual([]);
    expect(persistence.saveGlobalPendingOverview).toHaveBeenCalledTimes(3);
  });

  it("hides a Todo-only snapshot item after the real Todo is completed or removed", () => {
    expect(deriveGlobalOverviewDisplayItems(snapshot(), [], [])).toEqual([]);
  });

  it("persists today's auto attempt before spending and never tries twice after failure", async () => {
    const persistence = { saveGlobalPendingOverview: vi.fn(async (_state: PersistedGlobalOverviewState) => {}) };
    const invoke = vi.fn(async () => ({ ok: false, message: "offline", retryable: true }));
    const store = createGlobalPendingOverviewStore(client(invoke), deps({
      persistence,
      getAutoSettings: () => ({ enabled: true, localTime: "09:00" }),
    }));

    await expect(store.getState().maybeAutoRefresh()).resolves.toBe("ran");
    await expect(store.getState().maybeAutoRefresh()).resolves.toBe("skipped");

    expect(persistence.saveGlobalPendingOverview.mock.calls[0]?.[0]).toMatchObject({
      lastAutoAttemptDate: "2026-08-18",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
