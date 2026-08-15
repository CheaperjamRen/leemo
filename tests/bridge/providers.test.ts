import { describe, it, expect } from "vitest";
import { buildConversationEnv, sanitizeHostEnv } from "../../src/bridge/providers";
import {
  deepseekDirect,
  deepseekWithTemplate,
  relay2Gateway,
} from "./fixtures/providers";

// B1 Step 1 — providers.buildConversationEnv pure env builder.
//
// Two wiring modes (06 §3.2). The function is a PURE mapping from
// (provider, modelId, gatewayPort?) to the env object handed to the SDK child.
// It does NOT read process.env, .env, or the filesystem — those are the pool's
// concern. Every assertion below pins an exact VALUE, not mere presence.

// Internal Harness aliases. Only the current model and ordinary task aliases
// get automatic defaults. The subtask override must be absent unless the user
// explicitly chooses one, so native inheritance can follow the current turn.
const SLOT_MODEL = "ANTHROPIC_MODEL";
const SLOT_FABLE = "ANTHROPIC_DEFAULT_FABLE_MODEL";
const SLOT_SONNET = "ANTHROPIC_DEFAULT_SONNET_MODEL";
const SLOT_OPUS = "ANTHROPIC_DEFAULT_OPUS_MODEL";
const SLOT_HAIKU = "ANTHROPIC_DEFAULT_HAIKU_MODEL";
const SLOT_SUBAGENT = "CLAUDE_CODE_SUBAGENT_MODEL";
const ORDINARY_SLOTS = [
  SLOT_MODEL,
  SLOT_FABLE,
  SLOT_SONNET,
  SLOT_OPUS,
  SLOT_HAIKU,
];

describe("buildConversationEnv — DIRECT wiring (apiFormat=anthropic)", () => {
  it("points BASE_URL at the provider endpoint and AUTH_TOKEN at the real key", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(
      "test-key-deepseek-DIRECTKEY-000000000000"
    );
  });

  it("defaults ordinary task slots to the chosen model and omits a subtask override", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    for (const slot of ORDINARY_SLOTS) expect(env[slot]).toBe("deepseek-v4pro");
    expect(env).not.toHaveProperty(SLOT_SUBAGENT);
  });

  it("blanks ANTHROPIC_API_KEY so an ambient key can never override AUTH_TOKEN", () => {
    // Phase 0 buildEnv sets ANTHROPIC_API_KEY:'' for exactly this reason.
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("sets CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 (Phase 0 smoke/lib parity)", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  });

  it("keeps Windows Python tools UTF-8 and prevents Skill cache files in user workspaces", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.PYTHONUTF8).toBe("1");
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONDONTWRITEBYTECODE).toBe("1");
  });

  it("honors an envTemplate slot override while defaulting the untouched slots", () => {
    // deepseekWithTemplate remaps only the HAIKU slot to the flash model.
    const env = buildConversationEnv(deepseekWithTemplate, "deepseek-v4pro");
    expect(env[SLOT_HAIKU]).toBe("deepseek-v4flash"); // template wins
    expect(env[SLOT_MODEL]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_SONNET]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_OPUS]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_FABLE]).toBe("deepseek-v4pro"); // default
    expect(env).not.toHaveProperty(SLOT_SUBAGENT); // native inheritance
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined();
  });

  it("writes a subtask override only when it is explicitly configured", () => {
    const env = buildConversationEnv({
      ...deepseekDirect,
      envTemplate: { CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4flash" },
    }, "deepseek-v4pro");

    expect(env.ANTHROPIC_MODEL).toBe("deepseek-v4pro");
    expect(env[SLOT_SUBAGENT]).toBe("deepseek-v4flash");
  });

  it("reflects the modelId argument, not the provider's first model", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4flash");
    expect(env[SLOT_MODEL]).toBe("deepseek-v4flash");
  });

  it("never lets a saved primary alias override the model chosen for this conversation", () => {
    const env = buildConversationEnv({
      ...deepseekDirect,
      envTemplate: {
        ...deepseekDirect.envTemplate,
        ANTHROPIC_MODEL: "stale-provider-default",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4flash",
      },
    }, "deepseek-v4pro");

    expect(env[SLOT_MODEL]).toBe("deepseek-v4pro");
    expect(env[SLOT_HAIKU]).toBe("deepseek-v4flash");
  });
});

describe("buildConversationEnv — native subscription login", () => {
  it("uses the isolated native login without injecting an endpoint or credential channel", () => {
    const env = buildConversationEnv({
      ...deepseekDirect,
      id: "claude-subscription",
      name: "Claude 订阅",
      baseUrl: "",
      apiKey: "",
      authMode: "oauth-subscription",
    }, "claude-sonnet-4-6");

    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-6");
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  });
});

describe("buildConversationEnv — GATEWAY wiring (apiFormat=openai)", () => {
  it("uses the same isolated gateway for Responses-native providers", () => {
    const env = buildConversationEnv({ ...relay2Gateway, id: "tokenflux", apiFormat: "openai-responses" }, "gpt-5.6-sol", 61340);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:61340");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-gw:tokenflux");
    expect(env.ANTHROPIC_MODEL).toBe("claude-gpt-5.6-sol");
    expect(JSON.stringify(env)).not.toContain(relay2Gateway.apiKey);
  });

  it("points BASE_URL at the loopback gateway on the injected port", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:61340");
  });

  it("uses the placeholder token leemo-gw:<providerId>, NOT the real key", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-gw:relay2");
  });

  it("disguises the model with the claude- prefix (G3 /v1/models semantics)", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    for (const slot of ORDINARY_SLOTS) expect(env[slot]).toBe("claude-gpt-5.6-luna");
    expect(env).not.toHaveProperty(SLOT_SUBAGENT);
  });

  it("disguises each configured task-role override for gateway routing", () => {
    const env = buildConversationEnv({
      ...relay2Gateway,
      envTemplate: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gpt-5.6-mini",
        CLAUDE_CODE_SUBAGENT_MODEL: "gpt-5.6-worker",
      },
    }, "gpt-5.6-luna", 61340);

    expect(env.ANTHROPIC_MODEL).toBe("claude-gpt-5.6-luna");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-gpt-5.6-mini");
    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("claude-gpt-5.6-worker");
  });

  it("carries NO real key anywhere in the env (leak assertion)", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    const blob = JSON.stringify(env);
    expect(blob).not.toContain(relay2Gateway.apiKey);
    expect(blob).not.toContain("test-key-relay");
    // and specifically the AUTH_TOKEN slot is the placeholder, key-shaped-free
    expect(env.ANTHROPIC_AUTH_TOKEN).not.toContain("sk-");
  });

  it("blanks ANTHROPIC_API_KEY in gateway mode too", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("throws when an OpenAI-compatible provider is wired without a gateway port", () => {
    // Gateway mode is meaningless without the local gateway's port; failing
    // loud beats silently emitting http://127.0.0.1:undefined.
    expect(() => buildConversationEnv(relay2Gateway, "gpt-5.6-luna")).toThrow(
      /gateway port/i
    );
  });
});

describe("buildConversationEnv — SEARCH SHIM wiring (轮 4 卡 H2)", () => {
  // 第三种接线：anthropic 家 + 本地搜索 shim。目的不是翻译协议（shim 只是哑
  // 管道），而是把 CC 内置 WebSearch 的**嵌套服务端工具请求**接下来，用 Leemo
  // 自己的搜索链答掉 —— 于是内置 WebSearch 在每一家 provider 上都能用，且不必
  // 回连 claude.ai、不必开 VPN。见 src/host/search-shim.ts 顶部注释。
  it("points BASE_URL at the loopback shim, keeping the provider's own path OUT of it", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro", undefined, 45123);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:45123");
  });

  it("uses the placeholder token leemo-search:<providerId>, NOT the real key", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro", undefined, 45123);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-search:deepseek");
  });

  it("carries NO real key anywhere in the env — strictly SAFER than direct wiring", () => {
    // 直连接线把真 key 放进子进程 env（子进程能跑 bash ⇒ printenv 可读）。
    // 走 shim 之后真 key 只留在本进程注册表里，这是一次安全升级，不是退让。
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro", undefined, 45123);
    const blob = JSON.stringify(env);
    expect(blob).not.toContain("test-key-deepseek-DIRECTKEY-000000000000");
    expect(blob).not.toContain("DIRECTKEY");
  });

  it("does NOT disguise the model name — the shim passes the wire through verbatim", () => {
    // 与网关接线的关键区别：网关要翻译协议、故用 claude- 伪装名；shim 是
    // anthropic→anthropic 透传，模型名必须原样，否则上游认不出。
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro", undefined, 45123);
    for (const slot of ORDINARY_SLOTS) expect(env[slot]).toBe("deepseek-v4pro");
    expect(env).not.toHaveProperty(SLOT_SUBAGENT);
    expect(JSON.stringify(env)).not.toContain("claude-deepseek");
  });

  it("still honors an envTemplate slot override (shim wiring is not a model rewrite)", () => {
    const env = buildConversationEnv(deepseekWithTemplate, "deepseek-v4pro", undefined, 45123);
    expect(env[SLOT_HAIKU]).toBe("deepseek-v4flash");
    expect(env[SLOT_MODEL]).toBe("deepseek-v4pro");
  });

  it("passes an explicit subtask model through the shim without rewriting it", () => {
    const env = buildConversationEnv({
      ...deepseekDirect,
      envTemplate: { CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-v4flash" },
    }, "deepseek-v4pro", undefined, 45123);

    expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("deepseek-v4flash");
  });

  it("gateway wiring WINS over the shim for openai providers (protocol translation first)", () => {
    // openai 家必须先过网关翻译。shim 只服务 anthropic 家 —— 两者不叠加，
    // 否则请求会被翻译两次。openai 家的搜索由网关自己接（另一处接线）。
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 41111, 45123);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:41111");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-gw:relay2");
  });

  it("without a shim port, anthropic providers keep the original DIRECT wiring", () => {
    // shim 起不来时必须原样退回直连 —— 少一个搜索工具好过整个对话打不通。
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("test-key-deepseek-DIRECTKEY-000000000000");
  });
});

describe("buildConversationEnv — purity", () => {
  it("does not mutate the provider or its envTemplate", () => {
    const before = JSON.stringify(deepseekWithTemplate);
    buildConversationEnv(deepseekWithTemplate, "deepseek-v4pro");
    expect(JSON.stringify(deepseekWithTemplate)).toBe(before);
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    const b = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("sanitizeHostEnv — strip secret-shaped host vars before spread", () => {
  // The SDK REPLACES the child env, so the pool must spread process.env for
  // PATH/HOME/etc. But process.env in production carries the gateway's real
  // upstream keys (RELAY2_API_KEY etc.) and any sibling-provider secrets — a
  // child that runs bash could printenv them. sanitizeHostEnv drops every
  // secret-shaped var; the conversation's OWN token is re-applied afterward by
  // buildConversationEnv (ANTHROPIC_AUTH_TOKEN), so direct wiring is unaffected.

  it("drops *_API_KEY (incl. ANTHROPIC_API_KEY) and every *_TOKEN credential", () => {
    const clean = sanitizeHostEnv({
      RELAY2_API_KEY: "test-key-relay-should-be-stripped",
      ANTHROPIC_API_KEY: "test-key-anthropic-should-be-stripped",
      SOME_VENDOR_AUTH_TOKEN: "test-key-vendor-token",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-token-must-be-stripped",
      GITHUB_TOKEN: "github-token-must-be-stripped",
      PATH: "/usr/bin",
    });
    expect(clean.RELAY2_API_KEY).toBeUndefined();
    expect(clean.ANTHROPIC_API_KEY).toBeUndefined();
    expect(clean.SOME_VENDOR_AUTH_TOKEN).toBeUndefined();
    expect(clean.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(clean.GITHUB_TOKEN).toBeUndefined();
    expect(clean.PATH).toBe("/usr/bin"); // benign system var preserved
  });

  it("drops *_SECRET and *_ACCESS_KEY shapes", () => {
    const clean = sanitizeHostEnv({
      MY_SECRET: "s1",
      DB_SECRET_VALUE: "s2",
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "test-key-aws",
      HOME: "/home/momo",
    });
    expect(clean.MY_SECRET).toBeUndefined();
    expect(clean.DB_SECRET_VALUE).toBeUndefined();
    expect(clean.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(clean.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(clean.HOME).toBe("/home/momo");
  });

  it("drops ambient Harness model routing so automatic subtasks cannot revive a stale override", () => {
    const clean = sanitizeHostEnv({
      ANTHROPIC_MODEL: "stale-main",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "stale-fast",
      ANTHROPIC_SMALL_FAST_MODEL: "older-fast",
      CLAUDE_CODE_SUBAGENT_MODEL: "stale-worker",
      PATH: "/usr/bin",
    });

    expect(clean.ANTHROPIC_MODEL).toBeUndefined();
    expect(clean.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(clean.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined();
    expect(clean.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
    expect(clean.PATH).toBe("/usr/bin");
  });

  it("drops ambient endpoint and cloud-backend routing owned by Leemo provider settings", () => {
    const clean = sanitizeHostEnv({
      ANTHROPIC_BASE_URL: "https://old-gateway.example/v1",
      ANTHROPIC_CUSTOM_HEADERS: "X-Old-Route: true",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
      HTTPS_PROXY: "http://127.0.0.1:10801",
    });

    expect(clean.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(clean.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
    expect(clean.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(clean.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(clean.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined();
    expect(clean.HTTPS_PROXY).toBe("http://127.0.0.1:10801");
  });

  it("is case-insensitive on the sensitive suffixes", () => {
    const clean = sanitizeHostEnv({
      relay2_api_key: "test-key-lower",
      Some_Auth_Token: "test-key-mixed",
      LANG: "en_US.UTF-8",
    });
    expect(clean.relay2_api_key).toBeUndefined();
    expect(clean.Some_Auth_Token).toBeUndefined();
    expect(clean.LANG).toBe("en_US.UTF-8");
  });

  it("does not mutate its input and returns a fresh object", () => {
    const input = { RELAY2_API_KEY: "test-key", PATH: "/bin" };
    const clean = sanitizeHostEnv(input);
    expect(clean).not.toBe(input);
    expect(input.RELAY2_API_KEY).toBe("test-key"); // original untouched
  });
});
