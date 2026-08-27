/**
 * SQLite persistence schema + CRUD for the Electron main process.
 *
 * Dependency-injected `Database` (better-sqlite3 shape) so this module is unit-
 * tested against an in-memory DB under system Node, while main.ts injects the
 * real file-backed, Electron-ABI-rebuilt better-sqlite3 instance. The module
 * treats each TimelineItem as an opaque JSON row — it never introspects the
 * renderer's TimelineItem union (layering: main knows no renderer types).
 *
 * Tables (06 §六 数据与持久化): conversations / messages / usage /
 * wiki_entries / settings / approval_whitelist.
 */
import type { UsageSummary, UsageSummaryQuery } from "../../bridge/contract";
import fs from "node:fs";
import path from "node:path";
import {
  normalizePersistedGlobalOverviewState,
  type PersistedGlobalOverviewState,
  type StandaloneUsageEvent,
} from "../../bridge/global-pending-overview";
import type { ApprovalPersistence, WhitelistEntry } from "../../bridge/interact";
import type { ConversationMeta } from "../../renderer/stores/conversations";
import type { TimelineItem } from "../../renderer/stores/message-model";
import type { WikiEntry } from "../../renderer/stores/wiki-entries";
import { isScheduledTaskSchedule } from "../../scheduled-tasks";
import type {
  ScheduledTask,
  ScheduledTaskRun,
} from "../../scheduled-tasks";
import type {
  LearningProfile,
  LearningReviewItem,
  LearningSession,
} from "../../learning";
import { LEARNING_FOCUSES, LEARNING_SKILLS } from "../../learning";
import {
  createCapturePersistence,
  type CapturePersistence,
} from "./capture-persistence";

type JsonRecord = Record<string, unknown>;

const LEARNING_REVIEW_STATES = new Set(["new", "learning", "review", "relearning"]);
const LEARNING_REVIEW_RATINGS = new Set(["again", "hard", "good", "easy"]);
const LEARNING_SESSION_KINDS = new Set(["baseline", "practice", "check"]);

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isLearningProfile(value: unknown): value is LearningProfile {
  if (!isJsonRecord(value)) return false;
  return value.id === "english"
    && typeof value.goal === "string"
    && LEARNING_FOCUSES.includes(value.focus as LearningProfile["focus"])
    && Number.isInteger(value.dailyMinutes)
    && isFiniteNumber(value.createdAt)
    && isFiniteNumber(value.updatedAt);
}

function isLearningReviewItem(value: unknown): value is LearningReviewItem {
  if (!isJsonRecord(value)) return false;
  return typeof value.id === "string"
    && LEARNING_SKILLS.includes(value.skill as LearningReviewItem["skill"])
    && typeof value.cue === "string"
    && typeof value.correction === "string"
    && isOptionalString(value.userAnswer)
    && isOptionalString(value.explanation)
    && isOptionalString(value.sourceConversationId)
    && isFiniteNumber(value.createdAt)
    && isFiniteNumber(value.updatedAt)
    && isFiniteNumber(value.dueAt)
    && (value.lastReviewedAt === undefined || isFiniteNumber(value.lastReviewedAt))
    && isFiniteNumber(value.stability)
    && isFiniteNumber(value.difficulty)
    && isFiniteNumber(value.elapsedDays)
    && isFiniteNumber(value.scheduledDays)
    && isFiniteNumber(value.learningSteps)
    && isFiniteNumber(value.reps)
    && isFiniteNumber(value.lapses)
    && LEARNING_REVIEW_STATES.has(String(value.state))
    && Number.isInteger(value.encounterCount)
    && LEARNING_REVIEW_RATINGS.has(String(value.lastRating));
}

function isLearningSession(value: unknown): value is LearningSession {
  if (!isJsonRecord(value)) return false;
  return typeof value.id === "string"
    && LEARNING_SESSION_KINDS.has(String(value.kind))
    && LEARNING_SKILLS.includes(value.skill as LearningSession["skill"])
    && isOptionalString(value.assessmentKey)
    && Number.isInteger(value.correct)
    && Number.isInteger(value.total)
    && Number.isInteger(value.score)
    && typeof value.summary === "string"
    && isOptionalString(value.conversationId)
    && isFiniteNumber(value.createdAt);
}

function parseLearningRecord<T>(
  raw: string,
  label: string,
  validate: (value: unknown) => value is T,
): T {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}无法读取，原数据仍保留。`);
  }
  if (!validate(value)) throw new Error(`${label}无法读取，原数据仍保留。`);
  return value;
}

/** The minimal better-sqlite3 surface we use (so tests can inject a real
 *  :memory: instance without importing the native module here). */
export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
  /** Wrap fn in a transaction. Signature kept assignable-FROM better-sqlite3's
   *  own `transaction` (which returns a callable `Transaction<F>`), so the real
   *  Database satisfies this interface without a cast. */
  transaction<Args extends unknown[]>(fn: (...args: Args) => unknown): (...args: Args) => unknown;
}

export interface PersistenceOptions {
  /** Root containing per-provider Claude Agent SDK state. Packaged builds pass
   *  `<userData>/workspace/data`; tests and non-desktop callers may omit it. */
  sessionDataDir?: string;
}

export interface PersistedConversation {
  meta: ConversationMeta;
  timeline: TimelineItem[];
}

export interface PersistedSnapshot {
  conversations: PersistedConversation[];
  wikiEntries: WikiEntry[];
  /** 轮 7 A3 —— persisted user settings, keyed exactly as the renderer's
   *  settings store names them. Absent keys mean "never saved" and the store
   *  keeps its own default, which is what makes adding a new setting a no-op
   *  here. Empty object on a fresh install. */
  settings: Record<string, unknown>;
  composerDrafts: Record<string, unknown>;
  globalPendingOverview?: PersistedGlobalOverviewState;
}

export interface Persistence extends ApprovalPersistence {
  /** Upsert a conversation's meta + replace its full message timeline. Also
   *  refreshes the derived usage rows for that conversation. */
  saveConversation(meta: ConversationMeta, timeline: TimelineItem[]): void;
  /** Create an empty momo relationship chapter and advance the durable active
   * chapter pointer in one SQLite transaction. Workspace wrappers stage the
   * portable record before calling this boundary. */
  saveRelationshipChapter(meta: ConversationMeta, timeline: TimelineItem[]): void;
  /** Move is an explicit durability boundary. Workspace wrappers use the
   * source id to clean the old portable archive after the new truth is safe. */
  moveConversation(sourceWorkspaceId: string, meta: ConversationMeta, timeline: TimelineItem[]): void;
  /** Permanently hide a conversation before removing its rows. The tombstone
   * prevents stale/offline portable records and delayed renderer saves from
   * bringing it back. */
  deleteConversation(conversationId: string): void;
  isConversationDeleted(conversationId: string): boolean;
  /** Replace the disposable conversation/message/usage index from portable
   * workspace records. Main-process startup uses this after scanning each
   * notebook's `.leemo/conversations` directory. */
  rebuildConversationIndex(conversations: PersistedConversation[]): void;
  /** Upsert a single wiki entry (by id). */
  saveWikiEntry(entry: WikiEntry): void;
  /** 轮 7 A3 —— replace the persisted settings.
   *
   *  Key/value rows rather than one JSON blob or a wide typed table: adding a
   *  setting must not require a migration, and a value written by a NEWER build
   *  must not make an older one fail to load (it just ignores keys it does not
   *  know). Values are JSON-encoded so booleans/numbers/arrays round-trip.
   *
   *  Whole-map replace, not per-key upsert: the renderer holds the authoritative
   *  state, so "what is in the store now" is the thing worth persisting. */
  saveSettings(settings: Record<string, unknown>): void;
  saveComposerDrafts(drafts: Record<string, unknown>): void;
  loadGlobalOverviewState(): PersistedGlobalOverviewState | null;
  saveGlobalOverviewState(state: PersistedGlobalOverviewState): void;
  recordStandaloneUsage(event: StandaloneUsageEvent): void;
  /** Aggregate persisted usage over local calendar-day windows. `now` is
   * injectable only so boundary behavior can be deterministic in tests. */
  usageSummary(query: UsageSummaryQuery, now?: number): UsageSummary;
  /** Load everything for renderer hydration. Conversations ordered newest-first. */
  loadAll(): PersistedSnapshot;
  /** Local scheduled-task metadata. Kept outside the conversation snapshot so
   * task history can be refreshed without rewriting chat timelines. */
  listScheduledTasks(): ScheduledTask[];
  getScheduledTask(id: string): ScheduledTask | undefined;
  saveScheduledTask(task: ScheduledTask): void;
  deleteScheduledTask(id: string): void;
  listScheduledTaskRuns(taskId?: string, limit?: number): ScheduledTaskRun[];
  getScheduledTaskRun(id: string): ScheduledTaskRun | undefined;
  saveScheduledTaskRun(run: ScheduledTaskRun): void;
  /** Atomically queue a due occurrence and advance the task. */
  queueScheduledOccurrence(task: ScheduledTask, run: ScheduledTaskRun): void;
  /** Conditional state changes prevent duplicate renderer execution. */
  claimScheduledTaskRun(id: string, startedAt: number): ScheduledTaskRun | undefined;
  completeScheduledTaskRun(run: ScheduledTaskRun): void;
  markStaleScheduledRunsMissed(now: number): void;
  getLearningProfile(): LearningProfile | undefined;
  saveLearningProfile(profile: LearningProfile): void;
  listLearningReviewItems(): LearningReviewItem[];
  getLearningReviewItem(id: string): LearningReviewItem | undefined;
  saveLearningReviewItem(item: LearningReviewItem): void;
  listLearningSessions(limit?: number): LearningSession[];
  listLearningAssessmentSessions(): LearningSession[];
  getLearningSessionStats(): { total: number; hasBaseline: boolean };
  saveLearningSession(session: LearningSession): void;
}

const SCHEMA = `
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
  unread INTEGER NOT NULL,
  workspace_id TEXT,
  session_id TEXT,
  session_provider_id TEXT,
  pinned INTEGER,
  archived INTEGER,
  last_opened_at INTEGER,
  goal_json TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  conversation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  item_json TEXT NOT NULL,
  PRIMARY KEY (conversation_id, seq)
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cost_usd TEXT,
  cost_source TEXT NOT NULL,
  tokens_estimated INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wiki_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  file_path TEXT NOT NULL,
  quoted_text TEXT NOT NULL,
  turns_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS composer_drafts (
  scope TEXT PRIMARY KEY,
  draft_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS global_overview_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS standalone_usage (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('global-overview')),
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cost_usd TEXT,
  cost_source TEXT NOT NULL CHECK (cost_source IN ('sdk', 'local-pricing', 'unpriced')),
  tokens_estimated INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approval_whitelist (
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('safe', 'moderate', 'dangerous')),
  PRIMARY KEY (tool_name, risk)
);
CREATE TABLE IF NOT EXISTS conversation_tombstones (
  id TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  timezone TEXT NOT NULL,
  next_run_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  workspace_id TEXT NOT NULL,
  conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_run_at INTEGER
);
CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'catch-up')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'missed', 'skipped')),
  conversation_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task ON scheduled_task_runs(task_id, created_at DESC);
CREATE TABLE IF NOT EXISTS learning_profiles (
  id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS learning_review_items (
  id TEXT PRIMARY KEY,
  item_json TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS learning_sessions (
  id TEXT PRIMARY KEY,
  session_json TEXT NOT NULL,
  skill TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_review_due ON learning_review_items(due_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_sessions_skill ON learning_sessions(skill, created_at DESC);
`;

interface ConversationRow {
  id: string;
  title: string;
  title_manually_updated: number;
  book_id: string | null;
  source: string;
  provider_id: string;
  model_id: string;
  created_at: number;
  last_activity_at: number;
  unread: number;
  workspace_id: string | null;
  /** Absent on rows written before the 卡 C migration ran. */
  session_id: string | null;
  session_provider_id: string | null;
  pinned: number | null;
  archived: number | null;
  last_opened_at: number | null;
  goal_json: string | null;
}

/**
 * Additive column migrations for databases that already exist (轮 2 卡 C).
 *
 * `SCHEMA` is all CREATE TABLE **IF NOT EXISTS**: on a database that has
 * already been used it is a complete no-op, so a new column in the DDL string
 * reaches new installs ONLY. Every machine that has already chatted would keep
 * a `conversations` table without the column, and the first write would die
 * with "table conversations has no column named session_id".
 *
 * So: read the live column list and ALTER what is genuinely missing. Adding a
 * nullable column with no default is an O(1) metadata-only operation in SQLite
 * and does not rewrite the table. Keep this list append-only and idempotent —
 * it runs on every single app launch.
 */
function migrate(db: SqliteDatabase): void {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!columns.has("session_id")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN session_id TEXT`);
  }
  if (!columns.has("session_provider_id")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN session_provider_id TEXT`);
  }
  if (!columns.has("workspace_id")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN workspace_id TEXT`);
  }
  if (!columns.has("pinned")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN pinned INTEGER`);
  }
  if (!columns.has("archived")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN archived INTEGER`);
  }
  if (!columns.has("last_opened_at")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_opened_at INTEGER`);
  }
  if (!columns.has("goal_json")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN goal_json TEXT`);
  }
  const wikiColumns = new Set(
    (db.prepare(`PRAGMA table_info(wiki_entries)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!wikiColumns.has("workspace_id")) {
    db.exec(`ALTER TABLE wiki_entries ADD COLUMN workspace_id TEXT`);
  }
  // Older builds could persist a blanket Bash or dangerous grant keyed only by
  // tool+risk. That scope is broader than the concrete command the user saw.
  // Remove those legacy rows once; the current broker remembers exact shell
  // commands only in memory for the active conversation.
  db.exec(`
    DELETE FROM approval_whitelist
    WHERE risk = 'dangerous'
       OR lower(tool_name) IN ('bash', 'shell', 'powershell', 'command')
  `);
}

/** Recover the physical owner of sessions written before session_provider_id
 * existed. Provider switches keep an SDK transcript in the directory that
 * created it, so the current conversation provider is not reliable evidence.
 * Resolve by filename only; transcript contents can contain large attachments
 * and must never be read during startup. Ambiguous or missing files stay
 * unknown and will take the renderer's bounded local-recovery path. */
function repairLegacySessionProviders(db: SqliteDatabase, dataDir: string): void {
  const rows = db.prepare(`
    SELECT id, session_id
    FROM conversations
    WHERE session_id IS NOT NULL AND session_provider_id IS NULL
  `).all() as Array<{ id: string; session_id: string }>;
  if (rows.length === 0) return;

  const targets = new Set(rows.map((row) => row.session_id));
  const owners = new Map<string, Set<string>>();
  const providersRoot = path.join(dataDir, "providers");
  let providerEntries: fs.Dirent[];
  try {
    providerEntries = fs.readdirSync(providersRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const providerEntry of providerEntries) {
    if (!providerEntry.isDirectory()) continue;
    const projectsRoot = path.join(providersRoot, providerEntry.name, "projects");
    const pending = [projectsRoot];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          pending.push(target);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".jsonl") continue;
        const sessionId = path.basename(entry.name, path.extname(entry.name));
        if (!targets.has(sessionId)) continue;
        const set = owners.get(sessionId) ?? new Set<string>();
        set.add(providerEntry.name);
        owners.set(sessionId, set);
      }
    }
  }

  const update = db.prepare(`
    UPDATE conversations
    SET session_provider_id = ?
    WHERE id = ? AND session_id = ? AND session_provider_id IS NULL
  `);
  db.transaction(() => {
    for (const row of rows) {
      const matches = owners.get(row.session_id);
      if (matches?.size !== 1) continue;
      update.run([...matches][0], row.id, row.session_id);
    }
  })();
}

interface MessageRow {
  conversation_id: string;
  seq: number;
  item_json: string;
}

interface WikiRow {
  id: string;
  workspace_id: string | null;
  file_path: string;
  quoted_text: string;
  turns_json: string;
  created_at: number;
}

/** 轮 7 A3 */
interface SettingRow {
  key: string;
  value_json: string;
}

interface ComposerDraftRow {
  scope: string;
  draft_json: string;
}

interface ScheduledTaskRow {
  id: string;
  name: string;
  prompt: string;
  schedule_json: string;
  timezone: string;
  next_run_at: number | null;
  status: ScheduledTask["status"];
  workspace_id: string;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
}

interface ScheduledTaskRunRow {
  id: string;
  task_id: string;
  scheduled_for: number;
  trigger: ScheduledTaskRun["trigger"];
  status: ScheduledTaskRun["status"];
  conversation_id: string | null;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  created_at: number;
}

interface UsageSummaryRow {
  provider_id: string;
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: string | null;
  created_at: number;
}

interface UsageAccumulator {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costMicros: bigint;
  hasCost: boolean;
}

const MICROS_PER_DOLLAR = 1_000_000n;

/** UsageRecord stores USD as decimal text. Convert to integer micro-dollars so
 * aggregation never routes billing values through binary floating point. */
function parseCostMicros(value: string | null): bigint | undefined {
  if (value === null) return undefined;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return undefined;
  return BigInt(match[1]) * MICROS_PER_DOLLAR + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function formatCostMicros(value: bigint): string {
  const whole = value / MICROS_PER_DOLLAR;
  const fraction = String(value % MICROS_PER_DOLLAR).padStart(6, "0");
  return `${whole}.${fraction}`;
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function decodeScheduledTask(row: ScheduledTaskRow): ScheduledTask | undefined {
  let schedule: ScheduledTask["schedule"];
  try {
    const parsed: unknown = JSON.parse(row.schedule_json);
    if (!isScheduledTaskSchedule(parsed)) return undefined;
    schedule = parsed;
  } catch {
    return undefined;
  }
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    schedule,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    status: row.status,
    workspaceId: row.workspace_id,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_run_at === null ? {} : { lastRunAt: row.last_run_at }),
  };
}

function decodeScheduledTaskRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    scheduledFor: row.scheduled_for,
    trigger: row.trigger,
    status: row.status,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.error === null ? {} : { error: row.error }),
    createdAt: row.created_at,
  };
}

export function createPersistence(
  db: SqliteDatabase,
  options: PersistenceOptions = {},
): Persistence & CapturePersistence {
  db.exec(SCHEMA);
  // Order matters: SCHEMA creates the tables on a fresh install, migrate() then
  // patches an install that already had them. Both run before any prepare(),
  // since prepared statements naming session_id would otherwise fail to compile.
  migrate(db);
  if (options.sessionDataDir) repairLegacySessionProviders(db, options.sessionDataDir);
  const capturePersistence = createCapturePersistence(db);

  const upsertConv = db.prepare(`
    INSERT INTO conversations
      (id, title, title_manually_updated, book_id, source, provider_id, model_id, created_at, last_activity_at, unread, workspace_id, session_id, session_provider_id, pinned, archived, last_opened_at, goal_json)
    VALUES (@id, @title, @title_manually_updated, @book_id, @source, @provider_id, @model_id, @created_at, @last_activity_at, @unread, @workspace_id, @session_id, @session_provider_id, @pinned, @archived, @last_opened_at, @goal_json)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      title_manually_updated=excluded.title_manually_updated,
      book_id=excluded.book_id,
      source=excluded.source,
      provider_id=excluded.provider_id,
      model_id=excluded.model_id,
      created_at=excluded.created_at,
      last_activity_at=excluded.last_activity_at,
      unread=excluded.unread,
      workspace_id=excluded.workspace_id,
      session_id=excluded.session_id,
      session_provider_id=excluded.session_provider_id,
      pinned=excluded.pinned,
      archived=excluded.archived,
      last_opened_at=excluded.last_opened_at,
      goal_json=excluded.goal_json
  `);
  const findTombstone = db.prepare(`SELECT id FROM conversation_tombstones WHERE id = ?`);
  const addTombstone = db.prepare(`
    INSERT INTO conversation_tombstones (id, deleted_at) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at
  `);
  const deleteConversationRow = db.prepare(`DELETE FROM conversations WHERE id = ?`);
  const delMessages = db.prepare(`DELETE FROM messages WHERE conversation_id = ?`);
  const insMessage = db.prepare(`INSERT INTO messages (conversation_id, seq, kind, item_json) VALUES (?, ?, ?, ?)`);
  const delUsage = db.prepare(`DELETE FROM usage WHERE conversation_id = ?`);
  const insUsage = db.prepare(`
    INSERT INTO usage
      (conversation_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, cost_source, tokens_estimated, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertGlobalOverviewState = db.prepare(`
    INSERT INTO global_overview_state (singleton, state_json, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      state_json=excluded.state_json,
      updated_at=excluded.updated_at
  `);
  const selectGlobalOverviewState = db.prepare(`
    SELECT state_json FROM global_overview_state WHERE singleton = 1
  `);
  const insertStandaloneUsage = db.prepare(`
    INSERT OR IGNORE INTO standalone_usage
      (id, purpose, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens,
       cache_creation_tokens, cost_usd, cost_source, tokens_estimated, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertWiki = db.prepare(`
    INSERT INTO wiki_entries (id, workspace_id, file_path, quoted_text, turns_json, created_at)
    VALUES (@id, @workspace_id, @file_path, @quoted_text, @turns_json, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      workspace_id=excluded.workspace_id,
      file_path=excluded.file_path,
      quoted_text=excluded.quoted_text,
      turns_json=excluded.turns_json,
      created_at=excluded.created_at
  `);
  const listWhitelist = db.prepare(`
    SELECT tool_name, risk FROM approval_whitelist ORDER BY tool_name ASC, risk ASC
  `);
  const addWhitelist = db.prepare(`
    INSERT OR IGNORE INTO approval_whitelist (tool_name, risk) VALUES (?, ?)
  `);
  const removeWhitelist = db.prepare(`
    DELETE FROM approval_whitelist WHERE tool_name = ? AND risk = ?
  `);
  const upsertScheduledTask = db.prepare(`
    INSERT INTO scheduled_tasks
      (id, name, prompt, schedule_json, timezone, next_run_at, status, workspace_id, conversation_id, created_at, updated_at, last_run_at)
    VALUES
      (@id, @name, @prompt, @schedule_json, @timezone, @next_run_at, @status, @workspace_id, @conversation_id, @created_at, @updated_at, @last_run_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      prompt=excluded.prompt,
      schedule_json=excluded.schedule_json,
      timezone=excluded.timezone,
      next_run_at=excluded.next_run_at,
      status=excluded.status,
      workspace_id=excluded.workspace_id,
      conversation_id=excluded.conversation_id,
      updated_at=excluded.updated_at,
      last_run_at=excluded.last_run_at
  `);
  const upsertScheduledRun = db.prepare(`
    INSERT INTO scheduled_task_runs
      (id, task_id, scheduled_for, trigger, status, conversation_id, started_at, completed_at, error, created_at)
    VALUES
      (@id, @task_id, @scheduled_for, @trigger, @status, @conversation_id, @started_at, @completed_at, @error, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      task_id=excluded.task_id,
      scheduled_for=excluded.scheduled_for,
      trigger=excluded.trigger,
      status=excluded.status,
      conversation_id=excluded.conversation_id,
      started_at=excluded.started_at,
      completed_at=excluded.completed_at,
      error=excluded.error
  `);
  const selectScheduledTask = db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`);
  const selectScheduledRun = db.prepare(`SELECT * FROM scheduled_task_runs WHERE id = ?`);

  const writeScheduledTask = (task: ScheduledTask): void => {
    upsertScheduledTask.run({
      id: task.id,
      name: task.name,
      prompt: task.prompt,
      schedule_json: JSON.stringify(task.schedule),
      timezone: task.timezone,
      next_run_at: task.nextRunAt,
      status: task.status,
      workspace_id: task.workspaceId,
      conversation_id: task.conversationId ?? null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      last_run_at: task.lastRunAt ?? null,
    });
  };

  const writeScheduledRun = (run: ScheduledTaskRun): void => {
    upsertScheduledRun.run({
      id: run.id,
      task_id: run.taskId,
      scheduled_for: run.scheduledFor,
      trigger: run.trigger,
      status: run.status,
      conversation_id: run.conversationId ?? null,
      started_at: run.startedAt ?? null,
      completed_at: run.completedAt ?? null,
      error: run.error ?? null,
      created_at: run.createdAt,
    });
  };

  const writeConversation = (meta: ConversationMeta, timeline: TimelineItem[]): void => {
      if (isConversationDeleted(meta.id)) return;
      upsertConv.run({
        id: meta.id,
        title: meta.title,
        title_manually_updated: meta.titleManuallyUpdated ? 1 : 0,
        book_id: meta.bookId,
        source: meta.source,
        provider_id: meta.providerId,
        model_id: meta.modelId,
        created_at: meta.createdAt,
        last_activity_at: meta.lastActivityAt,
        unread: meta.unread ? 1 : 0,
        workspace_id: meta.workspaceId ?? null,
        session_id: meta.sessionId ?? null,
        session_provider_id: meta.sessionProviderId ?? null,
        pinned: ((meta as ConversationMeta & { pinned?: boolean }).pinned ?? false) ? 1 : 0,
        archived: ((meta as ConversationMeta & { archived?: boolean }).archived ?? false) ? 1 : 0,
        last_opened_at: (meta as ConversationMeta & { lastOpenedAt?: number }).lastOpenedAt ?? meta.lastActivityAt,
        goal_json: meta.goal ? JSON.stringify(meta.goal) : null,
      });
      delMessages.run(meta.id);
      timeline.forEach((item, seq) => {
        insMessage.run(meta.id, seq, item.kind, JSON.stringify(item));
      });
      // Derived usage rows: one per usage TimelineItem (06 §六 usage 表). The
      // UsageRecord carries its own provider/model (a conversation can switch
      // model mid-thread), so the row uses the record's values, not meta's.
      delUsage.run(meta.id);
      for (const item of timeline) {
        if (item.kind === "usage") {
          const u = item.usage;
          const rows = u.modelBreakdown?.length
            ? u.modelBreakdown
            : [{
                providerId: u.providerId,
                modelId: u.modelId,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
                cacheReadTokens: u.cacheReadTokens,
                cacheCreationTokens: u.cacheCreationTokens,
                costUsd: u.costUsd,
              }];
          rows.forEach((row, index) => {
            insUsage.run(
              meta.id,
              row.providerId,
              row.modelId,
              row.inputTokens,
              row.outputTokens,
              row.cacheReadTokens,
              row.cacheCreationTokens,
              row.costUsd ?? null,
              u.costSource,
              u.tokensEstimated ? 1 : 0,
              index === 0 ? u.durationMs ?? null : null,
              meta.lastActivityAt,
            );
          });
        }
      }
  };

  const saveConversationTx = db.transaction(writeConversation);

  function saveConversation(meta: ConversationMeta, timeline: TimelineItem[]): void {
    saveConversationTx(meta, timeline);
  }

  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value_json) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
  `);
  const saveRelationshipChapterTx = db.transaction((meta: ConversationMeta, timeline: TimelineItem[]) => {
    writeConversation(meta, timeline);
    upsertSetting.run("relationshipConversationId", JSON.stringify(meta.id));
  });

  function saveRelationshipChapter(meta: ConversationMeta, timeline: TimelineItem[]): void {
    saveRelationshipChapterTx(meta, timeline);
  }

  function moveConversation(_sourceWorkspaceId: string, meta: ConversationMeta, timeline: TimelineItem[]): void {
    saveConversationTx(meta, timeline);
  }

  function isConversationDeleted(conversationId: string): boolean {
    return findTombstone.get(conversationId) !== undefined;
  }

  const deleteConversationTx = db.transaction((conversationId: string) => {
    addTombstone.run(conversationId, Date.now());
    delUsage.run(conversationId);
    delMessages.run(conversationId);
    deleteConversationRow.run(conversationId);
  });

  function deleteConversation(conversationId: string): void {
    deleteConversationTx(conversationId);
  }

  const rebuildConversationIndexTx = db.transaction((conversations: PersistedConversation[]) => {
    db.prepare(`DELETE FROM usage`).run();
    db.prepare(`DELETE FROM messages`).run();
    db.prepare(`DELETE FROM conversations`).run();
    for (const entry of conversations) {
      if (!isConversationDeleted(entry.meta.id)) writeConversation(entry.meta, entry.timeline);
    }
  });

  function rebuildConversationIndex(conversations: PersistedConversation[]): void {
    rebuildConversationIndexTx(conversations);
  }

  function saveWikiEntry(entry: WikiEntry): void {
    upsertWiki.run({
      id: entry.id,
      workspace_id: entry.workspaceId ?? null,
      file_path: entry.filePath,
      quoted_text: entry.quotedText,
      turns_json: JSON.stringify(entry.turns),
      created_at: entry.createdAt,
    });
  }

  function loadAll(): PersistedSnapshot {
    const convRows = db
      .prepare(`
        SELECT c.* FROM conversations c
        WHERE NOT EXISTS (SELECT 1 FROM conversation_tombstones t WHERE t.id = c.id)
        ORDER BY c.last_activity_at DESC
      `)
      .all() as ConversationRow[];
    const msgStmt = db.prepare(`SELECT conversation_id, seq, item_json FROM messages WHERE conversation_id = ? ORDER BY seq ASC`);

    const conversations: PersistedConversation[] = convRows.map((r) => {
      const msgs = msgStmt.all(r.id) as MessageRow[];
      const timeline = msgs.map((m) => JSON.parse(m.item_json) as TimelineItem);
      const meta: ConversationMeta = {
        id: r.id,
        title: r.title,
        titleManuallyUpdated: r.title_manually_updated === 1,
        bookId: r.book_id,
        source: r.source as ConversationMeta["source"],
        providerId: r.provider_id,
        modelId: r.model_id,
        createdAt: r.created_at,
        lastActivityAt: r.last_activity_at,
        unread: r.unread === 1,
        pinned: r.pinned === 1,
        archived: r.archived === 1,
        lastOpenedAt: r.last_opened_at ?? r.last_activity_at,
      } as ConversationMeta;
      // Only set the key when a session was actually stored: a legacy row (and
      // any conversation that never finished a round) must come back with no
      // sessionId rather than a null the re-claim path would have to special-case.
      if (r.session_id != null) meta.sessionId = r.session_id;
      if (r.session_provider_id != null) meta.sessionProviderId = r.session_provider_id;
      if (r.workspace_id != null) meta.workspaceId = r.workspace_id;
      if (r.goal_json != null) {
        try {
          const goal = JSON.parse(r.goal_json) as ConversationMeta["goal"];
          if (
            goal
            && typeof goal.text === "string"
            && (goal.status === "active" || goal.status === "paused")
            && typeof goal.createdAt === "number"
            && typeof goal.updatedAt === "number"
          ) {
            meta.goal = goal;
          }
        } catch {
          // One corrupt optional goal must not prevent conversation recovery.
        }
      }
      return { meta, timeline };
    });

    const wikiRows = db
      .prepare(`SELECT * FROM wiki_entries ORDER BY created_at ASC`)
      .all() as WikiRow[];
    const wikiEntries: WikiEntry[] = wikiRows.map((r) => ({
      id: r.id,
      ...(r.workspace_id ? { workspaceId: r.workspace_id } : {}),
      filePath: r.file_path,
      quotedText: r.quoted_text,
      turns: JSON.parse(r.turns_json) as WikiEntry["turns"],
      createdAt: r.created_at,
    }));

    // 轮 7 A3. A row whose JSON is corrupt is SKIPPED, not fatal: one bad value
    // must never cost the user their conversations — hydration is all-or-nothing
    // from the renderer's point of view, and a dropped key just falls back to
    // that setting's default.
    const settings: Record<string, unknown> = {};
    for (const r of db.prepare(`SELECT key, value_json FROM settings`).all() as SettingRow[]) {
      try {
        settings[r.key] = JSON.parse(r.value_json);
      } catch {
        /* skip unparseable value */
      }
    }

    const composerDrafts: Record<string, unknown> = {};
    for (const row of db.prepare(`SELECT scope, draft_json FROM composer_drafts ORDER BY updated_at ASC, scope ASC`).all() as ComposerDraftRow[]) {
      try {
        const draft: unknown = JSON.parse(row.draft_json);
        if (draft !== null && typeof draft === "object" && !Array.isArray(draft)) {
          composerDrafts[row.scope] = draft;
        }
      } catch {
        // 一个坏草稿只丢该 scope；对话、设置和其它未发送文本继续恢复。
      }
    }

    const globalPendingOverview = loadGlobalOverviewState();
    return {
      conversations,
      wikiEntries,
      settings,
      composerDrafts,
      ...(globalPendingOverview ? { globalPendingOverview } : {}),
    };
  }

  /** Replace the whole settings map in one transaction (see the interface note
   *  for why whole-map rather than per-key upsert). */
  function saveSettings(settings: Record<string, unknown>): void {
    const del = db.prepare(`DELETE FROM settings`);
    const ins = db.prepare(`INSERT INTO settings (key, value_json) VALUES (?, ?)`);
    db.transaction(() => {
      del.run();
      for (const [key, value] of Object.entries(settings)) {
        // `undefined` is not JSON — skip rather than write the string
        // "undefined", which would come back as a parse error on load.
        if (value === undefined) continue;
        ins.run(key, JSON.stringify(value));
      }
    })();
  }

  function saveComposerDrafts(drafts: Record<string, unknown>): void {
    const del = db.prepare(`DELETE FROM composer_drafts`);
    const ins = db.prepare(`INSERT INTO composer_drafts (scope, draft_json, updated_at) VALUES (?, ?, ?)`);
    const updatedAt = Date.now();
    db.transaction(() => {
      del.run();
      for (const [scope, draft] of Object.entries(drafts)) {
        if (!scope || scope.length > 1_024 || draft === undefined) continue;
        ins.run(scope, JSON.stringify(draft), updatedAt);
      }
    })();
  }

  function loadGlobalOverviewState(): PersistedGlobalOverviewState | null {
    const row = selectGlobalOverviewState.get() as { state_json?: unknown } | undefined;
    if (typeof row?.state_json !== "string") return null;
    try {
      return normalizePersistedGlobalOverviewState(JSON.parse(row.state_json));
    } catch {
      return null;
    }
  }

  function saveGlobalOverviewState(state: PersistedGlobalOverviewState): void {
    const normalized = normalizePersistedGlobalOverviewState(state);
    if (!normalized) throw new Error("待完成事项快照无效，原数据仍保留。");
    upsertGlobalOverviewState.run(JSON.stringify(normalized), Date.now());
  }

  function recordStandaloneUsage(event: StandaloneUsageEvent): void {
    const counts = [
      event.inputTokens,
      event.outputTokens,
      event.cacheReadTokens,
      event.cacheCreationTokens,
      event.durationMs,
      event.createdAt,
    ];
    if (
      !event.id.trim()
      || event.purpose !== "global-overview"
      || !event.providerId.trim()
      || !event.modelId.trim()
      || counts.some((value) => !Number.isFinite(value) || value < 0)
      || !["sdk", "local-pricing", "unpriced"].includes(event.costSource)
      || (event.costUsd !== undefined && !/^\d+(?:\.\d+)?$/.test(event.costUsd))
    ) {
      throw new Error("独立模型用量记录无效。");
    }
    insertStandaloneUsage.run(
      event.id,
      event.purpose,
      event.providerId,
      event.modelId,
      Math.floor(event.inputTokens),
      Math.floor(event.outputTokens),
      Math.floor(event.cacheReadTokens),
      Math.floor(event.cacheCreationTokens),
      event.costUsd ?? null,
      event.costSource,
      event.tokensEstimated ? 1 : 0,
      Math.floor(event.durationMs),
      Math.floor(event.createdAt),
    );
  }

  function listScheduledTasks(): ScheduledTask[] {
    return (db.prepare(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`).all() as ScheduledTaskRow[])
      .map(decodeScheduledTask)
      .filter((task): task is ScheduledTask => task !== undefined);
  }

  function getScheduledTask(id: string): ScheduledTask | undefined {
    const row = selectScheduledTask.get(id) as ScheduledTaskRow | undefined;
    return row ? decodeScheduledTask(row) : undefined;
  }

  function saveScheduledTask(task: ScheduledTask): void {
    writeScheduledTask(task);
  }

  const deleteScheduledTaskTx = db.transaction((id: string) => {
    db.prepare(`DELETE FROM scheduled_task_runs WHERE task_id = ?`).run(id);
    db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(id);
  });

  function deleteScheduledTask(id: string): void {
    deleteScheduledTaskTx(id);
  }

  function listScheduledTaskRuns(taskId?: string, limit = 100): ScheduledTaskRun[] {
    const bounded = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = taskId
      ? db.prepare(`SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`).all(taskId, bounded)
      : db.prepare(`SELECT * FROM scheduled_task_runs ORDER BY created_at DESC LIMIT ?`).all(bounded);
    return (rows as ScheduledTaskRunRow[]).map(decodeScheduledTaskRun);
  }

  function getScheduledTaskRun(id: string): ScheduledTaskRun | undefined {
    const row = selectScheduledRun.get(id) as ScheduledTaskRunRow | undefined;
    return row ? decodeScheduledTaskRun(row) : undefined;
  }

  function saveScheduledTaskRun(run: ScheduledTaskRun): void {
    writeScheduledRun(run);
  }

  const queueScheduledOccurrenceTx = db.transaction((task: ScheduledTask, run: ScheduledTaskRun) => {
    writeScheduledRun(run);
    writeScheduledTask(task);
  });

  function queueScheduledOccurrence(task: ScheduledTask, run: ScheduledTaskRun): void {
    queueScheduledOccurrenceTx(task, run);
  }

  function claimScheduledTaskRun(id: string, startedAt: number): ScheduledTaskRun | undefined {
    const result = db.prepare(`
      UPDATE scheduled_task_runs
      SET status = 'running', started_at = ?, completed_at = NULL, error = NULL
      WHERE id = ? AND status = 'queued'
    `).run(startedAt, id) as { changes?: number };
    if (result.changes !== 1) return undefined;
    const row = selectScheduledRun.get(id) as ScheduledTaskRunRow | undefined;
    return row ? decodeScheduledTaskRun(row) : undefined;
  }

  function completeScheduledTaskRun(run: ScheduledTaskRun): void {
    const existing = selectScheduledRun.get(run.id) as ScheduledTaskRunRow | undefined;
    if (!existing || (existing.status !== "queued" && existing.status !== "running")) return;
    writeScheduledRun(run);
  }

  function markStaleScheduledRunsMissed(now: number): void {
    db.prepare(`
      UPDATE scheduled_task_runs
      SET status = 'missed', completed_at = ?, error = COALESCE(error, 'Leemo 上次退出时任务还没有完成')
      WHERE status IN ('queued', 'running')
    `).run(now);
  }

  function getWhitelist(): WhitelistEntry[] {
    return (listWhitelist.all() as { tool_name: string; risk: WhitelistEntry["risk"] }[])
      .map((row) => ({ toolName: row.tool_name, risk: row.risk }))
      .filter((entry) => entry.risk !== "dangerous" && !/^(?:bash|shell|powershell|command)$/i.test(entry.toolName));
  }

  function addToWhitelist(entry: WhitelistEntry): void {
    if (entry.risk === "dangerous" || /^(?:bash|shell|powershell|command)$/i.test(entry.toolName)) return;
    addWhitelist.run(entry.toolName, entry.risk);
  }

  function removeFromWhitelist(entry: WhitelistEntry): void {
    removeWhitelist.run(entry.toolName, entry.risk);
  }

  function usageSummary(query: UsageSummaryQuery, now = Date.now()): UsageSummary {
    const current = new Date(now);
    const end = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + 1,
    ).getTime();
    const daysBack = query.range === "last30d" ? 29 : query.range === "last7d" ? 6 : 0;
    const start = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() - daysBack,
    ).getTime();
    const providerId = query.providerId ?? null;
    const rows = db.prepare(`
      SELECT provider_id, model_id, input_tokens, output_tokens,
             cache_read_tokens, cache_creation_tokens, cost_usd, created_at
      FROM (
        SELECT provider_id, model_id, input_tokens, output_tokens,
               cache_read_tokens, cache_creation_tokens, cost_usd, created_at
        FROM usage
        UNION ALL
        SELECT provider_id, model_id, input_tokens, output_tokens,
               cache_read_tokens, cache_creation_tokens, cost_usd, created_at
        FROM standalone_usage
      ) AS all_usage
      WHERE created_at >= ? AND created_at < ?
        AND (? IS NULL OR provider_id = ?)
      ORDER BY created_at ASC
    `).all(start, end, providerId, providerId) as UsageSummaryRow[];

    const providers = new Map<string, UsageAccumulator>();
    const models = new Map<string, { providerId: string; modelId: string; aggregate: UsageAccumulator }>();
    const days = new Map<string, { costMicros: bigint; hasCost: boolean }>();
    let totalCostMicros = 0n;
    let hasTotalCost = false;
    let totalCallCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;

    for (const row of rows) {
      const provider = providers.get(row.provider_id) ?? {
        callCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costMicros: 0n,
        hasCost: false,
      };
      provider.callCount += 1;
      provider.inputTokens += row.input_tokens;
      provider.outputTokens += row.output_tokens;
      provider.cacheReadTokens += row.cache_read_tokens;
      provider.cacheCreationTokens += row.cache_creation_tokens;

      const modelKey = `${row.provider_id}\u0000${row.model_id}`;
      const model = models.get(modelKey) ?? {
        providerId: row.provider_id,
        modelId: row.model_id,
        aggregate: {
          callCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costMicros: 0n,
          hasCost: false,
        },
      };
      model.aggregate.callCount += 1;
      model.aggregate.inputTokens += row.input_tokens;
      model.aggregate.outputTokens += row.output_tokens;
      model.aggregate.cacheReadTokens += row.cache_read_tokens;
      model.aggregate.cacheCreationTokens += row.cache_creation_tokens;

      totalCallCount += 1;
      totalInputTokens += row.input_tokens;
      totalOutputTokens += row.output_tokens;
      totalCacheReadTokens += row.cache_read_tokens;
      totalCacheCreationTokens += row.cache_creation_tokens;

      const costMicros = parseCostMicros(row.cost_usd);
      if (costMicros !== undefined) {
        provider.costMicros += costMicros;
        provider.hasCost = true;
        model.aggregate.costMicros += costMicros;
        model.aggregate.hasCost = true;
        totalCostMicros += costMicros;
        hasTotalCost = true;

        const date = localDateKey(row.created_at);
        const day = days.get(date) ?? { costMicros: 0n, hasCost: false };
        day.costMicros += costMicros;
        day.hasCost = true;
        days.set(date, day);
      } else if (query.range !== "today") {
        const date = localDateKey(row.created_at);
        if (!days.has(date)) days.set(date, { costMicros: 0n, hasCost: false });
      }
      providers.set(row.provider_id, provider);
      models.set(modelKey, model);
    }

    const byProvider = [...providers.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, aggregate]) => ({
        providerId: id,
        ...(aggregate.hasCost ? { costUsd: formatCostMicros(aggregate.costMicros) } : {}),
        callCount: aggregate.callCount,
        inputTokens: aggregate.inputTokens,
        outputTokens: aggregate.outputTokens,
        cacheReadTokens: aggregate.cacheReadTokens,
        cacheCreationTokens: aggregate.cacheCreationTokens,
      }));
    const byModel = [...models.values()]
      .sort((left, right) => left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId))
      .map(({ providerId: id, modelId, aggregate }) => ({
        providerId: id,
        modelId,
        ...(aggregate.hasCost ? { costUsd: formatCostMicros(aggregate.costMicros) } : {}),
        callCount: aggregate.callCount,
        inputTokens: aggregate.inputTokens,
        outputTokens: aggregate.outputTokens,
        cacheReadTokens: aggregate.cacheReadTokens,
        cacheCreationTokens: aggregate.cacheCreationTokens,
      }));
    const byDay = query.range !== "today"
      ? [...days.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([date, aggregate]) => ({
            date,
            ...(aggregate.hasCost ? { costUsd: formatCostMicros(aggregate.costMicros) } : {}),
          }))
      : undefined;

    return {
      ...(hasTotalCost ? { totalCostUsd: formatCostMicros(totalCostMicros) } : {}),
      callCount: totalCallCount,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      byProvider,
      byModel,
      byDay,
    };
  }

  function getLearningProfile(): LearningProfile | undefined {
    const row = db.prepare(`SELECT profile_json FROM learning_profiles WHERE id = 'english'`).get() as
      | { profile_json: string }
      | undefined;
    if (!row) return undefined;
    return parseLearningRecord(row.profile_json, "学习计划", isLearningProfile);
  }

  function saveLearningProfile(profile: LearningProfile): void {
    db.prepare(`
      INSERT INTO learning_profiles (id, profile_json, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        profile_json=excluded.profile_json,
        updated_at=excluded.updated_at
    `).run(profile.id, JSON.stringify(profile), profile.createdAt, profile.updatedAt);
  }

  function listLearningReviewItems(): LearningReviewItem[] {
    const rows = db.prepare(`
      SELECT item_json FROM learning_review_items ORDER BY due_at ASC, updated_at DESC
    `).all() as { item_json: string }[];
    return rows.map((row) => parseLearningRecord(row.item_json, "复习记录", isLearningReviewItem));
  }

  function getLearningReviewItem(id: string): LearningReviewItem | undefined {
    const row = db.prepare(`SELECT item_json FROM learning_review_items WHERE id = ?`).get(id) as
      | { item_json: string }
      | undefined;
    if (!row) return undefined;
    return parseLearningRecord(row.item_json, "复习记录", isLearningReviewItem);
  }

  function saveLearningReviewItem(item: LearningReviewItem): void {
    db.prepare(`
      INSERT INTO learning_review_items (id, item_json, due_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        item_json=excluded.item_json,
        due_at=excluded.due_at,
        updated_at=excluded.updated_at
    `).run(item.id, JSON.stringify(item), item.dueAt, item.updatedAt);
  }

  function listLearningSessions(limit = 100): LearningSession[] {
    const bounded = Math.min(500, Math.max(1, Math.floor(limit)));
    const rows = db.prepare(`
      SELECT session_json FROM learning_sessions ORDER BY created_at DESC LIMIT ?
    `).all(bounded) as { session_json: string }[];
    return rows.map((row) => parseLearningRecord(row.session_json, "练习记录", isLearningSession));
  }

  function listLearningAssessmentSessions(): LearningSession[] {
    const rows = db.prepare(`
      SELECT session_json FROM learning_sessions
      WHERE kind IN ('baseline', 'check')
      ORDER BY created_at DESC
    `).all() as { session_json: string }[];
    return rows.map((row) => parseLearningRecord(row.session_json, "练习记录", isLearningSession));
  }

  function getLearningSessionStats(): { total: number; hasBaseline: boolean } {
    const rows = db.prepare(`
      SELECT session_json FROM learning_sessions ORDER BY created_at DESC
    `).all() as { session_json: string }[];
    const sessions = rows.map((row) => parseLearningRecord(row.session_json, "练习记录", isLearningSession));
    return {
      total: sessions.length,
      hasBaseline: sessions.some((session) => session.kind === "baseline"),
    };
  }

  function saveLearningSession(session: LearningSession): void {
    db.prepare(`
      INSERT INTO learning_sessions (id, session_json, skill, kind, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_json=excluded.session_json,
        skill=excluded.skill,
        kind=excluded.kind,
        created_at=excluded.created_at
    `).run(session.id, JSON.stringify(session), session.skill, session.kind, session.createdAt);
  }

  return {
    ...capturePersistence,
    saveConversation,
    saveRelationshipChapter,
    moveConversation,
    deleteConversation,
    isConversationDeleted,
    rebuildConversationIndex,
    saveWikiEntry,
    saveSettings,
    saveComposerDrafts,
    loadGlobalOverviewState,
    saveGlobalOverviewState,
    recordStandaloneUsage,
    loadAll,
    getWhitelist,
    addToWhitelist,
    removeFromWhitelist,
    usageSummary,
    listScheduledTasks,
    getScheduledTask,
    saveScheduledTask,
    deleteScheduledTask,
    listScheduledTaskRuns,
    getScheduledTaskRun,
    saveScheduledTaskRun,
    queueScheduledOccurrence,
    claimScheduledTaskRun,
    completeScheduledTaskRun,
    markStaleScheduledRunsMissed,
    getLearningProfile,
    saveLearningProfile,
    listLearningReviewItems,
    getLearningReviewItem,
    saveLearningReviewItem,
    listLearningSessions,
    listLearningAssessmentSessions,
    getLearningSessionStats,
    saveLearningSession,
  };
}
