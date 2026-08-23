export const LEEMO_WORK_OVERVIEW_TOOL = "mcp__leemo-work-overview__set_work_overview";

export const WORK_OVERVIEW_UPDATE_REASONS = [
  "objective-set",
  "objective-changed",
  "phase-changed",
  "blocked",
  "recovered",
  "run-completed",
  "manual-refresh",
] as const;

export type WorkOverviewUpdateReason = (typeof WORK_OVERVIEW_UPDATE_REASONS)[number];

export const WORK_OVERVIEW_LIMITS = {
  objective: 160,
  phase: 120,
  focus: 120,
  listEntry: 120,
  listLength: 5,
  userVisibleCharacters: 800,
} as const;

export interface WorkOverviewEvidence {
  evidenceId: string;
  text: string;
  basisEventIds: string[];
}

export interface WorkOverviewPatch {
  objective?: string;
  successCriteria?: string[];
  currentPhase?: string;
  currentFocus?: string;
  nextKnown?: string[];
  blockers?: string[];
  decisions?: WorkOverviewEvidence[];
  completedHighlights?: WorkOverviewEvidence[];
  clearFields?: Array<"objective" | "currentPhase" | "currentFocus">;
  updateReason: WorkOverviewUpdateReason;
  basisEventIds?: string[];
}

export interface WorkOverviewUserCorrection {
  objective?: string;
  successCriteria?: string[];
  clearFields?: Array<"objective" | "successCriteria">;
}

export interface WorkOverviewSnapshot {
  revision: number;
  scopeConversationId: string;
  sourceRunId: string;
  sourceToolUseId: string;
  updatedAt: number;
  updateReason: WorkOverviewUpdateReason | "user-correction" | "legacy-migration";
  basisEventIds: string[];
  actor: "momo" | "user" | "legacy";
  objective?: string;
  objectiveSource?: "semantic" | "legacy-title";
  successCriteria: string[];
  currentPhase?: string;
  currentFocus?: string;
  nextKnown: string[];
  blockers: string[];
  decisions: WorkOverviewEvidence[];
  completedHighlights: WorkOverviewEvidence[];
  fieldAuthority: {
    objective?: "momo" | "user" | "legacy";
    successCriteria?: "momo" | "user";
  };
}

export interface WorkOverviewPatchMetadata {
  scopeConversationId: string;
  sourceRunId: string;
  toolUseId: string;
  updatedAt: number;
  actor: "momo";
}

export interface WorkOverviewUserCorrectionMetadata {
  correctionId: string;
  scopeConversationId: string;
  updatedAt: number;
}

export interface WorkOverviewLegacyMigrationMetadata {
  scopeConversationId: string;
  updatedAt: number;
}

export type NormalizeWorkOverviewPatchResult =
  | { ok: true; value: WorkOverviewPatch }
  | { ok: false; error: string };

const PATCH_FIELDS = new Set([
  "objective",
  "successCriteria",
  "currentPhase",
  "currentFocus",
  "nextKnown",
  "blockers",
  "decisions",
  "completedHighlights",
  "clearFields",
  "updateReason",
  "basisEventIds",
]);

const PATCH_CLEAR_FIELDS = ["objective", "currentPhase", "currentFocus"] as const;
const USER_CORRECTION_CLEAR_FIELDS = ["objective", "successCriteria"] as const;

function normalizeRequiredText(value: unknown, label: string, limit: number): string | null {
  if (typeof value !== "string") throw new Error(`${label}需要使用文字。`);
  const text = value.trim();
  if (!text) throw new Error(`${label}不能为空。`);
  if (text.length > limit) throw new Error(`${label}过长，请只保留必要概括。`);
  return text;
}

function normalizeOptionalText(value: unknown, label: string, limit: number): string | undefined {
  if (value === undefined) return undefined;
  return normalizeRequiredText(value, label, limit) ?? undefined;
}

function normalizeTextList(value: unknown, label: string, countText: (text: string) => void): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label}需要使用列表。`);
  if (value.length > WORK_OVERVIEW_LIMITS.listLength) throw new Error(`${label}最多保留五项。`);
  return value.map((item) => {
    const text = normalizeRequiredText(item, label, WORK_OVERVIEW_LIMITS.listEntry) ?? "";
    countText(text);
    return text;
  });
}

function normalizeIdList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label}需要使用列表。`);
  if (value.length > WORK_OVERVIEW_LIMITS.listLength) throw new Error(`${label}最多保留五项。`);
  return value.map((item) => normalizeRequiredText(item, label, WORK_OVERVIEW_LIMITS.listEntry) ?? "");
}

function normalizeEvidenceList(value: unknown, label: string, countText: (text: string) => void): WorkOverviewEvidence[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label}需要使用列表。`);
  if (value.length > WORK_OVERVIEW_LIMITS.listLength) throw new Error(`${label}最多保留五项。`);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label}需要使用带来源的条目。`);
    const raw = item as Record<string, unknown>;
    const evidenceId = normalizeRequiredText(raw.evidenceId, "证据编号", WORK_OVERVIEW_LIMITS.listEntry) ?? "";
    const text = normalizeRequiredText(raw.text, label, WORK_OVERVIEW_LIMITS.listEntry) ?? "";
    const basisEventIds = normalizeIdList(raw.basisEventIds, "证据来源") ?? [];
    if (basisEventIds.length === 0) throw new Error(`${label}需要至少一个真实来源。`);
    countText(text);
    return { evidenceId, text, basisEventIds };
  });
}

function normalizeClearFields(
  value: unknown,
  allowed: readonly string[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("清除字段需要使用列表。");
  if (value.length > allowed.length) throw new Error("清除字段数量无效。");
  const fields = value.map((item) => {
    if (typeof item !== "string" || !allowed.includes(item)) throw new Error("清除字段无效。");
    return item;
  });
  if (new Set(fields).size !== fields.length) throw new Error("清除字段不能重复。");
  return fields;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function appendEvidence(
  previous: WorkOverviewEvidence[] | undefined,
  patch: WorkOverviewEvidence[] | undefined,
): WorkOverviewEvidence[] {
  if (patch === undefined) return previous ?? [];
  if (patch.length === 0) return [];
  const byId = new Map<string, WorkOverviewEvidence>();
  for (const item of previous ?? []) byId.set(item.evidenceId, item);
  for (const item of patch) {
    if (!byId.has(item.evidenceId)) byId.set(item.evidenceId, item);
  }
  return [...byId.values()].slice(-WORK_OVERVIEW_LIMITS.listLength);
}

export function normalizeWorkOverviewPatch(input: unknown): NormalizeWorkOverviewPatchResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "请提供要更新的工作概览。" };
  }

  try {
    const raw = input as Record<string, unknown>;
    if (Object.keys(raw).some((field) => !PATCH_FIELDS.has(field))) {
      throw new Error("工作概览包含不支持的字段。");
    }
    if (!WORK_OVERVIEW_UPDATE_REASONS.includes(raw.updateReason as WorkOverviewUpdateReason)) {
      throw new Error("更新原因无效。");
    }

    let userVisibleCharacters = 0;
    const countText = (text: string) => {
      userVisibleCharacters += text.length;
    };
    const objective = normalizeOptionalText(raw.objective, "目标", WORK_OVERVIEW_LIMITS.objective);
    const currentPhase = normalizeOptionalText(raw.currentPhase, "当前阶段", WORK_OVERVIEW_LIMITS.phase);
    const currentFocus = normalizeOptionalText(raw.currentFocus, "当前重点", WORK_OVERVIEW_LIMITS.focus);
    if (objective) countText(objective);
    if (currentPhase) countText(currentPhase);
    if (currentFocus) countText(currentFocus);

    const successCriteria = normalizeTextList(raw.successCriteria, "完成标准", countText);
    const nextKnown = normalizeTextList(raw.nextKnown, "已知下一步", countText);
    const blockers = normalizeTextList(raw.blockers, "阻碍", countText);
    const decisions = normalizeEvidenceList(raw.decisions, "决定", countText);
    const completedHighlights = normalizeEvidenceList(raw.completedHighlights, "已完成成果", countText);
    const clearFields = normalizeClearFields(raw.clearFields, PATCH_CLEAR_FIELDS) as WorkOverviewPatch["clearFields"];
    const basisEventIds = normalizeIdList(raw.basisEventIds, "事件来源");

    if (userVisibleCharacters > WORK_OVERVIEW_LIMITS.userVisibleCharacters) {
      throw new Error("工作概览过长，请只保留必要概括。 ");
    }
    const hasSemanticChange = objective !== undefined
      || currentPhase !== undefined
      || currentFocus !== undefined
      || successCriteria !== undefined
      || nextKnown !== undefined
      || blockers !== undefined
      || decisions !== undefined
      || completedHighlights !== undefined
      || (clearFields?.length ?? 0) > 0;
    if (!hasSemanticChange) throw new Error("请至少更新一项有实际变化的工作概览。");

    return {
      ok: true,
      value: {
        ...(objective === undefined ? {} : { objective }),
        ...(successCriteria === undefined ? {} : { successCriteria }),
        ...(currentPhase === undefined ? {} : { currentPhase }),
        ...(currentFocus === undefined ? {} : { currentFocus }),
        ...(nextKnown === undefined ? {} : { nextKnown }),
        ...(blockers === undefined ? {} : { blockers }),
        ...(decisions === undefined ? {} : { decisions }),
        ...(completedHighlights === undefined ? {} : { completedHighlights }),
        ...(clearFields === undefined ? {} : { clearFields }),
        updateReason: raw.updateReason as WorkOverviewUpdateReason,
        ...(basisEventIds === undefined ? {} : { basisEventIds }),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "工作概览格式无效。" };
  }
}

export function applyWorkOverviewPatch(
  previous: WorkOverviewSnapshot | undefined,
  patch: WorkOverviewPatch,
  metadata: WorkOverviewPatchMetadata,
): WorkOverviewSnapshot {
  const normalized = normalizeWorkOverviewPatch(patch);
  if (!normalized.ok) throw new Error(normalized.error);
  patch = normalized.value;
  const objectiveUserOwned = previous?.fieldAuthority.objective === "user";
  const criteriaUserOwned = previous?.fieldAuthority.successCriteria === "user";
  const clearFields = new Set(patch.clearFields ?? []);
  const fieldAuthority = { ...(previous?.fieldAuthority ?? {}) };
  const next: WorkOverviewSnapshot = {
    revision: (previous?.revision ?? 0) + 1,
    scopeConversationId: metadata.scopeConversationId,
    sourceRunId: metadata.sourceRunId,
    sourceToolUseId: metadata.toolUseId,
    updatedAt: metadata.updatedAt,
    updateReason: patch.updateReason,
    basisEventIds: uniqueIds([metadata.sourceRunId, metadata.toolUseId, ...(patch.basisEventIds ?? [])]),
    actor: metadata.actor,
    successCriteria: criteriaUserOwned
      ? previous?.successCriteria ?? []
      : patch.successCriteria ?? previous?.successCriteria ?? [],
    nextKnown: patch.nextKnown ?? previous?.nextKnown ?? [],
    blockers: patch.blockers ?? previous?.blockers ?? [],
    decisions: appendEvidence(previous?.decisions, patch.decisions),
    completedHighlights: appendEvidence(previous?.completedHighlights, patch.completedHighlights),
    fieldAuthority,
  };

  if (previous?.objective !== undefined) next.objective = previous.objective;
  if (previous?.objectiveSource !== undefined) next.objectiveSource = previous.objectiveSource;
  if (previous?.currentPhase !== undefined) next.currentPhase = previous.currentPhase;
  if (previous?.currentFocus !== undefined) next.currentFocus = previous.currentFocus;

  if (!objectiveUserOwned) {
    if (clearFields.has("objective")) {
      delete next.objective;
      delete next.objectiveSource;
      delete fieldAuthority.objective;
    } else if (patch.objective !== undefined) {
      next.objective = patch.objective;
      next.objectiveSource = "semantic";
      fieldAuthority.objective = "momo";
    }
  }
  if (clearFields.has("currentPhase")) delete next.currentPhase;
  else if (patch.currentPhase !== undefined) next.currentPhase = patch.currentPhase;
  if (clearFields.has("currentFocus")) delete next.currentFocus;
  else if (patch.currentFocus !== undefined) next.currentFocus = patch.currentFocus;
  if (!criteriaUserOwned && patch.successCriteria !== undefined) fieldAuthority.successCriteria = "momo";

  return next;
}

export function applyUserWorkOverviewCorrection(
  previous: WorkOverviewSnapshot | undefined,
  correction: WorkOverviewUserCorrection,
  metadata: WorkOverviewUserCorrectionMetadata,
): WorkOverviewSnapshot {
  const clearFields = new Set(normalizeClearFields(correction.clearFields, USER_CORRECTION_CLEAR_FIELDS) ?? []);
  const objective = correction.objective === undefined
    ? undefined
    : normalizeRequiredText(correction.objective, "目标", WORK_OVERVIEW_LIMITS.objective) ?? undefined;
  const successCriteria = correction.successCriteria === undefined
    ? undefined
    : normalizeTextList(correction.successCriteria, "完成标准", () => {}) ?? [];
  const next: WorkOverviewSnapshot = {
    revision: (previous?.revision ?? 0) + 1,
    scopeConversationId: metadata.scopeConversationId,
    sourceRunId: "",
    sourceToolUseId: "",
    updatedAt: metadata.updatedAt,
    updateReason: "user-correction",
    basisEventIds: [metadata.correctionId],
    actor: "user",
    successCriteria: successCriteria ?? previous?.successCriteria ?? [],
    nextKnown: previous?.nextKnown ?? [],
    blockers: previous?.blockers ?? [],
    decisions: previous?.decisions ?? [],
    completedHighlights: previous?.completedHighlights ?? [],
    fieldAuthority: { ...(previous?.fieldAuthority ?? {}) },
  };
  if (previous?.objective !== undefined) next.objective = previous.objective;
  if (previous?.objectiveSource !== undefined) next.objectiveSource = previous.objectiveSource;
  if (previous?.currentPhase !== undefined) next.currentPhase = previous.currentPhase;
  if (previous?.currentFocus !== undefined) next.currentFocus = previous.currentFocus;

  if (clearFields.has("objective")) {
    delete next.objective;
    delete next.objectiveSource;
    next.fieldAuthority.objective = "user";
  } else if (objective !== undefined) {
    next.objective = objective;
    next.objectiveSource = "semantic";
    next.fieldAuthority.objective = "user";
  }
  if (clearFields.has("successCriteria")) {
    next.successCriteria = [];
    next.fieldAuthority.successCriteria = "user";
  } else if (successCriteria !== undefined) {
    next.fieldAuthority.successCriteria = "user";
  }
  return next;
}

export function migrateLegacyWorkOverview(
  legacy: WorkOverviewData | null | undefined,
  metadata: WorkOverviewLegacyMigrationMetadata,
): WorkOverviewSnapshot | null {
  if (!legacy) return null;
  const legacyText = (value: string | undefined, limit: number) => {
    const text = value?.trim();
    return text && text.length <= limit ? text : undefined;
  };
  const objective = legacyText(legacy.theme, WORK_OVERVIEW_LIMITS.objective);
  const currentPhase = legacyText(legacy.currentPosition, WORK_OVERVIEW_LIMITS.phase)
    || legacyText(legacy.summary, WORK_OVERVIEW_LIMITS.phase);
  const currentFocus = legacyText(legacy.focus, WORK_OVERVIEW_LIMITS.focus);
  const nextStep = legacyText(legacy.nextStep, WORK_OVERVIEW_LIMITS.listEntry);
  if (!objective && !currentPhase && !currentFocus && !nextStep) return null;

  return {
    revision: 1,
    scopeConversationId: metadata.scopeConversationId,
    sourceRunId: "",
    sourceToolUseId: "",
    updatedAt: metadata.updatedAt,
    updateReason: "legacy-migration",
    basisEventIds: [],
    actor: "legacy",
    ...(objective ? { objective, objectiveSource: "legacy-title" as const } : {}),
    successCriteria: [],
    ...(currentPhase ? { currentPhase } : {}),
    ...(currentFocus ? { currentFocus } : {}),
    ...(nextStep ? { nextKnown: [nextStep] } : { nextKnown: [] }),
    blockers: [],
    decisions: [],
    completedHighlights: [],
    fieldAuthority: objective ? { objective: "legacy" } : {},
  };
}

export interface WorkOverviewData {
  theme?: string;
  summary?: string;
  currentPosition?: string;
  nextStep?: string;
  focus?: string;
}
export type WorkOverviewField = keyof WorkOverviewData;

const FIELD_LIMITS: Record<WorkOverviewField, number> = {
  theme: 80,
  summary: 280,
  currentPosition: 160,
  nextStep: 160,
  focus: 160,
};

const FIELD_LABELS: Record<WorkOverviewField, string> = {
  theme: "主题",
  summary: "概括",
  currentPosition: "当前位置",
  nextStep: "下一步",
  focus: "关注重点",
};

export type NormalizeWorkOverviewResult =
  | { ok: true; value: WorkOverviewData }
  | { ok: false; error: string };

/** One validation source is shared by the MCP handler and the renderer fold.
 * This keeps a successful tool receipt from ever becoming different metadata
 * after restart hydration. Unknown keys are deliberately ignored. */
export function normalizeWorkOverviewInput(input: unknown): NormalizeWorkOverviewResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "请提供要更新的工作概览。" };
  }

  const raw = input as Record<string, unknown>;
  const value: WorkOverviewData = {};
  for (const field of Object.keys(FIELD_LIMITS) as WorkOverviewField[]) {
    const candidate = raw[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== "string") {
      return { ok: false, error: `${FIELD_LABELS[field]}需要使用文字。` };
    }
    const trimmed = candidate.trim();
    if (!trimmed) return { ok: false, error: `${FIELD_LABELS[field]}不能为空。` };
    if (trimmed.length > FIELD_LIMITS[field]) {
      return { ok: false, error: `${FIELD_LABELS[field]}过长，请只保留必要概括。` };
    }
    value[field] = trimmed;
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: "请至少更新主题、概括、当前位置、下一步或关注重点中的一项。" };
  }
  return { ok: true, value };
}
