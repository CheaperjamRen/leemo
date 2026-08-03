import { describe, expect, it, vi } from "vitest";
import { createProvidersStore, DRAFT_TEST_KEY } from "./providers";
import type { BridgeClient } from "../bridge/client";
import type {
  ProviderSpec,
  ProviderConfigView,
  ProviderDraft,
  ConnectionTestResult,
} from "../../bridge/contract";
import type { BalanceInfo } from "../../bridge/contract";

const balanceProvider: ProviderSpec = {
  id: "alpha", name: "Alpha", kind: "custom", category: "custom",
  apiFormat: "openai", authMode: "api-key", baseUrl: "https://example.test",
  models: ["alpha-1"], capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
  configured: true,
};
const noBalanceProvider: ProviderSpec = {
  ...balanceProvider, id: "local", name: "Local",
  authMode: "none", capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false, local: true },
  configured: true,
};
const unconfiguredProvider: ProviderSpec = {
  id: "glm", name: "GLM（智谱）", kind: "glm", category: "cn_official",
  apiFormat: "anthropic", authMode: "api-key", baseUrl: "https://open.bigmodel.cn/api/anthropic",
  models: ["glm-5.2"], capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false },
  configured: false,
};

function client(invoke: BridgeClient["invoke"]): BridgeClient {
  return { invoke, subscribe: vi.fn(() => () => {}) } as BridgeClient;
}

describe("providers store", () => {
  it("uses a key-free loading empty initial state and clones initial data", () => {
    const list = [balanceProvider];
    const configuredIds = ["alpha"];
    const store = createProvidersStore(client(vi.fn()), { list, configuredIds });

    expect(store.getState().status).toBe("ready");
    expect(store.getState().list).toEqual(list);
    expect(store.getState().list).not.toBe(list);
    expect(store.getState().configuredIds).toEqual(configuredIds);
    expect(store.getState().balances).toEqual({});
    expect(JSON.stringify(store.getState())).not.toMatch(/apiKey|token|secret/i);

    const empty = createProvidersStore(client(vi.fn()));
    expect(empty.getState()).toMatchObject({ list: [], status: "loading", configuredIds: [], balances: {} });
  });

  it("deep-clones model capability hints and evidence instead of sharing nested state", async () => {
    const provider: ProviderSpec = {
      ...balanceProvider,
      modelCapabilities: { "alpha-1": { thinking: true, vision: true } },
      modelCapabilityEvidence: {
        "alpha-1": {
          image: { probe: { status: "verified", checkedAt: 101, detail: "识别成功" } },
          reasoning: { userOverride: { supported: true, updatedAt: 102 } },
        },
      },
    };
    const response = [provider];
    const invoke = vi.fn().mockResolvedValue(response);
    const store = createProvidersStore(client(invoke));

    await store.getState().refresh();
    provider.modelCapabilities!["alpha-1"].vision = false;
    provider.modelCapabilityEvidence!["alpha-1"].image!.probe!.detail = "外部改写";
    provider.modelCapabilityEvidence!["alpha-1"].reasoning!.userOverride!.updatedAt = 999;

    const stored = store.getState().list[0];
    expect(stored.modelCapabilities?.["alpha-1"].vision).toBe(true);
    expect(stored.modelCapabilityEvidence?.["alpha-1"].image?.probe?.detail).toBe("识别成功");
    expect(stored.modelCapabilityEvidence?.["alpha-1"].reasoning?.userOverride?.updatedAt).toBe(102);
  });

  it("refreshes providers atomically and clears a prior error", async () => {
    const invoke = vi.fn().mockResolvedValue([balanceProvider]);
    const store = createProvidersStore(client(invoke), { list: [noBalanceProvider] });

    await store.getState().refresh();

    expect(invoke).toHaveBeenCalledWith("bridge:listProviders", undefined);
    expect(store.getState().list).toEqual([balanceProvider]);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBeUndefined();
  });

  it("preserves old list and records a safe error when refresh fails", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("apiKey=sk-live-secret"));
    const store = createProvidersStore(client(invoke), { list: [balanceProvider] });

    await expect(store.getState().refresh()).resolves.toBeUndefined();

    expect(store.getState().list).toEqual([balanceProvider]);
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toBeTruthy();
    expect(store.getState().error).not.toContain("sk-live-secret");
  });

  it("invokes balance only when the provider declares balanceApi", async () => {
    const info: BalanceInfo = { supported: true, totalCny: 12 };
    const invoke = vi.fn().mockResolvedValue(info);
    const store = createProvidersStore(client(invoke), { list: [balanceProvider, noBalanceProvider] });

    await store.getState().fetchBalance("alpha");
    await store.getState().fetchBalance("local");
    await store.getState().fetchBalance("missing");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("bridge:fetchBalance", { providerId: "alpha" });
    expect(store.getState().balances.alpha).toMatchObject({ info });
    expect(store.getState().balances.local).toBeUndefined();
    expect(store.getState().balances.missing).toBeUndefined();
  });

  it("syncs configuredIds from the returned list on refresh", async () => {
    const invoke = vi.fn().mockResolvedValue([balanceProvider, noBalanceProvider]);
    const store = createProvidersStore(client(invoke));

    await store.getState().refresh();

    expect(store.getState().configuredIds).toEqual(["alpha", "local"]);
  });

  it("splits list into configured/unconfigured by spec.configured, never by kind or id membership", async () => {
    const invoke = vi.fn().mockResolvedValue([balanceProvider, unconfiguredProvider, noBalanceProvider]);
    const store = createProvidersStore(client(invoke));

    await store.getState().refresh();

    expect(store.getState().configured.map((p) => p.id)).toEqual(["alpha", "local"]);
    expect(store.getState().unconfigured.map((p) => p.id)).toEqual(["glm"]);
  });

  it("derives configured/unconfigured on the seeded initial state too (not just after refresh)", () => {
    const store = createProvidersStore(client(vi.fn()), {
      list: [balanceProvider, unconfiguredProvider],
    });

    expect(store.getState().configured.map((p) => p.id)).toEqual(["alpha"]);
    expect(store.getState().unconfigured.map((p) => p.id)).toEqual(["glm"]);
  });

  it("treats configured:undefined as unconfigured (strict === true check, not truthiness)", () => {
    const noOpinion: ProviderSpec = { ...unconfiguredProvider, id: "no-opinion", configured: undefined };
    const store = createProvidersStore(client(vi.fn()), { list: [noOpinion] });

    expect(store.getState().configured).toEqual([]);
    expect(store.getState().unconfigured.map((p) => p.id)).toEqual(["no-opinion"]);
  });
});

describe("providers store — getConfig", () => {
  const configView: ProviderConfigView = {
    id: "alpha", kind: "custom", name: "Alpha", baseUrl: "https://example.test",
    apiFormat: "openai", authMode: "api-key", category: "custom", models: ["alpha-1"],
    capabilities: { balanceApi: true, modelDiscovery: false, subscriptionPlan: false },
    hasApiKey: true, apiKeyMasked: "····a1b2", saved: true,
  };

  it("returns the config view from the bridge", async () => {
    const invoke = vi.fn().mockResolvedValue(configView);
    const store = createProvidersStore(client(invoke));

    const result = await store.getState().getConfig("alpha");

    expect(invoke).toHaveBeenCalledWith("bridge:getProviderConfig", { providerId: "alpha" });
    expect(result).toEqual(configView);
  });

  it("passes through null for an unknown id", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const store = createProvidersStore(client(invoke));

    expect(await store.getState().getConfig("missing")).toBeNull();
  });

  it("never throws — a rejected invoke resolves to null", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("apiKey=sk-leak"));
    const store = createProvidersStore(client(invoke));

    await expect(store.getState().getConfig("alpha")).resolves.toBeNull();
  });
});

describe("providers store — saveProvider", () => {
  const draft: ProviderDraft = {
    kind: "custom", name: "中转站", baseUrl: "https://relay.test", apiFormat: "openai", apiKey: "sk-live",
  };

  it("saves, then refreshes so the UI sees the change immediately", async () => {
    const savedSpec: ProviderSpec = { ...balanceProvider, id: "relay-1", name: "中转站" };
    const invoke = vi.fn()
      .mockResolvedValueOnce(savedSpec) // bridge:saveProvider
      .mockResolvedValueOnce([savedSpec]); // bridge:listProviders (refresh)
    const store = createProvidersStore(client(invoke));

    const result = await store.getState().saveProvider(draft);

    expect(invoke).toHaveBeenNthCalledWith(1, "bridge:saveProvider", draft);
    expect(invoke).toHaveBeenNthCalledWith(2, "bridge:listProviders", undefined);
    expect(result).toEqual({ ok: true, spec: savedSpec });
    expect(store.getState().list).toEqual([savedSpec]);
  });

  it("returns a safe ok:false on failure, never the raw upstream error text", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("apiKey=sk-secret-123 rejected"));
    const store = createProvidersStore(client(invoke));

    const result = await store.getState().saveProvider(draft);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("sk-secret-123");
    }
  });

  it("keeps the saved provider visible when the write succeeds but catalog refresh fails", async () => {
    const savedSpec: ProviderSpec = { ...balanceProvider, id: "relay-1", name: "中转站" };
    const invoke = vi.fn()
      .mockResolvedValueOnce(savedSpec)
      .mockRejectedValueOnce(new Error("refresh failed"));
    const store = createProvidersStore(client(invoke), { list: [balanceProvider] });

    const result = await store.getState().saveProvider(draft);

    expect(result).toEqual({ ok: true, spec: savedSpec });
    expect(store.getState().list.map((provider) => provider.id)).toEqual(["alpha", "relay-1"]);
    expect(store.getState().status).toBe("error");
  });
});

describe("providers store — deleteProvider", () => {
  it("calls the bridge by id and refreshes afterwards", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(undefined) // bridge:deleteProvider
      .mockResolvedValueOnce([]); // bridge:listProviders (refresh)
    const store = createProvidersStore(client(invoke), { list: [balanceProvider] });

    await store.getState().deleteProvider("alpha");

    expect(invoke).toHaveBeenNthCalledWith(1, "bridge:deleteProvider", { providerId: "alpha" });
    expect(invoke).toHaveBeenNthCalledWith(2, "bridge:listProviders", undefined);
    expect(store.getState().list).toEqual([]);
  });

  it("still refreshes (via finally) even if the delete call rejects, then re-throws for the caller", async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([balanceProvider]);
    const store = createProvidersStore(client(invoke));

    await expect(store.getState().deleteProvider("alpha")).rejects.toThrow("boom");
    expect(invoke).toHaveBeenCalledWith("bridge:listProviders", undefined);
    expect(store.getState().list).toEqual([balanceProvider]);
  });

  it("removes the provider locally when delete succeeds but catalog refresh fails", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("refresh failed"));
    const store = createProvidersStore(client(invoke), { list: [balanceProvider, noBalanceProvider] });

    await expect(store.getState().deleteProvider("alpha")).resolves.toBeUndefined();

    expect(store.getState().list.map((provider) => provider.id)).toEqual(["local"]);
    expect(store.getState().status).toBe("error");
  });
});

describe("providers store — testConnection", () => {
  it("keys the result under the saved instance's id", async () => {
    const result: ConnectionTestResult = { ok: true, latencyMs: 120, thinking: true, vision: false };
    const invoke = vi.fn().mockResolvedValue(result);
    const store = createProvidersStore(client(invoke));

    const promise = store.getState().testConnection({ providerId: "alpha" });
    expect(store.getState().tests.alpha).toEqual({ pending: true });
    await promise;

    expect(invoke).toHaveBeenCalledWith("bridge:testConnection", { providerId: "alpha" });
    expect(store.getState().tests.alpha).toEqual(result);
  });

  it("keys an unsaved draft's result under __draft__", async () => {
    const draft: ProviderDraft = { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai" };
    const result: ConnectionTestResult = { ok: true, latencyMs: 80 };
    const invoke = vi.fn().mockResolvedValue(result);
    const store = createProvidersStore(client(invoke));

    await store.getState().testConnection({ draft });

    expect(store.getState().tests[DRAFT_TEST_KEY]).toEqual(result);
    expect(store.getState().tests.alpha).toBeUndefined();
  });

  it("distinguishes vision:undefined (not probed) from vision:false (probed, unsupported)", async () => {
    const notProbed: ConnectionTestResult = { ok: true, latencyMs: 50 };
    const probedNo: ConnectionTestResult = { ok: true, latencyMs: 50, vision: false };
    const invoke = vi.fn().mockResolvedValueOnce(notProbed).mockResolvedValueOnce(probedNo);
    const store = createProvidersStore(client(invoke));

    await store.getState().testConnection({ providerId: "alpha" });
    const first = store.getState().tests.alpha as ConnectionTestResult;
    expect(first.vision).toBeUndefined();
    expect("vision" in first).toBe(false);

    await store.getState().testConnection({ providerId: "alpha", probeVision: true });
    const second = store.getState().tests.alpha as ConnectionTestResult;
    expect(second.vision).toBe(false);
  });

  it("turns a rejected invoke into a structured ProviderError, not a thrown exception", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("apiKey=sk-leak network fail"));
    const store = createProvidersStore(client(invoke));

    await expect(store.getState().testConnection({ providerId: "alpha" })).resolves.toMatchObject({
      ok: false,
      error: { kind: "unknown" },
    });
    const entry = store.getState().tests.alpha as ConnectionTestResult;
    expect(entry.ok).toBe(false);
    expect(entry.error?.message).not.toContain("sk-leak");
  });
});

describe("providers store — listRemoteModels", () => {
  it("keys models under the saved instance's id", async () => {
    const invoke = vi.fn().mockResolvedValue({ models: [{ id: "m-1" }, { id: "m-2" }] });
    const store = createProvidersStore(client(invoke));

    const promise = store.getState().listRemoteModels({ providerId: "alpha" });
    expect(store.getState().remoteModels.alpha).toEqual({ pending: true });
    await promise;

    expect(invoke).toHaveBeenCalledWith("bridge:listRemoteModels", { providerId: "alpha" });
    expect(store.getState().remoteModels.alpha).toEqual({ models: [{ id: "m-1" }, { id: "m-2" }] });
  });

  it("keys an unsaved draft's models under __draft__", async () => {
    const draft: ProviderDraft = { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai" };
    const invoke = vi.fn().mockResolvedValue({ models: [{ id: "m-1" }] });
    const store = createProvidersStore(client(invoke));

    await store.getState().listRemoteModels({ draft });

    expect(store.getState().remoteModels[DRAFT_TEST_KEY]).toEqual({ models: [{ id: "m-1" }] });
  });

  it("stores a structured error from the response, without discarding it as a thrown failure", async () => {
    const invoke = vi.fn().mockResolvedValue({
      models: [],
      error: { kind: "auth" as const, message: "API key 无效或已过期，请检查设置里填的 key 是否正确。" },
    });
    const store = createProvidersStore(client(invoke));

    await store.getState().listRemoteModels({ providerId: "alpha" });

    expect(store.getState().remoteModels.alpha).toEqual({
      error: { kind: "auth", message: "API key 无效或已过期，请检查设置里填的 key 是否正确。" },
    });
  });

  it("never throws on a rejected invoke — resolves to a safe structured error", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("apiKey=sk-leak"));
    const store = createProvidersStore(client(invoke));

    await expect(store.getState().listRemoteModels({ providerId: "alpha" })).resolves.toMatchObject({
      models: [],
      error: { kind: "unknown" },
    });
    const entry = store.getState().remoteModels.alpha as { error: { message: string } };
    expect(entry.error.message).not.toContain("sk-leak");
  });
});
