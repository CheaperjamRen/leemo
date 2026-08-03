// Pairing rule for momo's ask_user question cards (启动轮 2 卡 D).
//
// AskUserPayload carries no toolUseId (the MCP handler's `extra` can't see
// the SDK's toolUseId — verified, not worth digging further), so a question
// can't be anchored to its tool call the way ApprovalBar anchors to
// toolUseId. Instead: ask_user BLOCKS the model's round until answered, so
// within one run the tool-call sequence and the question-resolution sequence
// are guaranteed to advance in lockstep — pairing by index is safe.
import type { TimelineItem } from "../../stores/message-model";
import type { PendingInteraction, ResolvedInteraction } from "../../stores/approvals";
import { LEEMO_ASK_USER_TOOL_NAME } from "../../bridge/tool-names";

export type QuestionPending = PendingInteraction & { kind: "question" };
export type QuestionResolved = ResolvedInteraction & { kind: "question" };
export type QuestionInteraction = QuestionPending | QuestionResolved;

export interface AskUserPairing {
  /** interaction paired to the i-th `ask_user` tool-call item encountered in
   *  this run's timeline (document order). `undefined` at an index means no
   *  push has arrived yet for that call — transient; the card appears once
   *  wiring.ts folds the push in and this recomputes. */
  byToolIndex: (QuestionInteraction | undefined)[];
  /** Questions beyond the number of ask_user tool items seen so far — the
   *  push (bridge:askUser) raced ahead of its own tool.started event landing
   *  in the timeline. Render these as a turn-tail fallback: a question that
   *  can't be anchored must still reach the user, never be silently dropped
   *  — an invisible pending question is a permanently stalled round (the
   *  same failure mode this round's approval-anchoring fix already covers). */
  overflow: QuestionInteraction[];
}

/**
 * Build the run's ask_user pairing.
 *
 * Sequence order: `resolvedByRun[runId]`'s question entries (appended in
 * resolution order, which — because ask_user blocks — equals ask order),
 * then the currently pending question for this run, if any, appended last.
 */
export function pairAskUserQuestions(
  items: TimelineItem[],
  runId: string,
  pendingByConversation: Record<string, PendingInteraction | null>,
  resolvedByRun: Record<string, ResolvedInteraction[]>,
): AskUserPairing {
  const resolvedQuestions = (resolvedByRun[runId] ?? []).filter(
    (r): r is QuestionResolved => r.kind === "question",
  );
  const pending = Object.values(pendingByConversation).find(
    (p): p is QuestionPending => p?.kind === "question" && p.runId === runId,
  );
  const sequence: QuestionInteraction[] = pending ? [...resolvedQuestions, pending] : resolvedQuestions;

  const askToolCount = items.filter(
    (it) => it.kind === "tool" && it.name === LEEMO_ASK_USER_TOOL_NAME,
  ).length;

  return {
    byToolIndex: Array.from({ length: askToolCount }, (_, i) => sequence[i]),
    overflow: sequence.slice(askToolCount),
  };
}
