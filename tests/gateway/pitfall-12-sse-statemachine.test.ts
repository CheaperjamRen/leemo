import { describe, it, expect } from "vitest";
import { openaiToAnthropicStream } from "@gateway/core/translate";
import { openaiSSE, sseEventStream, rawSSEStream, collectStream, parseAnthropicSSE } from "./fixtures/sse";

// Pitfall ⑫ — the SSE event state machine. Feed an OpenAI chunk sequence,
// assert the Anthropic event sequence event-by-event:
//   - event+data are always paired (every block has both lines)
//   - overall order: message_start → content_block_* → message_delta → message_stop
//   - [DONE] is swallowed (never surfaces as an anthropic event)
//   - ping / comment lines are ignored
//   - usage arrives on the final message_delta
//   - text→tool switch closes the text block before opening the tool block
//   - a zero-arg tool still yields a complete tool_use block

// Default: deliver each OpenAI event as its own network read (realistic wire
// behavior; a trailing usage frame lands in a later read so it is observed).
// When chunkSizes is given, exercise byte-level line reassembly instead.
async function stream(items: Array<Record<string, any> | string>, chunkSizes?: number[]) {
  const src = chunkSizes
    ? rawSSEStream(openaiSSE(items), chunkSizes)
    : sseEventStream(items);
  const out = await openaiToAnthropicStream(src);
  const text = await collectStream(out);
  return { text, events: parseAnthropicSSE(text) };
}

describe("pitfall-12 SSE state machine", () => {
  it("pitfall-12: text→tool switch produces the canonical ordered event sequence", async () => {
    const { events } = await stream([
      ":ping",
      { choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
      { choices: [{ index: 0, delta: { content: "Hello" } }] },
      { choices: [{ index: 0, delta: { content: " world" } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 4 } } },
      "[DONE]",
    ]);

    const names = events.map((e) => e.event);
    expect(names).toMatchSnapshot();

    // structural invariants (belt-and-suspenders alongside the snapshot)
    expect(names[0]).toBe("message_start");
    expect(names[names.length - 1]).toBe("message_stop");
    expect(names[names.length - 2]).toBe("message_delta");

    // text block (0) opened then closed before tool block (1) opens
    const startText = events.findIndex((e) => e.event === "content_block_start" && e.data.content_block.type === "text");
    const stopText = events.findIndex((e, i) => e.event === "content_block_stop" && e.data.index === 0 && i > startText);
    const startTool = events.findIndex((e) => e.event === "content_block_start" && e.data.content_block.type === "tool_use");
    expect(startText).toBeGreaterThanOrEqual(0);
    expect(stopText).toBeGreaterThan(startText);
    expect(startTool).toBeGreaterThan(stopText);

    // every event has both a name and a data payload (event+data pairing)
    for (const e of events) {
      expect(e.event).not.toBe("");
      expect(e.data).not.toBe("");
    }

    // [DONE] never leaks as an event
    expect(names).not.toContain("");
    expect(events.some((e) => e.data === "[DONE]")).toBe(false);

    // usage on the final message_delta
    const finalDelta = events[events.length - 2];
    expect(finalDelta.event).toBe("message_delta");
    expect(finalDelta.data.usage.input_tokens).toBe(8); // 12 - 4
    expect(finalDelta.data.usage.cache_read_input_tokens).toBe(4);
    expect(finalDelta.data.usage.output_tokens).toBe(7);
    expect(finalDelta.data.delta.stop_reason).toBe("tool_use");
  });

  it("pitfall-12: zero-arg tool yields a complete tool_use block (snapshot)", async () => {
    const { events } = await stream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_z", type: "function", function: { name: "Now", arguments: "" } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]);
    expect(events.map((e) => e.event)).toMatchSnapshot();
    const start = events.find((e) => e.event === "content_block_start" && e.data.content_block.type === "tool_use");
    expect(start!.data.content_block.input).toEqual({});
  });

  it("pitfall-12: [DONE] is swallowed and stream terminates cleanly with message_stop", async () => {
    const { events } = await stream([
      { choices: [{ index: 0, delta: { content: "hi" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]",
    ]);
    const names = events.map((e) => e.event);
    expect(names).toContain("message_stop");
    expect(names.filter((n) => n === "message_stop")).toHaveLength(1);
    expect(events.some((e) => e.data === "[DONE]")).toBe(false);
  });

  it("pitfall-12: usage-only final chunk (empty choices) still maps usage onto message_delta", async () => {
    const { events } = await stream([
      { choices: [{ index: 0, delta: { content: "done" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 5 } } },
      "[DONE]",
    ]);
    const finalDelta = events.find((e) => e.event === "message_delta");
    expect(finalDelta!.data.usage.input_tokens).toBe(45); // 50 - 5
    expect(finalDelta!.data.usage.cache_read_input_tokens).toBe(5);
  });

  it("pitfall-12: split network reads (partial lines) still parse to the same events", async () => {
    const items = [
      { choices: [{ index: 0, delta: { content: "chunked" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      "[DONE]",
    ] as Array<Record<string, any> | string>;
    const whole = await stream(items);
    const split = await stream(items, [3, 7, 11, 5, 9, 13]); // arbitrary tiny reads
    expect(split.events.map((e) => e.event)).toEqual(whole.events.map((e) => e.event));
  });
});
