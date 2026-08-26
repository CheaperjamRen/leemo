import { describe, expect, it } from "vitest";
import type { PersistedConversation } from "../../src/main/persistence/schema";
import {
  searchRelationshipHistory,
  searchRelationshipHistoryCandidates,
  type RelationshipHistoryCandidate,
} from "../../src/main/relationship-history-search";

function conversation(
  id: string,
  source: "buddy" | "workbench",
  text: string,
  overrides: Partial<PersistedConversation["meta"]> = {},
): PersistedConversation {
  return {
    meta: {
      id,
      title: id,
      titleManuallyUpdated: false,
      bookId: null,
      workspaceId: "leemo-home",
      source,
      providerId: "deepseek",
      modelId: "deepseek-chat",
      createdAt: 100,
      lastActivityAt: 200,
      unread: false,
      ...overrides,
    },
    timeline: [
      { kind: "text", id: `${id}-u`, runId: `${id}-run`, role: "user", text, streaming: false, createdAt: 120 },
      { kind: "thinking", id: `${id}-thinking`, runId: `${id}-run`, text: "不应进入召回", streaming: false },
      { kind: "text", id: `${id}-m`, runId: `${id}-run`, role: "momo", text: `回应：${text}`, streaming: false, createdAt: 130 },
    ],
  };
}

describe("searchRelationshipHistory", () => {
  it("scores already-scoped SQLite candidates without loading conversation objects", () => {
    const candidates: RelationshipHistoryCandidate[] = [
      {
        conversationId: "older", runId: "run-older", role: "momo",
        text: "之前聊过秋招简历的结构", createdAt: 100, activityAt: 100, order: 0,
      },
      {
        conversationId: "newer", runId: "run-newer", role: "user",
        text: "秋招简历里需要补实验设计", createdAt: 200, activityAt: 200, order: 1,
      },
    ];

    expect(searchRelationshipHistoryCandidates(candidates, { query: "秋招简历", limit: 4 })).toEqual([
      {
        conversationId: "newer", runId: "run-newer", role: "user",
        text: "秋招简历里需要补实验设计", createdAt: 200,
      },
      {
        conversationId: "older", runId: "run-older", role: "momo",
        text: "之前聊过秋招简历的结构", createdAt: 100,
      },
    ]);
  });

  it("searches only global Buddy speech and ranks exact matches first", () => {
    const hits = searchRelationshipHistory([
      conversation("buddy-related", "buddy", "我最近在准备秋招产品经理岗位"),
      conversation("buddy-exact", "buddy", "秋招简历里要突出实验设计"),
      conversation("workbench", "workbench", "秋招简历里要突出实验设计"),
      conversation("notebook-buddy", "buddy", "秋招简历里要突出实验设计", { bookId: "求职" }),
    ], { query: "秋招简历", limit: 6 });

    expect(hits.map((hit) => hit.conversationId)).toEqual(["buddy-exact", "buddy-exact"]);
    expect(hits.map((hit) => hit.role)).toEqual(["user", "momo"]);
    expect(hits.every((hit) => !hit.text.includes("不应进入召回"))).toBe(true);
  });

  it("supports Chinese fuzzy terms while keeping excerpts and result count bounded", () => {
    const long = `我在准备秋招，简历里的产品故事需要继续打磨。${"补充细节".repeat(200)}`;
    const hits = searchRelationshipHistory([
      conversation("older", "buddy", long, { lastActivityAt: 300 }),
      conversation("newer", "buddy", "最近求职时我更关注产品判断和实验设计", { lastActivityAt: 500 }),
    ], { query: "求职 产品", limit: 2 });

    expect(hits).toHaveLength(2);
    expect(hits[0].conversationId).toBe("newer");
    expect(hits.every((hit) => hit.text.length <= 520)).toBe(true);
  });

  it("returns no fallback transcript when the query has no meaningful match", () => {
    expect(searchRelationshipHistory([
      conversation("buddy", "buddy", "今天去散步了"),
    ], { query: "量子计算", limit: 5 })).toEqual([]);
  });
});
