import { describe, it, expect } from "vitest";
import { testProviderConnection, type ProviderTestTarget } from "../../src/host/provider-test";

// 轮 3 卡 F2 — provider-test.ts. fetchFn is fully injected; zero live network
// calls. `now` is injected too, so latencyMs assertions are deterministic.

type CapturedCall = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };

function fakeResponse(status: number, jsonBody: unknown): Response {
  const text = JSON.stringify(jsonBody);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  } as unknown as Response;
}

/** Builds a fetchFn that returns `replies` in order (one per call), and
 *  records every call into `calls`. */
function sequencedFetch(replies: Response[], calls: CapturedCall[]): typeof fetch {
  let i = 0;
  return (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as CapturedCall["init"] });
    const reply = replies[Math.min(i, replies.length - 1)];
    i++;
    return reply;
  }) as unknown as typeof fetch;
}

function throwingFetch(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

const anthropicTarget: ProviderTestTarget = {
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKey: "sk-test-DIRECTKEY-anthropic-000",
  modelId: "deepseek-v4-flash",
  apiFormat: "anthropic",
};

const openaiTarget: ProviderTestTarget = {
  baseUrl: "https://relay.example.com/v1",
  apiKey: "sk-test-DIRECTKEY-openai-111",
  modelId: "gpt-4o-mini",
  apiFormat: "openai",
};

const responsesTarget: ProviderTestTarget = {
  baseUrl: "https://tokenflux.dev/v1",
  apiKey: "sk-test-tokenflux-222",
  modelId: "gpt-5.6-sol",
  apiFormat: "openai-responses",
};

function fixedClock(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

describe("testProviderConnection — anthropic text probe, success", () => {
  it("posts to <baseUrl>/v1/messages with the right headers + body, and reports ok/latency/modelEcho", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "Hello there." }],
        }),
      ],
      calls
    );
    const now = fixedClock([1000, 1240]);

    const result = await testProviderConnection(anthropicTarget, { fetchFn, now });

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBe(240);
    expect(result.modelEcho).toBe("deepseek-v4-flash");
    expect(result.thinking).toBe(false);
    expect(result.vision).toBeUndefined();

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(calls[0].init.method).toBe("POST");
    expect(new Headers(calls[0].init.headers).get("authorization"))
      .toBe(`Bearer ${anthropicTarget.apiKey}`);
    expect(calls[0].init.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].init.headers?.["content-type"]).toBeDefined();
    const payload = JSON.parse(calls[0].init.body ?? "{}");
    expect(payload.model).toBe("deepseek-v4-flash");
    expect(payload.max_tokens).toBe(16);
    expect(Array.isArray(payload.messages)).toBe(true);

    const imagePayload = JSON.parse(calls[1].init.body ?? "{}");
    expect(imagePayload.max_tokens).toBe(24);
    expect(imagePayload.messages[0].content.some((block: { type?: string }) => block.type === "image")).toBe(true);

    const reasoningPayload = JSON.parse(calls[2].init.body ?? "{}");
    expect(reasoningPayload.max_tokens).toBe(1088);
    expect(reasoningPayload.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  it("includes user-supplied custom headers", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "x", content: [{ type: "text", text: "hi" }] })],
      calls
    );
    const target: ProviderTestTarget = { ...anthropicTarget, headers: { "X-Custom": "abc" } };
    await testProviderConnection(target, { fetchFn });
    expect(calls[0].init.headers?.["X-Custom"]).toBe("abc");
  });

  it("keeps the configured credential authoritative over a conflicting custom header", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "m", content: [{ type: "text", text: "OK" }] })],
      calls,
    );
    const target: ProviderTestTarget = {
      ...anthropicTarget,
      headers: { Authorization: "Bearer wrong-custom-value", "X-Tenant": "workspace-7" },
    };

    await testProviderConnection(target, { fetchFn });

    expect(new Headers(calls[0].init.headers).get("authorization"))
      .toBe(`Bearer ${anthropicTarget.apiKey}`);
    expect(calls[0].init.headers?.["X-Tenant"]).toBe("workspace-7");
  });

  it("joins probe endpoints without duplicating a provider's trailing slash", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "kimi-for-coding", content: [{ type: "text", text: "OK" }] })],
      calls,
    );

    await testProviderConnection({
      ...anthropicTarget,
      baseUrl: "https://api.kimi.com/coding/",
      modelId: "kimi-for-coding",
    }, { fetchFn });

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.url === "https://api.kimi.com/coding/v1/messages")).toBe(true);
  });

  it("uses X-Api-Key for an Anthropic-compatible provider that requires it", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "MiniMax-M2.7", content: [{ type: "text", text: "OK" }] })],
      calls,
    );

    await testProviderConnection({
      ...anthropicTarget,
      modelId: "MiniMax-M2.7",
      apiKeyHeader: "x-api-key",
    }, { fetchFn });

    expect(calls[0].init.headers?.["x-api-key"]).toBe(anthropicTarget.apiKey);
    expect(calls[0].init.headers?.authorization).toBeUndefined();
  });

  it("does not invent an auth header for a key-free local model service", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "qwen-local", choices: [{ message: { content: "OK" } }] })],
      calls,
    );

    await testProviderConnection({
      ...openaiTarget,
      apiKey: "",
      authMode: "none",
      modelId: "qwen-local",
    }, { fetchFn });

    expect(calls[0].init.headers?.authorization).toBeUndefined();
    expect(calls[0].init.headers?.["x-api-key"]).toBeUndefined();
  });

  it("detects a thinking block in the response", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [
            { type: "thinking", thinking: "reasoning..." },
            { type: "text", text: "final answer" },
          ],
        }),
      ],
      []
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(result.ok).toBe(true);
    expect(result.thinking).toBe(true);
  });

  it("keeps a real baseline thinking signal when the dedicated probe is inconclusive", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [
            { type: "thinking", thinking: "baseline reasoning" },
            { type: "text", text: "OK" },
          ],
        }),
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "I cannot see the image." }],
        }),
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "4" }],
        }),
      ],
      [],
    );

    const result = await testProviderConnection(anthropicTarget, { fetchFn });

    expect(result.thinking).toBe(true);
    expect(result.capabilityProbes?.reasoning.status).toBe("unknown");
  });
});

describe("testProviderConnection — openai text probe, success", () => {
  it("posts to <baseUrl>/chat/completions in OpenAI shape, success judged by choices[0]", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, {
          model: "gpt-4o-mini",
          choices: [{ message: { content: "Hello!" } }],
        }),
      ],
      calls
    );
    const result = await testProviderConnection(openaiTarget, { fetchFn });
    expect(result.ok).toBe(true);
    expect(result.modelEcho).toBe("gpt-4o-mini");
    expect(calls[0].url).toBe("https://relay.example.com/v1/chat/completions");
  });

  it("empty choices array is NOT a success", async () => {
    const fetchFn = sequencedFetch([fakeResponse(200, { model: "gpt-4o-mini", choices: [] })], []);
    const result = await testProviderConnection(openaiTarget, { fetchFn });
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("testProviderConnection — OpenAI Responses", () => {
  it("uses /responses and native input/reasoning shapes for every probe", async () => {
    const calls: CapturedCall[] = [];
    const reply = fakeResponse(200, {
      model: "gpt-5.6-sol",
      output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
      usage: { input_tokens: 3, output_tokens: 1 },
    });
    const result = await testProviderConnection(responsesTarget, {
      fetchFn: sequencedFetch([reply, reply, reply], calls),
      now: () => 100,
    });

    expect(result.ok).toBe(true);
    expect(result.modelEcho).toBe("gpt-5.6-sol");
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.url === "https://tokenflux.dev/v1/responses")).toBe(true);
    const baseline = JSON.parse(calls[0].init.body ?? "{}");
    expect(baseline).toMatchObject({ model: "gpt-5.6-sol", max_output_tokens: 16, store: false });
    expect(baseline.input[0].content[0]).toEqual({ type: "input_text", text: "Reply with OK." });
    const image = JSON.parse(calls[1].init.body ?? "{}");
    expect(image.input[0].content.some((part: { type?: string }) => part.type === "input_image")).toBe(true);
    const reasoning = JSON.parse(calls[2].init.body ?? "{}");
    expect(reasoning.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(reasoning.max_output_tokens).toBe(64);
  });
});

describe("testProviderConnection — failure paths never throw, always classified", () => {
  it("401 auth failure -> ok:false, error.kind='auth', no throw", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(401, {
          error: { type: "authentication_error", message: "Authentication Fails" },
        }),
      ],
      []
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("auth");
  });

  it("a thrown network error -> ok:false, error.kind='network', apiKey redacted", async () => {
    const fetchFn = throwingFetch(new Error(`connect failed for key ${anthropicTarget.apiKey}`));
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("network");
    expect(JSON.stringify(result)).not.toContain(anthropicTarget.apiKey);
  });

  it("an AbortError throw -> ok:false, error.kind='timeout'", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const fetchFn = throwingFetch(err);
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("timeout");
  });

  it("model_missing (404, kimi-shaped body) -> ok:false, error.kind='model_missing'", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(404, {
          error: {
            type: "resource_not_found_error",
            message: "Not found the model X or Permission denied",
          },
        }),
      ],
      []
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe("model_missing");
  });
});

describe("testProviderConnection — automatic capability probe tri-state", () => {
  it("ambiguous successful replies remain unknown instead of becoming unsupported", async () => {
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "m", content: [{ type: "text", text: "hi" }] })],
      [],
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 12 });
    expect(result.capabilityProbes).toEqual({
      image: { status: "unknown", checkedAt: 12 },
      reasoning: { status: "unknown", checkedAt: 12 },
    });
  });

  it("genuine red/blue recognition is verified", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, { model: "m", content: [{ type: "text", text: "Sure, one sec." }] }),
        fakeResponse(200, {
          model: "m",
          content: [{ type: "text", text: "I see a checkerboard with red and blue squares." }],
        }),
        fakeResponse(200, { model: "m", content: [{ type: "text", text: "4" }] }),
      ],
      calls,
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 22 });
    expect(result.ok).toBe(true);
    expect(result.vision).toBe(true);
    expect(result.capabilityProbes?.image).toEqual({ status: "verified", checkedAt: 22 });
    expect(calls).toHaveLength(3);
    const visionPayload = JSON.parse(calls[1].init.body ?? "{}");
    const content = visionPayload.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content.some((b: { type?: string }) => b.type === "image")).toBe(true);
  });

  it("DeepSeek-style 200 plus cannot-see reply is a failed probe, not an absolute ban", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, { model: "deepseek-v4-flash", content: [{ type: "text", text: "hi" }] }),
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "I'm sorry, I cannot see your image." }],
        }),
        fakeResponse(200, { model: "deepseek-v4-flash", content: [{ type: "text", text: "4" }] }),
      ],
      [],
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 32 });
    expect(result.ok).toBe(true);
    expect(result.vision).toBe(false);
    expect(result.capabilityProbes?.image).toEqual({ status: "failed", checkedAt: 32 });
  });

  it("Chinese cannot-see reply is a failed probe", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, { model: "m", content: [{ type: "text", text: "hi" }] }),
        fakeResponse(200, { model: "m", content: [{ type: "text", text: "抱歉，我看不到图片。" }] }),
        fakeResponse(200, { model: "m", content: [{ type: "text", text: "4" }] }),
      ],
      [],
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 42 });
    expect(result.vision).toBe(false);
    expect(result.capabilityProbes?.image).toEqual({ status: "failed", checkedAt: 42 });
  });

  it("a rejected image request stays failed while the reasoning probe still runs", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, { model: "m", content: [{ type: "text", text: "hi" }] }),
        fakeResponse(400, {
          code: "InvalidParameter",
          message: "height:1 or width:1 must be larger than 10",
        }),
        fakeResponse(200, {
          model: "m",
          content: [
            { type: "thinking", thinking: "two plus two" },
            { type: "text", text: "4" },
          ],
        }),
      ],
      calls,
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 52 });
    expect(result.ok).toBe(true);
    expect(result.vision).toBeUndefined();
    expect(result.visionProbeError).toBeDefined();
    expect(result.capabilityProbes?.image).toMatchObject({ status: "failed", checkedAt: 52 });
    expect(result.capabilityProbes?.reasoning).toEqual({ status: "verified", checkedAt: 52 });
    expect(calls).toHaveLength(3);
  });

  it("a thrown image probe is unknown and does not flip the baseline", async () => {
    let call = 0;
    const fetchFn = (async () => {
      call += 1;
      if (call === 1) return fakeResponse(200, { model: "m", content: [{ type: "text", text: "hi" }] });
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 62 });
    expect(result.ok).toBe(true);
    expect(result.vision).toBeUndefined();
    expect(result.visionProbeError?.kind).toBe("network");
    expect(result.capabilityProbes?.image).toMatchObject({ status: "unknown", checkedAt: 62 });
    expect(result.capabilityProbes?.reasoning).toMatchObject({ status: "unknown", checkedAt: 62 });
    expect(call).toBe(3);
  });

  it("a failed baseline skips both capability probes", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [fakeResponse(401, { error: { type: "authentication_error", message: "bad key" } })],
      calls,
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(result.ok).toBe(false);
    expect(result.capabilityProbes).toBeUndefined();
    expect(result.vision).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("OpenAI wire shape sends image and low-effort reasoning probes", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, { model: "m", choices: [{ message: { content: "hi" } }] }),
        fakeResponse(200, { model: "m", choices: [{ message: { content: "I see red and blue." } }] }),
        fakeResponse(200, {
          model: "m",
          choices: [{ message: { content: "4", reasoning_content: "two plus two" } }],
        }),
      ],
      calls,
    );
    const result = await testProviderConnection(openaiTarget, { fetchFn, now: () => 72 });
    expect(result.vision).toBe(true);
    expect(result.capabilityProbes).toEqual({
      image: { status: "verified", checkedAt: 72 },
      reasoning: { status: "verified", checkedAt: 72 },
    });
    const visionPayload = JSON.parse(calls[1].init.body ?? "{}");
    const content = visionPayload.messages[0].content;
    expect(content.some((b: { type?: string }) => b.type === "image_url")).toBe(true);
    const reasoningPayload = JSON.parse(calls[2].init.body ?? "{}");
    expect(reasoningPayload.reasoning_effort).toBe("low");
    expect(reasoningPayload.max_completion_tokens).toBe(64);
    expect(reasoningPayload.max_tokens).toBeUndefined();
  });
});

describe("testProviderConnection — apiKey never leaks", () => {
  it("no leak into any field of the result on success", async () => {
    const fetchFn = sequencedFetch(
      [fakeResponse(200, { model: "m", content: [{ type: "text", text: "hi" }] })],
      []
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(JSON.stringify(result)).not.toContain(anthropicTarget.apiKey);
  });

  it("no leak into any field of the result on classified failure", async () => {
    const fetchFn = sequencedFetch(
      [
        fakeResponse(401, {
          error: { type: "authentication_error", message: `bad key ${anthropicTarget.apiKey}` },
        }),
      ],
      []
    );
    const result = await testProviderConnection(anthropicTarget, { fetchFn });
    expect(JSON.stringify(result)).not.toContain(anthropicTarget.apiKey);
  });
});

describe("testProviderConnection — automatic capability probes", () => {
  it("runs image and reasoning probes after the baseline succeeds", async () => {
    const calls: CapturedCall[] = [];
    const fetchFn = sequencedFetch(
      [
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "OK" }],
        }),
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "The image contains red and blue." }],
        }),
        fakeResponse(200, {
          model: "deepseek-v4-flash",
          content: [
            { type: "thinking", thinking: "brief check" },
            { type: "text", text: "4" },
          ],
        }),
      ],
      calls,
    );

    const result = await testProviderConnection(anthropicTarget, { fetchFn, now: () => 1_000 });

    expect(calls).toHaveLength(3);
    expect(result.capabilityProbes).toEqual({
      image: { status: "verified", checkedAt: 1_000 },
      reasoning: { status: "verified", checkedAt: 1_000 },
    });
  });
});
