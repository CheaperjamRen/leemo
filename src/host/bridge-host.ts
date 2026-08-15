import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createBridge } from "../bridge/pool";
import {
  createApprovalBroker,
  createAskUserMcp,
  DEFAULT_PERMISSION_POLICY,
} from "../bridge/interact";
import { createWebSearchMcp } from "../bridge/web-search-mcp";
import { createAcademicSearchMcp } from "../bridge/academic-search-mcp";
import { createDocumentMcp, LEEMO_DOCUMENT_TOOL_NAMES } from "../bridge/document-mcp";
import { createVisualizationMcp } from "../bridge/visualization-mcp";
import { createLearningMcp } from "../bridge/learning-mcp";
import {
  createScheduledTaskMcp,
  type ScheduledTaskAdmin,
} from "../bridge/scheduled-task-mcp";
import {
  createCaptureTaskMcp,
  LEEMO_CAPTURE_TASK_TOOL_NAMES,
} from "../bridge/capture-task-mcp";
import { createWorkOverviewMcp } from "../bridge/work-overview-mcp";
import type { CaptureAdminService } from "../main/capture-admin";
import type { TaskAdminService } from "../main/task-admin";
import type { LearningService } from "../learning";
import { createMemoryMcp, type MemoryMcp } from "../bridge/memory-mcp";
import {
  createSkillAdminMcp,
  LEEMO_SKILL_ADMIN_TOOL_NAMES,
  type SkillAdminMcp,
} from "../bridge/skill-admin-mcp";
import { startSearchShim, chooseSearchWiring, type SearchShimHandle, type SearchWiring } from "./search-shim";
import { buildSearchPlan } from "./search-plan";
import { buildSourceChain, runSearchChain } from "./web-search";
import { createArxivSearchClient } from "./arxiv-search";
import {
  createModelUsageCursor,
  normalizeSdkStream,
  toUserFacingRunError,
  type LeemoEvent,
  type ModelUsageCursor,
} from "../bridge/events";
import { resolvePricing } from "../bridge/pricing";
import { fetchBalance } from "../bridge/balance";
import { cloneModelCapabilityEvidenceMap } from "../bridge/model-capabilities";
import { buildQueryFn, type ConversationExtras } from "./sdk-adapter";
import { buildMomoSystemPrompt, DEFAULT_PERSONA_TEXT } from "./momo-prompt";
import { DEFAULT_WORKSPACE_DIR } from "./workspace";
import type { SearchSourceKeys } from "./web-search";
import {
  scanSkills,
  skillsRootFor,
  pluginRootFor,
  LEEMO_PLUGIN_NAME,
  type SkillsIO,
} from "./skills";
import {
  bundledSkillMetadata,
  type BundledSkillDefinition,
  type BundledSkillRuntime,
} from "./bundled-skills";
import {
  officeSkillForQualifiedName,
  officeSkillMetadata,
  type OfficeSkillRuntime,
} from "./office-skills";
import {
  superpowersSkillMetadata,
  type SuperpowersSkillDefinition,
  type SuperpowersSkillRuntime,
} from "./superpowers-skills";
import type { ManagedSkillRecord, SkillAdminService } from "./skill-admin-service";
import {
  mergeProviderHeaders,
  upsertProvider,
  removeProvider,
  type ProviderConfigFile,
} from "./provider-config";
import { requestProviderText, testProviderConnection, type ProviderTestTarget } from "./provider-test";
import { listProviderModels, type ProviderModelsTarget } from "./provider-models";
import type { ProviderSubscriptionAuth } from "./provider-subscription-auth";
import type {
  CodexApprovalRequest,
  CodexConversationHandle,
  CodexExecutionRuntime,
} from "./codex-conversation";
import { createCodexDynamicToolRegistry } from "./codex-dynamic-tools";
import {
  COMPUTER_MCP_ID,
  PLAYWRIGHT_MCP_ID,
  configuredSdkMcpServers,
  listMcpServerViews,
  mcpIdBase,
  removeStoredMcpServer,
  upsertStoredMcpServer,
  type BuiltinMcpRuntime,
} from "./mcp-config";
import { probeMcpServer } from "./mcp-probe";
import { ProviderRegistry } from "../gateway/registry";
import { startGateway, type GatewayHandle } from "../gateway/server";
import { formatPromptWithAttachments } from "./attachments";
import { providerApiKeyHeaderForKind, type CatalogEntry } from "./provider-catalog";
import type { Bridge, ConversationHandle, ConversationRoundOptions } from "../bridge/pool";
import type {
  BridgeInvokeMap,
  BridgeEventMap,
  SkillInfo,
  SkillInstallOutcome,
  CommunitySkillView,
  SkillSourceInspectionView,
  ProviderConfigView,
  ProviderDraft,
  ProviderError,
  ResolvedTaskField,
  SearchSourceId,
  SearchSourceStatus,
  McpServerView,
  UsageSummary,
  UsageSummaryQuery,
  MemoryView,
  MemoryScopeView,
  MemoryChangeResult as MemoryChangeView,
} from "../bridge/contract";
import type {
  AskUserMcp,
  AskUserInput,
  AskUserPayload,
  ApprovalRequest,
  ApprovalDecision,
  ApprovalBroker,
  WhitelistEntry,
  PermissionPolicy,
  ApprovalPersistence,
  RuntimeCapabilityState,
} from "../bridge/interact";
import type {
  MemoryGovernance,
  MemoryScope,
  MemoryRecord,
  MemoryChangeResult as GovernedMemoryChange,
  NativeMemoryBaseline,
} from "./memory-governance";
import {
  createWorkspaceChangeTracker,
  type WorkspaceChangeTracker,
} from "./workspace-change-tracker";

/** Read/write seam for persisted provider config (轮 3 卡 F).
 *
 *  Injected rather than imported so the host stays Electron-free: the encrypted
 *  blob needs `safeStorage`, which only exists in the main process. Omit it and
 *  the five configuration channels degrade to a clear error instead of crashing
 *  (dev.ts has no safeStorage and runs env-only). */
export interface ProviderConfigStore {
  read(): ProviderConfigFile;
  /** Persist and REBUILD the live catalog. Must throw (not swallow) when the
   *  platform cannot encrypt — a silently dropped key looks to the user like the
   *  save worked, and their key is gone. */
  write(config: ProviderConfigFile): void;
}

export interface ConversationWorkspace {
  id: string;
  name: string;
  root: string;
  kind: "home" | "external";
}

export interface HostDeps {
  /** The live catalog. Pass a FUNCTION when providers can be reconfigured at
   *  runtime: `saveProvider` rebuilds it, and every later read must see the new
   *  one. An array still works for fixed-catalog callers (tests, dev). */
  catalog: CatalogEntry[] | (() => CatalogEntry[]);
  /** Persisted provider config. Omit → the 5 config channels report "unavailable". */
  providerStore?: ProviderConfigStore;
  /** Process-owned login service for subscription providers. Omit in tests/dev
   *  hosts that do not ship the native login component. */
  subscriptionAuth?: ProviderSubscriptionAuth;
  /** Isolated native runtime for login-based OpenAI subscriptions. Internal
   * engine naming stays host-only and never enters the renderer contract. */
  codexRuntime?: CodexExecutionRuntime;
  /** External Gemini subscription runtime. Like ChatGPT subscription, this is
   * process-owned and absent when the user's local client is not installed. */
  geminiRuntime?: CodexExecutionRuntime;
  /** HTTP seam for connection tests / model discovery. Omit → global fetch. */
  fetchFn?: typeof fetch;
  dataDir: string;
  /** 轮 7 A1 —— **用户可见工作区的根**（`~/Leemo`），不再是隔离沙箱。
   *
   *  这是 momo 主人格对话的 cwd，也是每个本子目录的父目录。改这一个语义修掉了
   *  用户最痛的那条：此前 cwd 是 `.leemo-workspace/sandbox`，momo 说"写好了"
   *  而文件落在用户永远看不见的地方（本子/文件树/预览全在 `~/Leemo`）。
   *
   *  为什么敢去掉沙箱：防"模型乱写"的闸是审批条（canUseTool），不是目录隔离。
   *  Phase 0 那次"模型臆造绝对路径写出 cwd 外"恰恰证明目录隔离**挡不住**它 ——
   *  真正挡住的一直是审批。用户 7/28 拍板取消沙箱。 */
  workspaceRoot: string;
  /** Resolves a renderer-held opaque id to a freshly validated directory.
   * Missing means legacy callers may use only `workspaceRoot`. Production wires
   * this to WorkspaceRegistry, which rechecks existence and canonical realpath. */
  resolveWorkspace?: (workspaceId: string) => ConversationWorkspace | undefined;
  /** Route a relative Write issued from the root conversation into the
   * physical default workspace while preserving explicit notebook paths. The
   * main process owns the current notebook list, so this decision is injected
   * instead of re-reading the filesystem in this transport-agnostic host. */
  routeRootArtifactPath?: (relativePath: string) => string;
  /** Optional test-harness boundary. Production omits this and uses the normal
   * user-visible workspace model. */
  filesystemBoundary?: string;
  /** Maximum wait for the first provider-originated visible event. Local SDK
   * init does not count; once text/thinking/tool/result starts, long work is
   * unrestricted. Override only in tests. */
  firstProgressTimeoutMs?: number;
  /** Maximum wait for a permission decision. Unanswered approvals fail closed;
   * ordinary AskUser questions keep their independent interaction semantics. */
  approvalTimeoutMs?: number;
  push: <K extends keyof BridgeEventMap>(channel: K, payload: BridgeEventMap[K]) => void;
  queryImpl?: typeof sdkQuery;
  /** Test/dev override for the native CLI's process-owned PreToolUse endpoint.
   * Production omits it and receives a random loopback URL from the host gateway. */
  toolGovernanceHookUrl?: string;
  /** Reads Leemo's bounded global-current view. Full ledger metadata and legacy
   * files are deliberately outside this seam, so neither can enter the prompt. */
  readGlobalMemory?: () => string | undefined;
  /** Absolute Leemo workspace root. It enables governed memory and locates the
   * skills plugin internally, but storage paths stay out of the product prompt. */
  memoryDir?: string;
  /** Filesystem seam for skills discovery (轮 2 卡 E). Omit and the host simply
   *  reports no skills — the same safe degradation as a missing plugin dir. */
  skillsIO?: SkillsIO;
  /** Controlled Skill installer. Discovery still works without it, but every
   * mutation channel and momo's management tool fail closed. */
  skillAdmin?: SkillAdminService;
  /** App-owned Office runtime. Production starts its automatic preparation in
   * the background; the host awaits it before assembling a conversation and
   * loads only its stable four-skill adapter, never global user settings. */
  officeSkills?: OfficeSkillRuntime;
  /** Product-owner supplied offline Skill library. It is discovered from the
   * two build-time drop folders and copied to a real local plugin once per
   * content revision, so packaged users never need GitHub or a VPN. */
  bundledSkills?: BundledSkillRuntime;
  /** Optional offline development workflow suite. Its cards are visible as a
   * separate default-off collection; its plugin is routed only when at least
   * one qualified Superpowers Skill is selected for the conversation. */
  superpowersSkills?: SuperpowersSkillRuntime;
  /** Native file/folder picker. The renderer receives only a path the user
   * explicitly selected, and has no general filesystem browsing capability. */
  pickSkillSource?: (kind: "archive" | "folder") => Promise<string | undefined>;
  /** Resolves a 本子 id to its real work directory. This remains available when
   * memory is disabled because a notebook is first and foremost a workspace. */
  resolveNotebook?: (notebookId: string) => { dir: string; title: string } | undefined;
  /** Reads only the notebook's bounded current-memory view. Kept separate from
   * workspace resolution so disabling memory structurally prevents the read. */
  readNotebookMemory?: (notebookId: string) => string | undefined;
  /** Structured source of truth for Leemo memory. When absent, native Auto
   * Memory is explicitly disabled rather than falling back to an SDK directory. */
  memoryGovernance?: MemoryGovernance;
  /** Reveals a directory in the OS file manager (Electron `shell.openPath`).
   *  Injected because the host must stay Electron-free; dev.ts wires nothing and
   *  the channel becomes a no-op there. */
  openPath?: (path: string) => void | Promise<void | string>;
  /** 原生 CLI 二进制的绝对路径，**只有打包态才传**（轮 5 打包）。转发给
   *  `pathToClaudeCodeExecutable`。打包后 SDK 自己解出来的是 asar 内部路径，
   *  existsSync 为真但 spawn 必失败 —— 见 src/main/cli-binary.ts 的头注。
   *  省略（dev、tests）⇒ SDK 自己解析，行为与本卡之前完全一致。 */
  cliExecutablePath?: string;
  /** Packaged Playwright executable details. Omit in tests/dev when the
   * built-in browser server is unavailable; custom MCPs still work. */
  builtinMcpRuntime?: BuiltinMcpRuntime;
  /** Real protocol probe seam. Tests inject a fake; production uses MCP
   * initialize + tools/list without spending model tokens. */
  mcpProbe?: typeof probeMcpServer;
  /** Shared durable permission whitelist. The same instance backs broker
   * decisions and the settings list/revoke channels. */
  approvalPersistence?: ApprovalPersistence;
  /** SQLite-backed usage aggregation seam. Omit in lightweight dev/test hosts
   * and the channel returns an empty summary. */
  readUsageSummary?: (query: UsageSummaryQuery) => Promise<UsageSummary> | UsageSummary;
  /** Global structured English-learning ledger. It stays outside memory prompt
   * injection and is exposed to momo only through bounded first-party tools. */
  learningService?: LearningService;
  /** Main-process scheduler facade. When present, momo receives the same
   * validated task service as the visible scheduling page. */
  scheduledTasks?: ScheduledTaskAdmin;
  /** The exact process-owned services used by the visible notes and tasks
   * workboard. Both are required before momo receives the matching tools. */
  captures?: CaptureAdminService;
  tasks?: TaskAdminService;
}

export interface BridgeHost {
  handleInvoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"]
  ): Promise<BridgeInvokeMap[K]["response"]>;
  dispose(): void;
  /** @internal test-only: reach into a conversation's ask MCP. */
  inspect(conversationId: string): { askMcp: AskUserMcp; memoryMcp?: MemoryMcp; mcpServerNames: string[]; systemPromptAppend?: string } | undefined;
}

interface ConvRecord {
  engine: CatalogEntry["executionEngine"];
  purpose: "main" | "wiki";
  handle: ConversationHandle | CodexConversationHandle;
  bridge?: Bridge;
  broker: ApprovalBroker;
  askMcp: AskUserMcp;
  memoryMcp?: MemoryMcp;
  skillAdminMcp?: SkillAdminMcp;
  memoryScope: MemoryScope;
  entry: CatalogEntry;
  /** Exact selected model; provider.models[0] is only the family default. */
  modelId: string;
  workspace: ConversationWorkspace;
  /** 轮 7 A1 —— this conversation's own cwd (its 本子 dir, or the workspace root
   *  for momo 主人格). `drain` hands it to the path auditor, which decides
   *  whether a path momo *claims* to have written is inside the working dir. A
   *  single host-wide dir would mis-audit every notebook conversation. */
  cwd: string;
  /** 轮 7 A3 —— the live extras container `send()` re-reads every round.
   *  Retained so `bridge:updateContext` can rewrite the prompt / tool wiring of
   *  an ALREADY-RUNNING conversation, which is what makes a settings change take
   *  effect on the next turn instead of only in a brand-new conversation. */
  extras: ConversationExtras;
  /** 轮 7 A3 —— the SAME object the broker captured. `canUseTool` reads
   *  `policy.mode` at call time, so mutating these fields is genuinely live: no
   *  broker rebuild, no lost in-flight approval. */
  policy: PermissionPolicy;
  /** 轮 7 A3 —— the persona inputs as last applied, so a partial update can be
   *  merged without the renderer having to resend everything it did not change. */
  personaCtx: {
    mode: "buddy" | "workbench";
    personaText: string;
    talkStyle: 1 | 2 | 3;
    webSearchEnabled: boolean;
    webFetchEnabled: boolean;
    rememberMode: boolean;
    browserEnabled: boolean;
    computerEnabled: boolean;
  };
  /** 轮 7 A3 —— which 本子 this conversation belongs to, so a context update can
   *  re-read that notebook's governed current view instead of silently
   *  dropping it when the prompt is rebuilt. */
  notebookId: string | undefined;
  /** MCP ids last merged from encrypted user config. Internal ask/search MCPs
   * are intentionally absent so a refresh cannot delete them. */
  configuredMcpIds: Set<string>;
  /** Host-owned turn lifecycle. The SDK can acknowledge abort without ever
   * yielding a terminal result (notably while Bash is active), so the UI must
   * not depend on a provider event to leave its running state. Object identity
   * also fences late events from an interrupted turn out of a newer turn. */
  nextRoundId: number;
  /** SDK modelUsage is cumulative across turns. One host-owned cursor per
   * conversation converts it to per-round deltas before it crosses IPC. */
  modelUsageCursor: ModelUsageCursor;
  /** An engine without in-flight steering accepted an additional instruction.
   * The engine owns its exact prompt payload; the host only starts its next
   * turn after the current one reaches a normal terminal state. */
  queuedGuidanceFollowUp: boolean;
  activeRound?: {
    id: number;
    interrupted: Promise<void>;
    resolveInterrupted: () => void;
    /** False means an owned child may still be writing. Preserve its private
     * cache for startup cleanup instead of racing it with reconciliation. */
    nativeCleanupSafe: boolean;
    finishFileChanges: () => Promise<void>;
  };
}

const PROCESS_STOP_UNCONFIRMED_MESSAGE =
  "未能确认后台命令已经停止。为避免继续写入，此对话已锁定；请关闭 Leemo 后检查任务管理器。";

const SUPERPOWERS_BOOTSTRAP = [
  "\n\n## 已启用的 Superpowers 开发流程",
  "回复或执行前，先调用 Skill 工具读取 `superpowers:using-superpowers`。",
  "由该技能判断本轮应使用哪些已启用的开发方法；不要调用未启用的技能。",
  "如与用户当前要求冲突，以用户要求为准。",
].join("\n");

function withSuperpowersBootstrap(prompt: string, enabled: boolean): string;
function withSuperpowersBootstrap(prompt: undefined, enabled: boolean): string | undefined;
function withSuperpowersBootstrap(prompt: string | undefined, enabled: boolean): string | undefined;
function withSuperpowersBootstrap(
  prompt: string | undefined,
  enabled: boolean,
): string | undefined {
  const base = prompt?.endsWith(SUPERPOWERS_BOOTSTRAP)
    ? prompt.slice(0, -SUPERPOWERS_BOOTSTRAP.length)
    : prompt;
  if (!enabled) return base;
  return `${base ?? ""}${SUPERPOWERS_BOOTSTRAP}`;
}

const NON_MUTATING_NATIVE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
  "TaskList",
  "TaskGet",
  "TaskOutput",
  "TaskCreate",
  "TaskUpdate",
  "TaskStop",
  "TodoRead",
  "TodoWrite",
  "EnterPlanMode",
  "ExitPlanMode",
  "Skill",
  LEEMO_CAPTURE_TASK_TOOL_NAMES.listNotes,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.listTasks,
]);

const NON_MUTATING_MCP_PREFIXES = [
  "mcp__leemo-ask-user__",
  "mcp__leemo-memory__",
  "mcp__leemo-learning__",
  "mcp__leemo-search__",
  "mcp__leemo-academic-search__",
  "mcp__leemo-work-overview__",
];

function toolMayChangeWorkspace(toolName: string): boolean {
  if (NON_MUTATING_NATIVE_TOOLS.has(toolName)) return false;
  return !NON_MUTATING_MCP_PREFIXES.some((prefix) => toolName.startsWith(prefix));
}

const TOOL_PATH_KEYS = new Set([
  "path",
  "filepath",
  "notebookpath",
  "outputpath",
  "outputfile",
  "destinationpath",
  "targetpath",
]);

function toolInputPaths(value: unknown, depth = 0): string[] {
  if (depth > 3 || typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replaceAll("_", "").replaceAll("-", "").toLocaleLowerCase();
    if (TOOL_PATH_KEYS.has(normalizedKey)) {
      if (typeof candidate === "string") paths.push(candidate);
      else if (Array.isArray(candidate)) {
        paths.push(...candidate.filter((item): item is string => typeof item === "string"));
      }
      continue;
    }
    paths.push(...toolInputPaths(candidate, depth + 1));
  }
  return paths;
}

/**
 * 轮 4 卡 H —— 搜索源的 key。读的是 provider 那**同一份** safeStorage 加密件
 * (`ProviderConfigFile.searchKeys`),不是第二个文件:凭据只应有一个家。
 *
 * 每次搜索现读一次,不是启动时读一次 —— 用户在设置页存完 key,当前这轮对话就
 * 该能用上,而不是"重启才生效"。
 *
 * 环境变量作退化兜底(探针脚本与 CI 靠它),但加密件优先:用户在界面上明确存过
 * 的东西,不该被一个陈旧的环境变量悄悄盖掉。
 *
 * 全空也能搜 —— 默认源 AnySearch 免 key(实测中英文各 8~10 条 / ~1.9s)。
 *
 * @internal 导出仅为可测：优先级(加密件 > 环境变量)与坏加密件的退化行为是这张
 * 卡里最容易静默出错的一处,而它在 MCP 工具的 handler 深处,从 SDK options 那侧
 * 够不着。
 */
export function loadSearchKeys(store?: ProviderConfigStore): SearchSourceKeys {
  const env = (name: string): string | undefined => {
    const v = process.env[name]?.trim();
    return v ? v : undefined;
  };
  let stored: ProviderConfigFile["searchKeys"];
  try {
    stored = store?.read().searchKeys;
  } catch {
    // 加密件坏了/平台不能解密 ⇒ 退到环境变量,免 key 那条路照常能用。
  }
  const pick = (k?: string, envName?: string): string | undefined => {
    const v = k?.trim();
    return v ? v : envName ? env(envName) : undefined;
  };
  return {
    anysearchKey: pick(stored?.anysearch, "ANYSEARCH_API_KEY"),
    doubaoKey: pick(stored?.doubao, "DOUBAO_SEARCH_API_KEY"),
    metasoKey: pick(stored?.metaso, "METASO_API_KEY"),
    tavilyKey: pick(stored?.tavily, "TAVILY_API_KEY"),
    bochaKey: pick(stored?.bocha, "BOCHA_API_KEY"),
    googleKey: pick(stored?.google, "GOOGLE_SEARCH_API_KEY"),
    googleCx: pick(stored?.googleCx, "GOOGLE_SEARCH_ENGINE_ID"),
    exaKey: pick(stored?.exa, "EXA_API_KEY"),
    braveKey: pick(stored?.brave, "BRAVE_SEARCH_API_KEY"),
    serpapiKey: pick(stored?.serpapi, "SERPAPI_API_KEY"),
    serperKey: pick(stored?.serper, "SERPER_API_KEY"),
    firecrawlKey: pick(stored?.firecrawl, "FIRECRAWL_API_KEY"),
  };
}

function isExternalAgentRecord(rec: ConvRecord): rec is ConvRecord & {
  engine: "openai-app-server" | "gemini-acp";
  handle: CodexConversationHandle;
} {
  return rec.engine !== "claude-agent-sdk";
}

type UnknownRecord = Record<string, unknown>;

function unknownRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function unknownText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function formatPromptWithNoteReferences(
  prompt: string,
  noteReferences: string[] | undefined,
  captures: CaptureAdminService | undefined,
): string {
  if (!noteReferences?.length || !captures) return prompt;
  const seen = new Set<string>();
  const notes = noteReferences.flatMap((id) => {
    if (typeof id !== "string" || seen.has(id)) return [];
    seen.add(id);
    const note = captures.getNote(id);
    return note ? [note] : [];
  });
  if (notes.length === 0) return prompt;
  return `${prompt}\n\n--- Leemo 便签引用（仅供本轮上下文）---\n${notes.map((note) =>
    `[便签：${note.title.trim() || "未命名便签"}]\n${note.markdown}`,
  ).join("\n\n")}\n--- 便签引用结束 ---`;
}

function formatPromptWithGoal(prompt: string, goalText: string | undefined): string {
  const goal = goalText?.trim();
  if (!goal) return prompt;
  return `${prompt}\n\n[Leemo 当前目标]\n${goal}\n请让本轮工作与这个目标保持一致；不要虚构进度，也不要擅自把目标标记为完成。`;
}

/** Convert the native runtime's structured questions into Leemo's one card
 * format, then restore its id-keyed response shape. Secret questions never
 * cross IPC because credentials belong to process-owned settings flows. */
async function answerCodexQuestionCard(
  askMcp: AskUserMcp,
  params: unknown,
): Promise<{ answers: Record<string, { answers: string[] }> }> {
  const body = unknownRecord(params);
  const rawQuestions = Array.isArray(body?.questions) ? body.questions : [];
  const visible: Array<{ id: string; question: AskUserInput["questions"][number] }> = [];
  const answers: Record<string, { answers: string[] }> = {};
  for (const candidate of rawQuestions) {
    const question = unknownRecord(candidate);
    const id = unknownText(question?.id);
    const prompt = unknownText(question?.question);
    if (!id || !prompt) continue;
    if (question?.isSecret === true) {
      answers[id] = { answers: [] };
      continue;
    }
    const options = (Array.isArray(question?.options) ? question.options : [])
      .map((option) => unknownRecord(option))
      .map((option) => ({
        label: unknownText(option?.label) ?? "",
        description: unknownText(option?.description),
      }))
      .filter((option) => option.label.length > 0)
      .map((option) => ({
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      }));
    visible.push({
      id,
      question: {
        question: prompt,
        ...(unknownText(question?.header) ? { header: unknownText(question?.header) } : {}),
        options,
      },
    });
  }
  if (visible.length === 0) return { answers };
  const response = await askMcp.requestAnswer({ questions: visible.map((item) => item.question) });
  for (const [index, item] of visible.entries()) {
    const selected = [...(response.items[index]?.selected ?? [])];
    const other = response.items[index]?.other?.trim();
    if (other) selected.push(other);
    answers[item.id] = { answers: selected };
  }
  return { answers };
}

/** Anthropic-compatible routes need the transparent local shim whenever Leemo
 * must add behavior the native SDK env cannot express: governed web search,
 * provider-specific headers, or an x-api-key credential. */
export function providerNeedsAnthropicShim(
  entry: CatalogEntry,
  webSearchEnabled: boolean,
): boolean {
  return entry.spec.authMode !== "oauth-subscription"
    && entry.provider.apiFormat === "anthropic" && (
    webSearchEnabled
    || entry.apiKeyHeader === "x-api-key"
    || Object.keys(entry.headers ?? {}).length > 0
  );
}

const TASK_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validTaskDate(value: string): boolean {
  if (!TASK_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function taskTimePrompt(texts: string[], localNow: string, timeZone?: string): string {
  return [
    "你只负责把待办原文里明确出现的时间信息整理成 JSON，不要改写或补猜。",
    `当前本地时间：${localNow}${timeZone ? `（${timeZone}）` : ""}`,
    "区分 planned（计划开始）、due（截止）、reminder（提醒）、reminderOffset（提前提醒）、recurrence（重复）。",
    "source 必须逐字复制自对应原文；无法确定角色时不要输出该字段。",
    "只返回 JSON：{\"items\":[{\"index\":0,\"fields\":[{\"kind\":\"planned\",\"date\":\"YYYY-MM-DD\",\"time\":\"HH:mm\",\"source\":\"原文\"}]}]}。",
    "reminderOffset 使用 minutesBefore；recurrence 的 rule 只能是 daily、weekly、monthly、weekdays。",
    ...texts.map((text, index) => `${index}. ${text}`),
  ].join("\n");
}

function parseResolvedTaskFields(
  rawText: string,
  sourceTexts: string[],
): Array<{ index: number; fields: ResolvedTaskField[] }> | undefined {
  const jsonText = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(jsonText) as unknown;
  } catch {
    return undefined;
  }
  const root = unknownRecord(value);
  if (!Array.isArray(root?.items)) return undefined;
  const seen = new Set<number>();
  const items: Array<{ index: number; fields: ResolvedTaskField[] }> = [];
  for (const candidate of root.items) {
    const item = unknownRecord(candidate);
    const index = item?.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= sourceTexts.length || seen.has(index as number)) {
      continue;
    }
    const sourceText = sourceTexts[index as number];
    const fields: ResolvedTaskField[] = [];
    for (const fieldCandidate of Array.isArray(item?.fields) ? item.fields : []) {
      const field = unknownRecord(fieldCandidate);
      const kind = unknownText(field?.kind);
      const source = unknownText(field?.source)?.trim();
      if (!source || !sourceText.includes(source)) continue;
      if (kind === "planned" || kind === "due" || kind === "reminder") {
        const date = unknownText(field?.date);
        const time = unknownText(field?.time);
        if (!date || !validTaskDate(date) || (time !== undefined && !TASK_TIME_RE.test(time))) continue;
        fields.push({ kind, date, ...(time ? { time } : {}), source });
      } else if (kind === "reminderOffset") {
        const minutesBefore = field?.minutesBefore;
        if (typeof minutesBefore !== "number" || !Number.isInteger(minutesBefore) || minutesBefore <= 0) continue;
        fields.push({ kind, minutesBefore, source });
      } else if (kind === "recurrence") {
        const rule = field?.rule;
        if (rule === "daily" || rule === "weekly" || rule === "monthly" || rule === "weekdays") {
          fields.push({ kind, rule, source });
        }
      }
    }
    if (fields.length > 0) {
      seen.add(index as number);
      items.push({ index: index as number, fields });
    }
  }
  return items.length > 0 ? items : undefined;
}

export function createBridgeHost(deps: HostDeps): BridgeHost {
  const { catalog, providerStore, subscriptionAuth, codexRuntime, geminiRuntime, fetchFn, dataDir, workspaceRoot, routeRootArtifactPath, filesystemBoundary, firstProgressTimeoutMs, approvalTimeoutMs, push, queryImpl, toolGovernanceHookUrl, readGlobalMemory, memoryDir, memoryGovernance, skillsIO, skillAdmin, officeSkills, bundledSkills, superpowersSkills, openPath, resolveNotebook, readNotebookMemory, cliExecutablePath, builtinMcpRuntime, readUsageSummary, learningService, scheduledTasks, captures, tasks } = deps;
  const toolGovernanceHookPath = `/__leemo/hooks/tool-governance-${randomUUID()}`;

  const homeWorkspace: ConversationWorkspace = {
    id: "leemo-home",
    name: path.basename(workspaceRoot) || "Leemo",
    root: workspaceRoot,
    kind: "home",
  };

  function resolveConversationWorkspace(workspaceId: string | undefined): ConversationWorkspace {
    if (workspaceId === undefined) return homeWorkspace;
    if (!deps.resolveWorkspace) {
      if (workspaceId === homeWorkspace.id) return homeWorkspace;
      throw new Error("这个工作区还没有连接好，请重新打开文件夹后再试。");
    }
    const resolved = deps.resolveWorkspace(workspaceId);
    if (!resolved || !resolved.root || !resolved.id) {
      throw new Error("找不到这个工作区，请重新打开文件夹后再试。");
    }
    return resolved;
  }

  function samePath(left: string, right: string): boolean {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return process.platform === "win32" ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
  }

  /** Native HTTP hooks carry cwd but not conversationId. Match it back to the
   * live record so root artifact routing is applied only to the home workspace. */
  function workspaceForCwd(cwd: string): ConversationWorkspace {
    for (const rec of conversations.values()) {
      if (samePath(rec.cwd, cwd)) return rec.workspace;
    }
    return samePath(cwd, workspaceRoot) ? homeWorkspace : { ...homeWorkspace, root: cwd, kind: "external" };
  }

  function requireMemoryGovernance(): MemoryGovernance {
    if (!memoryGovernance) throw new Error("当前运行环境没有启用 Leemo 记忆治理。");
    return memoryGovernance;
  }

  const memoryKinds = new Set(["profile", "preference", "state", "goal", "episode", "notebook"]);

  function requiredMemoryId(value: unknown, label = "记忆标识"): string {
    if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\u0000-\u001f]/.test(value)) {
      throw new Error(`${label}不合法或为空。`);
    }
    return value.trim();
  }

  function optionalMemoryText(value: unknown, label: string, maxLength: number): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
      throw new Error(`${label}不合法或为空。`);
    }
    return value;
  }

  function governedScope(scope: MemoryScopeView): MemoryScope {
    if (scope?.type === "global") return { type: "global" };
    if (scope?.type === "notebook") {
      const notebookId = requiredMemoryId(scope.notebookId, "本子标识");
      if (!resolveNotebook?.(notebookId)) throw new Error("找不到这个本子，无法管理它的记忆。");
      return { type: "notebook", notebookId };
    }
    if (scope?.type === "workspace") {
      const workspaceId = requiredMemoryId(scope.workspaceId, "项目标识");
      const workspace = resolveConversationWorkspace(workspaceId);
      if (workspace.kind !== "external") throw new Error("这个范围不是外部本子记忆。");
      return { type: "workspace", workspaceId };
    }
    throw new Error("记忆范围不合法。");
  }

  async function openDirectory(target: string): Promise<void> {
    if (!openPath) return;
    const result = await openPath(target);
    if (typeof result === "string" && result.trim()) {
      throw new Error(`系统打开目录失败：${result}`);
    }
  }

  function projectMemory(record: MemoryRecord): MemoryView {
    const scope: MemoryScopeView = record.scope.type === "global"
      ? { type: "global" }
      : record.scope.type === "notebook"
        ? { type: "notebook", notebookId: record.scope.notebookId }
        : { type: "workspace", workspaceId: record.scope.workspaceId };
    return {
      id: record.id,
      scope,
      kind: record.kind,
      topic: record.topic,
      statement: record.statement,
      learnedAt: record.learnedAt,
      ...(record.validFrom === undefined ? {} : { validFrom: record.validFrom }),
      ...(record.validTo === undefined ? {} : { validTo: record.validTo }),
      ...(record.lastConfirmedAt === undefined ? {} : { lastConfirmedAt: record.lastConfirmedAt }),
      sourceType: record.sourceType,
      ...(record.sourceConversationId ? { sourceConversationId: record.sourceConversationId } : {}),
      ...(record.sourceMessageId ? { sourceMessageId: record.sourceMessageId } : {}),
      status: record.status,
      ...(record.supersedes ? { supersedes: record.supersedes } : {}),
      pinned: record.pinned,
    };
  }

  function projectMemoryChange(change: GovernedMemoryChange): MemoryChangeView {
    return {
      changeId: change.changeId,
      action: change.action,
      label: change.label,
      memory: projectMemory(change.record),
    };
  }

  function pushMemoryChange(conversationId: string, change: GovernedMemoryChange): void {
    const projected = projectMemoryChange(change);
    push("bridge:event", {
      conversationId,
      event: {
        type: "memory.changed",
        changeId: projected.changeId,
        action: projected.action,
        label: projected.label,
        scope: projected.memory.scope,
      },
    });
  }

  /** Always read through this — a saved provider must be visible immediately,
   *  so nothing may capture the array once at construction. */
  const getCatalog = (): CatalogEntry[] => (typeof catalog === "function" ? catalog() : catalog);
  const providerIsReady = (entry: CatalogEntry): boolean => (
    entry.spec.authMode === "none" || entry.spec.authMode === "oauth-subscription"
  )
    ? entry.spec.configured === true
    : entry.provider.apiKey.trim().length > 0;

  function setupMessage(entry: CatalogEntry, suffix = ""): string {
    if (entry.spec.authMode === "none") {
      return `「${entry.spec.name}」还没有选择可用模型，先去设置页读取并选择一个模型${suffix}`;
    }
    if (entry.spec.authMode === "oauth-subscription") {
      return `「${entry.spec.name}」还没有完成登录与保存，先去设置页连接订阅${suffix}`;
    }
    return `「${entry.spec.name}」还没有配置 API Key，先去设置页填一个${suffix}`;
  }

  async function requireLiveSubscription(entry: CatalogEntry): Promise<void> {
    if (entry.spec.authMode !== "oauth-subscription") return;
    const status = subscriptionAuth
      ? await subscriptionAuth.getStatus(entry.provider.id)
      : { state: "unavailable" as const };
    if (status.state !== "connected") {
      throw new Error(`「${entry.spec.name}」的订阅登录已失效，请到设置页重新登录。`);
    }
  }

  function subscriptionEntry(providerId: string): CatalogEntry {
    const entry = getCatalog().find((candidate) => candidate.provider.id === providerId);
    if (!entry) throw new Error(`unknown provider: ${providerId}`);
    if (entry.spec.authMode !== "oauth-subscription") {
      throw new Error(`「${entry.spec.name}」不支持订阅登录。`);
    }
    return entry;
  }
  const httpFetch = (): typeof fetch => fetchFn ?? fetch;
  const academicSearch = createArxivSearchClient({ fetchFn: httpFetch() });

  // OpenAI-compatible providers need an Anthropic-facing loopback gateway for
  // Claude Code. It is host-owned, lazy, and reads the live catalog on every
  // request so saving a new key/URL takes effect without an app restart.
  const gatewayRegistry = new ProviderRegistry({
    records: () => getCatalog()
      .filter((entry) => entry.provider.apiFormat !== "anthropic" && providerIsReady(entry))
      .map((entry) => ({
        id: entry.provider.id,
        baseUrl: entry.provider.baseUrl,
        // OpenAI-compatible local servers conventionally accept a dummy token
        // (Ollama explicitly documents this). No user secret is invented or stored.
        apiKey: entry.provider.apiKey || "leemo-local",
        model: entry.provider.models[0] ?? "",
        models: [...entry.provider.models],
        apiFormat: entry.provider.apiFormat === "openai-responses" ? "openai-responses" as const : "openai" as const,
        ...(entry.headers ? { headers: { ...entry.headers } } : {}),
        ...(entry.gatewayOpts ? { opts: { ...entry.gatewayOpts } } : {}),
      })),
    logSink: (line) => console.error(`[leemo:gateway] ${line}`),
  });
  let gatewayPromise: Promise<GatewayHandle | undefined> | undefined;
  function ensureGateway(): Promise<GatewayHandle | undefined> {
    gatewayPromise ??= startGateway(gatewayRegistry, {
      hook: {
        path: toolGovernanceHookPath,
        handle: handleNativeToolGovernanceHook,
      },
    }).catch((error: unknown) => {
      gatewayPromise = undefined;
      console.error("[leemo:gateway] failed to start:", error);
      return undefined;
    });
    return gatewayPromise;
  }

  const conversations = new Map<string, ConvRecord>();
  let latestSkillSyncRequestId = 0;

  function bundledSkillForQualifiedName(name: string): BundledSkillDefinition | undefined {
    return bundledSkills?.snapshot().skills.find((skill) => skill.qualifiedName === name);
  }

  function superpowersSkillForQualifiedName(name: string): SuperpowersSkillDefinition | undefined {
    return superpowersSkills?.snapshot().skills.find((skill) => skill.qualifiedName === name);
  }

  function managedSkillFields(record: ManagedSkillRecord, collectionMemberCount?: number): Pick<
    SkillInfo,
    | "description"
    | "displayName"
    | "category"
    | "categoryLabel"
    | "id"
    | "trust"
    | "sourceKind"
    | "sourceLabel"
    | "sourceUrl"
    | "repository"
    | "revision"
    | "license"
    | "scanStatus"
    | "securityFindings"
    | "collectionId"
    | "collectionLabel"
    | "collectionMemberCount"
    | "setupRequired"
    | "setupMessage"
    | "canRemove"
    | "canUpdate"
  > {
    return {
      description: record.description,
      ...(record.displayName ? { displayName: record.displayName } : {}),
      ...(record.category ? { category: record.category } : {}),
      ...(record.categoryLabel ? { categoryLabel: record.categoryLabel } : {}),
      id: record.id,
      trust: record.trust,
      sourceKind: record.sourceKind,
      sourceLabel: record.sourceLabel,
      ...(record.sourceKind === "github" || record.sourceKind === "skillsh" ? { sourceUrl: record.source } : {}),
      ...(record.repository ? { repository: record.repository } : {}),
      ...(record.revision ? { revision: record.revision } : {}),
      ...(record.license ? { license: record.license } : {}),
      scanStatus: record.scanStatus,
      securityFindings: record.findings.map((finding) => ({ ...finding })),
      ...(record.familyCatalogId ? {
        collectionId: `family:${record.familyCatalogId}`,
        collectionLabel: record.familyLabel ?? "技能套装",
        collectionMemberCount: collectionMemberCount ?? 1,
      } : {}),
      ...(record.setupRequired ? { setupRequired: true } : {}),
      ...(record.setupMessage ? { setupMessage: record.setupMessage } : {}),
      canRemove: true,
      canUpdate: !record.packageId && (record.sourceKind === "github" || record.sourceKind === "skillsh"),
    };
  }

  function scanUserSkills(): SkillInfo[] {
    if (!memoryDir || !skillsIO) return [];
    try {
      return scanSkills(skillsRootFor(memoryDir), "leemo", skillsIO).map((skill) => {
        const managed = skill.dir ? skillAdmin?.metadataForDir(skill.dir) : undefined;
        return {
          ...skill,
          ...(managed ? managedSkillFields(managed) : {
            id: `custom:${skill.qualifiedName}`,
            trust: "personal" as const,
            sourceKind: "manual" as const,
            sourceLabel: "本地文件夹",
            scanStatus: "unscanned" as const,
            canRemove: false,
            canUpdate: false,
          }),
          requirements: ["core"] as const,
          defaultEnabled: true,
          available: true,
        };
      });
    } catch (e: unknown) {
      console.error("[leemo:host] user skills scan failed, continuing with bundled skills:", e);
      return [];
    }
  }

  function managedFamilySkills(): SkillInfo[] {
    if (!skillAdmin) return [];
    try {
      const records = skillAdmin.listManaged();
      const memberCounts = new Map<string, number>();
      for (const record of records) {
        if (record.packageId) memberCounts.set(record.packageId, (memberCounts.get(record.packageId) ?? 0) + 1);
      }
      return records.flatMap((record): SkillInfo[] => {
        if (!record.packageId || !record.qualifiedName || !record.familyCatalogId) return [];
        return [{
          name: record.name,
          commandName: record.candidate,
          qualifiedName: record.qualifiedName,
          source: "user",
          ...managedSkillFields(record, memberCounts.get(record.packageId) ?? 1),
          requirements: ["core"],
          defaultEnabled: true,
          available: record.available !== false,
          ...(record.unavailableReason ? { unavailableReason: record.unavailableReason } : {}),
        }];
      });
    } catch (error) {
      console.error("[leemo:host] managed family scan failed, continuing without family Skills:", error);
      return [];
    }
  }

  function listSkills(): SkillInfo[] {
    const office = officeSkills ? officeSkillMetadata(officeSkills.snapshot()) : [];
    const bundled = bundledSkills ? bundledSkillMetadata(bundledSkills.snapshot()) : [];
    const superpowers = superpowersSkills
      ? superpowersSkillMetadata(superpowersSkills.snapshot())
      : [];
    return [...bundled, ...office, ...superpowers, ...scanUserSkills(), ...managedFamilySkills()];
  }

  interface SkillSelection {
    enabledQualifiedNames: string[];
    enabledBundledIds: string[];
    enabledOfficeIds: string[];
    enabledSuperpowersIds: string[];
    enabledCustomQualifiedNames: string[];
    pluginPaths: string[];
  }

  function selectSkills(requestedQualifiedNames?: readonly string[]): SkillSelection {
    const catalog = listSkills();
    const known = new Map(catalog.map((skill) => [skill.qualifiedName, skill]));
    const requested = requestedQualifiedNames === undefined
      ? catalog
        .filter((skill) => skill.available !== false && (skill.source === "user" || skill.defaultEnabled))
        .map((skill) => skill.qualifiedName)
      : requestedQualifiedNames;
    const enabledQualifiedNames: string[] = [];
    const enabledBundledIds: string[] = [];
    const enabledOfficeIds: string[] = [];
    const enabledSuperpowersIds: string[] = [];
    const enabledCustomQualifiedNames: string[] = [];
    const managedFamilyPluginPaths = new Set<string>();
    for (const qualifiedName of requested) {
      if (enabledQualifiedNames.includes(qualifiedName)) continue;
      const skill = known.get(qualifiedName);
      if (!skill || skill.available === false) continue;
      if (skill.collectionId?.startsWith("family:")) {
        const pluginPath = skillAdmin?.pluginPathForQualifiedName(qualifiedName);
        if (!pluginPath) continue;
        managedFamilyPluginPaths.add(pluginPath);
      }
      enabledQualifiedNames.push(qualifiedName);
      const bundled = bundledSkillForQualifiedName(qualifiedName);
      if (bundled) enabledBundledIds.push(bundled.id);
      else {
        const office = officeSkillForQualifiedName(qualifiedName);
        if (office) enabledOfficeIds.push(office.officeId);
        else {
          const superpowers = superpowersSkillForQualifiedName(qualifiedName);
          if (superpowers) enabledSuperpowersIds.push(superpowers.id);
          else if (skill.source === "user" && !skill.collectionId?.startsWith("family:")) {
            enabledCustomQualifiedNames.push(qualifiedName);
          }
        }
      }
    }

    const pluginPaths: string[] = [];
    const bundledSnapshot = bundledSkills?.snapshot();
    if (enabledBundledIds.length > 0 && bundledSnapshot?.status === "ready") {
      pluginPaths.push(bundledSnapshot.pluginPath);
    }
    if (enabledCustomQualifiedNames.length > 0 && memoryDir) {
      pluginPaths.push(pluginRootFor(memoryDir));
    }
    pluginPaths.push(...managedFamilyPluginPaths);
    const officeSnapshot = officeSkills?.snapshot();
    if (enabledOfficeIds.length > 0 && officeSnapshot?.status === "ready") {
      pluginPaths.push(officeSnapshot.pluginPath);
    }
    const superpowersSnapshot = superpowersSkills?.snapshot();
    if (enabledSuperpowersIds.length > 0 && superpowersSnapshot?.status === "ready") {
      pluginPaths.push(superpowersSnapshot.pluginPath);
    }
    return {
      enabledQualifiedNames,
      enabledBundledIds,
      enabledOfficeIds,
      enabledSuperpowersIds,
      enabledCustomQualifiedNames,
      pluginPaths,
    };
  }

  function requestsSuperpowers(qualifiedNames: readonly string[] | undefined): boolean {
    return qualifiedNames?.some((name) => superpowersSkillForQualifiedName(name) !== undefined) === true;
  }

  function applySkillSelection(extras: ConversationExtras, selection: SkillSelection): void {
    extras.systemPromptAppend = withSuperpowersBootstrap(
      extras.systemPromptAppend,
      selection.enabledQualifiedNames.includes("superpowers:using-superpowers"),
    );
    if (selection.enabledQualifiedNames.length === 0) {
      extras.pluginPaths = [];
      // With no plugin there is nothing for the SDK allow-list to filter. Keep
      // the key absent so an older SDK cannot interpret [] as a request to load
      // its own unrelated default skills.
      delete extras.enabledSkills;
      delete extras.pluginPath;
      return;
    }
    extras.pluginPaths = [...selection.pluginPaths];
    extras.enabledSkills = [...selection.enabledQualifiedNames];
    delete extras.pluginPath;
  }

  function syncEnabledSkills(requestedQualifiedNames: readonly string[]): number {
    const selection = selectSkills(requestedQualifiedNames);
    let updatedConversations = 0;
    for (const rec of conversations.values()) {
      if (rec.purpose === "wiki") continue;
      applySkillSelection(rec.extras, selection);
      updatedConversations += 1;
    }
    return updatedConversations;
  }

  function requireSkillAdmin(): SkillAdminService {
    if (!skillAdmin) throw new Error("当前运行环境没有启用 Skill 安装服务。");
    return skillAdmin;
  }

  function installedSkillDirectory(idOrName: string): string | undefined {
    const key = idOrName.trim().toLocaleLowerCase();
    const matches = (skill: Pick<SkillInfo, "id" | "name" | "commandName" | "qualifiedName">): boolean => (
      skill.id?.toLocaleLowerCase() === key
      || skill.name.toLocaleLowerCase() === key
      || skill.commandName?.toLocaleLowerCase() === key
      || skill.qualifiedName.toLocaleLowerCase() === key
    );

    const bundled = bundledSkills?.snapshot().skills.find(matches);
    if (bundled) return bundled.sourceDir;
    const superpowers = superpowersSkills?.snapshot().skills.find(matches);
    if (superpowers) return superpowers.sourceDir;

    const installed = scanUserSkills().find(matches);
    if (installed?.dir) return installed.dir;
    const managed = skillAdmin?.listManaged().find((record) => (
      record.id.toLocaleLowerCase() === key
      || record.name.toLocaleLowerCase() === key
      || record.candidate.toLocaleLowerCase() === key
      || record.qualifiedName?.toLocaleLowerCase() === key
    ));
    if (managed) return managed.dir;

    const office = listSkills().find((skill) => matches(skill) && skill.qualifiedName.startsWith("leemo-office:"));
    const officeSnapshot = officeSkills?.snapshot();
    if (office && officeSnapshot?.status === "ready") {
      return path.join(officeSnapshot.pluginPath, "skills", office.commandName ?? office.name);
    }
    return undefined;
  }

  function readInstalledSkillMarkdown(directory: string): { markdown: string } {
    const file = path.join(directory, "SKILL.md");
    if (skillsIO?.exists(file)) return { markdown: skillsIO.readFile(file) };
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) {
      throw new Error("这个 Skill 的说明文档无法读取。");
    }
    return { markdown: fs.readFileSync(file, "utf8") };
  }

  async function loadSkillDetails(idOrName: string): Promise<{ markdown: string }> {
    const id = requiredSkillId(idOrName);
    const directory = installedSkillDirectory(id);
    if (directory) return readInstalledSkillMarkdown(directory);
    return await requireSkillAdmin().loadCatalogDetails(id);
  }

  function requiredSkillSource(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 2_048 || /[\u0000-\u001f]/u.test(value)) {
      throw new Error("Skill 来源链接或路径不合法。");
    }
    return value.trim();
  }

  function optionalSkillName(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.length > 64 || /[:\u0000-\u001f]/u.test(value)) {
      throw new Error("Skill 名称不合法。");
    }
    return value.trim();
  }

  function requiredSkillId(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 128 || /[\\/\u0000-\u001f]/u.test(value)) {
      throw new Error("Skill 标识不合法。");
    }
    return value.trim();
  }

  function safeMutationItem(record: ManagedSkillRecord): BridgeInvokeMap["bridge:installSkill"]["response"]["installed"][number] {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      trust: record.trust,
      sourceKind: record.sourceKind,
      sourceLabel: record.sourceLabel,
      scanStatus: record.scanStatus,
      securityFindings: record.findings.map((finding) => ({ ...finding })),
      ...(record.license ? { license: record.license } : {}),
      ...(record.revision ? { revision: record.revision } : {}),
      ...(record.repository ? { repository: record.repository } : {}),
      canUpdate: !record.packageId && (record.sourceKind === "github" || record.sourceKind === "skillsh"),
    };
  }

  async function inspectSkillSource(sourceValue: unknown, securityScan = false): Promise<SkillSourceInspectionView> {
    const inspection = await requireSkillAdmin().inspect(requiredSkillSource(sourceValue), { securityScan });
    // The renderer/model need provenance and scan evidence, never the original
    // local path. Keeping this projection in one helper prevents IPC and MCP
    // surfaces from drifting apart.
    return {
      sourceKind: inspection.sourceKind,
      sourceLabel: inspection.sourceLabel,
      candidates: inspection.candidates.map((candidate) => ({
        name: candidate.name,
        description: candidate.description,
        ...(candidate.scan ? {
          scan: {
            ...candidate.scan,
            findings: candidate.scan.findings.map((finding) => ({ ...finding })),
          },
        } : {}),
      })),
      ...(inspection.repository ? { repository: inspection.repository } : {}),
      ...(inspection.revision ? { revision: inspection.revision } : {}),
      ...(inspection.license ? { license: inspection.license } : {}),
      ...(inspection.sourceKind === "github" || inspection.sourceKind === "skillsh"
        ? { resolvedSource: inspection.resolvedSource }
        : {}),
    };
  }

  async function installSkill(
    sourceValue: unknown,
    candidateValue?: unknown,
    securityScan = false,
  ): Promise<SkillInstallOutcome> {
    const result = await requireSkillAdmin().install({
      source: requiredSkillSource(sourceValue),
      ...(candidateValue === undefined ? {} : { candidate: optionalSkillName(candidateValue) }),
      ...(securityScan ? { securityScan: true } : {}),
    });
    hotAddManagedSkills(result.installed);
    const installed = result.installed.map(safeMutationItem);
    const sourceLabel = installed[0]?.sourceLabel ?? "未知来源";
    const scanLabel = installed.some((skill) => skill.scanStatus === "unscanned")
      ? "未扫描"
      : installed.some((skill) => skill.scanStatus === "review" || skill.scanStatus === "blocked")
        ? "已记录风险"
        : "未发现明显风险";
    return {
      installed,
      receipt: `已安装 ${installed.map((skill) => skill.name).join("、")} · 来源 ${sourceLabel} · ${scanLabel}`,
    };
  }

  function skillInstallOutcome(records: readonly ManagedSkillRecord[], trusted = false): SkillInstallOutcome {
    const installed = records.map(safeMutationItem);
    const sourceLabel = installed[0]?.sourceLabel ?? "未知来源";
    const firstPackageId = records[0]?.packageId;
    const familyLabel = firstPackageId
      && records.length > 0
      && records.every((record) => record.packageId === firstPackageId && record.familyLabel === records[0]?.familyLabel)
      ? records[0]?.familyLabel
      : undefined;
    const scanLabel = trusted
      ? "已通过预审"
      : installed.some((skill) => skill.scanStatus === "unscanned")
        ? "未扫描"
        : installed.some((skill) => skill.scanStatus === "review" || skill.scanStatus === "blocked")
          ? "已记录风险"
          : "未发现明显风险";
    return {
      installed,
      receipt: familyLabel
        ? `已安装 ${familyLabel} · ${installed.length} 个技能 · 来源 ${sourceLabel} · ${scanLabel}`
        : `已安装 ${installed.map((skill) => skill.name).join("、")} · 来源 ${sourceLabel} · ${scanLabel}`,
    };
  }

  async function installCommunitySkill(idValue: unknown): Promise<SkillInstallOutcome> {
    const result = await requireSkillAdmin().installCatalog(requiredSkillId(idValue));
    hotAddManagedSkills(result.installed);
    return skillInstallOutcome(result.installed, true);
  }

  function scanInstalledSkill(idValue: unknown): ReturnType<typeof safeMutationItem> {
    return safeMutationItem(requireSkillAdmin().scanManaged(requiredSkillId(idValue)));
  }

  async function removeSkill(idValue: unknown): Promise<{ name?: string }> {
    const id = requiredSkillId(idValue);
    const service = requireSkillAdmin();
    const managed = service.listManaged();
    const record = managed.find((candidate) => candidate.id === id || candidate.name === id);
    const removed = record?.packageId
      ? managed.filter((candidate) => candidate.packageId === record.packageId)
      : record ? [record] : [];
    service.remove(id);
    hotRemoveManagedSkills(removed);
    return record?.name ? { name: record.name } : {};
  }

  function hotAddManagedSkills(records: readonly ManagedSkillRecord[]): void {
    if (records.length === 0) return;
    for (const rec of conversations.values()) {
      const current = rec.extras.enabledSkills ?? [];
      const next = [...current];
      for (const record of records) {
        const qualifiedName = record.qualifiedName ?? `${LEEMO_PLUGIN_NAME}:${record.candidate}`;
        if (!next.includes(qualifiedName)) next.push(qualifiedName);
      }
      applySkillSelection(rec.extras, selectSkills(next));
    }
  }

  function hotRemoveManagedSkills(records: readonly ManagedSkillRecord[]): void {
    if (records.length === 0) return;
    const qualifiedNames = new Set(records.map((record) => (
      record.qualifiedName ?? `${LEEMO_PLUGIN_NAME}:${record.candidate}`
    )));
    for (const rec of conversations.values()) {
      const current = rec.extras.enabledSkills ?? [];
      applySkillSelection(rec.extras, selectSkills(current.filter((name) => !qualifiedNames.has(name))));
    }
  }

  const approvalWaiters = new Map<
    string,
    {
      resolve: (d: ApprovalDecision) => void;
      conversationId: string;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const permissionDecisionTimeoutMs = Math.max(1, approvalTimeoutMs ?? 120_000);

  function settleApproval(id: string, decision: ApprovalDecision): boolean {
    const waiter = approvalWaiters.get(id);
    if (!waiter) return false;
    approvalWaiters.delete(id);
    clearTimeout(waiter.timeout);
    waiter.resolve(decision);
    return true;
  }
  const askOwner = new Map<string, string>(); // askPayload.id → conversationId
  const approvalPersistence: ApprovalPersistence = deps.approvalPersistence ?? {
    getWhitelist: (): WhitelistEntry[] => [],
    addToWhitelist: (): void => {},
    removeFromWhitelist: (): void => {},
  };

  // ── 搜索 shim（轮 4 卡 H2）─────────────────────────────────────────────
  //
  // 目标（用户 7/27 明确要求）：用户配好国内模型的 key 之后，**不必再配 VPN、
  // 也不必装 MCP**，CC 原生的 WebSearch/WebFetch 就该能用。
  //
  // 内置 WebSearch 的搜索动作实际由「上游端点实现 web_search 服务端工具」完成
  // （实测见 smoke/websearch-nested-probe.mjs）；DeepSeek 实现了，GLM/中转站没有，
  // 于是后两家返回**空壳**。shim 把那一种嵌套请求接下来、用 Leemo 自己的搜索链
  // 答掉，于是每一家行为一致，且不碰 claude.ai。
  //
  // 懒启动 + 只启动一次：createBridgeHost 是同步的，而监听端口是异步的。放在
  // 建对话那一步 await，顺带得到一个天然的降级点 —— 起不来就退回直连接线。
  let shimPromise: Promise<SearchShimHandle | undefined> | undefined;
  function ensureSearchShim(): Promise<SearchShimHandle | undefined> {
    shimPromise ??= startSearchShim({
      // 从**活的** catalog 取，不在构造时抓一份：用户在设置页换了 key，下一次
      // 搜索就该用新 key（与 getCatalog 同一条纪律）。
      resolveUpstream: (id) => {
        const entry = getCatalog().find((e) => e.provider.id === id);
        if (!entry) return undefined;
        return {
          baseUrl: entry.provider.baseUrl,
          apiKey: entry.provider.apiKey,
          ...(entry.apiKeyHeader ? { apiKeyHeader: entry.apiKeyHeader } : {}),
          ...(entry.headers ? { headers: { ...entry.headers } } : {}),
        };
      },
      resolveSearchPlan: (id) => buildSearchPlan(getCatalog(), id, httpFetch()),
      runSearch: async (query) => {
        const outcome = await runSearchChain(query, buildSourceChain(loadSearchKeys(providerStore)));
        return outcome ? outcome.hits : null;
      },
      logger: {
        info: (m) => console.log(`[leemo:search] ${m}`),
        warn: (m) => console.warn(`[leemo:search] ${m}`),
        error: (m) => console.error(`[leemo:search] ${m}`),
      },
    }).catch((e: unknown) => {
      // 端口起不来（极少见）不能让对话打不通。少一个搜索工具好过整个 app 不能聊。
      console.error("[leemo:search] shim failed to start, falling back to direct wiring:", e);
      return undefined;
    });
    return shimPromise;
  }

  /** Keep the fallback search MCP in lockstep with the current search wiring.
   *
   * `buildQueryFn` reads this mutable `extras` object for every round, so an
   * existing conversation can gain or lose the MCP without rebuilding its SDK
   * session. Clone the map instead of replacing it wholesale: ask_user and any
   * future user-configured MCPs must survive a search toggle. */
  function reconcileSearchMcp(extras: ConversationExtras, shouldRegister: boolean): void {
    const name = "leemo-web-search";
    const hasSearchMcp = Object.prototype.hasOwnProperty.call(extras.mcpServers, name);
    if (shouldRegister && !hasSearchMcp) {
      const searchMcp = createWebSearchMcp({ resolveKeys: () => loadSearchKeys(providerStore) });
      extras.mcpServers = { ...extras.mcpServers, [name]: searchMcp.server };
      return;
    }
    if (!shouldRegister && hasSearchMcp) {
      const next = { ...extras.mcpServers };
      delete next[name];
      extras.mcpServers = next;
    }
  }

  /** Academic search is independent of the generic-search wiring choice. Native
   * WebSearch and the fallback MCP are mutually exclusive, but neither exposes
   * arXiv's structured metadata, cache, or public-service rate limit. */
  function reconcileAcademicSearchMcp(extras: ConversationExtras, enabled: boolean): void {
    const name = "leemo-academic-search";
    const hasMcp = Object.prototype.hasOwnProperty.call(extras.mcpServers, name);
    if (enabled && !hasMcp) {
      const mcp = createAcademicSearchMcp({ search: (query) => academicSearch.search(query) });
      extras.mcpServers = { ...extras.mcpServers, [name]: mcp.server };
      return;
    }
    if (!enabled && hasMcp) {
      const next = { ...extras.mcpServers };
      delete next[name];
      extras.mcpServers = next;
    }
  }

  /** Apply every user-facing network-search gate in one place.
   *
   * The native WebSearch disallow list, the generic Leemo fallback, and the
   * structured arXiv tool are one product capability from the user's point of
   * view. Keeping them together prevents a future provider/tool addition from
   * updating only one of the three layers (prompt, exposure, permission). */
  function applySearchCapabilityWiring(
    extras: ConversationExtras,
    capabilities: Pick<RuntimeCapabilityState, "webSearchEnabled" | "webFetchEnabled">,
    wiring: SearchWiring,
  ): void {
    extras.disallowedTools = [
      ...(wiring.allowNativeWebSearch ? [] : ["WebSearch"]),
      ...(capabilities.webFetchEnabled ? [] : ["WebFetch"]),
    ];
    reconcileSearchMcp(extras, capabilities.webSearchEnabled && wiring.registerMcp);
    reconcileAcademicSearchMcp(extras, capabilities.webSearchEnabled);
  }

  function configuredMcps(): ReturnType<typeof configuredSdkMcpServers> {
    return configuredSdkMcpServers(providerStore?.read().mcpServers, builtinMcpRuntime);
  }

  /** Replace only the servers owned by encrypted user config. ask_user and the
   * search fallback stay alive, while save/delete takes effect next round. */
  function reconcileConfiguredMcps(rec: ConvRecord): void {
    if (rec.purpose === "wiki") return;
    const next = { ...rec.extras.mcpServers };
    for (const id of rec.configuredMcpIds) delete next[id];
    const configured = configuredMcps();
    for (const [id, server] of Object.entries(configured)) next[id] = server;
    rec.configuredMcpIds = new Set(Object.keys(configured));
    rec.extras.mcpServers = next;
    rec.personaCtx.browserEnabled = Object.prototype.hasOwnProperty.call(configured, PLAYWRIGHT_MCP_ID);
    rec.personaCtx.computerEnabled = Object.prototype.hasOwnProperty.call(configured, COMPUTER_MCP_ID);
    refreshMomoPrompt(rec);
  }

  function reconcileAllConfiguredMcps(): void {
    for (const rec of conversations.values()) reconcileConfiguredMcps(rec);
  }

  /** A missing or unreadable current view must never stop chat. */
  function loadGlobalMemory(): string | undefined {
    if (!readGlobalMemory) return undefined;
    try {
      return readGlobalMemory();
    } catch (e: unknown) {
      console.error("[leemo:host] global memory view unreadable, continuing without it:", e);
      return undefined;
    }
  }

  /** A stale notebook id or unreadable current view degrades without blocking.
   * Workspace metadata is resolved regardless of memory state; the current view
   * is touched only when the caller explicitly enables it. */
  function loadNotebook(notebookId: string | null | undefined, includeMemory: boolean):
    | { text?: string; dir: string; title: string }
    | undefined {
    if (!resolveNotebook || !notebookId) return undefined;
    try {
      const notebook = resolveNotebook(notebookId);
      if (!notebook || !includeMemory || !readNotebookMemory) return notebook;
      try {
        const text = readNotebookMemory(notebookId);
        return { ...notebook, ...(text === undefined ? {} : { text }) };
      } catch (e: unknown) {
        console.error("[leemo:host] notebook memory view unreadable, continuing without it:", e);
        return notebook;
      }
    } catch (e: unknown) {
      console.error("[leemo:host] notebook workspace unreadable, continuing from the root:", e);
      return undefined;
    }
  }

  function refreshMomoPrompt(rec: ConvRecord): void {
    const notebook = loadNotebook(
      rec.notebookId,
      rec.personaCtx.rememberMode && memoryGovernance === undefined,
    );
    rec.extras.systemPromptAppend = withSuperpowersBootstrap(buildMomoSystemPrompt({
      ...rec.personaCtx,
      workspaceRoot: rec.workspace.root,
      workspaceName: rec.workspace.name,
      workspaceKind: rec.workspace.kind,
      defaultArtifactDir: rec.workspace.kind === "home"
        ? path.join(rec.workspace.root, DEFAULT_WORKSPACE_DIR)
        : rec.workspace.root,
      ...(rec.personaCtx.rememberMode
        ? {
            memoryDir,
            ...(memoryGovernance === undefined || notebook !== undefined || rec.workspace.kind === "external"
              ? { memoryText: loadGlobalMemory() }
              : {}),
          }
        : {}),
      ...(notebook
        ? {
            notebookTitle: notebook.title,
            notebookDir: notebook.dir,
            ...(memoryGovernance === undefined && notebook.text !== undefined
              ? { notebookText: notebook.text }
              : {}),
          }
        : {}),
    }), rec.extras.enabledSkills?.includes("superpowers:using-superpowers") === true);
    if (isExternalAgentRecord(rec)) {
      rec.handle.setDeveloperInstructions(rec.extras.systemPromptAppend);
    }
  }

  function nativeMemoryDirectory(conversationId: string, roundId: number): string {
    const owner = createHash("sha256").update(conversationId).digest("hex").slice(0, 24);
    return path.join(dataDir, "native-memory", owner, `round-${roundId}`);
  }

  function isGovernedMemoryWrite(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
  ): boolean {
    const fileWriters = new Set([
      "Write",
      "Edit",
      "NotebookEdit",
      LEEMO_DOCUMENT_TOOL_NAMES.createWord,
      LEEMO_DOCUMENT_TOOL_NAMES.createPresentation,
      LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet,
    ]);
    if (!fileWriters.has(toolName)) return false;
    const key = toolName === "NotebookEdit" ? "notebook_path" : "file_path";
    const target = input[key];
    if (typeof target !== "string" || !target.trim()) return false;
    const absolute = path.resolve(cwd, target);
    const relative = path.relative(workspaceRoot, absolute);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return false;
    }
    const segments = relative.split(/[\\/]+/).map((segment) => segment.toLocaleLowerCase());
    return segments.some((segment, index) => segment === ".leemo" && segments[index + 1] === "memory");
  }

  const memoryWriteDeniedMessage =
    "长期记忆由 Leemo 管理，请使用记忆工具；普通文档请写入工作区。";

  interface GovernedToolInput {
    denied?: string;
    effectiveInput: Record<string, unknown>;
  }

  function isWorkspaceRoot(cwd: string, workspace: ConversationWorkspace): boolean {
    return samePath(cwd, workspace.root);
  }

  /** One source of truth for approval handling, SDK callbacks, and the native
   * CLI HTTP hook. The latter is the load-bearing packaged-app path: built-in
   * file tools do not consistently cross the SDK's callback bridge. */
  function governToolInput(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
    workspace: ConversationWorkspace,
  ): GovernedToolInput {
    if (isGovernedMemoryWrite(toolName, input, cwd)) {
      return { denied: memoryWriteDeniedMessage, effectiveInput: input };
    }
    if (
      workspace.kind === "home"
      && isWorkspaceRoot(cwd, workspace)
      && routeRootArtifactPath !== undefined
      && (
        toolName === "Write"
        || toolName === LEEMO_DOCUMENT_TOOL_NAMES.createWord
        || toolName === LEEMO_DOCUMENT_TOOL_NAMES.createPresentation
        || toolName === LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet
      )
      && typeof input.file_path === "string"
    ) {
      const originalPath = input.file_path;
      let routeCandidate = originalPath;
      let returnAbsolute = false;
      if (path.isAbsolute(originalPath)) {
        const relative = path.relative(workspace.root, originalPath);
        if (
          !relative
          || relative === ".."
          || relative.startsWith(`..${path.sep}`)
          || path.isAbsolute(relative)
        ) return { effectiveInput: input };
        routeCandidate = relative;
        returnAbsolute = true;
      } else if (
        originalPath.startsWith("/")
        || originalPath.startsWith("\\")
        || /^[A-Za-z]:[\\/]/.test(originalPath)
      ) {
        return { effectiveInput: input };
      }

      const routedPath = routeRootArtifactPath(routeCandidate);
      if (routedPath !== routeCandidate) {
        return {
          effectiveInput: {
            ...input,
            file_path: returnAbsolute ? path.resolve(workspace.root, routedPath) : routedPath,
          },
        };
      }
    }
    return { effectiveInput: input };
  }

  function handleNativeToolGovernanceHook(value: unknown): unknown {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      console.warn("[leemo:tool-hook] ignored malformed non-object input");
      return {};
    }
    const input = value as Record<string, unknown>;
    if (
      input.hook_event_name !== "PreToolUse"
      || typeof input.tool_name !== "string"
      || typeof input.cwd !== "string"
      || typeof input.tool_input !== "object"
      || input.tool_input === null
      || Array.isArray(input.tool_input)
    ) {
      console.warn(
        `[leemo:tool-hook] ignored malformed input event=${String(input.hook_event_name)} tool=${typeof input.tool_name} cwd=${typeof input.cwd} toolInput=${typeof input.tool_input}`,
      );
      return {};
    }

    const originalInput = input.tool_input as Record<string, unknown>;
    const workspace = workspaceForCwd(input.cwd);
    const governed = governToolInput(input.tool_name, originalInput, input.cwd, workspace);
    if (governed.denied !== undefined) {
      console.log(`[leemo:tool-hook] tool=${input.tool_name} decision=deny cwd=root:${isWorkspaceRoot(input.cwd, workspace)}`);
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: governed.denied,
        },
      };
    }
    if (governed.effectiveInput === originalInput) {
      console.log(`[leemo:tool-hook] tool=${input.tool_name} decision=pass cwd=root:${isWorkspaceRoot(input.cwd, workspace)}`);
      return {};
    }
    console.log(`[leemo:tool-hook] tool=${input.tool_name} decision=route cwd=root:${isWorkspaceRoot(input.cwd, workspace)}`);
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: governed.effectiveInput,
      },
    };
  }

  function reconcileMemoryMcp(rec: ConvRecord): void {
    if (rec.personaCtx.rememberMode && rec.memoryMcp) {
      rec.extras.mcpServers["leemo-memory"] = rec.memoryMcp.server;
    } else {
      delete rec.extras.mcpServers["leemo-memory"];
    }
  }

  /** Installed skills, normalized (bare `name` for the UI, `qualifiedName` for
   *  the SDK). A scan failure degrades to "no skills": the SkillsPage showing an
   *  empty list is recoverable, a rejected invoke would break the page. */
  // ── 搜索源 key (轮 4 卡 H) ──────────────────────────────────────────────
  // 每个源的 note 都是本轮实测的结论，不是宣传语 —— 设置页要让用户看懂"配了
  // 会怎样、不配会怎样"，而不是只给个输入框。
  const SEARCH_SOURCE_META: readonly {
    id: SearchSourceId;
    label: string;
    keyless: boolean;
    note: string;
    blockedReason?: string;
  }[] = [
    {
      id: "anysearch",
      label: "AnySearch",
      keyless: true,
      note: "开箱可用的默认来源，通常无需配置。",
    },
    {
      id: "doubao",
      label: "豆包搜索",
      keyless: false,
      note: "更适合中文时效信息，配置后自动作为增强来源。",
    },
    {
      id: "metaso",
      label: "秘塔搜索",
      keyless: false,
      note: "更适合中文研究与引用，只把可核验来源交给 momo。",
    },
    {
      id: "tavily",
      label: "Tavily",
      keyless: false,
      note: "覆盖面稳定的通用备用来源，需要 API Key。",
    },
    {
      id: "bocha",
      label: "博查",
      keyless: false,
      note: "国内通用备用来源，需要 API Key。",
    },
    {
      id: "google",
      label: "Google Custom Search",
      keyless: false,
      note: "仅兼容已有 API Key 与搜索引擎 ID；服务已停止接受新用户，不作为默认来源。",
    },
    {
      id: "exa",
      label: "Exa",
      keyless: false,
      note: "面向 AI 的语义搜索，配置后作为通用增强来源。",
    },
    {
      id: "brave",
      label: "Brave Search",
      keyless: false,
      note: "使用独立网页索引的通用来源，需要 API Key。",
    },
    {
      id: "serpapi",
      label: "SerpAPI",
      keyless: false,
      note: "兼容 Google 搜索结果的备用来源，需要 API Key。",
    },
    {
      id: "serper",
      label: "Serper",
      keyless: false,
      note: "轻量 Google 搜索 API，需要 API Key。",
    },
    {
      id: "bing",
      label: "Bing Search",
      keyless: false,
      note: "Bing Search API 已停止服务。",
      blockedReason: "Bing Search API 已停止服务。",
    },
    {
      id: "firecrawl",
      label: "Firecrawl",
      keyless: false,
      note: "搜索网页并返回可引用摘要，需要 API Key。",
    },
  ];

  function searchSourceStatuses(): SearchSourceStatus[] {
    const keys = loadSearchKeys(deps.providerStore);
    const configured: Record<SearchSourceId, boolean> = {
      anysearch: !!keys.anysearchKey,
      doubao: !!keys.doubaoKey,
      metaso: !!keys.metasoKey,
      tavily: !!keys.tavilyKey,
      bocha: !!keys.bochaKey,
      google: !!keys.googleKey && !!keys.googleCx,
      exa: !!keys.exaKey,
      brave: !!keys.braveKey,
      serpapi: !!keys.serpapiKey,
      serper: !!keys.serperKey,
      bing: false,
      firecrawl: !!keys.firecrawlKey,
    };
    return SEARCH_SOURCE_META.map((m) => ({
      ...m,
      configured: configured[m.id],
      configuredFields: m.id === "google"
        ? [
            ...(keys.googleKey ? ["apiKey" as const] : []),
            ...(keys.googleCx ? ["engineId" as const] : []),
          ]
        : configured[m.id]
          ? ["apiKey" as const]
          : [],
    }));
  }

  /** 存搜索源凭据（空串 = 清除）。写进 provider 那同一份加密件。 */
  function saveSearchKey(draft: BridgeInvokeMap["bridge:saveSearchKey"]["request"]): SearchSourceStatus[] {
    if (draft.source === "bing") {
      throw new Error("Bing Search API 已停止服务，无法保存配置。");
    }
    // 没有 store 就没有能加密落盘的地方。静默假装存好了是最坏的结果 —— 用户会
    // 以为配好了，然后搜索一直用不上那把 key。requireProviderStore 报的是同一
    // 句人话，跟 provider 那五条通道保持一致。
    const store = requireProviderStore();
    const config = store.read();
    const trimmed = draft.apiKey.trim();
    const next = { ...(config.searchKeys ?? {}) };
    if (draft.source === "google") {
      const engineId = draft.engineId?.trim() ?? "";
      if (!!trimmed !== !!engineId) {
        throw new Error("Google 搜索需要同时填写或同时清除 API Key 与搜索引擎 ID。");
      }
      if (trimmed) {
        next.google = trimmed;
        next.googleCx = engineId;
      } else {
        delete next.google;
        delete next.googleCx;
      }
    } else if (trimmed) {
      next[draft.source] = trimmed;
    } else {
      delete next[draft.source];
    }
    store.write({ ...config, searchKeys: next });
    return searchSourceStatuses();
  }

  // async since 轮 4 卡 H2: the search shim's port is only known after it listens.
  async function assemble(
    r: BridgeInvokeMap["bridge:createConversation"]["request"],
  ): Promise<string> {
    const entry = getCatalog().find((e) => e.provider.id === r.providerId);
    if (!entry) throw new Error(`unknown provider: ${r.providerId}`);
    const useExternalAgentRuntime = entry.executionEngine !== "claude-agent-sdk";
    const externalRuntime = entry.executionEngine === "openai-app-server"
      ? codexRuntime
      : entry.executionEngine === "gemini-acp"
        ? geminiRuntime
        : undefined;
    if (useExternalAgentRuntime && !externalRuntime) {
      throw new Error(entry.executionEngine === "gemini-acp"
        ? "使用 Gemini 订阅前，请先安装 Gemini 客户端并完成 Google 登录，然后重启 Leemo。"
        : "使用 ChatGPT 订阅前，请先安装 Codex 并完成登录，然后重启 Leemo。");
    }
    // 轮 3 卡 F: the catalog now lists UNCONFIGURED families as offers, whose
    // apiKey is deliberately "". Refuse here with something a person can act on
    // — letting a blank token through would surface as an opaque upstream 401
    // several layers away from the actual cause.
    if (!providerIsReady(entry)) {
      throw new Error(setupMessage(entry, "再开始对话。"));
    }
    await requireLiveSubscription(entry);

    const isWiki = r.purpose === "wiki";

    // A fresh install prepares the official document workflow in the
    // background. If the user starts chatting first, join that same promise so
    // the very first Office request does not race an almost-finished download.
    // Failure is state, not a thrown conversation error: deterministic document
    // tools remain available and the next create/sync may retry.
    if (!isWiki) {
      await Promise.all([
        officeSkills?.ensureReady(),
        bundledSkills?.ensureReady(),
        ...(requestsSuperpowers(r.enabledSkills) ? [superpowersSkills?.ensureReady()] : []),
      ]);
    }
    const skillSelection = selectSkills(isWiki ? [] : r.enabledSkills);

    // 轮 4「三层开关」: both flags arrive already masked by the renderer's 统筹
    // switch. Search defaults OFF (never hand a network tool to a caller that
    // said nothing), fetch defaults ON (it has been unconditionally allowed
    // since 卡 H2 — an older renderer must not silently lose it).
    const searchEnabled = isWiki ? false : (r.webSearchEnabled ?? false);
    const fetchEnabled = isWiki ? false : (r.webFetchEnabled ?? true);

    // A mutable extras container the queryFn reads at send-time. buildQueryFn
    // reads extras fields lazily (per call), and send() always happens after
    // this function returns — so the broker/askMcp back-fill below is visible
    // to every real query. This resolves the broker-needs-cid ordering: the
    // queryFn is closed over the container BEFORE the handle (hence cid) exists;
    // canUseTool/mcpServers are filled once the cid is known.
    // 轮 7 A1 —— 本子 = 工作区。Hoisted above `extras` because the notebook now
    // decides the **cwd**, not just prompt layer ⑨: a conversation opened inside
    // 「高等数学」 runs with cwd=`~/Leemo/高等数学/`, so when momo says
    // "写好了 第五章笔记.md" that is literally the file the user sees in that
    // folder. A conversation with no notebook (momo 主人格) runs at the
    // workspace ROOT — which is also why it can see and move things across all
    // 本子: they are its subdirectories.
    const rememberMode = isWiki ? false : (r.rememberMode ?? true);
    const conversationWorkspace = resolveConversationWorkspace(r.workspaceId);
    if (conversationWorkspace.kind === "external" && r.notebookId) {
      throw new Error("外部工作区里的文件夹不是本子，请直接在当前工作区开始对话。");
    }
    const notebook = conversationWorkspace.kind === "home"
      ? loadNotebook(r.notebookId, rememberMode && memoryGovernance === undefined)
      : undefined;
    const conversationCwd = notebook?.dir ?? conversationWorkspace.root;
    const initialConfiguredMcps = isWiki ? {} : configuredMcps();
    const rootWriteRouting = conversationWorkspace.kind === "home"
      && isWorkspaceRoot(conversationCwd, conversationWorkspace)
      && routeRootArtifactPath !== undefined
      ? { routeRootWritePath: routeRootArtifactPath }
      : {};
    const documentMcp = createDocumentMcp({
      workspaceRoot: conversationWorkspace.root,
      cwd: conversationCwd,
      ...rootWriteRouting,
    });
    const visualizationMcp = createVisualizationMcp({
      workspaceRoot: conversationWorkspace.root,
      cwd: conversationCwd,
      ...rootWriteRouting,
    });

    // 轮 7 A3 —— remember the persona inputs as applied, so `bridge:updateContext`
    // can merge a partial change (the renderer only knows what the user touched)
    // and rebuild the prompt without re-deriving defaults differently here and
    // there. Same defaults as the prompt call below, resolved exactly once.
    const personaCtx: RuntimeCapabilityState & {
      mode: "buddy" | "workbench";
      personaText: string;
      talkStyle: 1 | 2 | 3;
    } = {
      mode: r.mode ?? ("buddy" as const),
      personaText: r.personaText ?? DEFAULT_PERSONA_TEXT,
      talkStyle: r.talkStyle ?? (2 as 1 | 2 | 3),
      webSearchEnabled: searchEnabled,
      webFetchEnabled: fetchEnabled,
      rememberMode,
      browserEnabled: Object.prototype.hasOwnProperty.call(initialConfiguredMcps, PLAYWRIGHT_MCP_ID),
      computerEnabled: Object.prototype.hasOwnProperty.call(initialConfiguredMcps, COMPUTER_MCP_ID),
    };

    const extras: ConversationExtras = {
      cwd: conversationCwd,
      // The adapter keeps native plan mode for its read-only boundary. Other
      // product-facing modes are enforced by Leemo's broker so SDK shortcuts
      // cannot skip workspace and governed-memory rules.
      permissionMode: isWiki ? "plan" : (r.permissionMode ?? DEFAULT_PERMISSION_POLICY.mode),
      // 打包态才有值；dev/tests 下这个键必须真的不存在（见 sdk-adapter 的注释）。
      ...(cliExecutablePath !== undefined ? { cliExecutablePath } : {}),
      canUseTool: (() => {
        throw new Error("canUseTool used before assembly finished");
      }) as unknown as ConversationExtras["canUseTool"],
      hooks: {
        PreToolUse: [{
          matcher: "Write|Edit|NotebookEdit",
          hooks: [async (hookInput) => {
            if (
              hookInput.hook_event_name !== "PreToolUse"
              || typeof hookInput.tool_input !== "object"
              || hookInput.tool_input === null
              || Array.isArray(hookInput.tool_input)
            ) {
              return { continue: true };
            }
            const originalInput = hookInput.tool_input as Record<string, unknown>;
            const governed = governToolInput(
              hookInput.tool_name,
              originalInput,
              conversationCwd,
              conversationWorkspace,
            );
            if (governed.denied !== undefined) {
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: governed.denied,
                },
              };
            }
            if (governed.effectiveInput === originalInput) return { continue: true };
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "allow",
                updatedInput: governed.effectiveInput,
              },
            };
          }],
        }],
      },
      mcpServers: {},
      // The SDK defaults Auto Memory on. Start fail-closed, then `drain`
      // enables it only after a private round cache is ready.
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
      systemPromptAppend: buildMomoSystemPrompt({
        // Persona context comes from the renderer (only it knows the active
        // card/mode/slider). Omitted fields fall back to momo's defaults so
        // pre-existing callers still get momo rather than a bare agent.
        ...personaCtx,
        workspaceRoot: conversationWorkspace.root,
        workspaceName: conversationWorkspace.name,
        workspaceKind: conversationWorkspace.kind,
        defaultArtifactDir: conversationWorkspace.kind === "home"
          ? path.join(conversationWorkspace.root, DEFAULT_WORKSPACE_DIR)
          : conversationWorkspace.root,
        // Read per conversation so newly governed facts are visible immediately.
        ...(personaCtx.rememberMode
          ? {
              memoryDir,
              // Root memory is loaded natively. A notebook session loads its
              // narrower scope natively and keeps only the global overlay here.
              ...(memoryGovernance === undefined || notebook !== undefined || conversationWorkspace.kind === "external"
                ? { memoryText: loadGlobalMemory() }
                : {}),
            }
          : {}),
        // The renderer sends only a notebook id; host owns the current view.
        ...(notebook
          ? {
              notebookTitle: notebook.title,
              notebookDir: notebook.dir,
              ...(memoryGovernance === undefined && notebook.text !== undefined
                ? { notebookText: notebook.text }
                : {}),
            }
          : {}),
      }),
    };
    // Built-ins and user-authored skills are separate local plugins. Applying
    // the normalized selection here also handles the explicit all-off case:
    // no plugin path remains, so slash-command expansion cannot bypass the UI.
    applySkillSelection(extras, skillSelection);
    const queryFn = useExternalAgentRuntime ? undefined : buildQueryFn(extras, queryImpl);

    // Resolved BEFORE createConversation because the env wiring needs the port.
    // See the search block further down for the three-state rationale.
    const governanceGateway = !useExternalAgentRuntime && toolGovernanceHookUrl === undefined && queryImpl === undefined
      ? await ensureGateway()
      : undefined;
    const nativeToolGovernanceHookUrl = toolGovernanceHookUrl
      ?? (governanceGateway === undefined
        ? undefined
        : `http://127.0.0.1:${governanceGateway.port}${toolGovernanceHookPath}`);
    if (!useExternalAgentRuntime && queryImpl === undefined && nativeToolGovernanceHookUrl === undefined) {
      throw new Error("本地工作区保护启动失败，请重试。");
    }
    const shim = !useExternalAgentRuntime && providerNeedsAnthropicShim(entry, searchEnabled)
      ? await ensureSearchShim()
      : undefined;
    const gatewayPort = !useExternalAgentRuntime && entry.provider.apiFormat !== "anthropic"
      // Legacy/test callers may inject a port. The desktop renderer never does;
      // production always takes the host-owned gateway path.
      ? r.gatewayPort ?? governanceGateway?.port ?? (await ensureGateway())?.port
      : undefined;
    if (!useExternalAgentRuntime && entry.provider.apiFormat !== "anthropic" && gatewayPort === undefined) {
      throw new Error("OpenAI 兼容网关启动失败，请重试或切换 Anthropic 兼容服务商。");
    }

    let bridge: Bridge | undefined;
    let claudeHandle: ConversationHandle | undefined;
    // A re-claim (轮 2 卡 C) hands us the id the renderer already persisted, plus
    // the session to resume. Everything downstream — broker, askMcp, push
    // envelopes — is keyed off `cid`, so adopting the caller's id keeps the
    // renderer's timeline and its SQLite primary key untouched.
    let cid = r.conversationId ?? randomUUID();
    if (!useExternalAgentRuntime) {
      bridge = createBridge({ queryFn: queryFn!, dataDir });
      claudeHandle = bridge.createConversation({
        provider: entry.provider,
        modelId: r.modelId,
        ...(gatewayPort !== undefined ? { gatewayPort } : {}),
        // Only anthropic providers get the shim; openai ones must go through the
        // gateway for translation (buildConversationEnv enforces the precedence).
        ...(shim ? { searchShimPort: shim.port } : {}),
        id: cid,
        ...(r.resumeSessionId !== undefined ? { resume: r.resumeSessionId } : {}),
      });
      cid = claudeHandle.id;
    }

    const approvalTransport = {
      request(req: ApprovalRequest): Promise<ApprovalDecision> {
        push("bridge:approvalRequest", req);
        return new Promise<ApprovalDecision>((resolve) => {
          const conversationId = cid;
          const timeout = setTimeout(() => {
            const waiter = approvalWaiters.get(req.id);
            if (!waiter) return;
            const conversationId = waiter.conversationId;
            if (!settleApproval(req.id, {
              id: req.id,
              decision: "deny",
              message: "approval timed out",
            })) return;
            push("bridge:approvalExpired", { id: req.id, conversationId });
          }, permissionDecisionTimeoutMs);
          approvalWaiters.set(req.id, { resolve, conversationId, timeout });
        });
      },
    };
    // 轮 7 A4: spread-on-defined for BOTH fields, so an older renderer that
    // sends neither still gets the safe default policy verbatim.
    // 轮 7 A3: this object is MUTATED by bridge:updateContext — the broker reads
    // `policy.mode` at call time, so a permission-mode change is live without
    // rebuilding the broker (which would drop an in-flight approval).
    const policy: PermissionPolicy = {
      ...DEFAULT_PERMISSION_POLICY,
      ...(isWiki
        ? { mode: "plan" as const }
        : r.permissionMode !== undefined
          ? { mode: r.permissionMode }
          : {}),
      ...(r.dangerousCommandCaching !== undefined
        ? { dangerousCommandCaching: r.dangerousCommandCaching }
        : {}),
      ...(filesystemBoundary !== undefined
        ? {
            filesystemBoundary: conversationWorkspace.kind === "home"
              ? filesystemBoundary
              : conversationWorkspace.root,
            filesystemCwd: conversationCwd,
          }
        : {}),
    };
    const broker = createApprovalBroker(cid, approvalTransport, approvalPersistence, policy, personaCtx);

    const askTransport = {
      ask(p: AskUserPayload): Promise<void> {
        askOwner.set(p.id, cid);
        push("bridge:askUser", p);
        return Promise.resolve();
      },
    };
    const askMcp = createAskUserMcp(cid, askTransport);
    const workOverviewMcp = createWorkOverviewMcp();
    const memoryScope: MemoryScope = conversationWorkspace.kind === "external"
      ? { type: "workspace", workspaceId: conversationWorkspace.id }
      : notebook
        ? { type: "notebook", notebookId: r.notebookId as string }
        : { type: "global" };
    const memoryMcp = memoryGovernance
      ? createMemoryMcp({
          governance: memoryGovernance,
          conversationId: cid,
          ...(notebook ? { notebookId: r.notebookId as string } : {}),
          ...(conversationWorkspace.kind === "external" ? { workspaceId: conversationWorkspace.id } : {}),
          onChange: (change) => pushMemoryChange(cid, change),
        })
      : undefined;
    const skillAdminMcp = skillAdmin
      ? createSkillAdminMcp({
          inspect: (source, options) => inspectSkillSource(source, options?.securityScan === true),
          listCatalog: () => requireSkillAdmin().listCatalog() as CommunitySkillView[],
          installCatalog: (id) => installCommunitySkill(id),
          scanInstalled: (id) => scanInstalledSkill(id),
          install: (input) => installSkill(input.source, input.candidate, input.securityScan === true),
          remove: (id) => removeSkill(id),
        })
      : undefined;
    const learningMcp = learningService
      ? createLearningMcp({ service: learningService, conversationId: cid })
      : undefined;
    const scheduledTaskMcp = scheduledTasks
      ? createScheduledTaskMcp({ service: scheduledTasks, workspaceId: conversationWorkspace.id })
      : undefined;
    const captureTaskMcp = captures && tasks
      ? createCaptureTaskMcp({
          captures,
          tasks,
          ...(r.notebookId ? { notebookId: r.notebookId } : {}),
        })
      : undefined;

    // Back-fill the container now that cid-bound broker/askMcp exist.
    extras.canUseTool = async (toolName, input, options) => {
      if (isWiki) {
        return {
          behavior: "deny",
          message: "选区问答只分析当前选中的内容，不会执行工具。需要操作文件时请交给主对话里的 momo。",
        };
      }
      const governed = governToolInput(toolName, input, conversationCwd, conversationWorkspace);
      if (governed.denied !== undefined) {
        return {
          behavior: "deny",
          message: governed.denied,
        };
      }
      const { effectiveInput } = governed;
      const decision = await broker.canUseTool(toolName, effectiveInput, options);
      if (decision === null || decision.behavior !== "allow" || effectiveInput === input) return decision;
      return {
        ...decision,
        updatedInput: {
          ...effectiveInput,
          ...(decision.updatedInput ?? {}),
        },
      };
    };
    extras.mcpServers = isWiki
      ? {}
      : {
          "leemo-ask-user": askMcp.server,
          ...initialConfiguredMcps,
          "leemo-documents": documentMcp.server,
          "leemo-visualization": visualizationMcp.server,
        };
    // A stale or hand-edited config must not impersonate Leemo's reserved
    // in-process service. Reassignment preserves the established display order.
    if (!isWiki) extras.mcpServers["leemo-ask-user"] = askMcp.server;
    if (!isWiki) {
      extras.mcpServers["leemo-documents"] = documentMcp.server;
      extras.mcpServers["leemo-visualization"] = visualizationMcp.server;
      extras.mcpServers["leemo-work-overview"] = workOverviewMcp.server;
    }
    if (personaCtx.rememberMode && memoryMcp) extras.mcpServers["leemo-memory"] = memoryMcp.server;
    if (!isWiki && skillAdminMcp) extras.mcpServers["leemo-skill-admin"] = skillAdminMcp.server;
    if (!isWiki && learningMcp) extras.mcpServers["leemo-learning"] = learningMcp.server;
    if (!isWiki && scheduledTaskMcp) extras.mcpServers["leemo-scheduler"] = scheduledTaskMcp.server;
    if (!isWiki && captureTaskMcp) extras.mcpServers["leemo-workboard"] = captureTaskMcp.server;

    // 轮 4 卡 H: Leemo's own search MCP, registered only when the user has the
    // toggle on — prompt layer ⑦ already tells momo whether it can search, and
    // handing it a tool the prompt says it doesn't have is the surest way to get
    // "let me search that" followed by nothing.
    //
    // ── 内置 WebSearch / WebFetch 的取舍（轮 4 卡 H 补验后修正）────────────
    //
    // 卡 H 原本无条件禁掉这两个，依据是 06 §4.1「内置 WebSearch 是 Anthropic 服
    // 务端工具，第三方端点失效」。**对照实验推翻了其中一半**
    // （smoke/websearch-arms.mjs，四臂实测，结果 JSON 在 smoke/results/）：
    //
    //   端点        内置 WebSearch              内置 WebFetch
    //   DeepSeek    ✅ 真结果（Links 数组 5 URL）  ✅ 拿到页面内容
    //   GLM         ❌ 空壳（不报错、零链接）       ✅
    //   中转站      ❌ 空壳（模型自陈"未提供搜索工具"）✅
    //
    // 于是两条都改：
    //
    // ① **WebFetch 解禁。** 三家全都能用，§4.1 说保留是对的，禁它是我的错 ——
    //    抓一个已知 URL 是内置能力，自建搜索替代不了。注意它的域名安全预检要
    //    回连 claude.ai：这台机器不开代理时全端点失败，那是网络问题、与端点无关。
    //
    // ② **WebSearch 继续禁。** 理由从"它不能用"换成了更硬的一条：它的失败形态
    //    在 GLM/中转站上是**空壳** —— 不标 error、零链接、`tool_result` 里装着
    //    模型自己写的话，被 CC 包成 "Web search results for query:…" 的样子。
    //    这比报错危险得多：模型很容易照着那个空壳编造"搜到的"内容（本轮 GLM 与
    //    中转站的模型都如实说了"没搜到"，但那是模型的自觉，不是架构保证）。
    //    而且它按 provider 分裂 —— 同一个开关在不同家行为不同，等于把"能不能
    //    搜"变成用户猜谜。自建 MCP 在所有 provider 上行为一致、失败时明确说
    //    "搜索失败了，别编"，这个一致性值得放弃 DeepSeek 上那一份可用性。
    //
    // TODO(内置搜索按 kind 放行): 若将来要在 DeepSeek 这类**实测可用**的家上
    // 放行内置 WebSearch，判据不能是"第三方 vs 官方"（本轮已证伪），只能是逐家
    // 实测 + catalog 里显式标记 capability。那是另一张卡。
    //
    // ── 轮 4 卡 H2：改成放行内置 WebSearch，由本地 shim 供货 ────────────────
    //
    // 上面那段留着，因为它记录的实测事实仍然成立（GLM/中转站的空壳、按 provider
    // 分裂）。变的是**结论**：既然嵌套搜索请求发往我们自己能决定的 base URL，
    // 那"分裂"就不是内置工具的固有属性，而是"谁来供货"的问题。shim 供货之后，
    // 内置 WebSearch 在每一家都拿到同一条链（AnySearch 免 key → Tavily），失败
    // 时也给同一种明确的错误块 —— 一致性拿到了，还不用教用户装 MCP。
    //
    // 三态，永远只有一条搜索路径：
    //   ① 联网关 → 禁 WebSearch，不注册 MCP（层⑦ 也说了"不能搜"）
    //   ② 联网开 + shim 在 → 放行内置 WebSearch，不注册 MCP
    //   ③ 联网开 + shim 挂 → 禁 WebSearch，注册 MCP 兜底
    const wiring = chooseSearchWiring({
      enabled: searchEnabled,
      // 必须同时满足：shim 起来了 **且** 这家真走 shim。openai 家走网关，网关会
      // 剥掉服务端工具 ⇒ 放行内置 WebSearch 只会喂给模型一个空壳。
      shimServesThisConversation:
        searchEnabled && shim !== undefined && entry.provider.apiFormat === "anthropic",
    });
    // ── 轮 4「三层开关」: WebFetch 也归用户管 ───────────────────────────────
    //
    // 卡 H2 把 WebFetch 改成**无条件放行**，理由是"抓一个已知 URL 是自建搜索
    // 替代不了的能力"。那个理由仍然成立 —— 变的是**谁来决定**：用户 7/27 要求
    // 「联网抓取 WebFetch，关闭后 momo 再也访问不了网页」，那就必须真的关掉，
    // 而不是只在 prompt 里劝它别抓（模型有工具就会用，layer ⑦ 拦不住）。
    //
    // 禁用面同时是两处：这里禁工具（结构性），layer ⑦ 说明状态（让它别宣告一个
    // 做不到的动作）。缺任一处都是那种"看起来关了其实没关"的开关。
    // shim 起不来的降级路径。helper 传 store 而不是传已读好的值：resolveKeys
    // 在每次搜索时才被调用，那时才现读加密件 —— 设置页刚存的 key 当轮就生效。
    applySearchCapabilityWiring(extras, personaCtx, wiring);
    // WebFetch：**去掉对 claude.ai 的回连**。它的域名安全预检是
    // `GET https://api.anthropic.com/api/web/domain_info?domain=<host>`，本机实测
    // 返回 403（Cloudflare 按网络/地区拒，不是缺 key —— 那个 GET 不带鉴权），于是
    // 国内直连必然 check_failed，抓取在真正发起之前就被判死。
    // 开关置真后整段预检跳过，抓取全程在本地（axios GET + turndown），只有"把
    // markdown 交给模型总结"那一步走用户自己的端点。实测（
    // smoke/webfetch-preflight-probe.mjs）：不设开关复现原报错，设了之后
    // example.com 与国内站都通，**全程无代理**。
    extras.cliSettings = {
      skipWebFetchPreflight: true,
      ...(nativeToolGovernanceHookUrl === undefined
        ? {}
        : {
            hooks: {
              PreToolUse: [{
                matcher: "Write|Edit|NotebookEdit",
                hooks: [{
                  type: "http" as const,
                  url: nativeToolGovernanceHookUrl,
                  timeout: 5,
                }],
              }],
            },
            allowedHttpHookUrls: [nativeToolGovernanceHookUrl],
          }),
    };

    const commonRecord = {
      purpose: isWiki ? "wiki" : "main",
      broker, askMcp, memoryMcp, skillAdminMcp, memoryScope, entry, modelId: r.modelId,
      workspace: conversationWorkspace,
      cwd: conversationCwd,
      // 轮 7 A3: keep the live containers so updateContext can rewrite them.
      // `?? undefined` collapses the contract's `string | null` (null = 放养,
      // explicitly not in a 本子) to the single "no notebook" value loadNotebook
      // already understands.
      extras, policy, personaCtx, notebookId: r.notebookId ?? undefined,
      configuredMcpIds: new Set(Object.keys(initialConfiguredMcps)),
      nextRoundId: 0,
      modelUsageCursor: createModelUsageCursor(),
      queuedGuidanceFollowUp: false,
    } satisfies Omit<ConvRecord, "engine" | "handle" | "bridge">;
    if (useExternalAgentRuntime) {
      const externalMcpServers = { ...extras.mcpServers };
      if (!isWiki) {
        externalMcpServers["leemo-web-search"] ??= createWebSearchMcp({
          resolveKeys: () => loadSearchKeys(providerStore),
        }).server;
        externalMcpServers["leemo-academic-search"] ??= createAcademicSearchMcp({
          search: (query) => academicSearch.search(query),
        }).server;
        if (memoryMcp) externalMcpServers["leemo-memory"] ??= memoryMcp.server;
      }
      const dynamicTools = await createCodexDynamicToolRegistry({
        servers: externalMcpServers,
        cwd: conversationCwd,
        authorize: async (toolName, input, callId) => {
          const decision = await extras.canUseTool(toolName, input, {
            signal: new AbortController().signal,
            toolUseID: callId,
            requestId: callId,
          });
          if (decision === null || decision.behavior !== "allow") {
            return {
              allowed: false,
              ...(decision?.message ? { message: decision.message } : {}),
            };
          }
          return {
            allowed: true,
            input: decision.updatedInput ?? input,
          };
        },
      });
      const externalHandle = externalRuntime!.createConversation({
        id: cid,
        ...(r.resumeSessionId ? { resumeThreadId: r.resumeSessionId } : {}),
        cwd: conversationCwd,
        workspaceRoot: conversationWorkspace.root,
        providerId: entry.provider.id,
        modelId: r.modelId,
        developerInstructions: extras.systemPromptAppend,
        permissionMode: policy.mode,
        webSearchEnabled: personaCtx.webSearchEnabled,
        webFetchEnabled: personaCtx.webFetchEnabled,
        dynamicTools,
        approve: async (request: CodexApprovalRequest) => {
          if (isWiki) return "decline";
          const governed = governToolInput(
            request.toolName,
            request.input,
            conversationCwd,
            conversationWorkspace,
          );
          if (governed.denied !== undefined) return "decline";
          const decision = await broker.canUseTool(
            request.toolName,
            governed.effectiveInput,
            {
              signal: new AbortController().signal,
              toolUseID: request.toolUseId,
              requestId: request.toolUseId,
            },
          );
          return decision?.behavior === "allow" ? "accept" : "decline";
        },
        answerUserInput: (params) => answerCodexQuestionCard(askMcp, params),
      });
      conversations.set(cid, {
        ...commonRecord,
        engine: entry.executionEngine,
        handle: externalHandle,
      });
    } else {
      conversations.set(cid, {
        ...commonRecord,
        engine: "claude-agent-sdk",
        handle: claudeHandle!,
        bridge: bridge!,
      });
    }
    return cid;
  }

  function drain(
    cid: string,
    rec: ConvRecord,
    prompt: string,
    sourceMessageId?: string,
    roundOptions?: ConversationRoundOptions,
  ): void {
    const { handle, entry, modelId } = rec;
    const auditCwd = rec.cwd;
    const pricing = resolvePricing(entry.provider.id, modelId);

    const startQueuedGuidanceFollowUp = (): void => {
      if (!rec.queuedGuidanceFollowUp) return;
      rec.queuedGuidanceFollowUp = false;
      try {
        rec.broker.beginTask();
        drain(cid, rec, "请继续执行用户在上一轮追加的引导。");
      } catch (error) {
        // The engine kept the actual guidance. Preserve the host-side marker
        // too, so a later normal send can still deliver it rather than losing
        // the user's correction behind a failed automatic handoff.
        rec.queuedGuidanceFollowUp = true;
        push("bridge:event", {
          conversationId: cid,
          event: { type: "error", message: `追加引导已保留；${toUserFacingRunError(error)}` },
        });
      }
    };

    const pushFailure = (error: unknown): void => {
      const message = toUserFacingRunError(error);
      push("bridge:event", {
        conversationId: cid,
        event: { type: "error", message },
      });
      // handle.send() can throw synchronously before normalizeSdkStream owns
      // the iterable (notably a racing second turn). An error without the
      // matching terminal event leaves the renderer's run id and Stop button
      // live forever, so every drain failure closes the attempted turn.
      push("bridge:event", {
        conversationId: cid,
        event: {
          type: "run.finished",
          subtype: "error",
          isError: true,
          finalText: "",
          pathAudit: { claimed: [] },
        },
      });
    };

    // `send` owns the pool's synchronous sequential-turn guard. Let that error
    // cross the invoke acknowledgement boundary: the renderer can then roll
    // back only the rejected optimistic turn and keep its draft. Emitting an
    // unscoped run.finished here would instead terminate whichever round is
    // currently active for this conversation.
    const source = isExternalAgentRecord(rec)
      ? rec.handle.send(prompt)
      : rec.handle.send(prompt, roundOptions);

    let fileTracker: WorkspaceChangeTracker | undefined;
    let finishFileChangesPromise: Promise<void> | undefined;
    const beginFileTracking = async (event: Extract<LeemoEvent, { type: "tool.started" }>): Promise<void> => {
      if (!toolMayChangeWorkspace(event.name)) return;
      fileTracker ??= createWorkspaceChangeTracker(rec.cwd, {
        ignoreLegacyRootMemory:
          rec.workspace.kind === "home" && samePath(rec.cwd, rec.workspace.root),
      });
      if (typeof event.input === "object" && event.input !== null && !Array.isArray(event.input)) {
        const governed = governToolInput(
          event.name,
          event.input as Record<string, unknown>,
          rec.cwd,
          rec.workspace,
        );
        for (const candidate of toolInputPaths(governed.effectiveInput)) {
          fileTracker.notePath(candidate);
        }
      }
      // The SDK iterator is paused on tool.started. Waiting here establishes
      // the baseline before its next() lets the native tool actually execute.
      await fileTracker.ready;
    };
    const finishFileChanges = (): Promise<void> => {
      if (finishFileChangesPromise) return finishFileChangesPromise;
      finishFileChangesPromise = (async () => {
        if (!fileTracker) return;
        const result = await fileTracker.finish();
        const visibleChanges = result.changes.map((change) => {
          const workspacePath = path.relative(
            rec.workspace.root,
            path.resolve(rec.cwd, change.path),
          ).split(path.sep).join("/");
          const segments = change.path.split("/");
          const visiblePath = rec.workspace.kind === "home"
            && samePath(rec.cwd, rec.workspace.root)
            && segments[0] === DEFAULT_WORKSPACE_DIR
            ? segments.slice(1).join("/")
            : change.path;
          return { ...change, path: visiblePath, workspacePath };
        }).filter((change) => change.path.length > 0);
        for (const [index, change] of visibleChanges.entries()) {
          push("bridge:event", {
            conversationId: cid,
            event: {
              type: "file.changed",
              ...change,
              ...(index === 0 && result.omitted > 0 ? { omitted: result.omitted } : {}),
            },
          });
        }
      })().catch((error: unknown) => {
        console.warn("[leemo:host] file change receipt unavailable:", error);
      });
      return finishFileChangesPromise;
    };

    let resolveInterrupted!: () => void;
    const interrupted = new Promise<void>((resolve) => { resolveInterrupted = resolve; });
    const round = {
      id: ++rec.nextRoundId,
      interrupted,
      resolveInterrupted,
      nativeCleanupSafe: true,
      finishFileChanges,
    };
    rec.activeRound = round;
    rec.memoryMcp?.beginRound(sourceMessageId);
    let nativeBaseline: NativeMemoryBaseline | undefined;
    if (rec.personaCtx.rememberMode && memoryGovernance) {
      const directory = nativeMemoryDirectory(cid, round.id);
      try {
        nativeBaseline = memoryGovernance.prepareNative(rec.memoryScope, directory);
        rec.extras.autoMemoryEnabled = true;
        rec.extras.autoMemoryDirectory = directory;
      } catch (error: unknown) {
        rec.extras.autoMemoryEnabled = false;
        delete rec.extras.autoMemoryDirectory;
        console.error("[leemo:host] native memory cache unavailable, continuing with Leemo tools only:", error);
      }
    } else {
      rec.extras.autoMemoryEnabled = false;
      delete rec.extras.autoMemoryDirectory;
    }

    let memoryReconciled = false;
    const reconcileRoundMemory = (): void => {
      if (memoryReconciled || !nativeBaseline || !memoryGovernance || !round.nativeCleanupSafe) return;
      memoryReconciled = true;
      try {
        const result = memoryGovernance.reconcileNative(nativeBaseline, {
          conversationId: cid,
          ...(sourceMessageId ? { messageId: sourceMessageId } : {}),
        });
        for (const change of result.changes) pushMemoryChange(cid, change);
        if (result.diagnostics.length > 0) {
          console.warn(`[leemo:host] native memory reconciliation diagnostics: ${result.diagnostics.length}`);
        }
      } catch (error: unknown) {
        console.error("[leemo:host] native memory reconciliation failed; ledger remains authoritative:", error);
      }
    };

    void (async () => {
      let iterator: AsyncIterator<LeemoEvent> | undefined;
      try {
        const stream: AsyncIterable<LeemoEvent> = isExternalAgentRecord(rec)
          ? source as AsyncIterable<LeemoEvent>
          : normalizeSdkStream(source, {
              providerId: entry.provider.id,
              modelId,
              cwd: auditCwd,
              pricing,
              modelUsageCursor: rec.modelUsageCursor,
              browserOutputDir: path.join(dataDir, "mcp", "playwright", "browser-output"),
            });
        iterator = stream[Symbol.asyncIterator]();
        const timeoutMs = Math.max(1, firstProgressTimeoutMs ?? 45_000);
        const timeoutMessage = `服务商在 ${Math.ceil(timeoutMs / 1_000)} 秒内没有返回可显示的内容，请检查网络和模型配置后重试。`;
        const interruptForTimeout = async (): Promise<Error> => {
          const stopped = await Promise.resolve(handle.interrupt());
          if (!stopped) round.nativeCleanupSafe = false;
          return new Error(stopped ? timeoutMessage : PROCESS_STOP_UNCONFIRMED_MESSAGE);
        };
        const deadline = Date.now() + timeoutMs;
        let providerProgress = false;
        const nextOrInterrupted = (
          pending: Promise<IteratorResult<LeemoEvent>>,
        ): Promise<IteratorResult<LeemoEvent> | undefined> => Promise.race([
          pending,
          round.interrupted.then(() => undefined),
        ]);

        while (true) {
          let next: IteratorResult<LeemoEvent> | undefined;
          if (providerProgress) {
            next = await nextOrInterrupted(iterator.next());
          } else {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
              throw await interruptForTimeout();
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            let timedOut = false;
            try {
              next = await Promise.race([
                nextOrInterrupted(iterator.next()),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {
                    timedOut = true;
                    void interruptForTimeout().then(reject);
                  }, remaining);
                }),
              ]);
            } catch (error) {
              if (timedOut) {
                const closing = iterator.return?.();
                if (closing) void closing.catch(() => {});
              }
              throw error;
            } finally {
              if (timer) clearTimeout(timer);
            }
          }

          if (!next || rec.activeRound !== round) {
            const closing = iterator.return?.();
            if (closing) void closing.catch(() => {});
            return;
          }
          if (next.done) {
            if (!providerProgress) {
              throw new Error("服务商没有返回可显示的内容，请检查模型配置后重试。");
            }
            break;
          }
          const ev = next.value;
          if (ev.type === "tool.started") await beginFileTracking(ev);
          if (ev.type === "run.finished") reconcileRoundMemory();
          if (ev.type === "run.finished") await finishFileChanges();
          if (ev.type === "run.finished") rec.activeRound = undefined;
          push("bridge:event", { conversationId: cid, event: ev });
          if (ev.type === "run.finished") {
            const closing = iterator.return?.();
            if (closing) void closing.catch(() => {});
            if (!ev.isError && ev.subtype === "completed") startQueuedGuidanceFollowUp();
            return;
          }
          providerProgress = providerProgress || ![
            "conversation.started",
            "compact.boundary",
            "usage.final",
          ].includes(ev.type);
        }
      } catch (e: unknown) {
        // A locally interrupted/superseded round has already emitted its one
        // trustworthy terminal event. Abort errors and late provider results
        // from it must never repaint that turn as failed or successful.
        if (rec.activeRound !== round) return;
        await finishFileChanges();
        rec.activeRound = undefined;
        pushFailure(e);
      } finally {
        await finishFileChanges();
        reconcileRoundMemory();
        if (rec.activeRound === round) rec.activeRound = undefined;
      }
    })();
  }

  /** Release every interaction this conversation is parked on.
   *
   *  Both interrupt and teardown need this: a round can be blocked deep inside
   *  `canUseTool`/`ask_user`, awaiting a promise that only the host can settle.
   *  Aborting the SDK stream does NOT settle it — before this existed, 停止
   *  aborted the stream while the approval promise stayed parked forever, so
   *  the child never returned and the button looked dead. Resolving as `deny`
   *  is the fail-closed choice: an interrupted tool call must not run. */
  function releasePending(cid: string, reason: string): void {
    const rec = conversations.get(cid);
    for (const [id, w] of approvalWaiters) {
      if (w.conversationId === cid) {
        settleApproval(id, { id, decision: "deny", message: reason });
      }
    }
    for (const [id, owner] of askOwner) {
      if (owner === cid) {
        rec?.askMcp.failAsk(id, reason);
        askOwner.delete(id);
      }
    }
  }

  function teardown(cid: string): void {
    const rec = conversations.get(cid);
    if (!rec) return;
    void rec.activeRound?.finishFileChanges();
    rec.handle.dispose();
    rec.bridge?.dispose();
    releasePending(cid, "conversation disposed");
    conversations.delete(cid);
  }

  function requireProviderStore(): ProviderConfigStore {
    if (!providerStore) {
      throw new Error("当前运行环境不支持保存 Provider 配置（缺少加密存储）。");
    }
    return providerStore;
  }

  /** Non-cryptographic instance id. Collision-checked by the caller's config map,
   *  and never security-relevant (it is a record key, not a token). */
  function mintProviderId(): string {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function mintMcpServerId(name: string, existing: Record<string, unknown>): string {
    const base = mcpIdBase(name);
    if (base !== PLAYWRIGHT_MCP_ID && existing[base] === undefined) return base;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const suffix = Math.random().toString(36).slice(2, 7);
      const id = `${base.slice(0, 56)}-${suffix}`;
      if (existing[id] === undefined) return id;
    }
    throw new Error("没能生成不重复的 MCP 标识，请换一个名称再试。");
  }

  function mcpViews(): McpServerView[] {
    return listMcpServerViews(providerStore?.read().mcpServers, builtinMcpRuntime);
  }

  /** Last 4 characters only, for "is this the key I think it is". */
  function maskKey(key: string): string | undefined {
    if (!key) return undefined;
    return key.length <= 4 ? "····" : `····${key.slice(-4)}`;
  }

  // Only protocol metadata with well-understood, non-credential semantics is
  // safe to read back. Every unknown custom header is write-only by default.
  const READABLE_HEADER_NAMES = new Set([
    "accept",
    "content-type",
    "user-agent",
    "anthropic-version",
    "anthropic-beta",
    "http-referer",
    "x-title",
  ]);

  function projectHeaders(headers: Record<string, string> | undefined): {
    headers?: Record<string, string>;
    secretHeaderKeys?: string[];
  } {
    if (!headers) return {};
    const readable: Record<string, string> = {};
    const secretHeaderKeys: string[] = [];
    for (const [name, value] of Object.entries(headers)) {
      if (READABLE_HEADER_NAMES.has(name.toLowerCase())) readable[name] = value;
      else secretHeaderKeys.push(name);
    }
    return {
      ...(Object.keys(readable).length > 0 ? { headers: readable } : {}),
      ...(secretHeaderKeys.length > 0 ? { secretHeaderKeys } : {}),
    };
  }

  /** IPC projection of one instance. Secret values remain process-side. */
  function providerConfigView(entry: CatalogEntry): ProviderConfigView {
    const p = entry.provider;
    const view: ProviderConfigView = {
      id: p.id,
      kind: entry.spec.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      apiFormat: p.apiFormat,
      authMode: entry.spec.authMode,
      productKind: entry.spec.productKind,
      category: p.category,
      models: [...p.models],
      capabilities: entry.spec.capabilities,
      hasApiKey: p.apiKey.length > 0,
      saved: Boolean(providerStore && providerStore.read().providers[p.id]),
    };
    if (p.modelCapabilities) {
      view.modelCapabilities = Object.fromEntries(
        Object.entries(p.modelCapabilities).map(([modelId, capabilities]) => [modelId, { ...capabilities }]),
      );
    }
    if (entry.spec.modelCapabilityEvidence) {
      view.modelCapabilityEvidence = cloneModelCapabilityEvidenceMap(entry.spec.modelCapabilityEvidence);
    }
    if (entry.taskModelRouting !== undefined) {
      view.taskModelRouting = { ...entry.taskModelRouting };
    }
    Object.assign(view, projectHeaders(entry.headers));
    if (p.envTemplate) view.envTemplate = { ...p.envTemplate } as Record<string, string>;
    if (entry.modelsUrl) view.modelsUrl = entry.modelsUrl;
    if (entry.spec.apiKeyUrl) view.apiKeyUrl = entry.spec.apiKeyUrl;
    const masked = maskKey(p.apiKey);
    if (masked) view.apiKeyMasked = masked;
    return view;
  }

  /**
   * Resolve the key for a probe.
   *
   * The wizard's 「留空即不改」 means an EDIT submits a draft with no `apiKey` —
   * so a test on that draft must fall back to the stored key, or "edit the name,
   * then test" would report a bogus auth failure. A brand-new draft with no key
   * has nothing to fall back to and is refused before any request is made.
   */
  function keyForProbe(providerId: string | undefined, draftKey: string | undefined): string {
    if (draftKey) return draftKey;
    if (!providerId) return "";
    return getCatalog().find((e) => e.provider.id === providerId)?.provider.apiKey ?? "";
  }

  function noKeyError(): ProviderError {
    return { kind: "auth", message: "还没有填 API Key，先填一个再测试连接。" };
  }

  function resolveProbeTarget(
    providerId: string | undefined,
    draft: ProviderDraft | undefined,
    modelId: string | undefined
  ): { target: ProviderTestTarget } | { error: ProviderError } {
    const entry = providerId ? getCatalog().find((e) => e.provider.id === providerId) : undefined;
    const baseUrl = draft?.baseUrl ?? entry?.provider.baseUrl;
    const apiFormat = draft?.apiFormat ?? entry?.provider.apiFormat;
    const authMode = draft?.authMode ?? entry?.spec.authMode ?? "api-key";
    if (!baseUrl || !apiFormat) {
      return { error: { kind: "bad_request", message: "缺少 Provider 地址或兼容格式，没法测试。" } };
    }
    const model = modelId ?? draft?.models?.[0] ?? entry?.provider.models[0];
    if (!model) {
      return { error: { kind: "bad_request", message: "还没有可测试的模型，先拉取或手敲一个模型名。" } };
    }
    const apiKey = keyForProbe(providerId, draft?.apiKey);
    if (authMode !== "none" && !apiKey) return { error: noKeyError() };
    const headers = draft
      ? mergeProviderHeaders(entry?.headers, draft.headers, draft.removeHeaderKeys)
      : entry?.headers;
    const target: ProviderTestTarget = { baseUrl, apiKey, modelId: model, apiFormat, authMode };
    const apiKeyHeader = entry?.apiKeyHeader
      ?? providerApiKeyHeaderForKind(draft?.kind ?? entry?.spec.kind);
    if (apiKeyHeader) target.apiKeyHeader = apiKeyHeader;
    if (headers) target.headers = { ...headers };
    return { target };
  }

  function resolveModelsTarget(
    providerId: string | undefined,
    draft: ProviderDraft | undefined
  ): { target: ProviderModelsTarget } | { error: ProviderError } {
    const entry = providerId ? getCatalog().find((e) => e.provider.id === providerId) : undefined;
    // Discovery URL is NOT derivable from baseUrl by convention (卡 F measured
    // four different shapes across four vendors), so it must come from the draft
    // or the catalog entry — never be guessed.
    const modelsUrl = draft?.modelsUrl ?? entry?.modelsUrl;
    if (!modelsUrl) {
      return {
        error: {
          kind: "bad_request",
          message: "这个 Provider 没有提供「模型列表」地址，请直接手敲模型名。",
        },
      };
    }
    const apiKey = keyForProbe(providerId, draft?.apiKey);
    const authMode = draft?.authMode ?? entry?.spec.authMode ?? "api-key";
    if (authMode !== "none" && !apiKey) return { error: noKeyError() };
    const headers = draft
      ? mergeProviderHeaders(entry?.headers, draft.headers, draft.removeHeaderKeys)
      : entry?.headers;
    const target: ProviderModelsTarget = { modelsUrl, apiKey, authMode };
    const apiKeyHeader = entry?.apiKeyHeader
      ?? providerApiKeyHeaderForKind(draft?.kind ?? entry?.spec.kind);
    if (apiKeyHeader) target.apiKeyHeader = apiKeyHeader;
    if (headers) target.headers = { ...headers };
    return { target };
  }

  async function handleInvoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"]
  ): Promise<BridgeInvokeMap[K]["response"]> {
    type R<C extends keyof BridgeInvokeMap> = BridgeInvokeMap[C]["response"];
    switch (channel) {
      case "bridge:listProviders":
        return getCatalog().map((e) => e.spec) as R<"bridge:listProviders"> as R<K>;

      case "bridge:getProviderConfig": {
        const r = req as BridgeInvokeMap["bridge:getProviderConfig"]["request"];
        const entry = getCatalog().find((e) => e.provider.id === r.providerId);
        if (!entry) return null as R<"bridge:getProviderConfig"> as R<K>;
        return providerConfigView(entry) as R<"bridge:getProviderConfig"> as R<K>;
      }

      case "bridge:saveProvider": {
        const draft = req as BridgeInvokeMap["bridge:saveProvider"]["request"];
        const store = requireProviderStore();
        const existing = draft.id
          ? getCatalog().find((entry) => entry.provider.id === draft.id)
          : undefined;
        if ((draft.authMode ?? existing?.spec.authMode) === "oauth-subscription") {
          const entry = subscriptionEntry(draft.id ?? draft.kind);
          await requireLiveSubscription(entry);
        }
        const { config, id } = upsertProvider(store.read(), draft, mintProviderId);
        // write() persists AND rebuilds, so the read below sees the new instance.
        store.write(config);
        const saved = getCatalog().find((e) => e.provider.id === id);
        if (!saved) throw new Error("保存后没能在目录里找到这个 Provider，配置可能没生效。");
        return saved.spec as R<"bridge:saveProvider"> as R<K>;
      }

      case "bridge:deleteProvider": {
        const r = req as BridgeInvokeMap["bridge:deleteProvider"]["request"];
        const store = requireProviderStore();
        // A preset family reverts to its unconfigured offer (the preset list is a
        // constant, not user data); a custom instance disappears. Both are just
        // "drop the stored record" — buildCatalog re-adds presets on its own.
        store.write(removeProvider(store.read(), r.providerId));
        return undefined as R<"bridge:deleteProvider"> as R<K>;
      }

      case "bridge:getProviderLoginStatus": {
        const r = req as BridgeInvokeMap["bridge:getProviderLoginStatus"]["request"];
        subscriptionEntry(r.providerId);
        return (subscriptionAuth
          ? await subscriptionAuth.getStatus(r.providerId)
          : { state: "unavailable", message: "订阅登录组件暂不可用，请重启 Leemo 后再试。" }) as R<"bridge:getProviderLoginStatus"> as R<K>;
      }

      case "bridge:loginProvider": {
        const r = req as BridgeInvokeMap["bridge:loginProvider"]["request"];
        subscriptionEntry(r.providerId);
        return (subscriptionAuth
          ? await subscriptionAuth.login(r.providerId)
          : { state: "unavailable", message: "订阅登录组件暂不可用，请重启 Leemo 后再试。" }) as R<"bridge:loginProvider"> as R<K>;
      }

      case "bridge:logoutProvider": {
        const r = req as BridgeInvokeMap["bridge:logoutProvider"]["request"];
        subscriptionEntry(r.providerId);
        return (subscriptionAuth
          ? await subscriptionAuth.logout(r.providerId)
          : { state: "unavailable", message: "订阅登录组件暂不可用，请重启 Leemo 后再试。" }) as R<"bridge:logoutProvider"> as R<K>;
      }

      case "bridge:testConnection": {
        const r = req as BridgeInvokeMap["bridge:testConnection"]["request"];
        const target = resolveProbeTarget(r.providerId, r.draft, r.modelId);
        if ("error" in target) {
          return { ok: false, error: target.error } as R<"bridge:testConnection"> as R<K>;
        }
        const result = await testProviderConnection(
          target.target,
          { fetchFn: httpFetch() },
        );
        return result as R<"bridge:testConnection"> as R<K>;
      }

      case "bridge:resolveTaskTimes": {
        const r = req as BridgeInvokeMap["bridge:resolveTaskTimes"]["request"];
        const manual = { ok: false as const, message: "这段时间关系还需要你手动确认。" };
        const texts = Array.isArray(r.texts)
          ? r.texts.map((text) => typeof text === "string" ? text.trim() : "")
          : [];
        if (
          !r.providerId?.trim()
          || !r.modelId?.trim()
          || texts.length === 0
          || texts.length > 20
          || texts.some((text) => text.length === 0 || text.length > 1_000)
          || Number.isNaN(Date.parse(r.localNow))
        ) {
          return manual as R<"bridge:resolveTaskTimes"> as R<K>;
        }
        const target = resolveProbeTarget(r.providerId, undefined, r.modelId);
        if ("error" in target) {
          return manual as R<"bridge:resolveTaskTimes"> as R<K>;
        }
        const reply = await requestProviderText(
          target.target,
          taskTimePrompt(texts, r.localNow, r.timeZone),
          { fetchFn: httpFetch(), maxTokens: 768 },
        );
        if (!reply.ok) return manual as R<"bridge:resolveTaskTimes"> as R<K>;
        const items = parseResolvedTaskFields(reply.text, texts);
        return (items ? { ok: true as const, items } : manual) as R<"bridge:resolveTaskTimes"> as R<K>;
      }

      case "bridge:listRemoteModels": {
        const r = req as BridgeInvokeMap["bridge:listRemoteModels"]["request"];
        const target = resolveModelsTarget(r.providerId, r.draft);
        if ("error" in target) {
          return { models: [], error: target.error } as R<"bridge:listRemoteModels"> as R<K>;
        }
        const result = await listProviderModels(target.target, { fetchFn: httpFetch() });
        return result as R<"bridge:listRemoteModels"> as R<K>;
      }

      case "bridge:listMcpServers":
        return mcpViews() as R<"bridge:listMcpServers"> as R<K>;

      case "bridge:saveMcpServer": {
        const draft = req as BridgeInvokeMap["bridge:saveMcpServer"]["request"];
        const store = requireProviderStore();
        const config = store.read();
        const result = upsertStoredMcpServer(
          config.mcpServers,
          draft,
          () => mintMcpServerId(draft.name, config.mcpServers ?? {}),
        );
        store.write({ ...config, mcpServers: result.servers });
        reconcileAllConfiguredMcps();
        const view = mcpViews().find((candidate) => candidate.id === result.id);
        if (!view) throw new Error("MCP 已保存，但没有出现在配置列表中。");
        return view as R<"bridge:saveMcpServer"> as R<K>;
      }

      case "bridge:deleteMcpServer": {
        const r = req as BridgeInvokeMap["bridge:deleteMcpServer"]["request"];
        const store = requireProviderStore();
        const config = store.read();
        store.write({ ...config, mcpServers: removeStoredMcpServer(config.mcpServers, r.id) });
        reconcileAllConfiguredMcps();
        return undefined as R<"bridge:deleteMcpServer"> as R<K>;
      }

      case "bridge:testMcpServer": {
        const r = req as BridgeInvokeMap["bridge:testMcpServer"]["request"];
        const store = requireProviderStore();
        const config = store.read();
        let target = config.mcpServers?.[r.id];
        if (!target && r.id === PLAYWRIGHT_MCP_ID) {
          target = upsertStoredMcpServer(undefined, {
            id: PLAYWRIGHT_MCP_ID,
            name: "浏览器（Playwright）",
            transport: "stdio",
            enabled: true,
          }, () => PLAYWRIGHT_MCP_ID).servers[PLAYWRIGHT_MCP_ID];
        }
        if (!target && r.id === COMPUTER_MCP_ID) {
          target = upsertStoredMcpServer(undefined, {
            id: COMPUTER_MCP_ID,
            name: "操作电脑",
            transport: "stdio",
            enabled: true,
          }, () => COMPUTER_MCP_ID).servers[COMPUTER_MCP_ID];
        }
        if (!target) {
          return { ok: false, tools: [], error: "找不到这个 MCP 配置。" } as R<"bridge:testMcpServer"> as R<K>;
        }
        const runtimeConfig = configuredSdkMcpServers(
          { [r.id]: { ...target, enabled: true } },
          builtinMcpRuntime,
        )[r.id];
        if (!runtimeConfig || runtimeConfig.type === "sdk") {
          return { ok: false, tools: [], error: "这个 MCP 的运行组件不可用。" } as R<"bridge:testMcpServer"> as R<K>;
        }
        const probe = deps.mcpProbe ?? probeMcpServer;
        const result = r.id === PLAYWRIGHT_MCP_ID
          ? await probe(runtimeConfig, workspaceRoot, target.timeoutMs ?? 10_000, {
              verifyBrowserTabs: target.browserMode === "extension",
            })
          : r.id === COMPUTER_MCP_ID
            ? await probe(runtimeConfig, workspaceRoot, target.timeoutMs ?? 10_000, {
                verifyComputerDesktop: true,
              })
          : await probe(runtimeConfig, workspaceRoot, target.timeoutMs ?? 10_000);
        return result as R<"bridge:testMcpServer"> as R<K>;
      }

      case "bridge:readBrowserCapture": {
        const r = req as BridgeInvokeMap["bridge:readBrowserCapture"]["request"];
        if (!/^[A-Za-z0-9._-]+\.(?:png|jpe?g)$/i.test(r.id) || path.basename(r.id) !== r.id) {
          return null as R<"bridge:readBrowserCapture"> as R<K>;
        }
        const root = path.resolve(dataDir, "mcp", "playwright", "browser-output");
        const target = path.resolve(root, r.id);
        const relative = path.relative(root, target);
        if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(target)) {
          return null as R<"bridge:readBrowserCapture"> as R<K>;
        }
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 12 * 1024 * 1024) {
          return null as R<"bridge:readBrowserCapture"> as R<K>;
        }
        const realRoot = fs.realpathSync(root);
        const realTarget = fs.realpathSync(target);
        const realRelative = path.relative(realRoot, realTarget);
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
          return null as R<"bridge:readBrowserCapture"> as R<K>;
        }
        const mimeType = /\.png$/i.test(r.id) ? "image/png" as const : "image/jpeg" as const;
        return {
          mimeType,
          dataBase64: fs.readFileSync(target).toString("base64"),
        } as R<"bridge:readBrowserCapture"> as R<K>;
      }

      case "bridge:createConversation": {
        const cid = await assemble(req as BridgeInvokeMap["bridge:createConversation"]["request"]);
        return { conversationId: cid } as R<"bridge:createConversation"> as R<K>;
      }

      case "bridge:send": {
        const r = req as BridgeInvokeMap["bridge:send"]["request"];
        const rec = conversations.get(r.conversationId);
        if (!rec) throw new Error(`unknown conversation: ${r.conversationId}`);
        if (rec.workspace.kind === "external") {
          const refreshed = resolveConversationWorkspace(rec.workspace.id);
          if (!samePath(refreshed.root, rec.workspace.root)) {
            throw new Error("这个工作区的位置发生了变化，请重新打开文件夹后再继续。");
          }
        }
        // Verify attachment paths before `drain` starts the asynchronous SDK
        // stream. A rejected invoke gives the renderer a real acknowledgement
        // failure it can keep the draft for; failing inside drain would arrive
        // later as a generic event after the composer had already cleared.
        const prompt = formatPromptWithAttachments(
          r.prompt,
          r.attachments,
          r.workspaceFiles,
          rec.workspace.root,
          rec.workspace.id,
        );
        const promptWithNotes = formatPromptWithNoteReferences(prompt, r.noteReferences, captures);
        const promptWithGoal = formatPromptWithGoal(promptWithNotes, r.goalText);
        // A manual next message lets an engine consume its own queued guidance.
        // Do not start a redundant automatic turn after this one completes.
        rec.queuedGuidanceFollowUp = false;
        rec.broker.beginTask();
        drain(
          r.conversationId,
          rec,
          promptWithGoal,
          r.sourceMessageId,
          r.allowSubagents === false ? { disallowedTools: ["Agent", "Task"] } : undefined,
        );
        return undefined as R<"bridge:send"> as R<K>;
      }

      case "bridge:guide": {
        const r = req as BridgeInvokeMap["bridge:guide"]["request"];
        const rec = conversations.get(r.conversationId);
        if (!rec) throw new Error(`unknown conversation: ${r.conversationId}`);
        if (!rec.activeRound) throw new Error("当前没有正在执行的任务。");
        const delivery = await rec.handle.guide(r.prompt);
        if (delivery === "queued") rec.queuedGuidanceFollowUp = true;
        return { delivery } as R<"bridge:guide"> as R<K>;
      }

      case "bridge:interrupt": {
        const r = req as BridgeInvokeMap["bridge:interrupt"]["request"];
        const rec = conversations.get(r.conversationId);
        const round = rec?.activeRound;
        if (rec && round) {
          // Fence the round immediately and wake drain even if the SDK never
          // yields after abort. Do not publish the visible terminal yet: the UI
          // may only say "stopped" after the owned process tree is gone.
          rec.activeRound = undefined;
          round.resolveInterrupted();
        }
        // Order matters: release the parked approval/question FIRST, then abort.
        // The round is usually blocked inside canUseTool, so settling that
        // promise is what actually lets the turn unwind; the abort then stops
        // whatever the SDK is still streaming.
        releasePending(r.conversationId, "interrupted by user");
        const processTreeStopped = rec
          ? await Promise.resolve(rec.handle.interrupt())
          : true;
        if (!processTreeStopped && round) round.nativeCleanupSafe = false;
        if (rec && round) {
          await round.finishFileChanges();
          if (processTreeStopped) {
            push("bridge:event", {
              conversationId: r.conversationId,
              event: {
                type: "run.finished",
                subtype: "interrupted",
                isError: false,
                finalText: "",
                pathAudit: { claimed: [] },
              },
            });
          } else {
            const message = PROCESS_STOP_UNCONFIRMED_MESSAGE;
            push("bridge:event", { conversationId: r.conversationId, event: { type: "error", message } });
            push("bridge:event", {
              conversationId: r.conversationId,
              event: {
                type: "run.finished",
                subtype: "error",
                isError: true,
                finalText: "",
                pathAudit: { claimed: [] },
              },
            });
          }
        }
        return undefined as R<"bridge:interrupt"> as R<K>;
      }

      case "bridge:setModel": {
        const r = req as BridgeInvokeMap["bridge:setModel"]["request"];
        const rec = conversations.get(r.conversationId);
        if (!rec) throw new Error(`unknown conversation: ${r.conversationId}`);
        const entry = getCatalog().find((candidate) => candidate.provider.id === r.providerId);
        if (!entry) throw new Error(`unknown provider: ${r.providerId}`);
        if (!providerIsReady(entry)) {
          throw new Error(setupMessage(entry, "。"));
        }
        await requireLiveSubscription(entry);
        if (!entry.provider.models.includes(r.modelId)) {
          throw new Error(`model "${r.modelId}" is not configured for provider "${r.providerId}"`);
        }
        if (entry.executionEngine !== rec.engine) {
          throw new Error("这两个模型使用不同的本地执行方式，不能在同一条对话里无痕切换；请新建对话后再选择。");
        }
        if (isExternalAgentRecord(rec)) {
          rec.handle.setModel(r.modelId);
          rec.entry = entry;
          rec.modelId = r.modelId;
          return undefined as R<"bridge:setModel"> as R<K>;
        }

        const gatewayPort = entry.provider.apiFormat !== "anthropic"
          ? (await ensureGateway())?.port
          : undefined;
        if (entry.provider.apiFormat !== "anthropic" && gatewayPort === undefined) {
          throw new Error("OpenAI 兼容网关启动失败，请重试或切换 Anthropic 兼容服务商。");
        }

        const claudeHandle = rec.handle as ConversationHandle;
        claudeHandle.setModel(entry.provider, r.modelId, gatewayPort);
        rec.entry = entry;
        rec.modelId = r.modelId;

        const liveShim = providerNeedsAnthropicShim(entry, rec.personaCtx.webSearchEnabled)
          ? await ensureSearchShim()
          : undefined;
        const shimServes = rec.personaCtx.webSearchEnabled
          && liveShim !== undefined
          && entry.provider.apiFormat === "anthropic";
        claudeHandle.setSearchShimPort(liveShim?.port);
        const wiring = chooseSearchWiring({
          enabled: rec.personaCtx.webSearchEnabled,
          shimServesThisConversation: shimServes,
        });
        applySearchCapabilityWiring(rec.extras, rec.personaCtx, wiring);
        return undefined as R<"bridge:setModel"> as R<K>;
      }

      // 轮 7 A3 —— apply changed settings to a conversation that already exists.
      //
      // Takes effect on the NEXT round: `send()` rebuilds its options per call
      // and buildQueryFn reads `extras` lazily, so rewriting the container here
      // is enough. Deliberately does NOT interrupt the current round — that
      // would throw away a reply the user is waiting for.
      //
      // Unknown cid is a no-op, not an error: the renderer broadcasts to every
      // conversation it believes is live, and one that the host has torn down
      // (or never claimed after a restart) must not fail the whole broadcast.
      case "bridge:updateContext": {
        const r = req as BridgeInvokeMap["bridge:updateContext"]["request"];
        const rec = conversations.get(r.conversationId);
        // Non-sensitive by construction: only WHICH knobs moved, never persona
        // text. Kept permanently because "did my settings change reach momo?" is
        // the exact question this channel exists to answer, and 轮 7 spent a
        // whole debugging cycle unable to see it from either side (contextBridge
        // objects are immutable, so the renderer cannot be instrumented either).
        console.log(
          `[leemo:ctx] update cid=${r.conversationId.slice(0, 8)} known=${rec !== undefined}` +
            ` search=${r.webSearchEnabled ?? "-"} fetch=${r.webFetchEnabled ?? "-"}` +
            ` remember=${r.rememberMode ?? "-"} browser=${rec?.personaCtx.browserEnabled ?? "-"}` +
            ` perm=${r.permissionMode ?? "-"} mode=${r.mode ?? "-"}`,
        );
        if (rec && rec.purpose !== "wiki") {
          // Merge: an omitted field means "leave as-is", never "reset".
          if (r.mode !== undefined) rec.personaCtx.mode = r.mode;
          if (r.personaText !== undefined) rec.personaCtx.personaText = r.personaText;
          if (r.talkStyle !== undefined) rec.personaCtx.talkStyle = r.talkStyle;
          if (r.webSearchEnabled !== undefined) rec.personaCtx.webSearchEnabled = r.webSearchEnabled;
          if (r.webFetchEnabled !== undefined) rec.personaCtx.webFetchEnabled = r.webFetchEnabled;
          if (r.rememberMode !== undefined) rec.personaCtx.rememberMode = r.rememberMode;
          rec.extras.autoMemoryEnabled = rec.personaCtx.rememberMode && memoryGovernance !== undefined;
          rec.extras.autoDreamEnabled = false;
          if (!rec.extras.autoMemoryEnabled) delete rec.extras.autoMemoryDirectory;
          reconcileMemoryMcp(rec);
          // Mutate the SAME policy object the broker captured (see ConvRecord).
          if (r.permissionMode !== undefined) {
            rec.policy.mode = r.permissionMode;
            rec.extras.permissionMode = r.permissionMode;
            if (isExternalAgentRecord(rec)) rec.handle.setPermissionMode(r.permissionMode);
          }
          if (r.dangerousCommandCaching !== undefined) {
            rec.policy.dangerousCommandCaching = r.dangerousCommandCaching;
          }

          refreshMomoPrompt(rec);
          if (isExternalAgentRecord(rec)) {
            rec.handle.setNetworkCapabilities({
              webSearchEnabled: rec.personaCtx.webSearchEnabled,
              webFetchEnabled: rec.personaCtx.webFetchEnabled,
            });
            return undefined as R<"bridge:updateContext"> as R<K>;
          }
          // Search may be switched ON for a conversation created with it OFF, in
          // which case no shim was ever started. Start it now and re-point the
          // conversation's env at it (next round — the env is rebuilt per send).
          // Without this the prompt would claim momo can search while the tool
          // went upstream unshimmed: for a vendor that implements server tools
          // that still works, but GLM would return the 空壳 this project has
          // twice been burned by.
          const liveShim = providerNeedsAnthropicShim(rec.entry, rec.personaCtx.webSearchEnabled)
            ? await ensureSearchShim()
            : undefined;
          const shimServes = rec.personaCtx.webSearchEnabled
            && liveShim !== undefined
            && rec.entry.provider.apiFormat === "anthropic";
          (rec.handle as ConversationHandle).setSearchShimPort(liveShim?.port);

          // WebFetch must be structurally disallowed, not merely discouraged in
          // the prompt — a model holding a real tool will use it (轮 4 三层开关).
          const wiring = chooseSearchWiring({
            enabled: rec.personaCtx.webSearchEnabled,
            shimServesThisConversation: shimServes,
          });
          // OpenAI-compatible providers go through Leemo's gateway, which strips
          // native server tools. If search was enabled after conversation
          // creation, the fallback MCP must be added now; switching it off must
          // remove only that MCP while preserving ask_user and custom servers.
          applySearchCapabilityWiring(rec.extras, rec.personaCtx, wiring);
        }
        return undefined as R<"bridge:updateContext"> as R<K>;
      }

      case "bridge:disposeConversation": {
        const r = req as BridgeInvokeMap["bridge:disposeConversation"]["request"];
        teardown(r.conversationId);
        return undefined as R<"bridge:disposeConversation"> as R<K>;
      }

      case "bridge:approvalDecision": {
        const r = req as BridgeInvokeMap["bridge:approvalDecision"]["request"];
        settleApproval(r.id, r);
        return undefined as R<"bridge:approvalDecision"> as R<K>;
      }

      case "bridge:askUserAnswer": {
        const r = req as BridgeInvokeMap["bridge:askUserAnswer"]["request"];
        const owner = askOwner.get(r.id);
        if (owner !== undefined) {
          conversations.get(owner)?.askMcp.provideAnswer(r.id, r);
          askOwner.delete(r.id);
        }
        return undefined as R<"bridge:askUserAnswer"> as R<K>;
      }

      case "bridge:fetchBalance": {
        const r = req as BridgeInvokeMap["bridge:fetchBalance"]["request"];
        const entry = getCatalog().find((e) => e.provider.id === r.providerId);
        if (!entry) return { supported: false } as R<"bridge:fetchBalance"> as R<K>;
        const balance = await fetchBalance(
          { ...entry.provider, baseUrl: entry.balanceBaseUrl ?? entry.provider.baseUrl },
          { fetchFn: fetch }
        );
        return balance as R<"bridge:fetchBalance"> as R<K>;
      }

      case "bridge:getSearchSources":
        return searchSourceStatuses() as R<"bridge:getSearchSources"> as R<K>;

      case "bridge:saveSearchKey": {
        const r = req as BridgeInvokeMap["bridge:saveSearchKey"]["request"];
        return saveSearchKey(r) as R<"bridge:saveSearchKey"> as R<K>;
      }

      case "bridge:searchAcademic": {
        const r = req as BridgeInvokeMap["bridge:searchAcademic"]["request"];
        return await academicSearch.search(r.query) as R<"bridge:searchAcademic"> as R<K>;
      }

      case "bridge:listSkills":
        return listSkills() as R<"bridge:listSkills"> as R<K>;

      case "bridge:listCommunitySkills":
        return requireSkillAdmin().listCatalog() as R<"bridge:listCommunitySkills"> as R<K>;

      case "bridge:getCommunitySkillDetails": {
        const r = req as BridgeInvokeMap["bridge:getCommunitySkillDetails"]["request"];
        return await loadSkillDetails(r.id) as R<"bridge:getCommunitySkillDetails"> as R<K>;
      }

      case "bridge:installCommunitySkill": {
        const r = req as BridgeInvokeMap["bridge:installCommunitySkill"]["request"];
        return await installCommunitySkill(r.id) as R<"bridge:installCommunitySkill"> as R<K>;
      }

      case "bridge:scanInstalledSkill": {
        const r = req as BridgeInvokeMap["bridge:scanInstalledSkill"]["request"];
        return scanInstalledSkill(r.id) as R<"bridge:scanInstalledSkill"> as R<K>;
      }

      case "bridge:syncEnabledSkills": {
        const r = req as BridgeInvokeMap["bridge:syncEnabledSkills"]["request"];
        if (!Array.isArray(r.enabledQualifiedNames) || r.enabledQualifiedNames.length > 100) {
          throw new Error("技能选择列表不合法。");
        }
        const names = r.enabledQualifiedNames.filter(
          (name): name is string => typeof name === "string" && name.length > 0 && name.length <= 160,
        );
        const requestId = ++latestSkillSyncRequestId;
        try {
          await Promise.all([
            officeSkills?.ensureReady(),
            bundledSkills?.ensureReady(),
            ...(requestsSuperpowers(names) ? [superpowersSkills?.ensureReady()] : []),
          ]);
        } catch (error: unknown) {
          if (requestId !== latestSkillSyncRequestId) {
            return { updatedConversations: 0 } as R<"bridge:syncEnabledSkills"> as R<K>;
          }
          throw error;
        }
        // Preparing a first-use local plugin can outlive a newer UI toggle.
        // Only the latest global selection may mutate live conversations.
        if (requestId !== latestSkillSyncRequestId) {
          return { updatedConversations: 0 } as R<"bridge:syncEnabledSkills"> as R<K>;
        }
        const updatedConversations = syncEnabledSkills(names);
        return { updatedConversations } as R<"bridge:syncEnabledSkills"> as R<K>;
      }

      case "bridge:inspectSkillSource": {
        const r = req as BridgeInvokeMap["bridge:inspectSkillSource"]["request"];
        return await inspectSkillSource(r.source, r.securityScan === true) as R<"bridge:inspectSkillSource"> as R<K>;
      }

      case "bridge:pickSkillSource": {
        const r = req as BridgeInvokeMap["bridge:pickSkillSource"]["request"];
        if (r.kind !== "archive" && r.kind !== "folder") throw new Error("Skill 来源类型不合法。");
        const selected = await deps.pickSkillSource?.(r.kind);
        if (selected === undefined) return {} as R<"bridge:pickSkillSource"> as R<K>;
        return { path: requiredSkillSource(selected) } as R<"bridge:pickSkillSource"> as R<K>;
      }

      case "bridge:installSkill": {
        const r = req as BridgeInvokeMap["bridge:installSkill"]["request"];
        return await installSkill(r.source, r.candidate, r.securityScan === true) as R<"bridge:installSkill"> as R<K>;
      }

      case "bridge:removeSkill": {
        const r = req as BridgeInvokeMap["bridge:removeSkill"]["request"];
        await removeSkill(r.id);
        return undefined as R<"bridge:removeSkill"> as R<K>;
      }

      case "bridge:openSkillsDir": {
        // No opener wired (dev.ts / tests) = nothing to do, not an error.
        if (memoryDir && openPath) {
          try {
            await openDirectory(skillsRootFor(memoryDir));
          } catch (e: unknown) {
            console.error("[leemo:host] could not open skills dir:", e);
          }
        }
        return undefined as R<"bridge:openSkillsDir"> as R<K>;
      }

      case "bridge:listMemory": {
        const r = req as BridgeInvokeMap["bridge:listMemory"]["request"];
        if (!Array.isArray(r.scopes) || r.scopes.length > 100) throw new Error("记忆范围列表不合法。");
        if (r.includeInactive !== undefined && typeof r.includeInactive !== "boolean") {
          throw new Error("记忆状态筛选不合法。");
        }
        const governance = requireMemoryGovernance();
        const seen = new Set<string>();
        const records: MemoryView[] = [];
        for (const requestedScope of r.scopes) {
          const scope = governedScope(requestedScope);
          const key = scope.type === "global"
            ? "global"
            : scope.type === "notebook"
              ? `notebook:${scope.notebookId}`
              : `workspace:${scope.workspaceId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          records.push(...governance.list(scope, { includeInactive: r.includeInactive }).records.map(projectMemory));
        }
        return records as R<"bridge:listMemory"> as R<K>;
      }

      case "bridge:updateMemory": {
        const r = req as BridgeInvokeMap["bridge:updateMemory"]["request"];
        const id = requiredMemoryId(r.id);
        const topic = optionalMemoryText(r.topic, "记忆主题", 240);
        const statement = optionalMemoryText(r.statement, "记忆内容", 8_000);
        if (r.kind !== undefined && (typeof r.kind !== "string" || !memoryKinds.has(r.kind))) {
          throw new Error("记忆类型不合法。");
        }
        if (r.validFrom !== undefined && (typeof r.validFrom !== "number" || !Number.isFinite(r.validFrom))) {
          throw new Error("记忆生效时间不合法。");
        }
        const change = requireMemoryGovernance().update({
          scope: governedScope(r.scope),
          id,
          ...(topic === undefined ? {} : { topic }),
          ...(statement === undefined ? {} : { statement }),
          ...(r.kind === undefined ? {} : { kind: r.kind }),
          ...(r.validFrom === undefined ? {} : { validFrom: r.validFrom }),
        });
        return projectMemoryChange(change) as R<"bridge:updateMemory"> as R<K>;
      }

      case "bridge:deleteMemory": {
        const r = req as BridgeInvokeMap["bridge:deleteMemory"]["request"];
        const change = requireMemoryGovernance().remove(governedScope(r.scope), requiredMemoryId(r.id));
        return projectMemoryChange(change) as R<"bridge:deleteMemory"> as R<K>;
      }

      case "bridge:pinMemory": {
        const r = req as BridgeInvokeMap["bridge:pinMemory"]["request"];
        if (typeof r.pinned !== "boolean") throw new Error("记忆置顶状态不合法。");
        const change = requireMemoryGovernance().pin(
          governedScope(r.scope),
          requiredMemoryId(r.id),
          r.pinned,
        );
        return projectMemoryChange(change) as R<"bridge:pinMemory"> as R<K>;
      }

      case "bridge:memoryHistory": {
        const r = req as BridgeInvokeMap["bridge:memoryHistory"]["request"];
        const history = requireMemoryGovernance().history(
          governedScope(r.scope),
          requiredMemoryId(r.id),
        );
        return history.records.map(projectMemory) as R<"bridge:memoryHistory"> as R<K>;
      }

      case "bridge:undoMemory": {
        const r = req as BridgeInvokeMap["bridge:undoMemory"]["request"];
        const scope = governedScope(r.scope);
        const targetChangeId = requiredMemoryId(r.targetChangeId, "记忆变更标识");
        const conversationId = r.conversationId === undefined
          ? undefined
          : requiredMemoryId(r.conversationId, "对话标识");
        const result = requireMemoryGovernance().undo(scope, targetChangeId);
        if (result.ok && result.changeId && conversationId) {
          push("bridge:event", {
            conversationId,
            event: {
              type: "memory.changed",
              changeId: result.changeId,
              targetChangeId,
              action: "undone",
              label: "",
              scope,
            },
          });
        }
        return {
          ok: result.ok,
          ...(result.conflict === undefined ? {} : { conflict: result.conflict }),
          ...(result.changeId === undefined ? {} : { changeId: result.changeId }),
          targetChangeId: result.targetChangeId,
          ...(result.action === undefined ? {} : { action: result.action }),
        } as R<"bridge:undoMemory"> as R<K>;
      }

      case "bridge:openMemoryDir": {
        const r = req as BridgeInvokeMap["bridge:openMemoryDir"]["request"];
        const directory = requireMemoryGovernance().ensureScope(governedScope(r.scope)).directory;
        await openDirectory(directory);
        return undefined as R<"bridge:openMemoryDir"> as R<K>;
      }

      case "bridge:listWhitelist":
        return await approvalPersistence.getWhitelist() as R<"bridge:listWhitelist"> as R<K>;

      case "bridge:revokeWhitelist": {
        const r = req as BridgeInvokeMap["bridge:revokeWhitelist"]["request"];
        await approvalPersistence.removeFromWhitelist(r);
        return undefined as R<"bridge:revokeWhitelist"> as R<K>;
      }

      case "bridge:usageSummary": {
        const r = req as BridgeInvokeMap["bridge:usageSummary"]["request"];
        return (readUsageSummary
          ? await readUsageSummary(r)
          : { byProvider: [], ...(r.range === "today" ? {} : { byDay: [] }) }
        ) as R<"bridge:usageSummary"> as R<K>;
      }

      default:
        throw new Error(`unknown channel: ${String(channel)}`);
    }
  }

  function dispose(): void {
    for (const cid of [...conversations.keys()]) teardown(cid);
    // Release the listening socket. Fire-and-forget: dispose() is sync by
    // contract, and a failed close on shutdown is not actionable.
    void shimPromise?.then((s) => s?.close()).catch(() => {});
    void gatewayPromise?.then((gateway) => gateway?.close()).catch(() => {});
  }

  function inspect(conversationId: string): { askMcp: AskUserMcp; memoryMcp?: MemoryMcp; mcpServerNames: string[]; systemPromptAppend?: string } | undefined {
    const rec = conversations.get(conversationId);
    return rec
      ? {
          askMcp: rec.askMcp,
          ...(rec.memoryMcp ? { memoryMcp: rec.memoryMcp } : {}),
          mcpServerNames: Object.keys(rec.extras.mcpServers),
          ...(rec.extras.systemPromptAppend ? { systemPromptAppend: rec.extras.systemPromptAppend } : {}),
        }
      : undefined;
  }

  return { handleInvoke, dispose, inspect };
}
