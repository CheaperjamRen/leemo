import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { decode, encode } from "gpt-tokenizer/encoding/o200k_base";
import { z } from "zod";
import type {
  MemoryChangeResult,
  MemoryGovernance,
  MemoryKind,
  MemoryScope,
} from "../host/memory-governance";

const MEMORY_SERVER = "leemo-memory";
const REMEMBER_TOOL = "remember";
const RECALL_TOOL = "recall";
const FORGET_TOOL = "forget";
const RECALL_BUDGET = 600;

export const LEEMO_MEMORY_TOOL_NAMES = {
  remember: `mcp__${MEMORY_SERVER}__${REMEMBER_TOOL}`,
  recall: `mcp__${MEMORY_SERVER}__${RECALL_TOOL}`,
  forget: `mcp__${MEMORY_SERVER}__${FORGET_TOOL}`,
} as const;

export type MemoryScopeChoice = "global" | "notebook" | "workspace";

export interface MemoryMcpResult {
  text: string;
  isError: boolean;
  changes: MemoryChangeResult[];
}

export interface RememberToolInput {
  topic: string;
  statement: string;
  kind?: MemoryKind;
  scope?: MemoryScopeChoice;
  validFrom?: string | number;
}

export interface RecallToolInput {
  query?: string;
  scope?: MemoryScopeChoice;
  atTime?: string | number;
  includeHistory?: boolean;
}

export interface ForgetToolInput {
  query: string;
  scope?: MemoryScopeChoice;
}

export interface MemoryMcpOptions {
  governance: MemoryGovernance;
  conversationId: string;
  notebookId?: string;
  workspaceId?: string;
  onChange?: (change: MemoryChangeResult) => void;
}

export interface MemoryMcp {
  server: McpSdkServerConfigWithInstance;
  beginRound(sourceMessageId?: string): void;
  runRemember(input: RememberToolInput): Promise<MemoryMcpResult>;
  runRecall(input: RecallToolInput): Promise<MemoryMcpResult>;
  runForget(input: ForgetToolInput): Promise<MemoryMcpResult>;
}

function parseTime(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("时间格式无法识别，请使用 ISO 日期时间");
  return parsed;
}

function clampTokens(text: string, limit: number): string {
  const tokens = encode(text);
  if (tokens.length <= limit) return text;
  return `${decode(tokens.slice(0, Math.max(0, limit - 1))).trimEnd()}…`;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/敏感凭据/.test(message)) return "没有保存：敏感凭据不进入长期记忆。";
  return `记忆操作失败：${message}`;
}

export function createMemoryMcp(options: MemoryMcpOptions): MemoryMcp {
  const { governance, conversationId, notebookId, workspaceId, onChange } = options;
  let sourceMessageId: string | undefined;
  let recallTokensRemaining = RECALL_BUDGET;

  const resolveScope = (choice?: MemoryScopeChoice): MemoryScope => {
    const selected = choice ?? (workspaceId ? "workspace" : notebookId ? "notebook" : "global");
    if (selected === "global") return { type: "global" };
    if (selected === "notebook") {
      if (!notebookId) throw new Error("当前没有打开本子，不能使用本子记忆范围");
      return { type: "notebook", notebookId };
    }
    if (!workspaceId) throw new Error("当前没有打开外部本子，不能使用这一本子的记忆范围");
    return { type: "workspace", workspaceId };
  };

  const runRemember = async (input: RememberToolInput): Promise<MemoryMcpResult> => {
    try {
      const scope = resolveScope(input.scope);
      const statement = input.statement.trim();
      const change = governance.remember({
        scope,
        kind: input.kind ?? (scope.type === "notebook" ? "notebook" : "state"),
        topic: input.topic,
        statement,
        sourceType: "explicit-user",
        sourceConversationId: conversationId,
        ...(sourceMessageId ? { sourceMessageId } : {}),
        ...(input.validFrom === undefined ? {} : { validFrom: parseTime(input.validFrom) }),
      });
      onChange?.(change);
      return { text: `记住了：${statement}`, isError: false, changes: [change] };
    } catch (error: unknown) {
      return { text: errorText(error), isError: true, changes: [] };
    }
  };

  const runRecall = async (input: RecallToolInput): Promise<MemoryMcpResult> => {
    try {
      if (recallTokensRemaining <= 0) {
        return { text: "本轮已经回忆了足够多的长期信息；请先使用已有结果。", isError: false, changes: [] };
      }
      const result = governance.recall({
        scope: resolveScope(input.scope),
        ...(input.query?.trim() ? { query: input.query.trim() } : {}),
        ...(input.atTime === undefined ? {} : { atTime: parseTime(input.atTime) }),
        ...(input.includeHistory === undefined ? {} : { includeHistory: input.includeHistory }),
      });
      if (result.records.length === 0) {
        return { text: "没有找到可靠的相关记忆。", isError: false, changes: [] };
      }
      const text = clampTokens(result.text, recallTokensRemaining);
      recallTokensRemaining = Math.max(0, recallTokensRemaining - encode(text).length);
      return { text, isError: false, changes: [] };
    } catch (error: unknown) {
      return { text: errorText(error), isError: true, changes: [] };
    }
  };

  const runForget = async (input: ForgetToolInput): Promise<MemoryMcpResult> => {
    try {
      const scope = resolveScope(input.scope);
      const query = input.query.trim();
      if (!query) {
        return {
          text: "请说清要忘掉的具体内容或关键词；空白请求不会删除记忆。",
          isError: true,
          changes: [],
        };
      }
      const matches = governance.recall({ scope, query }).records;
      if (matches.length === 0) {
        return { text: "没有找到需要忘掉的相关记忆。", isError: false, changes: [] };
      }
      const changes = matches.map((record) => governance.remove(scope, record.id));
      for (const change of changes) onChange?.(change);
      const summary = changes.map((change) => change.label).join("；");
      return { text: `已忘掉：${summary}`, isError: false, changes };
    } catch (error: unknown) {
      return { text: errorText(error), isError: true, changes: [] };
    }
  };

  const kindSchema = z.enum(["profile", "preference", "state", "goal", "episode", "notebook"]);
  const scopeSchema = z.enum(["global", "notebook", "workspace"]);
  const timeSchema = z.union([z.string(), z.number()]);
  const rememberTool = tool(
    REMEMBER_TOOL,
    "Remember an explicit durable fact, preference, goal, important change, or notebook decision. Do not store ordinary artifacts, transient task details, speculation, or secrets.",
    {
      topic: z.string().describe("A short stable topic used to replace outdated versions of the same fact."),
      statement: z.string().describe("One concise self-contained fact to remember."),
      kind: kindSchema.optional(),
      scope: scopeSchema.optional().describe("Defaults to the active notebook or project when one is open, otherwise global."),
      validFrom: timeSchema.optional().describe("Optional ISO time or Unix milliseconds when the fact became true."),
    },
    async (args) => {
      const result = await runRemember(args as RememberToolInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const recallTool = tool(
    RECALL_TOOL,
    "Recall relevant long-term information. Use history only when the user asks about change over time or an earlier state.",
    {
      query: z.string().optional(),
      scope: scopeSchema.optional(),
      atTime: timeSchema.optional(),
      includeHistory: z.boolean().optional(),
    },
    async (args) => {
      const result = await runRecall(args as RecallToolInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );
  const forgetTool = tool(
    FORGET_TOOL,
    "Forget current long-term information matching a precise topic or phrase when the user asks to remove it.",
    { query: z.string().trim().min(1), scope: scopeSchema.optional() },
    async (args) => {
      const result = await runForget(args as ForgetToolInput);
      return { content: [{ type: "text", text: result.text }], isError: result.isError } as never;
    },
  );

  const server = createSdkMcpServer({
    name: MEMORY_SERVER,
    version: "1.0.0",
    tools: [rememberTool, recallTool, forgetTool],
  });

  return {
    server,
    beginRound(nextSourceMessageId) {
      sourceMessageId = nextSourceMessageId;
      recallTokensRemaining = RECALL_BUDGET;
    },
    runRemember,
    runRecall,
    runForget,
  };
}
