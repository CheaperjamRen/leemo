import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createBridgeHost } from "../../src/host/bridge-host";
import type { HostDeps } from "../../src/host/bridge-host";
import type { BridgeEventMap } from "../../src/bridge/contract";
import type { CatalogEntry } from "../../src/host/provider-catalog";
import type { MemoryScope } from "../../src/host/memory-governance";
import { PROCESS_TREE_STOP_PROMISE_KEY, PROCESS_TREE_STOP_RESULT_KEY } from "../../src/bridge/pool";
import { LEEMO_MEMORY_TOOL_NAMES } from "../../src/bridge/memory-mcp";
import { LEEMO_DOCUMENT_TOOL_NAMES } from "../../src/bridge/document-mcp";
import type {
  OfficeSkillRuntime,
  OfficeSkillRuntimeSnapshot,
} from "../../src/host/office-skills";
import type {
  BundledSkillDefinition,
  BundledSkillRuntime,
  BundledSkillRuntimeSnapshot,
} from "../../src/host/bundled-skills";
import {
  SUPERPOWERS_COLLECTION_LABEL,
  SUPERPOWERS_SKILL_NAMES,
  type SuperpowersSkillDefinition,
  type SuperpowersSkillRuntime,
  type SuperpowersSkillRuntimeSnapshot,
} from "../../src/host/superpowers-skills";

function makeCatalog(): CatalogEntry[] {
  return [
    {
      executionEngine: "claude-agent-sdk",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        apiFormat: "anthropic",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKey: "test-key-secret",
        models: ["deepseek-chat"],
        modelCapabilities: { "deepseek-chat": { thinking: false, vision: false } },
        envTemplate: {},
      },
      spec: {
        id: "deepseek",
        name: "DeepSeek",
        kind: "deepseek",
        category: "cn_official",
        apiFormat: "anthropic",
        authMode: "api-key",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyUrl: "https://platform.deepseek.com/api_keys",
        models: ["deepseek-chat"],
        capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
      },
      balanceBaseUrl: "https://api.deepseek.com",
    },
  ];
}

type PushCall = { channel: keyof BridgeEventMap; payload: BridgeEventMap[keyof BridgeEventMap] };

function makeDeps(
  fakeQuery?: HostDeps["queryImpl"],
  observePush?: (call: PushCall) => void,
): { deps: HostDeps; pushed: PushCall[] } {
  const pushed: PushCall[] = [];
  const deps: HostDeps = {
    catalog: makeCatalog(),
    dataDir: "/tmp/data",
    workspaceRoot: "/tmp/workspace",
    push: (channel, payload) => {
      const call = { channel, payload: payload as BridgeEventMap[keyof BridgeEventMap] };
      observePush?.(call);
      pushed.push(call);
    },
    queryImpl: fakeQuery,
  };
  return { deps, pushed };
}

describe("bridge-host — global pending overview", () => {
  const fact = {
    id: "task:t1",
    kind: "task" as const,
    label: "完成产品故事",
    state: "open" as const,
    updatedAt: 10,
    relatedIds: [],
    evidence: ["待办仍未完成"],
  };

  it("resolves the configured model in Host, records usage, and returns no credential material", async () => {
    const { deps } = makeDeps();
    const runOneShotInference = vi.fn(async (_target: unknown, _prompt: string) => ({
      ok: true as const,
      text: JSON.stringify({
        items: [{
          anchorSourceId: "task:t1",
          sourceIds: ["task:t1"],
          title: "完成产品故事",
          progressSummary: "仍待完成",
          priority: "now",
        }],
        uncertainSourceIds: [],
      }),
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costSource: "unpriced" as const,
        tokensEstimated: false,
        durationMs: 30,
      },
    }));
    const recordStandaloneUsage = vi.fn();
    const host = createBridgeHost({ ...deps, runOneShotInference, recordStandaloneUsage });

    const response = await host.handleInvoke("bridge:generateGlobalPendingOverview", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      trigger: "manual",
      localNow: "2026-08-18T22:00:00+08:00",
      timeZone: "Asia/Shanghai",
      facts: [fact],
      overrides: [],
    });

    expect(response).toMatchObject({
      ok: true,
      snapshot: {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        items: [{ anchorSourceId: "task:t1" }],
      },
    });
    expect(runOneShotInference).toHaveBeenCalledTimes(1);
    expect(runOneShotInference.mock.calls[0]?.[0]).toMatchObject({
      kind: "direct",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      target: { apiKey: "test-key-secret" },
    });
    expect(recordStandaloneUsage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response)).not.toContain("test-key-secret");
  });

  it("fails before inference when the provider or selected model is unavailable", async () => {
    const { deps } = makeDeps();
    const runOneShotInference = vi.fn();
    const host = createBridgeHost({ ...deps, runOneShotInference });

    await expect(host.handleInvoke("bridge:generateGlobalPendingOverview", {
      providerId: "deepseek",
      modelId: "missing-model",
      trigger: "manual",
      localNow: "2026-08-18T22:00:00+08:00",
      facts: [fact],
      overrides: [],
    })).resolves.toEqual({
      ok: false,
      message: "当前选择的模型不可用，请先在模型设置中确认。",
      retryable: false,
    });
    expect(runOneShotInference).not.toHaveBeenCalled();
  });
});

describe("bridge-host — per-turn subagent control", () => {
  it("structurally removes Agent and Task for only the opted-out turn", async () => {
    const seen: Record<string, unknown>[] = [];
    const { deps, pushed } = makeDeps((params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "", is_error: false };
    })() as never);
    const host = createBridgeHost(deps);
    try {
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        webSearchEnabled: false,
      });

      await host.handleInvoke("bridge:send", {
        conversationId,
        prompt: "这轮不要召集助手",
        allowSubagents: false,
      });
      await vi.waitFor(() => {
        expect(pushed.filter((call) =>
          call.channel === "bridge:event"
          && (call.payload as { event?: { type?: string } }).event?.type === "run.finished"
        )).toHaveLength(1);
      });

      await host.handleInvoke("bridge:send", { conversationId, prompt: "下一轮恢复自动" });
      await vi.waitFor(() => expect(seen).toHaveLength(2));

      expect(seen[0].disallowedTools).toEqual(expect.arrayContaining(["WebSearch", "Agent", "Task"]));
      expect(seen[1].disallowedTools).toEqual(expect.arrayContaining(["WebSearch"]));
      expect(seen[1].disallowedTools as string[]).not.toContain("Agent");
      expect(seen[1].disallowedTools as string[]).not.toContain("Task");
    } finally {
      host.dispose();
    }
  });
});

describe("bridge-host — note references", () => {
  it("loads the newest referenced note bodies for this turn only", async () => {
    const prompts: string[] = [];
    const { deps } = makeDeps((params) => (async function* () {
      for await (const message of params.prompt as AsyncIterable<{ message: { content: string } }>) {
        prompts.push(message.message.content);
      }
      yield { type: "result", subtype: "success", result: "", is_error: false };
    })() as never);
    deps.captures = {
      getNote: vi.fn((id: string) => id === "note-current"
        ? { id, title: "项目思路", markdown: "这是刚更新的正文", revision: 2, createdAt: 1, updatedAt: 2 }
        : null),
    } as unknown as HostDeps["captures"];
    const host = createBridgeHost(deps);
    try {
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        webSearchEnabled: false,
      });
      await host.handleInvoke("bridge:send", {
        conversationId,
        prompt: "请基于便签回答",
        noteReferences: ["note-current", "note-missing"],
      });

      await vi.waitFor(() => expect(prompts).toHaveLength(1));
      expect(prompts[0]).toContain("请基于便签回答");
      expect(prompts[0]).toContain("项目思路");
      expect(prompts[0]).toContain("这是刚更新的正文");
      expect(prompts[0]).not.toContain("note-missing");
    } finally {
      host.dispose();
    }
  });
});

describe("bridge-host — persistent conversation goal", () => {
  it("adds the active goal to the real turn prompt without replacing the user's message", async () => {
    const prompts: string[] = [];
    const { deps } = makeDeps((params) => (async function* () {
      for await (const message of params.prompt as AsyncIterable<{ message: { content: string } }>) {
        prompts.push(message.message.content);
      }
      yield { type: "result", subtype: "success", result: "", is_error: false };
    })() as never);
    const host = createBridgeHost(deps);
    try {
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        webSearchEnabled: false,
      });
      await host.handleInvoke("bridge:send", {
        conversationId,
        prompt: "继续实现输入框",
        goalText: "完成主界面视觉复现",
      });

      await vi.waitFor(() => expect(prompts).toHaveLength(1));
      expect(prompts[0]).toContain("继续实现输入框");
      expect(prompts[0]).toContain("当前目标");
      expect(prompts[0]).toContain("完成主界面视觉复现");
    } finally {
      host.dispose();
    }
  });
});

describe("bridge-host — root artifact routing", () => {
  type CapturedCanUseTool = (
    name: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string; requestId: string },
  ) => Promise<unknown>;
  type CapturedPreToolUse = (
    input: {
      hook_event_name: "PreToolUse";
      tool_name: string;
      tool_input: Record<string, unknown>;
      tool_use_id: string;
    },
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
  async function assembled(permissionMode: "default" | "acceptEdits" | "bypassPermissions", notebook = false) {
    let canUseTool: CapturedCanUseTool | undefined;
    let preToolUse: CapturedPreToolUse | undefined;
    let preToolUseMatcher: string | undefined;
    let cliSettings: Record<string, unknown> | undefined;
    const { deps, pushed } = makeDeps((params) => (async function* () {
      const sdkOptions = params.options as Record<string, unknown>;
      canUseTool = sdkOptions.canUseTool as CapturedCanUseTool;
      cliSettings = sdkOptions.settings as Record<string, unknown> | undefined;
      const sdkHooks = sdkOptions.hooks as {
        PreToolUse: Array<{ matcher?: string; hooks: CapturedPreToolUse[] }>;
      };
      const hookMatcher = sdkHooks.PreToolUse[0];
      preToolUseMatcher = hookMatcher.matcher;
      preToolUse = hookMatcher.hooks[0];
      yield { type: "result", subtype: "success", result: "", is_error: false };
    })() as never);
    Object.assign(deps, {
      routeRootArtifactPath: (relativePath: string) => `默认工作区/${relativePath}`,
      toolGovernanceHookUrl: "http://127.0.0.1:43210/__leemo/hooks/tool-governance-test",
      ...(notebook
        ? { resolveNotebook: () => ({ dir: "/tmp/workspace/高等数学", title: "高等数学" }) }
        : {}),
    });
    const host = createBridgeHost(deps);
    const created = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      permissionMode,
      ...(notebook ? { notebookId: "高等数学" } : {}),
    });
    await host.handleInvoke("bridge:send", { conversationId: created.conversationId, prompt: "write" });
    await vi.waitFor(() => {
      expect(canUseTool).toEqual(expect.any(Function));
      expect(preToolUse).toEqual(expect.any(Function));
      expect(preToolUseMatcher).toBe("Write|Edit|NotebookEdit");
    });
    return {
      canUseTool: canUseTool!,
      preToolUse: preToolUse!,
      host,
      conversationId: created.conversationId,
      pushed,
      cliSettings: cliSettings!,
    };
  }

  const options = () => ({
    signal: new AbortController().signal,
    toolUseID: "write-1",
    requestId: "request-1",
  });

  const runPreToolUse = (
    hook: CapturedPreToolUse,
    toolName: string,
    toolInput: Record<string, unknown>,
  ) => hook({
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "write-1",
  }, "write-1", { signal: new AbortController().signal });

  it("installs the process-owned HTTP guard in native CLI settings", async () => {
    const { cliSettings } = await assembled("acceptEdits");
    const url = "http://127.0.0.1:43210/__leemo/hooks/tool-governance-test";

    expect(cliSettings).toMatchObject({
      allowedHttpHookUrls: [url],
      hooks: {
        PreToolUse: [{
          matcher: "Write|Edit|NotebookEdit",
          hooks: [{ type: "http", url, timeout: 5 }],
        }],
      },
    });
  });

  it("emits a real disk change receipt before the turn finishes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "leemo-file-receipt-"));
    mkdirSync(path.join(root, "默认工作区"), { recursive: true });
    try {
      const { deps, pushed } = makeDeps((params) => (async function* () {
        yield { type: "system", subtype: "init", session_id: "session-file-receipt" };
        yield {
          type: "assistant",
          session_id: "session-file-receipt",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: "write-receipt",
              name: "Write",
              input: { file_path: path.join(root, "默认工作区", "报告.md"), content: "完成" },
            }],
          },
        };
        writeFileSync(path.join(root, "默认工作区", "报告.md"), "完成", "utf8");
        yield {
          type: "user",
          session_id: "session-file-receipt",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "write-receipt", content: "ok", is_error: false }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "session-file-receipt",
          result: "写好了。",
          is_error: false,
        };
      })() as never);
      Object.assign(deps, {
        workspaceRoot: root,
        routeRootArtifactPath: (relativePath: string) => `默认工作区/${relativePath}`,
      });
      const host = createBridgeHost(deps);
      const created = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        permissionMode: "acceptEdits",
      });
      await host.handleInvoke("bridge:send", {
        conversationId: created.conversationId,
        prompt: "写报告",
      });
      await vi.waitFor(() => {
        expect(pushed.some((call) =>
          call.channel === "bridge:event"
          && (call.payload as { event?: { type?: string } }).event?.type === "run.finished")).toBe(true);
      });

      const events = pushed
        .filter((call) => call.channel === "bridge:event")
        .map((call) => (call.payload as { event: { type: string } }).event);
      expect(events).toContainEqual({
        type: "file.changed",
        path: "报告.md",
        workspacePath: "默认工作区/报告.md",
        change: "added",
      });
      expect(events.findIndex((event) => event.type === "file.changed"))
        .toBeLessThan(events.findIndex((event) => event.type === "run.finished"));
      host.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flushes observed file changes before an interrupted turn closes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "leemo-file-interrupt-"));
    const reportPath = path.join(root, "中断前.md");
    try {
      const { deps, pushed } = makeDeps((params) => (async function* () {
        yield { type: "system", subtype: "init", session_id: "session-file-interrupt" };
        yield {
          type: "assistant",
          session_id: "session-file-interrupt",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: "write-before-interrupt",
              name: "Write",
              input: { file_path: reportPath, content: "已写入" },
            }],
          },
        };
        writeFileSync(reportPath, "已写入", "utf8");
        await new Promise<void>((resolve) => {
          const signal = params.options?.abortController?.signal;
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      })() as never);
      Object.assign(deps, { workspaceRoot: root });
      const host = createBridgeHost(deps);
      const created = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        permissionMode: "acceptEdits",
      });
      await host.handleInvoke("bridge:send", {
        conversationId: created.conversationId,
        prompt: "先写一点",
      });
      await vi.waitFor(() => expect(existsSync(reportPath)).toBe(true));
      await expect(host.handleInvoke("bridge:interrupt", { conversationId: created.conversationId }))
        .resolves.toEqual({ state: "stopping" });
      await vi.waitFor(() => expect(pushed.some((call) => (
        call.channel === "bridge:event"
        && (call.payload as { event?: { type?: string; subtype?: string } }).event?.type === "run.finished"
        && (call.payload as { event?: { subtype?: string } }).event?.subtype === "interrupted"
      ))).toBe(true));

      const events = pushed
        .filter((call) => call.channel === "bridge:event")
        .map((call) => (call.payload as { event: { type: string; subtype?: string } }).event);
      const fileIndex = events.findIndex((event) => event.type === "file.changed");
      const stoppedIndex = events.findIndex((event) =>
        event.type === "run.finished" && event.subtype === "interrupted");
      expect(events[fileIndex]).toEqual({
        type: "file.changed",
        path: "中断前.md",
        workspacePath: "中断前.md",
        change: "added",
      });
      expect(fileIndex).toBeGreaterThanOrEqual(0);
      expect(fileIndex).toBeLessThan(stoppedIndex);
      host.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps a file receipt when the provider fails after writing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "leemo-file-failure-"));
    const reportPath = path.join(root, "失败前.md");
    try {
      const { deps, pushed } = makeDeps(() => (async function* () {
        yield { type: "system", subtype: "init", session_id: "session-file-failure" };
        yield {
          type: "assistant",
          session_id: "session-file-failure",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: "write-before-failure",
              name: "Write",
              input: { file_path: reportPath, content: "仍需保留" },
            }],
          },
        };
        writeFileSync(reportPath, "仍需保留", "utf8");
        throw new Error("provider disconnected");
      })() as never);
      Object.assign(deps, { workspaceRoot: root });
      const host = createBridgeHost(deps);
      const created = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        permissionMode: "acceptEdits",
      });
      await host.handleInvoke("bridge:send", {
        conversationId: created.conversationId,
        prompt: "写到一半失败",
      });
      await vi.waitFor(() => {
        expect(pushed.some((call) =>
          call.channel === "bridge:event"
          && (call.payload as { event?: { type?: string; subtype?: string } }).event?.type === "run.finished"
          && (call.payload as { event?: { type?: string; subtype?: string } }).event?.subtype === "error"))
          .toBe(true);
      });

      const events = pushed
        .filter((call) => call.channel === "bridge:event")
        .map((call) => (call.payload as { event: { type: string; subtype?: string } }).event);
      const fileIndex = events.findIndex((event) => event.type === "file.changed");
      const failedIndex = events.findIndex((event) =>
        event.type === "run.finished" && event.subtype === "error");
      expect(events[fileIndex]).toEqual({
        type: "file.changed",
        path: "失败前.md",
        workspacePath: "失败前.md",
        change: "added",
      });
      expect(fileIndex).toBeLessThan(failedIndex);
      host.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["acceptEdits", "bypassPermissions"] as const)(
    "routes root Write through the SDK execution hook in %s mode",
    async (permissionMode) => {
      const { preToolUse } = await assembled(permissionMode);

      await expect(runPreToolUse(preToolUse, "Write", {
        file_path: "报告.md",
        content: "body",
      })).resolves.toEqual({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { file_path: "默认工作区/报告.md", content: "body" },
        },
      });
    },
  );

  it.each([
    LEEMO_DOCUMENT_TOOL_NAMES.createWord,
    LEEMO_DOCUMENT_TOOL_NAMES.createPresentation,
    LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet,
  ])("routes a root document artifact through the same product rule: %s", async (toolName) => {
    const { canUseTool } = await assembled("acceptEdits");
    const decision = await canUseTool(toolName, { file_path: "报告.docx" }, options());
    expect(decision).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "默认工作区/报告.docx" },
    });
  });

  it("routes an absolute root path canonicalized by the native CLI", async () => {
    const { preToolUse } = await assembled("acceptEdits");
    const source = path.resolve("/tmp/workspace", "报告.md");
    const target = path.resolve("/tmp/workspace", "默认工作区", "报告.md");

    await expect(runPreToolUse(preToolUse, "Write", {
      file_path: source,
      content: "body",
    })).resolves.toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { file_path: target, content: "body" },
      },
    });
  });

  it("blocks ordinary file tools from governed memory before SDK auto-approval", async () => {
    const { preToolUse } = await assembled("acceptEdits");

    await expect(runPreToolUse(preToolUse, "Write", {
      file_path: ".leemo/memory/global/MEMORY.md",
      content: "绕过",
    })).resolves.toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "长期记忆由 Leemo 管理，请使用记忆工具；普通文档请写入工作区。",
      },
    });
  });

  it.each([
    [false, "C:\\Users\\R\\Desktop\\报告.md"],
    [true, "报告.md"],
  ] as const)("leaves explicit and notebook Write paths unchanged", async (notebook, filePath) => {
    const { preToolUse } = await assembled("acceptEdits", notebook);

    await expect(runPreToolUse(preToolUse, "Write", {
      file_path: filePath,
      content: "body",
    })).resolves.toEqual({ continue: true });
  });

  it.each(["acceptEdits", "bypassPermissions"] as const)(
    "returns the routed Write input even when %s auto-allows before an approval card",
    async (permissionMode) => {
      const { canUseTool } = await assembled(permissionMode);

      const decision = await canUseTool("Write", { file_path: "报告.md", content: "body" }, options());

      expect(decision).toEqual({
        behavior: "allow",
        updatedInput: { file_path: "默认工作区/报告.md", content: "body" },
      });
    },
  );

  it("returns the routed Write input after a normal allow-once decision", async () => {
    const { canUseTool, host, conversationId, pushed } = await assembled("default");
    const pending = canUseTool("Write", { file_path: "报告.md", content: "body" }, options());
    await vi.waitFor(() => {
      expect(pushed).toContainEqual(expect.objectContaining({ channel: "bridge:approvalRequest" }));
    });
    const request = pushed.find((entry) => entry.channel === "bridge:approvalRequest")!.payload as { id: string };
    await host.handleInvoke("bridge:approvalDecision", { id: request.id, decision: "allow-once" });

    await expect(pending).resolves.toEqual({
      behavior: "allow",
      updatedInput: { file_path: "默认工作区/报告.md", content: "body" },
    });
    host.dispose();
    expect(conversationId).toBeTruthy();
  });

  it.each([
    ["Write", { file_path: "C:\\Users\\R\\Desktop\\报告.md", content: "body" }],
    ["Edit", { file_path: "报告.md", old_string: "a", new_string: "b" }],
  ] as const)("does not rewrite an explicit or existing-file %s operation", async (toolName, input) => {
    const { canUseTool } = await assembled("bypassPermissions");
    await expect(canUseTool(toolName, input, options())).resolves.toEqual({ behavior: "allow" });
  });

  it("does not route a Write made inside an active notebook", async () => {
    const { canUseTool } = await assembled("bypassPermissions", true);
    await expect(
      canUseTool("Write", { file_path: "报告.md", content: "body" }, options()),
    ).resolves.toEqual({ behavior: "allow" });
  });
});

describe("bridge-host — interrupt releases pending interactions (bug1)", () => {
  /** Drive a conversation to the point where canUseTool is blocked on approval. */
  async function blockOnApproval() {
    let canUseTool: ((n: string, i: Record<string, unknown>, o: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        canUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof canUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));
    const decision = canUseTool!("Bash", { command: "npm test" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-1",
      requestId: "rq-1",
    });
    await new Promise((r) => setTimeout(r, 10));
    return { host, conversationId, decision, pushed };
  }

  it("resolves a blocked approval so the round can actually stop", async () => {
    const { host, conversationId, decision } = await blockOnApproval();
    // Before this fix interrupt() only aborted the SDK stream; the canUseTool
    // promise stayed parked in approvalWaiters forever, so the child process
    // never returned and the UI's 停止 button did nothing.
    await host.handleInvoke("bridge:interrupt", { conversationId });
    const result = (await decision) as { behavior: string; message?: string };
    expect(result.behavior).toBe("deny");
    expect(result.message).toMatch(/interrupt/i);
  });

  it("leaves other conversations' pending approvals untouched", async () => {
    let hooks: Record<string, (n: string, i: Record<string, unknown>, o: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>> = {};
    let seq = 0;
    const { deps } = makeDeps((params) =>
      (async function* () {
        hooks[`c${++seq}`] = (params.options as Record<string, unknown>)?.canUseTool as never;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost(deps);
    const a = await host.handleInvoke("bridge:createConversation", { providerId: "deepseek", modelId: "deepseek-chat" });
    const b = await host.handleInvoke("bridge:createConversation", { providerId: "deepseek", modelId: "deepseek-chat" });
    await host.handleInvoke("bridge:send", { conversationId: a.conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 15));
    await host.handleInvoke("bridge:send", { conversationId: b.conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 15));

    const opts = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    const decisionA = hooks.c1("Bash", { command: "npm test" }, opts);
    const decisionB = hooks.c2("Bash", { command: "npm test" }, opts);
    await new Promise((r) => setTimeout(r, 10));

    await host.handleInvoke("bridge:interrupt", { conversationId: a.conversationId });
    expect(((await decisionA) as { behavior: string }).behavior).toBe("deny");

    // B must still be waiting — interrupting one conversation cannot cancel another.
    let bSettled = false;
    void decisionB.then(() => { bSettled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(bSettled).toBe(false);
  });

  it("is idempotent — interrupting twice with nothing pending is harmless", async () => {
    const { deps } = makeDeps((_p) =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "idle" });
    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "idle" });
  });

  it("finishes an active round locally and ignores provider events that arrive after interrupt", async () => {
    let releaseLateResult!: () => void;
    const lateResult = new Promise<void>((resolve) => { releaseLateResult = resolve; });
    let abortController: AbortController | undefined;
    let abortedWhenInterruptedTerminal: boolean | undefined;
    let queryRound = 0;
    const { deps, pushed } = makeDeps((params) => {
      queryRound += 1;
      if (queryRound > 1) {
        return (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: "recovery round completed",
            is_error: false,
            session_id: "interrupt-session",
          };
        })() as never;
      }
      return (async function* () {
        abortController = (params.options as { abortController?: AbortController }).abortController;
        yield { type: "system", subtype: "init", session_id: "interrupt-session" };
        yield {
          type: "assistant",
          session_id: "interrupt-session",
          parent_tool_use_id: null,
          message: {
            content: [{
              type: "tool_use",
              id: "tool-long",
              name: "Bash",
              input: { command: "a long command" },
            }],
          },
        };
        // Deliberately ignore AbortSignal to model an SDK/provider that unwinds
        // late. The host still owns the user-visible terminal state.
        await lateResult;
        yield {
          type: "result",
          subtype: "success",
          result: "late success must not leak into the interrupted turn",
          is_error: false,
          session_id: "interrupt-session",
        };
      })() as never;
    }, (call) => {
      const envelope = call.payload as { event?: { type?: string; subtype?: string } };
      if (envelope.event?.type === "run.finished" && envelope.event.subtype === "interrupted") {
        abortedWhenInterruptedTerminal = abortController?.signal.aborted;
      }
    });
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    await host.handleInvoke("bridge:send", { conversationId, prompt: "start long work" });
    await vi.waitFor(() => {
      const events = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string } }).event);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.started" }));
    });

    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "stopping" });
    await vi.waitFor(() => expect(pushed.some((entry) => (
      entry.channel === "bridge:event"
      && (entry.payload as { event?: { type?: string; subtype?: string } }).event?.type === "run.finished"
      && (entry.payload as { event?: { subtype?: string } }).event?.subtype === "interrupted"
    ))).toBe(true));
    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "idle" });

    const eventsAfterInterrupt = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string; subtype?: string; isError?: boolean } }).event);
    expect(abortController?.signal.aborted).toBe(true);
    expect(abortedWhenInterruptedTerminal).toBe(true);
    expect(eventsAfterInterrupt.filter((event) => event.type === "run.finished")).toEqual([
      expect.objectContaining({ type: "run.finished", subtype: "interrupted", isError: false }),
    ]);

    await host.handleInvoke("bridge:send", { conversationId, prompt: "recover immediately" });
    await vi.waitFor(() => {
      const recoveryEvents = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string; text?: string } }).event);
      expect(recoveryEvents).toContainEqual(expect.objectContaining({
        type: "text.final",
        text: "recovery round completed",
      }));
    });

    releaseLateResult();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const settledEvents = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string; subtype?: string; text?: string } }).event);
    expect(settledEvents.filter((event) => event.type === "run.finished")).toHaveLength(2);
    expect(settledEvents).not.toContainEqual(expect.objectContaining({
      type: "text.final",
      text: expect.stringContaining("late success"),
    }));
  });

  it("keeps a conversation locked after an unconfirmed stop, even when Stop is invoked again", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        const signal = (params.options as { abortController?: AbortController }).abortController?.signal;
        signal?.addEventListener("abort", () => {
          (signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] = false;
        }, { once: true });
        yield { type: "system", subtype: "init", session_id: "stop-failed-session" };
        yield {
          type: "assistant",
          session_id: "stop-failed-session",
          parent_tool_use_id: null,
          message: { content: [{ type: "tool_use", id: "tool-stuck", name: "Bash", input: { command: "stuck" } }] },
        };
        await gate;
      })() as never,
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "start stuck process" });
    await vi.waitFor(() => {
      const events = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string } }).event);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.started" }));
    });

    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "stopping" });
    await vi.waitFor(() => expect(pushed.some((entry) => (
      entry.channel === "bridge:event"
      && (entry.payload as { event?: { type?: string } }).event?.type === "run.stopLocked"
    ))).toBe(true));
    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "locked" });
    const events = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string; subtype?: string; message?: string } }).event);
    expect(events.filter((event) => event.type === "run.finished")).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      message: expect.stringContaining("此对话已锁定"),
    }));
    expect(events.filter((event) => event.type === "error" && event.message?.includes("此对话已锁定"))).toHaveLength(1);
    await expect(
      host.handleInvoke("bridge:send", { conversationId, prompt: "must not unlock" }),
    ).rejects.toThrow("in progress");
    release();
  });

  it("waits for verified native cleanup before host shutdown resolves", async () => {
    let releaseCleanup!: (stopped: boolean) => void;
    const cleanup = new Promise<boolean>((resolve) => { releaseCleanup = resolve; });
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        const signal = (params.options as { abortController?: AbortController }).abortController?.signal;
        signal?.addEventListener("abort", () => {
          (signal as AbortSignal & { [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean> })
            [PROCESS_TREE_STOP_PROMISE_KEY] = cleanup;
        }, { once: true });
        yield { type: "system", subtype: "init", session_id: "shutdown-pending" };
        await new Promise(() => undefined);
      })() as never,
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "keep running" });
    await vi.waitFor(() => expect(pushed.some((entry) =>
      entry.channel === "bridge:event"
      && (entry.payload as { event?: { type?: string } }).event?.type === "conversation.started")).toBe(true));

    let settled = false;
    host.dispose();
    const shuttingDown = host.shutdown().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCleanup(true);
    await shuttingDown;
    expect(settled).toBe(true);
  });

  it("emits interrupted-round memory receipts before the stopped terminal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, pushed } = makeDeps(() => (async function* () {
      yield { type: "system", subtype: "init", session_id: "stop-memory" };
      await gate;
    })() as never);
    const memoryRecord = {
      id: "memory-stop",
      scope: { type: "global" as const },
      kind: "preference" as const,
      topic: "回答方式",
      statement: "用户希望终止前完成记忆收尾",
      learnedAt: 1,
      lastConfirmedAt: 1,
      sourceType: "explicit-user" as const,
      sourceConversationId: "conversation-stop",
      sourceMessageId: "u-stop",
      status: "current" as const,
      pinned: false,
    };
    const memoryGovernance = {
      prepareNative: vi.fn(() => ({ scope: { type: "global" }, currentView: "" })),
      reconcileNative: vi.fn(() => ({
        changes: [{ changeId: "change-stop", action: "remembered", label: memoryRecord.statement, record: memoryRecord }],
        diagnostics: [],
      })),
    } as unknown as NonNullable<HostDeps["memoryGovernance"]>;
    const host = createBridgeHost({ ...deps, memoryGovernance });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "start", sourceMessageId: "u-stop" });
    await vi.waitFor(() => expect(pushed.some((entry) =>
      entry.channel === "bridge:event"
      && (entry.payload as { event?: { type?: string } }).event?.type === "conversation.started")).toBe(true));

    await expect(host.handleInvoke("bridge:interrupt", { conversationId })).resolves.toEqual({ state: "stopping" });
    await vi.waitFor(() => expect(pushed.some((entry) => (
      entry.channel === "bridge:event"
      && (entry.payload as { event?: { type?: string; subtype?: string } }).event?.type === "run.finished"
      && (entry.payload as { event?: { subtype?: string } }).event?.subtype === "interrupted"
    ))).toBe(true));

    const events = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string } }).event);
    expect(events.findIndex((event) => event.type === "memory.changed"))
      .toBeLessThan(events.findIndex((event) => event.type === "run.finished"));
    release();
    await host.shutdown();
  });

  it("fails a pending ask_user card on interrupt too", async () => {
    const { deps } = makeDeps((_p) =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    const askMcp = host.inspect(conversationId)!.askMcp;
    const asked = askMcp.handle({
      questions: [{ question: "pick", header: "h", options: [{ label: "a" }], multiSelect: false }],
    });
    await new Promise((r) => setTimeout(r, 10));
    await host.handleInvoke("bridge:interrupt", { conversationId });
    // A parked question would hang the round exactly like a parked approval.
    const res = (await asked) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it("settles a pending ask_user card before disposing its conversation record", async () => {
    const { deps } = makeDeps((_p) => (async function* () {
      yield { type: "result", subtype: "success", result: "", is_error: false };
    })() as never);
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    const asked = host.inspect(conversationId)!.askMcp.handle({
      questions: [{ question: "pick", header: "h", options: [{ label: "a" }], multiSelect: false }],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await host.handleInvoke("bridge:disposeConversation", { conversationId });

    await expect(asked).resolves.toMatchObject({ isError: true });
  });
});

describe("bridge-host — provider and model switch stay aligned", () => {
  it("keeps a persistent conversation across cloned catalog reads and rebuilds it once after a real hot-save", async () => {
    let liveCatalog = makeCatalog();
    let queryStarts = 0;
    const { deps, pushed } = makeDeps(((params: { prompt: AsyncIterable<unknown> }) => {
      queryStarts += 1;
      return (async function* () {
        let turn = 0;
        for await (const _input of params.prompt) {
          turn += 1;
          yield { type: "system", subtype: "init", session_id: "stable-session" };
          yield {
            type: "assistant",
            session_id: "stable-session",
            parent_tool_use_id: null,
            message: { content: [{ type: "text", text: `turn ${turn}` }] },
          };
          yield { type: "result", subtype: "success", result: `turn ${turn}`, is_error: false, session_id: "stable-session" };
          yield { type: "system", subtype: "session_state_changed", state: "idle", session_id: "stable-session" };
        }
      })() as never;
    }) as never);
    const host = createBridgeHost({
      ...deps,
      catalog: () => liveCatalog.map((entry) => structuredClone(entry)),
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    const finishedCount = () => pushed.filter((entry) =>
      entry.channel === "bridge:event"
      && (entry.payload as { event?: { type?: string } }).event?.type === "run.finished").length;

    await host.handleInvoke("bridge:send", { conversationId, prompt: "one" });
    await vi.waitFor(() => expect(finishedCount()).toBe(1));
    await host.handleInvoke("bridge:send", { conversationId, prompt: "two" });
    await vi.waitFor(() => expect(finishedCount()).toBe(2));
    expect(queryStarts).toBe(1);

    liveCatalog = liveCatalog.map((entry) => ({
      ...entry,
      provider: { ...entry.provider, apiKey: "hot-saved-key" },
    }));
    await host.handleInvoke("bridge:send", { conversationId, prompt: "three" });
    await vi.waitFor(() => expect(finishedCount()).toBe(3));
    expect(queryStarts).toBe(2);
    await host.shutdown();
  });

  it("keeps the turn locked when hot-refresh cannot verify retirement of the old process", async () => {
    let liveCatalog = makeCatalog();
    let queryStarts = 0;
    let firstSignal: AbortSignal | undefined;
    const { deps, pushed } = makeDeps(((params: {
      prompt: AsyncIterable<unknown>;
      options?: { abortController?: AbortController };
    }) => {
      queryStarts += 1;
      if (queryStarts === 1) {
        firstSignal = params.options?.abortController?.signal;
        firstSignal?.addEventListener("abort", () => {
          (firstSignal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })
            [PROCESS_TREE_STOP_RESULT_KEY] = false;
        }, { once: true });
      }
      return (async function* () {
        for await (const _input of params.prompt) {
          yield { type: "system", subtype: "init", session_id: "failed-retirement-session" };
          yield { type: "result", subtype: "success", result: "done", is_error: false, session_id: "failed-retirement-session" };
          yield { type: "system", subtype: "session_state_changed", state: "idle", session_id: "failed-retirement-session" };
        }
      })() as never;
    }) as never);
    const host = createBridgeHost({
      ...deps,
      catalog: () => liveCatalog.map((entry) => structuredClone(entry)),
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    const events = () => pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as {
        event: { type: string; message?: string; subtype?: string };
      }).event);

    await host.handleInvoke("bridge:send", { conversationId, prompt: "one" });
    await vi.waitFor(() => expect(events().filter((event) => event.type === "run.finished")).toHaveLength(1));

    liveCatalog = liveCatalog.map((entry) => ({
      ...entry,
      provider: { ...entry.provider, apiKey: "hot-saved-key" },
    }));
    await host.handleInvoke("bridge:send", { conversationId, prompt: "two" });
    await vi.waitFor(() => {
      expect(events()).toContainEqual(expect.objectContaining({
        type: "error",
        message: expect.stringContaining("此对话已锁定"),
      }));
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(queryStarts).toBe(1);
    expect(events().filter((event) => event.type === "run.finished")).toHaveLength(1);
    await expect(
      host.handleInvoke("bridge:send", { conversationId, prompt: "must stay locked" }),
    ).rejects.toThrow("in progress");
    await host.shutdown();
  });

  it("routes the next round through the selected provider and attributes usage to the selected model", async () => {
    const deepseek = makeCatalog()[0]!;
    const qwen: CatalogEntry = {
      ...deepseek,
      provider: {
        ...deepseek.provider,
        id: "qwen",
        name: "Qwen",
        baseUrl: "https://dashscope.example/anthropic",
        apiKey: "sk-qwen-test",
        models: ["qwen3.7-flash"],
        modelCapabilities: { "qwen3.7-flash": { thinking: true, vision: true } },
      },
      spec: {
        ...deepseek.spec,
        id: "qwen",
        kind: "qwen",
        name: "Qwen",
        baseUrl: "https://dashscope.example/anthropic",
        models: ["qwen3.7-flash"],
      },
    };
    const seen: Array<Record<string, string | undefined>> = [];
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        seen.push(((params.options as { env?: Record<string, string | undefined> })?.env ?? {}));
        yield {
          type: "result",
          subtype: "success",
          result: "ok",
          is_error: false,
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, catalog: [deepseek, qwen] });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "one" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await host.handleInvoke("bridge:setModel", {
      conversationId,
      providerId: "qwen",
      modelId: "qwen3.7-flash",
    } as never);
    await host.handleInvoke("bridge:send", { conversationId, prompt: "two" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen[1]).toMatchObject({
      ANTHROPIC_BASE_URL: qwen.provider.baseUrl,
      ANTHROPIC_MODEL: "qwen3.7-flash",
    });
    const usage = pushed
      .filter(({ channel }) => channel === "bridge:event")
      .map(({ payload }) => payload as BridgeEventMap["bridge:event"])
      .map(({ event }) => event)
      .filter((event) => event.type === "usage.final");
    expect(usage.at(-1)).toMatchObject({
      usage: { providerId: "qwen", modelId: "qwen3.7-flash" },
    });
  });

  it("starts the local gateway when an existing direct conversation switches to an OpenAI provider", async () => {
    const deepseek = makeCatalog()[0]!;
    const relay: CatalogEntry = {
      ...deepseek,
      provider: {
        ...deepseek.provider,
        id: "relay-switch",
        name: "Relay Switch",
        apiFormat: "openai",
        baseUrl: "https://relay.example/v1",
        models: ["relay-main"],
        modelCapabilities: { "relay-main": { thinking: true, vision: false } },
      },
      spec: {
        ...deepseek.spec,
        id: "relay-switch",
        kind: "custom",
        name: "Relay Switch",
        apiFormat: "openai",
        baseUrl: "https://relay.example/v1",
        models: ["relay-main"],
      },
    };
    const seen: Array<Record<string, string | undefined>> = [];
    const { deps } = makeDeps((params) =>
      (async function* () {
        seen.push(((params.options as { env?: Record<string, string | undefined> })?.env ?? {}));
        yield { type: "result", subtype: "success", result: "ok", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, catalog: [deepseek, relay] });

    try {
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: deepseek.provider.id,
        modelId: deepseek.provider.models[0]!,
      });
      await host.handleInvoke("bridge:send", { conversationId, prompt: "direct" });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await host.handleInvoke("bridge:setModel", {
        conversationId,
        providerId: relay.provider.id,
        modelId: "relay-main",
      });
      await expect(host.handleInvoke("bridge:send", { conversationId, prompt: "gateway" }))
        .resolves.toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(seen[1]).toMatchObject({
        ANTHROPIC_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
        ANTHROPIC_AUTH_TOKEN: "leemo-gw:relay-switch",
        ANTHROPIC_MODEL: "relay-main",
      });
    } finally {
      host.dispose();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });

  it("rejects an unknown provider or a model outside the provider's configured list", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    await expect(host.handleInvoke("bridge:setModel", {
      conversationId,
      providerId: "missing",
      modelId: "x",
    } as never)).rejects.toThrow(/unknown provider/i);
    await expect(host.handleInvoke("bridge:setModel", {
      conversationId,
      providerId: "deepseek",
      modelId: "not-offered",
    } as never)).rejects.toThrow(/model/i);
  });
});

describe("bridge-host — momo system prompt (轮 2 卡 A)", () => {
  /** Capture the systemPrompt the SDK would receive for one conversation. */
  async function captureSystemPrompt(
    req: Parameters<ReturnType<typeof createBridgeHost>["handleInvoke"]>[1],
    extra: Partial<HostDeps> = {},
  ): Promise<{ type: string; preset: string; append: string } | undefined> {
    const captured: unknown[] = [];
    const { deps } = makeDeps((params) =>
      (async function* () {
        captured.push((params.options as Record<string, unknown>)?.systemPrompt);
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, ...extra });
    const { conversationId } = await host.handleInvoke(
      "bridge:createConversation",
      req as never,
    );
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));
    return captured[0] as { type: string; preset: string; append: string } | undefined;
  }

  const baseReq = { providerId: "deepseek", modelId: "deepseek-chat" };

  it("appends the assembled momo prompt to the claude_code preset", async () => {
    const sp = await captureSystemPrompt({
      ...baseReq,
      mode: "buddy",
      personaText: "你是 momo。",
      talkStyle: 2,
      webSearchEnabled: false,
    });
    expect(sp?.type).toBe("preset");
    expect(sp?.preset).toBe("claude_code");
    expect(sp?.append).toContain("You are momo");
    expect(sp?.append).toContain("## 当前模式：搭子态");
    expect(sp?.append).toContain("适度。");
    expect(sp?.append).toContain("Search: disabled");
  });

  it("honours the persona context handed over by the renderer", async () => {
    const sp = await captureSystemPrompt({
      ...baseReq,
      mode: "workbench",
      personaText: "你是严谨导师。",
      talkStyle: 1,
      webSearchEnabled: true,
    });
    expect(sp?.append).toContain("## 当前模式：工作台态");
    expect(sp?.append).toContain("你是严谨导师。");
    expect(sp?.append).toContain("简洁。");
    expect(sp?.append).toContain("Search: enabled");
  });

  it("falls back to buddy defaults when the request omits persona context", async () => {
    // Older callers (wiki popup, fixtures) send no persona fields at all; momo
    // must still be momo rather than a bare preset agent.
    const sp = await captureSystemPrompt(baseReq);
    expect(sp?.append).toContain("You are momo");
    expect(sp?.append).toContain("## 当前模式：搭子态");
    expect(sp?.append).toContain("## 当前人设");
  });

  it("keeps the workspace destination in the prompt when memory is disabled", async () => {
    const sp = await captureSystemPrompt(
      { ...baseReq, rememberMode: false },
      { workspaceRoot: "C:\\Users\\R\\Leemo" },
    );

    expect(sp?.append).toContain("C:\\Users\\R\\Leemo\\默认工作区");
    expect(sp?.append).toMatch(/all notebooks/i);
  });

  it("never lets momo self-identify as Claude (验收②)", async () => {
    const sp = await captureSystemPrompt(baseReq);
    expect(sp?.append).not.toMatch(/You are Claude|I am Claude|我是\s*Claude/i);
    expect(sp?.append).toMatch(/Never claim to be Claude/);
  });

  it("injects the governed global-current view", async () => {
    const sp = await captureSystemPrompt(baseReq, {
      readGlobalMemory: () => "# momo memory\n- 用户在准备期末考。",
    });
    expect(sp?.append).toContain("## What momo remembers now");
    expect(sp?.append).toContain("用户在准备期末考。");
  });

  it("omits the current view when global memory is empty", async () => {
    const sp = await captureSystemPrompt(baseReq, { readGlobalMemory: () => undefined });
    expect(sp?.append).not.toContain("## What momo remembers now");
    expect(sp?.append).toContain("You are momo"); // the other layers still ship
  });

  it("does not read or expose global memory when automatic memory is disabled", async () => {
    const readGlobalMemory = vi.fn(() => "用户不希望本轮读取的隐私记忆");
    const sp = await captureSystemPrompt(
      { ...baseReq, rememberMode: false } as never,
      { readGlobalMemory, memoryDir: "C:\\Users\\R\\Leemo" },
    );

    expect(readGlobalMemory).not.toHaveBeenCalled();
    expect(sp?.append).not.toContain("用户不希望本轮读取的隐私记忆");
    expect(sp?.append).toContain("Long-term memory is disabled for this session");
    expect(sp?.append).not.toContain("C:\\Users\\R\\Leemo\\memory\\bookmarks.md");
  });

  it("keeps the notebook workspace but does not read notebook memory when disabled", async () => {
    const resolveNotebook = vi.fn((id: string) => ({
      title: id,
      dir: `C:\\Users\\R\\Leemo\\${id}`,
    }));
    const readNotebookMemory = vi.fn(() => "不应读取的本子隐私记忆");
    const sp = await captureSystemPrompt(
      { ...baseReq, notebookId: "秋招", rememberMode: false } as never,
      { resolveNotebook, readNotebookMemory, memoryDir: "C:\\Users\\R\\Leemo" },
    );

    expect(resolveNotebook).toHaveBeenCalledWith("秋招");
    expect(readNotebookMemory).not.toHaveBeenCalled();
    expect(sp?.append).toContain("C:\\Users\\R\\Leemo\\秋招");
    expect(sp?.append).not.toContain("不应读取的本子隐私记忆");
    expect(sp?.append).toContain("Long-term memory is disabled for this session");
    expect(sp?.append).toContain("本轮不要把本子信息写入长期记忆");
    expect(sp?.append).not.toContain("使用 Leemo 记忆工具的本子范围");
  });

  it("survives an unreadable global current view instead of failing the conversation", async () => {
    const sp = await captureSystemPrompt(baseReq, {
      readGlobalMemory: () => {
        throw new Error("EACCES");
      },
    });
    expect(sp?.append).toContain("You are momo");
    expect(sp?.append).not.toContain("## What momo remembers now");
  });

  it("injects the active notebook's governed current view", async () => {
    const seen: string[] = [];
    const sp = await captureSystemPrompt(
      { ...baseReq, mode: "workbench", notebookId: "高等数学" } as never,
      {
        readGlobalMemory: () => "全局：用户在准备期末考。",
        resolveNotebook: (id) => {
          seen.push(id);
          return { title: id, dir: `C:\\Users\\R\\Leemo\\${id}` };
        },
        readNotebookMemory: () => "本子约定：公式写 LaTeX。",
      },
    );
    expect(seen).toEqual(["高等数学"]); // the ID crossed IPC, not the file text
    expect(sp?.append).toContain("## 当前本子");
    expect(sp?.append).toContain("本子约定：公式写 LaTeX。");
    expect(sp?.append).toContain("C:\\Users\\R\\Leemo\\高等数学");
    expect(sp?.append).not.toContain("CLAUDE.md");
    // Global + notebook OVERLAY, with the narrower layer last (06 §7.4).
    expect(sp?.append).toContain("用户在准备期末考。");
    expect(sp!.append.indexOf("本子约定")).toBeGreaterThan(sp!.append.indexOf("全局："));
  });

  /** Capture the cwd the SDK would run in for one conversation (轮 7 A1). */
  async function captureCwd(
    req: Parameters<ReturnType<typeof createBridgeHost>["handleInvoke"]>[1],
    extra: Partial<HostDeps> = {},
  ): Promise<string | undefined> {
    const captured: unknown[] = [];
    const { deps } = makeDeps((params) =>
      (async function* () {
        captured.push((params.options as Record<string, unknown>)?.cwd);
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, ...extra });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", req as never);
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));
    return captured[0] as string | undefined;
  }

  // ── 轮 7 A1: 本子 = 工作区 ────────────────────────────────────────────────
  //
  // 这一组钉死用户最痛的那条 bug：momo 说"写好了"而文件落在他永远看不见的地方。
  // 判据是 SDK 真正收到的 cwd —— 不是 prompt 里怎么说的（模型可以无视 prompt，
  // 但它无法无视自己的工作目录）。
  it("runs a 本子 conversation IN that 本子's directory (轮 7 A1)", async () => {
    const cwd = await captureCwd({ ...baseReq, notebookId: "高等数学" } as never, {
      resolveNotebook: (id) => ({ title: id, dir: `C:\\Users\\R\\Leemo\\${id}` }),
    });
    // The whole point: relative work lands where the user can see it.
    expect(cwd).toBe("C:\\Users\\R\\Leemo\\高等数学");
  });

  it("runs an unfiled (主人格) conversation at the workspace ROOT, not a sandbox", async () => {
    const cwd = await captureCwd(baseReq, { workspaceRoot: "C:\\Users\\R\\Leemo" });
    // Root, so momo 主人格 can see every 本子 — they are its subdirectories.
    expect(cwd).toBe("C:\\Users\\R\\Leemo");
    expect(cwd).not.toContain("sandbox");
  });

  it("runs an external-workspace conversation in the registered folder", async () => {
    const resolveWorkspace = vi.fn((id: string) => ({
      id,
      name: "毕业设计",
      root: "D:\\Projects\\毕业设计",
      kind: "external" as const,
    }));
    const cwd = await captureCwd(
      { ...baseReq, workspaceId: "workspace-123" } as never,
      { resolveWorkspace },
    );

    expect(resolveWorkspace).toHaveBeenCalledWith("workspace-123");
    expect(cwd).toBe("D:\\Projects\\毕业设计");
  });

  it("describes an external workspace without routing artifacts to 默认工作区", async () => {
    const sp = await captureSystemPrompt(
      { ...baseReq, workspaceId: "workspace-123" } as never,
      {
        resolveWorkspace: (id) => ({
          id,
          name: "毕业设计",
          root: "D:\\Projects\\毕业设计",
          kind: "external",
        }),
      },
    );

    expect(sp?.append).toContain("毕业设计");
    expect(sp?.append).toContain("D:\\Projects\\毕业设计");
    expect(sp?.append).not.toContain("默认工作区");
  });

  it("refuses to reinterpret an external workspace as a 本子", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost({
      ...deps,
      resolveWorkspace: (id) => ({ id, name: "项目", root: "D:\\Project", kind: "external" }),
    });

    await expect(host.handleInvoke("bridge:createConversation", {
      ...baseReq,
      workspaceId: "workspace-123",
      notebookId: "高等数学",
    } as never)).rejects.toThrow(/外部工作区|本子/);
  });

  it("fails clearly when an external workspace disappears before the next send", async () => {
    const { deps } = makeDeps();
    let available = true;
    const host = createBridgeHost({
      ...deps,
      resolveWorkspace: (id) => {
        if (!available) throw new Error("找不到这个工作区，请重新选择文件夹。");
        return { id, name: "项目", root: "D:\\Project", kind: "external" };
      },
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      ...baseReq,
      workspaceId: "workspace-123",
    } as never);
    available = false;

    await expect(host.handleInvoke("bridge:send", {
      conversationId,
      prompt: "继续写",
    })).rejects.toThrow("找不到这个工作区");
  });

  it("falls back to the workspace root when the 本子 folder was deleted", async () => {
    // The user can delete the folder in Explorer between sessions. Landing at the
    // root is recoverable; landing in a sandbox is the bug we just removed.
    const cwd = await captureCwd({ ...baseReq, notebookId: "没了的本子" } as never, {
      workspaceRoot: "C:\\Users\\R\\Leemo",
      resolveNotebook: () => undefined,
    });
    expect(cwd).toBe("C:\\Users\\R\\Leemo");
  });

  // ── 轮 7 A3: 设置改了，已存在的对话下一轮就吃到 ──────────────────────────
  //
  // 这一组钉的是用户抱怨②的后两分之一：开关开了但当前对话不生效。判据是**第二
  // 轮真正收到的 options**，不是 updateContext 返回了什么。
  describe("bridge:updateContext (轮 7 A3)", () => {
    /** Create, send once, updateContext, send again — return both rounds' options. */
    async function twoRounds(
      createReq: Record<string, unknown>,
      update: Record<string, unknown>,
      extra: Partial<HostDeps> = {},
    ): Promise<Record<string, unknown>[]> {
      const seen: Record<string, unknown>[] = [];
      const { deps } = makeDeps((params) =>
        (async function* () {
          seen.push(params.options as Record<string, unknown>);
          yield { type: "result", subtype: "success", result: "", is_error: false };
        })() as never,
      );
      const host = createBridgeHost({ ...deps, ...extra });
      const { conversationId } = await host.handleInvoke(
        "bridge:createConversation",
        createReq as never,
      );
      await host.handleInvoke("bridge:send", { conversationId, prompt: "one" });
      await new Promise((r) => setTimeout(r, 20));
      await host.handleInvoke("bridge:updateContext", { conversationId, ...update } as never);
      await host.handleInvoke("bridge:send", { conversationId, prompt: "two" });
      await new Promise((r) => setTimeout(r, 20));
      return seen;
    }

    it("switching 联网搜索 on stops disallowing WebSearch from the next round", async () => {
      const rounds = await twoRounds(
        { ...baseReq, webSearchEnabled: false },
        { webSearchEnabled: true },
      );
      expect(rounds).toHaveLength(2);
      // Round 1: created with search off ⇒ the tool is structurally withheld.
      expect(rounds[0].disallowedTools as string[]).toContain("WebSearch");
      // Round 2: same conversation, no re-create ⇒ it is no longer withheld.
      expect(rounds[1].disallowedTools as string[]).not.toContain("WebSearch");
    });

    it("keeps the permission broker in the same live capability state as the search toggle", async () => {
      let canUseTool: ((
        name: string,
        input: Record<string, unknown>,
        options: { signal: AbortSignal; toolUseID: string; requestId: string },
      ) => Promise<unknown>) | undefined;
      const { deps, pushed } = makeDeps((params) =>
        (async function* () {
          canUseTool = (params.options as Record<string, unknown>).canUseTool as typeof canUseTool;
          yield { type: "result", subtype: "success", result: "", is_error: false };
        })() as never,
      );
      const host = createBridgeHost(deps);
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        ...baseReq,
        permissionMode: "bypassPermissions",
        webSearchEnabled: false,
      } as never);
      await host.handleInvoke("bridge:send", { conversationId, prompt: "probe" });
      await vi.waitFor(() => expect(canUseTool).toEqual(expect.any(Function)));

      const toolOptions = {
        signal: new AbortController().signal,
        toolUseID: "search-1",
        requestId: "search-1",
      };
      await expect(canUseTool!("WebSearch", { query: "Leemo" }, toolOptions)).resolves.toEqual({
        behavior: "deny",
        message: "这项能力已在 Leemo 设置中关闭。",
      });

      await host.handleInvoke("bridge:updateContext", { conversationId, webSearchEnabled: true } as never);
      await expect(canUseTool!("WebSearch", { query: "Leemo" }, toolOptions)).resolves.toEqual({
        behavior: "allow",
      });
      expect(pushed.filter((call) => call.channel === "bridge:approvalRequest")).toHaveLength(0);
      host.dispose();
    });

    it("keeps the permission broker in the same live capability state as automatic memory", async () => {
      let canUseTool: ((
        name: string,
        input: Record<string, unknown>,
        options: { signal: AbortSignal; toolUseID: string; requestId: string },
      ) => Promise<unknown>) | undefined;
      const { deps, pushed } = makeDeps((params) =>
        (async function* () {
          canUseTool = (params.options as Record<string, unknown>).canUseTool as typeof canUseTool;
          yield { type: "result", subtype: "success", result: "", is_error: false };
        })() as never,
      );
      const host = createBridgeHost(deps);
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        ...baseReq,
        permissionMode: "bypassPermissions",
        rememberMode: true,
      } as never);
      await host.handleInvoke("bridge:send", { conversationId, prompt: "probe" });
      await vi.waitFor(() => expect(canUseTool).toEqual(expect.any(Function)));

      const toolOptions = {
        signal: new AbortController().signal,
        toolUseID: "memory-1",
        requestId: "memory-1",
      };
      await expect(canUseTool!(LEEMO_MEMORY_TOOL_NAMES.recall, { query: "偏好" }, toolOptions)).resolves.toEqual({
        behavior: "allow",
      });

      await host.handleInvoke("bridge:updateContext", { conversationId, rememberMode: false } as never);
      await expect(canUseTool!(LEEMO_MEMORY_TOOL_NAMES.recall, { query: "偏好" }, toolOptions)).resolves.toEqual({
        behavior: "deny",
        message: "这项能力已在 Leemo 设置中关闭。",
      });
      expect(pushed.filter((call) => call.channel === "bridge:approvalRequest")).toHaveLength(0);
      host.dispose();
    });

    it("hot-adds and removes the search MCP fallback for an OPENAI conversation", async () => {
      const seen: Record<string, unknown>[] = [];
      const { deps } = makeDeps((params) =>
        (async function* () {
          seen.push((params.options ?? {}) as Record<string, unknown>);
          yield { type: "result", subtype: "success", result: "", is_error: false };
        })() as never,
      );
      const base = makeCatalog()[0]!;
      const relay = {
        ...base,
        provider: {
          ...base.provider,
          id: "relay-hot",
          apiFormat: "openai" as const,
          baseUrl: "https://relay.example/v1",
        },
        spec: { ...base.spec, id: "relay-hot", apiFormat: "openai" as const },
      };
      const host = createBridgeHost({ ...deps, catalog: [relay] });
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: "relay-hot",
        modelId: "deepseek-chat",
        gatewayPort: 41234,
        webSearchEnabled: false,
      } as never);

      try {
        await host.handleInvoke("bridge:send", { conversationId, prompt: "off" });
        await new Promise((r) => setTimeout(r, 20));
        await host.handleInvoke("bridge:updateContext", { conversationId, webSearchEnabled: true } as never);
        await host.handleInvoke("bridge:send", { conversationId, prompt: "on" });
        await new Promise((r) => setTimeout(r, 20));
        await host.handleInvoke("bridge:updateContext", { conversationId, webSearchEnabled: false } as never);
        await host.handleInvoke("bridge:send", { conversationId, prompt: "off again" });
        await new Promise((r) => setTimeout(r, 20));

        expect(seen).toHaveLength(3);
        expect(Object.keys(seen[0].mcpServers as object)).not.toContain("leemo-web-search");
        expect(Object.keys(seen[0].mcpServers as object)).not.toContain("leemo-academic-search");
        expect(Object.keys(seen[1].mcpServers as object)).toEqual(
          expect.arrayContaining(["leemo-ask-user", "leemo-web-search", "leemo-academic-search"]),
        );
        expect(seen[1].disallowedTools as string[]).toContain("WebSearch");
        expect(Object.keys(seen[2].mcpServers as object)).not.toContain("leemo-web-search");
        expect(Object.keys(seen[2].mcpServers as object)).not.toContain("leemo-academic-search");
        expect(Object.keys(seen[2].mcpServers as object)).toContain("leemo-ask-user");
      } finally {
        host.dispose();
      }
    });

    it("switching 联网抓取 off really disallows WebFetch (not just prompt wording)", async () => {
      const rounds = await twoRounds(
        { ...baseReq, webFetchEnabled: true },
        { webFetchEnabled: false },
      );
      expect(rounds[0].disallowedTools as string[]).not.toContain("WebFetch");
      expect(rounds[1].disallowedTools as string[]).toContain("WebFetch");
    });

    it("rebuilds prompt layer ⑦ so momo stops claiming it cannot search", async () => {
      const rounds = await twoRounds(
        { ...baseReq, webSearchEnabled: false },
        { webSearchEnabled: true },
      );
      const append = (o: Record<string, unknown>) =>
        (o.systemPrompt as { append: string }).append;
      // The exact sentence the live run produced was「这轮对话里我的网络访问是关的」
      // — driven by this layer saying disabled.
      expect(append(rounds[0])).toContain("Search: disabled");
      expect(append(rounds[1])).not.toContain("Search: disabled");
    });

    it("stops exposing global memory from the next round when automatic memory is switched off", async () => {
      const rounds = await twoRounds(
        { ...baseReq, rememberMode: true },
        { rememberMode: false },
        {
          readGlobalMemory: () => "只应出现在第一轮的长期记忆",
          memoryDir: "C:\\Users\\R\\Leemo",
        },
      );
      const append = (o: Record<string, unknown>) =>
        (o.systemPrompt as { append: string }).append;

      expect(append(rounds[0])).toContain("只应出现在第一轮的长期记忆");
      expect(append(rounds[1])).not.toContain("只应出现在第一轮的长期记忆");
      expect(append(rounds[1])).toContain("Long-term memory is disabled for this session");
    });

    it("applies a talkStyle / persona change to the running conversation", async () => {
      const rounds = await twoRounds(
        { ...baseReq, talkStyle: 1, personaText: "你是 momo。" },
        { talkStyle: 3, personaText: "你是严谨导师。" },
      );
      const append = (o: Record<string, unknown>) =>
        (o.systemPrompt as { append: string }).append;
      expect(append(rounds[1])).toContain("你是严谨导师。");
      expect(append(rounds[1])).not.toBe(append(rounds[0]));
    });

    it("an omitted field means leave-as-is, never reset-to-default", async () => {
      // Only talkStyle is sent; the notebook layer and persona must survive.
      const seen: Record<string, unknown>[] = [];
      const { deps } = makeDeps((params) =>
        (async function* () {
          seen.push(params.options as Record<string, unknown>);
          yield { type: "result", subtype: "success", result: "", is_error: false };
        })() as never,
      );
      const host = createBridgeHost({
        ...deps,
        resolveNotebook: (id) => ({ title: id, dir: `C:\\W\\${id}` }),
        readNotebookMemory: () => "本子约定：写 LaTeX。",
      });
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        ...baseReq, notebookId: "高等数学", personaText: "你是 momo。", webSearchEnabled: true,
      } as never);
      await host.handleInvoke("bridge:send", { conversationId, prompt: "one" });
      await new Promise((r) => setTimeout(r, 20));
      await host.handleInvoke("bridge:updateContext", { conversationId, talkStyle: 1 } as never);
      await host.handleInvoke("bridge:send", { conversationId, prompt: "two" });
      await new Promise((r) => setTimeout(r, 20));
      const append = (seen[1].systemPrompt as { append: string }).append;
      expect(append).toContain("你是 momo。");        // persona kept
      expect(append).toContain("本子约定：写 LaTeX。"); // layer ⑨ kept
      expect(append).not.toContain("Search: disabled"); // web flag kept
      // cwd must still be the notebook's dir — a context update is not a re-home.
      expect(seen[1].cwd).toBe("C:\\W\\高等数学");
    });

    it("an unknown conversation id is a no-op, not an error", async () => {
      // The renderer broadcasts to everything it believes is live; a conversation
      // the host has torn down must not fail the whole broadcast.
      const { deps } = makeDeps();
      const host = createBridgeHost(deps);
      await expect(
        host.handleInvoke("bridge:updateContext", { conversationId: "nope", talkStyle: 1 } as never),
      ).resolves.toBeUndefined();
    });
  });

  it("omits layer ⑨ for an unfiled conversation, and never calls the resolver", async () => {
    let calls = 0;
    const sp = await captureSystemPrompt(baseReq, {
      resolveNotebook: (id) => {
        calls++;
        return { title: id, dir: `/w/${id}` };
      },
    });
    expect(calls).toBe(0);
    expect(sp?.append).not.toContain("## 当前本子");
  });

  it("survives a stale notebook id (deleted folder) instead of failing the conversation", async () => {
    // The renderer persists bookId; the user can delete that folder in Explorer
    // between sessions. Re-opening the conversation must still work.
    const sp = await captureSystemPrompt(
      { ...baseReq, notebookId: "已被用户删掉的本子" } as never,
      { resolveNotebook: () => undefined },
    );
    expect(sp?.append).toContain("You are momo");
    expect(sp?.append).not.toContain("## 当前本子");
  });

  it("re-reads the memory bank per conversation so fresh writes are picked up", async () => {
    // Acceptance ④ depends on this: the user writes a fact, opens a NEW
    // conversation, and momo must recall it — so the read cannot be cached at
    // host construction time.
    let calls = 0;
    const { deps } = makeDeps((_p) =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({
      ...deps,
      readGlobalMemory: () => `fact-${++calls}`,
    });
    await host.handleInvoke("bridge:createConversation", baseReq);
    await host.handleInvoke("bridge:createConversation", baseReq);
    expect(calls).toBe(2);
  });
});

describe("bridge-host — governed native memory lifecycle", () => {
  const request = { providerId: "deepseek", modelId: "deepseek-chat" };

  function fakeGovernance() {
    const prepareNative = vi.fn((scope: unknown, nativeDirectory?: string) => ({
      scope,
      currentView: "# momo memory\n",
      ...(nativeDirectory ? { nativeDirectory } : {}),
    }));
    const reconcileNative = vi.fn((): { changes: unknown[]; diagnostics: string[] } => ({ changes: [], diagnostics: [] }));
    return {
      governance: { prepareNative, reconcileNative } as unknown as NonNullable<HostDeps["memoryGovernance"]>,
      prepareNative,
      reconcileNative,
    };
  }

  const memoryRecord = {
    id: "memory-1",
    scope: { type: "global" as const },
    kind: "preference" as const,
    topic: "回答方式",
    statement: "用户喜欢先看结论",
    learnedAt: 1_785_300_660_000,
    lastConfirmedAt: 1_785_300_660_000,
    sourceType: "explicit-user" as const,
    sourceConversationId: "conversation-1",
    sourceMessageId: "u0",
    status: "current" as const,
    pinned: false,
  };

  const rememberedChange = {
    changeId: "change-1",
    action: "remembered" as const,
    label: memoryRecord.statement,
    record: memoryRecord,
  };

  it("enables native memory in a private round directory and reconciles provenance on terminal", async () => {
    const optionsSeen: Record<string, unknown>[] = [];
    const { deps } = makeDeps((params) => (async function* () {
      optionsSeen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const memory = fakeGovernance();
    const host = createBridgeHost({
      ...deps,
      memoryDir: "C:\\Users\\R\\Leemo",
      memoryGovernance: memory.governance,
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", request);
    await host.handleInvoke("bridge:send", {
      conversationId,
      prompt: "记住我喜欢先给结论",
      sourceMessageId: "u7",
    });
    await vi.waitFor(() => expect(memory.reconcileNative).toHaveBeenCalledTimes(1));

    const settings = optionsSeen[0].settings as Record<string, unknown>;
    expect(settings).toMatchObject({ autoMemoryEnabled: true, autoDreamEnabled: false });
    expect(settings.autoMemoryDirectory).toEqual(expect.stringMatching(/native-memory.*round-1/i));
    expect(memory.prepareNative).toHaveBeenCalledWith(
      { type: "global" },
      settings.autoMemoryDirectory,
    );
    expect(memory.reconcileNative).toHaveBeenCalledWith(
      expect.objectContaining({ scope: { type: "global" }, nativeDirectory: settings.autoMemoryDirectory }),
      { conversationId, messageId: "u7" },
    );
    expect(Object.keys(optionsSeen[0].mcpServers as object)).toContain("leemo-memory");
  });

  it("layers bounded global context over project memory and writes project facts locally by default", async () => {
    const optionsSeen: Record<string, unknown>[] = [];
    const { deps } = makeDeps((params) => (async function* () {
      optionsSeen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const memory = fakeGovernance();
    const remember = vi.fn((input: { scope: MemoryScope }) => ({
      ...rememberedChange,
      record: { ...memoryRecord, scope: input.scope, kind: "state" as const, statement: "这个项目使用 pnpm" },
      label: "这个项目使用 pnpm",
    }));
    const host = createBridgeHost({
      ...deps,
      memoryDir: "C:\\Users\\R\\Leemo",
      memoryGovernance: { ...memory.governance, remember } as NonNullable<HostDeps["memoryGovernance"]>,
      readGlobalMemory: () => "- 用户喜欢先看结论",
      resolveWorkspace: (id) => id === "workspace-project"
        ? { id, name: "Demo", root: "D:\\Projects\\demo", kind: "external" }
        : { id: "leemo-home", name: "Leemo", root: deps.workspaceRoot, kind: "home" },
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      ...request,
      workspaceId: "workspace-project",
      rememberMode: true,
    });

    await host.inspect(conversationId)!.memoryMcp!.runRemember({
      topic: "项目约定",
      statement: "这个项目使用 pnpm",
      kind: "state",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "继续" });
    await vi.waitFor(() => expect(memory.prepareNative).toHaveBeenCalled());

    expect(remember).toHaveBeenCalledWith(expect.objectContaining({
      scope: { type: "workspace", workspaceId: "workspace-project" },
    }));
    expect(memory.prepareNative).toHaveBeenCalledWith(
      { type: "workspace", workspaceId: "workspace-project" },
      expect.stringMatching(/native-memory/i),
    );
    expect(JSON.stringify(optionsSeen[0].systemPrompt)).toContain("用户喜欢先看结论");
  });

  it("emits native memory receipts before the terminal event so they stay on the same turn", async () => {
    const { deps, pushed } = makeDeps(() => (async function* () {
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const memory = fakeGovernance();
    memory.reconcileNative.mockReturnValue({ changes: [rememberedChange], diagnostics: [] });
    const host = createBridgeHost({ ...deps, memoryGovernance: memory.governance });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", request);

    await host.handleInvoke("bridge:send", { conversationId, prompt: "记住", sourceMessageId: "u0" });
    await vi.waitFor(() => {
      const types = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string } }).event.type);
      expect(types).toContain("run.finished");
    });

    const events = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: Record<string, unknown> }).event);
    expect(events.findIndex((event) => event.type === "memory.changed"))
      .toBeLessThan(events.findIndex((event) => event.type === "run.finished"));
    expect(events).toContainEqual({
      type: "memory.changed",
      changeId: "change-1",
      action: "remembered",
      label: "用户喜欢先看结论",
      scope: { type: "global" },
    });
  });

  it("emits the same receipt shape for Leemo's explicit memory MCP", async () => {
    const { deps, pushed } = makeDeps();
    const memory = fakeGovernance();
    const remember = vi.fn(() => rememberedChange);
    const governance = { ...memory.governance, remember } as NonNullable<HostDeps["memoryGovernance"]>;
    const host = createBridgeHost({ ...deps, memoryGovernance: governance });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", request);

    const internal = host.inspect(conversationId);
    await internal!.memoryMcp!.runRemember({
      topic: "回答方式",
      statement: "用户喜欢先看结论",
      kind: "preference",
    });

    expect(pushed).toContainEqual({
      channel: "bridge:event",
      payload: {
        conversationId,
        event: {
          type: "memory.changed",
          changeId: "change-1",
          action: "remembered",
          label: "用户喜欢先看结论",
          scope: { type: "global" },
        },
      },
    });
  });

  it("exposes key-free memory management channels and opens only the governed directory", async () => {
    const { deps, pushed } = makeDeps();
    const openPath = vi.fn();
    const list = vi.fn(() => ({ records: [memoryRecord], diagnostics: [] }));
    const update = vi.fn(() => ({ ...rememberedChange, action: "updated" as const }));
    const remove = vi.fn(() => ({
      ...rememberedChange,
      action: "removed" as const,
      record: { ...memoryRecord, status: "deleted" as const },
    }));
    const pin = vi.fn(() => ({
      ...rememberedChange,
      action: "pinned" as const,
      record: { ...memoryRecord, pinned: true },
    }));
    const history = vi.fn(() => ({
      records: [memoryRecord, { ...memoryRecord, id: "memory-old", status: "superseded" as const }],
      diagnostics: [],
    }));
    const undo = vi.fn(() => ({
      ok: true,
      changeId: "undo-1",
      targetChangeId: "change-1",
      action: "undone" as const,
      records: [],
    }));
    const ensureScope = vi.fn(() => ({
      directory: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global",
      ledger: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global\\ledger.jsonl",
      currentView: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global\\MEMORY.md",
    }));
    const governance = {
      ...fakeGovernance().governance,
      list,
      update,
      remove,
      pin,
      history,
      undo,
      ensureScope,
    } as NonNullable<HostDeps["memoryGovernance"]>;
    const host = createBridgeHost({ ...deps, memoryGovernance: governance, openPath });

    await expect(host.handleInvoke("bridge:listMemory", { scopes: [{ type: "global" }] }))
      .resolves.toEqual([expect.objectContaining({
        id: "memory-1",
        statement: "用户喜欢先看结论",
        sourceConversationId: "conversation-1",
      })]);
    const changed = await host.handleInvoke("bridge:updateMemory", {
      scope: { type: "global" },
      id: "memory-1",
      statement: "用户希望先看结论和下一步",
    });
    expect(changed).toMatchObject({ action: "updated", memory: { id: "memory-1" } });
    await host.handleInvoke("bridge:deleteMemory", { scope: { type: "global" }, id: "memory-1" });
    await host.handleInvoke("bridge:pinMemory", { scope: { type: "global" }, id: "memory-1", pinned: true });
    await expect(host.handleInvoke("bridge:memoryHistory", { scope: { type: "global" }, id: "memory-1" }))
      .resolves.toHaveLength(2);

    const { conversationId } = await host.handleInvoke("bridge:createConversation", request);
    await expect(host.handleInvoke("bridge:undoMemory", {
      conversationId,
      scope: { type: "global" },
      targetChangeId: "change-1",
    })).resolves.toMatchObject({ ok: true, action: "undone" });
    expect(pushed).toContainEqual({
      channel: "bridge:event",
      payload: {
        conversationId,
        event: {
          type: "memory.changed",
          changeId: "undo-1",
          targetChangeId: "change-1",
          action: "undone",
          label: "",
          scope: { type: "global" },
        },
      },
    });

    await host.handleInvoke("bridge:openMemoryDir", { scope: { type: "global" } });
    expect(openPath).toHaveBeenCalledWith("C:\\Users\\R\\Leemo\\.leemo\\memory\\global");
    expect(JSON.stringify(await host.handleInvoke("bridge:listMemory", { scopes: [{ type: "global" }] })))
      .not.toContain("ledger.jsonl");
  });

  it("rejects malformed memory requests before they can reach the durable ledger", async () => {
    const { deps } = makeDeps();
    const memory = fakeGovernance();
    const update = vi.fn();
    const pin = vi.fn();
    const remove = vi.fn();
    const host = createBridgeHost({
      ...deps,
      memoryGovernance: {
        ...memory.governance,
        update,
        pin,
        remove,
      } as NonNullable<HostDeps["memoryGovernance"]>,
    });

    await expect(host.handleInvoke("bridge:updateMemory", {
      scope: { type: "global" }, id: "memory-1", kind: "private-secret",
    } as never)).rejects.toThrow(/类型|kind|不合法/i);
    await expect(host.handleInvoke("bridge:updateMemory", {
      scope: { type: "global" }, id: "memory-1", validFrom: Number.NaN,
    } as never)).rejects.toThrow(/时间|valid/i);
    await expect(host.handleInvoke("bridge:pinMemory", {
      scope: { type: "global" }, id: "memory-1", pinned: "yes",
    } as never)).rejects.toThrow(/置顶|pinned|不合法/i);
    await expect(host.handleInvoke("bridge:deleteMemory", {
      scope: { type: "global" }, id: "   ",
    } as never)).rejects.toThrow(/标识|id|不能为空/i);

    expect(update).not.toHaveBeenCalled();
    expect(pin).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not let a valid-looking id create memory for a notebook that does not exist", async () => {
    const { deps } = makeDeps();
    const memory = fakeGovernance();
    const list = vi.fn(() => ({ records: [], diagnostics: [] }));
    const ensureScope = vi.fn();
    const host = createBridgeHost({
      ...deps,
      resolveNotebook: vi.fn(() => undefined),
      memoryGovernance: {
        ...memory.governance,
        list,
        ensureScope,
      } as NonNullable<HostDeps["memoryGovernance"]>,
    });

    await expect(host.handleInvoke("bridge:listMemory", {
      scopes: [{ type: "notebook", notebookId: "并不存在的本子" }],
    })).rejects.toThrow(/本子.*不存在|找不到.*本子/);
    await expect(host.handleInvoke("bridge:openMemoryDir", {
      scope: { type: "notebook", notebookId: "并不存在的本子" },
    })).rejects.toThrow(/本子.*不存在|找不到.*本子/);
    expect(list).not.toHaveBeenCalled();
    expect(ensureScope).not.toHaveBeenCalled();
  });

  it("reports an OS directory-open failure instead of pretending it succeeded", async () => {
    const { deps } = makeDeps();
    const memory = fakeGovernance();
    const ensureScope = vi.fn(() => ({
      directory: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global",
      ledger: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global\\ledger.jsonl",
      currentView: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global\\MEMORY.md",
    }));
    const host = createBridgeHost({
      ...deps,
      memoryGovernance: {
        ...memory.governance,
        ensureScope,
      } as NonNullable<HostDeps["memoryGovernance"]>,
      openPath: vi.fn(() => Promise.resolve("Access denied")) as never,
    });

    await expect(host.handleInvoke("bridge:openMemoryDir", { scope: { type: "global" } }))
      .rejects.toThrow(/打开.*失败|Access denied/i);
  });

  it("keeps memory structurally off: no reads, no MCP, no native directory", async () => {
    const optionsSeen: Record<string, unknown>[] = [];
    const readGlobalMemory = vi.fn(() => "不应读取的全局隐私记忆");
    const readNotebookMemory = vi.fn(() => "不应读取的本子隐私记忆");
    const memory = fakeGovernance();
    const { deps } = makeDeps((params) => (async function* () {
      optionsSeen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const host = createBridgeHost({
      ...deps,
      memoryDir: "C:\\Users\\R\\Leemo",
      memoryGovernance: memory.governance,
      readGlobalMemory,
      resolveNotebook: (id) => ({ title: id, dir: `C:\\Users\\R\\Leemo\\${id}` }),
      readNotebookMemory,
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      ...request,
      notebookId: "秋招",
      rememberMode: false,
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "继续" });
    await vi.waitFor(() => expect(optionsSeen).toHaveLength(1));

    expect(optionsSeen[0].settings).toMatchObject({ autoMemoryEnabled: false, autoDreamEnabled: false });
    expect((optionsSeen[0].settings as Record<string, unknown>).autoMemoryDirectory).toBeUndefined();
    expect(Object.keys(optionsSeen[0].mcpServers as object)).not.toContain("leemo-memory");
    expect(readGlobalMemory).not.toHaveBeenCalled();
    expect(readNotebookMemory).not.toHaveBeenCalled();
    expect(memory.prepareNative).not.toHaveBeenCalled();
    expect(memory.reconcileNative).not.toHaveBeenCalled();
  });

  it("applies automatic-memory changes to the next round without recreating the conversation", async () => {
    const optionsSeen: Record<string, unknown>[] = [];
    const memory = fakeGovernance();
    const { deps } = makeDeps((params) => (async function* () {
      optionsSeen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const host = createBridgeHost({
      ...deps,
      memoryDir: "C:\\Users\\R\\Leemo",
      memoryGovernance: memory.governance,
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", request);

    await host.handleInvoke("bridge:send", { conversationId, prompt: "one" });
    await vi.waitFor(() => expect(memory.reconcileNative).toHaveBeenCalledTimes(1));
    await host.handleInvoke("bridge:updateContext", { conversationId, rememberMode: false });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "two" });
    await vi.waitFor(() => expect(optionsSeen).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await host.handleInvoke("bridge:updateContext", { conversationId, rememberMode: true });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "three" });
    await vi.waitFor(() => expect(memory.reconcileNative).toHaveBeenCalledTimes(2));

    expect(optionsSeen).toHaveLength(3);
    expect(optionsSeen.map((round) => (round.settings as Record<string, unknown>).autoMemoryEnabled))
      .toEqual([true, false, true]);
    expect(Object.keys(optionsSeen[0].mcpServers as object)).toContain("leemo-memory");
    expect(Object.keys(optionsSeen[1].mcpServers as object)).not.toContain("leemo-memory");
    expect(Object.keys(optionsSeen[2].mcpServers as object)).toContain("leemo-memory");
    expect((optionsSeen[1].settings as Record<string, unknown>).autoMemoryDirectory).toBeUndefined();
    expect((optionsSeen[2].settings as Record<string, unknown>).autoMemoryDirectory)
      .toEqual(expect.stringMatching(/round-3/i));
    expect(memory.prepareNative).toHaveBeenCalledTimes(2);
  });

  it("loads notebook memory natively and appends only the global overlay to the prompt", async () => {
    const optionsSeen: Record<string, unknown>[] = [];
    const readGlobalMemory = vi.fn(() => "全局：用户正在求职。");
    const readNotebookMemory = vi.fn(() => "本子：简历突出可验证成果。");
    const memory = fakeGovernance();
    const { deps } = makeDeps((params) => (async function* () {
      optionsSeen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const host = createBridgeHost({
      ...deps,
      memoryDir: "C:\\Users\\R\\Leemo",
      memoryGovernance: memory.governance,
      readGlobalMemory,
      resolveNotebook: (id) => ({ title: id, dir: `C:\\Users\\R\\Leemo\\${id}` }),
      readNotebookMemory,
    });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      ...request,
      notebookId: "秋招",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "继续" });
    await vi.waitFor(() => expect(memory.reconcileNative).toHaveBeenCalledTimes(1));

    expect(memory.prepareNative).toHaveBeenCalledWith(
      { type: "notebook", notebookId: "秋招" },
      expect.any(String),
    );
    expect(readGlobalMemory).toHaveBeenCalledTimes(1);
    expect(readNotebookMemory).not.toHaveBeenCalled();
    const prompt = JSON.stringify(optionsSeen[0].systemPrompt);
    expect(prompt).toContain("全局：用户正在求职。");
    expect(prompt).not.toContain("本子：简历突出可验证成果。");
  });

  it("denies ordinary file tools targeting governed memory even in bypass mode", async () => {
    let canUseTool: ((name: string, input: Record<string, unknown>, options: object) => Promise<unknown>) | undefined;
    const { deps } = makeDeps((params) => (async function* () {
      canUseTool = (params.options as Record<string, unknown>).canUseTool as typeof canUseTool;
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const host = createBridgeHost({ ...deps, workspaceRoot: "C:\\Users\\R\\Leemo" });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      ...request,
      permissionMode: "bypassPermissions",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "write" });
    await vi.waitFor(() => expect(canUseTool).toEqual(expect.any(Function)));
    const decision = await canUseTool!(
      "Write",
      { file_path: "C:\\Users\\R\\Leemo\\.leemo\\memory\\global\\MEMORY.md", content: "绕过" },
      { signal: new AbortController().signal, toolUseID: "t1", requestId: "r1" },
    );
    expect(decision).toEqual(expect.objectContaining({
      behavior: "deny",
      message: expect.stringMatching(/记忆工具/),
    }));
  });
});

describe("bridge-host — skills (轮 2 卡 E)", () => {
  const MEM = "C:\\Users\\Rengar\\Leemo";
  const SKILLS = `${MEM}\\.leemo\\skills`;

  /** Fake SkillsIO holding one real-looking skill. */
  function skillsIO(entries: Record<string, string>): NonNullable<HostDeps["skillsIO"]> {
    const files = new Map(Object.entries(entries));
    return {
      readdir: (dir) =>
        dir === SKILLS
          ? [...new Set([...files.keys()].filter((f) => f.startsWith(`${dir}\\`)).map((f) => f.slice(dir.length + 1).split("\\")[0]))]
          : (() => {
              throw new Error("ENOENT");
            })(),
      readFile: (p) => {
        const c = files.get(p);
        if (c === undefined) throw new Error("ENOENT");
        return c;
      },
      exists: (p) => files.has(p) || [...files.keys()].some((f) => f.startsWith(`${p}\\`)),
      writeFile: (p, c) => void files.set(p, c),
      mkdirp: () => {},
    };
  }

  const ONE_SKILL = {
    [`${SKILLS}\\pdf\\SKILL.md`]: "---\nname: pdf\ndescription: Fill in forms\n---\nbody\n",
  };

  /** Capture the SDK options of one conversation's first round. */
  async function captureOptions(
    req: Parameters<ReturnType<typeof createBridgeHost>["handleInvoke"]>[1],
    extra: Partial<HostDeps> = {},
    prompt = "hi",
  ): Promise<Record<string, unknown>> {
    const seen: Record<string, unknown>[] = [];
    const { deps } = makeDeps((params) =>
      (async function* () {
        seen.push((params.options ?? {}) as Record<string, unknown>);
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, ...extra });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", req as never);
    await host.handleInvoke("bridge:send", { conversationId, prompt });
    await new Promise((r) => setTimeout(r, 20));
    return seen[0] ?? {};
  }

  const baseReq = { providerId: "deepseek", modelId: "deepseek-chat" };

  it("keeps wiki selection questions local and read-only even when main-agent capabilities are enabled", async () => {
    const opts = await captureOptions({
      ...baseReq,
      purpose: "wiki",
      webSearchEnabled: true,
      webFetchEnabled: true,
      rememberMode: true,
      permissionMode: "bypassPermissions",
    });

    expect(opts.permissionMode).toBe("plan");
    expect(opts.disallowedTools).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
    expect(Object.keys(opts.mcpServers as Record<string, unknown>)).toEqual([]);
    const canUseTool = opts.canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => Promise<{ behavior: string; message?: string }>;
    for (const toolName of ["Read", "Write", "Bash", "ExitPlanMode", "mcp__custom__anything"]) {
      await expect(canUseTool(toolName, {}, {})).resolves.toMatchObject({
        behavior: "deny",
        message: expect.stringContaining("选区问答只分析当前选中的内容"),
      });
    }
  });

  it("does not attribute incidental disk changes to the read-only work overview tool", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "leemo-overview-receipt-"));
    const incidentalPath = path.join(root, "unrelated.md");
    try {
      const { deps, pushed } = makeDeps(() => (async function* () {
        yield { type: "system", subtype: "init", session_id: "session-overview-receipt" };
        yield {
          type: "assistant",
          session_id: "session-overview-receipt",
          parent_tool_use_id: null,
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              id: "overview-receipt",
              name: "mcp__leemo-work-overview__set_work_overview",
              input: { focus: "PDF 阅读" },
            }],
          },
        };
        writeFileSync(incidentalPath, "not created by the overview tool", "utf8");
        yield {
          type: "user",
          session_id: "session-overview-receipt",
          parent_tool_use_id: null,
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "overview-receipt", content: "ok", is_error: false }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "session-overview-receipt",
          result: "概览已更新。",
          is_error: false,
        };
      })() as never);
      Object.assign(deps, { workspaceRoot: root });
      const host = createBridgeHost(deps);
      const created = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
      });
      await host.handleInvoke("bridge:send", {
        conversationId: created.conversationId,
        prompt: "把概览重点改为 PDF 阅读",
      });
      await vi.waitFor(() => {
        expect(pushed.some((call) =>
          call.channel === "bridge:event"
          && (call.payload as { event?: { type?: string } }).event?.type === "run.finished")).toBe(true);
      });

      const eventTypes = pushed
        .filter((call) => call.channel === "bridge:event")
        .map((call) => (call.payload as { event: { type: string } }).event.type);
      expect(eventTypes).not.toContain("file.changed");
      host.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function officeRuntime(initial: OfficeSkillRuntimeSnapshot): OfficeSkillRuntime & {
    ensureReady: ReturnType<typeof vi.fn>;
  } {
    let state = initial;
    const ensureReady = vi.fn(async () => state);
    return {
      snapshot: () => ({ ...state }),
      ensureReady,
    };
  }

  function bundledDefinition(
    directory: string,
    defaultEnabled: boolean,
  ): BundledSkillDefinition {
    return {
      id: `bundled:${directory}`,
      directory,
      sourceDir: `C:\\Leemo\\bundle\\${directory}`,
      name: directory,
      commandName: directory,
      description: `${directory} 的真实方法与工具`,
      qualifiedName: `leemo-library:${directory}`,
      source: "builtin",
      category: "workbench",
      categoryLabel: "通用工作台",
      defaultEnabled,
      available: true,
      trust: "leemo",
      sourceKind: "leemo",
      sourceLabel: "社区精选",
      scanStatus: "scanned",
      canRemove: false,
      canUpdate: false,
    };
  }

  function bundledRuntime(initial: BundledSkillRuntimeSnapshot): BundledSkillRuntime & {
    ensureReady: ReturnType<typeof vi.fn>;
  } {
    let state = initial;
    const ensureReady = vi.fn(async () => state);
    return {
      snapshot: () => ({ ...state, skills: [...state.skills] }),
      ensureReady,
    };
  }

  function superpowersDefinition(name: (typeof SUPERPOWERS_SKILL_NAMES)[number]): SuperpowersSkillDefinition {
    return {
      id: `superpowers:${name}`,
      directory: name,
      sourceDir: `C:\\Leemo\\superpowers-bundle\\${name}`,
      name: `产品文案 ${name}`,
      commandName: name,
      description: `${name} 的真实开发方法`,
      qualifiedName: `superpowers:${name}`,
      source: "builtin",
      category: "developer",
      categoryLabel: "开发",
      defaultEnabled: false,
      available: true,
      trust: "community",
      sourceKind: "leemo",
      sourceLabel: "社区精选",
      sourceUrl: `https://github.com/obra/superpowers/tree/revision/skills/${name}`,
      repository: "obra/superpowers",
      revision: "revision",
      license: "MIT",
      scanStatus: "scanned",
      canRemove: false,
      canUpdate: false,
      collectionId: "superpowers",
      collectionLabel: SUPERPOWERS_COLLECTION_LABEL,
    };
  }

  function superpowersRuntime(
    initial: SuperpowersSkillRuntimeSnapshot,
  ): SuperpowersSkillRuntime & { ensureReady: ReturnType<typeof vi.fn> } {
    const state = initial;
    const ensureReady = vi.fn(async () => state);
    return {
      snapshot: () => ({ ...state, skills: [...state.skills] }),
      ensureReady,
    };
  }

  it("lists all 14 Superpowers cards as a separate default-off suite without exposing paths", async () => {
    const skills = SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition);
    const superpowersSkills = superpowersRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\superpowers",
      revision: "revision",
      skills,
    });
    const { deps } = makeDeps();
    const host = createBridgeHost({ ...deps, superpowersSkills });

    const listed = (await host.handleInvoke("bridge:listSkills", undefined))
      .filter((skill) => skill.collectionId === "superpowers");

    expect(listed).toHaveLength(14);
    expect(listed.every((skill) => skill.defaultEnabled === false && skill.available === true)).toBe(true);
    expect(listed.map((skill) => skill.qualifiedName)).toContain("superpowers:brainstorming");
    expect(listed.map((skill) => skill.qualifiedName)).toContain("superpowers:writing-plans");
    expect(JSON.stringify(listed)).not.toContain("C:\\Leemo");
  });

  it("keeps an ordinary default conversation completely free of Superpowers", async () => {
    const superpowersSkills = superpowersRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\superpowers",
      revision: "revision",
      skills: SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition),
    });
    const bundledSkills = bundledRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\leemo-library",
      revision: "bundled-revision",
      skills: [bundledDefinition("frontend-design", true)],
    });

    const options = await captureOptions(baseReq, { bundledSkills, superpowersSkills });

    expect(superpowersSkills.ensureReady).not.toHaveBeenCalled();
    expect(options.plugins).toEqual([{ type: "local", path: "C:\\Leemo\\runtime\\leemo-library" }]);
    expect(options.skills).toEqual(["leemo-library:frontend-design"]);
    expect(JSON.stringify(options.systemPrompt ?? "")).not.toContain("superpowers:");
  });

  it("does not prepare or route an unknown Superpowers-looking name", async () => {
    const superpowersSkills = superpowersRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\superpowers",
      revision: "revision",
      skills: SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition),
    });

    const options = await captureOptions(
      { ...baseReq, enabledSkills: ["superpowers:not-a-real-skill"] },
      { superpowersSkills },
    );

    expect(superpowersSkills.ensureReady).not.toHaveBeenCalled();
    expect("plugins" in options).toBe(false);
    expect("skills" in options).toBe(false);
    expect(JSON.stringify(options.systemPrompt ?? "")).not.toContain("superpowers:");
  });

  it("prepares once and routes the complete Superpowers suite through one plugin", async () => {
    const skills = SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition);
    let state: SuperpowersSkillRuntimeSnapshot = { status: "preparing", skills };
    const ensureReady = vi.fn(async () => {
      state = {
        status: "ready",
        pluginPath: "C:\\Leemo\\runtime\\superpowers",
        revision: "revision",
        skills,
      };
      return state;
    });
    const superpowersSkills: SuperpowersSkillRuntime = {
      snapshot: () => ({ ...state, skills: [...state.skills] }),
      ensureReady,
    };
    const enabledSkills = SUPERPOWERS_SKILL_NAMES.map((name) => `superpowers:${name}`);

    const options = await captureOptions(
      { ...baseReq, enabledSkills },
      { superpowersSkills },
      "Let's make a react todo list",
    );

    expect(ensureReady).toHaveBeenCalledTimes(1);
    expect(options.plugins).toEqual([{ type: "local", path: "C:\\Leemo\\runtime\\superpowers" }]);
    expect(options.skills).toEqual(enabledSkills);
    expect(options.skills).toContain("superpowers:brainstorming");
    expect(options.skills).toContain("superpowers:writing-plans");
    const append = (options.systemPrompt as { append: string }).append;
    expect(append).toContain("superpowers:using-superpowers");
    expect(append).toContain("回复或执行前");
    expect(append).not.toContain("C:\\Leemo");
  });

  it("does not add the bootstrap when using-superpowers itself is disabled", async () => {
    const superpowersSkills = superpowersRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\superpowers",
      revision: "revision",
      skills: SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition),
    });

    const options = await captureOptions(
      { ...baseReq, enabledSkills: ["superpowers:brainstorming"] },
      { superpowersSkills },
    );

    expect(options.plugins).toEqual([{ type: "local", path: "C:\\Leemo\\runtime\\superpowers" }]);
    expect(options.skills).toEqual(["superpowers:brainstorming"]);
    expect(JSON.stringify(options.systemPrompt ?? "")).not.toContain("superpowers:using-superpowers");
  });

  it("keeps the fixed bootstrap within the exact enabled allow-list", async () => {
    const superpowersSkills = superpowersRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\superpowers",
      revision: "revision",
      skills: SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition),
    });

    const options = await captureOptions(
      { ...baseReq, enabledSkills: ["superpowers:using-superpowers"] },
      { superpowersSkills },
    );

    const append = (options.systemPrompt as { append: string }).append;
    expect(append).toContain("superpowers:using-superpowers");
    expect(append).not.toContain("superpowers:brainstorming");
    expect(append).not.toContain("superpowers:writing-plans");
  });

  it("removes the Superpowers plugin, allow-list and bootstrap on the next round after disabling", async () => {
    const seen: Record<string, unknown>[] = [];
    const { deps } = makeDeps((params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const superpowersSkills = superpowersRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\superpowers",
      revision: "revision",
      skills: SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition),
    });
    const host = createBridgeHost({ ...deps, superpowersSkills });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      ...baseReq,
      enabledSkills: ["superpowers:using-superpowers"],
    });

    await host.handleInvoke("bridge:send", { conversationId, prompt: "first" });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await host.handleInvoke("bridge:syncEnabledSkills", { enabledQualifiedNames: [] });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "second" });
    await vi.waitFor(() => expect(seen).toHaveLength(2));

    expect(seen[0]?.plugins).toEqual([{ type: "local", path: "C:\\Leemo\\runtime\\superpowers" }]);
    expect(JSON.stringify(seen[0]?.systemPrompt ?? "")).toContain("superpowers:using-superpowers");
    expect("plugins" in seen[1]!).toBe(false);
    expect("skills" in seen[1]!).toBe(false);
    expect(JSON.stringify(seen[1]?.systemPrompt ?? "")).not.toContain("superpowers:");
  });

  it("keeps the newest sync selection when an earlier enable finishes preparing later", async () => {
    const seen: Record<string, unknown>[] = [];
    const { deps } = makeDeps((params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const skills = SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition);
    let state: SuperpowersSkillRuntimeSnapshot = { status: "preparing", skills };
    let finishPreparation!: () => void;
    const preparation = new Promise<SuperpowersSkillRuntimeSnapshot>((resolve) => {
      finishPreparation = () => {
        state = {
          status: "ready",
          pluginPath: "C:\\Leemo\\runtime\\superpowers",
          revision: "revision",
          skills,
        };
        resolve(state);
      };
    });
    const ensureReady = vi.fn(() => preparation);
    const superpowersSkills: SuperpowersSkillRuntime = {
      snapshot: () => ({ ...state, skills: [...state.skills] }),
      ensureReady,
    };
    const host = createBridgeHost({ ...deps, superpowersSkills });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", baseReq);

    const staleEnable = host.handleInvoke("bridge:syncEnabledSkills", {
      enabledQualifiedNames: ["superpowers:using-superpowers"],
    });
    await vi.waitFor(() => expect(ensureReady).toHaveBeenCalledTimes(1));
    await host.handleInvoke("bridge:syncEnabledSkills", { enabledQualifiedNames: [] });
    finishPreparation();
    await staleEnable;

    await host.handleInvoke("bridge:send", { conversationId, prompt: "after disable" });
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect("plugins" in seen[0]!).toBe(false);
    expect("skills" in seen[0]!).toBe(false);
    expect(JSON.stringify(seen[0]?.systemPrompt ?? "")).not.toContain("superpowers:");
  });

  it("discards an obsolete preparation error after a newer sync has already won", async () => {
    const { deps } = makeDeps();
    const skills = SUPERPOWERS_SKILL_NAMES.map(superpowersDefinition);
    let rejectPreparation!: (error: Error) => void;
    const preparation = new Promise<SuperpowersSkillRuntimeSnapshot>((_resolve, reject) => {
      rejectPreparation = reject;
    });
    const ensureReady = vi.fn(() => preparation);
    const superpowersSkills: SuperpowersSkillRuntime = {
      snapshot: () => ({ status: "preparing", skills }),
      ensureReady,
    };
    const host = createBridgeHost({ ...deps, superpowersSkills });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", baseReq);

    const staleEnable = host.handleInvoke("bridge:syncEnabledSkills", {
      enabledQualifiedNames: ["superpowers:using-superpowers"],
    });
    await vi.waitFor(() => expect(ensureReady).toHaveBeenCalledTimes(1));
    await host.handleInvoke("bridge:syncEnabledSkills", { enabledQualifiedNames: [] });
    rejectPreparation(new Error("obsolete preparation failed"));

    await expect(staleEnable).resolves.toEqual({ updatedConversations: 0 });
    expect(conversationId).toEqual(expect.any(String));
  });

  it("bridge:listSkills returns the scanned skills with bare + qualified names", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost({ ...deps, memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) });
    const list = await host.handleInvoke("bridge:listSkills", undefined);
    expect(list.filter((skill) => skill.source === "builtin")).toHaveLength(0);
    expect(list.filter((skill) => skill.source === "user")).toEqual([
      {
        id: "custom:leemo:pdf",
        name: "pdf",
        description: "Fill in forms",
        qualifiedName: "leemo:pdf",
        dir: `${SKILLS}\\pdf`,
        source: "user",
        requirements: ["core"],
        defaultEnabled: true,
        available: true,
        trust: "personal",
        sourceKind: "manual",
        sourceLabel: "本地文件夹",
        scanStatus: "unscanned",
        canRemove: false,
        canUpdate: false,
      },
    ]);
  });

  it("bridge:listSkills never exposes a prefixed name to the renderer (铁律)", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost({ ...deps, memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) });
    for (const skill of await host.handleInvoke("bridge:listSkills", undefined)) {
      expect(skill.name).not.toContain(":");
      expect(skill.qualifiedName).toContain(":");
    }
  });

  it("bridge:listSkills returns [] when no memoryDir/skillsIO is configured", async () => {
    // dev harnesses and older callers wire neither; must not throw.
    const { deps } = makeDeps();
    const host = createBridgeHost(deps);
    expect(await host.handleInvoke("bridge:listSkills", undefined)).toEqual([]);
  });

  it("keeps the bundled catalog visible when the custom skill scan blows up", async () => {
    const { deps } = makeDeps();
    const exploding: NonNullable<HostDeps["skillsIO"]> = {
      readdir: () => {
        throw new Error("EPERM");
      },
      readFile: () => {
        throw new Error("EPERM");
      },
      exists: () => {
        throw new Error("EPERM");
      },
      writeFile: () => {},
      mkdirp: () => {},
    };
    const bundledSkills = bundledRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\leemo-library",
      revision: "rev-1",
      skills: [bundledDefinition("frontend-design", true)],
    });
    const host = createBridgeHost({ ...deps, memoryDir: MEM, skillsIO: exploding, bundledSkills });
    const list = await host.handleInvoke("bridge:listSkills", undefined);
    expect(list).toHaveLength(1);
    expect(list.every((skill) => skill.source === "builtin")).toBe(true);
    expect(list.every((skill) => skill.available === true)).toBe(true);
  });

  it("lists real bundled Skills with their source and first-install policy", async () => {
    const { deps } = makeDeps();
    const bundledSkills = bundledRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\leemo-library",
      revision: "rev-1",
      skills: [
        bundledDefinition("frontend-design", true),
        bundledDefinition("image-gen", false),
      ],
    });
    const host = createBridgeHost({ ...deps, bundledSkills });

    const list = await host.handleInvoke("bridge:listSkills", undefined);

    expect(list.map((skill) => ({ id: skill.id, enabled: skill.defaultEnabled, source: skill.sourceLabel }))).toEqual([
      { id: "bundled:frontend-design", enabled: true, source: "社区精选" },
      { id: "bundled:image-gen", enabled: false, source: "社区精选" },
    ]);
    expect(JSON.stringify(list)).not.toContain("C:\\Leemo\\runtime");
    expect(JSON.stringify(list)).not.toContain("C:\\Leemo\\bundle");
  });

  it("waits for bundled preparation and loads an explicitly enabled optional Skill", async () => {
    const skills = [
      bundledDefinition("frontend-design", true),
      bundledDefinition("image-gen", false),
    ];
    let state: BundledSkillRuntimeSnapshot = { status: "preparing", skills };
    const ensureReady = vi.fn(async () => {
      state = {
        status: "ready",
        pluginPath: "C:\\Leemo\\runtime\\leemo-library",
        revision: "rev-2",
        skills,
      };
      return state;
    });
    const bundledSkills: BundledSkillRuntime = {
      snapshot: () => ({ ...state, skills: [...state.skills] }),
      ensureReady,
    };

    const opts = await captureOptions(
      { ...baseReq, enabledSkills: ["leemo-library:image-gen"] },
      { bundledSkills },
    );

    expect(ensureReady).toHaveBeenCalledTimes(1);
    expect(opts.plugins).toEqual([{ type: "local", path: "C:\\Leemo\\runtime\\leemo-library" }]);
    expect(opts.skills).toEqual(["leemo-library:image-gen"]);
  });

  it("joins bundled preparation before applying a settings-page toggle", async () => {
    const { deps } = makeDeps();
    const skills = [bundledDefinition("image-gen", false)];
    let state: BundledSkillRuntimeSnapshot = { status: "preparing", skills };
    const ensureReady = vi.fn(async () => {
      state = {
        status: "ready",
        pluginPath: "C:\\Leemo\\runtime\\leemo-library",
        revision: "rev-toggle",
        skills,
      };
      return state;
    });
    const bundledSkills: BundledSkillRuntime = {
      snapshot: () => ({ ...state, skills: [...state.skills] }),
      ensureReady,
    };
    const host = createBridgeHost({ ...deps, bundledSkills });

    await host.handleInvoke("bridge:syncEnabledSkills", {
      enabledQualifiedNames: ["leemo-library:image-gen"],
    });

    expect(ensureReady).toHaveBeenCalledTimes(1);
  });

  it("uses only default-on bundled Skills when enabledSkills is omitted", async () => {
    const bundledSkills = bundledRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\leemo-library",
      revision: "rev-1",
      skills: [
        bundledDefinition("frontend-design", true),
        bundledDefinition("image-gen", false),
      ],
    });

    const opts = await captureOptions(baseReq, { bundledSkills });

    expect(opts.skills).toEqual(["leemo-library:frontend-design"]);
    expect(opts.plugins).toEqual([{ type: "local", path: "C:\\Leemo\\runtime\\leemo-library" }]);
  });

  it("keeps bundled cards visible but disabled when preparation fails", async () => {
    const { deps } = makeDeps();
    const bundledSkills = bundledRuntime({
      status: "error",
      error: "内置技能运行目录不可用",
      skills: [bundledDefinition("frontend-design", true)],
    });
    const host = createBridgeHost({ ...deps, bundledSkills });

    const list = await host.handleInvoke("bridge:listSkills", undefined);

    expect(list).toEqual([expect.objectContaining({
      id: "bundled:frontend-design",
      available: false,
      unavailableReason: "内置技能运行目录不可用",
    })]);
  });

  it("bridge:openSkillsDir asks the injected opener for the skills root", async () => {
    const opened: string[] = [];
    const { deps } = makeDeps();
    const host = createBridgeHost({
      ...deps,
      memoryDir: MEM,
      skillsIO: skillsIO(ONE_SKILL),
      openPath: (p) => void opened.push(p),
    });
    await host.handleInvoke("bridge:openSkillsDir", undefined);
    expect(opened).toEqual([SKILLS]);
  });

  it("bridge:openSkillsDir is a no-op (not a throw) with no opener wired", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost({ ...deps, memoryDir: MEM });
    await expect(host.handleInvoke("bridge:openSkillsDir", undefined)).resolves.toBeUndefined();
  });

  it("passes the product-owned plugin path <memoryDir>/.leemo to every conversation", async () => {
    const opts = await captureOptions(baseReq, { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) });
    expect(opts.plugins).toEqual([{ type: "local", path: `${MEM}\\.leemo` }]);
    // 卡 A 方案 C must survive: settingSources stays empty.
    expect(opts.settingSources).toEqual([]);
  });

  it("omits plugins when there is no memory dir at all", async () => {
    const opts = await captureOptions(baseReq);
    expect("plugins" in opts).toBe(false);
  });

  it("forwards the renderer's enabledSkills as the SDK allow-list", async () => {
    const opts = await captureOptions(
      { ...baseReq, enabledSkills: ["leemo:pdf"] },
      { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) },
    );
    expect(opts.skills).toEqual(["leemo:pdf"]);
  });

  // ── "everything off" has to drop the PLUGIN, not just narrow `skills` ─────
  // 实测 2026-07-26 (skills-probe, real DeepSeek + real SDK), plugin loaded:
  //   skills:['leemo:probe'] + "/probe"        → fired
  //   skills:[]              + "/probe"        → STILL fired
  //   skills:[]              + natural language→ refused ("不在允许列表中")
  //   no plugins             + "/probe"        → "Unknown command"
  //   no plugins             + natural language→ not found
  // So `skills` gates the Skill TOOL exactly as documented, but plugin skills
  // ALSO register as slash commands, and `/name` is expanded by the CLI before
  // the model is involved — the allow-list never sees it. The only lever that
  // closes both paths is not handing the engine the plugin at all.
  it("omits the plugin entirely when the user disabled every skill", async () => {
    const opts = await captureOptions(
      { ...baseReq, enabledSkills: [] },
      { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) },
    );
    expect("plugins" in opts).toBe(false);
  });

  // ── 轮 4 卡 H2: 内置 WebSearch 放行 + 本地 shim 供货 ─────────────────────
  //
  // 卡 H 曾无条件禁掉内置 WebSearch，理由是它在 GLM/中转站上返回**空壳**且按
  // provider 分裂。那两条观测仍然成立，但结论被 smoke/websearch-nested-probe.mjs
  // 推翻：搜索动作是 CC 另发一次请求、由**上游端点实现 web_search 服务端工具**完成
  // 的，而那次请求发往我们自己能决定的 base URL。所以"分裂"不是内置工具的固有
  // 属性，而是"谁来供货"的问题 —— shim 供货之后每一家都拿到同一条链。
  //
  // 三态必须互斥，永远只有一条搜索路径（两条会让模型在两个工具间乱挑）。
  it("allows the built-in WebSearch when the toggle is on and the shim is up — no MCP alongside it", async () => {
    const opts = await captureOptions({ ...baseReq, webSearchEnabled: true });
    expect(opts.disallowedTools ?? []).not.toContain("WebSearch");
    // 承重：不能既放行内置又注册 MCP。两个搜索工具 = 模型猜谜。
    expect(Object.keys(opts.mcpServers ?? {})).not.toContain("leemo-web-search");
    expect(Object.keys(opts.mcpServers ?? {})).toContain("leemo-academic-search");
  });

  it("does NOT hand over any search tool when the toggle is off (prompt layer ⑦ says momo can't search — handing it the tool anyway is how you get 'let me search' followed by nothing)", async () => {
    const opts = await captureOptions({ ...baseReq, webSearchEnabled: false });
    expect(opts.disallowedTools).toEqual(expect.arrayContaining(["WebSearch"]));
    expect(Object.keys(opts.mcpServers ?? {})).not.toContain("leemo-web-search");
    expect(Object.keys(opts.mcpServers ?? {})).not.toContain("leemo-academic-search");
  });

  it("points the SDK child at the loopback shim, with a PLACEHOLDER token — the real key stops entering the child env", async () => {
    const opts = await captureOptions({ ...baseReq, webSearchEnabled: true });
    const env = opts.env as Record<string, string | undefined>;
    expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-search:deepseek");
    // 顺带的安全升级：原先直连接线把真 key 放进子进程 env（子进程能跑 bash）。
    expect(JSON.stringify(env)).not.toContain("test-key-secret");
  });

  it("keeps the original DIRECT wiring when the toggle is off (no shim started, real key as before)", async () => {
    const opts = await captureOptions({ ...baseReq, webSearchEnabled: false });
    const env = opts.env as Record<string, string | undefined>;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("test-key-secret");
  });

  // 轮 4 卡 H2: 内置 WebFetch 的域名预检要 GET api.anthropic.com，本机实测 403
  // （Cloudflare 拒，非缺 key）⇒ 国内直连必死。开关一置真整段预检跳过，抓取全程
  // 在本地。实测见 smoke/webfetch-preflight-probe.mjs（臂①复现、臂②③通，无代理）。
  it("switches WebFetch's claude.ai preflight OFF unconditionally — fetching a URL must not depend on reaching Anthropic", async () => {
    for (const webSearchEnabled of [true, false]) {
      const opts = await captureOptions({ ...baseReq, webSearchEnabled });
      expect(opts.settings).toMatchObject({ skipWebFetchPreflight: true });
      expect(opts.extraArgs).toBeUndefined();
    }
  });

  it("an OPENAI provider keeps the self-built MCP — it goes through the gateway, which STRIPS server tools", async () => {
    // 我自己引进又抓到的 bug：shim 是 host 级的，但 openai 家的对话走网关做协议
    // 翻译、根本不经过 shim；网关会把服务端工具剥掉 ⇒ 嵌套搜索请求退化成普通
    // 聊天，模型编一段当"搜索结果"。那正是台账里点名过的**空壳**。
    const { deps } = makeDeps((params) =>
      (async function* () {
        seen.push((params.options ?? {}) as Record<string, unknown>);
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const seen: Record<string, unknown>[] = [];
    const relay = {
      ...makeCatalog()[0]!,
      provider: {
        ...makeCatalog()[0]!.provider,
        id: "relay",
        apiFormat: "openai" as const,
        baseUrl: "https://relay.example/v1",
      },
      spec: { ...makeCatalog()[0]!.spec, id: "relay", apiFormat: "openai" as const },
    };
    const host = createBridgeHost({ ...deps, catalog: [relay] });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "relay",
      modelId: "deepseek-chat",
      webSearchEnabled: true,
      gatewayPort: 41234,
    } as never);
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));
    const opts = seen[0] ?? {};
    expect(opts.disallowedTools).toEqual(expect.arrayContaining(["WebSearch"]));
    expect(Object.keys((opts.mcpServers ?? {}) as object)).toContain("leemo-web-search");
    expect(Object.keys((opts.mcpServers ?? {}) as object)).toContain("leemo-academic-search");
  });

  it("lists the four Office capabilities as built-in and default-on when their runtime is ready", async () => {
    const { deps } = makeDeps();
    const officeSkills = officeRuntime({
      status: "ready",
      pluginPath: "C:\\Leemo\\runtime\\leemo-office",
      revision: "rev-1",
    });
    const host = createBridgeHost({
      ...deps,
      memoryDir: MEM,
      skillsIO: skillsIO(ONE_SKILL),
      officeSkills,
    });

    const office = (await host.handleInvoke("bridge:listSkills", undefined))
      .filter((skill) => skill.id?.startsWith("office-"));
    expect(office.map((skill) => skill.name)).toEqual([
      "Word 文档",
      "Excel 表格",
      "演示文稿",
      "PDF 文档",
    ]);
    expect(office.every((skill) => skill.available && skill.defaultEnabled)).toBe(true);
    expect(JSON.stringify(office)).not.toContain("C:\\Leemo\\runtime");
  });

  it("waits for automatic Office preparation and loads only the selected stable adapter skill", async () => {
    let state: OfficeSkillRuntimeSnapshot = { status: "preparing" };
    const ensureReady = vi.fn(async () => {
      state = {
        status: "ready",
        pluginPath: "C:\\Leemo\\runtime\\leemo-office",
        revision: "rev-2",
      };
      return state;
    });
    const officeSkills: OfficeSkillRuntime = {
      snapshot: () => ({ ...state }),
      ensureReady,
    };

    const opts = await captureOptions(
      { ...baseReq, enabledSkills: ["leemo-office:xlsx"] },
      { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL), officeSkills },
    );

    expect(ensureReady).toHaveBeenCalledTimes(1);
    expect(opts.plugins).toEqual([{
      type: "local",
      path: "C:\\Leemo\\runtime\\leemo-office",
    }]);
    expect(opts.skills).toEqual(["leemo-office:xlsx"]);
    expect(opts.settingSources).toEqual([]);
  });

  it("keeps chat usable and the Office cards honest when automatic preparation fails", async () => {
    const { deps } = makeDeps();
    const officeSkills = officeRuntime({ status: "error", error: "offline" });
    const host = createBridgeHost({
      ...deps,
      memoryDir: MEM,
      skillsIO: skillsIO(ONE_SKILL),
      officeSkills,
    });

    const office = (await host.handleInvoke("bridge:listSkills", undefined))
      .filter((skill) => skill.id?.startsWith("office-"));
    expect(office).toHaveLength(4);
    expect(office.every((skill) => skill.available === false)).toBe(true);

    const opts = await captureOptions(
      { ...baseReq, enabledSkills: ["leemo-office:xlsx"] },
      { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL), officeSkills },
    );
    expect("plugins" in opts).toBe(false);
    expect("skills" in opts).toBe(false);
  });

  it("starts a host-owned gateway when the renderer does not provide a port", async () => {
    let resolveEnv!: (env: Record<string, string>) => void;
    const envSeen = new Promise<Record<string, string>>((resolve) => { resolveEnv = resolve; });
    const { deps } = makeDeps((params) =>
      (async function* () {
        resolveEnv(((params.options ?? {}) as { env?: Record<string, string> }).env ?? {});
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const base = makeCatalog()[0]!;
    const relay = {
      ...base,
      provider: {
        ...base.provider,
        id: "relay-owned",
        apiFormat: "openai" as const,
        baseUrl: "https://relay.example/v1",
        envTemplate: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "relay-mini" },
      },
      spec: { ...base.spec, id: "relay-owned", apiFormat: "openai" as const },
    };
    const host = createBridgeHost({ ...deps, catalog: [relay] });

    try {
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: "relay-owned",
        modelId: "relay-main",
      });
      await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
      const env = await envSeen;

      expect(env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-gw:relay-owned");
      expect(env.ANTHROPIC_MODEL).toBe("relay-main");
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("relay-mini");
      await expect(fetch(`${env.ANTHROPIC_BASE_URL}/health`).then((response) => response.json()))
        .resolves.toEqual({ status: "ok" });
    } finally {
      host.dispose();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });

  it("keeps the ask MCP regardless — the search wiring must not clobber it", async () => {
    const on = await captureOptions({ ...baseReq, webSearchEnabled: true });
    const off = await captureOptions({ ...baseReq, webSearchEnabled: false });
    expect(Object.keys(on.mcpServers ?? {})).toContain("leemo-ask-user");
    expect(Object.keys(off.mcpServers ?? {})).toContain("leemo-ask-user");
  });

  it("keeps local document and visualization services reserved in every conversation", async () => {
    const opts = await captureOptions(baseReq, {
      providerStore: {
        read: () => ({
          version: 1,
          providers: {},
          mcpServers: {
            "leemo-documents": {
              name: "fake documents",
              transport: "stdio",
              command: "fake",
              args: [],
              env: {},
              enabled: true,
            },
            "leemo-visualization": {
              name: "fake visualization",
              transport: "stdio",
              command: "fake",
              args: [],
              env: {},
              enabled: true,
            },
          },
        }),
        write: () => {},
      },
    });
    expect(Object.keys(opts.mcpServers ?? {})).toContain("leemo-documents");
    expect((opts.mcpServers as Record<string, unknown>)["leemo-documents"]).toBeTruthy();
    expect(Object.keys(opts.mcpServers ?? {})).toContain("leemo-visualization");
    expect((opts.mcpServers as Record<string, { type?: string }>)["leemo-visualization"]?.type)
      .toBe("sdk");
  });

  it("gives every momo conversation the same structured English-learning ledger when available", async () => {
    const learningService = {
      getSnapshot: vi.fn(() => ({
        profile: null,
        dueItems: [],
        upcomingItems: [],
        recentSessions: [],
        baselines: [],
        evidence: [],
        summary: { totalItems: 0, dueItems: 0, recurringItems: 0, reviewedItems: 0, completedSessions: 0, hasBaseline: false },
      })),
      saveProfile: vi.fn(),
      recordMistake: vi.fn(),
      rateReview: vi.fn(),
      recordSession: vi.fn(),
    } satisfies NonNullable<HostDeps["learningService"]>;
    const opts = await captureOptions(baseReq, { learningService });

    expect(Object.keys(opts.mcpServers ?? {})).toContain("leemo-learning");
  });

  // ── 轮 4「三层开关」: WebFetch 从"无条件放行"改成"用户说了算" ──────────────
  //
  // 卡 H2 那条「WebFetch 永不禁用」的测试被本轮**故意**改掉了。它锁的是
  // 「抓一个已知 URL 是自建搜索替代不了的能力」，这个判断仍然成立 —— 变的是谁来
  // 决定：用户 7/27 要求「关闭后 momo 再也访问不了网页」。能力判断没错，把它写成
  // 用户改不了的默认才是错的。
  it("keeps WebFetch when the user leaves it on, and REALLY disables it when they switch it off (a toggle that only edits the prompt is a toggle that doesn't work)", async () => {
    const on = await captureOptions({ ...baseReq, webSearchEnabled: false, webFetchEnabled: true });
    const off = await captureOptions({ ...baseReq, webSearchEnabled: false, webFetchEnabled: false });
    expect(on.disallowedTools ?? []).not.toContain("WebFetch");
    expect(off.disallowedTools).toEqual(expect.arrayContaining(["WebFetch"]));
  });

  it("gates the two capabilities INDEPENDENTLY — all four combinations produce their own disallow list", async () => {
    const list = async (webSearchEnabled: boolean, webFetchEnabled: boolean) =>
      (await captureOptions({ ...baseReq, webSearchEnabled, webFetchEnabled })).disallowedTools ?? [];

    expect(await list(true, true)).toEqual([]);
    // 搜索开、抓取关：这一格是"独立"的证据 —— 只禁 WebFetch，WebSearch 仍放行。
    expect(await list(true, false)).toEqual(["WebFetch"]);
    expect(await list(false, true)).toEqual(["WebSearch"]);
    expect(await list(false, false)).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
  });

  it("an omitted webFetchEnabled keeps today's behaviour (allowed) — an older renderer must not silently lose a capability it had", async () => {
    const opts = await captureOptions({ ...baseReq, webSearchEnabled: false });
    expect(opts.disallowedTools ?? []).not.toContain("WebFetch");
  });

  it("tells momo about BOTH switches in prompt layer ⑦ — the structural gate above and the prompt must agree, or momo announces a fetch it cannot do", async () => {
    const fetchOff = await captureOptions({ ...baseReq, webSearchEnabled: true, webFetchEnabled: false });
    const prompt = JSON.stringify(fetchOff.systemPrompt ?? "");
    expect(prompt).toContain("Search: enabled");
    expect(prompt).toContain("Fetch: disabled");
  });

  it("omits `skills` too when everything is off (nothing left to filter)", async () => {
    const opts = await captureOptions(
      { ...baseReq, enabledSkills: [] },
      { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) },
    );
    expect("skills" in opts).toBe(false);
  });

  it("keeps the plugin loaded when at least one skill is enabled", async () => {
    // Partial case: the plugin must stay, or the enabled skills disappear too.
    const opts = await captureOptions(
      { ...baseReq, enabledSkills: ["leemo:pdf"] },
      { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) },
    );
    expect(opts.plugins).toEqual([{ type: "local", path: `${MEM}\\.leemo` }]);
    expect(opts.skills).toEqual(["leemo:pdf"]);
  });

  it("uses catalog defaults when the request carries no enabledSkills field", async () => {
    const opts = await captureOptions(baseReq, { memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) });
    // This fake cannot materialize managed built-ins, but user skills remain
    // available and default on. Omission means "use Leemo defaults", not
    // "silently bypass the skill catalog".
    expect(opts.skills).toEqual(["leemo:pdf"]);
  });

  it("applies a skill switch to every live conversation on its next round", async () => {
    const seen: Record<string, unknown>[] = [];
    const { deps, pushed } = makeDeps((params) => (async function* () {
      seen.push((params.options ?? {}) as Record<string, unknown>);
      yield { type: "result", subtype: "success", result: "ok", is_error: false };
    })() as never);
    const host = createBridgeHost({ ...deps, memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", baseReq);

    await host.handleInvoke("bridge:send", { conversationId, prompt: "first" });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.skills).toEqual(["leemo:pdf"]);
    await vi.waitFor(() => {
      expect(pushed.some((call) =>
        call.channel === "bridge:event"
        && (call.payload as { event?: { type?: string } }).event?.type === "run.finished"
      )).toBe(true);
    });

    await expect(host.handleInvoke("bridge:syncEnabledSkills", { enabledQualifiedNames: [] }))
      .resolves.toEqual({ updatedConversations: 1 });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "second" });
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect("skills" in seen[1]!).toBe(false);
    expect("plugins" in seen[1]!).toBe(false);
  });

  it("keeps the loaded skill plugin path out of momo's product-facing prompt", async () => {
    const captured: unknown[] = [];
    const { deps } = makeDeps((params) =>
      (async function* () {
        captured.push((params.options as Record<string, unknown>)?.systemPrompt);
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, memoryDir: MEM, skillsIO: skillsIO(ONE_SKILL) });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", baseReq);
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));
    const append = (captured[0] as { append: string }).append;
    expect(append).not.toContain(SKILLS);
    expect(append).not.toContain("SKILL.md");
    expect(append).not.toContain(".claude");
    expect(append).not.toContain(".leemo");
  });
});

describe("bridge-host — re-claiming a persisted conversation (轮 2 卡 C)", () => {
  /** A host whose fake SDK records the options of every round. */
  function makeRecordingHost() {
    const optionsSeen: Record<string, unknown>[] = [];
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        optionsSeen.push((params.options ?? {}) as Record<string, unknown>);
        yield { type: "result", subtype: "success", session_id: "sess-live", result: "ok", is_error: false };
      })() as never,
    );
    return { host: createBridgeHost(deps), optionsSeen, pushed };
  }

  it("adopts the requested conversationId instead of minting a new one", async () => {
    const { host } = makeRecordingHost();
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      conversationId: "cid-from-sqlite",
    });
    expect(conversationId).toBe("cid-from-sqlite");
  });

  it("makes bridge:send work for a re-claimed id — the exact restart bug", async () => {
    const { host } = makeRecordingHost();
    // Before this fix the renderer's hydrated cid hit `unknown conversation:`
    // and the message silently never left the app.
    await expect(
      host.handleInvoke("bridge:send", { conversationId: "cid-from-sqlite", prompt: "hi" }),
    ).rejects.toThrow(/unknown conversation/);

    await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      conversationId: "cid-from-sqlite",
    });
    await expect(
      host.handleInvoke("bridge:send", { conversationId: "cid-from-sqlite", prompt: "hi" }),
    ).resolves.toBeUndefined();
  });

  it("forwards resumeSessionId to the SDK as round 1's resume", async () => {
    const { host, optionsSeen } = makeRecordingHost();
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      conversationId: "cid-2",
      resumeSessionId: "sess-before-restart",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "记得我说的那个事实吗" });
    await new Promise((r) => setTimeout(r, 30));
    expect(optionsSeen[0]?.resume).toBe("sess-before-restart");
  });

  it("omits resume when no resumeSessionId is supplied (fresh conversation)", async () => {
    const { host, optionsSeen } = makeRecordingHost();
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 30));
    expect(optionsSeen[0]?.resume).toBeUndefined();
  });

  it("routes events, approvals and ask-user cards under the CLAIMED id", async () => {
    let canUseTool:
      | ((n: string, i: Record<string, unknown>, o: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>)
      | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        canUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof canUseTool;
        yield { type: "result", subtype: "success", session_id: "s", result: "ok", is_error: false };
      })() as never,
    );
    const host = createBridgeHost(deps);
    await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      conversationId: "claimed-cid",
    });
    await host.handleInvoke("bridge:send", { conversationId: "claimed-cid", prompt: "hi" });
    await new Promise((r) => setTimeout(r, 30));

    for (const e of pushed.filter((p) => p.channel === "bridge:event")) {
      expect((e.payload as { conversationId: string }).conversationId).toBe("claimed-cid");
    }
    void canUseTool!("Bash", { command: "echo interrupt-probe" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-c",
      requestId: "rq-c",
    });
    await new Promise((r) => setTimeout(r, 10));
    const approval = pushed.find((p) => p.channel === "bridge:approvalRequest");
    expect((approval!.payload as { conversationId: string }).conversationId).toBe("claimed-cid");

    // ask_user cards must be reachable through the claimed id too.
    expect(host.inspect("claimed-cid")).toBeDefined();
  });
});

describe("bridge-host", () => {
  it("listProviders returns specs without api key", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost(deps);
    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    expect(specs).toHaveLength(1);
    expect(JSON.stringify(specs)).not.toContain("test-key-secret");
  });

  it("createConversation returns a conversationId", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    expect(typeof conversationId).toBe("string");
    expect(conversationId.length).toBeGreaterThan(0);
  });

  it("createConversation throws for unknown provider", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost(deps);
    await expect(
      host.handleInvoke("bridge:createConversation", { providerId: "unknown", modelId: "x" })
    ).rejects.toThrow("unknown provider");
  });

  it("send fires events wrapped in BridgeEventEnvelope", async () => {
    const { deps, pushed } = makeDeps((_params) =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "hello", is_error: false, usage: { input_tokens: 1, output_tokens: 1 } };
      })() as never
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    // drain the microtask queue
    await new Promise((r) => setTimeout(r, 50));
    const events = pushed.filter((p) => p.channel === "bridge:event");
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect((e.payload as { conversationId: string }).conversationId).toBe(conversationId);
    }
  });

  it("rejects a racing second send without emitting events into the active first turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, pushed } = makeDeps(() =>
      (async function* () {
        await gate;
        yield { type: "result", subtype: "success", result: "first done", is_error: false };
      })() as never,
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    await host.handleInvoke("bridge:send", { conversationId, prompt: "first" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(
      host.handleInvoke("bridge:send", { conversationId, prompt: "racing second" }),
    ).rejects.toThrow("in progress");
    await new Promise((resolve) => setTimeout(resolve, 10));

    const eventsBeforeFirstFinishes = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string; message?: string; isError?: boolean } }).event);
    expect(eventsBeforeFirstFinishes.some((event) => event.type === "error")).toBe(false);
    expect(eventsBeforeFirstFinishes.some((event) => event.type === "run.finished")).toBe(false);

    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const eventsAfterFirstFinishes = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string; isError?: boolean } }).event);
    expect(eventsAfterFirstFinishes).toContainEqual(expect.objectContaining({
      type: "run.finished",
      isError: false,
    }));
  });

  it("aborts and closes a turn when a provider never produces progress after local init", async () => {
    let aborted = false;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "stalled-session" };
        const controller = (params.options as { abortController?: AbortController }).abortController;
        await new Promise<void>((_resolve, reject) => {
          controller?.signal.addEventListener("abort", () => {
            aborted = true;
            const error = new Error("aborted stalled provider");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      })() as never,
    );
    const host = createBridgeHost({ ...deps, firstProgressTimeoutMs: 25 });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    await host.handleInvoke("bridge:send", { conversationId, prompt: "will stall" });
    await vi.waitFor(() => {
      const events = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string; message?: string; isError?: boolean } }).event);
      expect(events).toContainEqual(expect.objectContaining({ type: "error", message: expect.stringContaining("没有返回") }));
      expect(events).toContainEqual(expect.objectContaining({ type: "run.finished", isError: true }));
    }, { timeout: 500 });
    expect(aborted).toBe(true);
  });

  it("reports a locked conversation when the first-progress timeout cannot confirm process termination", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "stalled-stop-failed" };
        const signal = (params.options as { abortController?: AbortController }).abortController?.signal;
        signal?.addEventListener("abort", () => {
          (signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] = false;
        }, { once: true });
        await gate;
      })() as never,
    );
    const host = createBridgeHost({ ...deps, firstProgressTimeoutMs: 25 });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    await host.handleInvoke("bridge:send", { conversationId, prompt: "will fail to stop" });
    await vi.waitFor(() => {
      const events = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string; message?: string } }).event);
      expect(events).toContainEqual(expect.objectContaining({
        type: "error",
        message: expect.stringContaining("此对话已锁定"),
      }));
      expect(events.some((event) => event.type === "run.finished")).toBe(false);
    }, { timeout: 500 });
    await expect(
      host.handleInvoke("bridge:send", { conversationId, prompt: "must remain locked" }),
    ).rejects.toThrow("in progress");
    release();
  });

  it("does not apply the first-progress deadline after real tool work has started", async () => {
    const { deps, pushed } = makeDeps((_params) =>
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "long-tool-session" };
        yield {
          type: "assistant",
          session_id: "long-tool-session",
          parent_tool_use_id: null,
          message: { content: [{ type: "tool_use", id: "tool-long", name: "Read", input: { file_path: "note.md" } }] },
        };
        await new Promise((resolve) => setTimeout(resolve, 60));
        yield { type: "result", subtype: "success", result: "done", is_error: false, session_id: "long-tool-session" };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, firstProgressTimeoutMs: 20 });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    await host.handleInvoke("bridge:send", { conversationId, prompt: "long tool" });
    await vi.waitFor(() => {
      const events = pushed
        .filter((entry) => entry.channel === "bridge:event")
        .map((entry) => (entry.payload as { event: { type: string; isError?: boolean } }).event);
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.started" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "run.finished", isError: false }));
    }, { timeout: 500 });
    const events = pushed
      .filter((entry) => entry.channel === "bridge:event")
      .map((entry) => (entry.payload as { event: { type: string } }).event);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("approval round-trip: canUseTool → approvalRequest push → approvalDecision → allow", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        // capture canUseTool from options
        capturedCanUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof capturedCanUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));
    expect(capturedCanUseTool).toBeDefined();

    // Trigger canUseTool — this will push an approvalRequest
    const decisionPromise = capturedCanUseTool!("Bash", { command: "echo round-trip" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-1",
      requestId: "rq-1",
    });

    await new Promise((r) => setTimeout(r, 10));
    const approvalPush = pushed.find((p) => p.channel === "bridge:approvalRequest");
    expect(approvalPush).toBeDefined();
    const reqId = (approvalPush!.payload as { id: string }).id;

    // Deliver the decision
    await host.handleInvoke("bridge:approvalDecision", { id: reqId, decision: "allow-once" });
    const result = await decisionPromise;
    expect((result as { behavior: string }).behavior).toBe("allow");
  });

  it("exposes the reserved work overview service to normal conversations but never wiki selection chats", async () => {
    const captureMcpNames = async (purpose?: "wiki") => {
      let names: string[] = [];
      let canUseTool: ((name: string, input: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>) | undefined;
      const { deps, pushed } = makeDeps((params) => (async function* () {
        const options = params.options as Record<string, unknown>;
        names = Object.keys((options.mcpServers ?? {}) as object);
        canUseTool = options.canUseTool as typeof canUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never);
      const host = createBridgeHost(deps);
      const { conversationId } = await host.handleInvoke("bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        ...(purpose ? { purpose } : {}),
      });
      await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const access = purpose ? undefined : await canUseTool!(
        "mcp__leemo-work-overview__set_work_overview",
        { focus: "PDF 阅读" },
        { signal: new AbortController().signal, toolUseID: "overview-1", requestId: "overview-1" },
      );
      host.dispose();
      return {
        names,
        access,
        approvalCount: pushed.filter((call) => call.channel === "bridge:approvalRequest").length,
      };
    };
    const normal = await captureMcpNames();
    const wiki = await captureMcpNames("wiki");

    expect(normal.names).toContain("leemo-work-overview");
    expect(normal.access).toEqual({ behavior: "allow" });
    expect(normal.approvalCount).toBe(0);
    expect(wiki.names).not.toContain("leemo-work-overview");
  });

  it("auto-denies an unanswered approval once after the configured timeout", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        capturedCanUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof capturedCanUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    deps.approvalTimeoutMs = 20;
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await vi.waitFor(() => expect(capturedCanUseTool).toBeDefined());

    const decisionPromise = capturedCanUseTool!("Bash", { command: "echo timeout" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-timeout",
      requestId: "rq-timeout",
    });

    const result = await decisionPromise as { behavior: string; message?: string };
    expect(result.behavior).toBe("deny");
    expect(result.message).toMatch(/timed out/i);
    const expired = pushed.filter((entry) => entry.channel === "bridge:approvalExpired");
    expect(expired).toEqual([{
      channel: "bridge:approvalExpired",
      payload: expect.objectContaining({ conversationId }),
    }]);
    const request = pushed.find((entry) => entry.channel === "bridge:approvalRequest")!.payload as { id: string };
    await host.handleInvoke("bridge:approvalDecision", { id: request.id, decision: "allow-once" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pushed.filter((entry) => entry.channel === "bridge:approvalExpired")).toHaveLength(1);
    host.dispose();
  });

  it("cancels the approval timeout after a manual decision", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        capturedCanUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof capturedCanUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    deps.approvalTimeoutMs = 100;
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await vi.waitFor(() => expect(capturedCanUseTool).toBeDefined());

    const decisionPromise = capturedCanUseTool!("Bash", { command: "echo allow" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-manual",
      requestId: "rq-manual",
    });
    await vi.waitFor(() => expect(pushed.some((entry) => entry.channel === "bridge:approvalRequest")).toBe(true));
    const request = pushed.find((entry) => entry.channel === "bridge:approvalRequest")!.payload as { id: string };
    await host.handleInvoke("bridge:approvalDecision", { id: request.id, decision: "allow-once" });

    await expect(decisionPromise).resolves.toMatchObject({ behavior: "allow" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(pushed.some((entry) => entry.channel === "bridge:approvalExpired")).toBe(false);
    host.dispose();
  });

  it("ask-user round-trip: inspect → handle → askUser push → askUserAnswer → resolves", async () => {
    const { deps, pushed } = makeDeps((_params) =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    const inner = host.inspect(conversationId);
    expect(inner).toBeDefined();

    const answerPromise = inner!.askMcp.handle({
      questions: [{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] }],
    });

    await new Promise((r) => setTimeout(r, 10));
    const askPush = pushed.find((p) => p.channel === "bridge:askUser");
    expect(askPush).toBeDefined();
    const askId = (askPush!.payload as { id: string }).id;

    await host.handleInvoke("bridge:askUserAnswer", {
      id: askId,
      items: [{ selected: ["A"] }],
    });

    const result = await answerPromise;
    expect(result.content[0].text).toContain("A");
  });

  it("deny path: approvalDecision deny → canUseTool returns deny", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        capturedCanUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof capturedCanUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    await new Promise((r) => setTimeout(r, 20));

    const decisionPromise = capturedCanUseTool!("Bash", { command: "rm -rf /" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-2",
      requestId: "rq-2",
    });
    await new Promise((r) => setTimeout(r, 10));
    const reqId = (pushed.find((p) => p.channel === "bridge:approvalRequest")!.payload as { id: string }).id;
    await host.handleInvoke("bridge:approvalDecision", { id: reqId, decision: "deny", message: "nope" });
    const result = await decisionPromise;
    expect((result as { behavior: string }).behavior).toBe("deny");
  });

  it("dispose: pending approval is denied, further send throws", async () => {
    let capturedCanUseTool: ((name: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        capturedCanUseTool = (params.options as Record<string, unknown>)?.canUseTool as typeof capturedCanUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never
    );
    const host = createBridgeHost(deps);
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "hi" });
    // Wait for drain to iterate the generator and capture canUseTool
    await new Promise((r) => setTimeout(r, 50));

    expect(capturedCanUseTool).toBeDefined();

    // Start canUseTool — it will register a waiter asynchronously
    const decisionPromise = capturedCanUseTool!("Bash", { command: "echo dispose" }, {
      signal: new AbortController().signal,
      toolUseID: "tu-3",
      requestId: "rq-3",
    });

    // Yield enough microtasks for the broker to register the waiter before teardown
    await new Promise((r) => setTimeout(r, 20));

    await host.handleInvoke("bridge:disposeConversation", { conversationId });
    const result = await decisionPromise;
    expect((result as { behavior: string }).behavior).toBe("deny");

    await expect(
      host.handleInvoke("bridge:send", { conversationId, prompt: "again" })
    ).rejects.toThrow();
    void pushed;
  });

  it("two conversations: approval id isolation", async () => {
    const canUseTools: Array<(name: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>> = [];
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        canUseTools.push((params.options as Record<string, unknown>)?.canUseTool as typeof canUseTools[0]);
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never
    );
    const host = createBridgeHost(deps);
    const { conversationId: cidA } = await host.handleInvoke("bridge:createConversation", { providerId: "deepseek", modelId: "deepseek-chat" });
    const { conversationId: cidB } = await host.handleInvoke("bridge:createConversation", { providerId: "deepseek", modelId: "deepseek-chat" });
    await host.handleInvoke("bridge:send", { conversationId: cidA, prompt: "a" });
    await host.handleInvoke("bridge:send", { conversationId: cidB, prompt: "b" });
    await new Promise((r) => setTimeout(r, 30));

    expect(canUseTools.length).toBeGreaterThanOrEqual(2);
    const promiseA = canUseTools[0]("Bash", { command: "echo a" }, { signal: new AbortController().signal, toolUseID: "tu-a", requestId: "rq-a" });
    const promiseB = canUseTools[1]("Bash", { command: "echo b" }, { signal: new AbortController().signal, toolUseID: "tu-b", requestId: "rq-b" });
    await new Promise((r) => setTimeout(r, 10));

    const reqs = pushed.filter((p) => p.channel === "bridge:approvalRequest");
    expect(reqs.length).toBeGreaterThanOrEqual(2);
    const idA = (reqs[0].payload as { id: string }).id;
    const idB = (reqs[1].payload as { id: string }).id;
    expect(idA).not.toBe(idB);

    // Resolve only A
    await host.handleInvoke("bridge:approvalDecision", { id: idA, decision: "allow-once" });
    const resultA = await promiseA;
    expect((resultA as { behavior: string }).behavior).toBe("allow");

    // B is still pending — resolve it
    await host.handleInvoke("bridge:approvalDecision", { id: idB, decision: "deny", message: "no" });
    const resultB = await promiseB;
    expect((resultB as { behavior: string }).behavior).toBe("deny");
  });

  it("does not persist a blanket grant for an unknown third-party MCP tool", async () => {
    const entries: { toolName: string; risk: "safe" | "moderate" | "dangerous" }[] = [];
    const approvalPersistence = {
      getWhitelist: () => entries.map((entry) => ({ ...entry })),
      addToWhitelist: (entry: (typeof entries)[number]) => {
        if (!entries.some((candidate) => candidate.toolName === entry.toolName && candidate.risk === entry.risk)) {
          entries.push({ ...entry });
        }
      },
      removeFromWhitelist: (entry: (typeof entries)[number]) => {
        const index = entries.findIndex((candidate) => candidate.toolName === entry.toolName && candidate.risk === entry.risk);
        if (index >= 0) entries.splice(index, 1);
      },
    };
    let canUseTool: ((name: string, input: Record<string, unknown>, options: { signal: AbortSignal; toolUseID: string; requestId: string }) => Promise<unknown>) | undefined;
    const { deps, pushed } = makeDeps((params) =>
      (async function* () {
        canUseTool = (params.options as Record<string, unknown>).canUseTool as typeof canUseTool;
        yield { type: "result", subtype: "success", result: "", is_error: false };
      })() as never,
    );
    const host = createBridgeHost({ ...deps, approvalPersistence });
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    await host.handleInvoke("bridge:send", { conversationId, prompt: "run the tests" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const permission = canUseTool!("mcp__demo__publish", { target: "draft" }, {
      signal: new AbortController().signal,
      toolUseID: "tool-1",
      requestId: "request-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const approval = pushed.find((event) => event.channel === "bridge:approvalRequest")?.payload as { id: string };
    await host.handleInvoke("bridge:approvalDecision", { id: approval.id, decision: "allow-permanent" });
    await permission;

    expect(await host.handleInvoke("bridge:listWhitelist", undefined)).toEqual([]);
  });

  it("returns the persisted usage summary for the requested window and provider", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost({
      ...deps,
      readUsageSummary: (query) => query.range === "last7d" && query.providerId === "alpha"
        ? {
            totalCostUsd: "0.120000",
            byProvider: [{ providerId: "alpha", costUsd: "0.120000", inputTokens: 10, outputTokens: 2 }],
            byDay: [{ date: "2026-07-29", costUsd: "0.120000" }],
          }
        : { byProvider: [] },
    });

    expect(await host.handleInvoke("bridge:usageSummary", { range: "last7d", providerId: "alpha" })).toEqual({
      totalCostUsd: "0.120000",
      byProvider: [{ providerId: "alpha", costUsd: "0.120000", inputTokens: 10, outputTokens: 2 }],
      byDay: [{ date: "2026-07-29", costUsd: "0.120000" }],
    });
  });

  it("unknown channel throws", async () => {
    const { deps } = makeDeps();
    const host = createBridgeHost(deps);
    await expect(
      host.handleInvoke("bridge:unknown" as keyof import("../../src/bridge/contract").BridgeInvokeMap, undefined as never)
    ).rejects.toThrow("unknown channel");
  });
});
