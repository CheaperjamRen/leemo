import { describe, expect, it } from "vitest";
import {
  applyGlobalOverviewOverrides,
  normalizePersistedGlobalOverviewState,
  type GlobalOverviewFact,
  type GlobalOverviewItem,
  type PersistedGlobalOverviewState,
} from "../../src/bridge/global-pending-overview";

const facts: GlobalOverviewFact[] = [
  {
    id: "task:t1",
    kind: "task",
    label: "打磨产品故事",
    state: "open",
    updatedAt: 100,
    relatedIds: [],
    evidence: ["仍未完成"],
  },
  {
    id: "conversation:c1",
    kind: "conversation",
    label: "讨论产品定位",
    state: "delivered",
    updatedAt: 120,
    relatedIds: [],
    evidence: ["已有一版结论"],
  },
];

const item = (overrides: Partial<GlobalOverviewItem> = {}): GlobalOverviewItem => ({
  id: "overview-1",
  anchorSourceId: "task:t1",
  sourceIds: ["task:t1", "conversation:c1"],
  title: "继续打磨 Leemo 产品故事",
  progressSummary: "已有产品定位讨论，PRD 还没有完成。",
  nextStep: "先收敛一页产品故事。",
  projectLabel: "Leemo 产品",
  priority: "soon",
  ...overrides,
});

function persisted(overrides: Partial<PersistedGlobalOverviewState> = {}): PersistedGlobalOverviewState {
  return {
    version: 1,
    snapshot: {
      version: 1,
      id: "snapshot-1",
      generatedAt: 1_000,
      trigger: "manual",
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      items: [item({ sourceIds: ["task:t1", "task:t1", "conversation:c1"] })],
      uncertainSourceIds: ["conversation:c2", "conversation:c2"],
    },
    overrides: [],
    ...overrides,
  };
}

describe("normalizePersistedGlobalOverviewState", () => {
  it("keeps a valid snapshot while deduplicating stable source ids", () => {
    const normalized = normalizePersistedGlobalOverviewState(persisted());

    expect(normalized?.snapshot?.items[0].sourceIds).toEqual(["task:t1", "conversation:c1"]);
    expect(normalized?.snapshot?.uncertainSourceIds).toEqual(["conversation:c2"]);
  });

  it("rejects an unknown version or a snapshot whose anchor is not one of its sources", () => {
    expect(normalizePersistedGlobalOverviewState({ version: 2, snapshot: null, overrides: [] })).toBeNull();
    expect(normalizePersistedGlobalOverviewState(persisted({
      snapshot: {
        ...persisted().snapshot!,
        items: [item({ anchorSourceId: "task:missing" })],
      },
    }))).toBeNull();
  });

  it("drops an invalid override without losing a valid snapshot", () => {
    const normalized = normalizePersistedGlobalOverviewState({
      ...persisted(),
      overrides: [
        { anchorSourceId: "task:t1", action: "priority", value: "now", updatedAt: 10, sourceUpdatedAt: 9 },
        { anchorSourceId: "", action: "ended", updatedAt: Number.NaN, sourceUpdatedAt: 0 },
      ],
    });

    expect(normalized?.overrides).toEqual([
      { anchorSourceId: "task:t1", action: "priority", value: "now", updatedAt: 10, sourceUpdatedAt: 9 },
    ]);
  });

  it("keeps only the latest correction for one stable anchor", () => {
    const normalized = normalizePersistedGlobalOverviewState({
      ...persisted(),
      overrides: [
        { anchorSourceId: "task:t1", action: "priority", value: "later", updatedAt: 10, sourceUpdatedAt: 9 },
        { anchorSourceId: "task:t1", action: "priority", value: "now", updatedAt: 12, sourceUpdatedAt: 11 },
      ],
    });

    expect(normalized?.overrides).toEqual([
      { anchorSourceId: "task:t1", action: "priority", value: "now", updatedAt: 12, sourceUpdatedAt: 11 },
    ]);
  });
});

describe("applyGlobalOverviewOverrides", () => {
  it("applies user priority without mutating the snapshot item", () => {
    const original = item();
    const result = applyGlobalOverviewOverrides([original], facts, [
      { anchorSourceId: "task:t1", action: "priority", value: "now", updatedAt: 130, sourceUpdatedAt: 100 },
    ]);

    expect(result).toEqual([{ ...original, priority: "now" }]);
    expect(original.priority).toBe("soon");
  });

  it("keeps ignored work hidden but revives an ended item after new source activity", () => {
    const ignored = applyGlobalOverviewOverrides([item()], facts, [
      { anchorSourceId: "task:t1", action: "ignore", updatedAt: 110, sourceUpdatedAt: 100 },
    ]);
    const endedBeforeChange = applyGlobalOverviewOverrides([item()], facts, [
      { anchorSourceId: "task:t1", action: "ended", updatedAt: 130, sourceUpdatedAt: 120 },
    ]);
    const endedAfterChange = applyGlobalOverviewOverrides([item()], [
      { ...facts[0], updatedAt: 140 },
      facts[1],
    ], [
      { anchorSourceId: "task:t1", action: "ended", updatedAt: 130, sourceUpdatedAt: 120 },
    ]);

    expect(ignored).toEqual([]);
    expect(endedBeforeChange).toEqual([]);
    expect(endedAfterChange).toEqual([item()]);
  });
});
