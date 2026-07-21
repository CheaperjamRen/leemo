import { describe, it, expect } from "vitest";
import { anthropicToOpenAI, openaiToAnthropicResponse, openaiToAnthropicStream } from "@gateway/core/translate";
import { countText } from "@gateway/core/tokens";
import { simpleTextRequest } from "./fixtures/anthropic-requests";
import { sseGroupedStream, collectStream, parseAnthropicSSE } from "./fixtures/sse";

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

// ---- B0: streaming usage passthrough + o200k backfill (three branches) ------
//
// Diagnostic (smoke/relay-sse-probe): the relay DOES emit a real usage frame,
// but it arrives in the SAME network read as finish_reason. The vendor inner
// loop breaks on finish_reason and never reads that co-arriving usage line, so
// the terminal message_delta carries 0/0 and message_start.input_tokens is a
// hardcoded 0. The first-party stream transform must:
//   (branch 1) PASS THROUGH real upstream usage when a usage frame is present —
//              even when it co-arrives with finish_reason (the live shape) —
//              filling BOTH message_start.input_tokens and terminal usage, and
//              NEVER marking estimated (no double counting).
//   (branch 2) usageBackfill:'auto' + NO upstream usage frame → o200k backfill
//              of message_start.input_tokens (request) + terminal output_tokens
//              (accumulated output text), marked leemo_estimated:true.
//   (branch 3) usageBackfill:'off' + NO upstream usage frame → leave zeros,
//              no estimated marker.

describe("pitfall-10 (B0) streaming usage passthrough + backfill", () => {
  // The live wire shape: finish_reason and usage in ONE network read.
  const liveGroups = () => [
    [{ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }],
    [{ choices: [{ index: 0, delta: { content: "hello momo" } }] }],
    // finish_reason + usage co-arrive in the SAME read, then [DONE]
    [
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 4399, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 3840 } } },
      "[DONE]",
    ],
  ];

  it("branch1: real upstream usage co-arriving with finish_reason is passed through (message_start + terminal delta), NOT estimated", async () => {
    const out = await openaiToAnthropicStream(sseGroupedStream(liveGroups()), {
      request: simpleTextRequest,
      opts: { usageBackfill: "auto" },
    });
    const events = parseAnthropicSSE(await collectStream(out));

    const start = events.find((e) => e.event === "message_start");
    const delta = events.find((e) => e.event === "message_delta");
    // message_start carries the UPFRONT o200k estimate (the real prompt_tokens
    // co-arrives with finish_reason at the very end, so it cannot land here
    // without buffering the whole stream — which the unbuffered contract forbids).
    // Nonzero is what matters for CC auto-compaction.
    expect(start?.data?.message?.usage?.input_tokens).toBe(countText("Say hello to momo."));
    expect(start?.data?.message?.usage?.input_tokens).toBeGreaterThan(0);
    // terminal message_delta carries the REAL upstream values (passthrough):
    // 4399 - 3840 = 559 input; 10 output; 3840 cache_read.
    expect(delta?.data?.usage?.input_tokens).toBe(559);
    expect(delta?.data?.usage?.cache_read_input_tokens).toBe(3840);
    expect(delta?.data?.usage?.output_tokens).toBe(10);
    // real passthrough must NOT be flagged as estimated
    expect(delta?.data?.usage?.leemo_estimated).toBeUndefined();
  });

  it("branch2: usageBackfill:auto with NO upstream usage frame backfills via o200k and marks leemo_estimated:true", async () => {
    const noUsage = [
      [{ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }],
      [{ choices: [{ index: 0, delta: { content: "hello " } }] }],
      [{ choices: [{ index: 0, delta: { content: "momo" } }] }],
      [{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, "[DONE]"],
    ];
    const out = await openaiToAnthropicStream(sseGroupedStream(noUsage), {
      request: simpleTextRequest,
      opts: { usageBackfill: "auto" },
    });
    const events = parseAnthropicSSE(await collectStream(out));

    const start = events.find((e) => e.event === "message_start");
    const delta = events.find((e) => e.event === "message_delta");
    // input backfilled from the request text (o200k), > 0
    const expectInput = countText("Say hello to momo."); // simpleTextRequest body
    expect(start?.data?.message?.usage?.input_tokens).toBe(expectInput);
    expect(delta?.data?.usage?.input_tokens).toBe(expectInput);
    // output backfilled from accumulated output text "hello momo"
    expect(delta?.data?.usage?.output_tokens).toBe(countText("hello momo"));
    // marked estimated so B2 can set estimated:true
    expect(delta?.data?.usage?.leemo_estimated).toBe(true);
  });

  it("branch3: usageBackfill:off with NO upstream usage frame leaves zeros and no estimated marker", async () => {
    const noUsage = [
      [{ choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }],
      [{ choices: [{ index: 0, delta: { content: "hi" } }] }],
      [{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, "[DONE]"],
    ];
    const out = await openaiToAnthropicStream(sseGroupedStream(noUsage), {
      request: simpleTextRequest,
      opts: { usageBackfill: "off" },
    });
    const events = parseAnthropicSSE(await collectStream(out));

    const start = events.find((e) => e.event === "message_start");
    const delta = events.find((e) => e.event === "message_delta");
    expect(start?.data?.message?.usage?.input_tokens).toBe(0);
    expect(delta?.data?.usage?.output_tokens).toBe(0);
    expect(delta?.data?.usage?.leemo_estimated).toBeUndefined();
  });

  it("no-arg call (back-compat) still yields a well-formed stream", async () => {
    // Legacy single-arg signature must keep working (G3 shell passes no opts yet).
    const out = await openaiToAnthropicStream(
      sseGroupedStream([
        [{ choices: [{ index: 0, delta: { content: "x" } }] }],
        [{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, "[DONE]"],
      ])
    );
    const events = parseAnthropicSSE(await collectStream(out));
    expect(events[0].event).toBe("message_start");
    expect(events[events.length - 1].event).toBe("message_stop");
  });
});
