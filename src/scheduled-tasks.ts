export type ScheduledTaskSchedule =
  | { kind: "once"; runAt: number }
  | { kind: "daily"; hour: number; minute: number }
  | {
    kind: "weekly";
    hour: number;
    minute: number;
    /** New records use `weekdays`; `weekday` keeps older saved tasks readable. */
    weekdays?: number[];
    weekday?: number;
  }
  | { kind: "monthly"; day: number; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekends"; hour: number; minute: number };

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

function isClock(schedule: Record<string, unknown>): boolean {
  return Number.isInteger(schedule.hour)
    && Number(schedule.hour) >= 0
    && Number(schedule.hour) <= 23
    && Number.isInteger(schedule.minute)
    && Number(schedule.minute) >= 0
    && Number(schedule.minute) <= 59;
}

function isWeekday(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

export function weekdaysForWeeklySchedule(
  schedule: Extract<ScheduledTaskSchedule, { kind: "weekly" }>,
): number[] {
  const values = Array.isArray(schedule.weekdays)
    ? schedule.weekdays
    : isWeekday(schedule.weekday)
      ? [schedule.weekday]
      : [];
  return [...new Set(values)].filter(isWeekday).sort((left, right) => left - right);
}

function cloneSchedule(schedule: ScheduledTaskSchedule): ScheduledTaskSchedule {
  if (schedule.kind !== "weekly") return { ...schedule };
  return {
    kind: "weekly",
    weekdays: weekdaysForWeeklySchedule(schedule),
    hour: schedule.hour,
    minute: schedule.minute,
  };
}

export function isScheduledTaskSchedule(value: unknown): value is ScheduledTaskSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Record<string, unknown>;
  if (schedule.kind === "once") {
    return typeof schedule.runAt === "number" && Number.isFinite(schedule.runAt);
  }
  if (schedule.kind === "daily" || schedule.kind === "weekdays" || schedule.kind === "weekends") {
    return isClock(schedule);
  }
  if (schedule.kind === "weekly") {
    const selected = Array.isArray(schedule.weekdays)
      ? schedule.weekdays
      : schedule.weekday === undefined
        ? []
        : [schedule.weekday];
    return isClock(schedule)
      && selected.length > 0
      && selected.length <= 7
      && selected.every(isWeekday)
      && new Set(selected).size === selected.length;
  }
  if (schedule.kind === "monthly") {
    return isClock(schedule)
      && Number.isInteger(schedule.day)
      && Number(schedule.day) >= 1
      && Number(schedule.day) <= 31;
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

  if (schedule.kind === "monthly") {
    if (!Number.isInteger(schedule.day) || schedule.day < 1 || schedule.day > 31) {
      throw new Error("每月日期必须在 1 到 31 之间。");
    }
    for (let offset = 0; offset < 24; offset += 1) {
      const month = new Date(base.getFullYear(), base.getMonth() + offset, 1);
      const monthly = new Date(
        month.getFullYear(),
        month.getMonth(),
        schedule.day,
        schedule.hour,
        schedule.minute,
        0,
        0,
      );
      if (monthly.getMonth() !== month.getMonth()) continue;
      if (monthly.getTime() > after) return monthly.getTime();
    }
    throw new Error("无法计算下一次每月运行时间。");
  }

  const selected = schedule.kind === "weekly"
    ? weekdaysForWeeklySchedule(schedule)
    : schedule.kind === "weekdays"
      ? [1, 2, 3, 4, 5]
      : [0, 6];
  if (selected.length === 0) throw new Error("请至少选择一个星期。");
  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const occurrence = new Date(candidate);
    occurrence.setDate(candidate.getDate() + daysAhead);
    if (selected.includes(occurrence.getDay()) && occurrence.getTime() > after) {
      return occurrence.getTime();
    }
  }
  throw new Error("无法计算下一次运行时间。");
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
  if (!draft.workspaceId.trim()) throw new Error("请选择结果要放到哪个本子。");
  if (!isScheduledTaskSchedule(draft.schedule)) throw new Error("运行时间不完整，请重新选择。");
  const nextRunAt = nextRunAtForSchedule(draft.schedule, now);
  if (nextRunAt === null) throw new Error("这个时间已经过去，请选择未来的时间。");

  const rawName = (draft.name ?? deriveScheduledTaskName(prompt)).replace(/\s+/g, " ").trim();
  const name = Array.from(rawName || deriveScheduledTaskName(prompt)).slice(0, MAX_NAME_LENGTH).join("");
  const timezone = (draft.timezone ?? fallbackTimezone).trim() || fallbackTimezone;
  return {
    prompt,
    schedule: cloneSchedule(draft.schedule),
    workspaceId: draft.workspaceId.trim(),
    name,
    timezone,
  };
}

export function cloneScheduledTask(task: ScheduledTask): ScheduledTask {
  return { ...task, schedule: cloneSchedule(task.schedule) };
}

export function cloneScheduledTaskRun(run: ScheduledTaskRun): ScheduledTaskRun {
  return { ...run };
}
