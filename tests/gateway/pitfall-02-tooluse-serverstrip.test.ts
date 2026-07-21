import { describe, it, expect } from "vitest";
import { openaiToAnthropicResponse, openaiToAnthropicStream, anthropicToOpenAI } from "@gateway/core/translate";
import { stripServerTools, isServerTool } from "@gateway/core/normalize";
import { AnthropicTransformer } from "@vendor/llms/src/transformer/anthropic.transformer";
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
    const { result: openai } = await anthropicToOpenAI(serverToolsRequest);
    const names = (openai.tools ?? []).map((t: any) => t.function?.name);
    // server tools (web_search, computer) must not survive into the wire body
    expect(names).toEqual(["Read"]);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("computer");
  });

  // ---- review-round: single predicate source + facade-exposed stripped list ----

  it("pitfall-02: isServerTool predicate is the single definition (type-based, ignores input_schema)", () => {
    // A versioned, non-custom tool is a server tool EVEN IF it carries an
    // input_schema. The old vendor predicate had `&& !input_schema`, which
    // disagreed with normalize's rule for exactly this shape.
    expect(isServerTool({ type: "computer_20250124", name: "computer", input_schema: { type: "object" } })).toBe(true);
    expect(isServerTool({ type: "web_search_20250305", name: "web_search" })).toBe(true);
    // client tools: no type, or type:"custom"
    expect(isServerTool({ name: "Read", input_schema: { type: "object" } })).toBe(false);
    expect(isServerTool({ type: "custom", name: "MyTool", input_schema: { type: "object" } })).toBe(false);
  });

  it("pitfall-02: divergent shape (versioned non-custom type WITH input_schema) is stripped consistently", async () => {
    const req = {
      model: "m",
      max_tokens: 100,
      messages: [{ role: "user" as const, content: "go" }],
      tools: [
        { name: "Read", description: "d", input_schema: { type: "object", properties: {} } },
        // versioned server tool that ALSO carries an input_schema — the shape
        // the two predicates disagreed on.
        { type: "computer_20250124", name: "computer", input_schema: { type: "object", properties: {} } },
      ],
    };
    const { result, stripped } = await anthropicToOpenAI(req);
    const wireNames = (result.tools ?? []).map((t: any) => t.function?.name);
    // wire tools must NOT contain the server tool
    expect(wireNames).toEqual(["Read"]);
    // and the facade-returned stripped list must MATCH what actually left the wire
    expect(stripped.map((t: any) => t.name)).toEqual(["computer"]);
  });

  it("pitfall-02: facade exposes the stripped list so G3 reaches it WITHOUT touching vendor", async () => {
    const { result, stripped } = await anthropicToOpenAI(serverToolsRequest);
    const wireNames = (result.tools ?? []).map((t: any) => t.function?.name);
    expect(wireNames).toEqual(["Read"]);
    // observable strip list, reachable via the sole G3 entry point (translate)
    expect(stripped.map((t: any) => t.name).sort()).toEqual(["computer", "web_search"]);
  });

  it("pitfall-02: facade stripped list is empty when only client tools are present", async () => {
    const req = {
      model: "m",
      max_tokens: 100,
      messages: [{ role: "user" as const, content: "go" }],
      tools: [{ name: "Read", description: "d", input_schema: { type: "object", properties: {} } }],
    };
    const { result, stripped } = await anthropicToOpenAI(req);
    expect(stripped).toEqual([]);
    expect((result.tools ?? []).map((t: any) => t.function?.name)).toEqual(["Read"]);
  });

  // ---- B0 凑手③: lock the VENDOR backstop predicate (previously untested) ----
  //
  // In normal operation the facade pre-strips server tools before the vendor
  // runs, so the vendor's LEEMO-PATCH ② backstop is dead code on the hot path
  // and had zero test coverage (G2 review Minor). Drive the vendor transformer
  // DIRECTLY (bypassing the facade) with the divergent shape the two predicates
  // once disagreed on — a versioned, non-custom `type` that ALSO carries an
  // input_schema — and lock that the backstop strips it and exposes it on
  // strippedServerTools. This pins the byte-identical predicate against drift.

  it("pitfall-02 (B0): vendor backstop strips a versioned server tool WITH input_schema (divergent shape)", async () => {
    const transformer = new AnthropicTransformer();
    transformer.logger = { debug() {}, error() {}, info() {}, warn() {}, trace() {} } as any;

    const unified: any = await transformer.transformRequestOut({
      model: "m",
      max_tokens: 100,
      messages: [{ role: "user", content: "go" }],
      tools: [
        { name: "Read", description: "d", input_schema: { type: "object", properties: {} } },
        // versioned server tool that ALSO carries an input_schema — the shape an
        // earlier `&& !tool?.input_schema` clause got wrong.
        { type: "computer_20250124", name: "computer", input_schema: { type: "object", properties: {} } },
        { type: "web_search_20250305", name: "web_search" },
      ],
    } as any);

    // only the client tool survives into the unified/OpenAI tool list
    const wireNames = (unified.tools ?? []).map((t: any) => t.function?.name);
    expect(wireNames).toEqual(["Read"]);
    // the backstop exposes exactly the two server tools it removed
    expect(transformer.strippedServerTools.map((t: any) => t.name).sort()).toEqual(["computer", "web_search"]);
  });

  it("pitfall-02 (B0): vendor backstop keeps client tools (no type / type:custom) even WITH input_schema", async () => {
    const transformer = new AnthropicTransformer();
    transformer.logger = { debug() {}, error() {}, info() {}, warn() {}, trace() {} } as any;

    const unified: any = await transformer.transformRequestOut({
      model: "m",
      max_tokens: 100,
      messages: [{ role: "user", content: "go" }],
      tools: [
        { name: "Read", input_schema: { type: "object" } },
        { type: "custom", name: "MyTool", input_schema: { type: "object" } },
      ],
    } as any);

    const wireNames = (unified.tools ?? []).map((t: any) => t.function?.name);
    expect(wireNames.sort()).toEqual(["MyTool", "Read"]);
    expect(transformer.strippedServerTools).toEqual([]);
  });
});
