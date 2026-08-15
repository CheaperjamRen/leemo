import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type InitializeResponse,
  type LoadSessionRequest,
  type McpServer,
  type NewSessionRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { auditClaimedPaths, type LeemoEvent, type UsageRecord } from "../bridge/events";
import type { PermissionMode } from "../bridge/interact";
import type {
  CodexApprovalRequest,
  CodexConversationConfig,
  CodexConversationHandle,
  CodexConversationState,
  CodexExecutionRuntime,
} from "./codex-conversation";
import {
  createGeminiMcpGateway,
  type CreateGeminiMcpGatewayOptions,
  type GeminiMcpGateway,
} from "./gemini-mcp-gateway";

export interface GeminiAcpClientStartOptions {
  cwd: string;
  deniedTools: string[];
  allowedMcpServerNames: string[];
}

export interface GeminiAcpClientHandlers {
  onSessionUpdate(params: SessionNotification): Promise<void> | void;
  onPermissionRequest(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
}

export interface GeminiAcpClient {
  start(options: GeminiAcpClientStartOptions): Promise<Pick<InitializeResponse, "authMethods">>;
  newSession(request: NewSessionRequest): Promise<{ sessionId: string }>;
  loadSession(request: LoadSessionRequest): Promise<unknown>;
  prompt(request: { sessionId: string; prompt: Array<{ type: "text"; text: string }> }): Promise<PromptResponse>;
  setSessionMode(sessionId: string, modeId: string): Promise<void>;
  setSessionModel(sessionId: string, modelId: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  dispose(): void;
}

export interface GeminiAcpLaunch {
  command: string;
  argsPrefix: string[];
}

interface RawClientConnection {
  connection: {
    sendRequest<TRequest, TResponse>(method: string, request: TRequest): Promise<TResponse>;
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Gemini client startup timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function policyFor(deniedTools: readonly string[]): string {
  return deniedTools.map((toolName) => [
    "[[rule]]",
    `toolName = ${JSON.stringify(toolName)}`,
    'decision = "deny"',
    "priority = 999",
    'denyMessage = "This capability is disabled in Leemo settings."',
    "",
  ].join("\n")).join("\n");
}

export function buildGeminiProcessEnvironment(
  launch: GeminiAcpLaunch,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source };
  for (const name of [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_GEMINI_BASE_URL",
  ]) delete env[name];
  env.GEMINI_CLI_NO_RELAUNCH = "true";
  env.NO_COLOR = "1";
  // Packaged Electron renames electron.exe to Leemo.exe. The stable signal is
  // the user-owned JavaScript entrypoint, not the executable's brand name.
  if (launch.argsPrefix.some((arg) => /\.(?:c|m)?js$/i.test(arg))) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
}

class ProcessGeminiAcpClient implements GeminiAcpClient {
  private readonly launch: GeminiAcpLaunch;
  private readonly handlers: GeminiAcpClientHandlers;
  private child: ChildProcessWithoutNullStreams | undefined;
  private acp: ClientSideConnection | undefined;
  private policyRoot: string | undefined;

  constructor(launch: GeminiAcpLaunch, handlers: GeminiAcpClientHandlers) {
    this.launch = launch;
    this.handlers = handlers;
  }

  async start(options: GeminiAcpClientStartOptions): Promise<Pick<InitializeResponse, "authMethods">> {
    if (this.acp) throw new Error("Gemini client already started");
    const args = [...this.launch.argsPrefix, "--acp"];
    if (options.allowedMcpServerNames.length > 0) {
      args.push("--allowed-mcp-server-names", options.allowedMcpServerNames.join(","));
    }
    if (options.deniedTools.length > 0) {
      this.policyRoot = mkdtempSync(path.join(os.tmpdir(), "leemo-gemini-policy-"));
      const policyPath = path.join(this.policyRoot, "leemo-settings.toml");
      writeFileSync(policyPath, policyFor(options.deniedTools), { encoding: "utf8", mode: 0o600 });
      // Supplemental admin policy is process-local and outranks the user's own
      // Gemini policy, so a disabled Leemo capability stays disabled in yolo.
      args.push("--admin-policy", policyPath);
    }

    const env = buildGeminiProcessEnvironment(this.launch);

    try {
      const child = spawn(this.launch.command, args, {
        cwd: options.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      this.child = child;
      // Drain diagnostics so a verbose external client cannot block on a full
      // stderr pipe. It may contain personal paths, so it is never logged.
      child.stderr.on("data", () => {});
      const stream = ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const acp = new ClientSideConnection(() => ({
        requestPermission: (params) => this.handlers.onPermissionRequest(params),
        sessionUpdate: (params) => this.handlers.onSessionUpdate(params),
      }), stream);
      this.acp = acp;
      const initialized = await withTimeout(acp.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "leemo", title: "Leemo", version: "0.1.1" },
      }), 20_000);
      return { authMethods: initialized.authMethods };
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  newSession(request: NewSessionRequest): Promise<{ sessionId: string }> {
    return this.requireConnection().newSession(request);
  }

  loadSession(request: LoadSessionRequest): Promise<unknown> {
    return this.requireConnection().loadSession(request);
  }

  prompt(request: { sessionId: string; prompt: Array<{ type: "text"; text: string }> }): Promise<PromptResponse> {
    return this.requireConnection().prompt(request);
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    await this.requireConnection().setSessionMode({ sessionId, modeId });
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    // Gemini CLI already implements this ACP extension, while the generic SDK
    // has not yet promoted it into the stable typed surface.
    const raw = this.requireConnection() as unknown as RawClientConnection;
    await raw.connection.sendRequest("session/set_model", { sessionId, modelId });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.requireConnection().cancel({ sessionId });
  }

  dispose(): void {
    this.acp = undefined;
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) {
      child.stdin.end();
      child.kill();
    }
    if (this.policyRoot) {
      rmSync(this.policyRoot, { recursive: true, force: true });
      this.policyRoot = undefined;
    }
  }

  private requireConnection(): ClientSideConnection {
    if (!this.acp) throw new Error("Gemini client is not started");
    return this.acp;
  }
}

export function createGeminiAcpClientFactory(
  launch: GeminiAcpLaunch,
): (handlers: GeminiAcpClientHandlers) => GeminiAcpClient {
  return (handlers) => new ProcessGeminiAcpClient(launch, handlers);
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
        return new Promise((resolve) => this.waiters.push(resolve));
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
  finalText: string;
  tools: Map<string, { name: string; input: unknown }>;
}

type CreateToolGateway = (options: CreateGeminiMcpGatewayOptions) => Promise<GeminiMcpGateway>;

export interface GeminiExecutionRuntimeOptions {
  createClient(handlers: GeminiAcpClientHandlers): GeminiAcpClient;
  createToolGateway?: CreateToolGateway;
}

class GeminiExecutionRuntime implements CodexExecutionRuntime {
  private readonly createClient: GeminiExecutionRuntimeOptions["createClient"];
  private readonly createToolGateway: CreateToolGateway;
  private readonly conversations = new Set<GeminiConversation>();
  private disposed = false;

  constructor(options: GeminiExecutionRuntimeOptions) {
    this.createClient = options.createClient;
    this.createToolGateway = options.createToolGateway ?? createGeminiMcpGateway;
  }

  createConversation(config: CodexConversationConfig): CodexConversationHandle {
    if (this.disposed) throw new Error("Gemini runtime is disposed");
    const conversation = new GeminiConversation(this, config);
    this.conversations.add(conversation);
    return conversation;
  }

  makeClient(handlers: GeminiAcpClientHandlers): GeminiAcpClient {
    return this.createClient(handlers);
  }

  makeGateway(options: CreateGeminiMcpGatewayOptions): Promise<GeminiMcpGateway> {
    return this.createToolGateway(options);
  }

  release(conversation: GeminiConversation): void {
    this.conversations.delete(conversation);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const conversation of [...this.conversations]) conversation.dispose();
  }
}

class GeminiConversation implements CodexConversationHandle {
  readonly id: string;
  private readonly runtime: GeminiExecutionRuntime;
  private readonly config: CodexConversationConfig;
  private client: GeminiAcpClient | undefined;
  private gateway: GeminiMcpGateway | undefined;
  private sessionId: string | undefined;
  private active: ActiveRound | undefined;
  private restartBeforeNextTurn = false;
  private readonly queuedGuidance: string[] = [];
  private _state: CodexConversationState = "idle";

  constructor(runtime: GeminiExecutionRuntime, config: CodexConversationConfig) {
    this.runtime = runtime;
    this.config = { ...config };
    this.id = config.id ?? randomUUID();
    this.sessionId = config.resumeThreadId;
  }

  get state(): CodexConversationState {
    return this._state;
  }

  send(prompt: string): AsyncIterable<LeemoEvent> {
    if (this._state === "disposed") throw new Error("cannot send on a disposed conversation");
    if (this._state === "running") throw new Error("cannot send while a turn is already running");
    const round: ActiveRound = { queue: new EventQueue(), finalText: "", tools: new Map() };
    const guidance = this.queuedGuidance.splice(0);
    const effectivePrompt = guidance.length === 0
      ? prompt
      : `[上一轮执行中追加的引导]\n${guidance.join("\n")}\n\n[本轮消息]\n${prompt}`;
    this.active = round;
    this._state = "running";
    void this.startRound(round, effectivePrompt);
    return round.queue;
  }

  async interrupt(): Promise<boolean> {
    if (!this.active || !this.client || !this.sessionId) return true;
    try {
      await this.client.cancel(this.sessionId);
      return true;
    } catch {
      return false;
    }
  }

  async guide(prompt: string): Promise<"queued"> {
    const message = prompt.trim();
    if (!this.active || this._state !== "running") throw new Error("当前没有正在执行的任务。");
    if (!message) throw new Error("引导内容不能为空。");
    // ACP has no in-flight prompt steering primitive. Keep the promise honest:
    // retain the user's correction locally and inject it into the next prompt.
    this.queuedGuidance.push(message);
    return "queued";
  }

  setModel(modelId: string): void {
    this.config.modelId = modelId;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.config.permissionMode = mode;
  }

  setDeveloperInstructions(instructions: string): void {
    if (this.config.developerInstructions === instructions) return;
    this.config.developerInstructions = instructions;
    this.restartBeforeNextTurn = true;
  }

  setNetworkCapabilities(capabilities: { webSearchEnabled: boolean; webFetchEnabled: boolean }): void {
    if (
      this.config.webSearchEnabled === capabilities.webSearchEnabled
      && this.config.webFetchEnabled === capabilities.webFetchEnabled
    ) return;
    this.config.webSearchEnabled = capabilities.webSearchEnabled;
    this.config.webFetchEnabled = capabilities.webFetchEnabled;
    this.restartBeforeNextTurn = true;
  }

  dispose(): void {
    if (this._state === "disposed") return;
    if (this.active) void this.interrupt();
    this._state = "disposed";
    this.active?.queue.close();
    this.active = undefined;
    this.disposeProcess();
    void this.config.dynamicTools?.dispose();
    this.runtime.release(this);
  }

  private async startRound(round: ActiveRound, prompt: string): Promise<void> {
    const startedAt = Date.now();
    try {
      const sessionId = await this.ensureSession();
      if (this.active !== round) return;
      round.queue.push({ type: "conversation.started", sessionId });
      await this.client!.setSessionMode(sessionId, this.modeId());
      await this.client!.setSessionModel(sessionId, this.config.modelId);
      const response = await this.client!.prompt({
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      if (this.active !== round) return;
      if (round.finalText) round.queue.push({ type: "text.final", text: round.finalText });
      if (response.usage) {
        const usage: UsageRecord = {
          providerId: this.config.providerId,
          modelId: this.config.modelId,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          cacheReadTokens: response.usage.cachedReadTokens ?? 0,
          cacheCreationTokens: response.usage.cachedWriteTokens ?? 0,
          durationMs: Date.now() - startedAt,
          costSource: "unpriced",
          tokensEstimated: false,
        };
        round.queue.push({ type: "usage.final", usage });
      }
      const isError = response.stopReason === "refusal";
      if (isError) {
        round.queue.push({ type: "error", message: "模型没有完成这项任务，可以换个说法或模型后重试。" });
      }
      round.queue.push({
        type: "run.finished",
        subtype: response.stopReason === "cancelled" ? "interrupted" : isError ? "error" : "completed",
        isError,
        finalText: round.finalText,
        pathAudit: auditClaimedPaths(round.finalText, this.config.cwd),
        sessionId,
      });
      this.finish(round);
    } catch {
      if (this.active !== round || this._state === "disposed") return;
      round.queue.push({
        type: "error",
        message: "Gemini 订阅暂时无法开始任务，请检查本机登录状态、网络或客户端版本后重试。",
      });
      round.queue.push({
        type: "run.finished",
        subtype: "error",
        isError: true,
        finalText: round.finalText,
        pathAudit: { claimed: [] },
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      });
      this.finish(round);
    }
  }

  private finish(round: ActiveRound): void {
    round.queue.close();
    if (this.active === round) this.active = undefined;
    if (this._state !== "disposed") this._state = "idle";
  }

  private async ensureSession(): Promise<string> {
    if (this.restartBeforeNextTurn) {
      this.disposeProcess();
      this.restartBeforeNextTurn = false;
    }
    if (this.client && this.sessionId) return this.sessionId;

    if (this.config.dynamicTools) {
      this.gateway = await this.runtime.makeGateway({
        registry: this.config.dynamicTools,
        instructions: this.config.developerInstructions,
        conversationId: this.id,
      });
    }
    const mcpServers: McpServer[] = this.gateway ? [this.gateway.mcpServer] : [];
    const client = this.runtime.makeClient({
      onSessionUpdate: (params) => this.receive(params),
      onPermissionRequest: (params) => this.approve(params),
    });
    this.client = client;
    await client.start({
      cwd: this.config.cwd,
      deniedTools: this.deniedTools(),
      // Passing an allow-list also prevents user-global Gemini MCPs from
      // entering Leemo behind the connector and permission settings.
      allowedMcpServerNames: ["leemo"],
    });

    if (this.sessionId) {
      await client.loadSession({ sessionId: this.sessionId, cwd: this.config.cwd, mcpServers });
    } else {
      const created = await client.newSession({ cwd: this.config.cwd, mcpServers });
      this.sessionId = created.sessionId;
    }
    return this.sessionId!;
  }

  private deniedTools(): string[] {
    return [
      ...(this.config.webSearchEnabled === true ? [] : ["google_web_search"]),
      ...(this.config.webFetchEnabled === true ? [] : ["web_fetch"]),
    ];
  }

  private modeId(): string {
    if (this.config.permissionMode === "bypassPermissions") return "yolo";
    if (this.config.permissionMode === "plan") return "plan";
    return "default";
  }

  private async approve(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const name = request.toolCall.name ?? request.toolCall.title ?? "Tool";
    if (name.startsWith("leemo_") || name.startsWith("mcp_leemo_")) {
      return this.select(request, true, false);
    }
    if (!this.config.approve) return this.select(request, false, false);
    const mapped = approvalRequest(request);
    try {
      const decision = await this.config.approve(mapped);
      if (decision === "cancel") return { outcome: { outcome: "cancelled" } };
      return this.select(
        request,
        decision === "accept" || decision === "acceptForSession",
        decision === "acceptForSession",
      );
    } catch {
      return this.select(request, false, false);
    }
  }

  private select(
    request: RequestPermissionRequest,
    allow: boolean,
    persistent: boolean,
  ): RequestPermissionResponse {
    const preferred = allow
      ? persistent ? ["allow_always", "allow_once"] : ["allow_once", "allow_always"]
      : ["reject_once", "reject_always"];
    const option = preferred.flatMap((kind) => request.options.filter((item) => item.kind === kind))[0];
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  private receive(notification: SessionNotification): void {
    const round = this.active;
    if (!round || notification.sessionId !== this.sessionId) return;
    const update = notification.update;
    if (update.sessionUpdate === "agent_thought_chunk" && update.content.type === "text") {
      round.queue.push({ type: "thinking.delta", text: update.content.text });
      return;
    }
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      round.finalText += update.content.text;
      round.queue.push({ type: "text.delta", text: update.content.text });
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      const name = update.name ?? update.title ?? "Tool";
      round.tools.set(update.toolCallId, { name, input: update.rawInput ?? {} });
      round.queue.push({
        type: "tool.started",
        toolUseId: update.toolCallId,
        name,
        input: update.rawInput ?? {},
        subagent: update.kind === "think" && /agent/i.test(name),
      });
      return;
    }
    if (update.sessionUpdate === "tool_call_update") {
      const known = round.tools.get(update.toolCallId);
      if (!known && (update.name || update.title)) {
        const name = update.name ?? update.title ?? "Tool";
        round.tools.set(update.toolCallId, { name, input: update.rawInput ?? {} });
        round.queue.push({
          type: "tool.started",
          toolUseId: update.toolCallId,
          name,
          input: update.rawInput ?? {},
          subagent: false,
        });
      }
      if (update.status === "completed" || update.status === "failed") {
        round.queue.push({
          type: "tool.finished",
          toolUseId: update.toolCallId,
          isError: update.status === "failed",
          contentSummary: summarize(update.rawOutput ?? update.content ?? update.title ?? ""),
        });
      }
    }
  }

  private disposeProcess(): void {
    this.client?.dispose();
    this.client = undefined;
    const gateway = this.gateway;
    this.gateway = undefined;
    if (gateway) void gateway.dispose();
  }
}

function approvalRequest(request: RequestPermissionRequest): CodexApprovalRequest {
  const kind = request.toolCall.kind;
  const toolName = kind === "execute"
    ? "Bash"
    : kind === "edit" || kind === "delete" || kind === "move"
      ? "Edit"
      : kind === "read"
        ? "Read"
        : kind === "search"
          ? "WebSearch"
          : kind === "fetch"
            ? "WebFetch"
            : request.toolCall.name ?? "Tool";
  return {
    kind: kind === "execute" ? "command" : kind === "edit" || kind === "delete" || kind === "move"
      ? "file-change"
      : "tool",
    toolUseId: request.toolCall.toolCallId,
    toolName,
    input: asRecord(request.toolCall.rawInput),
    reason: request.toolCall.title ?? undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function summarize(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 800);
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch {
    return "工具已完成。";
  }
}

export function createGeminiExecutionRuntime(
  options: GeminiExecutionRuntimeOptions,
): CodexExecutionRuntime {
  return new GeminiExecutionRuntime(options);
}
