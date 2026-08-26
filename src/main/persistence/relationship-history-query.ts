import type { SqliteDatabase } from "./schema";
import type { RelationshipHistoryQuery } from "../../bridge/relationship-history-mcp";

const HOME_WORKSPACE_ID = "leemo-home";

export interface RelationshipHistoryCandidate {
  conversationId: string;
  runId: string;
  role: "user" | "momo";
  text: string;
  createdAt?: number;
  activityAt: number;
  order: number;
}

interface RelationshipTextRow {
  conversation_id: string;
  last_activity_at: number;
  seq: number;
  run_id: string;
  role: "user" | "momo";
  text: string;
  created_at: number | null;
}

export const MAX_RELATIONSHIP_HISTORY_CANDIDATES = 256;
const MAX_STRONG_MATCH_CANDIDATES = 64;

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function prefilterTerms(query: string): string[] {
  const chunks = normalize(query).match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) ?? [];
  const terms = new Set<string>();
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}]+$/u.test(chunk) && chunk.length > 2) {
      for (let index = 0; index < chunk.length - 1; index += 1) terms.add(chunk.slice(index, index + 2));
    } else if (chunk.length >= 2) {
      terms.add(chunk);
    }
    if (terms.size >= 16) break;
  }
  return [...terms];
}

function likePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export function loadRelationshipHistoryCandidates(
  database: SqliteDatabase,
  input?: RelationshipHistoryQuery,
): RelationshipHistoryCandidate[] {
  const terms = input ? prefilterTerms(input.query) : [];
  if (input && terms.length === 0) return [];
  const textExpression = "LOWER(TRIM(CAST(json_extract(m.item_json, '$.text') AS TEXT)))";
  const patterns = terms.map(likePattern);
  const readRows = (
    matchOperator: "AND" | "OR" | undefined,
    direction: "ASC" | "DESC",
    limit: number,
  ): RelationshipTextRow[] => {
    const matchSql = matchOperator
      ? `AND (${terms.map(() => `${textExpression} LIKE ? ESCAPE '\\'`).join(` ${matchOperator} `)})`
      : "";
    return database.prepare(`
    SELECT
      c.id AS conversation_id,
      c.last_activity_at,
      m.seq,
      CAST(json_extract(m.item_json, '$.runId') AS TEXT) AS run_id,
      CAST(json_extract(m.item_json, '$.role') AS TEXT) AS role,
      CAST(json_extract(m.item_json, '$.text') AS TEXT) AS text,
      CASE
        WHEN json_type(m.item_json, '$.createdAt') IN ('integer', 'real')
        THEN CAST(json_extract(m.item_json, '$.createdAt') AS REAL)
        ELSE NULL
      END AS created_at
    FROM conversations AS c
    INNER JOIN messages AS m ON m.conversation_id = c.id
    WHERE c.source = 'buddy'
      AND c.book_id IS NULL
      AND (c.workspace_id IS NULL OR c.workspace_id = ?)
      AND COALESCE(c.archived, 0) = 0
      AND m.kind = 'text'
      AND json_valid(m.item_json) = 1
      AND json_extract(m.item_json, '$.kind') = 'text'
      AND COALESCE(json_extract(m.item_json, '$.streaming'), 0) <> 1
      AND json_extract(m.item_json, '$.role') IN ('user', 'momo')
      AND LENGTH(TRIM(COALESCE(CAST(json_extract(m.item_json, '$.runId') AS TEXT), ''))) > 0
      AND LENGTH(TRIM(COALESCE(CAST(json_extract(m.item_json, '$.text') AS TEXT), ''))) > 0
      ${matchSql}
    ORDER BY m.rowid ${direction}
    LIMIT ?
  `).all(
      HOME_WORKSPACE_ID,
      ...(matchOperator ? patterns : []),
      limit,
    ) as RelationshipTextRow[];
  };

  // 两个有界 pass 避免对全部命中行做相关度排序：先从历史正序保住较早的
  // 强匹配，再从倒序补最近的宽匹配；JS scorer 只接触最多 256 个候选。
  const rows = input
    ? [
        ...readRows("AND", "ASC", MAX_STRONG_MATCH_CANDIDATES),
        ...readRows("OR", "DESC", MAX_RELATIONSHIP_HISTORY_CANDIDATES),
      ]
    : readRows(undefined, "ASC", MAX_RELATIONSHIP_HISTORY_CANDIDATES);

  const candidates: RelationshipHistoryCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.conversation_id}\0${row.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidates.length >= MAX_RELATIONSHIP_HISTORY_CANDIDATES) break;
    const createdAt = typeof row.created_at === "number" && Number.isFinite(row.created_at)
      ? row.created_at
      : undefined;
    candidates.push({
      conversationId: row.conversation_id,
      runId: row.run_id,
      role: row.role,
      text: row.text,
      ...(createdAt !== undefined ? { createdAt } : {}),
      activityAt: createdAt ?? row.last_activity_at,
      order: candidates.length,
    });
  }
  return candidates;
}
