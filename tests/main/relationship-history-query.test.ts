import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createPersistence, type PersistedConversation } from "../../src/main/persistence/schema";
import {
  MAX_RELATIONSHIP_HISTORY_CANDIDATES,
  loadRelationshipHistoryCandidates,
} from "../../src/main/persistence/relationship-history-query";

function conversation(
  id: string,
  options: {
    source?: "buddy" | "workbench";
    workspaceId?: string;
    bookId?: string | null;
    archived?: boolean;
  } = {},
): PersistedConversation {
  return {
    meta: {
      id,
      title: id,
      titleManuallyUpdated: false,
      bookId: options.bookId ?? null,
      workspaceId: options.workspaceId ?? "leemo-home",
      source: options.source ?? "buddy",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      createdAt: 10,
      lastActivityAt: 50,
      unread: false,
      archived: options.archived ?? false,
    },
    timeline: [
      {
        kind: "text", id: `${id}-user`, runId: `${id}-run`, role: "user",
        text: `${id} 的用户消息`, streaming: false, createdAt: 20,
      },
      {
        kind: "tool", id: `${id}-tool`, runId: `${id}-run`, toolUseId: `${id}-tool-use`,
        name: "Read", input: {}, status: "ok", summary: "不应进入召回", createdAt: 25,
      },
      {
        kind: "text", id: `${id}-momo`, runId: `${id}-run`, role: "momo",
        text: `${id} 的 momo 回复`, streaming: false, createdAt: 30,
      },
    ],
  };
}

describe("loadRelationshipHistoryCandidates", () => {
  it("reads only active global Buddy speech rows from the disposable SQLite index", () => {
    const database = new Database(":memory:");
    const persistence = createPersistence(database);
    for (const entry of [
      conversation("relationship"),
      conversation("archived", { archived: true }),
      conversation("notebook", { bookId: "求职" }),
      conversation("workbench", { source: "workbench" }),
      conversation("external", { workspaceId: "external-project" }),
    ]) {
      persistence.saveConversation(entry.meta, entry.timeline);
    }

    const candidates = loadRelationshipHistoryCandidates(database);

    expect(candidates).toEqual([
      {
        conversationId: "relationship",
        runId: "relationship-run",
        role: "user",
        text: "relationship 的用户消息",
        createdAt: 20,
        activityAt: 20,
        order: 0,
      },
      {
        conversationId: "relationship",
        runId: "relationship-run",
        role: "momo",
        text: "relationship 的 momo 回复",
        createdAt: 30,
        activityAt: 30,
        order: 1,
      },
    ]);
  });

  it("skips malformed, streaming, and empty text rows without breaking recall", () => {
    const database = new Database(":memory:");
    const persistence = createPersistence(database);
    const valid = conversation("relationship");
    persistence.saveConversation(valid.meta, valid.timeline);
    database.prepare(
      "INSERT INTO messages (conversation_id, seq, kind, item_json) VALUES (?, ?, 'text', ?)",
    ).run("relationship", 20, "{bad-json");
    database.prepare(
      "INSERT INTO messages (conversation_id, seq, kind, item_json) VALUES (?, ?, 'text', ?)",
    ).run("relationship", 21, JSON.stringify({
      kind: "text", id: "stream", runId: "stream-run", role: "momo", text: "还在生成", streaming: true,
    }));
    database.prepare(
      "INSERT INTO messages (conversation_id, seq, kind, item_json) VALUES (?, ?, 'text', ?)",
    ).run("relationship", 22, JSON.stringify({
      kind: "text", id: "empty", runId: "empty-run", role: "momo", text: "   ", streaming: false,
    }));

    expect(loadRelationshipHistoryCandidates(database)).toHaveLength(2);
  });

  it("在 SQLite 层从 5000 条无关历史中保留较早精确匹配且候选读取有界", () => {
    const database = new Database(":memory:");
    const persistence = createPersistence(database);
    const entry = conversation("relationship");
    entry.timeline = [
      {
        kind: "text", id: "exact-old", runId: "exact-old-run", role: "user",
        text: "目标岗位是远程数据产品", streaming: false, createdAt: 1,
      },
      ...Array.from({ length: 600 }, (_, index) => ({
        kind: "text" as const,
        id: `partial-${index}`,
        runId: `partial-run-${index}`,
        role: "user" as const,
        text: `目标岗位备选 ${index}`,
        streaming: false,
        createdAt: index + 2,
      })),
      ...Array.from({ length: 5_000 }, (_, index) => ({
        kind: "text" as const,
        id: `noise-${index}`,
        runId: `noise-run-${index}`,
        role: "momo" as const,
        text: `无关的日常记录 ${index}`,
        streaming: false,
        createdAt: index + 1_000,
      })),
    ];
    persistence.saveConversation(entry.meta, entry.timeline);

    const candidates = loadRelationshipHistoryCandidates(database, {
      query: "目标岗位 远程数据产品",
      limit: 8,
    });

    expect(candidates.length).toBeLessThanOrEqual(MAX_RELATIONSHIP_HISTORY_CANDIDATES);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: "exact-old-run", text: "目标岗位是远程数据产品" }),
    ]));
    expect(candidates.some((candidate) => candidate.runId.startsWith("noise-run-"))).toBe(false);
  });
});
