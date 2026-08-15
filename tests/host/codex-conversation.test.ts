import { describe, expect, it, vi } from "vitest";
import {
  createCodexExecutionRuntime,
  type CodexAppServerTransport,
  type CodexApprovalRequest,
} from "../../src/host/codex-conversation";
import type { LeemoEvent } from "../../src/bridge/events";
import type { CodexDynamicToolRegistry } from "../../src/host/codex-dynamic-tools";

interface SeenRequest {
  method: string;
  params: unknown;
}

class FakeTransport implements CodexAppServerTransport {
  readonly requests: SeenRequest[] = [];
  private readonly notifications = new Map<string, Set<(params: unknown) => void>>();
  private readonly serverRequests = new Map<string, (params: unknown) => Promise<unknown> | unknown>();

  constructor(
    private readonly answer: (method: string, params: unknown) => unknown | Promise<unknown>,
  ) {}

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    this.requests.push({ method, params });
    return await this.answer(method, params) as TResult;
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.notifications.get(method) ?? new Set();
    handlers.add(handler);
    this.notifications.set(method, handlers);
    return () => handlers.delete(handler);
  }

  onServerRequest(
    method: string,
    handler: (params: unknown) => Promise<unknown> | unknown,
  ): () => void {
    this.serverRequests.set(method, handler);
    return () => {
      if (this.serverRequests.get(method) === handler) this.serverRequests.delete(method);
    };
  }

  emit(method: string, params: unknown): void {
    for (const handler of this.notifications.get(method) ?? []) handler(params);
  }

  async requestFromServer(method: string, params: unknown): Promise<unknown> {
    const handler = this.serverRequests.get(method);
    if (!handler) throw new Error(`no handler for ${method}`);
    return handler(params);
  }
}

async function collect(stream: AsyncIterable<LeemoEvent>): Promise<LeemoEvent[]> {
  const events: LeemoEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const completedTurn = (id: string, status: "completed" | "interrupted" | "failed" = "completed") => ({
  id,
  items: [],
  itemsView: { type: "full" },
  status,
  error: status === "failed"
    ? { message: "upstream included C:\\private\\secret", codexErrorInfo: null, additionalDetails: null }
    : null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 850,
});

describe("ChatGPT subscription conversation runtime", () => {
  it("uses app-server turn/steer for guidance during the active turn", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-steer" } };
      if (method === "turn/start") return { turn: { id: "turn-steer" } };
      if (method === "turn/steer") return {};
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });

    void collect(conversation.send("先整理资料"));
    await vi.waitFor(() => expect(transport.requests.some(({ method }) => method === "turn/start")).toBe(true));
    await expect(conversation.guide("补充：优先处理第三章")).resolves.toBe("applied");
    expect(transport.requests.find(({ method }) => method === "turn/steer")?.params).toEqual({
      threadId: "thread-steer",
      expectedTurnId: "turn-steer",
      input: [{ type: "text", text: "补充：优先处理第三章", text_elements: [] }],
    });
    conversation.dispose();
    runtime.dispose();
  });

  it("registers Leemo tools, routes calls, and keeps user-facing tool names stable", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-tools" } };
      if (method === "turn/start") return { turn: { id: "turn-tools" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const call = vi.fn(async () => ({
      success: true,
      contentItems: [{ type: "inputText" as const, text: "搜索完成" }],
    }));
    const dispose = vi.fn(async () => {});
    const registry: CodexDynamicToolRegistry = {
      specs: [{
        type: "namespace",
        name: "leemo_search",
        description: "Leemo Search",
        tools: [{
          type: "function",
          name: "web_search",
          description: "Search the web.",
          inputSchema: { type: "object" },
        }],
      }],
      unavailableServers: [],
      canonicalName: () => "mcp__leemo-search__web_search",
      call,
      dispose,
    };
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
      dynamicTools: registry,
    });

    const collecting = collect(conversation.send("查一下"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));
    expect(transport.requests.find((request) => request.method === "thread/start")?.params)
      .toMatchObject({ dynamicTools: registry.specs });

    const toolResponse = await transport.requestFromServer("item/tool/call", {
      threadId: "thread-tools",
      turnId: "turn-tools",
      callId: "call-search",
      namespace: "leemo_search",
      tool: "web_search",
      arguments: { query: "today" },
    });
    expect(toolResponse).toEqual({
      success: true,
      contentItems: [{ type: "inputText", text: "搜索完成" }],
    });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ callId: "call-search" }));

    transport.emit("item/started", {
      threadId: "thread-tools", turnId: "turn-tools", startedAtMs: 1,
      item: {
        type: "dynamicToolCall", id: "call-search", namespace: "leemo_search",
        tool: "web_search", arguments: { query: "today" }, status: "inProgress",
      },
    });
    transport.emit("item/completed", {
      threadId: "thread-tools", turnId: "turn-tools", completedAtMs: 2,
      item: {
        type: "dynamicToolCall", id: "call-search", namespace: "leemo_search",
        tool: "web_search", arguments: { query: "today" }, status: "completed",
        success: true, contentItems: [{ type: "inputText", text: "搜索完成" }],
      },
    });
    transport.emit("turn/completed", {
      threadId: "thread-tools", turn: completedTurn("turn-tools"),
    });

    const events = await collecting;
    expect(events).toContainEqual({
      type: "tool.started",
      toolUseId: "call-search",
      name: "mcp__leemo-search__web_search",
      input: { query: "today" },
      subagent: false,
    });
    conversation.dispose();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    runtime.dispose();
  });

  it("maps a real app-server turn into Leemo text, thinking, tool, usage, and terminal events", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-new" } };
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      id: "conversation-1",
      cwd: "C:\\Users\\Rengar\\Leemo\\高等数学",
      workspaceRoot: "C:\\Users\\Rengar\\Leemo",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      developerInstructions: "你是 momo。",
      permissionMode: "acceptEdits",
      webSearchEnabled: true,
      webFetchEnabled: true,
    });

    const collecting = collect(conversation.send("帮我整理这份笔记"));
    await vi.waitFor(() => {
      expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true);
    });

    const threadStart = transport.requests.find((request) => request.method === "thread/start");
    expect(threadStart?.params).toMatchObject({
      model: "gpt-5.6-sol",
      cwd: "C:\\Users\\Rengar\\Leemo\\高等数学",
      runtimeWorkspaceRoots: ["C:\\Users\\Rengar\\Leemo"],
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      developerInstructions: "你是 momo。",
      config: { web_search: "live", tools: { web_search: true } },
    });
    expect(transport.requests.find((request) => request.method === "turn/start")?.params).toEqual({
      threadId: "thread-new",
      input: [{ type: "text", text: "帮我整理这份笔记", text_elements: [] }],
      model: "gpt-5.6-sol",
      cwd: "C:\\Users\\Rengar\\Leemo\\高等数学",
      approvalPolicy: "on-request",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: ["C:\\Users\\Rengar\\Leemo"],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    });

    transport.emit("item/reasoning/summaryTextDelta", {
      threadId: "thread-new", turnId: "turn-1", itemId: "reason-1", delta: "先梳理结构", summaryIndex: 0,
    });
    transport.emit("item/reasoning/textDelta", {
      threadId: "thread-new", turnId: "turn-1", itemId: "reason-1", delta: "这里是原始推理，不应默认展示",
    });
    transport.emit("item/agentMessage/delta", {
      threadId: "thread-new", turnId: "turn-1", itemId: "message-1", delta: "正在整理",
    });
    transport.emit("item/started", {
      threadId: "thread-new", turnId: "turn-1", startedAtMs: 1,
      item: {
        type: "commandExecution", id: "command-1", command: "dir", cwd: "C:\\Users\\Rengar\\Leemo",
        status: "inProgress", aggregatedOutput: null, exitCode: null, durationMs: null,
      },
    });
    transport.emit("item/completed", {
      threadId: "thread-new", turnId: "turn-1", completedAtMs: 2,
      item: {
        type: "commandExecution", id: "command-1", command: "dir", cwd: "C:\\Users\\Rengar\\Leemo",
        status: "completed", aggregatedOutput: "3 files", exitCode: 0, durationMs: 15,
      },
    });
    transport.emit("item/completed", {
      threadId: "thread-new", turnId: "turn-1", completedAtMs: 3,
      item: { type: "agentMessage", id: "message-1", text: "整理完成", phase: null, memoryCitation: null },
    });
    transport.emit("thread/tokenUsage/updated", {
      threadId: "thread-new",
      turnId: "turn-1",
      tokenUsage: {
        total: { totalTokens: 30, inputTokens: 20, cachedInputTokens: 4, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 3 },
        last: { totalTokens: 30, inputTokens: 20, cachedInputTokens: 4, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 3 },
        modelContextWindow: 200_000,
      },
    });
    transport.emit("turn/completed", {
      threadId: "thread-new",
      turn: completedTurn("turn-1"),
    });

    const events = await collecting;
    expect(events.map((event) => event.type)).toEqual([
      "conversation.started",
      "thinking.delta",
      "text.delta",
      "tool.started",
      "tool.finished",
      "text.final",
      "usage.final",
      "run.finished",
    ]);
    expect(events.filter((event) => event.type === "thinking.delta")).toEqual([
      { type: "thinking.delta", text: "先梳理结构" },
    ]);
    expect(events).toContainEqual({
      type: "tool.started",
      toolUseId: "command-1",
      name: "Bash",
      input: { command: "dir", cwd: "C:\\Users\\Rengar\\Leemo" },
      subagent: false,
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "usage.final",
      usage: expect.objectContaining({
        providerId: "chatgpt-subscription",
        modelId: "gpt-5.6-sol",
        inputTokens: 20,
        outputTokens: 10,
        cacheReadTokens: 4,
        costSource: "unpriced",
      }),
    }));
    expect(events.at(-1)).toMatchObject({
      type: "run.finished",
      subtype: "completed",
      isError: false,
      finalText: "整理完成",
      sessionId: "thread-new",
    });
    runtime.dispose();
  });

  it("resumes the persisted app-server thread after Leemo restarts", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/resume") return { thread: { id: "thread-saved" } };
      if (method === "turn/start") return { turn: { id: "turn-resumed" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      id: "conversation-saved",
      resumeThreadId: "thread-saved",
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });

    const collecting = collect(conversation.send("继续"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));
    transport.emit("item/completed", {
      threadId: "thread-saved", turnId: "turn-resumed", completedAtMs: 2,
      item: { type: "agentMessage", id: "message-2", text: "接上了", phase: null, memoryCitation: null },
    });
    transport.emit("turn/completed", {
      threadId: "thread-saved", turn: completedTurn("turn-resumed"),
    });

    const events = await collecting;
    expect(transport.requests.map((request) => request.method)).toEqual(["thread/resume", "turn/start"]);
    expect(events.at(-1)).toMatchObject({ type: "run.finished", sessionId: "thread-saved" });
    runtime.dispose();
  });

  it("routes command approvals to Leemo and keeps the decision scoped to the matching thread", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-approval" } };
      if (method === "turn/start") return { turn: { id: "turn-approval" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const approve = vi.fn(async (_request: CodexApprovalRequest) => "acceptForSession" as const);
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "acceptEdits",
      approve,
    });
    const collecting = collect(conversation.send("运行检查"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));

    const response = await transport.requestFromServer("item/commandExecution/requestApproval", {
      threadId: "thread-approval",
      turnId: "turn-approval",
      itemId: "command-2",
      command: "npm test",
      cwd: "C:\\work",
      reason: "需要运行测试",
    });

    expect(response).toEqual({ decision: "acceptForSession" });
    expect(approve).toHaveBeenCalledWith({
      kind: "command",
      toolUseId: "command-2",
      toolName: "Bash",
      input: { command: "npm test", cwd: "C:\\work" },
      reason: "需要运行测试",
    });
    transport.emit("turn/completed", {
      threadId: "thread-approval", turn: completedTurn("turn-approval"),
    });
    await collecting;
    runtime.dispose();
  });

  it("interrupts the active app-server turn and emits one trustworthy terminal event", async () => {
    const transport = new FakeTransport((method, params) => {
      if (method === "thread/start") return { thread: { id: "thread-stop" } };
      if (method === "turn/start") return { turn: { id: "turn-stop" } };
      if (method === "turn/interrupt") {
        queueMicrotask(() => transport.emit("turn/completed", {
          threadId: "thread-stop", turn: completedTurn("turn-stop", "interrupted"),
        }));
        return {};
      }
      throw new Error(`unexpected request: ${method} ${JSON.stringify(params)}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });
    const collecting = collect(conversation.send("执行长任务"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));

    await expect(conversation.interrupt()).resolves.toBe(true);
    const events = await collecting;

    expect(transport.requests.find((request) => request.method === "turn/interrupt")?.params).toEqual({
      threadId: "thread-stop",
      turnId: "turn-stop",
    });
    expect(events.filter((event) => event.type === "run.finished")).toEqual([
      expect.objectContaining({ type: "run.finished", subtype: "interrupted", isError: false }),
    ]);
    runtime.dispose();
  });

  it("turns upstream failures into a safe visible error without leaking private paths", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-fail" } };
      if (method === "turn/start") return { turn: { id: "turn-fail" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });
    const collecting = collect(conversation.send("失败任务"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));
    transport.emit("error", {
      threadId: "thread-fail",
      turnId: "turn-fail",
      willRetry: false,
      message: "upstream included C:\\private\\secret",
    });
    transport.emit("turn/completed", {
      threadId: "thread-fail", turn: completedTurn("turn-fail", "failed"),
    });

    const events = await collecting;
    expect(events.filter((event) => event.type === "error")).toEqual([{
      type: "error",
      message: "任务遇到了问题，Leemo 正在等待本轮结束状态。",
    }]);
    expect(events.at(-1)).toMatchObject({ type: "run.finished", subtype: "error", isError: true });
    expect(JSON.stringify(events)).not.toMatch(/private|secret/);
    runtime.dispose();
  });

  it("reports app-server native reconnect progress and continues the same turn", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-retry" } };
      if (method === "turn/start") return { turn: { id: "turn-retry" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });
    const collecting = collect(conversation.send("继续同一轮"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));

    transport.emit("item/agentMessage/delta", {
      threadId: "thread-retry", turnId: "turn-retry", delta: "前半段",
    });
    transport.emit("error", {
      threadId: "thread-retry",
      turnId: "turn-retry",
      willRetry: true,
      message: "transport connection closed",
    });
    transport.emit("error", {
      threadId: "thread-retry",
      turnId: "turn-retry",
      willRetry: true,
      message: "transport connection closed again",
    });
    transport.emit("item/agentMessage/delta", {
      threadId: "thread-retry", turnId: "turn-retry", delta: "后半段",
    });
    transport.emit("turn/completed", {
      threadId: "thread-retry", turn: completedTurn("turn-retry", "completed"),
    });

    const events = await collecting;
    expect(events.filter((event) => event.type === "stream.retry")).toEqual([
      {
        type: "stream.retry",
        attempt: 1,
        maxAttempts: 5,
        summary: "正在重新连接 1/5",
        detail: "transport connection closed",
      },
      {
        type: "stream.retry",
        attempt: 2,
        maxAttempts: 5,
        summary: "正在重新连接 2/5",
        detail: "transport connection closed again",
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "run.finished", isError: false, finalText: "前半段后半段",
    });
    expect(transport.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    runtime.dispose();
  });

  it("keeps partial output after five native retries are exhausted without resending the turn", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-exhausted" } };
      if (method === "turn/start") return { turn: { id: "turn-exhausted" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });
    const collecting = collect(conversation.send("不要重复执行"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));
    transport.emit("item/agentMessage/delta", {
      threadId: "thread-exhausted", turnId: "turn-exhausted", delta: "已经收到的内容",
    });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      transport.emit("error", {
        threadId: "thread-exhausted",
        turnId: "turn-exhausted",
        willRetry: true,
        attempt,
        maxRetries: 5,
        message: `socket closed (${attempt})`,
      });
    }
    transport.emit("error", {
      threadId: "thread-exhausted",
      turnId: "turn-exhausted",
      willRetry: false,
      message: "retry budget exhausted",
    });
    transport.emit("turn/completed", {
      threadId: "thread-exhausted", turn: completedTurn("turn-exhausted", "failed"),
    });

    const events = await collecting;
    const retries = events.filter((event) => event.type === "stream.retry");
    expect(retries).toHaveLength(5);
    expect(retries.at(-1)).toMatchObject({ attempt: 5, maxAttempts: 5, detail: "socket closed (5)" });
    expect(events.at(-1)).toMatchObject({
      type: "run.finished", isError: true, finalText: "已经收到的内容",
    });
    expect(transport.requests.filter((request) => request.method === "turn/start")).toHaveLength(1);
    runtime.dispose();
  });

  it("interrupts an active turn before disposing the local conversation", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-dispose" } };
      if (method === "turn/start") return { turn: { id: "turn-dispose" } };
      if (method === "turn/interrupt") return {};
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });
    void collect(conversation.send("执行长任务"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));

    conversation.dispose();

    await vi.waitFor(() => {
      expect(transport.requests.find((request) => request.method === "turn/interrupt")?.params).toEqual({
        threadId: "thread-dispose",
        turnId: "turn-dispose",
      });
    });
    runtime.dispose();
  });

  it("finishes cleanly when the upstream turn cannot start", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-start-fail" } };
      if (method === "turn/start") throw new Error("private startup failure");
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "default",
    });

    const events = await collect(conversation.send("开始失败"));

    expect(events.filter((event) => event.type === "error")).toEqual([{
      type: "error",
      message: "ChatGPT 订阅暂时无法开始任务，请检查登录状态或网络后重试。",
    }]);
    expect(events.at(-1)).toMatchObject({ type: "run.finished", subtype: "error", isError: true });
    expect(conversation.state).toBe("idle");
    runtime.dispose();
  });

  it("structurally removes web search and network access when both Leemo network switches are off", async () => {
    const transport = new FakeTransport((method) => {
      if (method === "thread/start") return { thread: { id: "thread-offline" } };
      if (method === "turn/start") return { turn: { id: "turn-offline" } };
      throw new Error(`unexpected request: ${method}`);
    });
    const runtime = createCodexExecutionRuntime({ transport });
    const conversation = runtime.createConversation({
      cwd: "C:\\work",
      workspaceRoot: "C:\\work",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "acceptEdits",
      webSearchEnabled: false,
      webFetchEnabled: false,
    });
    const collecting = collect(conversation.send("离线整理"));
    await vi.waitFor(() => expect(transport.requests.some((request) => request.method === "turn/start")).toBe(true));

    expect(transport.requests.find((request) => request.method === "thread/start")?.params).toMatchObject({
      config: { web_search: "disabled", tools: { web_search: false } },
    });
    expect(transport.requests.find((request) => request.method === "turn/start")?.params).toMatchObject({
      sandboxPolicy: expect.objectContaining({ networkAccess: false }),
    });
    transport.emit("turn/completed", {
      threadId: "thread-offline", turn: completedTurn("turn-offline"),
    });
    await collecting;
    runtime.dispose();
  });
});
