import { describe, expect, it, vi } from "vitest";
import { createBridgeHost, type HostDeps } from "../../src/host/bridge-host";
import type { BridgeEventMap } from "../../src/bridge/contract";
import type { CatalogEntry } from "../../src/host/provider-catalog";
import type {
  CodexConversationConfig,
  CodexConversationHandle,
  CodexExecutionRuntime,
} from "../../src/host/codex-conversation";
import type { LeemoEvent } from "../../src/bridge/events";

type PushCall = { channel: keyof BridgeEventMap; payload: BridgeEventMap[keyof BridgeEventMap] };

function subscriptionCatalog(): CatalogEntry[] {
  return [{
    executionEngine: "openai-app-server",
    provider: {
      id: "chatgpt-subscription",
      name: "ChatGPT 订阅",
      category: "official",
      apiFormat: "openai-responses",
      baseUrl: "",
      apiKey: "",
      models: ["gpt-5.6-sol", "gpt-5.6-terra"],
      modelCapabilities: {},
      envTemplate: {},
    },
    spec: {
      id: "chatgpt-subscription",
      name: "ChatGPT 订阅",
      kind: "chatgpt-subscription",
      category: "official",
      apiFormat: "openai-responses",
      authMode: "oauth-subscription",
      baseUrl: "",
      models: ["gpt-5.6-sol", "gpt-5.6-terra"],
      configured: true,
      capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true },
    },
  }];
}

function geminiSubscriptionCatalog(): CatalogEntry[] {
  return [{
    executionEngine: "gemini-acp",
    provider: {
      id: "gemini-subscription",
      name: "Gemini 订阅",
      category: "official",
      apiFormat: "openai",
      baseUrl: "",
      apiKey: "",
      models: ["auto", "gemini-2.5-pro"],
      modelCapabilities: {},
      envTemplate: {},
    },
    spec: {
      id: "gemini-subscription",
      name: "Gemini 订阅",
      kind: "gemini-subscription",
      category: "official",
      apiFormat: "openai",
      authMode: "oauth-subscription",
      baseUrl: "",
      models: ["auto", "gemini-2.5-pro"],
      configured: true,
      capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true },
    },
  }];
}

function completedStream(sessionId = "thread-live"): AsyncIterable<LeemoEvent> {
  return (async function* () {
    yield { type: "conversation.started", sessionId };
    yield { type: "text.delta", text: "正在整理" };
    yield { type: "text.final", text: "整理完成" };
    yield {
      type: "run.finished",
      subtype: "completed",
      isError: false,
      finalText: "整理完成",
      sessionId,
      pathAudit: { claimed: [] },
    };
  })();
}

class FakeCodexHandle implements CodexConversationHandle {
  readonly id: string;
  state = "idle" as const;
  readonly prompts: string[] = [];
  readonly models: string[] = [];
  readonly permissions: string[] = [];
  readonly instructions: string[] = [];
  readonly network: Array<{ webSearchEnabled: boolean; webFetchEnabled: boolean }> = [];
  stream: () => AsyncIterable<LeemoEvent> = () => completedStream();
  interruptImpl: () => Promise<boolean> = async () => true;
  guideDelivery: "applied" | "queued" = "applied";

  constructor(id: string, private readonly onDispose?: () => void) {
    this.id = id;
  }

  send(prompt: string): AsyncIterable<LeemoEvent> {
    this.prompts.push(prompt);
    return this.stream();
  }

  async guide(_prompt: string): Promise<"applied" | "queued"> {
    return this.guideDelivery;
  }

  interrupt(): Promise<boolean> {
    return this.interruptImpl();
  }

  setModel(modelId: string): void {
    this.models.push(modelId);
  }

  setPermissionMode(mode: Parameters<CodexConversationHandle["setPermissionMode"]>[0]): void {
    this.permissions.push(mode);
  }

  setDeveloperInstructions(instructions: string): void {
    this.instructions.push(instructions);
  }

  setNetworkCapabilities(capabilities: { webSearchEnabled: boolean; webFetchEnabled: boolean }): void {
    this.network.push(capabilities);
  }

  dispose(): void {
    this.onDispose?.();
  }
}

class FakeCodexRuntime implements CodexExecutionRuntime {
  readonly configs: CodexConversationConfig[] = [];
  readonly handles: FakeCodexHandle[] = [];

  createConversation(config: CodexConversationConfig): CodexConversationHandle {
    this.configs.push(config);
    const handle = new FakeCodexHandle(
      config.id ?? "generated-cid",
      () => { void config.dynamicTools?.dispose(); },
    );
    this.handles.push(handle);
    return handle;
  }

  dispose(): void {}
}

function makeHost(runtime: FakeCodexRuntime, catalog = subscriptionCatalog()) {
  const pushed: PushCall[] = [];
  const deps: HostDeps = {
    catalog,
    dataDir: "C:\\leemo-data",
    workspaceRoot: "C:\\Leemo",
    codexRuntime: runtime,
    subscriptionAuth: {
      async getStatus() { return { state: "connected" as const, accountLabel: "已连接" }; },
      async login() { return { state: "connected" as const }; },
      async logout() { return { state: "disconnected" as const }; },
    },
    push(channel, payload) {
      pushed.push({ channel, payload: payload as BridgeEventMap[keyof BridgeEventMap] });
    },
    queryImpl: (() => {
      throw new Error("subscription conversations must not enter the Claude query path");
    }) as HostDeps["queryImpl"],
  };
  return { host: createBridgeHost(deps), pushed };
}

describe("bridge-host — ChatGPT subscription execution engine", () => {
  it("routes Gemini subscriptions only through the user-owned Gemini runtime", async () => {
    const codexRuntime = new FakeCodexRuntime();
    const geminiRuntime = new FakeCodexRuntime();
    const host = createBridgeHost({
      catalog: geminiSubscriptionCatalog(),
      dataDir: "C:\\leemo-data",
      workspaceRoot: "C:\\Leemo",
      codexRuntime,
      geminiRuntime,
      subscriptionAuth: {
        async getStatus() { return { state: "connected" as const }; },
        async login() { return { state: "connected" as const }; },
        async logout() { return { state: "disconnected" as const }; },
      },
      push() {},
      queryImpl: (() => { throw new Error("must use external Gemini runtime"); }) as HostDeps["queryImpl"],
    });

    await host.handleInvoke("bridge:createConversation", {
      providerId: "gemini-subscription",
      modelId: "auto",
      conversationId: "gemini-cid",
      permissionMode: "default",
    });
    expect(geminiRuntime.configs).toHaveLength(1);
    expect(geminiRuntime.configs[0]).toMatchObject({
      providerId: "gemini-subscription",
      modelId: "auto",
      cwd: "C:\\Leemo",
    });
    expect(codexRuntime.configs).toHaveLength(0);
    host.dispose();
  });

  it("creates, resumes, and streams through the native subscription runtime", async () => {
    const runtime = new FakeCodexRuntime();
    const { host, pushed } = makeHost(runtime);

    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      conversationId: "persisted-cid",
      resumeSessionId: "thread-before-restart",
      permissionMode: "acceptEdits",
      webSearchEnabled: true,
      webFetchEnabled: false,
      personaText: "说话直接、可靠。",
    });
    expect(created.conversationId).toBe("persisted-cid");
    expect(runtime.configs).toHaveLength(1);
    expect(runtime.configs[0]).toMatchObject({
      id: "persisted-cid",
      resumeThreadId: "thread-before-restart",
      cwd: "C:\\Leemo",
      workspaceRoot: "C:\\Leemo",
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      permissionMode: "acceptEdits",
      webSearchEnabled: true,
      webFetchEnabled: false,
    });
    expect(runtime.configs[0].developerInstructions).toContain("说话直接、可靠");

    await host.handleInvoke("bridge:send", {
      conversationId: created.conversationId,
      prompt: "整理这份资料",
    });
    await vi.waitFor(() => {
      const events = pushed
        .filter((call) => call.channel === "bridge:event")
        .map((call) => (call.payload as { event: LeemoEvent }).event);
      expect(events).toContainEqual(expect.objectContaining({
        type: "run.finished",
        finalText: "整理完成",
        sessionId: "thread-live",
      }));
    });
    expect(runtime.handles[0].prompts).toEqual(["整理这份资料"]);
    host.dispose();
  });

  it("automatically starts a follow-up turn after an engine queues active-task guidance", async () => {
    const runtime = new FakeCodexRuntime();
    const { host } = makeHost(runtime);
    await host.handleInvoke("bridge:createConversation", {
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      conversationId: "queued-guidance-cid",
      permissionMode: "default",
    });
    const handle = runtime.handles[0];
    handle.guideDelivery = "queued";

    let finishFirst!: () => void;
    const firstFinished = new Promise<void>((resolve) => { finishFirst = resolve; });
    let sendCount = 0;
    handle.stream = () => (async function* () {
      const sessionId = "queued-guidance-session";
      yield { type: "conversation.started", sessionId } as LeemoEvent;
      if (sendCount++ === 0) await firstFinished;
      yield {
        type: "run.finished",
        subtype: "completed",
        isError: false,
        finalText: "完成",
        sessionId,
        pathAudit: { claimed: [] },
      } as LeemoEvent;
    })();

    await host.handleInvoke("bridge:send", { conversationId: "queued-guidance-cid", prompt: "先整理资料" });
    await vi.waitFor(() => expect(handle.prompts).toEqual(["先整理资料"]));
    await expect(host.handleInvoke("bridge:guide", {
      conversationId: "queued-guidance-cid",
      prompt: "补充：优先处理第三章",
    })).resolves.toEqual({ delivery: "queued" });

    finishFirst();
    await vi.waitFor(() => expect(handle.prompts).toHaveLength(2));
    host.dispose();
  });

  it("reuses Leemo approval and AskUser cards instead of exposing engine-native prompts", async () => {
    const runtime = new FakeCodexRuntime();
    const { host, pushed } = makeHost(runtime);
    await host.handleInvoke("bridge:createConversation", {
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      conversationId: "cards-cid",
      permissionMode: "default",
    });
    const config = runtime.configs[0];

    const approval = config.approve!({
      kind: "command",
      toolUseId: "command-1",
      toolName: "Bash",
      input: { command: "npm test", cwd: "C:\\Leemo" },
      reason: "运行测试",
    });
    await vi.waitFor(() => {
      expect(pushed.some((call) => call.channel === "bridge:approvalRequest")).toBe(true);
    });
    const approvalId = (pushed.find((call) => call.channel === "bridge:approvalRequest")!.payload as { id: string }).id;
    await host.handleInvoke("bridge:approvalDecision", { id: approvalId, decision: "allow-once" });
    await expect(approval).resolves.toBe("accept");

    const answer = config.answerUserInput!({
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "ask-1",
      questions: [{
        id: "direction",
        header: "方向",
        question: "先做哪一个？",
        isOther: true,
        isSecret: false,
        options: [
          { label: "整理", description: "先整理资料" },
          { label: "写作", description: "先产出初稿" },
        ],
      }],
      autoResolutionMs: null,
    });
    await vi.waitFor(() => {
      expect(pushed.some((call) => call.channel === "bridge:askUser")).toBe(true);
    });
    const askPayload = pushed.find((call) => call.channel === "bridge:askUser")!.payload as {
      id: string;
      questions: Array<{ header?: string; question: string }>;
    };
    expect(askPayload.questions[0]).toMatchObject({ header: "方向", question: "先做哪一个？" });
    await host.handleInvoke("bridge:askUserAnswer", {
      id: askPayload.id,
      items: [{ selected: ["写作"], other: "先列大纲" }],
    });
    await expect(answer).resolves.toEqual({
      answers: { direction: { answers: ["写作", "先列大纲"] } },
    });
    host.dispose();
  });

  it("hands the subscription engine Leemo's MCP catalog through the same permission broker", async () => {
    const runtime = new FakeCodexRuntime();
    const { host, pushed } = makeHost(runtime);
    await host.handleInvoke("bridge:createConversation", {
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      conversationId: "tools-cid",
      permissionMode: "default",
      webSearchEnabled: false,
    });
    const registry = runtime.configs[0].dynamicTools!;
    expect(registry.specs.map((spec) => spec.name)).toEqual(expect.arrayContaining([
      "leemo_ask_user",
      "leemo_documents",
      "leemo_visualization",
      "leemo_web_search",
      "leemo_academic_search",
    ]));

    const pending = registry.call({
      threadId: "thread-tools",
      turnId: "turn-tools",
      callId: "create-doc",
      namespace: "leemo_documents",
      tool: "create_word_document",
      arguments: {
        file_path: "draft.docx",
        title: "Draft",
        sections: [{ paragraphs: ["hello"] }],
      },
    });
    await vi.waitFor(() => {
      expect(pushed.some((call) => call.channel === "bridge:approvalRequest")).toBe(true);
    });
    const approval = pushed.find((call) => call.channel === "bridge:approvalRequest")!.payload as {
      id: string;
      toolName: string;
    };
    expect(approval.toolName).toBe("mcp__leemo-documents__create_word_document");
    await host.handleInvoke("bridge:approvalDecision", { id: approval.id, decision: "deny" });
    await expect(pending).resolves.toEqual({
      success: false,
      contentItems: [{ type: "inputText", text: expect.any(String) }],
    });
    host.dispose();
  });

  it("keeps the live search switch authoritative in complete-access mode", async () => {
    const runtime = new FakeCodexRuntime();
    const { host, pushed } = makeHost(runtime);
    await host.handleInvoke("bridge:createConversation", {
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      conversationId: "search-switch-cid",
      permissionMode: "bypassPermissions",
      webSearchEnabled: false,
    });
    const registry = runtime.configs[0].dynamicTools!;

    await expect(registry.call({
      threadId: "thread-search",
      turnId: "turn-search-off",
      callId: "search-off",
      namespace: "leemo_web_search",
      tool: "web_search",
      arguments: { query: "" },
    })).resolves.toEqual({
      success: false,
      contentItems: [{ type: "inputText", text: "这项能力已在 Leemo 设置中关闭。" }],
    });
    expect(pushed.some((call) => call.channel === "bridge:approvalRequest")).toBe(false);

    await host.handleInvoke("bridge:updateContext", {
      conversationId: "search-switch-cid",
      webSearchEnabled: true,
    });
    await expect(registry.call({
      threadId: "thread-search",
      turnId: "turn-search-on",
      callId: "search-on",
      namespace: "leemo_web_search",
      tool: "web_search",
      arguments: { query: "" },
    })).resolves.toEqual({
      success: false,
      contentItems: [{ type: "inputText", text: "web_search: empty query" }],
    });
    expect(pushed.some((call) => call.channel === "bridge:approvalRequest")).toBe(false);
    host.dispose();
  });

  it("applies live settings and waits for a confirmed stop", async () => {
    const runtime = new FakeCodexRuntime();
    const { host, pushed } = makeHost(runtime);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-sol",
      conversationId: "live-cid",
      permissionMode: "default",
      webSearchEnabled: true,
      webFetchEnabled: true,
    });
    const handle = runtime.handles[0];

    await host.handleInvoke("bridge:updateContext", {
      conversationId,
      permissionMode: "bypassPermissions",
      webSearchEnabled: false,
      webFetchEnabled: false,
      personaText: "更简洁一些。",
    });
    expect(handle.permissions).toEqual(["bypassPermissions"]);
    expect(handle.network).toEqual([{ webSearchEnabled: false, webFetchEnabled: false }]);
    expect(handle.instructions.at(-1)).toContain("更简洁一些");

    await host.handleInvoke("bridge:setModel", {
      conversationId,
      providerId: "chatgpt-subscription",
      modelId: "gpt-5.6-terra",
    });
    expect(handle.models).toEqual(["gpt-5.6-terra"]);

    handle.stream = () => (async function* () {
      yield { type: "conversation.started", sessionId: "thread-stop" } as LeemoEvent;
      await new Promise(() => {});
    })();
    let confirmStop!: (stopped: boolean) => void;
    handle.interruptImpl = () => new Promise<boolean>((resolve) => { confirmStop = resolve; });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "长任务" });
    await vi.waitFor(() => expect(handle.prompts).toContain("长任务"));

    let interruptSettled = false;
    const interrupt = host.handleInvoke("bridge:interrupt", { conversationId }).then(() => {
      interruptSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(interruptSettled).toBe(false);
    expect(pushed.filter((call) =>
      call.channel === "bridge:event"
      && (call.payload as { event?: { type?: string } }).event?.type === "run.finished"
    )).toHaveLength(0);

    confirmStop(true);
    await interrupt;
    expect(pushed.filter((call) =>
      call.channel === "bridge:event"
      && (call.payload as { event?: { type?: string; subtype?: string } }).event?.type === "run.finished"
      && (call.payload as { event: { subtype?: string } }).event.subtype === "interrupted"
    )).toHaveLength(1);
    host.dispose();
  });
});
