import type { ProviderSpec, LeemoEvent, McpServerView } from "../../../bridge/contract";
import { LEEMO_VISUALIZATION_TOOL_NAME } from "../tool-names";

export const FIXTURE_PROVIDERS: ProviderSpec[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "deepseek",
    category: "cn_official",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat"],
    modelCapabilities: { "deepseek-chat": { thinking: true, vision: false } },
    capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
    // Fixture/browser-dev demo data represents an always-usable provider (轮 3
    // 卡 F3): without this the providers store's configured/unconfigured split
    // would hide it from the default-model picker and the input-box model
    // panel in every non-`live` shell.
    configured: true,
  },
];

export const FIXTURE_NOTIFICATIONS = [
  { id: "n1", text: "《数据结构》第五章笔记整理完成", read: false },
];

export const FIXTURE_WHITELIST = [
  { toolName: "mcp__demo__publish", risk: "moderate" as const },
  { toolName: "mcp__calendar__create_event", risk: "moderate" as const },
];

export const FIXTURE_MCP_SERVERS: McpServerView[] = [{
  id: "playwright",
  name: "浏览器自动化",
  description: "浏览器操作、网页测试与页面调试；使用 Leemo 专用的持久登录状态。",
  transport: "stdio",
  envKeys: [],
  headerKeys: [],
  enabled: false,
  builtin: "playwright",
  browserMode: "managed",
  saved: false,
  available: true,
}, {
  id: "computer",
  name: "操作电脑",
  description: "查看并操作 Windows 应用",
  transport: "stdio",
  envKeys: [],
  headerKeys: [],
  enabled: false,
  builtin: "computer",
  saved: false,
  available: true,
}];

/** Scripted default work turn. The fixture client pauses this script at its
 * approval and ask checkpoints, then emits the remaining tail after replies. */
export const DEMO_TURN_EVENTS: LeemoEvent[] = [
  { type: "text.delta", text: "好，我先通读一遍，" },
  { type: "text.delta", text: "列个计划再动手。" },
  { type: "thinking.delta", text: "先扫一遍 PPT 目录，" },
  { type: "thinking.delta", text: "38 页里重点应该在「遍历」和「平衡树」两节，例题挑典型的就好。" },
  { type: "tool.started", toolUseId: "p1", name: "TodoWrite", subagent: false, input: { todos: [
    { content: "提取《第五章-树与二叉树.pptx》全文", status: "completed" },
    { content: "检索本子内相关笔记", status: "completed" },
    { content: "归纳重点，生成复习笔记草稿", status: "in_progress" },
    { content: "写入「数据结构 / 笔记」文件夹", status: "pending" },
  ] } },
  { type: "tool.started", toolUseId: "t1", name: "Read", subagent: false, input: { file: "第五章-树与二叉树.pptx" } },
  { type: "tool.finished", toolUseId: "t1", isError: false, contentSummary: "38 页 · 2,146 字" },
  { type: "tool.started", toolUseId: "t2", name: "Grep", subagent: false, input: { query: "本子内相关笔记" } },
  { type: "tool.finished", toolUseId: "t2", isError: false, contentSummary: "命中 4 条" },
  { type: "subagent.activity", parentToolUseId: "sa1" },
  { type: "tool.started", toolUseId: "t3", name: "Write", subagent: true, input: { file: "草稿.md" } },
  { type: "tool.finished", toolUseId: "t3", isError: false, contentSummary: "草稿完成" },
  { type: "tool.started", toolUseId: "viz-1", name: LEEMO_VISUALIZATION_TOOL_NAME, subagent: false, input: {
    file_path: "遍历-复杂度.html",
    title: "遍历复杂度",
    visualization: {
      kind: "comparison",
      columns: ["操作", "复杂度"],
      rows: [{ cells: ["平衡树查找", "O(log n)"] }, { cells: ["顺序遍历", "O(n)"] }],
    },
  } },
  { type: "tool.finished", toolUseId: "viz-1", isError: false, contentSummary: "可视化已生成" },
  { type: "compact.boundary", trigger: "auto", preTokens: 12000, postTokens: 3200 },
  { type: "text.delta", text: "草稿好了。第五章主线是「遍历」，" },
  { type: "text.delta", text: "我配了 6 道例题和一张易错点清单。" },
  { type: "text.final", text: "草稿好了。第五章主线是「遍历」，我配了 6 道例题和一张易错点清单。" },
  { type: "usage.final", usage: {
    providerId: "deepseek", modelId: "deepseek-chat", inputTokens: 2400, outputTokens: 600,
    cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 8_200,
    costSource: "unpriced", tokensEstimated: false,
  } },
  { type: "file.changed", path: "数据结构/第五章笔记.md", workspacePath: "数据结构/第五章笔记.md", change: "added" },
  { type: "run.finished", subtype: "success", isError: false,
    finalText: "草稿好了。第五章主线是「遍历」，我配了 6 道例题和一张易错点清单。",
    pathAudit: { claimed: [] },
  },
];

import type { FileNode } from "../../stores/file-tree";

export const FIXTURE_FILE_TREE: FileNode[] = [
  {
    path: "/books/数据结构",
    name: "数据结构",
    kind: "dir",
    bookId: "数据结构",
    children: [
      { path: "/books/数据结构/第五章笔记.md", name: "第五章笔记.md", kind: "file", bookId: "数据结构", isNew: true },
      { path: "/books/数据结构/遍历-复杂度.html", name: "遍历-复杂度.html", kind: "file", bookId: "数据结构", referenced: true },
    ],
  },
  {
    path: "/books/高等数学",
    name: "高等数学",
    kind: "dir",
    bookId: "高等数学",
    children: [
      { path: "/books/高等数学/极限与连续.md", name: "极限与连续.md", kind: "file", bookId: "高等数学" },
    ],
  },
];
