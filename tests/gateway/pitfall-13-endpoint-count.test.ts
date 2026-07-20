import { describe, it, expect } from "vitest";
import { countTokens, classifyEndpoint } from "@gateway/core/tokens";
import { simpleTextRequest, blockSystemRequest } from "./fixtures/anthropic-requests";

// Pitfall ⑬ — ?beta=true + count_tokens endpoint face.
// CC always hits /v1/messages?beta=true and depends on count_tokens for its
// compaction logic; gateway-model-discovery hits /v1/models. classifyEndpoint
// must recognise each face (and register beta=true), and countTokens must
// return a stable positive estimate that scales with content.

describe("pitfall-13 endpoint face + count_tokens", () => {
  it("pitfall-13: /v1/messages?beta=true classified as messages with beta=true", () => {
    const f = classifyEndpoint("/v1/messages?beta=true");
    expect(f.kind).toBe("messages");
    expect(f.beta).toBe(true);
  });

  it("pitfall-13: /v1/messages without beta still classified as messages, beta=false", () => {
    const f = classifyEndpoint("/v1/messages");
    expect(f.kind).toBe("messages");
    expect(f.beta).toBe(false);
  });

  it("pitfall-13: count_tokens sub-path recognised", () => {
    expect(classifyEndpoint("/v1/messages/count_tokens?beta=true").kind).toBe("count_tokens");
  });

  it("pitfall-13: /v1/models and /health recognised", () => {
    expect(classifyEndpoint("/v1/models").kind).toBe("models");
    expect(classifyEndpoint("/health").kind).toBe("health");
  });

  it("pitfall-13: unknown path", () => {
    expect(classifyEndpoint("/foo/bar").kind).toBe("unknown");
  });

  it("pitfall-13: countTokens returns a positive, deterministic estimate", () => {
    const a = countTokens(simpleTextRequest);
    const b = countTokens(simpleTextRequest);
    expect(a).toBeGreaterThan(0);
    expect(a).toBe(b); // deterministic
  });

  it("pitfall-13: countTokens scales with content size", () => {
    const small = countTokens(simpleTextRequest);
    const bigger = countTokens(blockSystemRequest);
    expect(bigger).toBeGreaterThan(0);
    // a request with a system prompt + block content out-tokens the one-liner
    expect(bigger).toBeGreaterThan(small);
  });
});
