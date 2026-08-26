import type {
  RelationshipHistoryHit,
  RelationshipHistoryQuery,
} from "../bridge/relationship-history-mcp";
import type { PersistedConversation } from "./persistence/schema";
import type { RelationshipHistoryCandidate } from "./persistence/relationship-history-query";

export type { RelationshipHistoryCandidate } from "./persistence/relationship-history-query";

const MAX_EXCERPT_CHARS = 520;
const HOME_WORKSPACE_ID = "leemo-home";

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  const chunks = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) ?? [];
  const terms = new Set<string>();
  for (const chunk of chunks) {
    if (/^[\p{Script=Han}]+$/u.test(chunk) && chunk.length > 2) {
      for (let index = 0; index < chunk.length - 1; index += 1) {
        terms.add(chunk.slice(index, index + 2));
      }
    } else if (chunk.length >= 2) {
      terms.add(chunk);
    }
  }
  return [...terms];
}

function excerpt(text: string, terms: readonly string[]): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_EXCERPT_CHARS) return compact;
  const lower = compact.toLocaleLowerCase();
  const positions = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const first = positions.length > 0 ? Math.min(...positions) : 0;
  const start = Math.max(0, first - 120);
  const slice = compact.slice(start, start + MAX_EXCERPT_CHARS - 2);
  return `${start > 0 ? "…" : ""}${slice}${start + slice.length < compact.length ? "…" : ""}`;
}

function scoreText(text: string, query: string, terms: readonly string[]): number {
  const candidate = normalize(text);
  if (!candidate) return 0;
  const matched = terms.filter((term) => candidate.includes(term));
  if (terms.length > 0 && matched.length / terms.length < 0.5) return 0;
  const exact = candidate.includes(query) ? 1 : 0;
  return exact * 100 + matched.length * 10;
}

export function searchRelationshipHistoryCandidates(
  relationshipCandidates: readonly RelationshipHistoryCandidate[],
  input: RelationshipHistoryQuery,
): RelationshipHistoryHit[] {
  const query = normalize(input.query);
  const terms = queryTerms(query);
  if (!query || terms.length === 0) return [];
  const limit = Math.max(1, Math.min(8, Math.floor(input.limit)));

  const candidates: Array<RelationshipHistoryHit & { score: number; activityAt: number; order: number }> = [];
  for (const candidate of relationshipCandidates) {
    const score = scoreText(candidate.text, query, terms);
    if (score <= 0) continue;
    candidates.push({
      conversationId: candidate.conversationId,
      runId: candidate.runId,
      role: candidate.role,
      text: excerpt(candidate.text, terms),
      ...(candidate.createdAt !== undefined ? { createdAt: candidate.createdAt } : {}),
      score,
      activityAt: candidate.activityAt,
      order: candidate.order,
    });
  }

  return candidates
    .sort((left, right) => right.score - left.score
      || Number(right.role === "user") - Number(left.role === "user")
      || right.activityAt - left.activityAt
      || left.order - right.order)
    .slice(0, limit)
    .map(({ score: _score, activityAt: _activityAt, order: _order, ...hit }) => hit);
}

export function searchRelationshipHistory(
  conversations: readonly PersistedConversation[],
  input: RelationshipHistoryQuery,
): RelationshipHistoryHit[] {
  const candidates: RelationshipHistoryCandidate[] = [];
  for (const conversation of conversations) {
    const { meta } = conversation;
    if (
      meta.source !== "buddy"
      || meta.bookId !== null
      || (meta.workspaceId ?? HOME_WORKSPACE_ID) !== HOME_WORKSPACE_ID
      || meta.archived === true
    ) continue;
    for (const item of conversation.timeline) {
      if (item.kind !== "text" || item.streaming || !item.text.trim()) continue;
      candidates.push({
        conversationId: meta.id,
        runId: item.runId,
        role: item.role,
        text: item.text,
        ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
        activityAt: item.createdAt ?? meta.lastActivityAt,
        order: candidates.length,
      });
    }
  }
  return searchRelationshipHistoryCandidates(candidates, input);
}
