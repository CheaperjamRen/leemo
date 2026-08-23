import type { WorkOverviewEvidence, WorkOverviewSnapshot } from "../../bridge/work-overview";
import type { PendingInteraction, ResolvedInteraction } from "../stores/approvals";
import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";

type PlanStepStatus = "done" | "active" | "todo";

export interface KnownPlanView {
  runId: string;
  steps: Array<{ text: string; status: PlanStepStatus }>;
  done: number;
  total: number;
  current: boolean;
}

export type ConversationContinuityState = "waiting" | "blocked" | "running" | "recent";

export interface ConversationContinuitySnapshot {
  conversationId: string;
  title: string;
  state: ConversationContinuityState;
  objective?: { text: string; source: "semantic" | "legacy-title" };
  successCriteria: string[];
  currentPhase?: string;
  currentFocus?: string;
  currentPlan?: KnownPlanView;
  nextKnown: Array<{ text: string; certainty: "known" | "possible" }>;
  blockers: Array<{ text: string; kind: "semantic" | "waiting" | "failure" }>;
  completed: WorkOverviewEvidence[];
  artifacts: ArtifactEntry[];
  updatedAt?: number;
}

export interface PendingContinuitySummary {
  interaction: PendingInteraction;
  summary: string;
}

export interface ConversationContinuityInput {
  conversationId: string;
  title: string;
  timeline: readonly TimelineItem[];
  activeRunId: string | null | undefined;
  pending?: PendingContinuitySummary | null;
  resolvedInteractions?: readonly ResolvedInteraction[];
  artifacts: readonly ArtifactEntry[];
}

export interface NotebookContinuitySnapshot {
  conversations: ConversationContinuitySnapshot[];
}

export interface NotebookContinuityInput {
  conversations: readonly ConversationContinuityInput[];
}

type OverviewItem = Extract<TimelineItem, { kind: "overview" }>;
type PlanItem = Extract<TimelineItem, { kind: "plan" }>;

function nonEmpty(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function latestOverview(
  conversationId: string,
  timeline: readonly TimelineItem[],
): OverviewItem | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind !== "overview") continue;
    const scope = item.overview.scopeConversationId;
    if (scope !== undefined && scope !== conversationId) continue;
    return item;
  }
  return undefined;
}

function latestPlanForRun(timeline: readonly TimelineItem[], runId: string | undefined): PlanItem | undefined {
  if (!runId) return undefined;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "plan" && item.runId === runId) return item;
  }
  return undefined;
}

function planView(plan: PlanItem | undefined): KnownPlanView | undefined {
  if (!plan || plan.todos.length === 0) return undefined;
  const steps = plan.todos.map(({ text, status }) => ({ text, status }));
  return {
    runId: plan.runId,
    steps,
    done: steps.filter((step) => step.status === "done").length,
    total: steps.length,
    current: true,
  };
}

function isSuccessfulTool(
  tool: Pick<Extract<TimelineItem, { kind: "tool" }>, "status" | "outcome">,
): boolean {
  return tool.status === "ok"
    && tool.outcome !== "failed"
    && tool.outcome !== "denied"
    && tool.outcome !== "cancelled"
    && tool.outcome !== "interrupted";
}

function isSuccessfulResult(item: Extract<TimelineItem, { kind: "result" }>): boolean {
  return !item.isError
    && !item.interrupted
    && (item.outcome === undefined || item.outcome === "completed");
}

function finalTaskStates(timeline: readonly TimelineItem[]): Map<string, { text: string; status: PlanStepStatus }> {
  const states = new Map<string, { text: string; status: PlanStepStatus }>();
  for (const item of timeline) {
    if (item.kind !== "plan") continue;
    for (const todo of item.todos) {
      if (todo.taskId) states.set(todo.taskId, { text: todo.text, status: todo.status });
    }
  }
  return states;
}

function isUserConfirmedResolution(interaction: ResolvedInteraction): boolean {
  if (interaction.kind === "question") return interaction.items !== null;
  return interaction.outcome === "allow-once"
    || interaction.outcome === "allow-conversation"
    || interaction.outcome === "allow-permanent";
}

function realEvidenceIds(
  input: ConversationContinuityInput,
  artifacts: readonly ArtifactEntry[],
  taskStates: ReadonlyMap<string, { text: string; status: PlanStepStatus }>,
): Set<string> {
  const ids = new Set<string>();
  const conversationRunIds = new Set<string>();

  for (const item of input.timeline) {
    if (item.kind !== "compact") conversationRunIds.add(item.runId);
    if (item.kind === "tool" && isSuccessfulTool(item)) ids.add(item.toolUseId);
    if (item.kind === "activity") {
      for (const tool of item.tools) {
        if (isSuccessfulTool(tool)) ids.add(tool.toolUseId);
      }
    }
    if (item.kind === "result" && isSuccessfulResult(item)) {
      ids.add(item.id);
      ids.add(item.runId);
    }
    if (item.kind === "files" && item.changes.length > 0) ids.add(item.id);
  }

  for (const [taskId, task] of taskStates) {
    if (task.status === "done") ids.add(taskId);
  }
  for (const entry of artifacts) ids.add(entry.id);
  for (const interaction of input.resolvedInteractions ?? []) {
    if (conversationRunIds.has(interaction.runId) && isUserConfirmedResolution(interaction)) {
      ids.add(interaction.id);
    }
  }
  return ids;
}

function verifiedCompleted(
  overview: OverviewItem | undefined,
  evidenceIds: ReadonlySet<string>,
  taskStates: ReadonlyMap<string, { text: string; status: PlanStepStatus }>,
): WorkOverviewEvidence[] {
  const completed = new Map<string, WorkOverviewEvidence>();
  const highlights = overview?.overview.completedHighlights ?? [];
  for (const item of highlights) {
    if (item.basisEventIds.length === 0 || !item.basisEventIds.every((id) => evidenceIds.has(id))) continue;
    completed.set(item.evidenceId, {
      evidenceId: item.evidenceId,
      text: item.text,
      basisEventIds: [...item.basisEventIds],
    });
  }
  for (const [taskId, task] of taskStates) {
    if (task.status !== "done" || completed.has(taskId)) continue;
    completed.set(taskId, { evidenceId: taskId, text: task.text, basisEventIds: [taskId] });
  }
  return [...completed.values()];
}

function lastRunId(timeline: readonly TimelineItem[]): string | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind !== "compact") return item.runId;
  }
  return undefined;
}

function failureBlocker(timeline: readonly TimelineItem[], runId: string | undefined): string | undefined {
  if (!runId) return undefined;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "compact" || item.runId !== runId) continue;
    if (item.kind === "result") return item.isError ? "上次运行失败" : undefined;
    if (item.kind === "error") return nonEmpty(item.message) ?? "上次运行失败";
    if (item.kind === "retry" && item.state === "failed") return nonEmpty(item.summary) ?? "重试失败";
  }
  return undefined;
}

function latestMeaningfulTimestamp(
  timeline: readonly TimelineItem[],
  pending: PendingContinuitySummary | null | undefined,
  artifacts: readonly ArtifactEntry[],
): number | undefined {
  const timestamps: number[] = [];
  const add = (value: number | undefined) => {
    if (value !== undefined && Number.isFinite(value)) timestamps.push(value);
  };

  for (const item of timeline) {
    if ("createdAt" in item) add(item.createdAt);
    if (item.kind === "overview") add(item.overview.updatedAt);
    if (item.kind === "activity") {
      add(item.startedAt);
      add(item.updatedAt);
      for (const entry of item.transcript) add(entry.createdAt);
    }
  }
  add(pending?.interaction.receivedAt);
  for (const entry of artifacts) add(entry.createdAt);
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined;
}

function conversationState(
  pending: PendingContinuitySummary | null | undefined,
  activeRunId: string | null | undefined,
  semanticBlockers: readonly string[],
  failure: string | undefined,
): ConversationContinuityState {
  if (pending?.interaction.kind === "question") return "waiting";
  if (pending?.interaction.kind === "approval") return "blocked";
  if (activeRunId) return "running";
  if (semanticBlockers.length > 0 || failure) return "blocked";
  return "recent";
}

function objectiveFrom(
  overview: OverviewItem | undefined,
  title: string,
): ConversationContinuitySnapshot["objective"] {
  const semantic = overview?.overview as OverviewItem["overview"] & Partial<WorkOverviewSnapshot> | undefined;
  const objective = nonEmpty(semantic?.objective);
  if (objective) {
    return { text: objective, source: semantic?.objectiveSource ?? "semantic" };
  }
  const legacyTheme = nonEmpty(overview?.overview.theme);
  if (legacyTheme) return { text: legacyTheme, source: "legacy-title" };
  const legacyTitle = nonEmpty(title);
  return legacyTitle ? { text: legacyTitle, source: "legacy-title" } : undefined;
}

function scopedPending(input: ConversationContinuityInput): PendingContinuitySummary | undefined {
  return input.pending?.interaction.conversationId === input.conversationId ? input.pending : undefined;
}

export function deriveConversationContinuity(
  input: ConversationContinuityInput,
): ConversationContinuitySnapshot {
  const overview = latestOverview(input.conversationId, input.timeline);
  const semantic = overview?.overview;
  const pending = scopedPending(input);
  const artifacts = input.artifacts
    .filter((entry) => entry.sourceConversationId === input.conversationId)
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id));
  const taskStates = finalTaskStates(input.timeline);
  const evidenceIds = realEvidenceIds(input, artifacts, taskStates);
  const currentRunId = pending?.interaction.runId ?? input.activeRunId ?? undefined;
  const currentPlan = planView(latestPlanForRun(input.timeline, currentRunId));
  const semanticNext = semantic?.nextKnown?.map(nonEmpty).filter((text): text is string => text !== undefined) ?? [];
  const planNext = currentPlan?.steps
    .filter((step) => step.status !== "done")
    .map((step) => step.text.trim())
    .filter(Boolean) ?? [];
  const nextKnown = (semanticNext.length > 0 ? semanticNext : planNext)
    .map((text) => ({ text, certainty: "known" as const }));
  const semanticBlockers = semantic?.blockers?.map(nonEmpty).filter((text): text is string => text !== undefined) ?? [];
  const failure = failureBlocker(input.timeline, currentRunId ?? lastRunId(input.timeline));
  const blockers: ConversationContinuitySnapshot["blockers"] = semanticBlockers
    .map((text) => ({ text, kind: "semantic" as const }));
  const pendingSummary = nonEmpty(pending?.summary);
  if (pendingSummary) blockers.push({ text: pendingSummary, kind: "waiting" });
  if (failure) blockers.push({ text: failure, kind: "failure" });
  const objective = objectiveFrom(overview, input.title);
  const currentPhase = nonEmpty(semantic?.currentPhase ?? semantic?.currentPosition ?? semantic?.summary);
  const currentFocus = nonEmpty(semantic?.currentFocus ?? semantic?.focus);
  const updatedAt = latestMeaningfulTimestamp(input.timeline, pending, artifacts);

  return {
    conversationId: input.conversationId,
    title: input.title,
    state: conversationState(pending, input.activeRunId, semanticBlockers, failure),
    ...(objective ? { objective } : {}),
    successCriteria: semantic?.successCriteria?.map(nonEmpty).filter((text): text is string => text !== undefined) ?? [],
    ...(currentPhase ? { currentPhase } : {}),
    ...(currentFocus ? { currentFocus } : {}),
    ...(currentPlan ? { currentPlan } : {}),
    nextKnown,
    blockers,
    completed: verifiedCompleted(overview, evidenceIds, taskStates),
    artifacts,
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

function hasMeaningfulContinuity(input: ConversationContinuityInput): boolean {
  if (scopedPending(input)) return true;
  if (input.artifacts.some((entry) => entry.sourceConversationId === input.conversationId)) return true;
  return input.timeline.some((item) =>
    item.kind === "overview"
    || item.kind === "plan"
    || item.kind === "tool"
    || item.kind === "activity"
    || item.kind === "result"
    || item.kind === "files"
    || item.kind === "memory"
    || item.kind === "error"
    || item.kind === "retry"
    || (item.kind === "text" && item.role === "user" && item.text.trim().length > 0));
}

const STATE_PRIORITY: Record<ConversationContinuityState, number> = {
  waiting: 0,
  blocked: 1,
  running: 2,
  recent: 3,
};

export function deriveNotebookContinuity(input: NotebookContinuityInput): NotebookContinuitySnapshot {
  const seen = new Set<string>();
  const conversations = input.conversations
    .filter((conversation) => {
      if (seen.has(conversation.conversationId) || !hasMeaningfulContinuity(conversation)) return false;
      seen.add(conversation.conversationId);
      return true;
    })
    .map(deriveConversationContinuity)
    .sort((left, right) => STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state]
      || (right.updatedAt ?? Number.NEGATIVE_INFINITY) - (left.updatedAt ?? Number.NEGATIVE_INFINITY)
      || left.conversationId.localeCompare(right.conversationId))
    .slice(0, 5);
  return { conversations };
}
