import { describe, it, expect } from "vitest";
import { openaiToAnthropicStream } from "@gateway/core/translate";
import { sseEventStream, collectStream, parseAnthropicSSE } from "./fixtures/sse";

// Pitfall ③ — content-block index monotonic mapping ACROSS types. When a stream
// switches text → tool_use (→ another tool), each new block gets the next
// integer index (0,1,2…), never reused or decremented, and every
// content_block_start has a matching content_block_stop at the same index.

describe("pitfall-03 content block index monotonic across types", () => {
  it("pitfall-03: text→tool→tool indices are 0,1,2 strictly increasing and balanced", async () => {
    const events = parseAnthropicSSE(await collectStream(await openaiToAnthropicStream(sseEventStream([
      { choices: [{ index: 0, delta: { content: "Hello" } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "A", arguments: "{}" } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "B", arguments: '{"x":1}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]))));

    const starts = events.filter((e) => e.event === "content_block_start");
    const stops = events.filter((e) => e.event === "content_block_stop");

    // three blocks: text(0), tool_use(1), tool_use(2)
    expect(starts.map((e) => e.data.index)).toEqual([0, 1, 2]);
    expect(starts.map((e) => e.data.content_block.type)).toEqual([
      "text",
      "tool_use",
      "tool_use",
    ]);
    // every start index has a matching stop; stops sorted equal starts
    expect(stops.map((e) => e.data.index).sort((a, b) => a - b)).toEqual([0, 1, 2]);

    // monotonic: no index repeats among starts
    const idxs = starts.map((e) => e.data.index);
    expect(new Set(idxs).size).toBe(idxs.length);
  });
});
