import { randomUUID } from "node:crypto";
import { auditClaimedPaths, type LeemoEvent, type UsageRecord } from "../bridge/events";
import type { PermissionMode } from "../bridge/interact";
import type {
  CodexDynamicToolCall,
  CodexDynamicToolRegistry,
  CodexDynamicToolResponse,
} from "./codex-dynamic-tools";

export interface CodexAppServerTransport {
  request<TResult>(method: string, params?: unknown): Promise<TResult>;
  onNotification(method: string, handler: (params: unknown) => void): () => void;
  onServerRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown> | unknown,
  ): () => void;
}

export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CodexApprovalRequest {
  kind: "command" | "file-change" | "tool";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason?: string;
}

export interface CodexConversationConfig {
  id?: string;
  resumeThreadId?: string;
  cwd: string;
  workspaceRoot: string;
  providerId: string;
  modelId: string;
  developerInstructions?: string;
  permissionMode: PermissionMode;
  webSearchEnabled?: boolean;
  webFetchEnabled?: boolean;
  dynamicTools?: CodexDynamicToolRegistry;
  approve?: (request: CodexApprovalRequest) => Promise<CodexApprovalDecision>;
  answerUserInput?: (params: unknown) => Promise<unknown>;
}

export type CodexConversationState = "idle" | "running" | "disposed";

export interface CodexConversationHandle {
  readonly id: string;
  readonly state: CodexConversationState;
  send(prompt: string): AsyncIterable<LeemoEvent>;
  guide(prompt: string): Promise<"applied" | "queued">;
  interrupt(): Promise<boolean>;
  setModel(modelId: string): void;
  setPermissionMode(mode: PermissionMode): void;
  setDeveloperInstructions(instructions: string): void;
  setNetworkCapabilities(capabilities: {
    webSearchEnabled: boolean;
    webFetchEnabled: boolean;
  }): void;
  dispose(): void;
}

export interface CodexExecutionRuntimeOptions {
  transport: CodexAppServerTransport;
}

export interface CodexExecutionRuntime {
  createConversation(config: CodexConversationConfig): CodexConversationHandle;
  dispose(): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class EventQueue implements AsyncIterable<LeemoEvent> {
  private readonly buffered: LeemoEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<LeemoEvent>) => void> = [];
  private closed = false;

  push(event: LeemoEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.buffered.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<LeemoEvent> {
    return {
      next: () => {
        const event = this.buffered.shift();
        if (event) return Promise.resolve({ value: event, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<LeemoEvent>>((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

interface ActiveRound {
  queue: EventQueue;
  turnReady: Deferred<void>;
  turnId?: string;
  finalText: string;
  streamedText: string;
  usage?: UsageRecord;
  errorEmitted: boolean;
  retryAttempt: number;
}

interface ThreadResponse {
  thread?: { id?: unknown };
}

interface TurnStartResponse {
  turn?: { id?: unknown };
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function compactSummary(value: unknown, fallback: string): string {
  let raw = fallback;
  if (typeof value === "string") raw = value;
  else if (value !== undefined && value !== null) {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = fallback;
    }
  }
  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > 480 ? `${normalized.slice(0, 477)}...` : normalized;
}

function retryCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function retryDetail(body: RecordValue | undefined): string {
  const nested = record(body?.error);
  const raw = text(body?.message)
    ?? text(body?.error)
    ?? text(nested?.message)
    ?? text(body?.additionalDetails)
    ?? "连接在收到完整响应前中断";
  // Retry diagnostics are inspectable, but credentials and host-local paths
  // still cannot cross the IPC boundary.
  return compactSummary(raw, "连接在收到完整响应前中断")
    .replace(/\bBearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[已隐藏凭据]")
    .replace(/[A-Za-z]:\\[^\s,;]+/g, "[本地路径]");
}

function threadIdFrom(params: unknown): string | undefined {
  return text(record(params)?.threadId);
}

function turnIdFrom(params: unknown): string | undefined {
  const body = record(params);
  return text(body?.turnId) ?? text(record(body?.turn)?.id);
}

function permissionSettings(mode: PermissionMode, workspaceRoot: string, networkAccess: boolean): {
  approvalPolicy: "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  sandboxPolicy:
    | { type: "readOnly"; networkAccess: boolean }
    | { type: "dangerFullAccess" }
    | {
        type: "workspaceWrite";
        writableRoots: string[];
        networkAccess: boolean;
        excludeTmpdirEnvVar: boolean;
        excludeSlashTmp: boolean;
      };
} {
  if (mode === "bypassPermissions") {
    return {
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  if (mode === "plan") {
    return {
      approvalPolicy: "on-request",
      sandbox: "read-only",
      sandboxPolicy: { type: "readOnly", networkAccess },
    };
  }
  return {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [workspaceRoot],
      networkAccess,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

const TURN_NOTIFICATION_METHODS = [
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/started",
  "item/completed",
  "thread/tokenUsage/updated",
  "thread/compacted",
  "turn/completed",
  "error",
] as const;

class CodexExecutionRuntimeImpl implements CodexExecutionRuntime {
  private readonly transport: CodexAppServerTransport;
  private readonly byThread = new Map<string, CodexConversation>();
  private readonly conversations = new Set<CodexConversation>();
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;

  constructor(options: CodexExecutionRuntimeOptions) {
    this.transport = options.transport;
    for (const method of TURN_NOTIFICATION_METHODS) {
      this.unsubscribers.push(this.transport.onNotification(method, (params) => {
        const threadId = threadIdFrom(params);
        if (threadId) this.byThread.get(threadId)?.receive(method, params);
      }));
    }
    this.unsubscribers.push(
      this.transport.onServerRequest(
        "item/commandExecution/requestApproval",
        (params) => this.handleApproval("command", params),
      ),
      this.transport.onServerRequest(
        "item/fileChange/requestApproval",
        (params) => this.handleApproval("file-change", params),
      ),
      this.transport.onServerRequest("item/tool/requestUserInput", (params) => {
        const threadId = threadIdFrom(params);
        const conversation = threadId ? this.byThread.get(threadId) : undefined;
        return conversation?.answerUserInput(params) ?? { answers: {} };
      }),
      this.transport.onServerRequest("item/tool/call", (params) => {
        const threadId = threadIdFrom(params);
        const conversation = threadId ? this.byThread.get(threadId) : undefined;
        return conversation?.callDynamicTool(params) ?? {
          success: false,
          contentItems: [{ type: "inputText", text: "这个工具当前不可用。" }],
        };
      }),
    );
  }

  createConversation(config: CodexConversationConfig): CodexConversationHandle {
    if (this.disposed) throw new Error("本地执行组件已经关闭，请重启 Leemo 后再试。");
    const conversation = new CodexConversation(this, this.transport, config);
    this.conversations.add(conversation);
    if (config.resumeThreadId) this.bindThread(conversation, config.resumeThreadId);
    return conversation;
  }

  bindThread(conversation: CodexConversation, threadId: string): void {
    for (const [knownThreadId, owner] of this.byThread) {
      if (owner === conversation && knownThreadId !== threadId) this.byThread.delete(knownThreadId);
    }
    this.byThread.set(threadId, conversation);
  }

  release(conversation: CodexConversation): void {
    this.conversations.delete(conversation);
    for (const [threadId, owner] of this.byThread) {
      if (owner === conversation) this.byThread.delete(threadId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const conversation of [...this.conversations]) conversation.dispose();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.byThread.clear();
  }

  private async handleApproval(
    kind: CodexApprovalRequest["kind"],
    params: unknown,
  ): Promise<{ decision: CodexApprovalDecision }> {
    const body = record(params);
    const threadId = text(body?.threadId);
    const conversation = threadId ? this.byThread.get(threadId) : undefined;
    if (!conversation) return { decision: "decline" };
    return { decision: await conversation.approveRequest(kind, body ?? {}) };
  }
}

class CodexConversation implements CodexConversationHandle {
  readonly id: string;
  private readonly runtime: CodexExecutionRuntimeImpl;
  private readonly transport: CodexAppServerTransport;
  private readonly config: CodexConversationConfig;
  private threadId: string | undefined;
  private threadLoaded = false;
  private active: ActiveRound | undefined;
  private _state: CodexConversationState = "idle";

  constructor(
    runtime: CodexExecutionRuntimeImpl,
    transport: CodexAppServerTransport,
    config: CodexConversationConfig,
  ) {
    this.runtime = runtime;
    this.transport = transport;
    this.config = { ...config };
    this.id = config.id ?? randomUUID();
    this.threadId = config.resumeThreadId;
  }

  get state(): CodexConversationState {
    return this._state;
  }

  send(prompt: string): AsyncIterable<LeemoEvent> {
    if (this._state === "disposed") throw new Error("cannot send on a disposed conversation");
    if (this._state === "running") throw new Error("cannot send while a turn is already running");
    const round: ActiveRound = {
      queue: new EventQueue(),
      turnReady: deferred<void>(),
      finalText: "",
      streamedText: "",
      errorEmitted: false,
      retryAttempt: 0,
    };
    this.active = round;
    this._state = "running";
    void this.startRound(round, prompt);
    return round.queue;
  }

  async interrupt(): Promise<boolean> {
    const round = this.active;
    if (!round) return true;
    try {
      if (!round.turnId) await round.turnReady.promise;
      if (!this.threadId || !round.turnId) return false;
      await this.transport.request("turn/interrupt", {
        threadId: this.threadId,
        turnId: round.turnId,
      });
      return true;
    } catch {
      return false;
    }
  }

  async guide(prompt: string): Promise<"applied"> {
    const round = this.active;
    const message = prompt.trim();
    if (!round || this._state !== "running") throw new Error("当前没有正在执行的任务。");
    if (!message) throw new Error("引导内容不能为空。");
    if (!round.turnId) await round.turnReady.promise;
    if (!this.threadId || !round.turnId || this.active !== round) {
      throw new Error("当前任务暂时不能接收引导，请稍后重试。");
    }
    await this.transport.request("turn/steer", {
      threadId: this.threadId,
      expectedTurnId: round.turnId,
      input: [{ type: "text", text: message, text_elements: [] }],
    });
    return "applied";
  }

  setModel(modelId: string): void {
    this.config.modelId = modelId;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.config.permissionMode = mode;
  }

  setDeveloperInstructions(instructions: string): void {
    this.config.developerInstructions = instructions;
  }

  setNetworkCapabilities(capabilities: {
    webSearchEnabled: boolean;
    webFetchEnabled: boolean;
  }): void {
    this.config.webSearchEnabled = capabilities.webSearchEnabled;
    this.config.webFetchEnabled = capabilities.webFetchEnabled;
  }

  dispose(): void {
    if (this._state === "disposed") return;
    if (this.active) void this.interrupt();
    this._state = "disposed";
    this.active?.queue.close();
    this.active = undefined;
    this.runtime.release(this);
    void this.config.dynamicTools?.dispose();
  }

  async approveRequest(
    kind: CodexApprovalRequest["kind"],
    params: RecordValue,
  ): Promise<CodexApprovalDecision> {
    if (!this.config.approve) return "decline";
    const command = text(params.command);
    const cwd = text(params.cwd);
    const reason = text(params.reason);
    const toolUseId = text(params.itemId) ?? "unknown";
    const request: CodexApprovalRequest = kind === "command"
      ? {
          kind,
          toolUseId,
          toolName: "Bash",
          input: {
            ...(command ? { command } : {}),
            ...(cwd ? { cwd } : {}),
          },
          ...(reason ? { reason } : {}),
        }
      : {
          kind,
          toolUseId,
          toolName: "Edit",
          input: {
            ...(text(params.grantRoot) ? { path: text(params.grantRoot) } : {}),
          },
          ...(reason ? { reason } : {}),
        };
    try {
      return await this.config.approve(request);
    } catch {
      return "decline";
    }
  }

  answerUserInput(params: unknown): Promise<unknown> | unknown {
    return this.config.answerUserInput?.(params) ?? { answers: {} };
  }

  callDynamicTool(params: unknown): Promise<CodexDynamicToolResponse> | CodexDynamicToolResponse {
    const body = record(params);
    const call: CodexDynamicToolCall | undefined = body
      && typeof body.threadId === "string"
      && typeof body.turnId === "string"
      && typeof body.callId === "string"
      && (typeof body.namespace === "string" || body.namespace === null)
      && typeof body.tool === "string"
      ? {
          threadId: body.threadId,
          turnId: body.turnId,
          callId: body.callId,
          namespace: body.namespace,
          tool: body.tool,
          arguments: body.arguments,
        }
      : undefined;
    if (!call || !this.config.dynamicTools) {
      return {
        success: false,
        contentItems: [{ type: "inputText", text: "这个工具当前不可用。" }],
      };
    }
    return this.config.dynamicTools.call(call);
  }

  receive(method: string, params: unknown): void {
    const round = this.active;
    if (!round || this._state !== "running") return;
    const eventTurnId = turnIdFrom(params);
    if (round.turnId && eventTurnId && round.turnId !== eventTurnId) return;

    const body = record(params);
    if (method === "item/reasoning/summaryTextDelta") {
      const delta = text(body?.delta);
      if (delta) round.queue.push({ type: "thinking.delta", text: delta });
      return;
    }
    if (method === "item/agentMessage/delta") {
      const delta = text(body?.delta);
      if (delta) {
        round.streamedText += delta;
        round.queue.push({ type: "text.delta", text: delta });
      }
      return;
    }
    if (method === "item/started") {
      const item = body?.item;
      for (const event of startedEvents(item, this.dynamicToolName(item))) round.queue.push(event);
      return;
    }
    if (method === "item/completed") {
      const item = record(body?.item);
      if (item?.type === "agentMessage") {
        const finalText = text(item.text);
        if (finalText) {
          round.finalText = finalText;
          round.queue.push({ type: "text.final", text: finalText });
        }
        return;
      }
      for (const event of completedEvents(item)) round.queue.push(event);
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const last = record(record(body?.tokenUsage)?.last);
      if (last) {
        round.usage = {
          providerId: this.config.providerId,
          modelId: this.config.modelId,
          inputTokens: number(last.inputTokens),
          outputTokens: number(last.outputTokens),
          cacheReadTokens: number(last.cachedInputTokens),
          cacheCreationTokens: number(last.cacheWriteInputTokens),
          costSource: "unpriced",
          tokensEstimated: false,
        };
      }
      return;
    }
    if (method === "thread/compacted") {
      round.queue.push({ type: "compact.boundary", trigger: "automatic", preTokens: 0 });
      return;
    }
    if (method === "error") {
      if (body?.willRetry === true) {
        const maxAttempts = Math.min(5, retryCount(body.maxRetries ?? body.max_retries ?? body.maxAttempts, 5));
        const explicitAttempt = body.attempt ?? body.retryAttempt;
        const attempt = Math.min(maxAttempts, explicitAttempt === undefined
          ? round.retryAttempt + 1
          : retryCount(explicitAttempt, round.retryAttempt + 1));
        round.retryAttempt = attempt;
        round.queue.push({
          type: "stream.retry",
          attempt,
          maxAttempts,
          summary: `正在重新连接 ${attempt}/${maxAttempts}`,
          detail: retryDetail(body),
        });
        return;
      }
      if (body?.willRetry === false && !round.errorEmitted) {
        round.errorEmitted = true;
        round.queue.push({
          type: "error",
          message: "任务遇到了问题，Leemo 正在等待本轮结束状态。",
        });
      }
      return;
    }
    if (method === "turn/completed") this.finishRound(round, body);
  }

  private async startRound(round: ActiveRound, prompt: string): Promise<void> {
    try {
      const threadId = await this.ensureThread();
      if (this.active !== round || this._state === "disposed") {
        round.turnReady.resolve();
        return;
      }
      round.queue.push({ type: "conversation.started", sessionId: threadId });
      const settings = permissionSettings(
        this.config.permissionMode,
        this.config.workspaceRoot,
        this.networkAccessEnabled(),
      );
      const response = await this.transport.request<TurnStartResponse>("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        model: this.config.modelId,
        cwd: this.config.cwd,
        approvalPolicy: settings.approvalPolicy,
        sandboxPolicy: settings.sandboxPolicy,
      });
      const turnId = text(response.turn?.id);
      if (!turnId) throw new Error("missing turn id");
      round.turnId = turnId;
      round.turnReady.resolve();
    } catch {
      round.turnReady.resolve();
      if (this.active !== round || this._state === "disposed") return;
      round.errorEmitted = true;
      round.queue.push({
        type: "error",
        message: "ChatGPT 订阅暂时无法开始任务，请检查登录状态或网络后重试。",
      });
      round.queue.push({
        type: "run.finished",
        subtype: "error",
        isError: true,
        finalText: "",
        pathAudit: { claimed: [] },
        ...(this.threadId ? { sessionId: this.threadId } : {}),
      });
      round.queue.close();
      this.active = undefined;
      this._state = "idle";
    }
  }

  private async ensureThread(): Promise<string> {
    if (this.threadLoaded && this.threadId) return this.threadId;
    const settings = permissionSettings(
      this.config.permissionMode,
      this.config.workspaceRoot,
      this.networkAccessEnabled(),
    );
    const overrides = {
      model: this.config.modelId,
      cwd: this.config.cwd,
      runtimeWorkspaceRoots: [this.config.workspaceRoot],
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandbox,
      config: {
        web_search: this.config.webSearchEnabled === true ? "live" : "disabled",
        tools: { web_search: this.config.webSearchEnabled === true },
      },
      ...(this.config.developerInstructions
        ? { developerInstructions: this.config.developerInstructions }
        : {}),
    };
    let response: ThreadResponse;
    if (this.threadId) {
      try {
        response = await this.transport.request<ThreadResponse>("thread/resume", {
          threadId: this.threadId,
          ...overrides,
        });
      } catch {
        this.threadId = undefined;
        response = await this.transport.request<ThreadResponse>("thread/start", {
          ...overrides,
          ...(this.config.dynamicTools?.specs.length
            ? { dynamicTools: this.config.dynamicTools.specs }
            : {}),
        });
      }
    } else {
      response = await this.transport.request<ThreadResponse>("thread/start", {
        ...overrides,
        ...(this.config.dynamicTools?.specs.length
          ? { dynamicTools: this.config.dynamicTools.specs }
          : {}),
      });
    }
    const threadId = text(response.thread?.id);
    if (!threadId) throw new Error("missing thread id");
    this.threadId = threadId;
    this.threadLoaded = true;
    this.runtime.bindThread(this, threadId);
    return threadId;
  }

  private networkAccessEnabled(): boolean {
    return this.config.webSearchEnabled === true || this.config.webFetchEnabled === true;
  }

  private dynamicToolName(value: unknown): string | undefined {
    const item = record(value);
    if (item?.type !== "dynamicToolCall" || typeof item.tool !== "string") return undefined;
    const namespace = typeof item.namespace === "string" || item.namespace === null
      ? item.namespace
      : null;
    return this.config.dynamicTools?.canonicalName({ namespace, tool: item.tool });
  }

  private finishRound(round: ActiveRound, params: RecordValue | undefined): void {
    if (this.active !== round) return;
    const turn = record(params?.turn);
    const status = text(turn?.status) ?? "failed";
    if (!round.finalText) round.finalText = round.streamedText;
    if (round.usage) {
      const durationMs = number(turn?.durationMs);
      round.queue.push({
        type: "usage.final",
        usage: durationMs > 0 ? { ...round.usage, durationMs } : round.usage,
      });
    }
    const isError = status === "failed";
    if (isError && !round.errorEmitted) {
      round.errorEmitted = true;
      round.queue.push({
        type: "error",
        message: "任务没有完成，请检查订阅状态或网络后重试。",
      });
    }
    round.queue.push({
      type: "run.finished",
      subtype: status === "interrupted" ? "interrupted" : isError ? "error" : "completed",
      isError,
      finalText: round.finalText,
      pathAudit: auditClaimedPaths(round.finalText, this.config.cwd),
      ...(this.threadId ? { sessionId: this.threadId } : {}),
    });
    round.queue.close();
    this.active = undefined;
    if (this._state !== "disposed") this._state = "idle";
  }
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function startedEvents(value: unknown, dynamicToolName?: string): LeemoEvent[] {
  const item = record(value);
  const type = text(item?.type);
  const id = text(item?.id);
  if (!item || !type || !id) return [];
  if (type === "commandExecution") {
    return [{
      type: "tool.started",
      toolUseId: id,
      name: "Bash",
      input: { command: text(item.command) ?? "", cwd: text(item.cwd) ?? "" },
      subagent: false,
    }];
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return [{
      type: "tool.started",
      toolUseId: id,
      name: "Edit",
      input: { paths: changes.map((change) => text(record(change)?.path)).filter(Boolean) },
      subagent: false,
    }];
  }
  if (type === "mcpToolCall") {
    return [{
      type: "tool.started",
      toolUseId: id,
      name: `mcp__${text(item.server) ?? "unknown"}__${text(item.tool) ?? "tool"}`,
      input: item.arguments ?? {},
      subagent: false,
    }];
  }
  if (type === "dynamicToolCall") {
    return [{
      type: "tool.started",
      toolUseId: id,
      name: dynamicToolName ?? text(item.tool) ?? "Tool",
      input: item.arguments ?? {},
      subagent: false,
    }];
  }
  if (type === "collabAgentToolCall") {
    return [
      {
        type: "tool.started",
        toolUseId: id,
        name: "Agent",
        input: {
          action: item.tool,
          prompt: item.prompt,
          receiverThreadIds: item.receiverThreadIds,
        },
        subagent: true,
      },
      { type: "subagent.activity", parentToolUseId: id },
    ];
  }
  if (type === "subAgentActivity") {
    return [{ type: "subagent.activity", parentToolUseId: id }];
  }
  if (type === "webSearch") {
    return [{ type: "tool.started", toolUseId: id, name: "WebSearch", input: {}, subagent: false }];
  }
  if (type === "contextCompaction") {
    return [{ type: "compact.boundary", trigger: "automatic", preTokens: 0 }];
  }
  return [];
}

function completedEvents(item: RecordValue | undefined): LeemoEvent[] {
  const type = text(item?.type);
  const id = text(item?.id);
  if (!item || !type || !id) return [];
  if (type === "commandExecution") {
    const status = text(item.status);
    return [{
      type: "tool.finished",
      toolUseId: id,
      isError: status === "failed" || status === "declined",
      contentSummary: compactSummary(item.aggregatedOutput, status === "completed" ? "命令已完成" : "命令未完成"),
    }];
  }
  if (type === "fileChange") {
    const status = text(item.status);
    const paths = (Array.isArray(item.changes) ? item.changes : [])
      .map((change) => text(record(change)?.path))
      .filter((path): path is string => Boolean(path));
    return [{
      type: "tool.finished",
      toolUseId: id,
      isError: status === "failed" || status === "declined",
      contentSummary: paths.length > 0 ? `已处理 ${paths.join("、")}` : compactSummary(status, "文件处理完成"),
    }];
  }
  if (type === "mcpToolCall") {
    const status = text(item.status);
    return [{
      type: "tool.finished",
      toolUseId: id,
      isError: status === "failed",
      contentSummary: compactSummary(item.error ?? item.result, status === "completed" ? "工具已完成" : "工具未完成"),
    }];
  }
  if (type === "dynamicToolCall") {
    const status = text(item.status);
    return [{
      type: "tool.finished",
      toolUseId: id,
      isError: status === "failed" || item.success === false,
      contentSummary: compactSummary(item.contentItems, status === "completed" ? "工具已完成" : "工具未完成"),
    }];
  }
  if (type === "collabAgentToolCall") {
    const status = text(item.status);
    return [{
      type: "tool.finished",
      toolUseId: id,
      isError: status === "failed",
      contentSummary: status === "completed" ? "协作任务已完成" : "协作任务未完成",
    }];
  }
  if (type === "webSearch") {
    return [{
      type: "tool.finished",
      toolUseId: id,
      isError: false,
      contentSummary: "联网检索已完成",
    }];
  }
  return [];
}

export function createCodexExecutionRuntime(
  options: CodexExecutionRuntimeOptions,
): CodexExecutionRuntime {
  return new CodexExecutionRuntimeImpl(options);
}
