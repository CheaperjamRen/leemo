import {
  GLOBAL_OVERVIEW_LIMITS,
  type GlobalOverviewFact,
  type GlobalOverviewFactPack,
} from "../../bridge/global-pending-overview";
import type { UserTask } from "../../tasks";
import type { ArtifactEntry } from "../stores/artifacts";
import type { ConversationMeta } from "../stores/conversations";
import type { TimelineItem } from "../stores/message-model";

const RECENT_WINDOW_MS = 30 * 86_400_000;

export interface BuildGlobalOverviewFactPackInput {
  now?: number;
  tasks: readonly UserTask[];
  conversations: Readonly<Record<string, ConversationMeta>>;
  timelines: Readonly<Record<string, readonly TimelineItem[] | undefined>>;
  runIds: Readonly<Record<string, string | null | undefined>>;
  pendingConversationIds?: ReadonlySet<string>;
  artifacts: readonly ArtifactEntry[];
  workspaceLabels?: Readonly<Record<string, string | undefined>>;
}

function clip(value: string, max: number = GLOBAL_OVERVIEW_LIMITS.evidenceChars): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const chars = Array.from(cleaned);
  if (chars.length <= max) return cleaned;
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function projectLabel(meta: ConversationMeta, workspaceLabels?: Readonly<Record<string, string | undefined>>): string | undefined {
  return meta.bookId?.trim()
    || workspaceLabels?.[meta.workspaceId ?? ""]?.trim()
    || undefined;
}

function latestOf<T extends TimelineItem["kind"]>(
  timeline: readonly TimelineItem[],
  kind: T,
): Extract<TimelineItem, { kind: T }> | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === kind) return item as Extract<TimelineItem, { kind: T }>;
  }
  return undefined;
}

function conversationState(
  timeline: readonly TimelineItem[],
  activeRunId: string | null | undefined,
  pending: boolean,
): GlobalOverviewFact["state"] {
  if (pending) return "waiting-user";
  if (activeRunId) return "running";
  const terminal = latestOf(timeline, "result");
  if (terminal?.isError) return terminal.retryable === false ? "uncertain" : "failed-retryable";
  if (terminal) return "delivered";
  if (latestOf(timeline, "error")) return "failed-retryable";
  return "uncertain";
}

function conversationEvidence(timeline: readonly TimelineItem[]): string[] {
  const evidence: string[] = [];
  const userText = [...timeline].reverse().find(
    (item): item is Extract<TimelineItem, { kind: "text" }> => item.kind === "text" && item.role === "user" && item.text.trim().length > 0,
  );
  if (userText) evidence.push(clip(`用户：${userText.text}`));
  const overview = latestOf(timeline, "overview")?.overview;
  if (overview?.summary) evidence.push(clip(`概览：${overview.summary}`));
  if (overview?.nextStep) evidence.push(clip(`下一步：${overview.nextStep}`));
  const terminal = latestOf(timeline, "result");
  if (terminal?.finalText.trim()) evidence.push(clip(`回执：${terminal.finalText}`));
  const error = latestOf(timeline, "error");
  if (!terminal && error?.message.trim()) evidence.push(clip(`错误：${error.message}`));
  return evidence.slice(0, GLOBAL_OVERVIEW_LIMITS.evidencePerFact);
}

function hasSubstantialWork(meta: ConversationMeta, timeline: readonly TimelineItem[]): boolean {
  if (meta.source !== "workbench") return false;
  return timeline.some((item) => item.kind === "text" && item.role === "user" && item.text.trim().length > 0);
}

function taskFacts(tasks: readonly UserTask[]): GlobalOverviewFact[] {
  return tasks
    .filter((task) => task.status === "open" && task.deletedAt === undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .slice(0, GLOBAL_OVERVIEW_LIMITS.tasks)
    .map((task) => ({
      id: `task:${task.id}`,
      kind: "task" as const,
      label: clip(task.title, GLOBAL_OVERVIEW_LIMITS.titleChars),
      ...(task.notebookId?.trim() ? { projectLabel: clip(task.notebookId, GLOBAL_OVERVIEW_LIMITS.titleChars) } : {}),
      state: "open" as const,
      updatedAt: task.updatedAt,
      ...(task.dueAt !== null ? { dueAt: task.dueAt } : {}),
      relatedIds: task.noteId ? [`note:${task.noteId}`] : [],
      evidence: [task.details.trim() ? clip(task.details) : "这条待办仍未完成"],
    }));
}

export function buildGlobalOverviewFactPack(input: BuildGlobalOverviewFactPackInput): GlobalOverviewFactPack {
  const now = input.now ?? Date.now();
  const pendingIds = input.pendingConversationIds ?? new Set<string>();
  const includedConversationIds = new Set<string>();
  const conversationFacts = Object.values(input.conversations)
    .filter((meta) => !meta.archived)
    .map((meta): GlobalOverviewFact | undefined => {
      const timeline = input.timelines[meta.id] ?? [];
      const activeRunId = input.runIds[meta.id];
      const state = conversationState(timeline, activeRunId, pendingIds.has(meta.id));
      const forceInclude = state === "waiting-user" || state === "running" || state === "failed-retryable";
      const recent = meta.lastActivityAt >= now - RECENT_WINDOW_MS;
      if (!forceInclude && (!recent || !hasSubstantialWork(meta, timeline))) return undefined;
      includedConversationIds.add(meta.id);
      const relatedIds = new Set<string>();
      if (activeRunId) relatedIds.add(`run:${activeRunId}`);
      for (const entry of input.artifacts) {
        if (entry.sourceConversationId === meta.id) relatedIds.add(`artifact:${entry.id}`);
      }
      return {
        id: `conversation:${meta.id}`,
        kind: "conversation" as const,
        label: clip(meta.title || "未命名对话", GLOBAL_OVERVIEW_LIMITS.titleChars),
        ...(projectLabel(meta, input.workspaceLabels) ? { projectLabel: projectLabel(meta, input.workspaceLabels) } : {}),
        state,
        updatedAt: meta.lastActivityAt,
        relatedIds: [...relatedIds],
        evidence: conversationEvidence(timeline),
      };
    })
    .filter((fact): fact is GlobalOverviewFact => fact !== undefined)
    .sort((left, right) => {
      const rank = { "waiting-user": 0, running: 1, "failed-retryable": 2, delivered: 3, uncertain: 4, open: 5 } as const;
      return rank[left.state] - rank[right.state] || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    })
    .slice(0, GLOBAL_OVERVIEW_LIMITS.conversations);

  includedConversationIds.clear();
  for (const fact of conversationFacts) includedConversationIds.add(fact.id.slice("conversation:".length));

  const runFacts = Object.entries(input.runIds)
    .flatMap(([conversationId, runId]): GlobalOverviewFact[] => {
      if (!runId || !includedConversationIds.has(conversationId)) return [];
      const conversation = input.conversations[conversationId];
      if (!conversation) return [];
      const timeline = input.timelines[conversationId] ?? [];
      const label = conversation.title?.trim() || "正在进行的任务";
      return [{
        id: `run:${runId}`,
        kind: "run",
        label: clip(label, GLOBAL_OVERVIEW_LIMITS.titleChars),
        ...(projectLabel(conversation, input.workspaceLabels)
          ? { projectLabel: projectLabel(conversation, input.workspaceLabels) }
          : {}),
        state: "running",
        updatedAt: conversation.lastActivityAt,
        relatedIds: [`conversation:${conversationId}`],
        evidence: conversationEvidence(timeline),
      }];
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));

  const artifactFacts = input.artifacts
    .filter((entry) => includedConversationIds.has(entry.sourceConversationId))
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    .slice(0, GLOBAL_OVERVIEW_LIMITS.artifacts)
    .map((entry) => {
      const conversation = input.conversations[entry.sourceConversationId];
      return {
        id: `artifact:${entry.id}`,
        kind: "artifact" as const,
        label: clip(entry.title, GLOBAL_OVERVIEW_LIMITS.titleChars),
        ...(entry.bookId?.trim()
          ? { projectLabel: clip(entry.bookId, GLOBAL_OVERVIEW_LIMITS.titleChars) }
          : conversation && projectLabel(conversation, input.workspaceLabels)
            ? { projectLabel: projectLabel(conversation, input.workspaceLabels) }
            : {}),
        state: "delivered" as const,
        updatedAt: entry.createdAt,
        relatedIds: [`conversation:${entry.sourceConversationId}`, `run:${entry.sourceRunId}`],
        evidence: [`成果：${clip(entry.title)}`],
      } satisfies GlobalOverviewFact;
    });

  return {
    generatedAt: now,
    facts: [...taskFacts(input.tasks), ...conversationFacts, ...runFacts, ...artifactFacts]
      .slice(0, GLOBAL_OVERVIEW_LIMITS.facts),
  };
}
