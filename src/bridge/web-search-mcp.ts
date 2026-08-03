// Leemo Bridge —— 联网搜索 MCP（06 §四）。进程内 SDK MCP，照 ask_user 先例。
//
// 为什么自建、不装第三方搜索 MCP：失败降级、防幻觉话术、fallback 链必须在
// 我们手里。第三方 MCP 挂了或悄悄改了行为，我们既控不住也测不到。
import { z } from "zod";
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import {
  buildSourceChain,
  runSearchChain,
  formatHits,
  type SearchSourceKeys,
} from "../host/web-search";

/** 与 ask MCP 同规矩：服务名与工具名都在此声明，限定名不会漂。 */
const WEB_SEARCH_SERVER = "leemo-web-search";
const WEB_SEARCH_TOOL = "web_search";

/** 模型看到的限定名。渲染层若要给搜索加专属卡片，锚这个常量。 */
export const LEEMO_WEB_SEARCH_TOOL = `mcp__${WEB_SEARCH_SERVER}__${WEB_SEARCH_TOOL}`;

export interface WebSearchMcpOptions {
  /** 每次调用时解析一次 key —— 设置页刚配的 key 立刻生效，不用重启。
   *  解析本身失败不该挡住免 key 那条路，故内部兜住异常。 */
  resolveKeys?: () => Promise<SearchSourceKeys> | SearchSourceKeys;
}

export interface WebSearchMcp {
  server: McpSdkServerConfigWithInstance;
  /** @internal 测试用：直接跑一次搜索，绕开 SDK 传输层。工具 handler 只是它的
   *  薄壳，所以钉住这个函数就等于钉住了模型实际拿到的东西。 */
  runWebSearch(query: string): Promise<{ text: string; isError: boolean }>;
}

/** 一次搜索的完整逻辑：解 key → 组链 → 跑链 → 渲染。全挂时给"照实说失败"。 */
async function performSearch(
  query: string,
  options: WebSearchMcpOptions
): Promise<{ text: string; isError: boolean }> {
  const q = query.trim();
  if (!q) return { text: "web_search: empty query", isError: true };

  let keys: SearchSourceKeys = {};
  try {
    keys = (await options.resolveKeys?.()) ?? {};
  } catch {
    // key 解析失败（比如加密件坏了）不该挡住免 key 的默认源。
  }

  const outcome = await runSearchChain(q, buildSourceChain(keys));
  if (!outcome) {
    // 全挂。给模型一句明确的失败陈述，让它照实说，而不是拿旧知识硬编。
    return {
      text:
        "搜索失败：所有源都没能返回结果。请如实告诉用户这次没搜到，" +
        "不要凭记忆编造网上的内容，也不要声称自己搜过了。",
      isError: true,
    };
  }
  return { text: formatHits(outcome.hits, outcome.source), isError: false };
}

export function createWebSearchMcp(options: WebSearchMcpOptions = {}): WebSearchMcp {
  const searchTool = tool(
    WEB_SEARCH_TOOL,
    "Search the web for current information. Use when the answer depends on " +
      "facts that may have changed (recent events, current versions/prices, " +
      "anything time-sensitive), or when the user asks you to look something up. " +
      "Returns titles, URLs and snippets — cite the URL when you use a result. " +
      "If the search fails, say so plainly; never invent results or pretend to " +
      "have searched.",
    { query: z.string().describe("The search query. Use the user's own language.") },
    async (args) => {
      const r = await performSearch(String(args.query ?? ""), options);
      return { content: [{ type: "text", text: r.text }], isError: r.isError } as never;
    }
  );

  const server = createSdkMcpServer({
    name: WEB_SEARCH_SERVER,
    version: "1.0.0",
    tools: [searchTool],
  });
  return { server, runWebSearch: (q) => performSearch(q, options) };
}
