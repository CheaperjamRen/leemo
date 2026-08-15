import { describe, expect, it } from "vitest";
import {
  deriveScheduledTaskName,
  isScheduledTaskSchedule,
  nextRunAtForSchedule,
  normalizeScheduledTaskDraft,
} from "../../src/scheduled-tasks";

describe("scheduled task calendar", () => {
  it("keeps a future one-time occurrence and completes after it", () => {
    expect(nextRunAtForSchedule({ kind: "once", runAt: 2_000 }, 1_000)).toBe(2_000);
    expect(nextRunAtForSchedule({ kind: "once", runAt: 2_000 }, 2_000)).toBeNull();
  });

  it("moves daily schedules to tomorrow after today's clock time", () => {
    const before = new Date(2026, 6, 31, 7, 30).getTime();
    const after = new Date(2026, 6, 31, 8, 30).getTime();
    expect(nextRunAtForSchedule({ kind: "daily", hour: 8, minute: 0 }, before))
      .toBe(new Date(2026, 6, 31, 8, 0).getTime());
    expect(nextRunAtForSchedule({ kind: "daily", hour: 8, minute: 0 }, after))
      .toBe(new Date(2026, 7, 1, 8, 0).getTime());
  });

  it("finds the next weekly wall-clock occurrence", () => {
    const friday = new Date(2026, 6, 31, 9, 0);
    expect(nextRunAtForSchedule({ kind: "weekly", weekday: 1, hour: 8, minute: 15 }, friday.getTime()))
      .toBe(new Date(2026, 7, 3, 8, 15).getTime());
    expect(nextRunAtForSchedule({ kind: "weekly", weekday: 5, hour: 8, minute: 0 }, friday.getTime()))
      .toBe(new Date(2026, 7, 7, 8, 0).getTime());
  });

  it("finds the next selected weekday, month day, workday, and weekend", () => {
    const friday = new Date(2026, 6, 31, 9, 0).getTime();

    expect(nextRunAtForSchedule({ kind: "weekly", weekdays: [1, 3], hour: 8, minute: 15 }, friday))
      .toBe(new Date(2026, 7, 3, 8, 15).getTime());
    expect(nextRunAtForSchedule({ kind: "monthly", day: 31, hour: 8, minute: 0 }, friday))
      .toBe(new Date(2026, 7, 31, 8, 0).getTime());
    expect(nextRunAtForSchedule({ kind: "weekdays", hour: 8, minute: 0 }, friday))
      .toBe(new Date(2026, 7, 3, 8, 0).getTime());
    expect(nextRunAtForSchedule({ kind: "weekends", hour: 8, minute: 0 }, friday))
      .toBe(new Date(2026, 7, 1, 8, 0).getTime());

    expect(isScheduledTaskSchedule({ kind: "weekly", weekdays: [], hour: 8, minute: 0 })).toBe(false);
    expect(isScheduledTaskSchedule({ kind: "weekly", weekdays: [1, 3], hour: 8, minute: 0 })).toBe(true);
  });

  it("derives a quiet name and validates the three user inputs", () => {
    expect(deriveScheduledTaskName("  给我一份 10 分钟英语练习。重点复习口语  "))
      .toBe("给我一份 10 分钟英语练习");
    expect(normalizeScheduledTaskDraft({
      prompt: "  整理今天的英语错题  ",
      workspaceId: "leemo-home",
      schedule: { kind: "daily", hour: 20, minute: 30 },
    }, new Date(2026, 6, 31, 10).getTime(), "Asia/Tokyo")).toMatchObject({
      prompt: "整理今天的英语错题",
      name: "整理今天的英语错题",
      workspaceId: "leemo-home",
      timezone: "Asia/Tokyo",
    });
  });

  it("rejects empty work and past one-time schedules in user language", () => {
    expect(() => normalizeScheduledTaskDraft({
      prompt: " ",
      workspaceId: "leemo-home",
      schedule: { kind: "daily", hour: 8, minute: 0 },
    }, 1_000, "UTC")).toThrow("先写下要让 momo 做什么");
    expect(() => normalizeScheduledTaskDraft({
      prompt: "提醒我",
      workspaceId: "leemo-home",
      schedule: { kind: "once", runAt: 999 },
    }, 1_000, "UTC")).toThrow("这个时间已经过去");
    expect(() => normalizeScheduledTaskDraft({
      prompt: "整理学习记录",
      workspaceId: " ",
      schedule: { kind: "daily", hour: 8, minute: 0 },
    }, 1_000, "UTC")).toThrow("请选择结果要放到哪个本子");
  });
});
