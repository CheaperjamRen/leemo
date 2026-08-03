import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createLearningMcp, LEEMO_LEARNING_TOOL_NAMES } from "../../src/bridge/learning-mcp";
import { createLearningService } from "../../src/main/learning-service";
import { createPersistence } from "../../src/main/persistence/schema";

describe("createLearningMcp", () => {
  function harness() {
    let clock = Date.parse("2026-08-02T10:00:00.000Z");
    let sequence = 0;
    const service = createLearningService(createPersistence(new Database(":memory:")), {
      now: () => clock,
      createId: (prefix) => `${prefix}-${++sequence}`,
    });
    const mcp = createLearningMcp({ service, conversationId: "conversation-english" });
    return { service, mcp, advanceTo: (next: number) => { clock = next; } };
  }

  it("exposes stable first-party tools without leaking the Claude Code mental model", () => {
    const { mcp } = harness();
    expect(mcp.server).toMatchObject({ type: "sdk", name: "leemo-learning" });
    expect(LEEMO_LEARNING_TOOL_NAMES).toEqual({
      getPlan: "mcp__leemo-learning__get_plan",
      savePlan: "mcp__leemo-learning__save_plan",
      recordMistake: "mcp__leemo-learning__record_mistake",
      rateReview: "mcp__leemo-learning__rate_review",
      recordSession: "mcp__leemo-learning__record_session",
    });
  });

  it("lets momo manage the same structured plan and due queue the page reads", async () => {
    const { mcp, advanceTo } = harness();
    expect(await mcp.runSavePlan({
      goal: "读懂英文论文并能复述",
      focus: "academic",
      dailyMinutes: 20,
    })).toMatchObject({ isError: false });

    const mistake = await mcp.runRecordMistake({
      skill: "reading",
      cue: "What does 'ablation study' mean?",
      userAnswer: "删除研究",
      correction: "A test that removes components to measure their contribution.",
      explanation: "论文中用于验证各模块是否真正有效。",
    });
    expect(mistake).toMatchObject({ isError: false });
    expect(mistake.itemId).toBeTruthy();

    const beforeDue = await mcp.runGetPlan({});
    expect(beforeDue.text).toContain("读懂英文论文并能复述");
    expect(beforeDue.text).toContain("论文阅读");
    expect(beforeDue.text).toContain("暂时没有到期复习");

    advanceTo(Date.parse("2026-08-03T10:00:00.000Z"));
    const due = await mcp.runGetPlan({});
    expect(due.text).toContain("ablation study");
    expect(due.text).not.toContain("A test that removes components");

    const reviewed = await mcp.runRateReview({ itemId: mistake.itemId!, rating: "good" });
    expect(reviewed).toMatchObject({ isError: false });
    expect(reviewed.text).toContain("下次复习");
  });

  it("tells a new conversation exactly which baseline can be checked again", async () => {
    const { mcp } = harness();
    expect(await mcp.runRecordSession({
      kind: "baseline",
      skill: "reading",
      assessmentKey: "paper-reading-v1",
      correct: 2,
      total: 5,
      summary: "论文摘要理解基线。",
    })).toMatchObject({ isError: false });

    const plan = await mcp.runGetPlan({});
    expect(plan.text).toContain("可复测基线");
    expect(plan.text).toContain("paper-reading-v1");
    expect(plan.text).toContain("5 题");
    expect(plan.text).toContain("论文摘要理解基线");
  });
});
