import { describe, expect, it, vi } from "vitest";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type { LeemoEvent } from "../../src/bridge/events";
import {
  buildGeminiProcessEnvironment,
  createGeminiExecutionRuntime,
  type GeminiAcpClient,
  type GeminiAcpClientHandlers,
  type GeminiAcpClientStartOptions,
} from "../../src/host/gemini-acp";

describe("Gemini external process boundary", () => {
  it("uses packaged Leemo as Node only for a user-owned JavaScript CLI and strips API credentials", () => {
    const env = buildGeminiProcessEnvironment({
      command: "C:\\Program Files\\Leemo\\Leemo.exe",
      argsPrefix: ["C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js"],
    }, {
      GEMINI_API_KEY: "must-not-cross",
      GOOGLE_API_KEY: "must-not-cross",
      USERPROFILE: "C:\\Users\\me",
    });
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_API_KEY).toBeUndefined();
    expect(env.USERPROFILE).toBe("C:\\Users\\me");
  });
});

async function collect(source: AsyncIterable<LeemoEvent>): Promise<LeemoEvent[]> {
  const events: LeemoEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

class FakeGeminiClient implements GeminiAcpClient {
  readonly starts: GeminiAcpClientStartOptions[] = [];
  readonly newSessions: unknown[] = [];
  readonly loadedSessions: unknown[] = [];
  readonly prompts: unknown[] = [];
  readonly modes: string[] = [];
  readonly models: string[] = [];
  cancelled: string[] = [];
  disposed = false;

  constructor(private readonly handlers: GeminiAcpClientHandlers) {}

  async start(options: GeminiAcpClientStartOptions) {
    this.starts.push(options);
    return { authMethods: [{ id: "oauth-personal", name: "Google" }] };
  }

  async newSession(request: unknown) {
    this.newSessions.push(request);
    return { sessionId: "gemini-session-new" };
  }

  async loadSession(request: unknown) {
    this.loadedSessions.push(request);
    return {};
  }

  async prompt(request: { sessionId: string; prompt: Array<{ type: string; text?: string }> }) {
    this.prompts.push(request);
    await this.handlers.onSessionUpdate({
      sessionId: request.sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "先检查文件" },
      },
    } as SessionNotification);
    await this.handlers.onSessionUpdate({
      sessionId: request.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        name: "read_file",
        title: "读取资料",
        kind: "read",
        status: "in_progress",
        rawInput: { path: "notes.md" },
      },
    } as SessionNotification);
    await this.handlers.onSessionUpdate({
      sessionId: request.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "读取完成",
      },
    } as SessionNotification);
    await this.handlers.onSessionUpdate({
      sessionId: request.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "已经整理好。" },
      },
    } as SessionNotification);
    return {
      stopReason: "end_turn" as const,
      usage: { totalTokens: 12, inputTokens: 8, outputTokens: 4 },
    };
  }

  async setSessionMode(_sessionId: string, modeId: string) { this.modes.push(modeId); }
  async setSessionModel(_sessionId: string, modelId: string) { this.models.push(modelId); }
  async cancel(sessionId: string) { this.cancelled.push(sessionId); }
  dispose() { this.disposed = true; }

  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return this.handlers.onPermissionRequest(params);
  }
}

function makeRuntime() {
  const clients: FakeGeminiClient[] = [];
  const runtime = createGeminiExecutionRuntime({
    createClient(handlers) {
      const client = new FakeGeminiClient(handlers);
      clients.push(client);
      return client;
    },
  });
  return { runtime, clients };
}

describe("Gemini subscription ACP runtime", () => {
  it("honestly queues guidance for the next Gemini turn when ACP cannot steer", async () => {
    const { runtime, clients } = makeRuntime();
    const handle = runtime.createConversation({
      cwd: "C:\\Leemo",
      workspaceRoot: "C:\\Leemo",
      providerId: "gemini-subscription",
      modelId: "auto",
      permissionMode: "default",
    });

    const first = collect(handle.send("先整理资料"));
    await expect(handle.guide("补充：优先处理第三章")).resolves.toBe("queued");
    await first;
    await collect(handle.send("继续"));
    expect(clients[0].prompts.at(-1)).toEqual({
      sessionId: "gemini-session-new",
      prompt: [{
        type: "text",
        text: "[上一轮执行中追加的引导]\n补充：优先处理第三章\n\n[本轮消息]\n继续",
      }],
    });
    runtime.dispose();
  });

  it("creates or resumes sessions and normalizes the visible Leemo timeline", async () => {
    const { runtime, clients } = makeRuntime();
    const handle = runtime.createConversation({
      id: "conversation-1",
      resumeThreadId: "gemini-before-restart",
      cwd: "C:\\Leemo",
      workspaceRoot: "C:\\Leemo",
      providerId: "gemini-subscription",
      modelId: "auto",
      permissionMode: "acceptEdits",
      webSearchEnabled: false,
      webFetchEnabled: true,
      developerInstructions: "你是 momo，可靠地完成用户任务。",
    });

    const events = await collect(handle.send("整理 notes.md"));
    expect(clients).toHaveLength(1);
    expect(clients[0].starts[0]).toMatchObject({
      deniedTools: ["google_web_search"],
      allowedMcpServerNames: ["leemo"],
    });
    expect(clients[0].loadedSessions).toEqual([{
      sessionId: "gemini-before-restart",
      cwd: "C:\\Leemo",
      mcpServers: [],
    }]);
    expect(clients[0].modes).toEqual(["default"]);
    expect(clients[0].models).toEqual(["auto"]);
    expect(events).toEqual(expect.arrayContaining([
      { type: "conversation.started", sessionId: "gemini-before-restart" },
      { type: "thinking.delta", text: "先检查文件" },
      expect.objectContaining({ type: "tool.started", toolUseId: "tool-1", name: "read_file" }),
      expect.objectContaining({ type: "tool.finished", toolUseId: "tool-1", isError: false }),
      { type: "text.delta", text: "已经整理好。" },
      { type: "text.final", text: "已经整理好。" },
      expect.objectContaining({ type: "usage.final", usage: expect.objectContaining({ inputTokens: 8, outputTokens: 4 }) }),
      expect.objectContaining({ type: "run.finished", isError: false, sessionId: "gemini-before-restart" }),
    ]));
    runtime.dispose();
    expect(clients[0].disposed).toBe(true);
  });

  it("routes native permission requests through Leemo and auto-passes Leemo MCP's second gate", async () => {
    const { runtime, clients } = makeRuntime();
    const approve = vi.fn(async () => "accept" as const);
    runtime.createConversation({
      cwd: "C:\\Leemo",
      workspaceRoot: "C:\\Leemo",
      providerId: "gemini-subscription",
      modelId: "auto",
      permissionMode: "default",
      approve,
    }).send("hello");
    await vi.waitFor(() => expect(clients).toHaveLength(1));

    const allowed = await clients[0].requestPermission({
      sessionId: "s1",
      toolCall: {
        toolCallId: "shell-1",
        name: "run_shell_command",
        title: "运行命令",
        kind: "execute",
        rawInput: { command: "npm test" },
      },
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    });
    expect(allowed).toEqual({ outcome: { outcome: "selected", optionId: "yes" } });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({
      kind: "command",
      toolUseId: "shell-1",
      toolName: "Bash",
      input: { command: "npm test" },
    }));

    const leemoTool = await clients[0].requestPermission({
      sessionId: "s1",
      toolCall: {
        toolCallId: "mcp-1",
        name: "leemo_documents_create_word_document",
        title: "创建文档",
        kind: "other",
      },
      options: [
        { optionId: "allow-mcp", name: "Allow", kind: "allow_once" },
        { optionId: "deny-mcp", name: "Reject", kind: "reject_once" },
      ],
    });
    expect(leemoTool).toEqual({ outcome: { outcome: "selected", optionId: "allow-mcp" } });
    expect(approve).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("restarts lazily when a live network switch changes and confirms cancellation", async () => {
    const { runtime, clients } = makeRuntime();
    const handle = runtime.createConversation({
      cwd: "C:\\Leemo",
      workspaceRoot: "C:\\Leemo",
      providerId: "gemini-subscription",
      modelId: "auto",
      permissionMode: "default",
      webSearchEnabled: false,
      webFetchEnabled: false,
    });
    await collect(handle.send("first"));
    expect(clients[0].starts[0].deniedTools).toEqual(["google_web_search", "web_fetch"]);

    handle.setNetworkCapabilities({ webSearchEnabled: true, webFetchEnabled: false });
    await collect(handle.send("second"));
    expect(clients).toHaveLength(2);
    expect(clients[0].disposed).toBe(true);
    expect(clients[1].starts[0].deniedTools).toEqual(["web_fetch"]);
    expect(clients[1].loadedSessions).toEqual([{
      sessionId: "gemini-session-new",
      cwd: "C:\\Leemo",
      mcpServers: [],
    }]);

    const interrupted = await handle.interrupt();
    expect(interrupted).toBe(true);
    runtime.dispose();
  });
});
