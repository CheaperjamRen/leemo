import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createTaskAdmin } from "../../src/main/task-admin";
import { createTaskPersistence } from "../../src/main/persistence/task-persistence";
import { createTaskReminderScheduler } from "../../src/main/task-reminder-scheduler";

function createHarness(initialNow: number) {
  let current = initialNow;
  let nextId = 1;
  const admin = createTaskAdmin({
    persistence: createTaskPersistence(new Database(":memory:")),
    now: () => current,
    randomId: () => `task-${nextId++}`,
  });
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  const onReminder = vi.fn();
  const scheduler = createTaskReminderScheduler({
    admin,
    now: () => current,
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (timer) => cleared.push(timer),
    onReminder,
  });
  return {
    admin,
    timers,
    cleared,
    onReminder,
    scheduler,
    setNow(value: number) {
      current = value;
    },
  };
}

describe("task reminder scheduler", () => {
  it("notifies an open task when its reminder is due and consumes the one-shot reminder", () => {
    const harness = createHarness(100);
    harness.admin.createTask({ title: "已经完成", status: "done", reminderAt: 120 });
    const due = harness.admin.createTask({ title: "提交简历", reminderAt: 150 });

    harness.scheduler.start();
    expect(harness.timers.at(-1)?.delay).toBe(50);

    harness.setNow(150);
    harness.timers.at(-1)?.callback();

    expect(harness.onReminder).toHaveBeenCalledTimes(1);
    expect(harness.onReminder).toHaveBeenCalledWith(expect.objectContaining({
      id: due.id,
      title: "提交简历",
      revision: 1,
    }));
    expect(harness.admin.listTasks().find((task) => task.id === due.id)).toMatchObject({
      reminderAt: null,
      revision: 2,
    });
  });

  it("does not repeat a consumed reminder after the scheduler restarts", () => {
    const harness = createHarness(200);
    harness.admin.createTask({ title: "复习单词", reminderAt: 150 });

    harness.scheduler.start();
    harness.timers.at(-1)?.callback();
    harness.scheduler.stop();

    const restartedReminder = vi.fn();
    const restartedTimer = vi.fn(() => ({} as ReturnType<typeof setTimeout>));
    const restarted = createTaskReminderScheduler({
      admin: harness.admin,
      now: () => 200,
      setTimer: restartedTimer,
      clearTimer: () => undefined,
      onReminder: restartedReminder,
    });
    restarted.start();

    expect(harness.onReminder).toHaveBeenCalledTimes(1);
    expect(restartedReminder).not.toHaveBeenCalled();
    expect(restartedTimer).not.toHaveBeenCalled();
  });

  it("cancels a pending reminder after the task is completed and refreshed", () => {
    const harness = createHarness(100);
    const task = harness.admin.createTask({ title: "写周报", reminderAt: 300 });
    harness.scheduler.start();
    const pendingTimer = harness.timers.at(-1);

    harness.admin.updateTask({ id: task.id, expectedRevision: task.revision, status: "done" });
    harness.scheduler.refresh();

    expect(harness.cleared).toContain(pendingTimer);
    expect(harness.timers).toHaveLength(1);
  });
});
