import { describe, it, expect } from "vitest";
import {
  buildModelGroups,
  pickableModels,
  modelPickerLabel,
  isCurrentModel,
  orderConfiguredProviders,
} from "./model-picker";
import type { ProviderSpec } from "../../bridge/contract";

function spec(over: Partial<ProviderSpec> & { id: string }): ProviderSpec {
  return {
    name: over.id,
    kind: over.id,
    category: "cn_official",
    apiFormat: "anthropic",
    authMode: "api-key",
    baseUrl: "https://example.test/anthropic",
    models: ["m1"],
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
    ...over,
  } as ProviderSpec;
}

describe("model-picker — only configured providers are offered", () => {
  it("omits providers whose configured flag is not true", () => {
    const groups = buildModelGroups([
      spec({ id: "deepseek", configured: true, models: ["deepseek-v4-flash"] }),
      spec({ id: "glm", configured: false, models: ["glm-5.2"] }),
      spec({ id: "kimi", models: ["kimi-k2.5"] }), // flag absent entirely
    ]);
    expect(groups.map((g) => g.providerId)).toEqual(["deepseek"]);
  });

  it("never leaks an unconfigured provider's model name into the flat list", () => {
    const models = pickableModels([
      spec({ id: "deepseek", configured: true, models: ["deepseek-v4-flash"] }),
      spec({ id: "qwen", configured: false, models: ["qwen3.7-flash", "qwen3.7-plus"] }),
    ]);
    expect(models.map((m) => m.modelId)).toEqual(["deepseek-v4-flash"]);
    expect(models.some((m) => m.modelId.startsWith("qwen"))).toBe(false);
  });

  it("drops a configured provider that has no models rather than showing an empty group", () => {
    const groups = buildModelGroups([spec({ id: "relay", configured: true, models: [] })]);
    expect(groups).toEqual([]);
  });

  it("groups by INSTANCE, so two accounts of one family stay distinguishable", () => {
    const groups = buildModelGroups([
      spec({ id: "deepseek", kind: "deepseek", name: "DeepSeek", configured: true, models: ["deepseek-v4-flash"] }),
      spec({ id: "deepseek-work", kind: "deepseek", name: "DeepSeek(工作)", configured: true, models: ["deepseek-v4-flash"] }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.providerId)).toEqual(["deepseek", "deepseek-work"]);
    // Same model name under both — the pairing is what disambiguates.
    expect(groups.every((g) => g.options[0].modelId === "deepseek-v4-flash")).toBe(true);
  });

  it("resolves measured capability evidence instead of treating preset flags as verdicts", () => {
    const [group] = buildModelGroups([
      spec({
        id: "qwen",
        configured: true,
        models: ["qwen3.7-flash", "qwen3.7-max"],
        modelCapabilities: {
          "qwen3.7-flash": { thinking: true, vision: true },
          "qwen3.7-max": { thinking: true, vision: false },
        },
        modelCapabilityEvidence: {
          "qwen3.7-flash": {
            image: { probe: { status: "failed", checkedAt: 10 } },
            reasoning: { probe: { status: "verified", checkedAt: 10 } },
          },
          "qwen3.7-max": {
            image: {
              probe: { status: "failed", checkedAt: 11 },
              userOverride: { supported: true, updatedAt: 12 },
            },
          },
        },
      }),
    ]);
    expect(group.options[0]).toMatchObject({
      modelId: "qwen3.7-flash",
      imageStatus: "failed",
      imageSource: "probe",
      reasoningStatus: "verified",
      reasoningSource: "probe",
    });
    expect(group.options[1]).toMatchObject({
      modelId: "qwen3.7-max",
      imageStatus: "verified",
      imageSource: "user",
      reasoningStatus: "unknown",
      reasoningSource: "preset",
    });
  });

  it("keeps missing evidence unknown even when a preset hint exists", () => {
    const [group] = buildModelGroups([
      spec({
        id: "custom",
        configured: true,
        models: ["hinted", "mystery-1"],
        modelCapabilities: { hinted: { thinking: false, vision: true } },
      }),
    ]);
    expect(group.options[0]).toMatchObject({
      imageStatus: "unknown",
      imageSource: "preset",
      reasoningStatus: "unknown",
      reasoningSource: "preset",
    });
    expect(group.options[1]).toMatchObject({
      imageStatus: "unknown",
      imageSource: "none",
      reasoningStatus: "unknown",
      reasoningSource: "none",
    });
  });
});

describe("model-picker — trigger label", () => {
  it("shows the conversation's real model, not a hardcoded default", () => {
    expect(modelPickerLabel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("prompts instead of claiming a model when none is resolved", () => {
    expect(modelPickerLabel(null)).toBe("选择模型");
    expect(modelPickerLabel(undefined)).toBe("选择模型");
    expect(modelPickerLabel("   ")).toBe("选择模型");
  });
});

describe("model-picker — provider and model priority", () => {
  const list = [
    spec({ id: "alpha", configured: true, models: ["shared", "alpha-fast"] }),
    spec({ id: "beta", configured: true, models: ["shared", "beta-best"] }),
    spec({ id: "empty", configured: true, models: [] }),
    spec({ id: "offer", configured: false, models: ["offer-model"] }),
  ];

  it("uses known provider ids, drops stale ids, and appends new providers stably", () => {
    const ordered = orderConfiguredProviders(list, ["missing", "beta"]);
    expect(ordered.map((provider) => provider.id)).toEqual(["beta", "alpha"]);
  });

  it("migrates an old default pair to the first provider and first model only when order is empty", () => {
    const ordered = orderConfiguredProviders(list, [], {
      providerId: "beta",
      modelId: "beta-best",
    });
    expect(ordered.map((provider) => provider.id)).toEqual(["beta", "alpha"]);
    expect(ordered[0].models).toEqual(["beta-best", "shared"]);
    expect(list[1].models).toEqual(["shared", "beta-best"]); // pure, no mutation
  });

  it("distinguishes the same model name by provider pair during migration", () => {
    const ordered = orderConfiguredProviders(list, [], {
      providerId: "beta",
      modelId: "shared",
    });
    expect(ordered[0].id).toBe("beta");
    expect(ordered[0].models[0]).toBe("shared");
  });

  it("lets the next stable provider take over when the old default provider was deleted", () => {
    const ordered = orderConfiguredProviders(list, [], {
      providerId: "deleted",
      modelId: "shared",
    });
    expect(ordered.map((provider) => provider.id)).toEqual(["alpha", "beta"]);
  });

  it("ignores legacy defaults once an explicit provider order exists", () => {
    const ordered = orderConfiguredProviders(list, ["alpha", "beta"], {
      providerId: "beta",
      modelId: "beta-best",
    });
    expect(ordered.map((provider) => provider.id)).toEqual(["alpha", "beta"]);
    expect(ordered[1].models).toEqual(["shared", "beta-best"]);
  });
});

describe("model-picker — current-model marking", () => {
  const opt = {
    providerId: "deepseek",
    providerName: "DeepSeek",
    modelId: "m",
    imageStatus: "unknown" as const,
    imageSource: "none" as const,
    reasoningStatus: "unknown" as const,
    reasoningSource: "none" as const,
  };

  it("matches on the (provider, model) pair", () => {
    expect(isCurrentModel(opt, "deepseek", "m")).toBe(true);
    expect(isCurrentModel(opt, "deepseek-work", "m")).toBe(false);
    expect(isCurrentModel(opt, "deepseek", "other")).toBe(false);
  });

  it("falls back to model-only match when the provider is unknown", () => {
    expect(isCurrentModel(opt, null, "m")).toBe(true);
    expect(isCurrentModel(opt, undefined, "m")).toBe(true);
  });

  it("marks nothing when there is no current model", () => {
    expect(isCurrentModel(opt, "deepseek", null)).toBe(false);
  });
});
