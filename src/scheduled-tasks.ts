export type ScheduledTaskSchedule =
  | { kind: "once"; runAt: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number };

export type ScheduledTaskStatus = "active" | "paused" | "completed";
export type ScheduledTaskRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "missed"
  | "skipped";
export type ScheduledTaskRunTrigger = "scheduled" | "manual" | "catch-up";

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: ScheduledTaskSchedule;
  /** Informational in v1: schedules follow the device's local clock. */
  timezone: string;
  nextRunAt: number | null;
  workspaceId: string;
  status: ScheduledTaskStatus;
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
}

export interface ScheduledTaskDraft {
  prompt: string;
  schedule: ScheduledTaskSchedule;
  workspaceId: string;
  timezone?: string;
  name?: string;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  scheduledFor: number;
  trigger: ScheduledTaskRunTrigger;
  status: ScheduledTaskRunStatus;
  conversationId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  createdAt: number;
}

export interface ScheduledTaskSnapshot {
  tasks: ScheduledTask[];
  runs: ScheduledTaskRun[];
}

export interface ScheduledTaskDueEvent {
  taskId: string;
  runId: string;
}

const MAX_PROMPT_LENGTH = 20_000;
const MAX_NAME_LENGTH = 48;

function assertClock(hour: number, minute: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("小时必须在 0 到 23 之间。");
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("分钟必须在 0 到 59 之间。");
  }
}

export function isScheduledTaskSchedule(value: unknown): value is ScheduledTaskSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Record<string, unknown>;
  if (schedule.kind === "once") {
    return typeof schedule.runAt === "number" && Number.isFinite(schedule.runAt);
  }
  if (schedule.kind === "daily") {
    return Number.isInteger(schedule.hour)
      && Number(schedule.hour) >= 0
      && Number(schedule.hour) <= 23
      && Number.isInteger(schedule.minute)
      && Number(schedule.minute) >= 0
      && Number(schedule.minute) <= 59;
  }
  if (schedule.kind === "weekly") {
    return Number.isInteger(schedule.weekday)
      && Number(schedule.weekday) >= 0
      && Number(schedule.weekday) <= 6
      && Number.isInteger(schedule.hour)
      && Number(schedule.hour) >= 0
      && Number(schedule.hour) <= 23
      && Number.isInteger(schedule.minute)
      && Number(schedule.minute) >= 0
      && Number(schedule.minute) <= 59;
  }
  return false;
}

/** Return the first occurrence strictly after `after`. Recurring schedules use
 * the device's local calendar so "每天 08:00" follows the user's wall clock. */
export function nextRunAtForSchedule(schedule: ScheduledTaskSchedule, after: number): number | null {
  if (!Number.isFinite(after)) throw new Error("无法计算下一次运行时间。");
  if (schedule.kind === "once") return schedule.runAt > after ? schedule.runAt : null;
  assertClock(schedule.hour, schedule.minute);

  const base = new Date(after);
  const candidate = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    schedule.hour,
    schedule.minute,
    0,
    0,
  );
  if (schedule.kind === "daily") {
    if (candidate.getTime() <= after) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }

  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) {
    throw new Error("星期必须在 0 到 6 之间。");
  }
  let daysAhead = (schedule.weekday - candidate.getDay() + 7) % 7;
  if (daysAhead === 0 && candidate.getTime() <= after) daysAhead = 7;
  candidate.setDate(candidate.getDate() + daysAhead);
  return candidate.getTime();
}

export function deriveScheduledTaskName(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  const firstClause = clean.split(/[。！？!?；;\n]/, 1)[0]?.trim() ?? "";
  return Array.from(firstClause || clean || "定时任务").slice(0, 28).join("");
}

export function normalizeScheduledTaskDraft(
  draft: ScheduledTaskDraft,
  now: number,
  fallbackTimezone: string,
): ScheduledTaskDraft & { name: string; timezone: string } {
  const prompt = draft.prompt.replace(/\r\n/g, "\n").trim();
  if (!prompt) throw new Error("先写下要让 momo 做什么。");
  if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("任务内容太长，请缩短后再保存。");
  if (!draft.workspaceId.trim()) throw new Error("请选择结果要放到哪个工作区。");
  if (!isScheduledTaskSchedule(draft.schedule)) throw new Error("运行时间不完整，请重新选择。");
  const nextRunAt = nextRunAtForSchedule(draft.schedule, now);
  if (nextRunAt === null) throw new Error("这个时间已经过去，请选择未来的时间。");

  const rawName = (draft.name ?? deriveScheduledTaskName(prompt)).replace(/\s+/g, " ").trim();
  const name = Array.from(rawName || deriveScheduledTaskName(prompt)).slice(0, MAX_NAME_LENGTH).join("");
  const timezone = (draft.timezone ?? fallbackTimezone).trim() || fallbackTimezone;
  return {
    prompt,
    schedule: { ...draft.schedule },
    workspaceId: draft.workspaceId.trim(),
    name,
    timezone,
  };
}

export function cloneScheduledTask(task: ScheduledTask): ScheduledTask {
  return { ...task, schedule: { ...task.schedule } };
}

export function cloneScheduledTaskRun(run: ScheduledTaskRun): ScheduledTaskRun {
  return { ...run };
}
