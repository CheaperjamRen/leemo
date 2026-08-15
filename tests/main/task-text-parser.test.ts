import { describe, expect, it } from "vitest";
import { parseTaskText } from "../../src/task-text-parser";

const NOW = new Date(2026, 7, 3, 10, 0, 0);

describe("待办文本本地解析", () => {
  it("把唯一且明确的自然日期当作计划时间", () => {
    expect(parseTaskText("明天下午3点去图书馆", NOW)).toMatchObject({
      requiresModel: false,
      fields: [{ kind: "planned", date: "2026-08-04", time: "15:00" }],
    });
  });

  it("识别截止时间和相对提醒，不把提醒误当成第二个日期", () => {
    expect(parseTaskText("周五17:00前交简历，提前2小时提醒", NOW)).toMatchObject({
      requiresModel: false,
      fields: [
        { kind: "due", date: "2026-08-07", time: "17:00" },
        { kind: "reminderOffset", minutesBefore: 120 },
      ],
    });
  });

  it("多个无角色日期时请求进一步理解而不猜第一个是截止日期", () => {
    const result = parseTaskText("8月10日和8月12日处理材料", NOW);

    expect(result.requiresModel).toBe(true);
    expect(result.fields).toEqual([]);
    expect(result.reason).toMatch(/多个日期|无法判断/);
  });

  it("允许一条输入同时明确计划日和提醒日", () => {
    expect(parseTaskText("8月12日提交材料，8月10日上午9点提醒我", NOW)).toMatchObject({
      requiresModel: false,
      fields: [
        { kind: "due", date: "2026-08-12" },
        { kind: "reminder", date: "2026-08-10", time: "09:00" },
      ],
    });
  });

  it("识别简单重复规则，同时完整保留用户原文", () => {
    expect(parseTaskText("每个工作日上午9点复习英语", NOW)).toMatchObject({
      original: "每个工作日上午9点复习英语",
      fields: [{ kind: "recurrence", rule: "weekdays" }],
      requiresModel: false,
    });
  });
});
