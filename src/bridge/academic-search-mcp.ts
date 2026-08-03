import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import type { AcademicSearchOutcome } from "./contract";

const ACADEMIC_SEARCH_SERVER = "leemo-academic-search";
const ACADEMIC_SEARCH_TOOL = "academic_search";
const ABSTRACT_LIMIT = 1_200;

export const LEEMO_ACADEMIC_SEARCH_TOOL =
  `mcp__${ACADEMIC_SEARCH_SERVER}__${ACADEMIC_SEARCH_TOOL}`;

export interface AcademicSearchMcpOptions {
  search(query: string): Promise<AcademicSearchOutcome>;
}

export interface AcademicSearchMcp {
  server: McpSdkServerConfigWithInstance;
  runAcademicSearch(query: string): Promise<{ text: string; isError: boolean }>;
}

function clampAbstract(value: string): string {
  return value.length <= ABSTRACT_LIMIT ? value : `${value.slice(0, ABSTRACT_LIMIT).trimEnd()}…`;
}

function formatOutcome(outcome: AcademicSearchOutcome): string {
  if (outcome.papers.length === 0) {
    return `arXiv 没有找到匹配论文（查询：“${outcome.query}”）。`;
  }
  const rows = outcome.papers.map((paper, index) => {
    const authors = paper.authors.length > 0 ? paper.authors.join("、") : "作者信息缺失";
    const date = paper.publishedAt ? `\n   发表：${paper.publishedAt}` : "";
    const categories = paper.categories.length > 0
      ? `\n   分类：${paper.categories.join("、")}`
      : "";
    const pdf = paper.pdfUrl ? `\n   PDF：${paper.pdfUrl}` : "";
    const abstract = paper.abstract ? `\n   摘要：${clampAbstract(paper.abstract)}` : "";
    return `${index + 1}. ${paper.title}\n   ${paper.url}\n   作者：${authors}${date}${categories}${pdf}${abstract}`;
  });
  const cacheNote = outcome.cached ? "，本地缓存" : "";
  return `arXiv 学术检索结果（${rows.length} 篇${cacheNote}）：\n\n${rows.join("\n\n")}`;
}

export function createAcademicSearchMcp(options: AcademicSearchMcpOptions): AcademicSearchMcp {
  const runAcademicSearch = async (rawQuery: string): Promise<{ text: string; isError: boolean }> => {
    const query = rawQuery.trim();
    if (!query) return { text: "academic_search: empty query", isError: true };
    try {
      return { text: formatOutcome(await options.search(query)), isError: false };
    } catch {
      return {
        text:
          "学术检索失败：这次没能从 arXiv 取得论文。请如实告诉用户，" +
          "必要时改用普通联网搜索；不要凭记忆编造论文、作者或链接。",
        isError: true,
      };
    }
  };

  const searchTool = tool(
    ACADEMIC_SEARCH_TOOL,
    "Search arXiv for papers and preprints. Prefer this tool for literature, paper, " +
      "research-method, or academic-source questions. It returns citeable arXiv URLs, " +
      "authors, abstracts, dates, categories, and PDF links. If it fails, say so and " +
      "fall back to ordinary web search; never invent a paper.",
    { query: z.string().describe("Paper topic, title, author, or research question") },
    async (args) => {
      const result = await runAcademicSearch(String(args.query ?? ""));
      return {
        content: [{ type: "text", text: result.text }],
        isError: result.isError,
      } as never;
    },
  );

  return {
    server: createSdkMcpServer({
      name: ACADEMIC_SEARCH_SERVER,
      version: "1.0.0",
      tools: [searchTool],
    }),
    runAcademicSearch,
  };
}
