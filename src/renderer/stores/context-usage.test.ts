import { describe, expect, it, vi } from "vitest";
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

const reading = (overrides: Partial<ContextUsageState["byConversation"][string]> = {}): ContextUsageState["byConversation"][string] => ({
  currentTokens: 500,
  providerId: "provider-safe",
  modelId: "model-safe",
  accuracy: "estimated",
  updatedAt: 1,
  justCompacted: false,
  ...overrides,
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
      providerId: "provider-safe",
      model: "kimi-k3",
    }, "conversation-a", 100);
    expect(next.byConversation["conversation-a"]).toEqual({
      currentTokens: 87_450,
      capacityTokens: 180_000,
      rawMaxTokens: 200_000,
      providerId: "provider-safe",
      modelId: "kimi-k3",
      accuracy: "exact",
      updatedAt: 100,
      justCompacted: false,
    });
  });

  it("replaces repeated main-loop estimates and lets a later exact snapshot win", () => {
    const first = foldContextUsage({ byConversation: {} }, {
      type: "context.live",
      currentTokens: 43_084,
      providerId: "provider-safe",
      model: "deepseek-v4-flash",
    }, "conversation-a", 100);
    const repeated = foldContextUsage(first, {
      type: "context.live",
      currentTokens: 43_212,
      providerId: "provider-safe",
      model: "deepseek-v4-flash",
    }, "conversation-a", 110);
    const exact = foldContextUsage(repeated, {
      type: "context.snapshot",
      currentTokens: 43_200,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      autoCompactThreshold: 167_000,
      isAutoCompactEnabled: true,
      providerId: "provider-safe",
      model: "deepseek-v4-flash",
    }, "conversation-a", 120);

    expect(repeated.byConversation["conversation-a"]).toMatchObject({
      currentTokens: 43_212,
      accuracy: "estimated",
      updatedAt: 110,
    });
    expect(exact.byConversation["conversation-a"]).toMatchObject({
      currentTokens: 43_200,
      capacityTokens: 167_000,
      accuracy: "exact",
      updatedAt: 120,
    });
  });

  it("uses only main-loop context fields from final usage", () => {
    const event = usageEvent(99_999, 88_888, 77_777, 66_666);
    event.usage.contextInputTokens = 120;
    event.usage.contextCacheReadTokens = 880;
    event.usage.contextCacheCreationTokens = 0;
    event.usage.contextOutputTokens = 20;

    const next = foldContextUsage({ byConversation: {} }, event, "conversation-a", 200);

    expect(next.byConversation["conversation-a"]).toEqual({
      currentTokens: 1_020,
      providerId: "provider-safe",
      modelId: "model-safe",
      accuracy: "estimated",
      updatedAt: 200,
      justCompacted: false,
    });
  });

  it("ignores an estimate older than the latest trusted reading", () => {
    const prev: ContextUsageState = {
      byConversation: {
        "conversation-a": reading({ currentTokens: 400, accuracy: "exact", updatedAt: 300 }),
      },
    };

    const next = foldContextUsage(prev, {
      type: "context.live",
      currentTokens: 999,
      providerId: "provider-safe",
      model: "model-safe",
    }, "conversation-a", 299);

    expect(next).toBe(prev);
  });

  it("uses compact postTokens, preserves an explicit zero, and returns to pending when postTokens is absent", () => {
    const prior: ContextUsageState = { byConversation: { "conversation-a": reading() } };
    const compacted = foldContextUsage(prior, { type: "compact.boundary", trigger: "auto", preTokens: 400, postTokens: 0 }, "conversation-a", 10);
    expect(compacted.byConversation["conversation-a"]).toEqual(reading({ currentTokens: 0, accuracy: "exact", updatedAt: 10, justCompacted: true }));

    const fallback = foldContextUsage(compacted, { type: "compact.boundary", trigger: "manual", preTokens: 400 }, "conversation-a", 11);
    expect(fallback.byConversation["conversation-a"]).toBeUndefined();
  });

  it("isolates conversations and leaves unknown events as an exact no-op", () => {
    const prev: ContextUsageState = { byConversation: { "conversation-b": reading({ currentTokens: 7, justCompacted: true }) } };
    const unrelated = foldContextUsage(prev, { type: "text.delta", text: "hi" }, "conversation-a");
    expect(unrelated).toBe(prev);
    expect(unrelated.byConversation).toBe(prev.byConversation);

    const updated = foldContextUsage(prev, {
      type: "context.snapshot",
      currentTokens: 10,
      maxTokens: 100,
      rawMaxTokens: 100,
      isAutoCompactEnabled: false,
      providerId: "provider-safe",
      model: "m",
    }, "conversation-a", 20);
    expect(updated.byConversation["conversation-b"]).toBe(prev.byConversation["conversation-b"]);
    expect(updated.byConversation["conversation-a"]).toEqual({ currentTokens: 10, capacityTokens: 100, rawMaxTokens: 100, providerId: "provider-safe", modelId: "m", accuracy: "exact", updatedAt: 20, justCompacted: false });
  });

  it("clears the compacted badge when a newer context reading arrives", () => {
    const prev: ContextUsageState = { byConversation: { "conversation-a": reading({ currentTokens: 200, justCompacted: true }) } };
    const next = foldContextUsage(prev, {
      type: "context.snapshot",
      currentTokens: 6,
      maxTokens: 100,
      rawMaxTokens: 100,
      isAutoCompactEnabled: false,
      providerId: "provider-safe",
      model: "m",
    }, "conversation-a", 30);
    expect(next.byConversation["conversation-a"]).toEqual({ currentTokens: 6, capacityTokens: 100, rawMaxTokens: 100, providerId: "provider-safe", modelId: "m", accuracy: "exact", updatedAt: 30, justCompacted: false });
  });

  it("restores the latest real context position from persisted timelines", () => {
    const restored = deriveContextUsageFromTimelines({
      "conversation-a": [
        { kind: "context", id: "x1", runId: "r1", currentTokens: 123, maxTokens: 200, rawMaxTokens: 200, isAutoCompactEnabled: true, autoCompactThreshold: 180, providerId: "provider-safe", model: "m" },
        { kind: "compact", id: "c1", trigger: "auto", preTokens: 123, postTokens: 40 },
        { kind: "context", id: "x2", runId: "r2", currentTokens: 85, maxTokens: 200, rawMaxTokens: 200, isAutoCompactEnabled: true, autoCompactThreshold: 180, providerId: "provider-safe", model: "m" },
      ],
    });

    expect(restored.byConversation["conversation-a"]).toEqual({
      currentTokens: 85,
      capacityTokens: 180,
      rawMaxTokens: 200,
      providerId: "provider-safe",
      modelId: "m",
      accuracy: "exact",
      updatedAt: expect.any(Number),
      justCompacted: false,
    });
  });

  it("restores a final usage estimate when a provider never returned an exact snapshot", () => {
    const restored = deriveContextUsageFromTimelines({
      "conversation-a": [{
        kind: "usage",
        id: "u1",
        runId: "r1",
        usage: {
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          inputTokens: 50_000,
          outputTokens: 10_000,
          cacheReadTokens: 40_000,
          cacheCreationTokens: 0,
          contextInputTokens: 120,
          contextCacheReadTokens: 42_880,
          contextCacheCreationTokens: 0,
          contextOutputTokens: 212,
          costSource: "unpriced",
          tokensEstimated: false,
        },
      }],
    });

    expect(restored.byConversation["conversation-a"]).toMatchObject({
      currentTokens: 43_212,
      modelId: "deepseek-v4-flash",
      accuracy: "estimated",
    });
  });

  it("5000 条恢复记录不会制造未来 updatedAt，紧接着的真实事件可以覆盖", () => {
    const now = 10_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const restored = deriveContextUsageFromTimelines({
      "conversation-a": Array.from({ length: 5_000 }, (_, index) => ({
        kind: "usage" as const,
        id: `usage-${index}`,
        runId: `run-${index}`,
        usage: {
          providerId: "provider-a",
          modelId: "shared-model",
          inputTokens: index,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          contextInputTokens: index,
          contextCacheReadTokens: 0,
          contextCacheCreationTokens: 0,
          contextOutputTokens: 0,
          costSource: "unpriced" as const,
          tokensEstimated: false,
        },
      })),
    });

    const next = foldContextUsage(restored, {
      type: "context.live",
      currentTokens: 9_000,
      providerId: "provider-a",
      model: "shared-model",
    }, "conversation-a", now);

    expect(next.byConversation["conversation-a"]).toMatchObject({
      currentTokens: 9_000,
      providerId: "provider-a",
      modelId: "shared-model",
      updatedAt: now,
    });
    vi.restoreAllMocks();
  });

  it("同名模型跨 provider 时不复用旧容量", () => {
    const exact = foldContextUsage({ byConversation: {} }, {
      type: "context.snapshot",
      currentTokens: 80_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      isAutoCompactEnabled: false,
      providerId: "provider-a",
      model: "shared-model",
    }, "conversation-a", 1);

    const switched = foldContextUsage(exact, {
      type: "context.live",
      currentTokens: 10_000,
      providerId: "provider-b",
      model: "shared-model",
    }, "conversation-a", 2);

    expect(switched.byConversation["conversation-a"]).toEqual({
      currentTokens: 10_000,
      providerId: "provider-b",
      modelId: "shared-model",
      accuracy: "estimated",
      updatedAt: 2,
      justCompacted: false,
    });
  });
});
