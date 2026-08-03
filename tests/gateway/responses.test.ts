import { describe, expect, it } from "vitest";
import {
  anthropicToResponses,
  responsesToAnthropicResponse,
  responsesToAnthropicStream,
} from "@gateway/core/responses";
import { collectStream, parseAnthropicSSE, rawSSEStream } from "./fixtures/sse";

describe("OpenAI Responses translation", () => {
  it("maps an Anthropic request into Responses instructions, input, tools and reasoning", () => {
    const { result, stripped } = anthropicToResponses(
      {
        model: "gpt-5.6-sol",
        max_tokens: 900,
        stream: true,
        system: [{ type: "text", text: "You are momo." }],
        thinking: { type: "enabled" },
        messages: [
          { role: "user", content: [{ type: "text", text: "look at this" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } }] },
          { role: "assistant", content: [{ type: "text", text: "I will look." }, { type: "tool_use", id: "call_1", name: "Read", input: { path: "a.txt" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file contents" }] },
        ],
        tools: [
          { name: "Read", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } } } },
          { name: "web_search", type: "web_search_20250305" },
        ],
      },
      { thinkingEffort: "high" }
    );

    expect(stripped.map((tool) => tool.name)).toEqual(["web_search"]);
    expect(result).toMatchObject({
      model: "gpt-5.6-sol",
      instructions: "You are momo.",
      max_output_tokens: 900,
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "high", summary: "auto" },
      tools: [{ type: "function", name: "Read", description: "Read a file" }],
    });
    expect(result.input).toEqual(expect.arrayContaining([
      { role: "user", content: [{ type: "input_text", text: "look at this" }, { type: "input_image", image_url: "data:image/png;base64,YWJj" }] },
      { role: "assistant", content: [{ type: "output_text", text: "I will look." }] },
      { type: "function_call", call_id: "call_1", name: "Read", arguments: '{"path":"a.txt"}' },
      { type: "function_call_output", call_id: "call_1", output: "file contents" },
    ]));
  });

  it("maps Responses output text, function calls, reasoning summaries and usage", () => {
    const message = responsesToAnthropicResponse({
      id: "resp_1",
      model: "gpt-5.6-sol",
      status: "completed",
      output: [
        { id: "rs_1", type: "reasoning", summary: [{ type: "summary_text", text: "I need the file first." }], encrypted_content: "opaque-state" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "I found it." }] },
        { type: "function_call", call_id: "call_2", name: "Read", arguments: '{"path":"b.txt"}' },
      ],
      usage: { input_tokens: 12, output_tokens: 7, input_tokens_details: { cached_tokens: 4 } },
    });

    expect(message.stop_reason).toBe("tool_use");
    expect(message.content).toEqual([
      { type: "thinking", thinking: "I need the file first.", signature: expect.stringMatching(/^leemo-openai-reasoning-v1:/) },
      { type: "text", text: "I found it." },
      { type: "tool_use", id: "call_2", name: "Read", input: { path: "b.txt" } },
    ]);
    expect(message.usage).toEqual({ input_tokens: 8, output_tokens: 7, cache_read_input_tokens: 4 });

    const replay = anthropicToResponses({
      model: "gpt-5.6-sol",
      max_tokens: 100,
      messages: [
        { role: "assistant", content: message.content as any },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_2", content: "file" }] },
      ],
    }).result;
    expect(replay.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rs_1", type: "reasoning", encrypted_content: "opaque-state" }),
      { type: "function_call_output", call_id: "call_2", output: "file" },
    ]));
  });

  it("preserves MiMo reasoning text across a stateless tool round without OpenAI-only fields", () => {
    const message = responsesToAnthropicResponse({
      id: "resp_mimo",
      model: "mimo-v2.5",
      status: "completed",
      output: [
        {
          id: "rs_mimo",
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "I should inspect the file." }],
        },
        { type: "function_call", call_id: "call_mimo", name: "Read", arguments: '{"path":"a.txt"}' },
      ],
      usage: { input_tokens: 8, output_tokens: 4 },
    });

    expect(message.content[0]).toEqual({
      type: "thinking",
      thinking: "I should inspect the file.",
      signature: expect.stringMatching(/^leemo-openai-reasoning-v1:/),
    });

    const replay = anthropicToResponses({
      model: "mimo-v2.5",
      max_tokens: 100,
      thinking: { type: "enabled" },
      messages: [
        { role: "assistant", content: message.content as any },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_mimo", content: "file" }] },
      ],
    }, { responsesDialect: "mimo", thinkingEffort: "high" }).result;

    expect(replay.include).toBeUndefined();
    expect(replay.reasoning).toEqual({ effort: "high" });
    expect(replay.input).toEqual(expect.arrayContaining([
      {
        id: "rs_mimo",
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "I should inspect the file." }],
      },
      { type: "function_call_output", call_id: "call_mimo", output: "file" },
    ]));
  });

  it("converts fragmented Responses SSE text, tool JSON, reasoning summary and terminal usage", async () => {
    const wire = [
      "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_s\",\"model\":\"gpt-5.6-sol\"}}\n\n",
      "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[]}}\n\n",
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","delta":"Need ',
      'the file."}\n\n',
      "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"output_index\":1,\"delta\":\"I can help.\"}\n\n",
      "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":2,\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"Read\",\"arguments\":\"\"}}\n\n",
      "event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"delta\":\"{\\\"path\\\":\"}\n\n",
      "event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"delta\":\"\\\"a.txt\\\"}\"}\n\n",
      "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":15,\"output_tokens\":9,\"input_tokens_details\":{\"cached_tokens\":3}}}}\n\n",
    ].join("");
    const stream = responsesToAnthropicStream(rawSSEStream(wire, [7, 13, 3, 29, 5, 11]));
    const events = parseAnthropicSSE(await collectStream(stream));

    expect(events.map((event) => event.event)).toEqual([
      "message_start", "content_block_start", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop",
      "message_delta", "message_stop",
    ]);
    expect(events.find((event) => event.data?.delta?.type === "thinking_delta")?.data.delta.thinking).toBe("Need the file.");
    expect(events.filter((event) => event.data?.delta?.type === "input_json_delta").map((event) => event.data.delta.partial_json).join("")).toBe('{"path":"a.txt"}');
    const terminal = events.find((event) => event.event === "message_delta");
    expect(terminal?.data).toMatchObject({ delta: { stop_reason: "tool_use" }, usage: { input_tokens: 12, output_tokens: 9, cache_read_input_tokens: 3 } });
  });

  it("emits an Anthropic error for failed Responses streams", async () => {
    const src = rawSSEStream(
      "event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"message\":\"upstream failed\",\"type\":\"server_error\"}}}\n\n",
      [5, 2, 17]
    );
    const events = parseAnthropicSSE(await collectStream(responsesToAnthropicStream(src)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "error", data: { type: "error", error: { type: "api_error", message: "upstream failed" } } });
  });

  it("emits an opaque reasoning signature from output_item.done and accepts CRLF SSE", async () => {
    const wire = [
      'event: response.created\r\ndata: {"type":"response.created","response":{"id":"r","model":"gpt-5.6-sol"}}\r\n\r\n',
      'event: response.output_item.added\r\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}\r\n\r\n',
      'event: response.reasoning_summary_text.delta\r\ndata: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","delta":"Need a tool."}\r\n\r\n',
      'event: response.output_item.done\r\ndata: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Need a tool."}],"encrypted_content":"opaque"}}\r\n\r\n',
      'event: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":1}}}\r\n\r\n',
    ].join("");
    const events = parseAnthropicSSE(await collectStream(responsesToAnthropicStream(rawSSEStream(wire, [4, 9, 17]))));

    expect(events.find((event) => event.data?.delta?.type === "signature_delta")?.data.delta.signature)
      .toMatch(/^leemo-openai-reasoning-v1:/);
    expect(events.at(-1)?.event).toBe("message_stop");
  });

  it("converts MiMo reasoning_text SSE and emits replay state for the next tool round", async () => {
    const wire = [
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r","model":"mimo-v2.5"}}\n\n',
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_mimo","type":"reasoning","content":[]}}\n\n',
      'event: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","item_id":"rs_mimo","delta":"Need the file."}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"id":"rs_mimo","type":"reasoning","content":[{"type":"reasoning_text","text":"Need the file."}]}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":2,"output_tokens":1}}}\n\n',
    ].join("");
    const events = parseAnthropicSSE(await collectStream(responsesToAnthropicStream(rawSSEStream(wire, [5, 11, 23]))));

    expect(events.find((event) => event.data?.delta?.type === "thinking_delta")?.data.delta.thinking)
      .toBe("Need the file.");
    expect(events.find((event) => event.data?.delta?.type === "signature_delta")?.data.delta.signature)
      .toMatch(/^leemo-openai-reasoning-v1:/);
  });

  it("propagates AbortSignal cancellation to the upstream reader", async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      pull() {
        // Deliberately never enqueue: the consumer must be released by abort.
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    controller.abort(new Error("user cancelled"));
    const converted = responsesToAnthropicStream(upstream, { signal: controller.signal });
    await expect(converted.getReader().read()).rejects.toThrow("user cancelled");
    expect(cancelled).toBe(true);
  });
});
