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

  it("folds usage.final as input plus cache fields, excluding output tokens", () => {
    const prev: ContextUsageState = { byConversation: {} };
    const next = foldContextUsage(prev, usageEvent(100, 20, 3, 999), "conversation-a");
    expect(next.byConversation["conversation-a"]).toEqual({ currentTokens: 123, justCompacted: false });
    expect(next).not.toBe(prev);
  });

  it("uses main-loop context fields instead of aggregate model usage that includes subagents", () => {
    const prev: ContextUsageState = { byConversation: {} };
    const event = usageEvent(1_000, 300, 20, 200);
    if (event.type !== "usage.final") throw new Error("expected usage event");
    event.usage.contextInputTokens = 80;
    event.usage.contextCacheReadTokens = 20;
    event.usage.contextCacheCreationTokens = 5;

    const next = foldContextUsage(prev, event, "conversation-a");
    expect(next.byConversation["conversation-a"]).toEqual({ currentTokens: 105, justCompacted: false });
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

    const updated = foldContextUsage(prev, usageEvent(9, 1, 0, 100), "conversation-a");
    expect(updated.byConversation["conversation-b"]).toBe(prev.byConversation["conversation-b"]);
    expect(updated.byConversation["conversation-a"]).toEqual({ currentTokens: 10, justCompacted: false });
  });

  it("preserves justCompacted for usage until an explicit future UI clear", () => {
    const prev: ContextUsageState = { byConversation: { "conversation-a": { currentTokens: 200, justCompacted: true } } };
    const next = foldContextUsage(prev, usageEvent(1, 2, 3, 4), "conversation-a");
    expect(next.byConversation["conversation-a"]).toEqual({ currentTokens: 6, justCompacted: true });
  });

  it("restores the latest real context position from persisted timelines", () => {
    const restored = deriveContextUsageFromTimelines({
      "conversation-a": [
        { kind: "usage", id: "u1", runId: "r1", usage: usageEvent(100, 20, 3, 9).usage },
        { kind: "compact", id: "c1", trigger: "auto", preTokens: 123, postTokens: 40 },
        { kind: "usage", id: "u2", runId: "r2", usage: usageEvent(70, 10, 5, 4).usage },
      ],
    });

    expect(restored.byConversation["conversation-a"]).toEqual({
      currentTokens: 85,
      justCompacted: true,
    });
  });
});
