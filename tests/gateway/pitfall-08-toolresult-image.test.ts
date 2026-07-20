import { describe, it, expect } from "vitest";
import { promoteToolResultImages } from "@gateway/core/normalize";
import { anthropicToOpenAI } from "@gateway/core/translate";
import { toolResultWithImageRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑧ — tool_result-nested images promoted to a user message.
// The vendor JSON-stringifies tool_result content into a `role:tool` message,
// which destroys any nested image. So BEFORE the vendor runs, images nested in
// a tool_result must be lifted into a standalone user message (and the
// tool_result left with only its text / a placeholder). End-to-end, the image
// must survive as an OpenAI image_url.

function deepFindImageSource(obj: any): boolean {
  if (obj === null || typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some(deepFindImageSource);
  if (obj.type === "image" && obj.source) return true;
  return Object.values(obj).some(deepFindImageSource);
}

describe("pitfall-08 tool_result image promotion", () => {
  it("pitfall-08: no image remains nested inside any tool_result after promotion", () => {
    const out = promoteToolResultImages(toolResultWithImageRequest);
    for (const msg of out.messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as any[]) {
          if (block.type === "tool_result") {
            expect(deepFindImageSource(block.content)).toBe(false);
          }
        }
      }
    }
  });

  it("pitfall-08: a user message now carries the promoted image block", () => {
    const out = promoteToolResultImages(toolResultWithImageRequest);
    const promoted = out.messages.some(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as any[]).some((c) => c.type === "image" && c.source)
    );
    expect(promoted).toBe(true);
  });

  it("pitfall-08: input request is not mutated", () => {
    const before = JSON.stringify(toolResultWithImageRequest);
    promoteToolResultImages(toolResultWithImageRequest);
    expect(JSON.stringify(toolResultWithImageRequest)).toBe(before);
  });

  it("pitfall-08: end-to-end the image survives as an OpenAI image_url", async () => {
    const openai = await anthropicToOpenAI(toolResultWithImageRequest);
    const hasImageUrl = JSON.stringify(openai).includes('"image_url"');
    expect(hasImageUrl).toBe(true);
  });
});
