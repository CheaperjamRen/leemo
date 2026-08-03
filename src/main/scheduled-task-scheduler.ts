import { randomUUID } from "node:crypto";
import type { Persistence } from "./persistence/schema";
import {
  cloneScheduledTask,
  cloneScheduledTaskRun,
  nextRunAtForSchedule,
  type ScheduledTask,
  type ScheduledTaskDueEvent,
  type ScheduledTaskRun,
} from "../scheduled-tasks";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ScheduledTaskSchedulerDeps {
  persistence: Pick<
    Persistence,
    | "listScheduledTasks"
    | "listScheduledTaskRuns"
    | "queueScheduledOccurrence"
    | "markStaleScheduledRunsMissed"
  >;
  onDue(event: ScheduledTaskDueEvent): void;
  now?: () => number;
  makeId?: () => string;
  setTimer?: (fn: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

export interface ScheduledTaskScheduler {
  /** Recovers the previous process and starts the local clock. */
  start(): void;
  /** Re-arm after a task is created, edited, paused, or removed. */
  refresh(): void;
  stop(): void;
}

const MAX_TIMER_DELAY_MS = 2_147_000_000;

function advancedTask(task: ScheduledTask, scheduledFor: number, now: number): ScheduledTask {
  const nextRunAt = nextRunAtForSchedule(task.schedule, Math.max(scheduledFor, now));
  return {
    ...cloneScheduledTask(task),
    nextRunAt,
    status: nextRunAt === null ? "completed" : task.status,
    lastRunAt: scheduledFor,
    updatedAt: now,
  };
}

function makeRun(
  task: ScheduledTask,
  status: "queued" | "missed",
  now: number,
  makeId: () => string,
  error?: string,
): ScheduledTaskRun {
  return {
    id: makeId(),
    taskId: task.id,
    scheduledFor: task.nextRunAt ?? now,
    trigger: "scheduled",
    status,
    ...(status === "missed" ? { completedAt: now } : {}),
    ...(error ? { error } : {}),
    createdAt: now,
  };
}

export function createScheduledTaskScheduler(deps: ScheduledTaskSchedulerDeps): ScheduledTaskScheduler {
  const now = deps.now ?? Date.now;
  const makeId = deps.makeId ?? randomUUID;
  const setTimer = deps.setTimer ?? ((fn, delayMs) => setTimeout(fn, delayMs));
  const clearTimer = deps.clearTimer ?? clearTimeout;
  let timer: TimerHandle | null = null;
  let started = false;

  const clear = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const activeRunTaskIds = (): Set<string> => new Set(
    deps.persistence.listScheduledTaskRuns(undefined, 500)
      .filter((run) => run.status === "queued" || run.status === "running")
      .map((run) => run.taskId),
  );

  const arm = (): void => {
    clear();
    if (!started) return;
    const current = now();
    const next = deps.persistence.listScheduledTasks()
      .filter((task) => task.status === "active" && task.nextRunAt !== null)
      .sort((left, right) => (left.nextRunAt ?? Infinity) - (right.nextRunAt ?? Infinity))[0];
    if (!next?.nextRunAt) return;
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, next.nextRunAt - current));
    timer = setTimer(fireDue, delay);
  };

  const queueOccurrence = (
    task: ScheduledTask,
    status: "queued" | "missed",
    current: number,
    error?: string,
  ): ScheduledTaskRun => {
    const scheduledFor = task.nextRunAt ?? current;
    const run = makeRun(task, status, current, makeId, error);
    deps.persistence.queueScheduledOccurrence(advancedTask(task, scheduledFor, current), run);
    return cloneScheduledTaskRun(run);
  };

  function fireDue(): void {
    timer = null;
    if (!started) return;
    const current = now();
    const busy = activeRunTaskIds();
    const due = deps.persistence.listScheduledTasks()
      .filter((task) => task.status === "active" && task.nextRunAt !== null && task.nextRunAt <= current)
      .sort((left, right) => (left.nextRunAt ?? 0) - (right.nextRunAt ?? 0));
    for (const task of due) {
      if (busy.has(task.id)) {
        queueOccurrence(task, "missed", current, "上一次运行还没有结束，这次没有重复启动");
        continue;
      }
      const run = queueOccurrence(task, "queued", current);
      deps.onDue({ taskId: task.id, runId: run.id });
      busy.add(task.id);
    }
    arm();
  }

  function recoverStartup(): void {
    const current = now();
    deps.persistence.markStaleScheduledRunsMissed(current);
    const overdue = deps.persistence.listScheduledTasks()
      .filter((task) => task.status === "active" && task.nextRunAt !== null && task.nextRunAt <= current)
      .sort((left, right) => (left.nextRunAt ?? 0) - (right.nextRunAt ?? 0));
    // One honest record per task is enough. Advancing from `current` skips a
    // backlog of daily occurrences instead of flooding the user after a week.
    for (const task of overdue) {
      queueOccurrence(task, "missed", current, "Leemo 退出期间错过了这次运行");
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      recoverStartup();
      arm();
    },
    refresh() {
      arm();
    },
    stop() {
      started = false;
      clear();
    },
  };
}
