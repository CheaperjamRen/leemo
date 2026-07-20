import { describe, it, expect } from "vitest";
import { anthropicToOpenAI, openaiToAnthropicResponse } from "@gateway/core/translate";
import { simpleTextRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑩ — usage mapping (cached_tokens deduction) + include_usage toggle.
//  - Non-stream: anthropic input_tokens = prompt_tokens − cached_tokens;
//    cache_read_input_tokens = cached_tokens; output_tokens = completion_tokens.
//  - Streaming request opts: includeUsage:true sets stream_options.include_usage;
//    includeUsage:false must NOT emit stream_options (some endpoints reject it).

describe("pitfall-10 usage mapping + include_usage toggle", () => {
  it("pitfall-10: cached_tokens are deducted from input_tokens and surfaced", async () => {
    const res = await openaiToAnthropicResponse({
      id: "c1",
      model: "gpt-x",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    });
    expect(res.usage.input_tokens).toBe(70); // 100 - 30
    expect(res.usage.cache_read_input_tokens).toBe(30);
    expect(res.usage.output_tokens).toBe(20);
  });

  it("pitfall-10: no cached_tokens → input_tokens equals prompt_tokens", async () => {
    const res = await openaiToAnthropicResponse({
      id: "c2",
      model: "gpt-x",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 42, completion_tokens: 8 },
    });
    expect(res.usage.input_tokens).toBe(42);
    expect(res.usage.cache_read_input_tokens).toBe(0);
  });

  it("pitfall-10: includeUsage:true on a streaming request sets stream_options.include_usage", async () => {
    const { result: openai } = await anthropicToOpenAI({ ...simpleTextRequest, stream: true }, { includeUsage: true });
    expect(openai.stream_options).toEqual({ include_usage: true });
  });

  it("pitfall-10: includeUsage:false omits stream_options entirely", async () => {
    const { result: openai } = await anthropicToOpenAI({ ...simpleTextRequest, stream: true }, { includeUsage: false });
    expect(openai.stream_options).toBeUndefined();
  });

  it("pitfall-10: non-streaming request never carries stream_options", async () => {
    const { result: openai } = await anthropicToOpenAI({ ...simpleTextRequest, stream: false }, { includeUsage: true });
    expect(openai.stream_options).toBeUndefined();
  });
});
