import { describe, it, expect } from "vitest";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { simpleTextRequest, noMaxTokensRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑥ — max_tokens required / clamp / max_completion_tokens.
//  - A request with no max_tokens must get a filled default (OpenAI requires it
//    for some endpoints and clamps behavior otherwise).
//  - maxTokensCap must clamp an over-large value.
//  - maxTokensField:'max_completion_tokens' must rename the wire field and NOT
//    emit max_tokens (newer OpenAI models reject max_tokens).

describe("pitfall-06 max_tokens required/clamp/rename", () => {
  it("pitfall-06: missing max_tokens is filled with a positive default", async () => {
    expect(noMaxTokensRequest.max_tokens).toBeUndefined();
    const { result: openai } = await anthropicToOpenAI(noMaxTokensRequest);
    expect(typeof openai.max_tokens).toBe("number");
    expect(openai.max_tokens!).toBeGreaterThan(0);
  });

  it("pitfall-06: maxTokensCap clamps an over-large max_tokens", async () => {
    const big = { ...simpleTextRequest, max_tokens: 100000 };
    const { result: openai } = await anthropicToOpenAI(big, { maxTokensCap: 4096 });
    expect(openai.max_tokens).toBe(4096);
  });

  it("pitfall-06: maxTokensCap does not raise a smaller value", async () => {
    const small = { ...simpleTextRequest, max_tokens: 256 };
    const { result: openai } = await anthropicToOpenAI(small, { maxTokensCap: 4096 });
    expect(openai.max_tokens).toBe(256);
  });

  it("pitfall-06: max_completion_tokens field renames and omits max_tokens", async () => {
    const { result: openai } = await anthropicToOpenAI(
      { ...simpleTextRequest, max_tokens: 777 },
      { maxTokensField: "max_completion_tokens" }
    );
    expect(openai.max_completion_tokens).toBe(777);
    expect(openai.max_tokens).toBeUndefined();
  });
});
