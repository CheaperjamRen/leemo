import { describe, expect, it, vi } from "vitest";
import type { BridgeEventEnvelope } from "../../bridge/contract";
import { createBridgeEventBatcher } from "./event-batcher";

describe("bridge event batcher", () => {
  it("coalesces adjacent text deltas and flushes before a structural event", () => {
    const delivered: BridgeEventEnvelope[] = [];
    let scheduled: (() => void) | undefined;
    const cancel = vi.fn();
    const batcher = createBridgeEventBatcher(
      (envelope) => delivered.push(envelope),
      (flush) => {
        scheduled = flush;
        return cancel;
      },
    );

    for (let index = 0; index < 2_000; index += 1) {
      batcher.push({ conversationId: "c1", event: { type: "text.delta", text: "x" } });
    }
    expect(delivered).toEqual([]);

    batcher.push({ conversationId: "c1", event: { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false } });
    expect(delivered).toEqual([
      { conversationId: "c1", event: { type: "text.delta", text: "x".repeat(2_000) } },
      { conversationId: "c1", event: { type: "tool.started", toolUseId: "t1", name: "Read", input: {}, subagent: false } },
    ]);
    expect(cancel).toHaveBeenCalledOnce();

    scheduled?.();
    expect(delivered).toHaveLength(2);
  });

  it("keeps conversations and thinking/text channels separate", () => {
    const delivered: BridgeEventEnvelope[] = [];
    let scheduled: (() => void) | undefined;
    const batcher = createBridgeEventBatcher(
      (envelope) => delivered.push(envelope),
      (flush) => {
        scheduled = flush;
        return () => undefined;
      },
    );

    batcher.push({ conversationId: "a", event: { type: "thinking.delta", text: "想" } });
    batcher.push({ conversationId: "a", event: { type: "text.delta", text: "答" } });
    batcher.push({ conversationId: "b", event: { type: "text.delta", text: "B" } });
    scheduled?.();

    expect(delivered.map((item) => [item.conversationId, item.event.type])).toEqual([
      ["a", "thinking.delta"],
      ["a", "text.delta"],
      ["b", "text.delta"],
    ]);
  });
});
