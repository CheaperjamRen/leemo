import type {
  ApprovalDecision,
  ApprovalRequest,
  AskUserAnswer,
  AskUserPayload,
  BridgeEventEnvelope,
  BridgeEventMap,
  BridgeInvokeMap,
  LeemoEvent,
  McpServerView,
  MemoryScopeView,
  MemoryView,
  SearchSourceStatus,
} from "../../bridge/contract";
import type { BridgeClient } from "./client";
import {
  DEMO_TURN_EVENTS,
  FIXTURE_PROVIDERS,
  FIXTURE_WHITELIST,
  FIXTURE_MCP_SERVERS,
} from "./fixtures";

 type Listener = (payload: unknown) => void;
 type Timer = ReturnType<typeof setTimeout>;
 type Interaction =
   | { kind: "approval"; id: string; conversationId: string }
   | { kind: "ask"; id: string; conversationId: string };

 interface ConversationFixtureState {
   id: string;
   purpose: "main" | "wiki" | undefined;
   providerId: string;
   modelId: string;
   started: boolean;
   disposed: boolean;
   running: boolean;
   interrupted: boolean;
   pendingTimers: Set<Timer>;
   interaction: Interaction | undefined;
 }

 export interface FixtureOpts {
   reply?: string;
   chunkDelayMs?: number;
   sessionId?: string;
 }

 function unknownConversation(conversationId: string): Error {
   return new Error(`Unknown conversation: ${conversationId}`);
 }

 function disposedConversation(conversationId: string): Error {
   return new Error(`Disposed conversation: ${conversationId}`);
 }

 function runningConversation(conversationId: string): Error {
   return new Error(`Conversation already running: ${conversationId}`);
 }

function sameMemoryScope(left: MemoryScopeView, right: MemoryScopeView): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "global") return true;
  if (left.type === "notebook") return right.type === "notebook" && left.notebookId === right.notebookId;
  return right.type === "workspace" && left.workspaceId === right.workspaceId;
}

 export class FixtureBridgeClient implements BridgeClient {
   private readonly listeners = new Map<string, Set<Listener>>();
   private readonly conversations = new Map<string, ConversationFixtureState>();
   private readonly customReply: string | undefined;
   private readonly chunkDelayMs: number;
   private readonly sessionId: string;
  private readonly whitelist = FIXTURE_WHITELIST.map((entry) => ({ ...entry }));
  private mcpServers: McpServerView[] = FIXTURE_MCP_SERVERS.map((server) => ({
    ...server,
    envKeys: [],
    headerKeys: [],
  }));
  private searchSources: SearchSourceStatus[] = [
    { id: "anysearch", label: "AnySearch", keyless: true, configured: false, configuredFields: [], note: "开箱可用的默认来源，通常无需配置。" },
    { id: "doubao", label: "豆包搜索", keyless: false, configured: false, configuredFields: [], note: "更适合中文时效信息，配置后自动作为增强来源。" },
    { id: "metaso", label: "秘塔搜索", keyless: false, configured: false, configuredFields: [], note: "更适合中文研究与引用，只把可核验来源交给 momo。" },
    { id: "tavily", label: "Tavily", keyless: false, configured: false, configuredFields: [], note: "覆盖面稳定的通用备用来源，需要 API Key。" },
    { id: "bocha", label: "博查", keyless: false, configured: false, configuredFields: [], note: "国内通用备用来源，需要 API Key。" },
    { id: "google", label: "Google Custom Search", keyless: false, configured: false, configuredFields: [], note: "兼容已有 API Key 与搜索引擎 ID，不作为默认来源。" },
    { id: "exa", label: "Exa", keyless: false, configured: false, configuredFields: [], note: "面向 AI 的语义搜索，配置后作为通用增强来源。" },
    { id: "brave", label: "Brave Search", keyless: false, configured: false, configuredFields: [], note: "使用独立网页索引的通用来源，需要 API Key。" },
    { id: "serpapi", label: "SerpAPI", keyless: false, configured: false, configuredFields: [], note: "兼容 Google 搜索结果的备用来源，需要 API Key。" },
    { id: "serper", label: "Serper", keyless: false, configured: false, configuredFields: [], note: "轻量 Google 搜索 API，需要 API Key。" },
    { id: "bing", label: "Bing Search", keyless: false, configured: false, configuredFields: [], note: "Bing Search API 已停止服务。", blockedReason: "Bing Search API 已停止服务。" },
    { id: "firecrawl", label: "Firecrawl", keyless: false, configured: false, configuredFields: [], note: "搜索网页并返回可引用摘要，需要 API Key。" },
  ];
  private memories: MemoryView[] = [{
    id: "fixture-memory-1",
    scope: { type: "global" },
    kind: "preference",
    topic: "回答方式",
    statement: "用户希望 momo 先给结论",
    learnedAt: 1_785_300_660_000,
    lastConfirmedAt: 1_785_300_660_000,
    sourceType: "explicit-user",
    status: "current",
    pinned: false,
  }];
  private readonly memoryHistory = new Map<string, MemoryView[]>([
    ["fixture-memory-1", [{
      id: "fixture-memory-1",
      scope: { type: "global" },
      kind: "preference",
      topic: "回答方式",
      statement: "用户希望 momo 先给结论",
      learnedAt: 1_785_300_660_000,
      lastConfirmedAt: 1_785_300_660_000,
      sourceType: "explicit-user",
      status: "current",
      pinned: false,
    }]],
  ]);
  private readonly memoryChanges = new Map<string, { before?: MemoryView; after?: MemoryView }>();
  private readonly memoryLatest = new Map(this.memories.map((memory) => [memory.id, memory]));
  private nextMemoryChange = 0;
   private nextConversation = 0;
   private nextInteraction = 0;

   constructor(opts: FixtureOpts = {}) {
     this.customReply = opts.reply;
     this.chunkDelayMs = opts.chunkDelayMs ?? 24;
     this.sessionId = opts.sessionId ?? "fixture-session-1";
   }

   async invoke<K extends keyof BridgeInvokeMap>(
     channel: K,
     req: BridgeInvokeMap[K]["request"],
   ): Promise<BridgeInvokeMap[K]["response"]> {
     switch (channel) {
       case "bridge:createConversation": {
         const request = req as BridgeInvokeMap["bridge:createConversation"]["request"];
         const conversationId = `conv-${++this.nextConversation}`;
         this.conversations.set(conversationId, {
           id: conversationId,
           purpose: request.purpose,
           providerId: request.providerId,
           modelId: request.modelId,
           started: false,
           disposed: false,
           running: false,
           interrupted: false,
           pendingTimers: new Set(),
           interaction: undefined,
         });
         return { conversationId } as BridgeInvokeMap[K]["response"];
       }
      case "bridge:listProviders":
        return FIXTURE_PROVIDERS.map((provider) => ({
           ...provider,
           models: [...provider.models],
           capabilities: { ...provider.capabilities },
           modelCapabilities: provider.modelCapabilities
             ? Object.fromEntries(Object.entries(provider.modelCapabilities).map(([modelId, capabilities]) => [modelId, { ...capabilities }]))
             : undefined,
          })) as BridgeInvokeMap[K]["response"];
      case "bridge:resolveTaskTimes":
        return {
          ok: false,
          message: "演示环境不会调用模型，请手动确认时间。",
        } as BridgeInvokeMap[K]["response"];
      case "bridge:getProviderConfig": {
         const request = req as BridgeInvokeMap["bridge:getProviderConfig"]["request"];
         const provider = FIXTURE_PROVIDERS.find((candidate) => candidate.id === request.providerId);
         if (!provider) return null as BridgeInvokeMap[K]["response"];
         const hasApiKey = provider.configured === true
           && provider.authMode !== "none"
           && provider.authMode !== "oauth-subscription";
         return {
           id: provider.id,
           kind: provider.kind,
           name: provider.name,
           baseUrl: provider.baseUrl,
           apiFormat: provider.apiFormat,
           authMode: provider.authMode,
           productKind: provider.productKind,
           category: provider.category,
           models: [...provider.models],
           modelCapabilities: provider.modelCapabilities
             ? Object.fromEntries(Object.entries(provider.modelCapabilities).map(([modelId, capabilities]) => [modelId, { ...capabilities }]))
             : undefined,
           capabilities: { ...provider.capabilities },
           hasApiKey,
           apiKeyMasked: hasApiKey ? "····demo" : undefined,
           saved: provider.configured === true,
         } as BridgeInvokeMap[K]["response"];
       }
       case "bridge:getProviderLoginStatus":
         return { state: "disconnected" } as BridgeInvokeMap[K]["response"];
       case "bridge:loginProvider":
         return { state: "connected" } as BridgeInvokeMap[K]["response"];
       case "bridge:logoutProvider":
         return { state: "disconnected" } as BridgeInvokeMap[K]["response"];
       case "bridge:listMcpServers":
         return this.mcpServers.map((server) => ({
           ...server,
           args: server.args ? [...server.args] : undefined,
           envKeys: [...server.envKeys],
           headerKeys: [...server.headerKeys],
         })) as BridgeInvokeMap[K]["response"];
       case "bridge:saveMcpServer": {
         const draft = req as BridgeInvokeMap["bridge:saveMcpServer"]["request"];
         const existing = draft.id ? this.mcpServers.find((server) => server.id === draft.id) : undefined;
         const generated = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
         const id = draft.id ?? (generated || `mcp-${this.mcpServers.length}`);
         const view = {
           id,
           name: draft.id === "playwright" ? "浏览器自动化" : draft.id === "computer" ? "操作电脑" : draft.name,
           description: draft.description ?? existing?.description,
           transport: draft.transport,
           command: draft.command,
           args: draft.args ? [...draft.args] : undefined,
           url: draft.url,
           envKeys: draft.env === undefined ? [...(existing?.envKeys ?? [])] : Object.keys(draft.env),
           headerKeys: draft.headers === undefined ? [...(existing?.headerKeys ?? [])] : Object.keys(draft.headers),
           enabled: draft.enabled ?? true,
           timeoutMs: draft.timeoutMs,
           alwaysLoad: draft.alwaysLoad,
           builtin: draft.id === "playwright" ? "playwright" as const : draft.id === "computer" ? "computer" as const : undefined,
           browserMode: draft.browserMode ?? existing?.browserMode ?? (draft.id === "playwright" ? "managed" as const : undefined),
           saved: true,
           available: true,
         };
         this.mcpServers = existing
           ? this.mcpServers.map((server) => server.id === id ? view : server)
           : [...this.mcpServers, view];
         return view as BridgeInvokeMap[K]["response"];
       }
       case "bridge:deleteMcpServer": {
         const request = req as BridgeInvokeMap["bridge:deleteMcpServer"]["request"];
         this.mcpServers = this.mcpServers.filter((server) => server.id !== request.id);
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:testMcpServer":
         return {
           ok: true,
           latencyMs: 18,
           tools: [{ name: "browser_navigate", description: "Navigate to a URL" }],
         } as BridgeInvokeMap[K]["response"];
       case "bridge:readBrowserCapture":
         return null as BridgeInvokeMap[K]["response"];
       case "bridge:send": {
         const request = req as BridgeInvokeMap["bridge:send"]["request"];
         const state = this.requireActive(request.conversationId);
         if (state.running) throw runningConversation(request.conversationId);
         this.scriptReply(state);
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:guide": {
         const request = req as BridgeInvokeMap["bridge:guide"]["request"];
         const state = this.requireActive(request.conversationId);
         if (!state.running) throw new Error("当前没有正在执行的任务。");
         return { delivery: "applied" } as BridgeInvokeMap[K]["response"];
       }
       case "bridge:interrupt": {
         const request = req as BridgeInvokeMap["bridge:interrupt"]["request"];
         const state = this.requireActive(request.conversationId);
         this.doInterrupt(state);
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:setModel": {
         const request = req as BridgeInvokeMap["bridge:setModel"]["request"];
         const state = this.requireActive(request.conversationId);
         state.providerId = request.providerId;
         state.modelId = request.modelId;
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:disposeConversation": {
         const request = req as BridgeInvokeMap["bridge:disposeConversation"]["request"];
         const state = this.conversations.get(request.conversationId);
         if (!state) throw unknownConversation(request.conversationId);
         if (!state.disposed) {
           this.cancelTimers(state);
           state.interaction = undefined;
           state.running = false;
           state.interrupted = true;
           state.disposed = true;
         }
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:fetchBalance":
         return { supported: false } as BridgeInvokeMap[K]["response"];
       case "bridge:usageSummary":
         return { byProvider: [], byDay: [] } as BridgeInvokeMap[K]["response"];
       case "bridge:getSearchSources":
         return this.searchSources.map((source) => ({
           ...source,
           configuredFields: [...source.configuredFields],
         })) as BridgeInvokeMap[K]["response"];
       case "bridge:saveSearchKey": {
         const request = req as BridgeInvokeMap["bridge:saveSearchKey"]["request"];
         const configured = request.apiKey.trim().length > 0
           && (request.source !== "google" || (request.engineId?.trim().length ?? 0) > 0);
         this.searchSources = this.searchSources.map((source) => source.id === request.source
           ? {
               ...source,
               configured,
               configuredFields: configured
                 ? request.source === "google" ? ["apiKey", "engineId"] : ["apiKey"]
                 : [],
             }
           : source);
         return this.searchSources.map((source) => ({
           ...source,
           configuredFields: [...source.configuredFields],
         })) as BridgeInvokeMap[K]["response"];
       }
       // Skills (轮 2 卡 E): the fixture has no filesystem, so it reports none.
       // Explicit cases rather than falling through to the `default` throw —
       // SkillsPage refreshes on mount and BridgeProvider refreshes at startup,
       // both of which run against this client in browser dev.
       case "bridge:listSkills":
         return [] as BridgeInvokeMap[K]["response"];
       case "bridge:listCommunitySkills":
         return [] as BridgeInvokeMap[K]["response"];
       case "bridge:getCommunitySkillDetails":
         throw new Error("技能完整说明只在桌面版中可用。");
       case "bridge:openSkillsDir":
         return undefined as BridgeInvokeMap[K]["response"];
       case "bridge:pickSkillSource":
         return {} as BridgeInvokeMap[K]["response"];
       case "bridge:inspectSkillSource":
       case "bridge:installSkill":
       case "bridge:installCommunitySkill":
       case "bridge:scanInstalledSkill":
       case "bridge:removeSkill":
         throw new Error("本地 Skill 安装只在桌面版中可用。");
       case "bridge:listMemory": {
         const request = req as BridgeInvokeMap["bridge:listMemory"]["request"];
         return this.memories
           .filter((memory) => request.scopes.some((scope) => sameMemoryScope(scope, memory.scope)))
           .filter((memory) => request.includeInactive || memory.status === "current")
           .map((memory) => ({ ...memory, scope: { ...memory.scope } })) as BridgeInvokeMap[K]["response"];
       }
       case "bridge:updateMemory": {
         const request = req as BridgeInvokeMap["bridge:updateMemory"]["request"];
         const existing = this.memories.find((memory) => memory.id === request.id && sameMemoryScope(memory.scope, request.scope));
         if (!existing) throw new Error("Fixture memory not found");
         const memory: MemoryView = {
           ...existing,
           ...(request.topic === undefined ? {} : { topic: request.topic }),
           ...(request.statement === undefined ? {} : { statement: request.statement }),
           ...(request.kind === undefined ? {} : { kind: request.kind }),
           ...(request.validFrom === undefined ? {} : { validFrom: request.validFrom }),
           learnedAt: existing.learnedAt + this.nextMemoryChange + 1,
           lastConfirmedAt: existing.learnedAt + this.nextMemoryChange + 1,
           sourceType: "settings-edit",
         };
         const changeId = `fixture-change-${++this.nextMemoryChange}`;
         this.memories = this.memories.map((candidate) => candidate.id === existing.id ? memory : candidate);
         this.memoryLatest.set(memory.id, memory);
         this.memoryHistory.set(existing.id, [...(this.memoryHistory.get(existing.id) ?? []), memory]);
         this.memoryChanges.set(changeId, { before: existing, after: memory });
         return {
           changeId,
           action: "updated",
           label: memory.statement,
           memory,
         } as BridgeInvokeMap[K]["response"];
       }
       case "bridge:deleteMemory": {
         const request = req as BridgeInvokeMap["bridge:deleteMemory"]["request"];
         const existing = this.memories.find((memory) => memory.id === request.id && sameMemoryScope(memory.scope, request.scope));
         if (!existing) throw new Error("Fixture memory not found");
         const memory: MemoryView = { ...existing, status: "deleted" };
         const changeId = `fixture-change-${++this.nextMemoryChange}`;
         this.memories = this.memories.filter((candidate) => candidate.id !== existing.id);
         this.memoryLatest.set(memory.id, memory);
         this.memoryHistory.set(existing.id, [...(this.memoryHistory.get(existing.id) ?? []), memory]);
         this.memoryChanges.set(changeId, { before: existing, after: memory });
         return {
           changeId,
           action: "removed",
           label: existing.statement,
           memory,
         } as BridgeInvokeMap[K]["response"];
       }
       case "bridge:pinMemory": {
         const request = req as BridgeInvokeMap["bridge:pinMemory"]["request"];
         const existing = this.memories.find((memory) => memory.id === request.id && sameMemoryScope(memory.scope, request.scope));
         if (!existing) throw new Error("Fixture memory not found");
         const memory: MemoryView = { ...existing, pinned: request.pinned };
         const changeId = `fixture-change-${++this.nextMemoryChange}`;
         this.memories = this.memories.map((candidate) => candidate.id === existing.id ? memory : candidate);
         this.memoryLatest.set(memory.id, memory);
         this.memoryHistory.set(existing.id, [...(this.memoryHistory.get(existing.id) ?? []), memory]);
         this.memoryChanges.set(changeId, { before: existing, after: memory });
         return {
           changeId,
           action: request.pinned ? "pinned" : "unpinned",
           label: existing.statement,
           memory,
         } as BridgeInvokeMap[K]["response"];
       }
       case "bridge:memoryHistory": {
         const request = req as BridgeInvokeMap["bridge:memoryHistory"]["request"];
         return (this.memoryHistory.get(request.id) ?? [])
           .filter((memory) => sameMemoryScope(memory.scope, request.scope))
           .map((memory) => ({ ...memory, scope: { ...memory.scope } })) as BridgeInvokeMap[K]["response"];
       }
       case "bridge:undoMemory": {
         const request = req as BridgeInvokeMap["bridge:undoMemory"]["request"];
         const change = this.memoryChanges.get(request.targetChangeId);
         if (!change) {
           return { ok: false, targetChangeId: request.targetChangeId } as BridgeInvokeMap[K]["response"];
         }
         if (change.after && JSON.stringify(this.memoryLatest.get(change.after.id)) !== JSON.stringify(change.after)) {
           return {
             ok: false,
             conflict: true,
             targetChangeId: request.targetChangeId,
           } as BridgeInvokeMap[K]["response"];
         }
         if (change.after) this.memories = this.memories.filter((memory) => memory.id !== change.after!.id);
         if (change.before?.status === "current") {
           this.memories.push(change.before);
           this.memoryLatest.set(change.before.id, change.before);
         } else if (change.after) {
           this.memoryLatest.delete(change.after.id);
         }
         this.memoryChanges.delete(request.targetChangeId);
         const changeId = `fixture-change-${++this.nextMemoryChange}`;
         if (request.conversationId) {
           this.emit("bridge:event", {
             conversationId: request.conversationId,
             event: {
               type: "memory.changed",
               changeId,
               targetChangeId: request.targetChangeId,
               action: "undone",
               label: "",
               scope: request.scope,
             },
           });
         }
         return {
           ok: true,
           changeId,
           targetChangeId: request.targetChangeId,
           action: "undone",
         } as BridgeInvokeMap[K]["response"];
       }
       case "bridge:openMemoryDir":
         return undefined as BridgeInvokeMap[K]["response"];
       case "bridge:listWhitelist":
         return this.whitelist.map((entry) => ({ ...entry })) as BridgeInvokeMap[K]["response"];
       case "bridge:revokeWhitelist": {
         const request = req as BridgeInvokeMap["bridge:revokeWhitelist"]["request"];
         const index = this.whitelist.findIndex((entry) => entry.toolName === request.toolName && entry.risk === request.risk);
         if (index >= 0) this.whitelist.splice(index, 1);
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:approvalDecision": {
         this.resolveApproval(req as ApprovalDecision);
         return undefined as BridgeInvokeMap[K]["response"];
       }
       case "bridge:askUserAnswer": {
         this.resolveAsk(req as AskUserAnswer);
         return undefined as BridgeInvokeMap[K]["response"];
       }
       default:
         throw new Error(`Unsupported bridge channel: ${String(channel)}`);
     }
   }

   subscribe<K extends keyof BridgeEventMap>(
     channel: K,
     cb: (payload: BridgeEventMap[K]) => void,
   ): () => void {
     const set = this.listeners.get(channel) ?? new Set<Listener>();
     set.add(cb as Listener);
     this.listeners.set(channel, set);
     return () => set.delete(cb as Listener);
   }

   private requireActive(conversationId: string): ConversationFixtureState {
     const state = this.conversations.get(conversationId);
     if (!state) throw unknownConversation(conversationId);
     if (state.disposed) throw disposedConversation(conversationId);
     return state;
   }

   private emit<K extends keyof BridgeEventMap>(channel: K, payload: BridgeEventMap[K]): void {
     this.listeners.get(channel)?.forEach((listener) => listener(payload));
   }

   private emitEvent(state: ConversationFixtureState, event: LeemoEvent): void {
     const envelope: BridgeEventEnvelope = { conversationId: state.id, event };
     this.emit("bridge:event", envelope);
   }

   private schedule(state: ConversationFixtureState, delay: number, task: () => void): void {
     const timer = setTimeout(() => {
       state.pendingTimers.delete(timer);
       if (!state.disposed && !state.interrupted) task();
     }, delay);
     state.pendingTimers.add(timer);
   }

   private cancelTimers(state: ConversationFixtureState): void {
     for (const timer of state.pendingTimers) clearTimeout(timer);
     state.pendingTimers.clear();
   }

   private doInterrupt(state: ConversationFixtureState): void {
     if (!state.running || state.interrupted) return;
     this.cancelTimers(state);
     state.interaction = undefined;
     state.interrupted = true;
     state.running = false;
     this.emitEvent(state, {
       type: "run.finished", subtype: "interrupted", isError: false,
       finalText: "", pathAudit: { claimed: [] },
     });
   }

   private denyRun(state: ConversationFixtureState): void {
     this.cancelTimers(state);
     state.interaction = undefined;
     state.interrupted = true;
     state.running = false;
     this.emitEvent(state, {
       type: "run.finished", subtype: "denied", isError: true,
       finalText: "", pathAudit: { claimed: [] },
     });
   }

   private scriptReply(state: ConversationFixtureState): void {
     state.running = true;
     state.interrupted = false;
     if (!state.started) {
       this.schedule(state, this.chunkDelayMs, () => {
         state.started = true;
         this.emitEvent(state, {
           type: "conversation.started", sessionId: this.sessionId,
         });
       });
     }
     if (this.customReply !== undefined) {
       let elapsed = this.chunkDelayMs;
       const chunks = this.customReply.match(/\S+\s*/g) ?? [this.customReply];
       for (const chunk of chunks) {
         this.schedule(state, elapsed += this.chunkDelayMs, () => this.emitEvent(state, { type: "text.delta", text: chunk }));
       }
       this.schedule(state, elapsed += this.chunkDelayMs, () => this.emitEvent(state, { type: "text.final", text: this.customReply as string }));
       this.schedule(state, elapsed += this.chunkDelayMs, () => {
         state.running = false;
         this.emitEvent(state, {
           type: "run.finished", subtype: "success", isError: false,
           finalText: this.customReply as string, pathAudit: { claimed: [] },
         });
       });
       return;
     }

     const checkpoint = Math.min(5, DEMO_TURN_EVENTS.length);
     let elapsed = this.chunkDelayMs;
     for (const event of DEMO_TURN_EVENTS.slice(0, checkpoint)) {
       this.schedule(state, elapsed += this.chunkDelayMs, () => this.emitEvent(state, event));
     }
     this.schedule(state, elapsed += this.chunkDelayMs, () => this.requestApproval(state));
   }

   private requestApproval(state: ConversationFixtureState): void {
     if (state.interaction || !state.running) return;
     const id = `approval-${++this.nextInteraction}`;
     state.interaction = { kind: "approval", id, conversationId: state.id };
     const payload: ApprovalRequest = {
       id,
       conversationId: state.id,
       toolName: "Bash",
       inputSummary: "Bash: ls -la notebooks",
       risk: "moderate",
     };
     this.emit("bridge:approvalRequest", payload);
   }

   private requestAsk(state: ConversationFixtureState): void {
     if (state.interaction || !state.running) return;
     const id = `ask-${++this.nextInteraction}`;
     state.interaction = { kind: "ask", id, conversationId: state.id };
     const payload: AskUserPayload = {
       id,
       conversationId: state.id,
       questions: [{
         header: "整理范围",
         question: "要把这份笔记放进哪个章节？",
         options: [
           { label: "遍历", description: "放进遍历章节，和图搜索、树遍历的笔记一起整理。" },
           { label: "平衡树", description: "放进平衡树章节，后续继续补 AVL 与红黑树的对照。" },
         ],
       }],
     };
     this.emit("bridge:askUser", payload);
   }

   private resolveApproval(decision: ApprovalDecision): void {
     const state = this.findInteraction(decision.id);
     if (!state || state.interaction?.kind !== "approval") throw new Error("Unknown or duplicate approval request");
     const suppliedConversationId = (decision as ApprovalDecision & { conversationId?: string }).conversationId;
     if (suppliedConversationId !== undefined && suppliedConversationId !== state.id) throw new Error("Approval conversation mismatch");
     const runtimeDecision = (decision as ApprovalDecision & { decision: unknown }).decision;
     if (runtimeDecision === "deny" || (runtimeDecision !== "allow-once" && runtimeDecision !== "allow-conversation" && runtimeDecision !== "allow-permanent")) {
       this.denyRun(state);
       return;
     }
     state.interaction = undefined;
     this.schedule(state, 300, () => this.requestAsk(state));
   }

   private resolveAsk(answer: AskUserAnswer): void {
     const state = this.findInteraction(answer.id);
     if (!state || state.interaction?.kind !== "ask") throw new Error("Unknown or duplicate ask request");
     const suppliedConversationId = (answer as AskUserAnswer & { conversationId?: string }).conversationId;
     if (suppliedConversationId !== undefined && suppliedConversationId !== state.id) throw new Error("Ask conversation mismatch");
     state.interaction = undefined;
     this.schedule(state, 300, () => this.emitTail(state));
   }

   private emitTail(state: ConversationFixtureState): void {
     const tail = DEMO_TURN_EVENTS.slice(5);
     let elapsed = 0;
     for (const event of tail) {
       this.schedule(state, elapsed += this.chunkDelayMs, () => {
         if (event.type === "run.finished") state.running = false;
         this.emitEvent(state, event);
       });
     }
   }

   private findInteraction(id: string): ConversationFixtureState | undefined {
     return [...this.conversations.values()].find((state) => state.interaction?.id === id);
   }

   /** Test helper: emit approval request for a specific conversation. Registers
    *  the interaction so a later bridge:approvalDecision resolves (not "unknown"). */
   emitApprovalRequest(payload: ApprovalRequest): void {
     const state = this.conversations.get(payload.conversationId);
     if (state && !state.disposed) {
       state.interaction = { kind: "approval", id: payload.id, conversationId: payload.conversationId };
     }
     this.emit("bridge:approvalRequest", payload);
   }

   /** Test helper: emit ask user request for a specific conversation. Registers
    *  the interaction so a later bridge:askUserAnswer resolves (not "unknown"). */
   emitAskUser(payload: AskUserPayload): void {
     const state = this.conversations.get(payload.conversationId);
     if (state && !state.disposed) {
       state.interaction = { kind: "ask", id: payload.id, conversationId: payload.conversationId };
     }
     this.emit("bridge:askUser", payload);
   }
 }
