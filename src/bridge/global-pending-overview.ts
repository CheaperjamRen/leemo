export type GlobalOverviewSourceKind = "task" | "conversation" | "run" | "artifact";
export type GlobalOverviewTrigger = "manual" | "scheduled";

export const GLOBAL_OVERVIEW_LIMITS = {
  facts: 160,
  tasks: 100,
  conversations: 48,
  artifacts: 64,
  evidencePerFact: 4,
  evidenceChars: 240,
  titleChars: 80,
  summaryChars: 240,
  nextStepChars: 160,
  outputItems: 24,
} as const;

export interface GlobalOverviewFact {
  id: string;
  kind: GlobalOverviewSourceKind;
  label: string;
  projectLabel?: string;
  state: "open" | "running" | "waiting-user" | "failed-retryable" | "delivered" | "uncertain";
  updatedAt: number;
  dueAt?: number;
  relatedIds: string[];
  evidence: string[];
}

export interface GlobalOverviewFactPack {
  generatedAt: number;
  facts: GlobalOverviewFact[];
}

export interface GlobalOverviewItem {
  id: string;
  anchorSourceId: string;
  sourceIds: string[];
  title: string;
  progressSummary: string;
  nextStep?: string;
  projectLabel?: string;
  priority: "now" | "soon" | "later";
}

export interface GlobalOverviewSnapshot {
  version: 1;
  id: string;
  generatedAt: number;
  trigger: GlobalOverviewTrigger;
  providerId: string;
  modelId: string;
  items: GlobalOverviewItem[];
  uncertainSourceIds: string[];
}

export interface GlobalOverviewOverride {
  anchorSourceId: string;
  action: "priority" | "ignore" | "ended";
  value?: "now" | "soon" | "later";
  updatedAt: number;
  sourceUpdatedAt: number;
}

export interface PersistedGlobalOverviewState {
  version: 1;
  snapshot: GlobalOverviewSnapshot | null;
  overrides: GlobalOverviewOverride[];
  lastAutoAttemptDate?: string;
}

export interface StandaloneUsageEvent {
  id: string;
  purpose: "global-overview";
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: string;
  costSource: "sdk" | "local-pricing" | "unpriced";
  tokensEstimated: boolean;
  durationMs: number;
  createdAt: number;
}

const SOURCE_ID_RE = /^(?:task|conversation|run|artifact):\S{1,180}$/;
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (!cleaned || Array.from(cleaned).length > max) return undefined;
  return cleaned;
}

function timestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function uniqueSourceIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !SOURCE_ID_RE.test(candidate)) return undefined;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

function normalizeItem(value: unknown): GlobalOverviewItem | undefined {
  const item = recordOf(value);
  if (!item) return undefined;
  const id = boundedText(item.id, 160);
  const anchorSourceId = boundedText(item.anchorSourceId, 200);
  const sourceIds = uniqueSourceIds(item.sourceIds);
  const title = boundedText(item.title, GLOBAL_OVERVIEW_LIMITS.titleChars);
  const progressSummary = boundedText(item.progressSummary, GLOBAL_OVERVIEW_LIMITS.summaryChars);
  const nextStep = item.nextStep === undefined
    ? undefined
    : boundedText(item.nextStep, GLOBAL_OVERVIEW_LIMITS.nextStepChars);
  const projectLabel = item.projectLabel === undefined
    ? undefined
    : boundedText(item.projectLabel, GLOBAL_OVERVIEW_LIMITS.titleChars);
  const priority = item.priority;
  if (
    !id
    || !anchorSourceId
    || !SOURCE_ID_RE.test(anchorSourceId)
    || !sourceIds
    || sourceIds.length === 0
    || !sourceIds.includes(anchorSourceId)
    || !title
    || !progressSummary
    || (item.nextStep !== undefined && !nextStep)
    || (item.projectLabel !== undefined && !projectLabel)
    || (priority !== "now" && priority !== "soon" && priority !== "later")
  ) return undefined;
  return {
    id,
    anchorSourceId,
    sourceIds,
    title,
    progressSummary,
    ...(nextStep ? { nextStep } : {}),
    ...(projectLabel ? { projectLabel } : {}),
    priority,
  };
}

function normalizeSnapshot(value: unknown): GlobalOverviewSnapshot | null | undefined {
  if (value === null) return null;
  const snapshot = recordOf(value);
  if (!snapshot || snapshot.version !== 1) return undefined;
  const id = boundedText(snapshot.id, 160);
  const generatedAt = timestamp(snapshot.generatedAt);
  const providerId = boundedText(snapshot.providerId, 160);
  const modelId = boundedText(snapshot.modelId, 240);
  const trigger = snapshot.trigger;
  if (
    !id
    || generatedAt === undefined
    || !providerId
    || !modelId
    || (trigger !== "manual" && trigger !== "scheduled")
    || !Array.isArray(snapshot.items)
    || snapshot.items.length > GLOBAL_OVERVIEW_LIMITS.outputItems
  ) return undefined;
  const items = snapshot.items.map(normalizeItem);
  if (items.some((item) => item === undefined)) return undefined;
  const itemIds = new Set<string>();
  for (const item of items as GlobalOverviewItem[]) {
    if (itemIds.has(item.id)) return undefined;
    itemIds.add(item.id);
  }
  const uncertainSourceIds = uniqueSourceIds(snapshot.uncertainSourceIds);
  if (!uncertainSourceIds) return undefined;
  return {
    version: 1,
    id,
    generatedAt,
    trigger,
    providerId,
    modelId,
    items: items as GlobalOverviewItem[],
    uncertainSourceIds,
  };
}

function normalizeOverride(value: unknown): GlobalOverviewOverride | undefined {
  const candidate = recordOf(value);
  if (!candidate) return undefined;
  const anchorSourceId = boundedText(candidate.anchorSourceId, 200);
  const updatedAt = timestamp(candidate.updatedAt);
  const sourceUpdatedAt = timestamp(candidate.sourceUpdatedAt);
  const action = candidate.action;
  if (
    !anchorSourceId
    || !SOURCE_ID_RE.test(anchorSourceId)
    || updatedAt === undefined
    || sourceUpdatedAt === undefined
    || (action !== "priority" && action !== "ignore" && action !== "ended")
  ) return undefined;
  if (action === "priority") {
    const value = candidate.value;
    if (value !== "now" && value !== "soon" && value !== "later") return undefined;
    return { anchorSourceId, action, value, updatedAt, sourceUpdatedAt };
  }
  return { anchorSourceId, action, updatedAt, sourceUpdatedAt };
}

export function normalizePersistedGlobalOverviewState(value: unknown): PersistedGlobalOverviewState | null {
  const state = recordOf(value);
  if (!state || state.version !== 1) return null;
  const snapshot = normalizeSnapshot(state.snapshot);
  if (snapshot === undefined || !Array.isArray(state.overrides)) return null;
  const latestOverrides = new Map<string, GlobalOverviewOverride>();
  for (const override of state.overrides.map(normalizeOverride)) {
    if (!override) continue;
    const previous = latestOverrides.get(override.anchorSourceId);
    if (!previous || override.updatedAt >= previous.updatedAt) {
      latestOverrides.set(override.anchorSourceId, override);
    }
  }
  const overrides = [...latestOverrides.values()];
  const lastAutoAttemptDate = state.lastAutoAttemptDate === undefined
    ? undefined
    : typeof state.lastAutoAttemptDate === "string" && LOCAL_DATE_RE.test(state.lastAutoAttemptDate)
      ? state.lastAutoAttemptDate
      : undefined;
  return {
    version: 1,
    snapshot,
    overrides,
    ...(lastAutoAttemptDate ? { lastAutoAttemptDate } : {}),
  };
}

export function applyGlobalOverviewOverrides(
  items: readonly GlobalOverviewItem[],
  facts: readonly GlobalOverviewFact[],
  overrides: readonly GlobalOverviewOverride[],
): GlobalOverviewItem[] {
  const factUpdatedAt = new Map(facts.map((fact) => [fact.id, fact.updatedAt]));
  const latest = new Map<string, GlobalOverviewOverride>();
  for (const override of overrides) {
    const previous = latest.get(override.anchorSourceId);
    if (!previous || override.updatedAt >= previous.updatedAt) latest.set(override.anchorSourceId, override);
  }
  return items.flatMap((item) => {
    const override = latest.get(item.anchorSourceId);
    if (!override) return [{ ...item, sourceIds: [...item.sourceIds] }];
    if (override.action === "ignore") return [];
    if (override.action === "ended") {
      const newestSource = Math.max(...item.sourceIds.map((id) => factUpdatedAt.get(id) ?? 0));
      if (newestSource <= override.updatedAt) return [];
      return [{ ...item, sourceIds: [...item.sourceIds] }];
    }
    return [{ ...item, sourceIds: [...item.sourceIds], priority: override.value! }];
  });
}
