import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  LEEMO_RELATIONSHIP_HISTORY_ACTION,
  LEEMO_RELATIONSHIP_HISTORY_SERVER,
} from "./relationship-history-tool";

export { LEEMO_RELATIONSHIP_HISTORY_TOOL } from "./relationship-history-tool";

export interface RelationshipHistoryQuery {
  query: string;
  limit: number;
}

export interface RelationshipHistoryHit {
  conversationId: string;
  runId: string;
  role: "user" | "momo";
  text: string;
  createdAt?: number;
}

export interface RelationshipHistoryMcpResult {
  text: string;
  isError: boolean;
  hits?: RelationshipHistoryHit[];
}

export interface RelationshipHistoryMcp {
  server: McpSdkServerConfigWithInstance;
  runSearch(input: unknown): Promise<RelationshipHistoryMcpResult>;
}

export interface RelationshipHistoryMcpOptions {
  search(
    query: RelationshipHistoryQuery,
  ): Promise<RelationshipHistoryHit[]> | RelationshipHistoryHit[];
}

function normalizeInput(input: unknown): RelationshipHistoryQuery | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = input as { query?: unknown; limit?: unknown };
  const query = typeof value.query === "string" ? value.query.trim() : "";
  if (!query || query.length > 200) return undefined;
  const rawLimit = typeof value.limit === "number" && Number.isFinite(value.limit)
    ? Math.floor(value.limit)
    : 5;
  return { query, limit: Math.max(1, Math.min(8, rawLimit)) };
}

function resultContent(value: RelationshipHistoryMcpResult) {
  const body = value.hits?.length
    ? `${value.text}\n${value.hits.map((hit) => {
        const time = hit.createdAt ? new Date(hit.createdAt).toISOString() : "时间未知";
        return `- [${time}] ${hit.role === "user" ? "用户" : "momo"}: ${hit.text}`;
      }).join("\n")}`
    : value.text;
  return {
    content: [{ type: "text", text: body }],
    isError: value.isError,
  } as never;
}

export function createRelationshipHistoryMcp(
  options: RelationshipHistoryMcpOptions,
): RelationshipHistoryMcp {
  const runSearch: RelationshipHistoryMcp["runSearch"] = async (input) => {
    const normalized = normalizeInput(input);
    if (!normalized) {
      return { text: "请提供要回忆的具体人、事或关键词。", isError: true };
    }
    try {
      const hits = await options.search(normalized);
      return {
        text: hits.length > 0 ? `找到 ${hits.length} 条相关记录。` : "没有找到可靠的相关记录。",
        isError: false,
        hits,
      };
    } catch {
      return { text: "暂时无法读取更早的聊天记录。", isError: true };
    }
  };

  return {
    server: createSdkMcpServer({
      name: LEEMO_RELATIONSHIP_HISTORY_SERVER,
      version: "1.0.0",
      tools: [
        tool(
          LEEMO_RELATIONSHIP_HISTORY_ACTION,
          "Search bounded excerpts from the user's older momo relationship history. Use only when the current message depends on a specific earlier detail that is absent from current context. Search with concrete people, events, decisions, preferences, or phrases. Do not call every turn, do not browse casually, and treat excerpts as dated evidence that may have changed.",
          {
            query: z.string().trim().min(1).max(200).describe("要回忆的具体人、事、决定或关键词"),
            limit: z.number().int().min(1).max(8).optional().describe("最多返回几条；通常 3-5 条足够"),
          },
          async (args) => resultContent(await runSearch(args)),
        ),
      ],
    }),
    runSearch,
  };
}
