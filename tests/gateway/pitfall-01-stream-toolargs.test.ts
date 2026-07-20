import { describe, it, expect } from "vitest";
import { openaiToAnthropicStream } from "@gateway/core/translate";
import { sseEventStream, collectStream, parseAnthropicSSE } from "./fixtures/sse";

// Pitfall ① — streaming tool_calls argument concatenation, incl. zero-arg
// tool `{}` fallback. The OpenAI stream delivers tool-call arguments across
// multiple chunks; the Anthropic stream must emit input_json_delta fragments
// that concatenate back to the exact original JSON. A tool with NO arguments
// must still produce a valid tool_use block whose input defaults to {} with no
// stray input_json_delta.

async function runStream(items: Array<Record<string, any> | string>) {
  const out = await openaiToAnthropicStream(sseEventStream(items));
  return parseAnthropicSSE(await collectStream(out));
}

describe("pitfall-01 streaming tool_calls argument concatenation", () => {
  it("pitfall-01: concatenates split tool-call arguments into the original JSON", async () => {
    const events = await runStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: '{"path"' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ':"a.txt"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]);

    const jsonDeltas = events
      .filter((e) => e.event === "content_block_delta" && e.data?.delta?.type === "input_json_delta")
      .map((e) => e.data.delta.partial_json);

    // fragments preserved verbatim and concatenate to valid, correct JSON
    expect(jsonDeltas).toEqual(['{"path"', ':"a.txt"}']);
    expect(JSON.parse(jsonDeltas.join(""))).toEqual({ path: "a.txt" });
  });

  it("pitfall-01: zero-arg tool emits input:{} with NO input_json_delta", async () => {
    const events = await runStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_z", type: "function", function: { name: "ListFiles", arguments: "" } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]);

    const start = events.find((e) => e.event === "content_block_start" && e.data?.content_block?.type === "tool_use");
    expect(start).toBeDefined();
    expect(start!.data.content_block.input).toEqual({});
    expect(start!.data.content_block.name).toBe("ListFiles");

    const jsonDeltas = events.filter(
      (e) => e.event === "content_block_delta" && e.data?.delta?.type === "input_json_delta"
    );
    expect(jsonDeltas).toHaveLength(0); // {} fallback, no partial_json
  });
});
