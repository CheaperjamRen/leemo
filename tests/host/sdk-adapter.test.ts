import { describe, it, expect, vi } from "vitest";
import { buildQueryFn } from "../../src/host/sdk-adapter";
import type { QueryParams } from "../../src/bridge/pool";

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

function makeExtras() {
  return {
    cwd: "/sandbox",
    canUseTool: vi.fn(),
    mcpServers: { "leemo-ask-user": {} as unknown as McpServerConfig },
    maxTurns: 10,
  };
}

describe("buildQueryFn", () => {
  it("declares support for the pool's held-open multi-turn input contract", () => {
    const fakeQuery = () => (async function* () {})();
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    expect(qfn.supportsPersistentInput).toBe(true);
  });
  it("passes through options.env unchanged", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    const env = { ANTHROPIC_AUTH_TOKEN: "test-key-abc", PATH: "/usr/bin" };
    const abort = new AbortController();
    await qfn({ prompt: "hello", options: { env, abortController: abort } })[Symbol.asyncIterator]().next();
    expect(captured[0].options?.env).toBe(env);
  });

  it("passes through options.abortController unchanged", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    const abort = new AbortController();
    await qfn({ prompt: "hi", options: { abortController: abort } })[Symbol.asyncIterator]().next();
    expect(captured[0].options?.abortController).toBe(abort);
  });

  it("installs a round-scoped Claude process spawner so abort can terminate the whole tool tree", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    const abort = new AbortController();

    await qfn({ prompt: "hi", options: { abortController: abort } })[Symbol.asyncIterator]().next();

    const opts = captured[0].options as Record<string, unknown>;
    expect(opts.spawnClaudeCodeProcess).toEqual(expect.any(Function));
  });

  it("passes through options.resume unchanged", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    await qfn({ prompt: "hi", options: { resume: "sess-123" } })[Symbol.asyncIterator]().next();
    expect((captured[0].options as Record<string, unknown>)?.resume).toBe("sess-123");
  });

  it("forwards tools:[] as an explicit empty SDK built-in tool set", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);

    await qfn({ prompt: "json only", options: { tools: [] } })[Symbol.asyncIterator]().next();
    await qfn({ prompt: "ordinary" })[Symbol.asyncIterator]().next();

    expect(captured[0].options).toHaveProperty("tools", []);
    expect("tools" in (captured[1].options ?? {})).toBe(false);
  });

  it("overlays cwd, permissionMode, streaming, subagent forwarding, settingSources, maxTurns", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    const opts = captured[0].options as Record<string, unknown>;
    expect(opts.cwd).toBe("/sandbox");
    expect(opts.permissionMode).toBe("default");
    expect(opts.includePartialMessages).toBe(true);
    expect(opts.forwardSubagentText).toBe(true);
    expect(opts.settingSources).toEqual([]);
    expect(opts.maxTurns).toBe(10);
  });

  it("defaults maxTurns to 50 when not provided", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = { cwd: "/s", canUseTool: vi.fn(), mcpServers: {} };
    const qfn = buildQueryFn(extras, fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect((captured[0].options as Record<string, unknown>).maxTurns).toBe(50);
  });

  it("passes plan mode to the SDK so its native read-only guard is active", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const qfn = buildQueryFn({ ...makeExtras(), permissionMode: "plan" }, fakeQuery as never);
    await qfn({ prompt: "plan this" })[Symbol.asyncIterator]().next();

    const opts = captured[0].options as Record<string, unknown>;
    expect(opts.permissionMode).toBe("plan");
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it.each(["acceptEdits", "bypassPermissions"] as const)(
    "keeps %s UX in Leemo's broker while the SDK stays in callback-enforced mode",
    async (permissionMode) => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const qfn = buildQueryFn({ ...makeExtras(), permissionMode }, fakeQuery as never);
    await qfn({ prompt: "run" })[Symbol.asyncIterator]().next();

    const opts = captured[0].options as Record<string, unknown>;
    expect(opts.permissionMode).toBe("default");
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    },
  );

  it("wraps string prompt into AsyncIterable with user message shape", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    await qfn({ prompt: "hello world" })[Symbol.asyncIterator]().next();
    const prompt = captured[0].prompt;
    expect(typeof prompt).not.toBe("string");
    const items: unknown[] = [];
    for await (const item of prompt as AsyncIterable<unknown>) items.push(item);
    expect(items).toHaveLength(1);
    expect((items[0] as Record<string, unknown>).type).toBe("user");
  });

  it("passes AsyncIterable prompt through unchanged", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    const iter = (async function* () { yield { type: "user" }; })();
    await qfn({ prompt: iter })[Symbol.asyncIterator]().next();
    expect(captured[0].prompt).toBe(iter);
  });

  it("passes canUseTool and mcpServers to queryImpl", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const extras = makeExtras();
    const qfn = buildQueryFn(extras, fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    const opts = captured[0].options as Record<string, unknown>;
    expect(opts.canUseTool).toBe(extras.canUseTool);
    expect(opts.mcpServers).toEqual(extras.mcpServers);
    expect(opts.mcpServers).not.toBe(extras.mcpServers);
  });

  it("passes host governance hooks to the SDK", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const preToolUse = vi.fn(async () => ({ continue: true }));
    const hooks = { PreToolUse: [{ hooks: [preToolUse] }] };
    const qfn = buildQueryFn({ ...makeExtras(), hooks }, fakeQuery as never);

    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();

    expect((captured[0].options as Record<string, unknown>).hooks).toBe(hooks);
  });

  it("wraps systemPromptAppend as a claude_code preset APPEND, not a replacement (06 §7.2)", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const qfn = buildQueryFn({ ...makeExtras(), systemPromptAppend: "You are momo." }, fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    // A bare string would REPLACE the claude_code preset (sdk.d.ts: "Custom
    // prompt"), throwing away CC's tool-use and workflow scaffolding. 06 §7.2
    // specifies the preset+append form, so momo's persona layers on top of it.
    // `options` is typed as the pool's narrow inbound QueryOptions; the adapter
    // overlays the SDK-only fields on the way out, hence the cast (same idiom
    // as the cwd/settingSources assertions above).
    expect((captured[0].options as Record<string, unknown>).systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "You are momo.",
    });
  });

  it("omits systemPrompt entirely when no append text is supplied", async () => {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect("systemPrompt" in (captured[0].options ?? {})).toBe(false);
  });
});

describe("buildQueryFn — in-memory settings (WebFetch + native memory)", () => {
  function capture() {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    return { captured, fakeQuery };
  }
  const optsOf = (p: QueryParams) => p.options as Record<string, unknown>;

  it("forwards cliSettings through the SDK settings object", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      { ...makeExtras(), cliSettings: { skipWebFetchPreflight: true } },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).settings).toEqual({ skipWebFetchPreflight: true });
    expect(optsOf(captured[0]).extraArgs).toBeUndefined();
  });

  it("omits settings entirely when neither app nor native settings are supplied", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect("settings" in (captured[0].options ?? {})).toBe(false);
  });

  it("keeps settingSources:[] — the flag tier is independent of filesystem sources", async () => {
    // 这条是防回归：如果哪天有人以为"要让 --settings 生效必须放开
    // settingSources"，卡 A 的隔离面（方案 C）就被推翻了。实测两者独立。
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      { ...makeExtras(), cliSettings: { skipWebFetchPreflight: true } },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).settingSources).toEqual([]);
  });

  it("merges native auto-memory into the same flag-tier settings without env shims", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      {
        ...makeExtras(),
        cliSettings: { skipWebFetchPreflight: true },
        autoMemoryEnabled: true,
        autoMemoryDirectory: "C:\\AppData\\Leemo\\native-memory\\round-1",
        autoDreamEnabled: false,
      },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi", options: { env: { PATH: "C:\\Windows" } } })[Symbol.asyncIterator]().next();

    expect(optsOf(captured[0]).settings).toEqual({
      skipWebFetchPreflight: true,
      autoMemoryEnabled: true,
      autoMemoryDirectory: "C:\\AppData\\Leemo\\native-memory\\round-1",
      autoDreamEnabled: false,
    });
    expect((optsOf(captured[0]).env as Record<string, string>).CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBeUndefined();
  });

  it("passes an explicit disabled state and never starts background consolidation", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      { ...makeExtras(), autoMemoryEnabled: false, autoDreamEnabled: false },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).settings).toEqual({
      autoMemoryEnabled: false,
      autoDreamEnabled: false,
    });
  });
});

describe("buildQueryFn — skills via local plugin (轮 2 卡 E, 方案 G)", () => {
  function capture() {
    const captured: QueryParams[] = [];
    const fakeQuery = (p: QueryParams) => { captured.push(p); return (async function* () {})(); };
    return { captured, fakeQuery };
  }
  const optsOf = (p: QueryParams) => p.options as Record<string, unknown>;

  it("passes pluginPath as a local plugin entry", async () => {
    // 实测: `plugins` is the ONLY discovery path that works with
    // settingSources:[] — CLAUDE_CONFIG_DIR placements (D/E) all failed, and
    // omitting settingSources (C) dragged the user's 42 personal skills in.
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      { ...makeExtras(), pluginPath: "C:\\Users\\Rengar\\Leemo\\.claude" },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).plugins).toEqual([
      { type: "local", path: "C:\\Users\\Rengar\\Leemo\\.claude" },
    ]);
  });

  it("passes multiple local plugin paths in stable order", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      {
        ...makeExtras(),
        pluginPaths: ["C:\\Leemo\\.leemo\\runtime\\builtin-skills", "C:\\Leemo\\.claude"],
      } as never,
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).plugins).toEqual([
      { type: "local", path: "C:\\Leemo\\.leemo\\runtime\\builtin-skills" },
      { type: "local", path: "C:\\Leemo\\.claude" },
    ]);
  });

  it("keeps settingSources:[] while plugins are loaded (卡 A 方案 C untouched)", async () => {
    // The whole point of 方案 G: skills work WITHOUT reopening the settings
    // sources that would pull ~/.claude into momo's context.
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      { ...makeExtras(), pluginPath: "/home/r/Leemo/.claude", enabledSkills: ["leemo:pdf"] },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).settingSources).toEqual([]);
  });

  it("omits plugins entirely when no pluginPath is supplied", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect("plugins" in (captured[0].options ?? {})).toBe(false);
  });

  it("passes enabledSkills through as the SDK `skills` allow-list (qualified names)", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(
      { ...makeExtras(), enabledSkills: ["leemo:pdf", "leemo:期末速通"] },
      fakeQuery as never,
    );
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).skills).toEqual(["leemo:pdf", "leemo:期末速通"]);
  });

  // ── The semantic trap: [] ≠ omitted (sdk.d.ts:1877) ─────────────────────
  // "omitted (default): no SDK auto-configuration. The CLI's own defaults still
  // apply, so this is **not** 'skills off.'" An empty ARRAY is a real, empty
  // allow-list. So "user switched every skill off" MUST send [], and "Leemo has
  // no opinion" MUST omit the key. One test per branch, because collapsing the
  // two is a silent behaviour change nobody would notice until a user complains
  // that a disabled skill still fires.
  it("sends skills:[] — an explicit empty allow-list — when the user disables all", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn({ ...makeExtras(), enabledSkills: [] }, fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    const opts = optsOf(captured[0]);
    expect("skills" in opts).toBe(true);
    expect(opts.skills).toEqual([]);
  });

  it("OMITS skills (key absent, not []) when enabledSkills is undefined", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect("skills" in (captured[0].options ?? {})).toBe(false);
  });

  it("plugins and skills are independent — either may be supplied alone", async () => {
    const { captured, fakeQuery } = capture();
    const onlySkills = buildQueryFn({ ...makeExtras(), enabledSkills: ["leemo:a"] }, fakeQuery as never);
    await onlySkills({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect("plugins" in (captured[0].options ?? {})).toBe(false);
    expect(optsOf(captured[0]).skills).toEqual(["leemo:a"]);

    const onlyPlugin = buildQueryFn({ ...makeExtras(), pluginPath: "/p/.claude" }, fakeQuery as never);
    await onlyPlugin({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[1]).plugins).toEqual([{ type: "local", path: "/p/.claude" }]);
    expect("skills" in (captured[1].options ?? {})).toBe(false);
  });

  // 轮 5 打包：打包态要显式指定原生 CLI 路径，dev 态必须**完全不提这个键**。
  // 后者不是洁癖 —— sdk.mjs 里是 `if(!pathToClaudeCodeExecutable){ 自己解析 }`，
  // 键在（哪怕是 undefined 也可能被别的写法带进去）就等于关掉了 SDK 的解析。
  it("forwards cliExecutablePath as pathToClaudeCodeExecutable when packaged", async () => {
    const { captured, fakeQuery } = capture();
    const p = "C:\\app\\resources\\app.asar.unpacked\\node_modules\\x\\claude.exe";
    const qfn = buildQueryFn({ ...makeExtras(), cliExecutablePath: p }, fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect(optsOf(captured[0]).pathToClaudeCodeExecutable).toBe(p);
  });

  it("OMITS pathToClaudeCodeExecutable entirely in dev (key absent, so the SDK still self-resolves)", async () => {
    const { captured, fakeQuery } = capture();
    const qfn = buildQueryFn(makeExtras(), fakeQuery as never);
    await qfn({ prompt: "hi" })[Symbol.asyncIterator]().next();
    expect("pathToClaudeCodeExecutable" in (captured[0].options ?? {})).toBe(false);
  });
});
