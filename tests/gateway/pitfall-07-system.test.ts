import { describe, it, expect } from "vitest";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { stringSystemRequest, blockSystemRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑦ — system string / block-array concatenation. A string system prompt
// and a block-array system prompt must BOTH surface as an OpenAI system message
// whose text carries the intended content (block array joined, cache_control
// dropped).

describe("pitfall-07 system string/blocks", () => {
  it("pitfall-07: string system → single system message with same text", async () => {
    const { result: openai } = await anthropicToOpenAI(stringSystemRequest);
    const sys = openai.messages.find((m: any) => m.role === "system");
    expect(sys).toBeDefined();
    const text = typeof sys.content === "string"
      ? sys.content
      : sys.content.map((c: any) => c.text).join("");
    expect(text).toContain("You are momo, a helpful desk companion.");
  });

  it("pitfall-07: block-array system carries all block texts", async () => {
    const { result: openai } = await anthropicToOpenAI(blockSystemRequest);
    const sys = openai.messages.find((m: any) => m.role === "system");
    expect(sys).toBeDefined();
    const text =
      typeof sys.content === "string"
        ? sys.content
        : sys.content.map((c: any) => c.text).join(" ");
    expect(text).toContain("You are momo.");
    expect(text).toContain("Follow the workspace rules.");
  });
});
