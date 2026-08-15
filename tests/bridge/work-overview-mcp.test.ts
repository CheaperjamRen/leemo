import { describe, expect, it } from "vitest";
import {
  createWorkOverviewMcp,
  LEEMO_WORK_OVERVIEW_TOOL,
} from "../../src/bridge/work-overview-mcp";

describe("createWorkOverviewMcp", () => {
  it("uses one stable first-party tool name and creates an SDK server", () => {
    expect(LEEMO_WORK_OVERVIEW_TOOL).toBe("mcp__leemo-work-overview__set_work_overview");
    expect(createWorkOverviewMcp().server).toBeTruthy();
  });

  it("trims and returns only the five bounded overview fields", async () => {
    const result = await createWorkOverviewMcp().runSetWorkOverview({
      theme: "  Leemo 内测准备  ",
      summary: " 补齐用户可见的关键链路 ",
      currentPosition: " 正在完成工作概览 ",
      nextStep: " 打包并验收 ",
      focus: " PDF 阅读体验 ",
      ignored: "不能进入概览",
    } as never);

    expect(result).toEqual({
      isError: false,
      text: "工作概览已更新。",
      overview: {
        theme: "Leemo 内测准备",
        summary: "补齐用户可见的关键链路",
        currentPosition: "正在完成工作概览",
        nextStep: "打包并验收",
        focus: "PDF 阅读体验",
      },
    });
  });

  it("rejects empty or overlong metadata instead of persisting vague noise", async () => {
    const mcp = createWorkOverviewMcp();
    await expect(mcp.runSetWorkOverview({ theme: "   " })).resolves.toMatchObject({ isError: true });
    await expect(mcp.runSetWorkOverview({ theme: "x".repeat(81) })).resolves.toMatchObject({ isError: true });
    await expect(mcp.runSetWorkOverview({ summary: "x".repeat(281) })).resolves.toMatchObject({ isError: true });
  });
});
