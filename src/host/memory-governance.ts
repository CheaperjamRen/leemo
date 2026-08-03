import path from "node:path";
import { randomUUID } from "node:crypto";
import { encode, decode } from "gpt-tokenizer/encoding/o200k_base";
import { DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR } from "./workspace";

export type MemoryKind = "profile" | "preference" | "state" | "goal" | "episode" | "notebook";
export type MemoryStatus = "current" | "uncertain" | "superseded" | "deleted";
export type MemoryScope =
  | { type: "global" }
  | { type: "notebook"; notebookId: string }
  | { type: "workspace"; workspaceId: string };
export type MemorySourceType = "explicit-user" | "native-auto" | "legacy-import" | "settings-edit";

export interface MemoryScopePaths {
  directory: string;
  ledger: string;
  currentView: string;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  topic: string;
  statement: string;
  learnedAt: number;
  validFrom?: number;
  validTo?: number;
  lastConfirmedAt?: number;
  sourceType: MemorySourceType;
  sourceConversationId?: string;
  sourceMessageId?: string;
  status: MemoryStatus;
  supersedes?: string;
  pinned: boolean;
}

export interface RememberMemoryInput {
  scope: MemoryScope;
  kind: MemoryKind;
  topic: string;
  statement: string;
  sourceType: MemorySourceType;
  sourceConversationId?: string;
  sourceMessageId?: string;
  validFrom?: number;
}

export interface MemoryChangeResult {
  changeId: string;
  action: "remembered" | "candidate" | "confirmed" | "updated" | "removed" | "pinned" | "unpinned";
  label: string;
  record: MemoryRecord;
}

export interface UpdateMemoryInput {
  scope: MemoryScope;
  id: string;
  topic?: string;
  statement?: string;
  kind?: MemoryKind;
  validFrom?: number;
  sourceConversationId?: string;
  sourceMessageId?: string;
}

export interface MemoryUndoResult {
  ok: boolean;
  conflict?: boolean;
  changeId?: string;
  targetChangeId: string;
  action?: "undone";
  records?: MemoryRecord[];
}

export interface NativeMemoryBaseline {
  scope: MemoryScope;
  currentView: string;
  /** Private, round-scoped SDK cache. Omitted by compatibility callers that
   * still exercise direct-view reconciliation in unit tests. */
  nativeDirectory?: string;
}

export interface NativeMemorySource {
  conversationId?: string;
  messageId?: string;
}

export interface NativeMemoryReconcileResult {
  changes: MemoryChangeResult[];
  diagnostics: string[];
}

export interface LegacyMemoryMigrationReport {
  version: 1;
  alreadyCompleted: boolean;
  completed: boolean;
  imported: number;
  importedFiles: string[];
  archived: Array<{ from: string; to: string }>;
  movedArtifacts: Array<{ from: string; to: string }>;
  conflicts: string[];
  errors: string[];
  manifest: string;
}

export interface MemoryListResult {
  records: MemoryRecord[];
  diagnostics: string[];
}

export interface MemoryRecallInput {
  scope: MemoryScope;
  query?: string;
  atTime?: number;
  includeHistory?: boolean;
}

export interface MemoryRecallResult extends MemoryListResult {
  text: string;
}

interface MemoryLedgerEvent {
  version: 1;
  changeId: string;
  at: number;
  action: "remember" | "candidate" | "confirm" | "update" | "remove" | "pin" | "undo";
  before: MemoryRecord[];
  after: MemoryRecord[];
}

export interface MemoryIO {
  exists(target: string): boolean;
  mkdirp(dir: string): void;
  readFile(file: string): string;
  writeFile(file: string, contents: string): void;
  appendFile(file: string, contents: string): void;
  readdir(dir: string): string[];
  rename(from: string, to: string): void;
  /** Optional private native-memory cache operations. Governance storage itself
   * still needs only the seven methods above. */
  walkFiles?(dir: string): string[];
  remove?(target: string): void;
}

export interface MemoryGovernanceOptions {
  workspaceRoot: string;
  /** Resolves an opaque, main-owned id to an approved external project root. */
  resolveWorkspaceRoot?: (workspaceId: string) => string | undefined;
  io: MemoryIO;
  now?: () => number;
  idFactory?: () => string;
}

export interface MemoryGovernance {
  ensureScope(scope: MemoryScope): MemoryScopePaths;
  remember(input: RememberMemoryInput): MemoryChangeResult;
  list(scope: MemoryScope, options?: { includeInactive?: boolean }): MemoryListResult;
  history(scope: MemoryScope, memoryId: string): MemoryListResult;
  recall(input: MemoryRecallInput): MemoryRecallResult;
  update(input: UpdateMemoryInput): MemoryChangeResult;
  remove(scope: MemoryScope, id: string): MemoryChangeResult;
  pin(scope: MemoryScope, id: string, pinned: boolean): MemoryChangeResult;
  undo(scope: MemoryScope, changeId: string): MemoryUndoResult;
  rebuildViews(scopes: readonly MemoryScope[]): { rebuilt: number; diagnostics: string[] };
  prepareNative(scope: MemoryScope, nativeDirectory?: string): NativeMemoryBaseline;
  reconcileNative(
    baseline: NativeMemoryBaseline,
    source?: NativeMemorySource,
  ): NativeMemoryReconcileResult;
  migrateLegacyLayout(notebookIds: readonly string[]): LegacyMemoryMigrationReport;
}

const CURRENT_VIEW_SEED = "# momo memory\n";
const GLOBAL_CURRENT_TOKEN_LIMIT = 600;
const NOTEBOOK_CURRENT_TOKEN_LIMIT = 400;
const HISTORY_RECALL_TOKEN_LIMIT = 600;
const RESERVED_SCOPE_IDS = new Set([DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR, "memory", ".claude", ".leemo"]);
const KIND_PRIORITY: Record<MemoryKind, number> = {
  profile: 6,
  preference: 5,
  goal: 4,
  state: 3,
  notebook: 2,
  episode: 1,
};
const SENSITIVE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i,
  /\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|passwd|secret)\s*(?:=|:|：|是|为)\s*\S{4,}/i,
  /\b(?:sk|rk|pk|ak)[-_][A-Za-z0-9_-]{16,}\b/i,
  /验证码\s*(?:是|为|[:：=])?\s*\d{4,8}\b/,
];
const SPECULATIVE_PATTERN = /(?:可能|也许|似乎|猜测|大概|或许|probably|maybe|perhaps)/i;
const MEMORY_KINDS = new Set<MemoryKind>(["profile", "preference", "state", "goal", "episode", "notebook"]);
const MEMORY_STATUSES = new Set<MemoryStatus>(["current", "uncertain", "superseded", "deleted"]);
const MEMORY_SOURCE_TYPES = new Set<MemorySourceType>([
  "explicit-user",
  "native-auto",
  "legacy-import",
  "settings-edit",
]);

function validNotebookId(notebookId: string): boolean {
  return (
    notebookId.length > 0
    && notebookId.trim() === notebookId
    && notebookId !== "."
    && notebookId !== ".."
    && !notebookId.includes("/")
    && !notebookId.includes("\\")
    && !/^[A-Za-z]:/.test(notebookId)
    && !/[<>:"|?*]/.test(notebookId)
    && !/[\u0000-\u001f]/.test(notebookId)
    && notebookId.length <= 80
    && !RESERVED_SCOPE_IDS.has(notebookId)
  );
}

function validWorkspaceId(workspaceId: string): boolean {
  return workspaceId.length > 0
    && workspaceId.length <= 128
    && workspaceId.trim() === workspaceId
    && /^[A-Za-z0-9_-]+$/.test(workspaceId);
}

function pathsFor(
  workspaceRoot: string,
  scope: MemoryScope,
  resolveWorkspaceRoot?: (workspaceId: string) => string | undefined,
): MemoryScopePaths {
  let directory: string;
  if (scope.type === "global") {
    directory = path.join(workspaceRoot, ".leemo", "memory", "global");
  } else if (scope.type === "notebook") {
    if (!validNotebookId(scope.notebookId)) {
      throw new Error(`本子记忆 scope 不合法：${scope.notebookId}`);
    }
    directory = path.join(workspaceRoot, scope.notebookId, ".leemo", "memory");
  } else {
    if (!validWorkspaceId(scope.workspaceId)) {
      throw new Error("外部本子记忆标识不合法");
    }
    const externalRoot = resolveWorkspaceRoot?.(scope.workspaceId);
    if (!externalRoot || !path.isAbsolute(externalRoot)) {
      throw new Error("找不到这个项目，无法管理它的记忆");
    }
    directory = path.join(path.resolve(externalRoot), ".leemo", "memory");
  }
  return {
    directory,
    ledger: path.join(directory, "ledger.jsonl"),
    currentView: path.join(directory, "MEMORY.md"),
  };
}

function compareMemoryPriority(a: MemoryRecord, b: MemoryRecord): number {
  return Number(b.pinned) - Number(a.pinned)
    || KIND_PRIORITY[b.kind] - KIND_PRIORITY[a.kind]
    || (b.lastConfirmedAt ?? 0) - (a.lastConfirmedAt ?? 0)
    || b.learnedAt - a.learnedAt
    || a.id.localeCompare(b.id);
}

function truncateTokens(text: string, limit: number): string {
  const tokens = encode(text);
  if (tokens.length <= limit) return text;
  return decode(tokens.slice(0, limit));
}

function fitRecords(
  records: MemoryRecord[],
  tokenLimit: number,
  prefix = "",
): { records: MemoryRecord[]; text: string } {
  const included: MemoryRecord[] = [];
  let text = prefix;
  for (const record of records) {
    const line = `- ${record.statement}\n`;
    if (encode(`${text}${line}`).length > tokenLimit) continue;
    text += line;
    included.push(record);
  }
  if (included.length === 0 && records.length > 0) {
    const bounded = truncateTokens(`${prefix}- ${records[0].statement}\n`, tokenLimit);
    if (bounded.length > prefix.length) {
      text = bounded;
      included.push(records[0]);
    }
  }
  return { records: included, text };
}

function renderCurrentView(records: MemoryRecord[], scope: MemoryScope): string {
  const limit = scope.type === "global" ? GLOBAL_CURRENT_TOKEN_LIMIT : NOTEBOOK_CURRENT_TOKEN_LIMIT;
  const current = records
    .filter((record) => record.status === "current" && !isSensitive(record.statement))
    .sort(compareMemoryPriority);
  const text = fitRecords(current, limit, `${CURRENT_VIEW_SEED}\n`).text.trimEnd();
  const withNewline = `${text}\n`;
  return encode(withNewline).length <= limit ? withNewline : text;
}

function isMemoryScope(value: unknown): value is MemoryScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as Partial<MemoryScope>;
  return scope.type === "global"
    || (scope.type === "notebook" && typeof scope.notebookId === "string" && validNotebookId(scope.notebookId))
    || (scope.type === "workspace" && typeof scope.workspaceId === "string" && validWorkspaceId(scope.workspaceId));
}

function finiteOptional(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function stringOptional(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MemoryRecord>;
  return typeof record.id === "string"
    && record.id.length > 0
    && isMemoryScope(record.scope)
    && typeof record.kind === "string"
    && MEMORY_KINDS.has(record.kind as MemoryKind)
    && typeof record.topic === "string"
    && record.topic.length > 0
    && typeof record.statement === "string"
    && record.statement.length > 0
    && typeof record.learnedAt === "number"
    && Number.isFinite(record.learnedAt)
    && finiteOptional(record.validFrom)
    && finiteOptional(record.validTo)
    && finiteOptional(record.lastConfirmedAt)
    && typeof record.sourceType === "string"
    && MEMORY_SOURCE_TYPES.has(record.sourceType as MemorySourceType)
    && stringOptional(record.sourceConversationId)
    && stringOptional(record.sourceMessageId)
    && typeof record.status === "string"
    && MEMORY_STATUSES.has(record.status as MemoryStatus)
    && stringOptional(record.supersedes)
    && typeof record.pinned === "boolean";
}

function isLedgerEvent(value: unknown): value is MemoryLedgerEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MemoryLedgerEvent>;
  return candidate.version === 1
    && ["remember", "candidate", "confirm", "update", "remove", "pin", "undo"].includes(candidate.action ?? "")
    && typeof candidate.changeId === "string"
    && typeof candidate.at === "number"
    && Number.isFinite(candidate.at)
    && Array.isArray(candidate.before)
    && candidate.before.every(isMemoryRecord)
    && Array.isArray(candidate.after)
    && candidate.after.every(isMemoryRecord);
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchesQuery(record: MemoryRecord, query: string): boolean {
  if (!query) return true;
  const needle = normalized(query);
  const topic = normalized(record.topic);
  const statement = normalized(record.statement);
  if (topic.includes(needle) || statement.includes(needle)) return true;

  const haystack = `${topic}${statement}`.replace(/\s+/gu, "");
  const compactNeedle = needle.replace(/\s+/gu, "");
  if (compactNeedle && haystack.includes(compactNeedle)) return true;

  const terms = needle
    .split(/[\s,，。.！!?？;；:：、\/|\\]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length > 1 && terms.every((term) => haystack.includes(term));
}

function effectiveFrom(record: MemoryRecord): number {
  return record.validFrom ?? record.learnedAt;
}

function isSensitive(value: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

interface NativeCandidate {
  topic: string;
  statement: string;
  kind: MemoryKind;
}

interface LegacyCandidate {
  topic: string;
  statement: string;
  kind: MemoryKind;
  validFrom?: number;
}

function nativeKind(scope: MemoryScope, heading: string): MemoryKind {
  if (scope.type === "notebook") return "notebook";
  if (/(?:画像|身份|profile|about)/i.test(heading)) return "profile";
  if (/(?:偏好|习惯|preference|habit)/i.test(heading)) return "preference";
  if (/(?:目标|计划|goal|plan)/i.test(heading)) return "goal";
  if (/(?:经历|事件|episode|event)/i.test(heading)) return "episode";
  return "state";
}

function stripNativeFrontmatter(markdown: string): { body: string; name?: string } {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { body: markdown };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return { body: markdown };
  let name: string | undefined;
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^name\s*:\s*(.+)$/i);
    if (match) name = match[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return { body: lines.slice(end + 1).join("\n"), ...(name ? { name } : {}) };
}

function isNativeIndexReference(line: string): boolean {
  const value = line.replace(/^[-*+]\s+/, "").trim();
  return /^\[[^\]]+\]\([^)]+\.md(?:#[^)]+)?\)$/i.test(value)
    || /^[^。！？.!?]*\.md(?:\s*[-—:：].*)?$/i.test(value);
}

function parseNativeCandidates(
  markdown: string,
  scope: MemoryScope,
  sourceName?: string,
): NativeCandidate[] {
  const candidates: NativeCandidate[] = [];
  const document = stripNativeFrontmatter(markdown);
  let heading = document.name ?? sourceName ?? "自动记忆";
  for (const rawLine of document.body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }
    if (isNativeIndexReference(line)) continue;
    const content = line
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!content || /^momo memory$/i.test(content)) continue;
    const labeled = content.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
    const topic = labeled
      ? `${heading} / ${labeled[1].trim()}`
      : content.slice(0, 80);
    candidates.push({
      topic,
      statement: content,
      kind: nativeKind(scope, heading),
    });
  }
  return candidates;
}

const LEGACY_TEMPLATE_LINES = new Set([
  "（还没有记录）",
  "(还没有记录)",
  "你是谁、在做什么。",
  "喜欢怎样、别踩哪里。",
  "第一人称叙述，不是冷日志。",
]);

function legacyKind(
  scope: MemoryScope,
  fileName: string,
  heading: string,
): MemoryKind {
  if (scope.type === "notebook") return "notebook";
  if (fileName === "profile.md" || /(?:核心事实|画像|身份)/.test(heading)) return "profile";
  if (fileName === "preferences.md" || /(?:偏好|雷区|习惯)/.test(heading)) return "preference";
  if (fileName === "moments.md" || /(?:时刻|经历|事件)/.test(heading)) return "episode";
  if (/(?:目标|计划)/.test(heading)) return "goal";
  return "state";
}

function parseLegacyCandidates(
  contents: string,
  scope: MemoryScope,
  sourceKey: string,
): LegacyCandidate[] {
  const candidates: LegacyCandidate[] = [];
  const fileName = path.basename(sourceKey).toLocaleLowerCase();
  let heading = path.basename(sourceKey);
  let ordinal = 0;
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }
    const statement = line
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    if (!statement
      || LEGACY_TEMPLATE_LINES.has(statement)
      || /^格式[:：]/.test(statement)
      || heading === "记忆索引"
      || /^memory[/\\](?:bookmarks|profile|preferences|moments)\.md\b/i.test(statement)) {
      continue;
    }
    ordinal += 1;
    const timestamp = statement.match(/^<([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T][0-9]{2}:[0-9]{2})?)[^>]*>/);
    const parsedTime = timestamp ? Date.parse(timestamp[1].replace(" ", "T")) : Number.NaN;
    candidates.push({
      topic: `legacy:${sourceKey}:${heading}:${ordinal}`,
      statement,
      kind: legacyKind(scope, fileName, heading),
      ...(Number.isFinite(parsedTime) ? { validFrom: parsedTime } : {}),
    });
  }
  return candidates;
}

function uniqueMigrationTarget(target: string, io: MemoryIO): string {
  if (!io.exists(target)) return target;
  const ext = path.extname(target);
  const stem = ext ? target.slice(0, -ext.length) : target;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem} (${suffix})${ext}`;
    if (!io.exists(candidate)) return candidate;
  }
  throw new Error("迁移目标重名过多");
}

export function createMemoryGovernance(options: MemoryGovernanceOptions): MemoryGovernance {
  const { workspaceRoot, io, resolveWorkspaceRoot } = options;
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? randomUUID;

  const ensureScope = (scope: MemoryScope): MemoryScopePaths => {
    const paths = pathsFor(workspaceRoot, scope, resolveWorkspaceRoot);
    io.mkdirp(paths.directory);
    if (!io.exists(paths.ledger)) io.writeFile(paths.ledger, "");
    if (!io.exists(paths.currentView)) io.writeFile(paths.currentView, CURRENT_VIEW_SEED);
    return paths;
  };

  const readState = (scope: MemoryScope): MemoryListResult & { events: MemoryLedgerEvent[] } => {
    const paths = pathsFor(workspaceRoot, scope, resolveWorkspaceRoot);
    const records = new Map<string, MemoryRecord>();
    const events: MemoryLedgerEvent[] = [];
    const diagnostics: string[] = [];
    // Listing and recall are read-only product actions. An unused scope should
    // stay absent until the first real write (or the user explicitly opens it).
    if (!io.exists(paths.ledger)) return { records: [], diagnostics, events };
    const lines = io.readFile(paths.ledger).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isLedgerEvent(parsed)) {
          diagnostics.push(`账本第 ${index + 1} 行格式不受支持`);
          continue;
        }
        events.push(parsed);
        for (const record of parsed.after) records.set(record.id, record);
      } catch {
        diagnostics.push(`账本第 ${index + 1} 行无法解析`);
      }
    }
    return { records: [...records.values()], diagnostics, events };
  };

  const appendAndRebuild = (scope: MemoryScope, event: MemoryLedgerEvent): void => {
    const paths = ensureScope(scope);
    io.appendFile(paths.ledger, `${JSON.stringify(event)}\n`);
    io.writeFile(paths.currentView, renderCurrentView(readState(scope).records, scope));
  };

  const currentRecord = (scope: MemoryScope, id: string): MemoryRecord => {
    const record = readState(scope).records.find((candidate) => candidate.id === id);
    if (!record || record.status !== "current") throw new Error("找不到当前有效的记忆");
    return record;
  };

  return {
    ensureScope,

    remember(input) {
      const topic = input.topic.trim();
      const statement = input.statement.trim();
      if (!topic || !statement) throw new Error("记忆主题和内容不能为空");
      if (isSensitive(`${topic}\n${statement}`)) throw new Error("敏感凭据不能写入长期记忆");

      const timestamp = now();
      ensureScope(input.scope);
      const state = readState(input.scope);
      const speculative = input.sourceType === "native-auto" && SPECULATIVE_PATTERN.test(statement);
      const existing = speculative ? undefined : state.records.find((record) => (
        record.status === "current"
        && normalized(record.topic) === normalized(topic)
      ));

      if (existing && existing.statement === statement) {
        const confirmed: MemoryRecord = {
          ...existing,
          ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
          lastConfirmedAt: timestamp,
          sourceType: input.sourceType,
          ...(input.sourceConversationId
            ? { sourceConversationId: input.sourceConversationId }
            : { sourceConversationId: existing.sourceConversationId }),
          ...(input.sourceMessageId
            ? { sourceMessageId: input.sourceMessageId }
            : { sourceMessageId: existing.sourceMessageId }),
        };
        const event: MemoryLedgerEvent = {
          version: 1,
          changeId: idFactory(),
          at: timestamp,
          action: "confirm",
          before: [existing],
          after: [confirmed],
        };
        appendAndRebuild(input.scope, event);
        return {
          changeId: event.changeId,
          action: "confirmed",
          label: statement,
          record: confirmed,
        };
      }

      const superseded = existing
        ? {
            ...existing,
            status: "superseded" as const,
            validTo: input.validFrom ?? timestamp,
          }
        : undefined;
      const record: MemoryRecord = {
        id: idFactory(),
        scope: input.scope,
        kind: input.kind,
        topic,
        statement,
        learnedAt: timestamp,
        ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
        ...(input.sourceType === "explicit-user" ? { lastConfirmedAt: timestamp } : {}),
        sourceType: input.sourceType,
        ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        status: speculative ? "uncertain" : "current",
        ...(existing ? { supersedes: existing.id } : {}),
        pinned: false,
      };
      const event: MemoryLedgerEvent = {
        version: 1,
        changeId: idFactory(),
        at: timestamp,
        action: speculative ? "candidate" : existing ? "update" : "remember",
        before: existing ? [existing] : [],
        after: superseded ? [superseded, record] : [record],
      };
      appendAndRebuild(input.scope, event);
      return {
        changeId: event.changeId,
        action: speculative ? "candidate" : existing ? "updated" : "remembered",
        label: statement,
        record,
      };
    },

    list(scope, listOptions = {}) {
      const state = readState(scope);
      return {
        records: state.records
          .filter((record) => listOptions.includeInactive || record.status === "current")
          .sort((a, b) => a.learnedAt - b.learnedAt || a.id.localeCompare(b.id)),
        diagnostics: state.diagnostics,
      };
    },

    history(scope, memoryId) {
      const state = readState(scope);
      const target = state.records.find((record) => record.id === memoryId);
      if (!target) return { records: [], diagnostics: state.diagnostics };
      return {
        records: state.records
          .filter((record) => normalized(record.topic) === normalized(target.topic))
          .sort((a, b) => b.learnedAt - a.learnedAt || b.id.localeCompare(a.id)),
        diagnostics: state.diagnostics,
      };
    },

    recall(input) {
      const state = readState(input.scope);
      const query = input.query?.trim() ?? "";
      let records = state.records.filter((record) => matchesQuery(record, query));
      if (input.atTime !== undefined) {
        records = records.filter((record) => (
          (record.status === "current" || record.status === "superseded")
          && effectiveFrom(record) <= input.atTime!
          && (record.validTo === undefined || input.atTime! < record.validTo)
        ));
      } else if (!input.includeHistory) {
        records = records.filter((record) => record.status === "current");
      } else {
        records = records.filter((record) => record.status !== "deleted");
      }
      records.sort((a, b) => b.learnedAt - a.learnedAt || b.id.localeCompare(a.id));
      const bounded = fitRecords(records, HISTORY_RECALL_TOKEN_LIMIT);
      return {
        records: bounded.records,
        text: bounded.text.trimEnd(),
        diagnostics: state.diagnostics,
      };
    },

    update(input) {
      const existing = currentRecord(input.scope, input.id);
      const topic = (input.topic ?? existing.topic).trim();
      const statement = (input.statement ?? existing.statement).trim();
      if (!topic || !statement) throw new Error("记忆主题和内容不能为空");
      if (isSensitive(`${topic}\n${statement}`)) throw new Error("敏感凭据不能写入长期记忆");
      const timestamp = now();
      const superseded: MemoryRecord = {
        ...existing,
        status: "superseded",
        validTo: input.validFrom ?? timestamp,
      };
      const record: MemoryRecord = {
        id: idFactory(),
        scope: input.scope,
        kind: input.kind ?? existing.kind,
        topic,
        statement,
        learnedAt: timestamp,
        ...(input.validFrom === undefined ? {} : { validFrom: input.validFrom }),
        lastConfirmedAt: timestamp,
        sourceType: "settings-edit",
        ...(input.sourceConversationId ? { sourceConversationId: input.sourceConversationId } : {}),
        ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
        status: "current",
        supersedes: existing.id,
        pinned: existing.pinned,
      };
      const event: MemoryLedgerEvent = {
        version: 1,
        changeId: idFactory(),
        at: timestamp,
        action: "update",
        before: [existing],
        after: [superseded, record],
      };
      appendAndRebuild(input.scope, event);
      return { changeId: event.changeId, action: "updated", label: statement, record };
    },

    remove(scope, id) {
      const existing = currentRecord(scope, id);
      const timestamp = now();
      const record: MemoryRecord = {
        ...existing,
        status: "deleted",
        validTo: timestamp,
      };
      const event: MemoryLedgerEvent = {
        version: 1,
        changeId: idFactory(),
        at: timestamp,
        action: "remove",
        before: [existing],
        after: [record],
      };
      appendAndRebuild(scope, event);
      return { changeId: event.changeId, action: "removed", label: existing.statement, record };
    },

    pin(scope, id, pinned) {
      const existing = currentRecord(scope, id);
      const timestamp = now();
      const record: MemoryRecord = { ...existing, pinned };
      const event: MemoryLedgerEvent = {
        version: 1,
        changeId: idFactory(),
        at: timestamp,
        action: "pin",
        before: [existing],
        after: [record],
      };
      appendAndRebuild(scope, event);
      return {
        changeId: event.changeId,
        action: pinned ? "pinned" : "unpinned",
        label: existing.statement,
        record,
      };
    },

    undo(scope, targetChangeId) {
      const state = readState(scope);
      const target = state.events.find((event) => event.changeId === targetChangeId);
      if (!target) return { ok: false, targetChangeId };
      const latest = new Map(state.records.map((record) => [record.id, record]));
      const isStillLatest = target.after.every((record) => (
        JSON.stringify(latest.get(record.id)) === JSON.stringify(record)
      ));
      if (!isStillLatest) return { ok: false, conflict: true, targetChangeId };

      const timestamp = now();
      const beforeById = new Map(target.before.map((record) => [record.id, record]));
      const inverse = [...target.before];
      for (const record of target.after) {
        if (beforeById.has(record.id)) continue;
        inverse.push({ ...record, status: "deleted", validTo: timestamp });
      }
      const event: MemoryLedgerEvent = {
        version: 1,
        changeId: idFactory(),
        at: timestamp,
        action: "undo",
        before: target.after,
        after: inverse,
      };
      appendAndRebuild(scope, event);
      return {
        ok: true,
        changeId: event.changeId,
        targetChangeId,
        action: "undone",
        records: inverse,
      };
    },

    rebuildViews(scopes) {
      const diagnostics: string[] = [];
      for (const scope of scopes) {
        const state = readState(scope);
        diagnostics.push(...state.diagnostics);
        const paths = ensureScope(scope);
        io.writeFile(paths.currentView, renderCurrentView(state.records, scope));
      }
      return { rebuilt: scopes.length, diagnostics };
    },

    prepareNative(scope, nativeDirectory) {
      const paths = ensureScope(scope);
      const currentView = io.readFile(paths.currentView);
      if (nativeDirectory === undefined) return { scope, currentView };
      if (!io.remove || !io.walkFiles) {
        throw new Error("原生记忆临时目录无法保证枚举与清理");
      }
      if (io.exists(nativeDirectory)) io.remove(nativeDirectory);
      io.mkdirp(nativeDirectory);
      io.writeFile(path.join(nativeDirectory, "MEMORY.md"), currentView);
      return { scope, currentView, nativeDirectory };
    },

    reconcileNative(baseline, source = {}) {
      const paths = ensureScope(baseline.scope);
      const diagnostics: string[] = [];
      const changes: MemoryChangeResult[] = [];
      try {
        let nativeCandidates: NativeCandidate[] = [];
        if (baseline.nativeDirectory !== undefined) {
          if (!io.walkFiles) throw new Error("原生记忆临时目录无法枚举");
          for (const file of io.walkFiles(baseline.nativeDirectory).sort()) {
            const relative = path.relative(baseline.nativeDirectory, file);
            if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
              diagnostics.push("原生记忆返回了临时目录外的文件，已忽略");
              continue;
            }
            if (path.extname(file).toLocaleLowerCase() !== ".md") continue;
            try {
              nativeCandidates.push(...parseNativeCandidates(
                io.readFile(file),
                baseline.scope,
                path.basename(file, path.extname(file)),
              ));
            } catch {
              diagnostics.push("一份原生记忆文件无法读取，已忽略");
            }
          }
        } else {
          nativeCandidates = parseNativeCandidates(io.readFile(paths.currentView), baseline.scope);
        }

        const known = new Set([
          ...parseNativeCandidates(baseline.currentView, baseline.scope),
          ...readState(baseline.scope).records,
        ].map((item) => normalized(item.statement)));
        for (const candidate of nativeCandidates) {
          const key = normalized(candidate.statement);
          if (known.has(key)) continue;
          known.add(key);
          if (isSensitive(`${candidate.topic}\n${candidate.statement}`)) {
            diagnostics.push("原生记忆候选包含敏感凭据，已忽略");
            continue;
          }
          changes.push(this.remember({
            scope: baseline.scope,
            kind: candidate.kind,
            topic: candidate.topic,
            statement: candidate.statement,
            sourceType: "native-auto",
            ...(source.conversationId ? { sourceConversationId: source.conversationId } : {}),
            ...(source.messageId ? { sourceMessageId: source.messageId } : {}),
          }));
        }
      } catch {
        diagnostics.push("原生记忆视图无法读取，已从账本恢复");
      } finally {
        if (baseline.nativeDirectory !== undefined) {
          try {
            io.remove?.(baseline.nativeDirectory);
          } catch {
            diagnostics.push("原生记忆临时目录清理失败，将在下次启动重试");
          }
        }
      }
      this.rebuildViews([baseline.scope]);
      return { changes, diagnostics };
    },

    migrateLegacyLayout(notebookIds) {
      const manifest = path.join(workspaceRoot, ".leemo", "migrations", "memory-v1.json");
      if (io.exists(manifest)) {
        try {
          const existing = JSON.parse(io.readFile(manifest)) as LegacyMemoryMigrationReport;
          if (existing.version === 1 && existing.completed === true) {
            return { ...existing, alreadyCompleted: true, manifest };
          }
        } catch {
          return {
            version: 1,
            alreadyCompleted: false,
            completed: false,
            imported: 0,
            importedFiles: [],
            archived: [],
            movedArtifacts: [],
            conflicts: [],
            errors: ["旧记忆迁移清单损坏，已停止以避免重复迁移"],
            manifest,
          };
        }
      }

      const report: LegacyMemoryMigrationReport = {
        version: 1,
        alreadyCompleted: false,
        completed: false,
        imported: 0,
        importedFiles: [],
        archived: [],
        movedArtifacts: [],
        conflicts: [],
        errors: [],
        manifest,
      };
      const archiveRoot = path.join(workspaceRoot, ".leemo", "migrations", "legacy-memory");
      const legacyMemoryDir = path.join(workspaceRoot, "memory");
      const knownMemoryFiles = ["bookmarks.md", "profile.md", "preferences.md", "moments.md"];
      const sources: Array<{
        source: string;
        sourceKey: string;
        scope: MemoryScope;
        archiveDir: string;
      }> = [
        {
          source: path.join(workspaceRoot, "CLAUDE.md"),
          sourceKey: "CLAUDE.md",
          scope: { type: "global" },
          archiveDir: path.join(archiveRoot, "global"),
        },
        ...knownMemoryFiles.map((fileName) => ({
          source: path.join(legacyMemoryDir, fileName),
          sourceKey: `memory/${fileName}`,
          scope: { type: "global" } as MemoryScope,
          archiveDir: path.join(archiveRoot, "global", "memory"),
        })),
      ];
      for (const notebookId of notebookIds) {
        if (!validNotebookId(notebookId)) {
          report.errors.push("发现不合法的本子标识，已跳过其旧记忆迁移");
          continue;
        }
        sources.push({
          source: path.join(workspaceRoot, notebookId, "CLAUDE.md"),
          sourceKey: `${notebookId}/CLAUDE.md`,
          scope: { type: "notebook", notebookId },
          archiveDir: path.join(archiveRoot, "notebooks", notebookId),
        });
      }

      for (const candidateFile of sources) {
        if (!io.exists(candidateFile.source)) continue;
        let contents: string;
        try {
          contents = io.readFile(candidateFile.source);
        } catch {
          report.errors.push(`${candidateFile.sourceKey} 读取失败，原文件已保留`);
          continue;
        }
        const candidates = parseLegacyCandidates(contents, candidateFile.scope, candidateFile.sourceKey);
        let importedFromFile = 0;
        let importFailed = false;
        for (const candidate of candidates) {
          try {
            this.remember({
              scope: candidateFile.scope,
              kind: candidate.kind,
              topic: candidate.topic,
              statement: candidate.statement,
              sourceType: "legacy-import",
              ...(candidate.validFrom === undefined ? {} : { validFrom: candidate.validFrom }),
            });
            report.imported += 1;
            importedFromFile += 1;
          } catch (error: unknown) {
            if (isSensitive(`${candidate.topic}\n${candidate.statement}`)) {
              report.conflicts.push(`${candidateFile.sourceKey} 含敏感凭据候选，未导入长期记忆`);
              continue;
            }
            report.errors.push(`${candidateFile.sourceKey} 导入失败，原文件已保留`);
            importFailed = true;
            break;
          }
        }
        if (importFailed) continue;
        if (importedFromFile > 0) report.importedFiles.push(candidateFile.source);
        try {
          io.mkdirp(candidateFile.archiveDir);
          const archived = uniqueMigrationTarget(
            path.join(candidateFile.archiveDir, path.basename(candidateFile.source)),
            io,
          );
          io.rename(candidateFile.source, archived);
          if (!io.exists(archived)) throw new Error("archive verification failed");
          report.archived.push({ from: candidateFile.source, to: archived });
        } catch {
          report.errors.push(`${candidateFile.sourceKey} 归档失败，原文件已保留`);
        }
      }

      let legacyEntries: string[] = [];
      if (io.exists(legacyMemoryDir)) {
        try {
          legacyEntries = io.readdir(legacyMemoryDir);
        } catch {
          report.errors.push("旧 memory 目录无法读取，普通文档未迁移");
        }
      }
      const known = new Set(knownMemoryFiles.map((name) => name.toLocaleLowerCase()));
      const defaultWorkspace = path.join(workspaceRoot, DEFAULT_WORKSPACE_DIR);
      for (const name of legacyEntries.sort()) {
        if (known.has(name.toLocaleLowerCase())) continue;
        const source = path.join(legacyMemoryDir, name);
        try {
          io.mkdirp(defaultWorkspace);
          const target = uniqueMigrationTarget(path.join(defaultWorkspace, name), io);
          if (target !== path.join(defaultWorkspace, name)) {
            report.conflicts.push(`${name} 在默认工作区重名，已安全改名`);
          }
          io.rename(source, target);
          if (!io.exists(target)) throw new Error("move verification failed");
          report.movedArtifacts.push({ from: source, to: target });
        } catch {
          report.errors.push(`${name} 移入默认工作区失败，原文件已保留`);
        }
      }

      report.completed = report.errors.length === 0;
      if (report.completed) {
        try {
          io.mkdirp(path.dirname(manifest));
          io.writeFile(manifest, `${JSON.stringify(report, null, 2)}\n`);
        } catch {
          report.completed = false;
          report.errors.push("旧记忆迁移清单写入失败");
        }
      }
      return report;
    },
  };
}
