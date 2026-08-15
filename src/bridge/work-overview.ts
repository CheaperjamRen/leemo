export const LEEMO_WORK_OVERVIEW_TOOL = "mcp__leemo-work-overview__set_work_overview";

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
