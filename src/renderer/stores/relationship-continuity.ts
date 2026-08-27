import type { TimelineItem } from "./message-model";

export interface RelationshipContinuationCheckpoint {
  version: 1;
  chapterId: string;
  updatedAt: number;
  basisRunIds: string[];
  currentGoal?: string;
  latestUserIntent: string;
  assistantCommitment?: string;
  progress: string[];
  attachmentNames: string[];
}

const CONTINUATION_ONLY = /^(?:请)?(?:继续|接着|接着来|继续吧|接着吧|往下|往下做|继续做|继续处理|再试(?:一次)?|重试(?:一下)?|然后呢|下一步)(?:吧|呀|啊|呢|一下|下去|就好|即可)?[。！!？?…]*$/u;
const INTERNAL_MARKER = /\[\/?Leemo\s+章节续接\]/gu;

function cleanText(value: string, maxLength: number): string {
  return Array.from(value
    .replace(INTERNAL_MARKER, "")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, maxLength)
    .join("");
}

export function isContinuationOnlyMessage(value: string): boolean {
  return CONTINUATION_ONLY.test(value.trim());
}

function failedRunIds(timeline: readonly TimelineItem[]): Set<string> {
  return new Set(timeline
    .filter((item): item is Extract<TimelineItem, { kind: "result" }> => item.kind === "result" && item.isError)
    .map((item) => item.runId));
}

export function deriveRelationshipContinuationCheckpoint(args: {
  chapterId: string;
  timeline: readonly TimelineItem[];
  updatedAt: number;
  currentGoal?: string;
}): RelationshipContinuationCheckpoint | undefined {
  const { chapterId, timeline, updatedAt } = args;
  const failedRuns = failedRunIds(timeline);
  let userIndex = -1;
  let user: Extract<TimelineItem, { kind: "text" }> | undefined;

  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const candidate = timeline[index];
    if (
      candidate.kind === "text"
      && candidate.role === "user"
      && !isContinuationOnlyMessage(candidate.text)
      && cleanText(candidate.text, 800)
    ) {
      user = candidate;
      userIndex = index;
      break;
    }
  }
  if (!user) return undefined;

  const latestUserIntent = cleanText(user.text, 800);
  const attachmentNames = (user.attachments ?? [])
    .map((attachment) => cleanText(attachment.name, 120))
    .filter(Boolean)
    .slice(0, 8);
  let assistant: Extract<TimelineItem, { kind: "text" }> | undefined;
  const progress: string[] = [];
  const evidenceRunIds = new Set<string>([user.runId]);
  const continuationRunIds = new Set<string>([user.runId]);
  for (let index = userIndex + 1; index < timeline.length; index += 1) {
    const candidate = timeline[index];
    if (candidate.kind !== "text" || candidate.role !== "user") continue;
    if (!isContinuationOnlyMessage(candidate.text)) break;
    continuationRunIds.add(candidate.runId);
  }

  for (let index = userIndex + 1; index < timeline.length; index += 1) {
    const candidate = timeline[index];
    if (candidate.kind === "text" && candidate.role === "user" && !isContinuationOnlyMessage(candidate.text)) break;
    if (candidate.kind !== "compact" && !continuationRunIds.has(candidate.runId)) continue;
    if (
      candidate.kind === "text"
      && candidate.role === "momo"
      && !failedRuns.has(candidate.runId)
      && cleanText(candidate.text, 600)
    ) {
      assistant = candidate;
      evidenceRunIds.add(candidate.runId);
    }
    if (candidate.kind === "tool" && candidate.status === "ok" && !failedRuns.has(candidate.runId)) {
      const summary = cleanText(candidate.summary ?? candidate.name, 180);
      if (summary && !progress.includes(summary)) progress.push(summary);
      evidenceRunIds.add(candidate.runId);
    }
    if (candidate.kind === "files" && !failedRuns.has(candidate.runId)) {
      for (const change of candidate.changes) {
        const action = change.change === "deleted" ? "删除" : change.change === "added" ? "生成" : "更新";
        const summary = cleanText(`${action} ${change.path}`, 180);
        if (summary && !progress.includes(summary)) progress.push(summary);
      }
      evidenceRunIds.add(candidate.runId);
    }
  }

  const assistantCommitment = assistant ? cleanText(assistant.text, 600) : undefined;
  return {
    version: 1,
    chapterId,
    updatedAt,
    basisRunIds: [...evidenceRunIds].slice(0, 6),
    ...(args.currentGoal?.trim() ? { currentGoal: cleanText(args.currentGoal, 300) } : {}),
    latestUserIntent,
    ...(assistantCommitment ? { assistantCommitment } : {}),
    progress: progress.slice(-6),
    attachmentNames,
  };
}

export function buildRelationshipRecoveryPrompt(
  userMessage: string,
  checkpoint: RelationshipContinuationCheckpoint,
): string {
  const lines = [
    userMessage.trim(),
    "",
    "[Leemo 章节续接]",
    ...(checkpoint.currentGoal ? [`当前目标：${checkpoint.currentGoal}`] : []),
    `最近请求：${checkpoint.latestUserIntent}`,
    ...(checkpoint.assistantCommitment ? [`上一步：${checkpoint.assistantCommitment}`] : []),
    ...(checkpoint.progress.length > 0 ? [`已有进展：${checkpoint.progress.join("；")}`] : []),
    ...(checkpoint.attachmentNames.length > 0 ? [`本章材料：${checkpoint.attachmentNames.join("、")}`] : []),
    "请沿着这件事继续；遇到证据不足的地方先向用户确认。",
    "[/Leemo 章节续接]",
  ];
  return Array.from(lines.join("\n")).slice(0, 2_400).join("");
}
