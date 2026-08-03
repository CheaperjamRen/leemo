import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { createPersistence } from "../../src/main/persistence/schema";
import { createScheduledTaskScheduler } from "../../src/main/scheduled-task-scheduler";
import type { ScheduledTask } from "../../src/scheduled-tasks";

function dailyTask(nextRunAt: number): ScheduledTask {
  return {
    id: "task-1",
    name: "每日英语练习",
    prompt: "给我一份 10 分钟英语练习",
    schedule: { kind: "daily", hour: new Date(nextRunAt).getHours(), minute: new Date(nextRunAt).getMinutes() },
    timezone: "local",
    nextRunAt,
    workspaceId: "leemo-home",
    status: "active",
    createdAt: nextRunAt - 1_000,
    updatedAt: nextRunAt - 1_000,
  };
}

describe("main-process scheduled task clock", () => {
  it("persists a queued occurrence before notifying the renderer", () => {
    const persistence = createPersistence(new Database(":memory:"));
    let current = new Date(2026, 6, 31, 7, 59).getTime();
    const dueAt = new Date(2026, 6, 31, 8, 0).getTime();
    persistence.saveScheduledTask(dailyTask(dueAt));
    let fire: (() => void) | undefined;
    const onDue = vi.fn();
    const scheduler = createScheduledTaskScheduler({
      persistence,
      now: () => current,
      makeId: () => "scheduled-run-1",
      setTimer: (fn) => {
        fire = fn;
        return {} as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
      onDue,
    });

    scheduler.start();
    current = dueAt;
    fire?.();

    expect(persistence.listScheduledTaskRuns()).toEqual([expect.objectContaining({
      id: "scheduled-run-1",
      status: "queued",
      scheduledFor: dueAt,
    })]);
    expect(persistence.getScheduledTask("task-1")?.nextRunAt)
      .toBe(new Date(2026, 7, 1, 8, 0).getTime());
    expect(onDue).toHaveBeenCalledWith({ taskId: "task-1", runId: "scheduled-run-1" });
  });

  it("does not silently catch up work missed while Leemo was closed", () => {
    const persistence = createPersistence(new Database(":memory:"));
    const dueAt = new Date(2026, 6, 30, 8, 0).getTime();
    const current = new Date(2026, 6, 31, 10, 0).getTime();
    persistence.saveScheduledTask(dailyTask(dueAt));
    const onDue = vi.fn();
    const scheduler = createScheduledTaskScheduler({
      persistence,
      now: () => current,
      makeId: () => "missed-run-1",
      setTimer: () => ({} as ReturnType<typeof setTimeout>),
      clearTimer: () => undefined,
      onDue,
    });

    scheduler.start();

    expect(persistence.listScheduledTaskRuns()).toEqual([expect.objectContaining({
      id: "missed-run-1",
      status: "missed",
      error: "Leemo 退出期间错过了这次运行",
    })]);
    expect(persistence.getScheduledTask("task-1")?.nextRunAt)
      .toBe(new Date(2026, 7, 1, 8, 0).getTime());
    expect(onDue).not.toHaveBeenCalled();
  });

  it("marks a second occurrence missed while the previous run is still active", () => {
    const persistence = createPersistence(new Database(":memory:"));
    let current = new Date(2026, 6, 31, 7, 59).getTime();
    const dueAt = new Date(2026, 6, 31, 8, 0).getTime();
    persistence.saveScheduledTask(dailyTask(dueAt));
    persistence.saveScheduledTaskRun({
      id: "already-running",
      taskId: "task-1",
      scheduledFor: dueAt - 86_400_000,
      trigger: "scheduled",
      status: "running",
      createdAt: dueAt - 86_400_000,
      startedAt: dueAt - 86_400_000,
    });
    let fire: (() => void) | undefined;
    const onDue = vi.fn();
    const scheduler = createScheduledTaskScheduler({
      persistence,
      now: () => current,
      makeId: () => "overlap-run",
      setTimer: (fn) => {
        fire = fn;
        return {} as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
      onDue,
    });
    scheduler.start();
    // Startup recovery turns the old process-owned run into missed, so create a
    // new active run to model a long task started during this process.
    persistence.saveScheduledTaskRun({
      id: "active-now",
      taskId: "task-1",
      scheduledFor: dueAt - 1,
      trigger: "manual",
      status: "running",
      createdAt: dueAt - 1,
      startedAt: dueAt - 1,
    });
    current = dueAt;
    fire?.();

    expect(persistence.listScheduledTaskRuns()[0]).toMatchObject({
      id: "overlap-run",
      status: "missed",
      error: "上一次运行还没有结束，这次没有重复启动",
    });
    expect(onDue).not.toHaveBeenCalled();
  });
});
