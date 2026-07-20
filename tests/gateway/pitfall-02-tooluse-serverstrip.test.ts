import { describe, it, expect } from "vitest";
import { openaiToAnthropicResponse, openaiToAnthropicStream, anthropicToOpenAI } from "@gateway/core/translate";
import { stripServerTools } from "@gateway/core/normalize";
import { serverToolsRequest } from "./fixtures/anthropic-requests";
import { sseEventStream, collectStream, parseAnthropicSSE } from "./fixtures/sse";

// Pitfall ② has two halves:
//   (a) tool-bearing turns must map finish_reason:tool_calls → stop_reason:tool_use
//       (both non-stream response and streaming message_delta).
//   (b) server/builtin tools must be OBSERVABLY stripped (LEEMO-PATCH ②):
//       stripServerTools returns the removed list, keeping only client tools.

describe("pitfall-02 tool-use stop_reason + server-tool strip", () => {
  it("pitfall-02: non-stream finish_reason=tool_calls → stop_reason=tool_use", async () => {
    const res = await openaiToAnthropicResponse({
      id: "chatcmpl-1",
      model: "gpt-x",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(res.stop_reason).toBe("tool_use");
    const toolUse = (res.content as any[]).find((c) => c.type === "tool_use");
    expect(toolUse).toBeDefined();
    expect(toolUse.id).toBe("call_1");
  });

  it("pitfall-02: streaming finish_reason=tool_calls → message_delta stop_reason=tool_use", async () => {
    const out = await openaiToAnthropicStream(
      sseEventStream([
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "Read", arguments: "{}" } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        "[DONE]",
      ])
    );
    const events = parseAnthropicSSE(await collectStream(out));
    const delta = events.find((e) => e.event === "message_delta");
    expect(delta?.data?.delta?.stop_reason).toBe("tool_use");
  });

  it("pitfall-02: stripServerTools removes builtin tools and returns them observably", () => {
    const { request, stripped } = stripServerTools(serverToolsRequest);
    // Only the client custom tool survives
    expect(request.tools!.map((t) => t.name)).toEqual(["Read"]);
    // The two server tools are returned for logging/observability
    expect(stripped.map((t) => t.name).sort()).toEqual(["computer", "web_search"]);
    // input immutability: original fixture untouched
    expect(serverToolsRequest.tools!.length).toBe(3);
  });

  it("pitfall-02: stripServerTools drops the tools key entirely when nothing remains", () => {
    const onlyServer = {
      model: "m",
      max_tokens: 10,
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    };
    const { request, stripped } = stripServerTools(onlyServer);
    expect(request.tools).toBeUndefined();
    expect(stripped).toHaveLength(1);
  });

  it("pitfall-02: end-to-end OpenAI body carries ONLY the client tool (LEEMO-PATCH ② in-pipeline strip)", async () => {
    const openai = await anthropicToOpenAI(serverToolsRequest);
    const names = (openai.tools ?? []).map((t: any) => t.function?.name);
    // server tools (web_search, computer) must not survive into the wire body
    expect(names).toEqual(["Read"]);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("computer");
  });
});
