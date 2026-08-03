import { describe, it, expect } from "vitest";
import { buildCatalog, PRESET_PROVIDERS } from "../../src/host/provider-catalog";
import { emptyConfig, upsertProvider, type ProviderConfigFile } from "../../src/host/provider-config";
import type { ProviderDraft } from "../../src/bridge/contract";

const KEY = "sk-test-secret-0001";
const KEY2 = "sk-test-secret-0002";

const byId = (entries: ReturnType<typeof buildCatalog>) =>
  Object.fromEntries(entries.map((e) => [e.provider.id, e]));

function withProvider(draft: ProviderDraft, id = draft.id): ProviderConfigFile {
  return upsertProvider(emptyConfig(), { ...draft, id }, () => id ?? "minted").config;
}

describe("PRESET_PROVIDERS — curated setup catalog", () => {
  it("ships a broad setup catalog while keeping stable ids for every curated family", () => {
    expect(PRESET_PROVIDERS.length).toBeGreaterThanOrEqual(25);
    expect(PRESET_PROVIDERS.map((p) => p.kind)).toEqual(expect.arrayContaining([
      "openai",
      "anthropic",
      "tokenflux",
      "kimi-code",
      "glm-coding-plan",
      "qwen-coding-plan",
      "qwen-token-plan",
      "minimax-token-plan",
      "volcengine-coding-plan",
      "mimo",
      "mimo-token-plan",
      "nvidia",
      "gemini",
      "huawei-maas",
      "openrouter",
      "siliconflow",
      "ollama",
      "lmstudio",
    ]));
    for (const p of PRESET_PROVIDERS) expect(p.id).toBe(p.kind);
  });

  it("models wire protocol and product kind independently", () => {
    const m = Object.fromEntries(PRESET_PROVIDERS.map((p) => [p.kind, p]));
    expect(m.openai.apiFormat).toBe("openai-responses");
    expect(m.openai.productKind).toBe("metered-api");
    expect(m.tokenflux.apiFormat).toBe("openai-responses");
    expect(m.tokenflux.baseUrl).toBe("https://tokenflux.dev/v1");
    expect(m.tokenflux.searchAliases).toContain("词元流动");
    expect(m["kimi-code"].productKind).toBe("coding-plan");
    expect(m["kimi-code"].authMode).toBe("plan-key");
    expect(m["kimi-code"].baseUrl).toBe("https://api.kimi.com/coding/");
    expect(m.kimi.productKind).toBe("metered-api");
    expect(m["glm-coding-plan"].productKind).toBe("coding-plan");
    expect(m.glm.productKind).toBe("metered-api");
    expect(m["volcengine-coding-plan"]).toMatchObject({
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
      apiFormat: "anthropic",
      authMode: "plan-key",
      productKind: "coding-plan",
      models: ["ark-code-latest"],
    });
    expect(m.mimo.gatewayOpts).toEqual({ responsesDialect: "mimo" });
    expect(m["mimo-token-plan"].gatewayOpts).toEqual({ responsesDialect: "mimo" });
    expect(m.doubao.productKind).toBe("metered-api");
    expect(m["huawei-maas"]).toMatchObject({
      productKind: "metered-api",
      category: "cn_official",
      baseUrl: "https://api.modelarts-maas.com/openai/v1",
    });
  });

  it("carries the measured endpoints (NOT derived from baseUrl by convention)", () => {
    const m = Object.fromEntries(PRESET_PROVIDERS.map((p) => [p.kind, p]));
    expect(m.deepseek.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(m.deepseek.modelsUrl).toBe("https://api.deepseek.com/models");
    expect(m.glm.baseUrl).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(m.glm.modelsUrl).toBe("https://open.bigmodel.cn/api/anthropic/v1/models");
    expect(m.kimi.baseUrl).toBe("https://api.moonshot.cn/anthropic");
    expect(m.kimi.modelsUrl).toBe("https://api.moonshot.cn/v1/models");
    expect(m.qwen.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(m.qwen.apiFormat).toBe("openai");
    expect(m.qwen.modelsUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
    expect(m.minimax.baseUrl).toBe("https://api.minimaxi.com/anthropic");
    expect(m.minimax.modelsUrl).toBe("https://api.minimaxi.com/anthropic/v1/models");
    expect(m.doubao.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(m.siliconflow.modelsUrl).toBe("https://api.siliconflow.cn/v1/models");
    expect(m.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(m.ollama.modelsUrl).toBe("http://127.0.0.1:11434/v1/models");
    expect(m.lmstudio.modelsUrl).toBe("http://127.0.0.1:1234/v1/models");
  });

  it("keeps the three native Anthropic API families on their direct-connect contract", () => {
    for (const p of PRESET_PROVIDERS.slice(0, 3)) {
      expect(p.category).toBe("cn_official");
      expect(p.apiFormat).toBe("anthropic");
      expect(p.authMode).toBe("api-key");
      expect(p.capabilities.modelDiscovery).toBe(true);
      expect(p.capabilities.subscriptionPlan).toBe(false);
      expect(p.capabilities.requiresProxy).toBe(false);
    }
  });

  it("models local services as key-free, discoverable, and local", () => {
    for (const kind of ["ollama", "lmstudio"]) {
      const provider = PRESET_PROVIDERS.find((candidate) => candidate.kind === kind)!;
      expect(provider.authMode).toBe("none");
      expect(provider.apiFormat).toBe("openai");
      expect(provider.capabilities.local).toBe(true);
      expect(provider.capabilities.modelDiscovery).toBe(true);
      expect(provider.apiKeyUrl).toBeUndefined();
    }
  });

  it("uses the provider-declared X-Api-Key header for MiniMax discovery", () => {
    expect(PRESET_PROVIDERS.find((provider) => provider.kind === "minimax")?.apiKeyHeader)
      .toBe("x-api-key");
  });

  it("balanceApi is per-家 measured truth (deepseek/kimi yes, glm/qwen no)", () => {
    const m = Object.fromEntries(PRESET_PROVIDERS.map((p) => [p.kind, p]));
    expect(m.deepseek.capabilities.balanceApi).toBe(true);
    expect(m.kimi.capabilities.balanceApi).toBe(true);
    expect(m.glm.capabilities.balanceApi).toBe(false);
    expect(m.qwen.capabilities.balanceApi).toBe(false);
  });

  it("carries the probed model lists with the default first", () => {
    const m = Object.fromEntries(PRESET_PROVIDERS.map((p) => [p.kind, p]));
    expect(m.deepseek.models).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(m.glm.models).toEqual(["glm-5.2", "glm-4.7", "glm-4.5-air"]);
    expect(m.kimi.models).toEqual(["kimi-k2.5", "kimi-k3", "kimi-k2.6"]);
    expect(m.qwen.models).toEqual(["qwen3.7-flash", "qwen3.7-plus", "qwen3.7-max"]);
  });

  it("records the vision exception 主控 measured: qwen3.7-max has no vision", () => {
    const qwen = PRESET_PROVIDERS.find((p) => p.kind === "qwen")!;
    expect(qwen.modelCapabilities["qwen3.7-flash"]).toEqual({ thinking: true, vision: true });
    expect(qwen.modelCapabilities["qwen3.7-plus"]).toEqual({ thinking: true, vision: true });
    expect(qwen.modelCapabilities["qwen3.7-max"]).toEqual({ thinking: true, vision: false });
    // and DeepSeek's measured "accepts an image, cannot see it"
    const ds = PRESET_PROVIDERS.find((p) => p.kind === "deepseek")!;
    expect(ds.modelCapabilities["deepseek-v4-flash"]).toEqual({ thinking: true, vision: false });
    expect(ds.modelCapabilities["deepseek-v4-pro"]).toEqual({ thinking: true, vision: false });
  });

  it("every key-auth provider links to a key console", () => {
    for (const p of PRESET_PROVIDERS.filter((provider) => provider.authMode === "api-key" || provider.authMode === "plan-key")) {
      expect(p.apiKeyUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("buildCatalog — curated presets are ALWAYS listed", () => {
  it("returns every preset even with no key anywhere", () => {
    const entries = buildCatalog({});
    expect(entries.map((e) => e.provider.id)).toEqual(PRESET_PROVIDERS.map((provider) => provider.id));
  });

  it("marks every un-keyed family configured:false with an EMPTY apiKey (no fake key)", () => {
    for (const e of buildCatalog({})) {
      expect(e.spec.configured).toBe(false);
      expect(e.provider.apiKey).toBe("");
    }
  });

  it("marks a family configured:true once a key exists", () => {
    const m = byId(buildCatalog({ GLM_API_KEY: KEY }));
    expect(m.glm.spec.configured).toBe(true);
    expect(m.glm.provider.apiKey).toBe(KEY);
    expect(m.deepseek.spec.configured).toBe(false);
  });

  it("reads each family's own env key name", () => {
    const m = byId(
      buildCatalog({ DEEPSEEK_API_KEY: KEY, GLM_API_KEY: KEY, KIMI_API_KEY: KEY, DASHSCOPE_API_KEY: KEY }),
    );
    for (const id of ["deepseek", "glm", "kimi", "qwen"]) {
      expect(m[id].spec.configured).toBe(true);
      expect(m[id].provider.apiKey).toBe(KEY);
    }
  });

  it("never leaks the key into the IPC projection", () => {
    const entries = buildCatalog({ DEEPSEEK_API_KEY: KEY, GLM_API_KEY: KEY, KIMI_API_KEY: KEY, DASHSCOPE_API_KEY: KEY });
    expect(JSON.stringify(entries.map((e) => e.spec))).not.toContain(KEY);
  });

  it("keeps deepseek's balanceBaseUrl and gives the others none", () => {
    const m = byId(buildCatalog({}));
    expect(m.deepseek.balanceBaseUrl).toBe("https://api.deepseek.com");
    expect(m.kimi.balanceBaseUrl).toBeUndefined();
    expect(m.glm.balanceBaseUrl).toBeUndefined();
  });

  it("exposes key-free setup metadata on both the entry and renderer spec", () => {
    const m = byId(buildCatalog({}));
    expect(m.kimi.modelsUrl).toBe("https://api.moonshot.cn/v1/models");
    expect(m.kimi.spec.modelsUrl).toBe("https://api.moonshot.cn/v1/models");
    expect(m.kimi.spec.saved).toBe(false);
  });

  it("spec keeps the extensibility axes for every family", () => {
    for (const { spec } of buildCatalog({}).slice(0, 4)) {
      expect(spec.kind).toBe(spec.id);
      expect(spec.authMode).toBe("api-key");
      expect(["anthropic", "openai"]).toContain(spec.apiFormat);
      expect(spec.productKind).toBe("metered-api");
      expect(spec.capabilities.modelDiscovery).toBe(true);
    }
  });

  it("marks a saved local service ready once it has a selected model, without a key", () => {
    const config = withProvider({
      id: "ollama",
      kind: "ollama",
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiFormat: "openai",
      authMode: "none",
      models: ["qwen-local"],
    });
    const ollama = byId(buildCatalog({}, config)).ollama;

    expect(ollama.provider.apiKey).toBe("");
    expect(ollama.spec.configured).toBe(true);
    expect(ollama.spec.authMode).toBe("none");
  });
});

describe("buildCatalog — key/model/baseUrl precedence", () => {
  it("config file BEATS env for the api key (app-configured wins over bootstrap)", () => {
    const config = withProvider({ id: "deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic", apiKey: KEY2 });
    const m = byId(buildCatalog({ DEEPSEEK_API_KEY: KEY }, config));
    expect(m.deepseek.provider.apiKey).toBe(KEY2);
  });

  it("falls back to env when the stored instance has no key", () => {
    const config = withProvider({ id: "glm", kind: "glm", name: "GLM（智谱）", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiFormat: "anthropic" });
    const m = byId(buildCatalog({ GLM_API_KEY: KEY }, config));
    expect(m.glm.provider.apiKey).toBe(KEY);
    expect(m.glm.spec.configured).toBe(true);
  });

  it("uses the stored models when present, preset list otherwise", () => {
    const config = withProvider({ id: "kimi", kind: "kimi", name: "Kimi", baseUrl: "https://api.moonshot.cn/anthropic", apiFormat: "anthropic", models: ["kimi-k3"] });
    expect(byId(buildCatalog({}, config)).kimi.spec.models).toEqual(["kimi-k3"]);
    expect(byId(buildCatalog({})).kimi.spec.models).toEqual(["kimi-k2.5", "kimi-k3", "kimi-k2.6"]);
  });

  it("<KIND>_MODEL from env is hoisted to models[0] without duplicating it", () => {
    const m = byId(buildCatalog({ GLM_MODEL: "glm-4.7" }));
    expect(m.glm.spec.models).toEqual(["glm-4.7", "glm-5.2", "glm-4.5-air"]);
    expect(m.glm.provider.models[0]).toBe("glm-4.7");
  });

  it("an env model that is not in the preset list is still hoisted in", () => {
    const m = byId(buildCatalog({ DEEPSEEK_MODEL: "deepseek-experimental" }));
    expect(m.deepseek.spec.models[0]).toBe("deepseek-experimental");
    expect(m.deepseek.spec.models).toContain("deepseek-v4-flash");
  });

  it("QWEN_BASE_URL overrides the baseUrl AND moves modelsUrl to the same host", () => {
    const m = byId(buildCatalog({ QWEN_BASE_URL: "https://ws-abc.dashscope.aliyuncs.com/compatible-mode/v1" }));
    expect(m.qwen.provider.baseUrl).toBe("https://ws-abc.dashscope.aliyuncs.com/compatible-mode/v1");
    expect(m.qwen.spec.baseUrl).toBe("https://ws-abc.dashscope.aliyuncs.com/compatible-mode/v1");
    expect(m.qwen.spec.apiFormat).toBe("openai");
    expect(m.qwen.modelsUrl).toBe("https://ws-abc.dashscope.aliyuncs.com/compatible-mode/v1/models");
  });

  it("preserves the Anthropic protocol for an explicit legacy Qwen workspace URL", () => {
    const m = byId(buildCatalog({
      QWEN_BASE_URL: "https://ws-legacy.dashscope.aliyuncs.com/apps/anthropic",
    }));
    expect(m.qwen.provider.baseUrl).toBe("https://ws-legacy.dashscope.aliyuncs.com/apps/anthropic");
    expect(m.qwen.spec.apiFormat).toBe("anthropic");
  });

  it("only qwen honours a baseUrl env override (no invented *_BASE_URL for the rest)", () => {
    const m = byId(buildCatalog({ GLM_BASE_URL: "https://evil.example.com", DEEPSEEK_BASE_URL: "https://evil.example.com" }));
    expect(m.glm.provider.baseUrl).toBe("https://open.bigmodel.cn/api/anthropic");
    expect(m.deepseek.provider.baseUrl).toBe("https://api.deepseek.com/anthropic");
  });

  it("a stored baseUrl beats the QWEN_BASE_URL env override", () => {
    const config = withProvider({ id: "qwen", kind: "qwen", name: "通义千问（百炼）", baseUrl: "https://stored.dashscope.aliyuncs.com/compatible-mode/v1", apiFormat: "openai" });
    const m = byId(buildCatalog({ QWEN_BASE_URL: "https://env.dashscope.aliyuncs.com/compatible-mode/v1" }, config));
    expect(m.qwen.provider.baseUrl).toBe("https://stored.dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("a stored name/apiKeyUrl round-trips; missing ones fall back to the preset", () => {
    const config = withProvider({ id: "deepseek", kind: "deepseek", name: "工作号 DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic" });
    const m = byId(buildCatalog({}, config));
    expect(m.deepseek.spec.name).toBe("工作号 DeepSeek");
    expect(m.deepseek.spec.apiKeyUrl).toBe("https://platform.deepseek.com/api_keys");
  });
});

describe("buildCatalog — custom instances (id is an INSTANCE, kind is a FAMILY)", () => {
  const custom: ProviderDraft = {
    id: "relay-1",
    kind: "relay",
    name: "中转站甲",
    baseUrl: "https://relay.example.com/v1",
    apiFormat: "openai",
    apiKey: KEY,
    models: ["claude-sonnet-4"],
    modelsUrl: "https://relay.example.com/v1/models",
  };

  it("appends custom instances after the curated presets", () => {
    const entries = buildCatalog({}, withProvider(custom));
    const appended = entries.at(-1)!;
    expect(appended.provider.id).toBe("relay-1");
    expect(appended.spec.category).toBe("custom");
    expect(appended.spec.apiFormat).toBe("openai");
    expect(appended.provider.apiKey).toBe(KEY);
    expect(appended.modelsUrl).toBe("https://relay.example.com/v1/models");
    expect(appended.spec.saved).toBe(true);
  });

  it("a SECOND instance of a preset family coexists with the preset (same kind, different id)", () => {
    const config = upsertProvider(
      withProvider({ id: "deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic", apiKey: KEY }),
      { id: "deepseek-work", kind: "deepseek", name: "DeepSeek 工作号", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic", apiKey: KEY2 },
      () => "unused",
    ).config;
    const m = byId(buildCatalog({}, config));
    expect(Object.keys(m)).toEqual([...PRESET_PROVIDERS.map((provider) => provider.id), "deepseek-work"]);
    expect(m.deepseek.provider.apiKey).toBe(KEY);
    expect(m["deepseek-work"].provider.apiKey).toBe(KEY2);
    expect(m["deepseek-work"].spec.kind).toBe("deepseek");
    expect(m["deepseek-work"].spec.configured).toBe(true);
  });

  it("does NOT hand a non-canonical same-kind instance the family's env key", () => {
    const config = withProvider({ id: "deepseek-work", kind: "deepseek", name: "工作号", baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic" });
    const m = byId(buildCatalog({ DEEPSEEK_API_KEY: KEY }, config));
    expect(m.deepseek.provider.apiKey).toBe(KEY); // canonical instance gets it
    expect(m["deepseek-work"].provider.apiKey).toBe(""); // the second account does not
    expect(m["deepseek-work"].spec.configured).toBe(false);
  });

  it("inherits preset modelsUrl/apiKeyUrl for a same-kind custom instance that omits them", () => {
    const config = withProvider({ id: "kimi-2", kind: "kimi", name: "Kimi 二号", baseUrl: "https://api.moonshot.cn/anthropic", apiFormat: "anthropic", apiKey: KEY });
    const m = byId(buildCatalog({}, config));
    expect(m["kimi-2"].modelsUrl).toBe("https://api.moonshot.cn/v1/models");
    expect(m["kimi-2"].spec.apiKeyUrl).toBe("https://platform.moonshot.cn/console/api-keys");
  });

  it("an unknown kind gets no preset inheritance and stays listed", () => {
    const config = withProvider({ id: "selfhosted-1", kind: "selfhosted", name: "自建服务", baseUrl: "http://127.0.0.1:9000", apiFormat: "openai" });
    const m = byId(buildCatalog({}, config));
    expect(m["selfhosted-1"].spec.kind).toBe("selfhosted");
    expect(m["selfhosted-1"].modelsUrl).toBeUndefined();
    expect(m["selfhosted-1"].spec.models).toEqual([]);
    expect(m["selfhosted-1"].spec.configured).toBe(false);
  });

  it("maps human task routing to the two internal Harness overrides only", () => {
    const config = withProvider({
      ...custom,
      headers: { "X-Relay-Token": "t" },
      taskModelRouting: {
        fastModelId: "claude-fast-4",
        subagentModelId: "claude-worker-4",
      },
      capabilities: { balanceApi: false, modelDiscovery: true, multiKey: true },
    });
    const m = byId(buildCatalog({}, config));
    expect(m["relay-1"].headers).toEqual({ "X-Relay-Token": "t" });
    expect(m["relay-1"].spec.capabilities.multiKey).toBe(true);
    expect(m["relay-1"].provider.envTemplate).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-fast-4",
      CLAUDE_CODE_SUBAGENT_MODEL: "claude-worker-4",
    });
  });

  it("maps legacy fast aliases into the same human routing path", () => {
    const legacy = withProvider({
      ...custom,
      envTemplate: { ANTHROPIC_SMALL_FAST_MODEL: "legacy-fast" },
    });
    expect(byId(buildCatalog({}, legacy))["relay-1"].provider.envTemplate).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "legacy-fast",
    });

    const explicit = withProvider({
      ...custom,
      envTemplate: {
        ANTHROPIC_SMALL_FAST_MODEL: "legacy-fast",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "current-haiku",
      },
    });
    expect(byId(buildCatalog({}, explicit))["relay-1"].provider.envTemplate).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "current-haiku",
    });
  });

  it("keeps native subtask inheritance when task routing is automatic", () => {
    const config = withProvider({ ...custom, taskModelRouting: {} });
    expect(byId(buildCatalog({}, config))["relay-1"].provider.envTemplate)
      .not.toHaveProperty("CLAUDE_CODE_SUBAGENT_MODEL");
  });

  it("stored modelCapabilities override the preset's per-model flags", () => {
    const config = withProvider({
      id: "qwen",
      kind: "qwen",
      name: "通义千问（百炼）",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      apiFormat: "anthropic",
      modelCapabilities: { "qwen3.7-max": { thinking: true, vision: true } },
    });
    const m = byId(buildCatalog({}, config));
    expect(m.qwen.spec.modelCapabilities!["qwen3.7-max"]).toEqual({ thinking: true, vision: true });
    // untouched models keep the preset truth
    expect(m.qwen.spec.modelCapabilities!["qwen3.7-flash"]).toEqual({ thinking: true, vision: true });
  });

  it("projects saved capability evidence separately from preset hints", () => {
    const withoutEvidence = byId(buildCatalog({})).qwen.spec;
    expect(withoutEvidence.modelCapabilities?.["qwen3.7-flash"].vision).toBe(true);
    expect(withoutEvidence.modelCapabilityEvidence).toBeUndefined();

    const config = withProvider({
      id: "qwen",
      kind: "qwen",
      name: "通义千问（百炼）",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      apiFormat: "anthropic",
      models: ["qwen3.7-flash"],
      modelCapabilityEvidence: {
        "qwen3.7-flash": {
          image: { probe: { status: "failed", checkedAt: 101, detail: "探测请求被拒绝" } },
          reasoning: { userOverride: { supported: true, updatedAt: 102 } },
        },
      },
    });
    const spec = byId(buildCatalog({}, config)).qwen.spec;

    expect(spec.modelCapabilities?.["qwen3.7-flash"].vision).toBe(true);
    expect(spec.modelCapabilityEvidence).toEqual({
      "qwen3.7-flash": {
        image: { probe: { status: "failed", checkedAt: 101, detail: "探测请求被拒绝" } },
        reasoning: { userOverride: { supported: true, updatedAt: 102 } },
      },
    });
  });
});
