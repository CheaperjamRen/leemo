import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  LEEMO_WORK_OVERVIEW_TOOL,
  normalizeWorkOverviewPatch,
  WORK_OVERVIEW_LIMITS,
  WORK_OVERVIEW_UPDATE_REASONS,
  type WorkOverviewPatch,
} from "./work-overview";

const SERVER = "leemo-work-overview";
const TOOL = "set_work_overview";

export { LEEMO_WORK_OVERVIEW_TOOL } from "./work-overview";

export interface WorkOverviewMcpResult {
  text: string;
  isError: boolean;
  overview?: WorkOverviewPatch;
}
export interface WorkOverviewMcp {
  server: McpSdkServerConfigWithInstance;
  runSetWorkOverview(input: unknown): Promise<WorkOverviewMcpResult>;
}

export function createWorkOverviewMcp(): WorkOverviewMcp {
  const runSetWorkOverview: WorkOverviewMcp["runSetWorkOverview"] = async (input) => {
    const normalized = normalizeWorkOverviewPatch(input);
    if (!normalized.ok) return { text: `工作概览没有更新：${normalized.error}`, isError: true };
    return { text: "工作概览已更新。", isError: false, overview: normalized.value };
  };

  const boundedText = (limit: number) => z.string().trim().min(1).max(limit);
  const boundedIdList = z.array(boundedText(WORK_OVERVIEW_LIMITS.listEntry))
    .max(WORK_OVERVIEW_LIMITS.listLength);
  const evidence = z.object({
    evidenceId: boundedText(WORK_OVERVIEW_LIMITS.listEntry),
    text: boundedText(WORK_OVERVIEW_LIMITS.listEntry),
    basisEventIds: boundedIdList.min(1),
  });

  const result = (value: WorkOverviewMcpResult) => ({
    content: [{ type: "text", text: value.text }],
    isError: value.isError,
  }) as never;

  return {
    server: createSdkMcpServer({
      name: SERVER,
      version: "1.0.0",
      tools: [
        tool(
          TOOL,
          "Write one bounded continuity checkpoint for the current conversation only when the objective, phase, blocker/recovery state, or meaningful terminal result changed. Usually call once at run end. Never call for ordinary chat, repeated reads/searches, individual tool steps, display changes, or no-net-change retries. Never complete a user Todo or invent overall progress. Completed highlights require real event IDs. Failure to update this metadata must not stop the user's task.",
          {
            objective: boundedText(WORK_OVERVIEW_LIMITS.objective).optional().describe("当前工作目标，只写已确认的目标"),
            successCriteria: z.array(boundedText(WORK_OVERVIEW_LIMITS.listEntry)).max(WORK_OVERVIEW_LIMITS.listLength).optional().describe("可验证的完成标准"),
            currentPhase: boundedText(WORK_OVERVIEW_LIMITS.phase).optional().describe("当前阶段，只写有证据的状态"),
            currentFocus: boundedText(WORK_OVERVIEW_LIMITS.focus).optional().describe("当前应持续关注的事项"),
            nextKnown: z.array(boundedText(WORK_OVERVIEW_LIMITS.listEntry)).max(WORK_OVERVIEW_LIMITS.listLength).optional().describe("已经明确的下一步"),
            blockers: z.array(boundedText(WORK_OVERVIEW_LIMITS.listEntry)).max(WORK_OVERVIEW_LIMITS.listLength).optional().describe("当前阻碍或等待项"),
            decisions: z.array(evidence).max(WORK_OVERVIEW_LIMITS.listLength).optional().describe("带真实来源的关键决定"),
            completedHighlights: z.array(evidence).max(WORK_OVERVIEW_LIMITS.listLength).optional().describe("带真实事件 ID 的已完成成果"),
            clearFields: z.array(z.enum(["objective", "currentPhase", "currentFocus"])).optional().describe("明确需要清除的可选字段"),
            updateReason: z.enum(WORK_OVERVIEW_UPDATE_REASONS).describe("这次连续性检查点的变化原因"),
            basisEventIds: boundedIdList.optional().describe("本次补充的真实事件来源；可省略，由界面写入本次工具调用来源"),
          },
          async (args) => result(await runSetWorkOverview(args)),
        ),
      ],
    }),
    runSetWorkOverview,
  };
}
