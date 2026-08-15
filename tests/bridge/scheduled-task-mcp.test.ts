import { describe, expect, it, vi } from "vitest";
import {
  createScheduledTaskMcp,
  type ScheduledTaskAdmin,
} from "../../src/bridge/scheduled-task-mcp";
import type { ScheduledTask } from "../../src/scheduled-tasks";

const TASK: ScheduledTask = {
  id: "task-1",
  name: "整理今天的学习记录",
  prompt: "整理今天的学习记录",
  schedule: { kind: "daily", hour: 8, minute: 0 },
  timezone: "Asia/Tokyo",
  nextRunAt: new Date(2026, 7, 7, 8, 0).getTime(),
  workspaceId: "book-math",
  status: "active",
  createdAt: 1,
  updatedAt: 1,
};

function admin(): ScheduledTaskAdmin {
  return {
    list: vi.fn(() => [TASK]),
    create: vi.fn(() => TASK),
    update: vi.fn(() => TASK),
    setPaused: vi.fn((_id, paused) => ({
      ...TASK,
      status: paused ? "paused" as const : "active" as const,
    })),
    delete: vi.fn(),
    runNow: vi.fn(() => ({
      id: "run-1",
      taskId: TASK.id,
      scheduledFor: 1,
      trigger: "manual" as const,
      status: "queued" as const,
      createdAt: 1,
    })),
  };
}

describe("scheduled-task MCP", () => {
  it("creates a recurring task in the current workspace without exposing opaque ids to the user", async () => {
    const service = admin();
    const mcp = createScheduledTaskMcp({ service, workspaceId: "book-math" });

    const result = await mcp.runCreate({
      prompt: "整理今天的学习记录",
      schedule: { kind: "daily", time: "08:00" },
    });

    expect(service.create).toHaveBeenCalledWith({
      prompt: "整理今天的学习记录",
      schedule: { kind: "daily", hour: 8, minute: 0 },
      workspaceId: "book-math",
    });
    expect(result).toMatchObject({ isError: false, text: expect.stringContaining("已创建定时任务") });
    expect(result.text).not.toContain("book-math");
    expect(result.text).not.toContain("task-1");
  });

  it("turns a local calendar time into a one-time occurrence", async () => {
    const service = admin();
    const mcp = createScheduledTaskMcp({ service, workspaceId: "leemo-home" });

    await mcp.runCreate({
      prompt: "提醒我提交简历",
      schedule: { kind: "once", date: "2026-08-07", time: "09:30" },
    });

    expect(service.create).toHaveBeenCalledWith({
      prompt: "提醒我提交简历",
      schedule: { kind: "once", runAt: new Date(2026, 7, 7, 9, 30, 0, 0).getTime() },
      workspaceId: "leemo-home",
    });
  });

  it("parses the supported repeating calendar choices for momo", async () => {
    const service = admin();
    const mcp = createScheduledTaskMcp({ service, workspaceId: "leemo-home" });

    await mcp.runCreate({
      prompt: "周一和周三整理计划",
      schedule: { kind: "weekly", weekdays: [1, 3], time: "08:30" },
    });
    await mcp.runCreate({
      prompt: "每月整理账单",
      schedule: { kind: "monthly", day: 15, time: "20:00" },
    });
    await mcp.runCreate({ prompt: "工作日复盘", schedule: { kind: "weekdays", time: "21:00" } });
    await mcp.runCreate({ prompt: "周末回顾", schedule: { kind: "weekends", time: "10:00" } });

    expect(service.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      schedule: { kind: "weekly", weekdays: [1, 3], hour: 8, minute: 30 },
    }));
    expect(service.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      schedule: { kind: "monthly", day: 15, hour: 20, minute: 0 },
    }));
    expect(service.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
      schedule: { kind: "weekdays", hour: 21, minute: 0 },
    }));
    expect(service.create).toHaveBeenNthCalledWith(4, expect.objectContaining({
      schedule: { kind: "weekends", hour: 10, minute: 0 },
    }));
  });

  it("lists, updates, pauses, runs, and removes tasks through the same service", async () => {
    const service = admin();
    const mcp = createScheduledTaskMcp({ service, workspaceId: "book-math" });

    const listed = await mcp.runList({});
    await mcp.runUpdate({ id: TASK.id, prompt: "整理学习记录并生成明日计划" });
    await mcp.runSetStatus({ id: TASK.id, status: "paused" });
    await mcp.runNow({ id: TASK.id });
    await mcp.runDelete({ id: TASK.id });

    expect(listed.text).toContain("整理今天的学习记录");
    expect(listed.text).toContain("每天 08:00");
    expect(service.update).toHaveBeenCalledWith(TASK.id, { prompt: "整理学习记录并生成明日计划" });
    expect(service.setPaused).toHaveBeenCalledWith(TASK.id, true);
    expect(service.runNow).toHaveBeenCalledWith(TASK.id);
    expect(service.delete).toHaveBeenCalledWith(TASK.id);
  });

  it("returns a concise user-facing error instead of pretending success", async () => {
    const service = admin();
    vi.mocked(service.create).mockImplementation(() => {
      throw new Error("这个时间已经过去，请选择未来的时间。");
    });
    const mcp = createScheduledTaskMcp({ service, workspaceId: "leemo-home" });

    await expect(mcp.runCreate({
      prompt: "提醒我",
      schedule: { kind: "once", date: "2020-01-01", time: "08:00" },
    })).resolves.toEqual({
      isError: true,
      text: "定时任务没有更新：这个时间已经过去，请选择未来的时间。",
    });
  });
});
