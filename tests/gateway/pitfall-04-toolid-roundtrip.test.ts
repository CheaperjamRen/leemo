import { describe, it, expect } from "vitest";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { openaiToAnthropicResponse, openaiToAnthropicStream } from "@gateway/core/translate";
import { toolRoundTripRequest } from "./fixtures/anthropic-requests";
import { sseEventStream, collectStream, parseAnthropicSSE } from "./fixtures/sse";

// Pitfall ④ — tool id round-trip consistency across the whole chain.
// The Anthropic tool_use id (toolu_abc123) must ride out to OpenAI as the
// assistant tool_call id AND back as the tool_result's tool_call_id; and an
// OpenAI response tool_call id must surface unchanged as the Anthropic tool_use
// id (non-stream and stream).

describe("pitfall-04 tool id round-trip", () => {
  it("pitfall-04: request keeps tool_use id as assistant tool_call id and tool_result tool_call_id", async () => {
    const { result: openai } = await anthropicToOpenAI(toolRoundTripRequest);
    const assistant = openai.messages.find(
      (m: any) => m.role === "assistant" && m.tool_calls?.length
    );
    expect(assistant.tool_calls[0].id).toBe("toolu_abc123");
    const toolMsg = openai.messages.find((m: any) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("toolu_abc123");
  });

  it("pitfall-04: OpenAI response tool_call id surfaces unchanged as anthropic tool_use id", async () => {
    const res = await openaiToAnthropicResponse({
      id: "chatcmpl-2",
      model: "gpt-x",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_roundtrip_xyz", type: "function", function: { name: "Read", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const toolUse = (res.content as any[]).find((c) => c.type === "tool_use");
    expect(toolUse.id).toBe("call_roundtrip_xyz");
  });

  it("pitfall-04: streaming preserves the upstream tool_call id in content_block_start", async () => {
    const events = parseAnthropicSSE(await collectStream(await openaiToAnthropicStream(sseEventStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_stream_42", type: "function", function: { name: "Read", arguments: "{}" } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      "[DONE]",
    ]))));
    const start = events.find((e) => e.event === "content_block_start" && e.data?.content_block?.type === "tool_use");
    expect(start!.data.content_block.id).toBe("call_stream_42");
  });
});
