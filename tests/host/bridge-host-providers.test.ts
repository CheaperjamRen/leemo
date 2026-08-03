/**
 * The provider-configuration channels (轮 3 卡 F).
 *
 * This file covers the INTEGRATION SEAM that was missing when the round was first
 * reported done: the contract declared five channels, the host had the logic
 * modules, the renderer had the UI — and nothing connected them, so every
 * "test connection" / "fetch models" / "save" was dead on a real machine.
 */
import { describe, it, expect } from "vitest";
import {
  createBridgeHost,
  providerNeedsAnthropicShim,
  type HostDeps,
  type ProviderConfigStore,
} from "../../src/host/bridge-host";
import { buildCatalog, PRESET_PROVIDERS } from "../../src/host/provider-catalog";
import { emptyConfig, type ProviderConfigFile } from "../../src/host/provider-config";
import type { BridgeEventMap, ProviderDraft } from "../../src/bridge/contract";

/** A provider store backed by memory, mirroring main.ts: write() persists AND
 *  rebuilds, so a later read sees the new instance. */
function makeStore(env: Record<string, string | undefined> = {}) {
  let config: ProviderConfigFile = emptyConfig();
  let catalog = buildCatalog(env, config);
  let writes = 0;
  const store: ProviderConfigStore = {
    read: () => config,
    write: (next) => {
      writes += 1;
      config = next;
      catalog = buildCatalog(env, config);
    },
  };
  return {
    store,
    getCatalog: () => catalog,
    writeCount: () => writes,
    currentConfig: () => config,
  };
}

function makeHost(
  over: Partial<HostDeps> & { catalog: HostDeps["catalog"] },
): ReturnType<typeof createBridgeHost> {
  const pushed: { channel: keyof BridgeEventMap }[] = [];
  return createBridgeHost({
    dataDir: "/tmp/data",
    workspaceRoot: "/tmp/workspace",
    push: (channel) => pushed.push({ channel }),
    ...over,
  });
}

/** Minimal fetch fake: one 200 anthropic-shaped reply. */
function okFetch(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("bridge:listProviders — presets are offered even with no key", () => {
  it("lists the curated catalog, flagged configured:false", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    expect(specs.map((x) => x.id)).toEqual(PRESET_PROVIDERS.map((provider) => provider.id));
    expect(specs.every((x) => x.configured === false)).toBe(true);
  });

  it("marks a family configured once env supplies its key", async () => {
    const s = makeStore({ GLM_API_KEY: "sk-env-glm" });
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    expect(specs.find((x) => x.id === "glm")?.configured).toBe(true);
    expect(specs.find((x) => x.id === "kimi")?.configured).toBe(false);
  });
});

describe("bridge:createConversation — refuses an unconfigured provider", () => {
  it("fails with a human-readable message, not an upstream 401", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    await expect(
      host.handleInvoke("bridge:createConversation", { providerId: "qwen", modelId: "qwen3.7-flash" }),
    ).rejects.toThrow(/还没有配置 API Key/);
  });

  it("names the provider so the user knows WHICH one to configure", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    await expect(
      host.handleInvoke("bridge:createConversation", { providerId: "glm", modelId: "glm-5.2" }),
    ).rejects.toThrow(/GLM/);
  });
});

describe("Anthropic provider runtime wiring", () => {
  it("uses the transparent shim only when search or provider-specific transport requires it", () => {
    const catalog = buildCatalog({}, emptyConfig());
    const deepseek = catalog.find((entry) => entry.provider.id === "deepseek")!;
    const minimaxPlan = catalog.find((entry) => entry.provider.id === "minimax-token-plan")!;
    const withHeaders = {
      ...deepseek,
      headers: { "X-Tenant": "workspace-7" },
    };

    expect(providerNeedsAnthropicShim(deepseek, false)).toBe(false);
    expect(providerNeedsAnthropicShim(deepseek, true)).toBe(true);
    expect(providerNeedsAnthropicShim(minimaxPlan, false)).toBe(true);
    expect(providerNeedsAnthropicShim(withHeaders, false)).toBe(true);
  });
});

describe("bridge:saveProvider — applies without a restart", () => {
  it("a saved key makes the family configured on the very next listProviders", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });

    const before = await host.handleInvoke("bridge:listProviders", undefined);
    expect(before.find((x) => x.id === "deepseek")?.configured).toBe(false);

    const draft: ProviderDraft = {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      apiKey: "sk-freshly-saved",
    };
    const saved = await host.handleInvoke("bridge:saveProvider", draft);
    expect(saved.configured).toBe(true);

    // The point of the getter-not-array catalog: no restart needed.
    const after = await host.handleInvoke("bridge:listProviders", undefined);
    expect(after.find((x) => x.id === "deepseek")?.configured).toBe(true);
  });

  it("a saved local provider with a model is configured without an API key", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });

    const saved = await host.handleInvoke("bridge:saveProvider", {
      id: "ollama",
      kind: "ollama",
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiFormat: "openai",
      authMode: "none",
      models: ["qwen-local"],
    });

    expect(saved.configured).toBe(true);
    expect(saved.authMode).toBe("none");
    expect(s.currentConfig().providers.ollama.apiKey).toBeUndefined();
  });

  it("mints an id for a custom instance and keeps it separate from its family preset", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const saved = await host.handleInvoke("bridge:saveProvider", {
      kind: "deepseek",
      name: "DeepSeek(工作号)",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      apiKey: "sk-second-account",
      category: "custom",
    });
    expect(saved.id).not.toBe("deepseek");
    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    // Preset + custom instance of the SAME family coexist.
    const deepseeks = specs.filter((x) => x.kind === "deepseek");
    expect(deepseeks).toHaveLength(2);
    expect(deepseeks.filter((x) => x.configured).map((x) => x.id)).toEqual([saved.id]);
  });

  it("reports a clear error when the platform cannot persist", async () => {
    const s = makeStore();
    const throwing: ProviderConfigStore = {
      read: s.store.read,
      write: () => {
        throw new Error("系统加密不可用，无法安全保存 API key（不会以明文落盘）。");
      },
    };
    const host = makeHost({ catalog: s.getCatalog, providerStore: throwing });
    await expect(
      host.handleInvoke("bridge:saveProvider", {
        kind: "glm",
        name: "GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiFormat: "anthropic",
        apiKey: "sk-x",
      }),
    ).rejects.toThrow(/加密不可用/);
  });

  it("refuses to save at all when no store is wired (dev/env-only host)", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog }); // no providerStore
    await expect(
      host.handleInvoke("bridge:saveProvider", {
        kind: "glm",
        name: "GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiFormat: "anthropic",
        apiKey: "sk-x",
      }),
    ).rejects.toThrow(/不支持保存/);
  });
});

describe("bridge:getProviderConfig — the key never crosses IPC", () => {
  it("reports hasApiKey + a masked tail, never the secret", async () => {
    const s = makeStore({ KIMI_API_KEY: "sk-super-secret-tail9999" });
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const view = await host.handleInvoke("bridge:getProviderConfig", { providerId: "kimi" });
    expect(view?.hasApiKey).toBe(true);
    expect(view?.apiKeyMasked).toBe("····9999");
    // The whole projection must not contain the key anywhere.
    expect(JSON.stringify(view)).not.toContain("sk-super-secret-tail9999");
  });

  it("carries the discovery URL and the key-signup link for the form", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const view = await host.handleInvoke("bridge:getProviderConfig", { providerId: "qwen" });
    // Measured: qwen's discovery lives on compatible-mode, NOT the anthropic base.
    expect(view?.modelsUrl).toContain("/compatible-mode/v1/models");
    expect(view?.apiKeyUrl).toBeTruthy();
    expect(view?.hasApiKey).toBe(false);
    expect(view?.saved).toBe(false); // a preset offer is not a saved instance
  });

  it("never returns secret header values and only exposes their configured names", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    await host.handleInvoke("bridge:saveProvider", {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      apiKey: "sk-provider-key",
      headers: {
        Authorization: "Bearer auth-secret",
        "Proxy-Authorization": "Basic proxy-secret",
        "x-api-key": "header-api-secret",
        "X-Relay-Token": "relay-secret",
        "User-Agent": "Leemo-Test/1",
      },
    });

    const view = await host.handleInvoke("bridge:getProviderConfig", { providerId: "deepseek" });
    expect(view?.headers).toEqual({ "User-Agent": "Leemo-Test/1" });
    expect(view?.secretHeaderKeys).toEqual([
      "Authorization",
      "Proxy-Authorization",
      "x-api-key",
      "X-Relay-Token",
    ]);
    const payload = JSON.stringify(view);
    for (const secret of ["auth-secret", "proxy-secret", "header-api-secret", "relay-secret"]) {
      expect(payload).not.toContain(secret);
    }
  });

  it("returns saved capability evidence through list and config views without returning the API key", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    await host.handleInvoke("bridge:saveProvider", {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      apiKey: "sk-evidence-secret",
      models: ["deepseek-v4-flash"],
      modelCapabilityEvidence: {
        "deepseek-v4-flash": {
          image: { probe: { status: "failed", checkedAt: 101, detail: "未识别图片" } },
          reasoning: { userOverride: { supported: true, updatedAt: 102 } },
        },
      },
    });

    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    const spec = specs.find((provider) => provider.id === "deepseek");
    const view = await host.handleInvoke("bridge:getProviderConfig", { providerId: "deepseek" });

    expect(spec?.modelCapabilityEvidence).toEqual(view?.modelCapabilityEvidence);
    expect(spec?.modelCapabilityEvidence?.["deepseek-v4-flash"].reasoning?.userOverride)
      .toEqual({ supported: true, updatedAt: 102 });
    expect(JSON.stringify({ spec, view })).not.toContain("sk-evidence-secret");
  });

  it("projects human task routing instead of requiring internal model aliases", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    await host.handleInvoke("bridge:saveProvider", {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      apiKey: "sk-routing-secret",
      taskModelRouting: {
        fastModelId: "deepseek-v4-flash",
        subagentModelId: "deepseek-v4-pro",
      },
    });

    const view = await host.handleInvoke("bridge:getProviderConfig", { providerId: "deepseek" });
    expect(view?.taskModelRouting).toEqual({
      fastModelId: "deepseek-v4-flash",
      subagentModelId: "deepseek-v4-pro",
    });
    expect(JSON.stringify(view)).not.toContain("sk-routing-secret");
  });

  it("returns null for an unknown id", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    expect(await host.handleInvoke("bridge:getProviderConfig", { providerId: "nope" })).toBeNull();
  });
});

describe("bridge:deleteProvider", () => {
  it("a preset reverts to an unconfigured OFFER rather than vanishing", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    await host.handleInvoke("bridge:saveProvider", {
      id: "glm",
      kind: "glm",
      name: "GLM",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiFormat: "anthropic",
      apiKey: "sk-glm",
    });
    await host.handleInvoke("bridge:deleteProvider", { providerId: "glm" });

    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    const glm = specs.find((x) => x.id === "glm");
    expect(glm).toBeDefined(); // still offered
    expect(glm?.configured).toBe(false); // but no longer configured
  });

  it("a custom instance disappears entirely", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const saved = await host.handleInvoke("bridge:saveProvider", {
      kind: "custom",
      name: "某中转站",
      baseUrl: "https://relay.example.test/v1",
      apiFormat: "openai",
      apiKey: "sk-relay",
      category: "custom",
    });
    await host.handleInvoke("bridge:deleteProvider", { providerId: saved.id });
    const specs = await host.handleInvoke("bridge:listProviders", undefined);
    expect(specs.find((x) => x.id === saved.id)).toBeUndefined();
  });
});

describe("bridge:testConnection", () => {
  it("probes the resolved provider and reports latency + model echo", async () => {
    const s = makeStore({ DEEPSEEK_API_KEY: "sk-env-deepseek" });
    const host = makeHost({
      catalog: s.getCatalog,
      providerStore: s.store,
      fetchFn: okFetch({ model: "deepseek-v4-flash", content: [{ type: "text", text: "pong" }] }),
    });
    const result = await host.handleInvoke("bridge:testConnection", { providerId: "deepseek" });
    expect(result.ok).toBe(true);
    expect(result.modelEcho).toBe("deepseek-v4-flash");
    expect(result.capabilityProbes?.image.status).toBe("unknown");
    expect(result.capabilityProbes?.reasoning.status).toBe("unknown");
    // Compatibility fields still avoid inventing a boolean verdict.
    expect(result.vision).toBeUndefined();
    expect(result.visionProbeError).toBeUndefined();
  });

  it("an EDIT draft with no apiKey falls back to the stored key", async () => {
    // 「留空即不改」: otherwise "rename, then test" would report a bogus auth error.
    const s = makeStore({ KIMI_API_KEY: "sk-stored-kimi" });
    let sawAuth = "";
    const host = makeHost({
      catalog: s.getCatalog,
      providerStore: s.store,
      fetchFn: (async (_url: string, init: RequestInit) => {
        sawAuth = String((init.headers as Record<string, string>)?.authorization ?? "");
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ model: "kimi-k2.5", content: [{ type: "text", text: "pong" }] }),
        };
      }) as unknown as typeof fetch,
    });
    const result = await host.handleInvoke("bridge:testConnection", {
      providerId: "kimi",
      draft: {
        id: "kimi",
        kind: "kimi",
        name: "Kimi 改了个名",
        baseUrl: "https://api.moonshot.cn/anthropic",
        apiFormat: "anthropic",
        // no apiKey — the form left it blank
      },
    });
    expect(result.ok).toBe(true);
    expect(sawAuth).toContain("sk-stored-kimi");
  });

  it("refuses before any request when there is no key at all", async () => {
    const s = makeStore();
    let called = false;
    const host = makeHost({
      catalog: s.getCatalog,
      providerStore: s.store,
      fetchFn: (async () => {
        called = true;
        return { ok: true, status: 200, text: async () => "{}" };
      }) as unknown as typeof fetch,
    });
    const result = await host.handleInvoke("bridge:testConnection", {
      draft: {
        kind: "custom",
        name: "新的",
        baseUrl: "https://relay.example.test",
        apiFormat: "openai",
        models: ["m1"],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("auth");
    expect(called).toBe(false); // no pointless upstream call
  });

  it("tests a declared key-free local service without an Authorization header", async () => {
    const s = makeStore();
    let sawAuthorization = false;
    const host = makeHost({
      catalog: s.getCatalog,
      providerStore: s.store,
      fetchFn: (async (_url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string> | undefined;
        sawAuthorization ||= Boolean(headers?.authorization || headers?.Authorization);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            model: "qwen-local",
            choices: [{ message: { content: "OK" } }],
          }),
        };
      }) as unknown as typeof fetch,
    });

    const result = await host.handleInvoke("bridge:testConnection", {
      draft: {
        kind: "ollama",
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiFormat: "openai",
        authMode: "none",
        models: ["qwen-local"],
      },
    });

    expect(result.ok).toBe(true);
    expect(sawAuthorization).toBe(false);
  });

  it("asks for a model instead of guessing when none is available", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const result = await host.handleInvoke("bridge:testConnection", {
      draft: {
        kind: "custom",
        name: "新的",
        baseUrl: "https://relay.example.test",
        apiFormat: "openai",
        apiKey: "sk-x",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/模型/);
  });
});

describe("bridge:listRemoteModels", () => {
  it("pulls from the family's own discovery URL", async () => {
    const s = makeStore({ GLM_API_KEY: "sk-glm" });
    let calledUrl = "";
    const host = makeHost({
      catalog: s.getCatalog,
      providerStore: s.store,
      fetchFn: (async (url: string) => {
        calledUrl = String(url);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "glm-5.2" }, { id: "glm-4.7" }] }),
        };
      }) as unknown as typeof fetch,
    });
    const result = await host.handleInvoke("bridge:listRemoteModels", { providerId: "glm" });
    expect(calledUrl).toBe("https://open.bigmodel.cn/api/anthropic/v1/models");
    expect(result.models.map((m) => m.id)).toEqual(["glm-4.7", "glm-5.2"]);
  });

  it("tells the user to hand-type when the provider exposes no discovery URL", async () => {
    const s = makeStore();
    const host = makeHost({ catalog: s.getCatalog, providerStore: s.store });
    const result = await host.handleInvoke("bridge:listRemoteModels", {
      draft: {
        kind: "custom",
        name: "某中转站",
        baseUrl: "https://relay.example.test/v1",
        apiFormat: "openai",
        apiKey: "sk-relay",
      },
    });
    expect(result.models).toEqual([]);
    expect(result.error?.message).toMatch(/手敲/);
  });
});
