import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeemoEvent } from "../../src/bridge/events";
import type { QueryParams } from "../../src/bridge/pool";
import type { Provider } from "../../src/bridge/providers";
import type {
  CodexConversationConfig,
  CodexConversationHandle,
  CodexExecutionRuntime,
} from "../../src/host/codex-conversation";
import { runOneShotInference } from "../../src/host/one-shot-inference";

const tempRoots: string[] = [];

function tempRoot(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-one-shot-test-"));
  tempRoots.push(value);
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const subscriptionProvider: Provider = {
  id: "claude-subscription",
  name: "Claude 订阅",
  category: "official",
  apiFormat: "anthropic",
  authMode: "oauth-subscription",
  baseUrl: "",
  apiKey: "",
  models: ["claude-sonnet-4-6"],
  modelCapabilities: { "claude-sonnet-4-6": { thinking: true, vision: true } },
  envTemplate: {},
};

function clock(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function unusedFetch(): typeof fetch {
  return vi.fn(async () => { throw new Error("unexpected fetch"); }) as unknown as typeof fetch;
}

function runtimeWith(events: LeemoEvent[]) {
  const configs: CodexConversationConfig[] = [];
  let interrupted = 0;
  let disposed = 0;
  const handle: CodexConversationHandle = {
    id: "one-shot-handle",
    state: "idle",
    send: () => (async function* () {
      for (const event of events) yield event;
    })(),
    guide: async () => "applied",
    interrupt: async () => { interrupted += 1; return true; },
    setModel: () => {},
    setPermissionMode: () => {},
    setDeveloperInstructions: () => {},
    setNetworkCapabilities: () => {},
    dispose: () => { disposed += 1; },
  };
  const runtime: CodexExecutionRuntime = {
    createConversation(config) { configs.push(config); return handle; },
    dispose() {},
  };
  return { runtime, configs, interrupted: () => interrupted, disposed: () => disposed };
}

describe("runOneShotInference", () => {
  it("uses a direct provider once and returns truthful normalized usage", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: '{"items":[]}' }],
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 },
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await runOneShotInference({
      kind: "direct",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      target: {
        baseUrl: "https://api.example.test",
        apiKey: "test-secret",
        modelId: "deepseek-chat",
        apiFormat: "anthropic",
      },
    }, "Return JSON only.", {
      fetchFn,
      dataDir: tempRoot(),
      now: clock(100, 140),
      resolvePricing: () => ({ inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.5 }),
    });

    expect(result).toEqual({
      ok: true,
      text: '{"items":[]}',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 2,
        cacheCreationTokens: 0,
        durationMs: 40,
        costUsd: "0.000019",
        costSource: "local-pricing",
        tokensEstimated: false,
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("runs Claude in a fresh isolated no-tool, no-memory, one-turn session", async () => {
    const captured: QueryParams[] = [];
    const queryImpl = (params: QueryParams) => {
      captured.push(params);
      return (async function* () {
        yield { type: "system", subtype: "init", session_id: "one-shot-session" };
        yield {
          type: "result",
          subtype: "success",
          session_id: "one-shot-session",
          result: '{"items":[]}',
          is_error: false,
          usage: { input_tokens: 20, output_tokens: 5 },
          total_cost_usd: 0.002,
          duration_ms: 30,
        };
      })();
    };

    const root = tempRoot();
    const result = await runOneShotInference({
      kind: "claude-subscription",
      provider: subscriptionProvider,
      modelId: "claude-sonnet-4-6",
    }, "Return JSON only.", {
      fetchFn: unusedFetch(),
      dataDir: root,
      queryImpl: queryImpl as never,
      resolvePricing: () => undefined,
    });

    expect(result).toMatchObject({
      ok: true,
      text: '{"items":[]}',
      usage: { inputTokens: 20, outputTokens: 5, costUsd: "0.002000", costSource: "sdk" },
    });
    const options = captured[0].options as Record<string, unknown>;
    expect(options.tools).toEqual([]);
    expect(options.mcpServers).toEqual({});
    expect(options.skills).toEqual([]);
    expect(options.maxTurns).toBe(1);
    expect(options.settings).toEqual({ autoMemoryEnabled: false, autoDreamEnabled: false });
    expect(options.cwd).toEqual(expect.stringContaining("one-shot-"));
    expect(options.cwd).not.toContain("默认工作区");
    await expect((options.canUseTool as Function)("Read", {}, {})).resolves.toMatchObject({ behavior: "deny" });
    expect(fs.existsSync(options.cwd as string)).toBe(false);
  });

  it.each(["codex-subscription", "gemini-subscription"] as const)(
    "runs %s without web or dynamic tools and disposes the transient handle",
    async (kind) => {
      const fixture = runtimeWith([
        { type: "text.final", text: '{"items":[]}' },
        {
          type: "usage.final",
          usage: {
            providerId: kind,
            modelId: "model-1",
            inputTokens: 7,
            outputTokens: 3,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            durationMs: 18,
            costSource: "unpriced",
            tokensEstimated: false,
          },
        },
        { type: "run.finished", subtype: "completed", isError: false, finalText: '{"items":[]}', pathAudit: { claimed: [] } },
      ]);

      const result = await runOneShotInference({ kind, providerId: kind, modelId: "model-1" }, "json", {
        fetchFn: unusedFetch(),
        dataDir: tempRoot(),
        ...(kind === "codex-subscription" ? { codexRuntime: fixture.runtime } : { geminiRuntime: fixture.runtime }),
        resolvePricing: () => undefined,
      });

      expect(result).toMatchObject({ ok: true, text: '{"items":[]}' });
      expect(fixture.configs).toHaveLength(1);
      expect(fixture.configs[0]).toMatchObject({
        permissionMode: "plan",
        webSearchEnabled: false,
        webFetchEnabled: false,
      });
      expect(fixture.configs[0].dynamicTools).toBeUndefined();
      await expect(fixture.configs[0].approve?.({ kind: "tool", toolUseId: "x", toolName: "Read", input: {} })).resolves.toBe("decline");
      expect(fixture.disposed()).toBe(1);
    },
  );

  it("interrupts and discards a subscription result if any tool starts", async () => {
    const fixture = runtimeWith([
      { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false },
      { type: "text.final", text: '{"items":[{"title":"must discard"}]}' },
    ]);

    const result = await runOneShotInference({
      kind: "codex-subscription",
      providerId: "codex-subscription",
      modelId: "model-1",
    }, "json", {
      fetchFn: unusedFetch(),
      dataDir: tempRoot(),
      codexRuntime: fixture.runtime,
      resolvePricing: () => undefined,
    });

    expect(result).toEqual({
      ok: false,
      message: "梳理过程尝试了不需要的工具，本次结果已丢弃。",
      retryable: false,
    });
    expect(fixture.interrupted()).toBe(1);
    expect(fixture.disposed()).toBe(1);
  });

  it("classifies a direct network failure without exposing credentials", async () => {
    const result = await runOneShotInference({
      kind: "direct",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      target: {
        baseUrl: "https://api.example.test",
        apiKey: "never-leak-this",
        modelId: "deepseek-chat",
        apiFormat: "anthropic",
      },
    }, "json", {
      fetchFn: vi.fn(async () => { throw new TypeError("network failed for never-leak-this"); }) as unknown as typeof fetch,
      dataDir: tempRoot(),
      resolvePricing: () => undefined,
    });

    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain("never-leak-this");
  });
});
