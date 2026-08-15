import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  LEEMO_WORK_OVERVIEW_TOOL,
  normalizeWorkOverviewInput,
  type WorkOverviewData,
} from "./work-overview";

const SERVER = "leemo-work-overview";
const TOOL = "set_work_overview";

export { LEEMO_WORK_OVERVIEW_TOOL } from "./work-overview";

export interface WorkOverviewMcpResult {
  text: string;
  isError: boolean;
  overview?: WorkOverviewData;
}
export interface WorkOverviewMcp {
  server: McpSdkServerConfigWithInstance;
  runSetWorkOverview(input: unknown): Promise<WorkOverviewMcpResult>;
}

export function createWorkOverviewMcp(): WorkOverviewMcp {
  const runSetWorkOverview: WorkOverviewMcp["runSetWorkOverview"] = async (input) => {
    const normalized = normalizeWorkOverviewInput(input);
    if (!normalized.ok) return { text: `工作概览没有更新：${normalized.error}`, isError: true };
    return { text: "工作概览已更新。", isError: false, overview: normalized.value };
  };

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
          "Update the current conversation's concise work overview. Use this when the user asks the overview to emphasize, show, remember, or refocus on something. Summarize the theme and position; do not copy a step-by-step activity log and do not invent progress.",
          {
            theme: z.string().trim().min(1).max(80).optional().describe("这段工作的大致主题，短标题"),
            summary: z.string().trim().min(1).max(280).optional().describe("必要的一段概括，不逐条罗列过程"),
            currentPosition: z.string().trim().min(1).max(160).optional().describe("当前在全局任务中的位置，只写有证据的状态"),
            nextStep: z.string().trim().min(1).max(160).optional().describe("下一步，只写已经明确的行动"),
            focus: z.string().trim().min(1).max(160).optional().describe("用户希望概览持续重点关注的内容"),
          },
          async (args) => result(await runSetWorkOverview(args)),
        ),
      ],
    }),
    runSetWorkOverview,
  };
}
