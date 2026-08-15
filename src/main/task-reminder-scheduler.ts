import type { UserTask } from "../tasks";
import type { TaskAdminService } from "./task-admin";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface TaskReminderSchedulerDeps {
  admin: Pick<TaskAdminService, "listTasks" | "updateTask">;
  onReminder(task: UserTask): void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  onError?: (error: unknown) => void;
}

export interface TaskReminderScheduler {
  start(): void;
  refresh(): void;
  stop(): void;
}

const MAX_TIMER_DELAY_MS = 2_147_000_000;

/**
 * One-shot local reminders for user-authored tasks. A due reminder is cleared
 * through the same TaskAdmin used by the UI before it is presented. That small
 * durable state change prevents an already delivered reminder from firing
 * again after Leemo restarts without adding a second reminder database.
 */
export function createTaskReminderScheduler(
  deps: TaskReminderSchedulerDeps,
): TaskReminderScheduler {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const settledRevisions = new Set<string>();
  let timer: TimerHandle | null = null;
  let started = false;

  const keyFor = (task: UserTask): string => `${task.id}:${task.revision}`;

  const clear = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const pendingTasks = (): UserTask[] => deps.admin.listTasks()
    .filter((task) => task.status === "open" && task.reminderAt !== null)
    .filter((task) => !settledRevisions.has(keyFor(task)))
    .sort((left, right) => (left.reminderAt ?? Infinity) - (right.reminderAt ?? Infinity));

  const arm = (): void => {
    clear();
    if (!started) return;
    const next = pendingTasks()[0];
    if (!next || next.reminderAt === null) return;
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, next.reminderAt - now()));
    timer = setTimer(fireDue, delay);
  };

  function fireDue(): void {
    timer = null;
    if (!started) return;
    const current = now();
    const due = pendingTasks().filter(
      (task) => task.reminderAt !== null && task.reminderAt <= current,
    );
    for (const task of due) {
      settledRevisions.add(keyFor(task));
      try {
        deps.admin.updateTask({
          id: task.id,
          expectedRevision: task.revision,
          reminderAt: null,
        });
        deps.onReminder({ ...task });
      } catch (error: unknown) {
        deps.onError?.(error);
      }
    }
    arm();
  }

  return {
    start() {
      if (started) return;
      started = true;
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
