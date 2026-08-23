import { describe, expect, it } from "vitest";
import {
  createWorkOverviewMcp,
  LEEMO_WORK_OVERVIEW_TOOL,
} from "../../src/bridge/work-overview-mcp";
import { WORK_OVERVIEW_LIMITS } from "../../src/bridge/work-overview";

describe("createWorkOverviewMcp", () => {
  it("uses one stable first-party tool name and creates an SDK server", () => {
    expect(LEEMO_WORK_OVERVIEW_TOOL).toBe("mcp__leemo-work-overview__set_work_overview");
    expect(createWorkOverviewMcp().server).toBeTruthy();
  });

  it("normalizes one terminal checkpoint with its verified completion evidence", async () => {
    const result = await createWorkOverviewMcp().runSetWorkOverview({
      objective: "  完成工作台连续性验收  ",
      currentPhase: " 终验完成 ",
      nextKnown: [" 准备交付说明 "],
      blockers: [" 等待用户确认验收范围 "],
      completedHighlights: [{
        evidenceId: "tool-result-7",
        text: " 已验证概览恢复路径 ",
        basisEventIds: ["tool-result-7"],
      }],
      updateReason: "run-completed",
      basisEventIds: ["run-7", "tool-result-7"],
    });

    expect(result).toEqual({
      isError: false,
      text: "工作概览已更新。",
      overview: {
        objective: "完成工作台连续性验收",
        currentPhase: "终验完成",
        nextKnown: ["准备交付说明"],
        blockers: ["等待用户确认验收范围"],
        completedHighlights: [{
          evidenceId: "tool-result-7",
          text: "已验证概览恢复路径",
          basisEventIds: ["tool-result-7"],
        }],
        updateReason: "run-completed",
        basisEventIds: ["run-7", "tool-result-7"],
      },
    });
  });

  it("permits a patch without basis event ids because the renderer supplies stored source ids", async () => {
    const result = await createWorkOverviewMcp().runSetWorkOverview({
      currentFocus: "只保留用户已确认的状态",
      updateReason: "manual-refresh",
    });

    expect(result).toEqual({
      isError: false,
      text: "工作概览已更新。",
      overview: {
        currentFocus: "只保留用户已确认的状态",
        updateReason: "manual-refresh",
      },
    });
  });

  it("rejects a checkpoint without an update reason", async () => {
    const mcp = createWorkOverviewMcp();
    await expect(mcp.runSetWorkOverview({ objective: "完成验收" })).resolves.toMatchObject({ isError: true });
  });

  it("rejects a completed highlight without a real event id", async () => {
    const mcp = createWorkOverviewMcp();
    await expect(mcp.runSetWorkOverview({
      completedHighlights: [{ evidenceId: "completion-1", text: "已完成", basisEventIds: [] }],
      updateReason: "run-completed",
    })).resolves.toMatchObject({ isError: true });
  });

  it("rejects checkpoint text over the shared objective budget", async () => {
    const mcp = createWorkOverviewMcp();
    await expect(mcp.runSetWorkOverview({
      objective: "x".repeat(WORK_OVERVIEW_LIMITS.objective + 1),
      updateReason: "objective-set",
    })).resolves.toMatchObject({ isError: true });
  });
});
