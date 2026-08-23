import { describe, it, expect } from "vitest";
import {
  emptyConfig,
  upsertProvider,
  removeProvider,
  migrateLegacyConfig,
  type ProviderConfigFile,
} from "../../src/host/provider-config";
import type { ModelCapabilityEvidence, ProviderDraft } from "../../src/bridge/contract";

/** Obviously-fake sentinels (铁律: no real key shape in tests). */
const KEY_A = "test-key-aaaa1111";
const KEY_B = "test-key-bbbb2222";

function mintSeq(): () => string {
  let n = 0;
  return () => `minted-${++n}`;
}

const DRAFT: ProviderDraft = {
  kind: "relay",
  name: "我的中转站",
  baseUrl: "https://relay.example.com",
  apiFormat: "openai",
  apiKey: KEY_A,
  models: ["gpt-x"],
};

const MODEL_EVIDENCE: Record<string, ModelCapabilityEvidence> = {
  "gpt-x": {
    image: {
      probe: { status: "verified", checkedAt: 101, detail: "识别到红蓝方块" },
    },
    reasoning: {
      probe: { status: "failed", checkedAt: 102, detail: "接口拒绝思考参数" },
      userOverride: { supported: true, updatedAt: 103 },
    },
  },
};

const MODEL_CONTEXT_POLICIES = {
  "gpt-x": {
    contextWindowTokens: 512_000,
    autoCompactWindowTokens: 480_000,
  },
};

describe("emptyConfig", () => {
  it("is version 1 with no providers", () => {
    expect(emptyConfig()).toEqual({ version: 1, providers: {} });
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = emptyConfig();
    a.providers.x = {
      kind: "custom",
      name: "x",
      baseUrl: "https://x",
      apiFormat: "anthropic",
      category: "custom",
    };
    expect(Object.keys(emptyConfig().providers)).toEqual([]);
  });
});

describe("upsertProvider — create", () => {
  it("persists model-specific context limits independently from capability flags", () => {
    const { config, id } = upsertProvider(emptyConfig(), {
      ...DRAFT,
      modelContextPolicies: MODEL_CONTEXT_POLICIES,
    }, mintSeq());

    expect(config.providers[id].modelContextPolicies).toEqual(MODEL_CONTEXT_POLICIES);
    expect(config.providers[id].modelContextPolicies).not.toBe(MODEL_CONTEXT_POLICIES);
  });

  it("mints an id when the draft has none", () => {
    const { config, id } = upsertProvider(emptyConfig(), DRAFT, mintSeq());
    expect(id).toBe("minted-1");
    expect(config.providers["minted-1"].name).toBe("我的中转站");
    expect(config.providers["minted-1"].apiKey).toBe(KEY_A);
  });

  it("defaults category to custom when the draft omits it", () => {
    const { config, id } = upsertProvider(emptyConfig(), DRAFT, mintSeq());
    expect(config.providers[id].category).toBe("custom");
  });

  it("persists the no-key auth mode used by local model services", () => {
    const { config, id } = upsertProvider(emptyConfig(), {
      kind: "ollama",
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiFormat: "openai",
      authMode: "none",
      models: ["qwen-local"],
    }, mintSeq());

    expect(config.providers[id].authMode).toBe("none");
    expect(config.providers[id].apiKey).toBeUndefined();
  });

  it("does not mutate the input config", () => {
    const before = emptyConfig();
    upsertProvider(before, DRAFT, mintSeq());
    expect(before.providers).toEqual({});
  });

  it("keeps a preset id when the draft supplies one (id === kind)", () => {
    const { config, id } = upsertProvider(
      emptyConfig(),
      { id: "deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic", apiKey: KEY_A },
      mintSeq(),
    );
    expect(id).toBe("deepseek");
    expect(config.providers.deepseek.apiKey).toBe(KEY_A);
  });
});

describe("upsertProvider — update / key retention", () => {
  const seeded = (): ProviderConfigFile =>
    upsertProvider(emptyConfig(), { ...DRAFT, id: "r1" }, mintSeq()).config;

  it("KEEPS the stored key when the draft omits apiKey (「留空即不改」)", () => {
    const { config } = upsertProvider(seeded(), { id: "r1", kind: "relay", name: "改名了", baseUrl: "https://relay2.example.com", apiFormat: "openai" }, mintSeq());
    expect(config.providers.r1.apiKey).toBe(KEY_A);
    expect(config.providers.r1.name).toBe("改名了");
    expect(config.providers.r1.baseUrl).toBe("https://relay2.example.com");
  });

  it("REPLACES the key when the draft supplies a new one", () => {
    const { config } = upsertProvider(seeded(), { ...DRAFT, id: "r1", apiKey: KEY_B }, mintSeq());
    expect(config.providers.r1.apiKey).toBe(KEY_B);
  });

  it("CLEARS the key when the draft supplies an empty string", () => {
    const { config } = upsertProvider(seeded(), { ...DRAFT, id: "r1", apiKey: "" }, mintSeq());
    expect(config.providers.r1.apiKey).toBeUndefined();
  });

  it("never calls mintId on update", () => {
    let calls = 0;
    upsertProvider(seeded(), { ...DRAFT, id: "r1" }, () => {
      calls++;
      return "nope";
    });
    expect(calls).toBe(0);
  });

  it("keeps omitted optional fields but honours explicit empties", () => {
    const base = upsertProvider(
      emptyConfig(),
      { ...DRAFT, id: "r1", headers: { "X-Foo": "1" }, modelCapabilities: { "gpt-x": { thinking: true, vision: false } } },
      mintSeq(),
    ).config;
    // omitted → kept
    const kept = upsertProvider(base, { id: "r1", kind: "relay", name: "n", baseUrl: "https://b", apiFormat: "openai" }, mintSeq()).config;
    expect(kept.providers.r1.headers).toEqual({ "X-Foo": "1" });
    expect(kept.providers.r1.models).toEqual(["gpt-x"]);
    // explicit empty → cleared
    const cleared = upsertProvider(base, { id: "r1", kind: "relay", name: "n", baseUrl: "https://b", apiFormat: "openai", headers: {}, models: [] }, mintSeq()).config;
    expect(cleared.providers.r1.headers).toEqual({});
    expect(cleared.providers.r1.models).toEqual([]);
  });

  it("round-trips model capability evidence and deep-clones every nested level", () => {
    const draftEvidence = structuredClone(MODEL_EVIDENCE);
    const created = upsertProvider(
      emptyConfig(),
      { ...DRAFT, id: "r1", modelCapabilityEvidence: draftEvidence },
      mintSeq(),
    ).config;

    expect(created.providers.r1.modelCapabilityEvidence).toEqual(MODEL_EVIDENCE);
    draftEvidence["gpt-x"].image!.probe!.detail = "mutated after save";
    expect(created.providers.r1.modelCapabilityEvidence?.["gpt-x"].image?.probe?.detail)
      .toBe("识别到红蓝方块");

    const migrated = migrateLegacyConfig(created, {});
    expect(migrated.providers.r1.modelCapabilityEvidence).toEqual(MODEL_EVIDENCE);
    migrated.providers.r1.modelCapabilityEvidence!["gpt-x"].reasoning!.probe!.detail = "mutated read";
    expect(created.providers.r1.modelCapabilityEvidence?.["gpt-x"].reasoning?.probe?.detail)
      .toBe("接口拒绝思考参数");
  });

  it("persists human task routing and lets an explicit empty object restore automatic routing", () => {
    const configured = upsertProvider(
      emptyConfig(),
      {
        ...DRAFT,
        id: "r1",
        taskModelRouting: { fastModelId: "gpt-fast", subagentModelId: "gpt-worker" },
      },
      mintSeq(),
    ).config;
    expect(configured.providers.r1.taskModelRouting).toEqual({
      fastModelId: "gpt-fast",
      subagentModelId: "gpt-worker",
    });

    const automatic = upsertProvider(
      configured,
      { ...DRAFT, id: "r1", taskModelRouting: {} },
      mintSeq(),
    ).config;
    expect(automatic.providers.r1.taskModelRouting).toEqual({});
  });

  it("patches and removes headers without requiring secret values to round-trip through the renderer", () => {
    const base = upsertProvider(
      emptyConfig(),
      {
        ...DRAFT,
        id: "r1",
        headers: {
          Authorization: "Bearer old-secret",
          "X-Relay-Token": "old-token",
          "User-Agent": "Leemo/1",
        },
      },
      mintSeq(),
    ).config;

    const { config } = upsertProvider(
      base,
      {
        id: "r1",
        kind: "relay",
        name: "n",
        baseUrl: "https://b",
        apiFormat: "openai",
        headers: { Authorization: "Bearer replacement", "X-Trace-Id": "trace-1" },
        removeHeaderKeys: ["X-Relay-Token"],
      },
      mintSeq(),
    );

    expect(config.providers.r1.headers).toEqual({
      Authorization: "Bearer replacement",
      "User-Agent": "Leemo/1",
      "X-Trace-Id": "trace-1",
    });
  });

  it("does not mutate the input config on update", () => {
    const before = seeded();
    upsertProvider(before, { ...DRAFT, id: "r1", apiKey: KEY_B }, mintSeq());
    expect(before.providers.r1.apiKey).toBe(KEY_A);
  });

  it("mints a NEW instance when the draft id is unknown (no silent no-op)", () => {
    const { config, id } = upsertProvider(seeded(), { ...DRAFT, id: "ghost" }, mintSeq());
    expect(id).toBe("ghost");
    expect(Object.keys(config.providers).sort()).toEqual(["ghost", "r1"]);
  });
});

describe("removeProvider", () => {
  it("drops the instance and leaves the rest", () => {
    const a = upsertProvider(emptyConfig(), { ...DRAFT, id: "r1" }, mintSeq()).config;
    const b = upsertProvider(a, { ...DRAFT, id: "r2", name: "二号" }, mintSeq()).config;
    const out = removeProvider(b, "r1");
    expect(Object.keys(out.providers)).toEqual(["r2"]);
    // input untouched
    expect(Object.keys(b.providers).sort()).toEqual(["r1", "r2"]);
  });

  it("is a no-op for an unknown id", () => {
    const a = upsertProvider(emptyConfig(), { ...DRAFT, id: "r1" }, mintSeq()).config;
    expect(removeProvider(a, "nope")).toEqual(a);
  });
});

describe("migrateLegacyConfig — the irreversible point (user keys live here)", () => {
  it("migrates the OLD encrypted shape into a deepseek instance", () => {
    const out = migrateLegacyConfig({ DEEPSEEK_API_KEY: KEY_A, DEEPSEEK_MODEL: "deepseek-v4-pro" }, {});
    expect(out.version).toBe(1);
    expect(out.providers.deepseek.apiKey).toBe(KEY_A);
    expect(out.providers.deepseek.kind).toBe("deepseek");
    // the legacy model becomes the DEFAULT (models[0]) — user's pick survives
    expect(out.providers.deepseek.models?.[0]).toBe("deepseek-v4-pro");
    expect(out.providers.deepseek.baseUrl).toBe("https://api.deepseek.com/anthropic");
  });

  it("passes a NEW-shape config through unchanged (no double migration)", () => {
    const current = upsertProvider(emptyConfig(), { ...DRAFT, id: "r1" }, mintSeq()).config;
    expect(migrateLegacyConfig(current, {})).toEqual(current);
  });

  it("keeps old files that only contain modelCapabilities backward compatible", () => {
    const out = migrateLegacyConfig({
      version: 1,
      providers: {
        r1: {
          kind: "relay",
          name: "Relay",
          baseUrl: "https://relay.example.com",
          apiFormat: "openai",
          category: "custom",
          models: ["gpt-x"],
          modelCapabilities: { "gpt-x": { thinking: true, vision: false } },
        },
      },
    }, {});

    expect(out.providers.r1.modelCapabilities).toEqual({
      "gpt-x": { thinking: true, vision: false },
    });
    expect(out.providers.r1.modelCapabilityEvidence).toBeUndefined();
  });

  it("sanitizes corrupt evidence field-by-field and never invents models from evidence keys", () => {
    const longDetail = "x".repeat(340);
    const out = migrateLegacyConfig({
      version: 1,
      providers: {
        r1: {
          kind: "relay",
          name: "Relay",
          baseUrl: "https://relay.example.com",
          apiFormat: "openai",
          category: "custom",
          models: ["gpt-x", "broken-model"],
          modelCapabilityEvidence: {
            "gpt-x": {
              image: {
                probe: { status: "verified", checkedAt: 7, detail: longDetail, extra: "drop" },
                userOverride: { supported: false, updatedAt: 8 },
                arbitrary: "drop",
              },
              reasoning: {
                userOverride: { supported: true, updatedAt: 9, extra: "drop" },
              },
              arbitrary: "drop",
            },
            "broken-model": {
              image: { probe: { status: "broken", checkedAt: 8 } },
              reasoning: {
                probe: { status: "failed", checkedAt: Number.POSITIVE_INFINITY },
                userOverride: { supported: true, updatedAt: -1 },
              },
            },
            ghost: {
              image: { probe: { status: "verified", checkedAt: 10 } },
            },
            malformed: "drop",
          },
        },
      },
    }, {});

    expect(out.providers.r1.models).toEqual(["gpt-x", "broken-model"]);
    expect(out.providers.r1.modelCapabilityEvidence).toEqual({
      "gpt-x": {
        image: {
          probe: { status: "verified", checkedAt: 7, detail: "x".repeat(300) },
        },
        reasoning: {
          userOverride: { supported: true, updatedAt: 9 },
        },
      },
    });
  });

  it("migrates legacy fast and subtask aliases into human task routing", () => {
    const legacy = {
      version: 1,
      providers: {
        r1: {
          kind: "relay",
          name: "Relay",
          baseUrl: "https://relay.example.com",
          apiFormat: "openai",
          category: "custom",
          envTemplate: {
            ANTHROPIC_SMALL_FAST_MODEL: "legacy-fast",
            CLAUDE_CODE_SUBAGENT_MODEL: "legacy-worker",
          },
        },
        r2: {
          kind: "relay",
          name: "Relay 2",
          baseUrl: "https://relay2.example.com",
          apiFormat: "openai",
          category: "custom",
          envTemplate: {
            ANTHROPIC_SMALL_FAST_MODEL: "legacy-fast",
            ANTHROPIC_DEFAULT_HAIKU_MODEL: "current-haiku",
          },
        },
      },
    };

    const migrated = migrateLegacyConfig(legacy, {});
    expect(migrated.providers.r1.taskModelRouting).toEqual({
      fastModelId: "legacy-fast",
      subagentModelId: "legacy-worker",
    });
    expect(migrated.providers.r2.taskModelRouting).toEqual({ fastModelId: "current-haiku" });
    expect(JSON.stringify(migrated)).not.toContain("ANTHROPIC_SMALL_FAST_MODEL");
  });

  it("lets a present empty task routing override stale legacy aliases", () => {
    const migrated = migrateLegacyConfig({
      version: 1,
      providers: {
        r1: {
          kind: "relay",
          name: "Relay",
          baseUrl: "https://relay.example.com",
          apiFormat: "openai",
          category: "custom",
          taskModelRouting: {},
          envTemplate: {
            ANTHROPIC_DEFAULT_HAIKU_MODEL: "stale-fast",
            CLAUDE_CODE_SUBAGENT_MODEL: "stale-worker",
          },
        },
      },
    }, {});

    expect(migrated.providers.r1.taskModelRouting).toEqual({});
  });

  it("returns emptyConfig() for garbage input instead of throwing", () => {
    for (const junk of [null, undefined, 42, "nope", [], true, { random: "stuff" }, { version: 1 }]) {
      expect(() => migrateLegacyConfig(junk, {})).not.toThrow();
      expect(migrateLegacyConfig(junk, {})).toEqual({ version: 1, providers: {} });
    }
  });

  it("bootstraps each family from env when that instance is absent", () => {
    const out = migrateLegacyConfig(null, {
      DEEPSEEK_API_KEY: KEY_A,
      GLM_API_KEY: KEY_B,
      KIMI_API_KEY: KEY_A,
      DASHSCOPE_API_KEY: KEY_B,
    });
    expect(Object.keys(out.providers).sort()).toEqual(["deepseek", "glm", "kimi", "qwen"]);
    expect(out.providers.qwen.apiKey).toBe(KEY_B);
    expect(out.providers.qwen.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(out.providers.qwen.apiFormat).toBe("openai");
    expect(out.providers.glm.kind).toBe("glm");
  });

  it("does NOT let env overwrite a key already stored for that instance", () => {
    const stored = migrateLegacyConfig({ DEEPSEEK_API_KEY: KEY_A }, {});
    const out = migrateLegacyConfig(stored, { DEEPSEEK_API_KEY: "test-key-STALE-env" });
    expect(out.providers.deepseek.apiKey).toBe(KEY_A);
  });

  it("carries <KIND>_MODEL from env into the bootstrapped instance's default slot", () => {
    const out = migrateLegacyConfig(null, { KIMI_API_KEY: KEY_A, KIMI_MODEL: "kimi-k3" });
    expect(out.providers.kimi.models?.[0]).toBe("kimi-k3");
  });

  it("carries QWEN_BASE_URL from env into the bootstrapped qwen instance", () => {
    const out = migrateLegacyConfig(null, {
      DASHSCOPE_API_KEY: KEY_A,
      QWEN_BASE_URL: "https://my-ws.dashscope.aliyuncs.com/apps/anthropic",
    });
    expect(out.providers.qwen.baseUrl).toBe("https://my-ws.dashscope.aliyuncs.com/apps/anthropic");
    expect(out.providers.qwen.apiFormat).toBe("anthropic");
  });

  it("keeps custom instances when bootstrapping presets from env", () => {
    const stored = upsertProvider(emptyConfig(), { ...DRAFT, id: "r1" }, mintSeq()).config;
    const out = migrateLegacyConfig(stored, { GLM_API_KEY: KEY_B });
    expect(Object.keys(out.providers).sort()).toEqual(["glm", "r1"]);
    expect(out.providers.r1.apiKey).toBe(KEY_A);
  });

  it("ignores a legacy blob with neither key nor model", () => {
    expect(migrateLegacyConfig({ DEEPSEEK_API_KEY: "", DEEPSEEK_MODEL: "" }, {})).toEqual(emptyConfig());
  });

  it("drops non-object provider entries rather than trusting the blob", () => {
    const out = migrateLegacyConfig({ version: 1, providers: { ok: { kind: "relay", name: "n", baseUrl: "https://b", apiFormat: "openai", category: "custom" }, bad: null, worse: 7 } }, {});
    expect(Object.keys(out.providers)).toEqual(["ok"]);
  });

  it("round-trips Responses coding-plan metadata while legacy openai stays Chat-compatible", () => {
    const current = migrateLegacyConfig({
      version: 1,
      providers: {
        tokenflux: {
          kind: "tokenflux",
          name: "TokenFlux",
          baseUrl: "https://tokenflux.dev/v1",
          apiFormat: "openai-responses",
          authMode: "plan-key",
          productKind: "coding-plan",
          category: "official",
        },
        legacy: {
          kind: "relay",
          name: "旧中转",
          baseUrl: "https://relay.example/v1",
          apiFormat: "openai",
          category: "custom",
        },
      },
    }, {});

    expect(current.providers.tokenflux).toMatchObject({
      apiFormat: "openai-responses",
      authMode: "plan-key",
      productKind: "coding-plan",
    });
    expect(current.providers.legacy.apiFormat).toBe("openai");
  });
});

describe("non-provider encrypted fields", () => {
  it("survive provider upserts and current-shape migration", () => {
    const base: ProviderConfigFile = {
      version: 1,
      providers: {},
      searchKeys: {
        tavily: "tvly-secret",
        doubao: "doubao-secret",
        metaso: "metaso-secret",
        google: "google-secret",
        googleCx: "cx-secret",
        exa: "exa-secret",
        brave: "brave-secret",
        serpapi: "serpapi-secret",
        serper: "serper-secret",
        firecrawl: "firecrawl-secret",
      },
      mcpServers: {
        docs: {
          name: "Docs",
          transport: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer secret" },
          enabled: true,
        },
      },
    };
    const updated = upsertProvider(base, { ...DRAFT, id: "r1" }, mintSeq()).config;
    expect(updated.searchKeys).toEqual(base.searchKeys);
    expect(updated.mcpServers).toEqual(base.mcpServers);
    expect(updated.mcpServers).not.toBe(base.mcpServers);

    const migrated = migrateLegacyConfig(base, {});
    expect(migrated.searchKeys).toEqual(base.searchKeys);
    expect(migrated.mcpServers).toEqual(base.mcpServers);
  });

  it("只保留受支持的搜索凭据字段，不让任意加密件属性进入运行时", () => {
    const migrated = migrateLegacyConfig({
      version: 1,
      providers: {},
      searchKeys: {
        anysearch: "any-key",
        doubao: "doubao-key",
        metaso: "metaso-key",
        google: "google-key",
        googleCx: "google-cx",
        exa: "exa-key",
        brave: "brave-key",
        serpapi: "serpapi-key",
        serper: "serper-key",
        firecrawl: "firecrawl-key",
        unknown: "must-drop",
        bocha: 42,
      },
    }, {});

    expect(migrated.searchKeys).toEqual({
      anysearch: "any-key",
      doubao: "doubao-key",
      metaso: "metaso-key",
      google: "google-key",
      googleCx: "google-cx",
      exa: "exa-key",
      brave: "brave-key",
      serpapi: "serpapi-key",
      serper: "serper-key",
      firecrawl: "firecrawl-key",
    });
    expect(JSON.stringify(migrated.searchKeys)).not.toContain("must-drop");
  });
});
