import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createPersistence } from "../../src/main/persistence/schema";
import type { ConversationMeta } from "../../src/renderer/stores/conversations";
import type { TimelineItem } from "../../src/renderer/stores/message-model";
import type { WikiEntry } from "../../src/renderer/stores/wiki-entries";
import type { ScheduledTask, ScheduledTaskRun } from "../../src/scheduled-tasks";
import type {
  PersistedGlobalOverviewState,
  StandaloneUsageEvent,
} from "../../src/bridge/global-pending-overview";

function makeDb() {
  return new Database(":memory:");
}

const meta: ConversationMeta = {
  id: "c1",
  title: "测试对话",
  titleManuallyUpdated: false,
  bookId: null,
  source: "buddy",
  providerId: "deepseek",
  modelId: "deepseek-chat",
  createdAt: 1000,
  lastActivityAt: 2000,
  unread: false,
  pinned: false,
  archived: false,
  lastOpenedAt: 2000,
} as ConversationMeta;

const items: TimelineItem[] = [
  { kind: "text", id: "u0", runId: "run-1", role: "user", text: "hello", streaming: false },
  { kind: "text", id: "m1", runId: "run-1", role: "momo", text: "hi", streaming: false },
];

const wikiEntry: WikiEntry = {
  id: "wiki-1",
  workspaceId: "workspace-course",
  filePath: "/foo.ts",
  quotedText: "some code",
  turns: [{ question: "what?", answer: "this" }],
  createdAt: 3000,
};

describe("persistence schema", () => {
  let db: InstanceType<typeof Database>;
  let p: ReturnType<typeof createPersistence>;

  beforeEach(() => {
    db = makeDb();
    p = createPersistence(db);
  });

  it("saves and loads a conversation with timeline", () => {
    p.saveConversation(meta, items);
    const snap = p.loadAll();
    expect(snap.conversations).toHaveLength(1);
    expect(snap.conversations[0].meta).toEqual(meta);
    expect(snap.conversations[0].timeline).toEqual(items);
  });

  it("upserts conversation (idempotent)", () => {
    p.saveConversation(meta, items);
    p.saveConversation({ ...meta, title: "updated" }, items);
    const snap = p.loadAll();
    expect(snap.conversations).toHaveLength(1);
    expect(snap.conversations[0].meta.title).toBe("updated");
  });

  it("round-trips the singleton global overview state without touching conversations", () => {
    const state: PersistedGlobalOverviewState = {
      version: 1,
      snapshot: null,
      overrides: [],
      lastAutoAttemptDate: "2026-08-18",
    };
    p.saveConversation(meta, items);

    p.saveGlobalOverviewState(state);

    expect(p.loadGlobalOverviewState()).toEqual(state);
    expect(p.loadAll()).toMatchObject({
      conversations: [{ meta, timeline: items }],
      globalPendingOverview: state,
    });
  });

  it("ignores a corrupt global overview blob while preserving all other startup data", () => {
    p.saveConversation(meta, items);
    db.prepare(`INSERT INTO global_overview_state (singleton, state_json, updated_at) VALUES (1, ?, ?)`)
      .run('{"version":1,"snapshot":"broken"}', 123);

    expect(p.loadGlobalOverviewState()).toBeNull();
    const snapshot = p.loadAll();
    expect(snapshot.globalPendingOverview).toBeUndefined();
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.conversations[0]?.meta.id).toBe(meta.id);
  });

  it("restores the active conversation goal after restart", () => {
    const goal = {
      text: "完成主界面视觉复现",
      status: "active" as const,
      createdAt: 1_000,
      updatedAt: 2_000,
    };
    p.saveConversation({ ...meta, goal } as ConversationMeta, items);

    expect(p.loadAll().conversations[0]?.meta).toMatchObject({ goal });
  });

  it("rebuilds the disposable conversation, message, and usage index exactly", () => {
    const usage: TimelineItem[] = [
      ...items,
      { kind: "usage", id: "usage-1", runId: "run-1", usage: { providerId: "deepseek", modelId: "deepseek-chat", inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false } },
    ];
    p.saveConversation(meta, usage);
    p.saveConversation({ ...meta, id: "stale", title: "过期索引" }, items);

    p.rebuildConversationIndex([{ meta: { ...meta, title: "来自本子归档" }, timeline: items }]);

    expect(p.loadAll().conversations).toEqual([
      { meta: { ...meta, title: "来自本子归档" }, timeline: items },
    ]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = 'stale'").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM usage").get() as { n: number }).n).toBe(0);
  });

  it("saves and loads wiki entries", () => {
    p.saveWikiEntry(wikiEntry);
    const snap = p.loadAll();
    expect(snap.wikiEntries).toHaveLength(1);
    expect(snap.wikiEntries[0]).toEqual(wikiEntry);
  });

  it("upserts wiki entry (idempotent)", () => {
    p.saveWikiEntry(wikiEntry);
    p.saveWikiEntry({ ...wikiEntry, turns: [{ question: "q2", answer: "a2" }] });
    const snap = p.loadAll();
    expect(snap.wikiEntries).toHaveLength(1);
    expect(snap.wikiEntries[0].turns).toHaveLength(1);
    expect(snap.wikiEntries[0].turns[0].question).toBe("q2");
  });

  it("returns empty arrays when nothing saved", () => {
    const snap = p.loadAll();
    expect(snap.conversations).toEqual([]);
    expect(snap.wikiEntries).toEqual([]);
  });

  it("preserves all TimelineItem kinds round-trip", () => {
    const rich: TimelineItem[] = [
      { kind: "text", id: "u0", runId: "r1", role: "user", text: "q", streaming: false },
      { kind: "thinking", id: "m1", runId: "r1", text: "...", streaming: false },
      { kind: "tool", id: "m2", runId: "r1", toolUseId: "t1", name: "Bash", input: { cmd: "ls" }, status: "ok", summary: "done" },
      { kind: "result", id: "m3", runId: "r1", isError: false, interrupted: false, finalText: "ok", pathAudit: { claimed: [] } },
      { kind: "usage", id: "m4", runId: "r1", usage: { providerId: "deepseek", modelId: "deepseek-chat", inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: "0.000042", costSource: "local-pricing", tokensEstimated: false } },
      { kind: "memory", id: "m5", runId: "r1", changeId: "change-1", action: "remembered", label: "用户喜欢先看结论", scope: { type: "global" }, undone: false },
      { kind: "files", id: "m6", runId: "r1", changes: [{ path: "课程笔记/第一章.md", change: "modified" }], omitted: 2 },
    ];
    p.saveConversation(meta, rich);
    const snap = p.loadAll();
    expect(snap.conversations[0].timeline).toEqual(rich);
  });

  it("writes a derived usage row per usage TimelineItem (06 §六 usage 表)", () => {
    const withUsage: TimelineItem[] = [
      { kind: "text", id: "u0", runId: "r1", role: "user", text: "q", streaming: false },
      { kind: "usage", id: "m1", runId: "r1", usage: { providerId: "glm", modelId: "glm-5.2", inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 0, costUsd: "0.001234", costSource: "local-pricing", tokensEstimated: true } },
    ];
    p.saveConversation(meta, withUsage);
    const row = db.prepare("SELECT * FROM usage WHERE conversation_id = ?").get(meta.id) as Record<string, unknown>;
    expect(row.provider_id).toBe("glm");
    expect(row.model_id).toBe("glm-5.2");
    expect(row.input_tokens).toBe(100);
    expect(row.output_tokens).toBe(20);
    expect(row.cache_read_tokens).toBe(5);
    expect(row.cache_creation_tokens).toBe(0);
    expect(row.cost_usd).toBe("0.001234");
    expect(row.cost_source).toBe("local-pricing");
    expect(row.tokens_estimated).toBe(1);
  });

  it("indexes modelUsage as one row per real model without duplicating the aggregate", () => {
    const withBreakdown: TimelineItem[] = [{
      kind: "usage",
      id: "usage-models",
      runId: "r1",
      usage: {
        providerId: "anthropic-subscription",
        modelId: "selected-alias",
        inputTokens: 150,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheCreationTokens: 5,
        durationMs: 2_500,
        costUsd: "0.120000",
        costSource: "sdk",
        tokensEstimated: false,
        modelBreakdown: [
          {
            providerId: "anthropic-subscription",
            modelId: "claude-haiku-4-5",
            servingProvider: "anthropic",
            inputTokens: 50,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            costUsd: "0.020000",
          },
          {
            providerId: "anthropic-subscription",
            modelId: "claude-sonnet-4-6",
            servingProvider: "anthropic",
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 20,
            cacheCreationTokens: 5,
            costUsd: "0.100000",
          },
        ],
      },
    }];

    p.saveConversation(meta, withBreakdown);
    const rows = db.prepare(
      "SELECT model_id, input_tokens, output_tokens, cost_usd, duration_ms FROM usage WHERE conversation_id = ? ORDER BY model_id",
    ).all(meta.id) as Array<Record<string, unknown>>;

    expect(rows).toEqual([
      expect.objectContaining({ model_id: "claude-haiku-4-5", input_tokens: 50, output_tokens: 10, cost_usd: "0.020000", duration_ms: 2_500 }),
      expect.objectContaining({ model_id: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 20, cost_usd: "0.100000", duration_ms: null }),
    ]);
    expect(rows.some((row) => row.model_id === "selected-alias")).toBe(false);
  });

  it("re-saving a conversation replaces (not duplicates) its usage rows", () => {
    const once: TimelineItem[] = [
      { kind: "usage", id: "m1", runId: "r1", usage: { providerId: "deepseek", modelId: "deepseek-chat", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costSource: "unpriced", tokensEstimated: false } },
    ];
    p.saveConversation(meta, once);
    p.saveConversation(meta, once);
    const count = db.prepare("SELECT COUNT(*) AS n FROM usage WHERE conversation_id = ?").get(meta.id) as { n: number };
    expect(count.n).toBe(1);
  });

  // 轮 2 卡 C — the session id is what makes a restarted conversation actually
  // remember; without persisting it, re-claiming only restores the ability to
  // send, not the context.
  it("round-trips a conversation's sessionId", () => {
    p.saveConversation({
      ...meta,
      sessionId: "sess-abc-123",
      sessionProviderId: "deepseek",
    }, items);
    expect(p.loadAll().conversations[0].meta).toMatchObject({
      sessionId: "sess-abc-123",
      sessionProviderId: "deepseek",
    });
  });

  it("loads a conversation that has no sessionId without inventing one", () => {
    p.saveConversation(meta, items);
    expect(p.loadAll().conversations[0].meta.sessionId).toBeUndefined();
  });

  it("overwrites a stale sessionId on re-save", () => {
    p.saveConversation({ ...meta, sessionId: "sess-old" }, items);
    p.saveConversation({ ...meta, sessionId: "sess-new" }, items);
    expect(p.loadAll().conversations[0].meta.sessionId).toBe("sess-new");
  });

  it("round-trips the opaque workspace id without persisting a path", () => {
    p.saveConversation({ ...meta, workspaceId: "workspace-project" }, items);
    expect(p.loadAll().conversations[0].meta.workspaceId).toBe("workspace-project");
    const row = db.prepare("SELECT workspace_id FROM conversations WHERE id = ?").get(meta.id) as { workspace_id: string };
    expect(row.workspace_id).toBe("workspace-project");
  });

  it("round-trips conversation lifecycle state and fills legacy defaults", () => {
    const lifecycle = {
      ...meta,
      pinned: true,
      archived: true,
      lastOpenedAt: 3_456,
    } as ConversationMeta;
    p.saveConversation(lifecycle, items);
    expect(p.loadAll().conversations[0]?.meta).toMatchObject({
      pinned: true,
      archived: true,
      lastOpenedAt: 3_456,
    });

    db.prepare(`UPDATE conversations SET pinned = NULL, archived = NULL, last_opened_at = NULL WHERE id = ?`).run(meta.id);
    expect(p.loadAll().conversations[0]?.meta).toMatchObject({
      pinned: false,
      archived: false,
      lastOpenedAt: meta.lastActivityAt,
    });
  });

  it("tombstones a deleted conversation so delayed saves and index rebuilds cannot resurrect it", () => {
    p.saveConversation(meta, items);
    p.deleteConversation(meta.id);

    expect(p.isConversationDeleted(meta.id)).toBe(true);
    expect(p.loadAll().conversations).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?").get(meta.id) as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM usage WHERE conversation_id = ?").get(meta.id) as { n: number }).n).toBe(0);

    p.saveConversation(meta, items);
    p.rebuildConversationIndex([{ meta, timeline: items }]);
    expect(p.loadAll().conversations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Migration onto an EXISTING database (轮 2 卡 C).
//
// SCHEMA uses CREATE TABLE IF NOT EXISTS, which does NOTHING to a table that
// already exists — so on every machine that has already chatted, editing the
// DDL string alone leaves `conversations` permanently without session_id and
// every write blows up with "no column named session_id". These tests build the
// PRE-卡C schema by hand (byte-for-byte the old DDL, with real rows in it) and
// then run createPersistence over it, which is exactly what a user's leemo.db
// goes through on the next launch.
// ---------------------------------------------------------------------------

/** The `conversations` DDL exactly as it shipped BEFORE 卡 C. */
const OLD_CONVERSATIONS_DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_manually_updated INTEGER NOT NULL,
  book_id TEXT,
  source TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  unread INTEGER NOT NULL
);
`;

function seedOldDatabase(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(OLD_CONVERSATIONS_DDL);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
      item_json TEXT NOT NULL, PRIMARY KEY (conversation_id, seq)
    );
  `);
  // A real pre-existing conversation with a real message, as on the user's disk.
  db.prepare(
    `INSERT INTO conversations
       (id, title, title_manually_updated, book_id, source, provider_id, model_id, created_at, last_activity_at, unread)
     VALUES ('c-legacy', '重启前就存在的对话', 0, NULL, 'buddy', 'deepseek', 'deepseek-v4-flash', 111, 222, 0)`,
  ).run();
  db.prepare(`INSERT INTO messages (conversation_id, seq, kind, item_json) VALUES (?, ?, ?, ?)`).run(
    "c-legacy",
    0,
    "text",
    JSON.stringify({ kind: "text", id: "u0", runId: "run-1", role: "user", text: "旧消息", streaming: false }),
  );
  return db;
}

describe("persistence schema — migration of an existing (pre-卡C) database", () => {
  it("proves the fixture really lacks session_id (guards the test itself)", () => {
    const db = seedOldDatabase();
    const cols = (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("session_id");
  });

  it("adds session_id to a table CREATE TABLE IF NOT EXISTS would have skipped", () => {
    const db = seedOldDatabase();
    createPersistence(db);
    const cols = (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("session_id");
    expect(cols).toContain("session_provider_id");
    expect(cols).toContain("workspace_id");
    expect(cols).toContain("pinned");
    expect(cols).toContain("archived");
    expect(cols).toContain("last_opened_at");
  });

  it("keeps the pre-existing rows intact (ALTER, not drop-and-recreate)", () => {
    const db = seedOldDatabase();
    const p = createPersistence(db);
    const snap = p.loadAll();
    expect(snap.conversations).toHaveLength(1);
    expect(snap.conversations[0].meta.title).toBe("重启前就存在的对话");
    expect(snap.conversations[0].meta.sessionId).toBeUndefined();
    expect(snap.conversations[0].meta.sessionProviderId).toBeUndefined();
    expect(snap.conversations[0].meta.workspaceId).toBeUndefined();
    expect(snap.conversations[0].meta).toMatchObject({
      pinned: false,
      archived: false,
      lastOpenedAt: 222,
    });
    expect(snap.conversations[0].timeline).toHaveLength(1);
  });

  it("can WRITE a sessionId onto a legacy row (the crash the migration prevents)", () => {
    const db = seedOldDatabase();
    const p = createPersistence(db);
    const legacy = p.loadAll().conversations[0];
    // Without the ALTER this throws: table conversations has no column named session_id.
    p.saveConversation({ ...legacy.meta, sessionId: "sess-after-migration" }, legacy.timeline);
    expect(p.loadAll().conversations[0].meta.sessionId).toBe("sess-after-migration");
  });

  it("is idempotent — a second open must not fail on duplicate column", () => {
    const db = seedOldDatabase();
    createPersistence(db);
    expect(() => createPersistence(db)).not.toThrow();
    const cols = (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === "session_id")).toHaveLength(1);
    expect(cols.filter((c) => c === "session_provider_id")).toHaveLength(1);
    expect(cols.filter((c) => c === "workspace_id")).toHaveLength(1);
    expect(cols.filter((c) => c === "pinned")).toHaveLength(1);
    expect(cols.filter((c) => c === "archived")).toHaveLength(1);
    expect(cols.filter((c) => c === "last_opened_at")).toHaveLength(1);
  });

  it("a brand-new database gets session_id straight from the DDL", () => {
    const db = new Database(":memory:");
    createPersistence(db);
    const cols = (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("session_id");
    expect(cols).toContain("session_provider_id");
    expect(cols).toContain("workspace_id");
    expect(cols).toContain("pinned");
    expect(cols).toContain("archived");
    expect(cols).toContain("last_opened_at");
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_tombstones'").get() as { name: string }).name).toBe("conversation_tombstones");
  });
});

describe("wiki entry workspace migration", () => {
  it("adds workspace ownership without losing older selection history", () => {
    const db = makeDb();
    db.exec(`
      CREATE TABLE wiki_entries (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        quoted_text TEXT NOT NULL,
        turns_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO wiki_entries (id, file_path, quoted_text, turns_json, created_at)
      VALUES ('legacy-wiki', 'notes.md', '旧选区', '[]', 1);
    `);

    const persistence = createPersistence(db);
    const columns = (db.prepare("PRAGMA table_info(wiki_entries)").all() as { name: string }[])
      .map((column) => column.name);
    expect(columns).toContain("workspace_id");
    expect(persistence.loadAll().wikiEntries).toContainEqual({
      id: "legacy-wiki",
      filePath: "notes.md",
      quotedText: "旧选区",
      turns: [],
      createdAt: 1,
    });
  });
});

// ── 轮 7 A3: settings 表 ────────────────────────────────────────────────────
describe("settings persistence (轮 7 A3)", () => {
  it("commits a new relationship chapter and its pointer in one transaction", () => {
    const db = makeDb();
    const p = createPersistence(db);
    p.saveSettings({ themeId: "c", relationshipConversationId: "old-chapter" });

    p.saveRelationshipChapter({ ...meta, id: "new-chapter", title: "新话题" }, []);

    expect(p.loadAll()).toMatchObject({
      conversations: [{ meta: expect.objectContaining({ id: "new-chapter" }), timeline: [] }],
      settings: { themeId: "c", relationshipConversationId: "new-chapter" },
    });
  });

  it("rolls back both the chapter and pointer when the atomic relationship commit fails", () => {
    const db = makeDb();
    const p = createPersistence(db);
    p.saveSettings({ themeId: "c", relationshipConversationId: "old-chapter" });
    db.exec(`
      CREATE TRIGGER reject_relationship_pointer
      BEFORE INSERT ON settings
      WHEN NEW.key = 'relationshipConversationId'
      BEGIN
        SELECT RAISE(ABORT, 'relationship pointer rejected');
      END;
    `);

    expect(() => p.saveRelationshipChapter({ ...meta, id: "failed-chapter" }, [])).toThrow(/relationship pointer rejected/);
    expect(p.loadAll()).toMatchObject({
      conversations: [],
      settings: { themeId: "c", relationshipConversationId: "old-chapter" },
    });
  });

  it("round-trips every JSON value shape a setting can hold", () => {
    const p = createPersistence(makeDb());
    p.saveSettings({
      webEnabled: true,
      dangerousCommandCaching: false,
      talkStyle: 2,
      permissionMode: "bypassPermissions",
      defaultModelId: null,
    });
    // Booleans must not come back as 0/1 and null must not become "null":
    // that is the whole reason values are JSON-encoded rather than stringified.
    expect(p.loadAll().settings).toEqual({
      webEnabled: true,
      dangerousCommandCaching: false,
      talkStyle: 2,
      permissionMode: "bypassPermissions",
      defaultModelId: null,
    });
  });

  it("a fresh database reports empty settings, not undefined", () => {
    // The bootstrap does `if (snap.settings)` — undefined would silently skip
    // hydration forever on a new install.
    expect(createPersistence(makeDb()).loadAll().settings).toEqual({});
  });

  it("saving REPLACES the map (a removed key does not linger)", () => {
    const p = createPersistence(makeDb());
    p.saveSettings({ webEnabled: true, talkStyle: 1 });
    p.saveSettings({ talkStyle: 3 });
    expect(p.loadAll().settings).toEqual({ talkStyle: 3 });
  });

  it("skips an undefined value rather than writing the string \"undefined\"", () => {
    const p = createPersistence(makeDb());
    p.saveSettings({ good: 1, bad: undefined });
    expect(p.loadAll().settings).toEqual({ good: 1 });
  });

  it("a corrupt row is skipped, and never costs the user their conversations", () => {
    const db = makeDb();
    const p = createPersistence(db);
    p.saveConversation(meta, items);
    p.saveSettings({ webEnabled: true });
    // Simulate a value written by a build with a different encoding, or a
    // partially-flushed row.
    db.prepare(`INSERT INTO settings (key, value_json) VALUES ('broken', '{oops')`).run();
    const snap = p.loadAll();
    expect(snap.settings).toEqual({ webEnabled: true }); // bad key dropped
    expect(snap.conversations).toHaveLength(1);          // the load-bearing part
  });

  it("an existing pre-A3 database gains the settings table without losing rows", () => {
    const db = seedOldDatabase();
    const p = createPersistence(db);
    p.saveSettings({ webEnabled: true });
    expect(p.loadAll().settings).toEqual({ webEnabled: true });
  });
});

describe("composer 草稿 persistence", () => {
  it("按 scope 整体替换并在重启快照恢复", () => {
    const db = makeDb();
    const p = createPersistence(db);
    p.saveComposerDrafts({
      "workspace:leemo-home": { text: "第一句", attachments: [], workspaceFiles: [] },
      "conversation:old": { text: "旧话题", attachments: [], workspaceFiles: [] },
    });
    p.saveComposerDrafts({
      "workspace:leemo-home": { text: "更新后", attachments: [], workspaceFiles: [] },
    });

    expect(createPersistence(db).loadAll().composerDrafts).toEqual({
      "workspace:leemo-home": { text: "更新后", attachments: [], workspaceFiles: [] },
    });
  });

  it("坏草稿行不会拖垮对话与其它有效草稿恢复", () => {
    const db = makeDb();
    const p = createPersistence(db);
    p.saveConversation(meta, items);
    p.saveComposerDrafts({ valid: { text: "还在", attachments: [], workspaceFiles: [] } });
    db.prepare("INSERT INTO composer_drafts (scope, draft_json, updated_at) VALUES (?, ?, ?)")
      .run("broken", "{oops", Date.now());

    const snap = p.loadAll();
    expect(snap.composerDrafts).toEqual({ valid: { text: "还在", attachments: [], workspaceFiles: [] } });
    expect(snap.conversations).toHaveLength(1);
  });
});

describe("approval whitelist persistence", () => {
  it("persists unique tool-risk entries across database reopen and removes the exact entry", () => {
    const db = makeDb();
    const first = createPersistence(db);
    first.addToWhitelist({ toolName: "Write", risk: "moderate" });
    first.addToWhitelist({ toolName: "Write", risk: "moderate" });
    first.addToWhitelist({ toolName: "Read", risk: "safe" });
    first.addToWhitelist({ toolName: "Bash", risk: "moderate" });
    first.addToWhitelist({ toolName: "Write", risk: "dangerous" });

    const reopened = createPersistence(db);
    expect(reopened.getWhitelist()).toEqual([
      { toolName: "Read", risk: "safe" },
      { toolName: "Write", risk: "moderate" },
    ]);

    reopened.removeFromWhitelist({ toolName: "Write", risk: "moderate" });
    expect(reopened.getWhitelist()).toEqual([{ toolName: "Read", risk: "safe" }]);
  });
});

describe("scheduled task persistence", () => {
  const task: ScheduledTask = {
    id: "task-1",
    name: "每日英语练习",
    prompt: "给我一份 10 分钟英语练习",
    schedule: { kind: "daily", hour: 8, minute: 0 },
    timezone: "Asia/Tokyo",
    nextRunAt: 2_000,
    workspaceId: "leemo-home",
    status: "active",
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  const run: ScheduledTaskRun = {
    id: "run-1",
    taskId: task.id,
    scheduledFor: 2_000,
    trigger: "scheduled",
    status: "queued",
    createdAt: 2_000,
  };

  it("round-trips schedules, result workspace, conversation, and run history", () => {
    const p = createPersistence(makeDb());
    p.saveScheduledTask({ ...task, conversationId: "conversation-1" });
    p.saveScheduledTaskRun(run);

    expect(p.listScheduledTasks()).toEqual([{ ...task, conversationId: "conversation-1" }]);
    expect(p.getScheduledTask(task.id)?.schedule).toEqual(task.schedule);
    expect(p.listScheduledTaskRuns(task.id)).toEqual([run]);
  });

  it("restores selected-weekday recurrence after the persistence service restarts", () => {
    const db = makeDb();
    const first = createPersistence(db);
    const recurring: ScheduledTask = {
      ...task,
      schedule: { kind: "weekly", weekdays: [1, 3, 5], hour: 8, minute: 30 },
    };
    first.saveScheduledTask(recurring);

    const reopened = createPersistence(db);
    expect(reopened.getScheduledTask(task.id)?.schedule).toEqual(recurring.schedule);
  });

  it("queues one occurrence with its advanced task and claims it only once", () => {
    const p = createPersistence(makeDb());
    p.saveScheduledTask(task);
    p.queueScheduledOccurrence({ ...task, nextRunAt: 86_400_000, lastRunAt: 2_000, updatedAt: 2_000 }, run);

    expect(p.getScheduledTask(task.id)).toMatchObject({ nextRunAt: 86_400_000, lastRunAt: 2_000 });
    expect(p.claimScheduledTaskRun(run.id, 2_100)).toMatchObject({ status: "running", startedAt: 2_100 });
    expect(p.claimScheduledTaskRun(run.id, 2_200)).toBeUndefined();

    p.completeScheduledTaskRun({
      ...run,
      status: "succeeded",
      startedAt: 2_100,
      completedAt: 2_500,
      conversationId: "conversation-1",
    });
    expect(p.listScheduledTaskRuns(task.id)[0]).toMatchObject({
      status: "succeeded",
      completedAt: 2_500,
      conversationId: "conversation-1",
    });
  });

  it("turns unfinished work into an honest missed run after restart", () => {
    const p = createPersistence(makeDb());
    p.saveScheduledTask(task);
    p.saveScheduledTaskRun({ ...run, status: "running", startedAt: 2_050 });
    p.markStaleScheduledRunsMissed(3_000);
    expect(p.listScheduledTaskRuns(task.id)[0]).toMatchObject({
      status: "missed",
      completedAt: 3_000,
    });
  });

  it("deleting a task removes only its own local records", () => {
    const p = createPersistence(makeDb());
    p.saveScheduledTask(task);
    p.saveScheduledTaskRun(run);
    p.deleteScheduledTask(task.id);
    expect(p.listScheduledTasks()).toEqual([]);
    expect(p.listScheduledTaskRuns()).toEqual([]);
  });
});

describe("usage summaries", () => {
  function usage(
    providerId: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd?: string,
    cacheReadTokens = 0,
    cacheCreationTokens = 0,
  ): TimelineItem {
    return {
      kind: "usage",
      id: `${providerId}-${inputTokens}`,
      runId: `${providerId}-${inputTokens}`,
      usage: {
        providerId,
        modelId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        ...(costUsd === undefined ? {} : { costUsd }),
        costSource: costUsd === undefined ? "unpriced" : "local-pricing",
        tokensEstimated: false,
      },
    };
  }

  it("includes standalone overview usage exactly once and keeps it across index rebuilds", () => {
    const db = makeDb();
    const p = createPersistence(db);
    const now = new Date(2026, 7, 18, 14, 0, 0).getTime();
    p.saveConversation(
      { ...meta, id: "conversation-usage", lastActivityAt: now },
      [usage("deepseek", "deepseek-chat", 10, 2, "0.000010", 1, 0)],
    );
    const standalone: StandaloneUsageEvent = {
      id: "overview-usage-1",
      purpose: "global-overview",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      inputTokens: 20,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 1,
      costUsd: "0.000020",
      costSource: "local-pricing",
      tokensEstimated: false,
      durationMs: 120,
      createdAt: now,
    };
    p.recordStandaloneUsage(standalone);
    p.recordStandaloneUsage(standalone);

    expect(p.usageSummary({ range: "today" }, now)).toMatchObject({
      callCount: 2,
      inputTokens: 30,
      outputTokens: 6,
      cacheReadTokens: 4,
      cacheCreationTokens: 1,
      totalCostUsd: "0.000030",
    });

    p.rebuildConversationIndex([]);

    expect(p.usageSummary({ range: "today" }, now)).toMatchObject({
      callCount: 1,
      inputTokens: 20,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 1,
      totalCostUsd: "0.000020",
    });
  });

  it("aggregates today and last seven local days without floating-point cost drift", () => {
    const p = createPersistence(makeDb());
    const now = new Date(2026, 6, 29, 15, 0, 0).getTime();
    p.saveConversation(
      { ...meta, id: "today-priced", lastActivityAt: new Date(2026, 6, 29, 9).getTime() },
      [usage("alpha", "a1", 100, 20, "0.000001", 40, 5)],
    );
    p.saveConversation(
      { ...meta, id: "today-unpriced", lastActivityAt: new Date(2026, 6, 29, 11).getTime() },
      [usage("alpha", "a2", 50, 10)],
    );
    p.saveConversation(
      { ...meta, id: "yesterday", lastActivityAt: new Date(2026, 6, 28, 18).getTime() },
      [usage("beta", "b1", 200, 40, "0.100005")],
    );
    p.saveConversation(
      { ...meta, id: "too-old", lastActivityAt: new Date(2026, 6, 21, 18).getTime() },
      [usage("old", "old", 999, 999, "9.999999")],
    );

    expect(p.usageSummary({ range: "today" }, now)).toEqual({
      totalCostUsd: "0.000001",
      callCount: 2,
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 40,
      cacheCreationTokens: 5,
      byProvider: [{
        providerId: "alpha",
        costUsd: "0.000001",
        callCount: 2,
        inputTokens: 150,
        outputTokens: 30,
        cacheReadTokens: 40,
        cacheCreationTokens: 5,
      }],
      byModel: [
        { providerId: "alpha", modelId: "a1", costUsd: "0.000001", callCount: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheCreationTokens: 5 },
        { providerId: "alpha", modelId: "a2", callCount: 1, inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ],
      byDay: undefined,
    });
    expect(p.usageSummary({ range: "last7d" }, now)).toEqual({
      totalCostUsd: "0.100006",
      callCount: 3,
      inputTokens: 350,
      outputTokens: 70,
      cacheReadTokens: 40,
      cacheCreationTokens: 5,
      byProvider: [
        { providerId: "alpha", costUsd: "0.000001", callCount: 2, inputTokens: 150, outputTokens: 30, cacheReadTokens: 40, cacheCreationTokens: 5 },
        { providerId: "beta", costUsd: "0.100005", callCount: 1, inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ],
      byModel: [
        { providerId: "alpha", modelId: "a1", costUsd: "0.000001", callCount: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheCreationTokens: 5 },
        { providerId: "alpha", modelId: "a2", callCount: 1, inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 },
        { providerId: "beta", modelId: "b1", costUsd: "0.100005", callCount: 1, inputTokens: 200, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0 },
      ],
      byDay: [
        { date: "2026-07-28", costUsd: "0.100005" },
        { date: "2026-07-29", costUsd: "0.000001" },
      ],
    });
  });

  it("supports provider filtering and leaves cost absent when every matching row is unpriced", () => {
    const p = createPersistence(makeDb());
    const now = new Date(2026, 6, 29, 15, 0, 0).getTime();
    p.saveConversation(
      { ...meta, id: "unpriced", lastActivityAt: new Date(2026, 6, 29, 11).getTime() },
      [usage("alpha", "a1", 12, 3)],
    );
    p.saveConversation(
      { ...meta, id: "other", lastActivityAt: new Date(2026, 6, 29, 12).getTime() },
      [usage("beta", "b1", 90, 10, "0.500000")],
    );

    expect(p.usageSummary({ range: "today", providerId: "alpha" }, now)).toEqual({
      callCount: 1,
      inputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      byProvider: [{ providerId: "alpha", callCount: 1, inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 }],
      byModel: [{ providerId: "alpha", modelId: "a1", callCount: 1, inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheCreationTokens: 0 }],
      byDay: undefined,
    });
  });
});
