import { describe, it, expect } from "vitest";
import { normalizeThinking, EFFORT_BUDGET_MAP, DEFAULT_THINKING_BUDGET } from "@gateway/core/normalize";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { thinkingRequest, simpleTextRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑨ — reasoning/thinking normalization + PER-PROVIDER GATE.
// Two concerns:
//  (a) normalizeThinking maps a NewMax effort level → thinking.budget_tokens via
//      EFFORT_BUDGET_MAP (default 16000), and DISABLES thinking when the target
//      model has no thinking capability (must not force reasoning onto models
//      that break on it).
//  (b) End-to-end, reasoningInjection:'off' (LEEMO-PATCH ①) means the emitted
//      OpenAI body carries NO reasoning field even when the client asked for
//      thinking; 'auto' passes reasoning through when thinking is enabled.

describe("pitfall-09 thinking normalize + provider gate", () => {
  it("pitfall-09: effort maps to EFFORT_BUDGET_MAP budget", () => {
    const out = normalizeThinking(simpleTextRequest, true, "high");
    expect(out.thinking).toBeDefined();
    expect(out.thinking!.type).toBe("enabled");
    expect(out.thinking!.budget_tokens).toBe(EFFORT_BUDGET_MAP.high); // 24000
  });

  it("pitfall-09: every effort level resolves to its mapped budget", () => {
    for (const [effort, budget] of Object.entries(EFFORT_BUDGET_MAP)) {
      const out = normalizeThinking(simpleTextRequest, true, effort as any);
      expect(out.thinking!.budget_tokens).toBe(budget);
    }
  });

  it("pitfall-09: no effort but capable → default budget 16000", () => {
    const out = normalizeThinking(thinkingRequest, true);
    expect(out.thinking!.budget_tokens).toBe(DEFAULT_THINKING_BUDGET);
  });

  it("pitfall-09: incapable model → thinking disabled regardless of effort", () => {
    const out = normalizeThinking(thinkingRequest, false, "max");
    expect(out.thinking?.type === "disabled" || out.thinking === undefined).toBe(true);
    // must not carry a positive budget
    expect(out.thinking?.budget_tokens ?? 0).toBeLessThanOrEqual(0);
  });

  it("pitfall-09: does not mutate the input request", () => {
    const before = JSON.stringify(thinkingRequest);
    normalizeThinking(thinkingRequest, true, "low");
    expect(JSON.stringify(thinkingRequest)).toBe(before);
  });

  // ---- LEEMO-PATCH ① gate (end-to-end) ----

  it("pitfall-09: reasoningInjection='off' emits NO reasoning field despite thinking request", async () => {
    const openai = await anthropicToOpenAI(thinkingRequest, { reasoningInjection: "off" });
    expect(openai.reasoning).toBeUndefined();
  });

  it("pitfall-09: reasoningInjection='auto' passes reasoning through when thinking enabled", async () => {
    const openai = await anthropicToOpenAI(thinkingRequest, { reasoningInjection: "auto" });
    expect(openai.reasoning).toBeDefined();
  });
});
