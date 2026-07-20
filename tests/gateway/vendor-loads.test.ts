import { describe, it, expect } from "vitest";
import { AnthropicTransformer } from "@vendor/llms/src/transformer/anthropic.transformer";

// G1 vendor-loads smoke test: proves the migrated @musistudio/llms core
// (AnthropicTransformer) resolves through the path aliases and instantiates.
// Guards the gateway foundation G2-G4 build on.
describe("vendor @musistudio/llms loads", () => {
  it("AnthropicTransformer instantiates with the Anthropic /v1/messages endpoint", () => {
    const t = new AnthropicTransformer();
    expect(t.name).toBe("Anthropic");
    expect(t.endPoint).toBe("/v1/messages");
  });
});
