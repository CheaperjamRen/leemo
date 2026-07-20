import { describe, it, expect } from "vitest";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { blockSystemRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑤ — cache_control stripping. Anthropic requests carry cache_control
// markers on system blocks, text blocks and tool_result blocks. OpenAI-compat
// endpoints reject unknown fields, so NO cache_control may survive anywhere in
// the emitted OpenAI request.

function deepFindKey(obj: any, key: string): boolean {
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((v) => deepFindKey(v, key));
  for (const k of Object.keys(obj)) {
    if (k === key) return true;
    if (deepFindKey(obj[k], key)) return true;
  }
  return false;
}

describe("pitfall-05 cache_control stripped", () => {
  it("pitfall-05: no cache_control key survives anywhere in the OpenAI request", async () => {
    // sanity: fixture actually contains cache_control (guards a vacuous test)
    expect(deepFindKey(blockSystemRequest, "cache_control")).toBe(true);

    const openai = await anthropicToOpenAI(blockSystemRequest);
    expect(deepFindKey(openai, "cache_control")).toBe(false);
  });
});
