import { describe, expect, it, vi } from "vitest";
import { createScheduledTaskAdmin } from "../../src/main/scheduled-task-admin";
import type { Persistence } from "../../src/main/persistence/schema";
import type { ScheduledTask, ScheduledTaskRun } from "../../src/scheduled-tasks";

function harness() {
  const tasks = new Map<string, ScheduledTask>();
  const runs = new Map<string, ScheduledTaskRun>();
  const persistence = {
    listScheduledTasks: () => [...tasks.values()],
    getScheduledTask: (id: string) => tasks.get(id),
    saveScheduledTask: (task: ScheduledTask) => tasks.set(task.id, task),
    deleteScheduledTask: (id: string) => { tasks.delete(id); },
    listScheduledTaskRuns: (taskId?: string) => [...runs.values()].filter((run) => !taskId || run.taskId === taskId),
    getScheduledTaskRun: (id: string) => runs.get(id),
    saveScheduledTaskRun: (run: ScheduledTaskRun) => runs.set(run.id, run),
    claimScheduledTaskRun: vi.fn(),
    completeScheduledTaskRun: vi.fn(),
  } as unknown as Persistence;
  const refresh = vi.fn();
  const resolveWorkspace = vi.fn((id: string) => ({ id }));
  const ids = ["task-1", "run-1", "run-2"];
  const now = new Date(2026, 7, 6, 10, 0).getTime();
  const admin = createScheduledTaskAdmin({
    persistence,
    resolveWorkspace,
    refresh,
    now: () => now,
    timezone: () => "Asia/Tokyo",
    randomId: () => ids.shift() ?? "fallback",
  });
  return { admin, tasks, runs, refresh, resolveWorkspace, now };
}

describe("scheduled-task admin", () => {
  it("owns create, update, pause, and delete semantics for both UI and momo", () => {
    const { admin, tasks, refresh, resolveWorkspace } = harness();
    const task = admin.create({
      prompt: "整理今天的学习记录",
      schedule: { kind: "daily", hour: 20, minute: 30 },
      workspaceId: "book-math",
    });

    expect(task.id).toBe("task-1");
    expect(tasks.get(task.id)).toEqual(task);
    expect(resolveWorkspace).toHaveBeenCalledWith("book-math");

    const updated = admin.update(task.id, { prompt: "整理记录并生成明日计划" });
    expect(updated).toMatchObject({
      name: "整理记录并生成明日计划",
      prompt: "整理记录并生成明日计划",
      schedule: { kind: "daily", hour: 20, minute: 30 },
      workspaceId: "book-math",
    });
    expect(admin.setPaused(task.id, true).status).toBe("paused");
    expect(admin.setPaused(task.id, false).status).toBe("active");
    admin.delete(task.id);
    expect(tasks.has(task.id)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("queues one immediate run and rejects duplicate active work", () => {
    const { admin, runs } = harness();
    const task = admin.create({
      prompt: "整理文件",
      schedule: { kind: "daily", hour: 20, minute: 30 },
      workspaceId: "leemo-home",
    });

    expect(admin.runNow(task.id)).toMatchObject({ id: "run-1", taskId: task.id, status: "queued" });
    expect(runs.get("run-1")?.status).toBe("queued");
    expect(() => admin.runNow(task.id)).toThrow("已经在运行");
    expect(() => admin.update(task.id, { name: "新名字" })).toThrow("运行时不能修改");
    expect(() => admin.delete(task.id)).toThrow("运行时不能删除");
  });
});
