import type { PendingInteraction } from "./approvals";
import type { TimelineItem } from "./message-model";

export type ConversationStatusKind =
  | "waiting"
  | "running"
  | "blocked"
  | "failed"
  | "canceled"
  | "completed";

export interface ConversationStatus {
  kind: ConversationStatusKind;
  label: string;
  detail: string;
  runId: string | null;
}

function latestTimelineRunId(timeline: TimelineItem[]): string | null {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind !== "compact") return item.runId;
  }
  return null;
}

/** Derive one honest user-facing state from live ownership, interactions, and
 * terminal timeline evidence. Persisted run ids are history, never proof that
 * work is still happening in this renderer process. */
export function deriveConversationStatus({
  timeline,
  activeRunId,
  pending,
}: {
  timeline: TimelineItem[];
  activeRunId: string | null;
  pending: PendingInteraction | null;
}): ConversationStatus {
  const runId = activeRunId ?? latestTimelineRunId(timeline) ?? pending?.runId ?? null;
  const currentPending = pending && pending.runId === runId ? pending : null;

  if (currentPending) {
    return currentPending.kind === "approval"
      ? { kind: "blocked", label: "等你确认", detail: "需要你的确认后才能继续", runId }
      : { kind: "blocked", label: "等你回答", detail: "需要你的回答后才能继续", runId };
  }

  if (activeRunId) {
    return { kind: "running", label: "进行中", detail: "momo 正在处理", runId: activeRunId };
  }

  if (runId) {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item.kind === "compact" || item.runId !== runId) continue;
      if (item.kind === "result") {
        if (item.isError) {
          return { kind: "failed", label: "失败", detail: "这次没有完成，可以查看原因后重试", runId };
        }
        if (item.interrupted) {
          return { kind: "canceled", label: "已中断", detail: "这次已中断", runId };
        }
        return { kind: "completed", label: "已完成", detail: "任务已完成", runId };
      }
      if (item.kind === "error") {
        return { kind: "failed", label: "失败", detail: "这次没有完成，可以查看原因后重试", runId };
      }
    }

    return { kind: "waiting", label: "等待继续", detail: "上次停在这里，可以继续", runId };
  }

  return { kind: "waiting", label: "待开始", detail: "还没开始", runId: null };
}
