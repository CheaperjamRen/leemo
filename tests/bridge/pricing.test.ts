import { describe, it, expect } from "vitest";
import { resolvePricing, type ModelPricing } from "../../src/bridge/pricing";

// B2 Step 2 — pricing table lookups.
//
// Prices baked into src/bridge/pricing.ts retain short official source pointers.
// This suite pins behavior
// (hit/miss/override), not the exact numbers — the numbers are allowed to
// drift as Phase 1 replaces this placeholder table with the live Provider
// catalog; what must not drift is resolvePricing's contract.

describe("resolvePricing — built-in table", () => {
  it("returns a hit for deepseek/deepseek-chat with positive per-million-token rates", () => {
    const p = resolvePricing("deepseek", "deepseek-chat");
    expect(p).toBeDefined();
    expect(p!.inputPerMTok).toBeGreaterThan(0);
    expect(p!.outputPerMTok).toBeGreaterThan(0);
  });

  it("returns a hit for glm/glm-5.2", () => {
    const p = resolvePricing("glm", "glm-5.2");
    expect(p).toBeDefined();
    expect(p!.inputPerMTok).toBeGreaterThan(0);
    expect(p!.outputPerMTok).toBeGreaterThan(0);
  });

  it("returns a hit for kimi/kimi-k2.5", () => {
    const p = resolvePricing("kimi", "kimi-k2.5");
    expect(p).toBeDefined();
    expect(p!.inputPerMTok).toBeGreaterThan(0);
    expect(p!.outputPerMTok).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown providerId/modelId pair (e.g. relay gpt-5.6-luna — unconfirmable third-party pricing)", () => {
    const p = resolvePricing("relay2", "gpt-5.6-luna");
    expect(p).toBeUndefined();
  });

  it("returns undefined for a completely made-up model", () => {
    const p = resolvePricing("deepseek", "totally-not-a-real-model-xyz");
    expect(p).toBeUndefined();
  });
});

describe("resolvePricing — overrides", () => {
  it("an override for a providerId/modelId pair takes precedence over the built-in table", () => {
    const overrides: Record<string, ModelPricing> = {
      "deepseek:deepseek-chat": { inputPerMTok: 999, outputPerMTok: 888 },
    };
    const p = resolvePricing("deepseek", "deepseek-chat", overrides);
    expect(p).toEqual({ inputPerMTok: 999, outputPerMTok: 888 });
  });

  it("an override can supply pricing for a model absent from the built-in table", () => {
    const overrides: Record<string, ModelPricing> = {
      "relay2:gpt-5.6-luna": { inputPerMTok: 1, outputPerMTok: 6 },
    };
    const p = resolvePricing("relay2", "gpt-5.6-luna", overrides);
    expect(p).toEqual({ inputPerMTok: 1, outputPerMTok: 6 });
  });

  it("overrides for a different providerId/modelId key do not affect an unrelated lookup", () => {
    const overrides: Record<string, ModelPricing> = {
      "deepseek:deepseek-chat": { inputPerMTok: 999, outputPerMTok: 888 },
    };
    const p = resolvePricing("kimi", "kimi-k2.5", overrides);
    expect(p).toBeDefined();
    expect(p!.inputPerMTok).not.toBe(999);
  });
});
