import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createBridge,
  PROCESS_TREE_STOP_PROMISE_KEY,
  PROCESS_TREE_STOP_RESULT_KEY,
} from "../../src/bridge/pool";
import type { QueryFn, QueryParams, QueryStream, SdkMessageLike } from "../../src/bridge/pool";
import { deepseekDirect, relay2Gateway, glmDirect } from "./fixtures/providers";
import { oneTurnStream, type TestMsg } from "./fixtures/sdk-messages";

// B1 Step 2 — pool.ts lifecycle + dual-wiring + per-provider isolation.
//
// The pool owns per-conversation query() sessions. Every test injects a FAKE
// queryFn that CAPTURES the options it received, so assertions inspect the real
// wiring the pool built (env, resume, abortController) — not a mock echoing
// itself. Zero live SDK calls.

// ---- fake queryFn -----------------------------------------------------------

interface FakeCall {
  prompt: QueryParams["prompt"];
  options: NonNullable<QueryParams["options"]>;
}

interface FakeQuery {
  queryFn: (params: QueryParams) => AsyncIterable<SdkMessageLike>;
  calls: FakeCall[];
}

/** Build a fake queryFn.
 *  - `scripts[i]` = messages yielded on the i-th call (falls back to last).
 *  - `blockUntilAbortOnCall` = after yielding its script, that call awaits the
 *    injected abortController's signal, then returns (models an interruptible run). */
function makeFakeQuery(cfg: {
  scripts: TestMsg[][];
  blockUntilAbortOnCall?: number;
}): FakeQuery {
  const calls: FakeCall[] = [];
  const queryFn = async function* (
    params: QueryParams
  ): AsyncIterable<SdkMessageLike> {
    const idx = calls.length;
    calls.push({ prompt: params.prompt, options: params.options ?? {} });
    const script = cfg.scripts[idx] ?? cfg.scripts[cfg.scripts.length - 1] ?? [];
    for (const m of script) yield m;
    if (cfg.blockUntilAbortOnCall === idx) {
      const ac = params.options?.abortController;
      await new Promise<void>((resolve) => {
        if (!ac || ac.signal.aborted) return resolve();
        ac.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  };
  return { queryFn, calls };
}

async function drain(stream: AsyncIterable<SdkMessageLike>): Promise<SdkMessageLike[]> {
  const out: SdkMessageLike[] = [];
  for await (const m of stream) out.push(m);
  return out;
}

class AsyncTestQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.closed) return { value: undefined, done: true };
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

function persistentQueryFn(): {
  queryFn: QueryFn;
  calls: FakeCall[];
  output: AsyncTestQueue<SdkMessageLike>;
  close: ReturnType<typeof vi.fn>;
} {
  const calls: FakeCall[] = [];
  const output = new AsyncTestQueue<SdkMessageLike>();
  const closeQueue = output.close.bind(output);
  const close = vi.fn(() => closeQueue());
  const queryFn = Object.assign(((params: QueryParams): QueryStream => {
    calls.push({ prompt: params.prompt, options: params.options ?? {} });
    return Object.assign(output, {
      close,
      getContextUsage: vi.fn(async () => ({
        totalTokens: 42_000,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 21,
        model: "kimi-k3",
        isAutoCompactEnabled: true,
        autoCompactThreshold: 180_000,
      })),
    });
  }) as QueryFn, { supportsPersistentInput: true as const });
  return { queryFn, calls, output, close };
}

// ---- temp dataDir bookkeeping ----------------------------------------------

const tmpDirs: string[] = [];
function freshDataDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-b1-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

// ---- DIRECT wiring ----------------------------------------------------------

describe("pool — DIRECT wiring env reaches the SDK", () => {
  it("emits the SDK's exact context snapshot after the terminal result", async () => {
    const getContextUsage = vi.fn(async () => ({
      categories: [],
      totalTokens: 87_450,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      percentage: 43.725,
      gridRows: [],
      model: "kimi-k3",
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: true,
      autoCompactThreshold: 180_000,
    }));
    const queryFn = vi.fn(() => Object.assign((async function* () {
      yield* oneTurnStream("sess-context", "ok");
    })(), { getContextUsage }));
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });

    const messages = await drain(convo.send("hello"));

    expect(getContextUsage).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toMatchObject({
      type: "leemo_context_snapshot",
      session_id: "sess-context",
      contextUsage: expect.objectContaining({ totalTokens: 87_450, maxTokens: 200_000 }),
    });
  });

  it("keeps a completed round usable when exact context inspection is unavailable", async () => {
    const getContextUsage = vi.fn(async () => { throw new Error("unsupported"); });
    const queryFn = vi.fn(() => Object.assign((async function* () {
      yield* oneTurnStream("sess-context-fallback", "ok");
    })(), { getContextUsage }));
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });

    const messages = await drain(convo.send("hello"));

    expect(messages.map((message) => message.type)).toEqual(["system", "assistant", "result"]);
    expect(convo.state).toBe("idle");
  });

  it("keeps an explicit empty built-in tool list distinct from an omitted list", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-tools-empty", "ok"), oneTurnStream("sess-tools-default", "ok")],
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });

    await drain(convo.send("no tools", { tools: [] }));
    await drain(convo.send("defaults"));

    expect(calls[0].options).toHaveProperty("tools", []);
    expect("tools" in calls[1].options).toBe(false);
  });

  it("steers the active SDK query without starting a second round", async () => {
    const streamInput = vi.fn(async () => {});
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    const queryFn = vi.fn(() => Object.assign((async function* () {
      await done;
      yield { type: "result", session_id: "sess-steer" };
    })(), { streamInput }));
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });

    const running = drain(convo.send("先整理资料"));
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await expect(convo.guide("补充：先看第三章")).resolves.toBe("applied");
    expect(streamInput).toHaveBeenCalledTimes(1);
    release();
    await running;
  });

  it("hands queryFn the provider endpoint + real key + model aliases", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-d1", "hi from deepseek")],
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await drain(convo.send("hello"));

    const env = calls[0].options.env!;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(
      "test-key-deepseek-DIRECTKEY-000000000000"
    );
    expect(env.ANTHROPIC_MODEL).toBe("deepseek-v4pro");
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("caps native SDK reconnect attempts at the five attempts shown to users", async () => {
    vi.stubEnv("CLAUDE_CODE_MAX_RETRIES", "50");
    try {
      const { queryFn, calls } = makeFakeQuery({
        scripts: [oneTurnStream("sess-retry-cap", "x")],
      });
      const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
      const convo = bridge.createConversation({
        provider: deepseekDirect,
        modelId: "deepseek-v4pro",
      });

      await drain(convo.send("hi"));

      expect(calls[0].options.env!.CLAUDE_CODE_MAX_RETRIES).toBe("5");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---- GATEWAY wiring: no real key -------------------------------------------

describe("pool — GATEWAY wiring never leaks the real key", () => {
  it("sends placeholder token + loopback url, and NO env value is the real key", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-g1", "hi via gateway")],
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: relay2Gateway,
      modelId: "gpt-5.6-luna",
      gatewayPort: 61340,
    });
    await drain(convo.send("hello"));

    const env = calls[0].options.env!;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:61340");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-gw:relay2");
    expect(env.ANTHROPIC_MODEL).toBe("gpt-5.6-luna");

    // Sharp leak assertion: the real key sentinel appears in NO env value.
    const realKey = relay2Gateway.apiKey;
    for (const v of Object.values(env)) {
      if (typeof v === "string") expect(v).not.toContain(realKey);
    }
  });

  it("does NOT leak real keys that live in the HOST process.env (the real path)", async () => {
    // Production reality: the gateway reads RELAY2_API_KEY from process.env, and
    // the host may carry sibling-provider secrets. The SDK REPLACES the child
    // env, so the pool spreads process.env — which WOULD carry these keys into a
    // child that can printenv. This asserts the strip removes them.
    vi.stubEnv("RELAY2_API_KEY", "test-key-relay-HOST-LEAK-aaaaaaaaaaaa");
    vi.stubEnv("SOME_VENDOR_API_KEY", "test-key-vendor-HOST-LEAK-bbbbbbbb");
    vi.stubEnv("SIBLING_AUTH_TOKEN", "test-key-sibling-HOST-LEAK-cccccccc");
    try {
      const { queryFn, calls } = makeFakeQuery({
        scripts: [oneTurnStream("sess-g2", "x")],
      });
      const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
      const convo = bridge.createConversation({
        provider: relay2Gateway,
        modelId: "gpt-5.6-luna",
        gatewayPort: 61340,
      });
      await drain(convo.send("hi"));

      const env = calls[0].options.env!;
      expect(env.RELAY2_API_KEY).toBeUndefined();
      expect(env.SOME_VENDOR_API_KEY).toBeUndefined();
      expect(env.SIBLING_AUTH_TOKEN).toBeUndefined();
      // and no env VALUE contains any of the injected secrets
      const blob = JSON.stringify(env);
      expect(blob).not.toContain("HOST-LEAK");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("DIRECT wiring carries only THIS provider's key (via AUTH_TOKEN), not siblings' host keys", async () => {
    // deepseek is direct: its own key rides ANTHROPIC_AUTH_TOKEN (applied after
    // the strip). A sibling provider's key sitting in process.env must NOT ride
    // along.
    vi.stubEnv("GLM_API_KEY", "test-key-glm-SIBLING-HOST-dddddddddddd");
    vi.stubEnv("RELAY2_API_KEY", "test-key-relay-SIBLING-HOST-eeeeeeee");
    try {
      const { queryFn, calls } = makeFakeQuery({
        scripts: [oneTurnStream("sess-g3", "x")],
      });
      const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
      const convo = bridge.createConversation({
        provider: deepseekDirect,
        modelId: "deepseek-v4pro",
      });
      await drain(convo.send("hi"));

      const env = calls[0].options.env!;
      // own key present exactly once, on the AUTH_TOKEN channel
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe(deepseekDirect.apiKey);
      // sibling host keys stripped
      expect(env.GLM_API_KEY).toBeUndefined();
      expect(env.RELAY2_API_KEY).toBeUndefined();
      const blob = JSON.stringify(env);
      expect(blob).not.toContain("SIBLING-HOST");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---- CONFIG_DIR per-provider isolation + concurrency -----------------------

describe("pool — CLAUDE_CONFIG_DIR isolation per provider", () => {
  it("creates <dataDir>/providers/<id>/ on disk and points env at it", async () => {
    const dataDir = freshDataDir();
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-c1", "x")],
    });
    const bridge = createBridge({ queryFn, dataDir });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await drain(convo.send("hi"));

    const expectedDir = path.join(dataDir, "providers", "deepseek");
    expect(calls[0].options.env!.CLAUDE_CONFIG_DIR).toBe(expectedDir);
    expect(fs.existsSync(expectedDir)).toBe(true);
  });

  it("two concurrent conversations on DIFFERENT providers do NOT cross-talk", async () => {
    const dataDir = freshDataDir();
    // Distinct session ids so we can prove resume routes per-conversation.
    const { queryFn, calls } = makeFakeQuery({
      scripts: [
        oneTurnStream("sess-deepseek", "a1"), // call 0
        oneTurnStream("sess-glm", "b1"), // call 1
        oneTurnStream("sess-deepseek", "a2"), // call 2
        oneTurnStream("sess-glm", "b2"), // call 3
      ],
    });
    const bridge = createBridge({ queryFn, dataDir });
    const a = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    const b = bridge.createConversation({
      provider: glmDirect,
      modelId: "glm-5",
    });

    // First round on both, concurrently.
    await Promise.all([drain(a.send("a-1")), drain(b.send("b-1"))]);
    // Second round on both, concurrently.
    await Promise.all([drain(a.send("a-2")), drain(b.send("b-2"))]);

    const dirA = path.join(dataDir, "providers", "deepseek");
    const dirB = path.join(dataDir, "providers", "glm");
    // call 0 = A first, call 1 = B first, call 2 = A second, call 3 = B second
    expect(calls[0].options.env!.CLAUDE_CONFIG_DIR).toBe(dirA);
    expect(calls[1].options.env!.CLAUDE_CONFIG_DIR).toBe(dirB);
    expect(dirA).not.toBe(dirB);
    // A never resumes B's session and vice-versa.
    expect(calls[2].options.resume).toBe("sess-deepseek");
    expect(calls[3].options.resume).toBe("sess-glm");
    // A's env never carries GLM's key; B's never carries DeepSeek's.
    expect(calls[2].options.env!.ANTHROPIC_AUTH_TOKEN).toBe(deepseekDirect.apiKey);
    expect(calls[3].options.env!.ANTHROPIC_AUTH_TOKEN).toBe(glmDirect.apiKey);
  });

  it("two conversations on the SAME provider share the CONFIG_DIR (provider-grain isolation)", async () => {
    const dataDir = freshDataDir();
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("s1", "x"), oneTurnStream("s2", "y")],
    });
    const bridge = createBridge({ queryFn, dataDir });
    const c1 = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    const c2 = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await drain(c1.send("1"));
    await drain(c2.send("2"));
    const dir = path.join(dataDir, "providers", "deepseek");
    expect(calls[0].options.env!.CLAUDE_CONFIG_DIR).toBe(dir);
    expect(calls[1].options.env!.CLAUDE_CONFIG_DIR).toBe(dir);
  });
});

// ---- resume ----------------------------------------------------------------

describe("pool — resume", () => {
  it("omits resume on the first round, then carries the captured sessionId", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [
        oneTurnStream("sess-777", "first"),
        oneTurnStream("sess-777", "second"),
      ],
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await drain(convo.send("round 1"));
    await drain(convo.send("round 2"));

    expect(calls[0].options.resume).toBeUndefined();
    expect(calls[1].options.resume).toBe("sess-777");
  });
});

describe("pool — persistent SDK multi-turn transport", () => {
  function finishTurn(
    output: AsyncTestQueue<SdkMessageLike>,
    sessionId: string,
    cumulativeInput: number,
    cumulativeCost: number,
  ): void {
    output.push({
      type: "assistant",
      session_id: sessionId,
      message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    } as SdkMessageLike);
    output.push({
      type: "result",
      subtype: "success",
      session_id: sessionId,
      is_error: false,
      total_cost_usd: cumulativeCost,
      usage: { input_tokens: cumulativeInput, output_tokens: 5 },
      modelUsage: {
        "kimi-k3": {
          inputTokens: cumulativeInput,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: cumulativeCost,
          contextWindow: 200_000,
        },
      },
    } as SdkMessageLike);
    output.push({
      type: "system",
      subtype: "session_state_changed",
      state: "idle",
      session_id: sessionId,
    } as SdkMessageLike);
  }

  it("keeps one SDK query alive across user turns instead of respawning with resume", async () => {
    const { queryFn, calls, output } = persistentQueryFn();
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });

    const first = drain(convo.send("第一轮"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const input = calls[0].prompt as AsyncIterable<Record<string, unknown>>;
    const inputIterator = input[Symbol.asyncIterator]();
    await expect(inputIterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "user", message: { role: "user", content: "第一轮" } },
    });
    finishTurn(output, "sess-persistent", 100, 0.1);
    await first;

    const second = drain(convo.send("第二轮"));
    await expect(inputIterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: "user", message: { role: "user", content: "第二轮" } },
    });
    finishTurn(output, "sess-persistent", 160, 0.16);
    await second;

    expect(calls).toHaveLength(1);
    expect(calls[0].options.resume).toBeUndefined();
    bridge.dispose();
  });

  it("finishes a turn after a short grace period when a compatible runtime omits the idle state event", async () => {
    const { queryFn, calls, output } = persistentQueryFn();
    const bridge = createBridge({
      queryFn,
      dataDir: freshDataDir(),
      persistentTurnBoundaryGraceMs: 5,
    });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });

    const first = drain(convo.send("第一轮"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    output.push({
      type: "result",
      subtype: "success",
      session_id: "sess-without-idle",
      is_error: false,
      total_cost_usd: 0.1,
      modelUsage: {},
    } as SdkMessageLike);
    await first;
    expect(convo.state).toBe("idle");

    const second = drain(convo.send("第二轮"));
    output.push({
      type: "result",
      subtype: "success",
      session_id: "sess-without-idle",
      is_error: false,
      total_cost_usd: 0.2,
      modelUsage: {},
    } as SdkMessageLike);
    await second;

    expect(calls).toHaveLength(1);
    expect(convo.state).toBe("idle");
    bridge.dispose();
  });

  it("turns cumulative streaming modelUsage into this turn's billing delta", async () => {
    const { queryFn, calls, output } = persistentQueryFn();
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });

    const first = drain(convo.send("第一轮"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    finishTurn(output, "sess-usage", 100, 0.1);
    const firstMessages = await first;

    const second = drain(convo.send("第二轮"));
    finishTurn(output, "sess-usage", 160, 0.16);
    const secondMessages = await second;

    const firstResult = firstMessages.find((message) => message.type === "result") as Record<string, any>;
    const secondResult = secondMessages.find((message) => message.type === "result") as Record<string, any>;
    expect(firstResult.modelUsage["kimi-k3"].inputTokens).toBe(100);
    expect(secondResult.modelUsage["kimi-k3"].inputTokens).toBe(60);
    expect(secondResult.total_cost_usd).toBeCloseTo(0.06, 8);
    bridge.dispose();
  });

  it("routes active guidance through the held-open input queue without closing stdin", async () => {
    const { queryFn, calls, output } = persistentQueryFn();
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });

    const running = drain(convo.send("开始"));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const iterator = (calls[0].prompt as AsyncIterable<Record<string, any>>)[Symbol.asyncIterator]();
    await iterator.next();
    await expect(convo.guide("补充条件")).resolves.toBe("applied");
    await expect(iterator.next()).resolves.toMatchObject({
      value: { message: { content: "补充条件" }, priority: "now", shouldQuery: true },
    });
    finishTurn(output, "sess-guide", 100, 0.1);
    await running;
    bridge.dispose();
  });

  it("restarts the transport on a model change and resumes the captured session", async () => {
    const first = persistentQueryFn();
    const secondOutput = new AsyncTestQueue<SdkMessageLike>();
    const closeSecondQueue = secondOutput.close.bind(secondOutput);
    const secondClose = vi.fn(() => closeSecondQueue());
    const queryFn = Object.assign(((params: QueryParams): QueryStream => {
      if (first.calls.length === 0) return first.queryFn(params);
      first.calls.push({ prompt: params.prompt, options: params.options ?? {} });
      return Object.assign(secondOutput, { close: secondClose });
    }) as QueryFn, { supportsPersistentInput: true as const });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });

    const roundOne = drain(convo.send("第一轮"));
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));
    finishTurn(first.output, "sess-switch-live", 100, 0.1);
    await roundOne;

    convo.setModel(deepseekDirect, "kimi-k2.6");
    const roundTwo = drain(convo.send("第二轮"));
    await vi.waitFor(() => expect(first.calls).toHaveLength(2));
    finishTurn(secondOutput, "sess-switch-live", 30, 0.03);
    await roundTwo;

    expect(first.close).toHaveBeenCalledOnce();
    expect(first.calls[1].options.resume).toBe("sess-switch-live");
    expect(first.calls[1].options.env?.ANTHROPIC_MODEL).toBe("kimi-k2.6");
    bridge.dispose();
  });

  it("waits for the retired persistent process tree before starting a replacement", async () => {
    const first = persistentQueryFn();
    const secondOutput = new AsyncTestQueue<SdkMessageLike>();
    const queryFn = Object.assign(((params: QueryParams): QueryStream => {
      if (first.calls.length === 0) return first.queryFn(params);
      first.calls.push({ prompt: params.prompt, options: params.options ?? {} });
      return Object.assign(secondOutput, { close: vi.fn(() => secondOutput.close()) });
    }) as QueryFn, { supportsPersistentInput: true as const });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });
    const firstRound = drain(convo.send("one"));
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));
    const signal = first.calls[0].options.abortController!.signal;
    let releaseCleanup!: (stopped: boolean) => void;
    const cleanup = new Promise<boolean>((resolve) => { releaseCleanup = resolve; });
    signal.addEventListener("abort", () => {
      (signal as AbortSignal & { [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean> })
        [PROCESS_TREE_STOP_PROMISE_KEY] = cleanup;
    }, { once: true });
    finishTurn(first.output, "retire-session", 100, 0.1);
    await firstRound;

    convo.setModel(deepseekDirect, "kimi-k2.6");
    const secondRound = drain(convo.send("two"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(first.calls).toHaveLength(1);
    releaseCleanup(true);
    await vi.waitFor(() => expect(first.calls).toHaveLength(2));
    secondOutput.push({ type: "result", subtype: "success", session_id: "retire-session", is_error: false } as SdkMessageLike);
    secondOutput.push({ type: "system", subtype: "session_state_changed", state: "idle", session_id: "retire-session" } as SdkMessageLike);
    await secondRound;
  });

  it("does not start a replacement after Stop retires a round waiting on old cleanup", async () => {
    const first = persistentQueryFn();
    const secondOutput = new AsyncTestQueue<SdkMessageLike>();
    const queryFn = Object.assign(((params: QueryParams): QueryStream => {
      if (first.calls.length === 0) return first.queryFn(params);
      first.calls.push({ prompt: params.prompt, options: params.options ?? {} });
      return Object.assign(secondOutput, { close: vi.fn(() => secondOutput.close()) });
    }) as QueryFn, { supportsPersistentInput: true as const });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });
    const firstRound = drain(convo.send("one"));
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));

    const signal = first.calls[0].options.abortController!.signal;
    let releaseCleanup!: (stopped: boolean) => void;
    const cleanup = new Promise<boolean>((resolve) => { releaseCleanup = resolve; });
    signal.addEventListener("abort", () => {
      (signal as AbortSignal & { [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean> })
        [PROCESS_TREE_STOP_PROMISE_KEY] = cleanup;
    }, { once: true });
    finishTurn(first.output, "retire-stop-session", 100, 0.1);
    await firstRound;

    convo.setModel(deepseekDirect, "kimi-k2.6");
    const replacementRound = drain(convo.send("two"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(first.calls).toHaveLength(1);

    expect(convo.interrupt()).toBe(true);
    let stopSettled = false;
    const stopping = convo.waitForInterrupt!().then((stopped) => {
      stopSettled = true;
      return stopped;
    });
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    releaseCleanup(true);
    await expect(stopping).resolves.toBe(true);
    await replacementRound;
    expect(first.calls).toHaveLength(1);
    expect(convo.state).toBe("idle");
  });

  it("restarts on prompt/tool runtime invalidation without losing the session", async () => {
    const first = persistentQueryFn();
    const nextOutput = new AsyncTestQueue<SdkMessageLike>();
    const closeNextQueue = nextOutput.close.bind(nextOutput);
    const queryFn = Object.assign(((params: QueryParams): QueryStream => {
      if (first.calls.length === 0) return first.queryFn(params);
      first.calls.push({ prompt: params.prompt, options: params.options ?? {} });
      return Object.assign(nextOutput, { close: vi.fn(closeNextQueue) });
    }) as QueryFn, { supportsPersistentInput: true as const });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "kimi-k3" });

    const before = drain(convo.send("旧配置"));
    await vi.waitFor(() => expect(first.calls).toHaveLength(1));
    finishTurn(first.output, "sess-runtime", 100, 0.1);
    await before;

    convo.invalidateRuntime();
    const after = drain(convo.send("新配置"));
    await vi.waitFor(() => expect(first.calls).toHaveLength(2));
    finishTurn(nextOutput, "sess-runtime", 30, 0.03);
    await after;

    expect(first.close).toHaveBeenCalledOnce();
    expect(first.calls[1].options.resume).toBe("sess-runtime");
    bridge.dispose();
  });
});

// ---- interrupt -------------------------------------------------------------

describe("pool — interrupt aborts the active round", () => {
  it("interrupt() aborts the injected AbortController and ends the stream", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-int", "partial")],
      blockUntilAbortOnCall: 0, // call 0 hangs after its script until aborted
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });

    const it = convo.send("go")[Symbol.asyncIterator]();
    // Pull through the scripted messages until the generator blocks on abort.
    let last = await it.next();
    while (!last.done && (last.value as TestMsg).type !== "result") {
      last = await it.next();
    }
    // The next pull would hang forever unless interrupt() aborts.
    convo.interrupt();
    const after = await it.next();

    expect(after.done).toBe(true);
    expect(calls[0].options.abortController).toBeInstanceOf(AbortController);
    expect(calls[0].options.abortController!.signal.aborted).toBe(true);
  });

  it("a conversation can send again after an interrupt (new round)", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-r", "one"), oneTurnStream("sess-r", "two")],
      blockUntilAbortOnCall: 0,
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });

    const it = convo.send("first")[Symbol.asyncIterator]();
    let m = await it.next();
    while (!m.done && (m.value as TestMsg).type !== "result") m = await it.next();
    convo.interrupt();
    await it.next(); // unwinds to done

    // A brand-new round works and resumes the captured session.
    const second = await drain(convo.send("second"));
    expect(second.length).toBeGreaterThan(0);
    expect(calls[1].options.resume).toBe("sess-r");
  });

  it("is reusable immediately when an interrupted producer ignores abort, without late state or session clobber", async () => {
    let releaseOld!: () => void;
    let releaseNew!: () => void;
    let markOldStarted!: () => void;
    let markNewStarted!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
    const oldStarted = new Promise<void>((resolve) => { markOldStarted = resolve; });
    const newStarted = new Promise<void>((resolve) => { markNewStarted = resolve; });
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      const index = calls.length;
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      if (index === 0) {
        const messages = oneTurnStream("sess-old", "late old result");
        yield messages[0];
        markOldStarted();
        // Model a provider/SDK iterator that does not settle when aborted.
        await oldGate;
        for (const message of messages.slice(1)) yield message;
        return;
      }
      if (index === 1) {
        const messages = oneTurnStream("sess-new", "new result");
        yield messages[0];
        markNewStarted();
        await newGate;
        for (const message of messages.slice(1)) yield message;
        return;
      }
      for (const message of oneTurnStream("sess-new", "third result")) yield message;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });

    const oldDrain = drain(convo.send("first"));
    await oldStarted;
    convo.interrupt();
    expect(convo.state).toBe("idle");

    const newDrain = drain(convo.send("second"));
    await newStarted;
    expect(convo.state).toBe("running");

    releaseOld();
    await oldDrain;
    expect(convo.state).toBe("running");
    expect(() => convo.send("must still reject overlap")).toThrow("in progress");

    releaseNew();
    await newDrain;
    expect(convo.state).toBe("idle");
    await drain(convo.send("third"));
    expect(calls[2].options.resume).toBe("sess-new");
  });

  it("latches an unconfirmed process-tree stop so repeated Stop cannot unlock the conversation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      const signal = params.options?.abortController?.signal;
      signal?.addEventListener("abort", () => {
        (signal as AbortSignal & { [PROCESS_TREE_STOP_RESULT_KEY]?: boolean })[PROCESS_TREE_STOP_RESULT_KEY] = false;
      }, { once: true });
      yield { type: "system", subtype: "init", session_id: "stop-failed" } as SdkMessageLike;
      await gate;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    const iterator = convo.send("first")[Symbol.asyncIterator]();
    await iterator.next();

    expect(convo.interrupt()).toBe(false);
    expect(convo.state).toBe("running");
    expect(convo.interrupt()).toBe(false);
    expect(convo.state).toBe("running");
    expect(() => convo.send("must stay locked")).toThrow("unverified process-tree cleanup");

    release();
    await iterator.next();
    expect(convo.state).toBe("running");
  });

  it("keeps repeated Stop calls on the same asynchronous cleanup promise", async () => {
    let release!: (stopped: boolean) => void;
    const cleanup = new Promise<boolean>((resolve) => { release = resolve; });
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      const signal = params.options?.abortController?.signal;
      signal?.addEventListener("abort", () => {
        const state = signal as AbortSignal & {
          [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean>;
          [PROCESS_TREE_STOP_RESULT_KEY]?: boolean;
        };
        state[PROCESS_TREE_STOP_PROMISE_KEY] = cleanup;
        state[PROCESS_TREE_STOP_RESULT_KEY] = false;
      }, { once: true });
      yield { type: "system", subtype: "init", session_id: "stop-pending" } as SdkMessageLike;
      await new Promise(() => undefined);
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    const iterator = convo.send("first")[Symbol.asyncIterator]();
    await iterator.next();

    expect(convo.interrupt()).toBe(true);
    expect(convo.interrupt()).toBe(true);
    expect(convo.state).toBe("running");
    expect(() => convo.send("still locked")).toThrow("in progress");

    release(true);
    await expect(convo.waitForInterrupt?.()).resolves.toBe(true);
    expect(convo.state).toBe("idle");
  });
});

// ---- dispose ---------------------------------------------------------------

describe("pool — dispose", () => {
  it("aborts and verifies an idle warm persistent transport during disposal", async () => {
    const persistent = persistentQueryFn();
    const bridge = createBridge({ queryFn: persistent.queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    const round = drain(convo.send("one"));
    await vi.waitFor(() => expect(persistent.calls).toHaveLength(1));
    const signal = persistent.calls[0].options.abortController!.signal;
    let release!: (stopped: boolean) => void;
    const cleanup = new Promise<boolean>((resolve) => { release = resolve; });
    signal.addEventListener("abort", () => {
      (signal as AbortSignal & { [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean> })
        [PROCESS_TREE_STOP_PROMISE_KEY] = cleanup;
    }, { once: true });
    persistent.output.push({
      type: "result",
      subtype: "success",
      session_id: "warm-session",
      is_error: false,
      total_cost_usd: 0.1,
      usage: { input_tokens: 100, output_tokens: 5 },
    } as SdkMessageLike);
    persistent.output.push({
      type: "system",
      subtype: "session_state_changed",
      state: "idle",
      session_id: "warm-session",
    } as SdkMessageLike);
    await round;
    expect(convo.state).toBe("idle");

    convo.dispose();
    let settled = false;
    const pending = convo.waitForInterrupt?.().then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release(true);
    await expect(pending).resolves.toBe(true);
  });

  it("keeps the native cleanup promise observable during disposal", async () => {
    let release!: (stopped: boolean) => void;
    const cleanup = new Promise<boolean>((resolve) => { release = resolve; });
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      const signal = params.options?.abortController?.signal;
      signal?.addEventListener("abort", () => {
        (signal as AbortSignal & { [PROCESS_TREE_STOP_PROMISE_KEY]?: Promise<boolean> })
          [PROCESS_TREE_STOP_PROMISE_KEY] = cleanup;
      }, { once: true });
      yield { type: "system", subtype: "init", session_id: "dispose-pending" } as SdkMessageLike;
      await new Promise(() => undefined);
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    const iterator = convo.send("go")[Symbol.asyncIterator]();
    await iterator.next();

    convo.dispose();
    let settled = false;
    const pending = convo.waitForInterrupt?.().then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release(true);
    await expect(pending).resolves.toBe(true);
  });

  it("send() after dispose throws and state becomes 'disposed'", async () => {
    const { queryFn } = makeFakeQuery({ scripts: [oneTurnStream("s", "x")] });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    expect(convo.state).toBe("idle");
    await drain(convo.send("hi"));
    expect(convo.state).toBe("idle");

    convo.dispose();
    expect(convo.state).toBe("disposed");
    expect(() => convo.send("again")).toThrow(/dispos/i);
  });

  it("bridge.dispose() disposes every conversation it created", async () => {
    const { queryFn } = makeFakeQuery({ scripts: [oneTurnStream("s", "x")] });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const c1 = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    const c2 = bridge.createConversation({
      provider: glmDirect,
      modelId: "glm-5",
    });
    bridge.dispose();
    expect(c1.state).toBe("disposed");
    expect(c2.state).toBe("disposed");
    expect(() => c1.send("x")).toThrow(/dispos/i);
    expect(() => c2.send("x")).toThrow(/dispos/i);
  });

  it("state is 'running' mid-stream, and a mid-stream dispose is NOT clobbered back to idle", async () => {
    const { queryFn } = makeFakeQuery({
      scripts: [oneTurnStream("sess-mid", "x")],
      blockUntilAbortOnCall: 0, // hangs after its script until aborted
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });

    const it = convo.send("go")[Symbol.asyncIterator]();
    let m = await it.next();
    expect(convo.state).toBe("running"); // active round
    while (!m.done && (m.value as TestMsg).type !== "result") m = await it.next();
    expect(convo.state).toBe("running");

    convo.dispose(); // lands mid-stream; aborts the hung round
    const after = await it.next(); // stream unwinds; finally runs
    expect(after.done).toBe(true);
    // finally must NOT reset a disposed conversation back to idle.
    expect(convo.state).toBe("disposed");
  });
});

// ---- mid-conversation model change -----------------------------------------

describe("pool — mid-conversation model change takes effect next round", () => {
  it("setModel changes the model aliases on the NEXT send, not retroactively", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [
        oneTurnStream("sess-m", "pro answer"),
        oneTurnStream("sess-m", "flash answer"),
      ],
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await drain(convo.send("round 1"));
    expect(calls[0].options.env!.ANTHROPIC_MODEL).toBe("deepseek-v4pro");

    convo.setModel(deepseekDirect, "deepseek-v4flash");
    await drain(convo.send("round 2"));
    expect(calls[1].options.env!.ANTHROPIC_MODEL).toBe("deepseek-v4flash");
    expect(calls[1].options.env).not.toHaveProperty("CLAUDE_CODE_SUBAGENT_MODEL");
    // Round 1's captured env is untouched (no retroactive mutation).
    expect(calls[0].options.env!.ANTHROPIC_MODEL).toBe("deepseek-v4pro");
  });

  it("switches provider and model together while preserving the resume chain", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [
        oneTurnStream("sess-switch", "deepseek answer"),
        oneTurnStream("sess-switch", "glm answer"),
      ],
    });
    const dataDir = freshDataDir();
    const bridge = createBridge({ queryFn, dataDir });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    await drain(convo.send("round 1"));

    convo.setModel(glmDirect, "glm-4.7");
    await drain(convo.send("round 2"));

    expect(calls[1].options.env).toMatchObject({
      ANTHROPIC_BASE_URL: glmDirect.baseUrl,
      ANTHROPIC_AUTH_TOKEN: glmDirect.apiKey,
      ANTHROPIC_MODEL: "glm-4.7",
    });
    expect(calls[1].options.resume).toBe("sess-switch");
    expect(calls[1].options.env!.CLAUDE_CONFIG_DIR).toBe(
      path.join(dataDir, "providers", deepseekDirect.id),
    );
  });
});

// ---- sequential-turn guard -------------------------------------------------

describe("pool — concurrent send guard (sequential turns)", () => {
  it("send() while a round is in progress throws, so currentAbort can't be clobbered", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-seq", "x")],
      blockUntilAbortOnCall: 0, // first round stays active until aborted
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });

    const first = convo.send("one");
    expect(convo.state).toBe("running"); // running eagerly at send()
    // A second send while running is rejected — the first round's abort survives.
    expect(() => convo.send("two")).toThrow(/in progress|running/i);

    // Start consuming the first round (registers the queryFn call), then prove
    // the second send never reached queryFn: only one call total.
    const it = first[Symbol.asyncIterator]();
    await it.next(); // pull the init message; call 0 now recorded
    expect(calls.length).toBe(1);

    // The first round's controller is still the live one; interrupt cancels it.
    convo.interrupt();
    let m = await it.next();
    while (!m.done) m = await it.next();
    expect(calls.length).toBe(1);
    expect(calls[0].options.abortController!.signal.aborted).toBe(true);
  });
});

// ---- mid-stream queryFn throw ----------------------------------------------

describe("pool — queryFn error propagation", () => {
  it("propagates a mid-stream throw and resets state to idle", async () => {
    const boom = new Error("upstream exploded mid-stream");
    const queryFn = async function* (): AsyncIterable<SdkMessageLike> {
      yield { type: "system", session_id: "sess-boom" };
      throw boom;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await expect(drain(convo.send("go"))).rejects.toThrow(
      "upstream exploded mid-stream"
    );
    // finally ran despite the throw → conversation is reusable.
    expect(convo.state).toBe("idle");
  });
});

// ---- 轮 2 卡 C: caller-supplied id + resume start point ----------------------
//
// A conversation id is minted by the host and stored in SQLite by the renderer,
// but the host's Map is pure memory: after a restart the renderer holds ids no
// live Conversation answers to. The fix lets the host RE-CLAIM a persisted id
// and hand the pool the persisted session id as the round-1 resume start.

describe("pool — caller-supplied conversation id (卡 C)", () => {
  it("adopts cfg.id verbatim instead of minting a new uuid", () => {
    const { queryFn } = makeFakeQuery({ scripts: [oneTurnStream("s", "x")] });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      id: "persisted-cid-42",
    });
    expect(convo.id).toBe("persisted-cid-42");
  });

  it("still mints a uuid when cfg.id is omitted (unchanged default)", () => {
    const { queryFn } = makeFakeQuery({ scripts: [oneTurnStream("s", "x")] });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const a = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    const b = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("pool — cfg.resume seeds round 1 (卡 C)", () => {
  it("carries cfg.resume on the FIRST round, then the newly captured session", async () => {
    const { queryFn, calls } = makeFakeQuery({
      scripts: [oneTurnStream("sess-new", "one"), oneTurnStream("sess-new", "two")],
    });
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-from-sqlite",
    });
    await drain(convo.send("round 1"));
    await drain(convo.send("round 2"));

    expect(calls[0].options.resume).toBe("sess-from-sqlite");
    expect(calls[1].options.resume).toBe("sess-new");
  });
});

// ---- resume degradation (卡 C §7) ------------------------------------------
//
// The session transcript can be gone (cleared workspace, pruned by the SDK).
// A claimed conversation's FIRST round must then degrade to a fresh session
// rather than leave the user unable to send. The retry is only legal when the
// failing round emitted NOTHING — a mid-stream retry would re-execute tools.

describe("pool — resume failure degrades instead of killing the chat", () => {
  /** queryFn that rejects ONE specific (stale) session id before emitting
   *  anything, and otherwise plays a normal stream. Models the real SDK failure
   *  when the resumed transcript no longer exists on disk. */
  function makeResumeRejectingQuery(staleSessionId: string, script: TestMsg[]) {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      if (params.options?.resume === staleSessionId) {
        throw new Error(`No conversation found with session ID: ${staleSessionId}`);
      }
      for (const m of script) yield m;
    };
    return { queryFn, calls };
  }

  it("retries once WITHOUT resume when round 1 of a claimed conversation fails before emitting anything", async () => {
    const { queryFn, calls } = makeResumeRejectingQuery("sess-that-no-longer-exists", oneTurnStream("sess-fresh", "hi again"));
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-that-no-longer-exists",
    });

    const msgs = await drain(convo.send("still there?"));

    expect(calls).toHaveLength(2);
    expect(calls[0].options.resume).toBe("sess-that-no-longer-exists");
    expect(calls[1].options.resume).toBeUndefined();
    // The user's message still went through — amnesia beats a dead send button.
    expect(msgs.map((m) => m.type)).toContain("result");
    expect(convo.state).toBe("idle");
  });

  it("carries the RETRY's session id into the next round", async () => {
    const { queryFn, calls } = makeResumeRejectingQuery("sess-gone", oneTurnStream("sess-fresh", "x"));
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-gone",
    });
    await drain(convo.send("one"));
    await drain(convo.send("two"));
    expect(calls[2].options.resume).toBe("sess-fresh");
  });

  it("does NOT retry when the round already emitted an event (tools must not re-run)", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      yield { type: "system", subtype: "init", session_id: "sess-partial" } as TestMsg;
      throw new Error("died after the tool already ran");
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-old",
    });
    await expect(drain(convo.send("go"))).rejects.toThrow("died after the tool already ran");
    expect(calls).toHaveLength(1);
    expect(convo.state).toBe("idle");
  });

  it("does NOT retry a conversation that was never claimed (no cfg.resume)", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      throw new Error("upstream down");
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
    });
    await expect(drain(convo.send("go"))).rejects.toThrow("upstream down");
    expect(calls).toHaveLength(1);
  });

  it("does NOT retry on round 2+, even after a claimed round 1 (the grant is one-shot)", async () => {
    let call = 0;
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      if (call++ === 0) {
        for (const m of oneTurnStream("sess-live", "ok")) yield m;
        return;
      }
      throw new Error("round 2 upstream failure");
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-old",
    });
    await drain(convo.send("one"));
    await expect(drain(convo.send("two"))).rejects.toThrow("round 2 upstream failure");
    expect(calls).toHaveLength(2);
  });

  it("does NOT retry when the failure came from the user interrupting", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      const ac = params.options?.abortController;
      await new Promise<void>((resolve) => {
        if (!ac || ac.signal.aborted) return resolve();
        ac.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("AbortError");
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-old",
    });
    const it = convo.send("go")[Symbol.asyncIterator]();
    const pull = it.next();
    await new Promise((r) => setTimeout(r, 5));
    convo.interrupt();
    await expect(pull).rejects.toThrow("AbortError");
    // A user-initiated abort must not silently start a second, session-less run.
    expect(calls).toHaveLength(1);
  });

  // ── The shape the REAL SDK actually produces ──────────────────────────────
  //
  // Probed live against DeepSeek with a bogus resume id (.leemo-workspace probe,
  // see r2-c report): the stream does NOT throw before emitting. It yields ONE
  // message — result / error_during_execution, "No conversation found with
  // session ID: <id>" — and only then throws. A literal "failed before emitting
  // anything" rule therefore never fires in production, which would leave the
  // whole degradation path dead and the user unable to send.
  //
  // The invariant that actually matters is "nothing happened yet", not "no
  // message arrived": a terminal error result is not an effect. Any message
  // that is NOT an immediate error result (system:init, an assistant turn, a
  // tool_use…) proves the round is live and permanently disarms the retry, so a
  // round that ran tools can still never be replayed.
  it("degrades on the REAL failure shape: an immediate error result, then a throw", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      if (params.options?.resume === "sess-gone") {
        yield {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "No conversation found with session ID: sess-gone",
        } as TestMsg;
        throw new Error("Claude Code returned an error result: No conversation found with session ID: sess-gone");
      }
      for (const m of oneTurnStream("sess-fresh", "hi again")) yield m;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-gone",
    });

    const msgs = await drain(convo.send("还记得吗"));

    expect(calls).toHaveLength(2);
    expect(calls[1].options.resume).toBeUndefined();
    // The dead round's error result must NOT reach the renderer, or the user
    // sees a red error card followed by the real answer.
    expect(msgs.some((m) => (m as TestMsg).is_error === true)).toBe(false);
    expect(msgs.map((m) => m.type)).toEqual(["system", "assistant", "result"]);
  });

  it("degrades when the dead round ENDS cleanly after its error result (no throw)", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      if (params.options?.resume === "sess-gone") {
        yield { type: "result", subtype: "error_during_execution", is_error: true, result: "No conversation found" } as TestMsg;
        return;
      }
      for (const m of oneTurnStream("sess-fresh", "ok")) yield m;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect, modelId: "deepseek-v4pro", resume: "sess-gone",
    });
    const msgs = await drain(convo.send("hi"));
    expect(calls).toHaveLength(2);
    expect(msgs.some((m) => (m as TestMsg).is_error === true)).toBe(false);
  });

  it("passes an error result straight through for a conversation that was never claimed", async () => {
    // No degrade grant → no buffering, no swallowing: unchanged behaviour for
    // every ordinary round in the app.
    const queryFn = async function* (): AsyncIterable<SdkMessageLike> {
      yield { type: "result", subtype: "error_during_execution", is_error: true, result: "upstream 500" } as TestMsg;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({ provider: deepseekDirect, modelId: "deepseek-v4pro" });
    const msgs = await drain(convo.send("hi"));
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as TestMsg).is_error).toBe(true);
  });

  it("does not replay a reclaimed turn when the provider returns a terminal 400", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result: "服务商返回错误（400）。请检查模型配置。",
      } as TestMsg;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-still-present",
    });

    const msgs = await drain(convo.send("继续"));

    expect(calls).toHaveLength(1);
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as TestMsg).is_error).toBe(true);
  });

  it("does NOT swallow an error result that arrives AFTER the round did real work", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      yield { type: "system", subtype: "init", session_id: "sess-live" } as TestMsg;
      yield {
        type: "assistant",
        session_id: "sess-live",
        message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Write", input: {} }] },
      } as TestMsg;
      yield { type: "result", subtype: "error_during_execution", is_error: true, result: "died late" } as TestMsg;
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect, modelId: "deepseek-v4pro", resume: "sess-old",
    });
    const msgs = await drain(convo.send("go"));
    // A tool already ran: replaying the prompt would run it twice.
    expect(calls).toHaveLength(1);
    expect(msgs.map((m) => m.type)).toEqual(["system", "assistant", "result"]);
    expect((msgs[2] as TestMsg).is_error).toBe(true);
  });

  it("does not replay an unrecognized pre-output failure from a reclaimed conversation", async () => {
    const calls: FakeCall[] = [];
    const queryFn = async function* (params: QueryParams): AsyncIterable<SdkMessageLike> {
      calls.push({ prompt: params.prompt, options: params.options ?? {} });
      throw new Error("endpoint is simply down");
    };
    const bridge = createBridge({ queryFn, dataDir: freshDataDir() });
    const convo = bridge.createConversation({
      provider: deepseekDirect,
      modelId: "deepseek-v4pro",
      resume: "sess-old",
    });
    await expect(drain(convo.send("go"))).rejects.toThrow("endpoint is simply down");
    expect(calls).toHaveLength(1);
    expect(convo.state).toBe("idle");
  });
});
