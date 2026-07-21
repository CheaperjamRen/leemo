import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../../src/bridge/pool";
import type { QueryParams, SdkMessageLike } from "../../src/bridge/pool";
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
      "sk-test-deepseek-DIRECTKEY-000000000000"
    );
    expect(env.ANTHROPIC_MODEL).toBe("deepseek-v4pro");
    expect(env.ANTHROPIC_API_KEY).toBe("");
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
    expect(env.ANTHROPIC_MODEL).toBe("claude-gpt-5.6-luna");

    // Sharp leak assertion: the real key sentinel appears in NO env value.
    const realKey = relay2Gateway.apiKey;
    for (const v of Object.values(env)) {
      if (typeof v === "string") expect(v).not.toContain(realKey);
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
});

// ---- dispose ---------------------------------------------------------------

describe("pool — dispose", () => {
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

    convo.setModel("deepseek-v4flash");
    await drain(convo.send("round 2"));
    expect(calls[1].options.env!.ANTHROPIC_MODEL).toBe("deepseek-v4flash");
    expect(calls[1].options.env!.CLAUDE_CODE_SUBAGENT_MODEL).toBe(
      "deepseek-v4flash"
    );
    // Round 1's captured env is untouched (no retroactive mutation).
    expect(calls[0].options.env!.ANTHROPIC_MODEL).toBe("deepseek-v4pro");
  });
});
