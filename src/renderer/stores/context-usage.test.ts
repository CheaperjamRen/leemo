import { describe, expect, it } from "vitest";
import type { LeemoEvent } from "../../bridge/contract";
import {
  createContextUsageStore,
  deriveContextUsageFromTimelines,
  foldContextUsage,
  type ContextUsageState,
} from "./context-usage";

const usageEvent = (inputTokens: number, cacheReadTokens: number, cacheCreationTokens: number, outputTokens: number): Extract<LeemoEvent, { type: "usage.final" }> => ({
  type: "usage.final",
  usage: {
    providerId: "provider-safe",
    modelId: "model-safe",
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    outputTokens,
    costSource: "unpriced",
    tokensEstimated: false,
  },
});

describe("context usage store", () => {
  it("starts empty without baking one global model threshold into the store", () => {
    expect(createContextUsageStore().getState()).toEqual({ byConversation: {} });
  });

  it("does not confuse billing usage with the current context window", () => {
    const prev: ContextUsageState = { byConversation: {} };
    const next = foldContextUsage(prev, usageEvent(100, 20, 3, 999), "conversation-a");
    expect(next).toBe(prev);
  });

  it("folds the SDK context snapshot with its effective and raw capacities", () => {
    const prev: ContextUsageState = { byConversation: {} };
    const next = foldContextUsage(prev, {
      type: "context.snapshot",
      currentTokens: 87_450,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 180_000,
      isAutoCompactEnabled: true,
      model: "kimi-k3",
    }, "conversation-a");
    expect(next.byConversation["conversation-a"]).toEqual({
      currentTokens: 87_450,
      capacityTokens: 180_000,
      rawMaxTokens: 200_000,
      source: "sdk",
      justCompacted: false,
    });
  });

  it("uses compact postTokens, preserves an explicit zero, and falls back to preTokens only when absent", () => {
    const prior: ContextUsageState = { byConversation: { "conversation-a": { currentTokens: 500, justCompacted: false } } };
    const compacted = foldContextUsage(prior, { type: "compact.boundary", trigger: "auto", preTokens: 400, postTokens: 0 }, "conversation-a");
    expect(compacted.byConversation["conversation-a"]).toEqual({ currentTokens: 0, justCompacted: true });

    const fallback = foldContextUsage(compacted, { type: "compact.boundary", trigger: "manual", preTokens: 400 }, "conversation-a");
    expect(fallback.byConversation["conversation-a"]).toEqual({ currentTokens: 400, justCompacted: true });
  });

  it("isolates conversations and leaves unknown events as an exact no-op", () => {
    const prev: ContextUsageState = { byConversation: { "conversation-b": { currentTokens: 7, justCompacted: true } } };
    const unrelated = foldContextUsage(prev, { type: "text.delta", text: "hi" }, "conversation-a");
    expect(unrelated).toBe(prev);
    expect(unrelated.byConversation).toBe(prev.byConversation);

    const updated = foldContextUsage(prev, {
      type: "context.snapshot",
      currentTokens: 10,
      maxTokens: 100,
      rawMaxTokens: 100,
      isAutoCompactEnabled: false,
      model: "m",
    }, "conversation-a");
    expect(updated.byConversation["conversation-b"]).toBe(prev.byConversation["conversation-b"]);
    expect(updated.byConversation["conversation-a"]).toEqual({ currentTokens: 10, capacityTokens: 100, rawMaxTokens: 100, source: "sdk", justCompacted: false });
  });

  it("preserves justCompacted for usage until an explicit future UI clear", () => {
    const prev: ContextUsageState = { byConversation: { "conversation-a": { currentTokens: 200, justCompacted: true } } };
    const next = foldContextUsage(prev, {
      type: "context.snapshot",
      currentTokens: 6,
      maxTokens: 100,
      rawMaxTokens: 100,
      isAutoCompactEnabled: false,
      model: "m",
    }, "conversation-a");
    expect(next.byConversation["conversation-a"]).toEqual({ currentTokens: 6, capacityTokens: 100, rawMaxTokens: 100, source: "sdk", justCompacted: true });
  });

  it("restores the latest real context position from persisted timelines", () => {
    const restored = deriveContextUsageFromTimelines({
      "conversation-a": [
        { kind: "context", id: "x1", runId: "r1", currentTokens: 123, maxTokens: 200, rawMaxTokens: 200, isAutoCompactEnabled: true, autoCompactThreshold: 180, model: "m" },
        { kind: "compact", id: "c1", trigger: "auto", preTokens: 123, postTokens: 40 },
        { kind: "context", id: "x2", runId: "r2", currentTokens: 85, maxTokens: 200, rawMaxTokens: 200, isAutoCompactEnabled: true, autoCompactThreshold: 180, model: "m" },
      ],
    });

    expect(restored.byConversation["conversation-a"]).toEqual({
      currentTokens: 85,
      capacityTokens: 180,
      rawMaxTokens: 200,
      source: "sdk",
      justCompacted: true,
    });
  });
});
