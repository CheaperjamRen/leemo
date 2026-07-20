// Leemo gateway core — vendor-isolating translation facade (first-party).
//
// Thin wrappers over the vendored AnthropicTransformer. G3's shell calls ONLY
// these; it never touches the vendor class or its types. Public signatures use
// first-party / structural types so no vendor type leaks across the G2→G3 seam.
//
// - anthropicToOpenAI: Anthropic /v1/messages body + ProviderOpts → OpenAI
//   /chat/completions body. Pre-processes (thinking budget ⑨, image promotion
//   ⑧, schema flatten ⑪) then drives vendor transformRequestOut (which, patched,
//   gates reasoning injection ① and observably strips server tools ②), then
//   post-processes (cache_control strip ⑤, max_tokens fill/clamp/rename ⑥,
//   stream_options toggle ⑩).
// - openaiToAnthropicResponse: one OpenAI ChatCompletion → one Anthropic
//   Message (vendor transformResponseIn, non-stream branch): stop_reason ②,
//   tool id ④, usage ⑩.
// - openaiToAnthropicStream: OpenAI SSE ReadableStream → Anthropic SSE
//   ReadableStream (vendor transformResponseIn, stream branch): the ⑫ state
//   machine, plus ①③④⑩ in streaming form.

import { AnthropicTransformer } from "@vendor/llms/src/transformer/anthropic.transformer";
import { resolveProviderOpts, type ProviderOpts } from "./provider-opts";
import {
  normalizeThinking,
  promoteToolResultImages,
  flattenToolSchema,
  type AnthropicChatRequest,
} from "./normalize";

export interface OpenAIChatBody {
  model: string;
  messages: any[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: unknown;
  stream_options?: { include_usage: boolean };
  reasoning?: unknown;
  [k: string]: unknown;
}

/** Fallback max_tokens when the client omits it (OpenAI-compat endpoints need a
 *  concrete cap; 4096 is a safe generation ceiling for a chat turn). */
const DEFAULT_MAX_TOKENS = 4096;

/** Silent logger + minimal context: the vendor methods call this.logger.debug
 *  unconditionally and read context.req.id. Neither does I/O for us. */
function makeVendorRuntime(): { logger: any; context: { req: { id: string } } } {
  const noop = () => {};
  return {
    logger: { debug: noop, error: noop, info: noop, warn: noop, trace: noop },
    context: { req: { id: "leemo-gw" } },
  };
}

/** Recursively delete every `cache_control` key (pitfall ⑤). Mutates in place;
 *  callers pass a fresh structure. */
function stripCacheControl(node: any): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(stripCacheControl);
    return;
  }
  if ("cache_control" in node) delete node.cache_control;
  for (const v of Object.values(node)) stripCacheControl(v);
}

export async function anthropicToOpenAI(
  req: AnthropicChatRequest,
  opts?: Partial<ProviderOpts>
): Promise<OpenAIChatBody> {
  const o = resolveProviderOpts(opts);

  // ---- first-party pre-processing on the Anthropic shape ----
  let working: AnthropicChatRequest = promoteToolResultImages(req); // ⑧

  // ⑨ thinking budget / capability. Only touch thinking when the client asked
  // for it or the provider forces an effort — never inject it unbidden.
  if (working.thinking || o.thinkingEffort) {
    working = normalizeThinking(working, o.thinkingCapability ?? true, o.thinkingEffort);
  }

  // ⑪ GLM schema flatten (opt-in per provider).
  if (o.flattenSchemas && Array.isArray(working.tools)) {
    working = {
      ...working,
      tools: working.tools.map((t) =>
        t.input_schema ? { ...t, input_schema: flattenToolSchema(t.input_schema) } : t
      ),
    };
  }

  // ---- drive the (patched) vendor transformer ----
  // reasoningInjection gate = LEEMO-PATCH ①; server-tool strip = LEEMO-PATCH ②.
  const transformer = new AnthropicTransformer({
    reasoningInjection: o.reasoningInjection,
  } as any);
  const { logger } = makeVendorRuntime();
  transformer.logger = logger;

  const unified: any = await transformer.transformRequestOut(working as any);

  // ---- post-processing into the OpenAI body ----
  const body: OpenAIChatBody = {
    model: unified.model,
    messages: unified.messages,
  };
  if (unified.temperature !== undefined) body.temperature = unified.temperature;
  if (unified.stream !== undefined) body.stream = unified.stream;
  if (unified.tool_choice !== undefined) body.tool_choice = unified.tool_choice;
  if (unified.reasoning !== undefined) body.reasoning = unified.reasoning;
  // tools: [] (all server tools stripped by patch ②) → omit; OpenAI rejects [].
  if (Array.isArray(unified.tools) && unified.tools.length) body.tools = unified.tools;

  // ⑥ max_tokens: fill default, clamp to cap, rename field per provider.
  let maxTok: number = typeof unified.max_tokens === "number" ? unified.max_tokens : DEFAULT_MAX_TOKENS;
  if (typeof o.maxTokensCap === "number" && maxTok > o.maxTokensCap) maxTok = o.maxTokensCap;
  if (o.maxTokensField === "max_completion_tokens") body.max_completion_tokens = maxTok;
  else body.max_tokens = maxTok;

  // ⑩ stream_options only on streaming requests, and only when enabled.
  if (unified.stream && o.includeUsage) body.stream_options = { include_usage: true };

  // ⑤ strip cache_control everywhere it may have survived the vendor copy.
  stripCacheControl(body.messages);

  return body;
}

export async function openaiToAnthropicResponse(
  res: unknown
): Promise<Record<string, any>> {
  const transformer = new AnthropicTransformer();
  const { logger, context } = makeVendorRuntime();
  transformer.logger = logger;

  const response = new Response(JSON.stringify(res), {
    headers: { "Content-Type": "application/json" },
  });
  const converted = await transformer.transformResponseIn(response, context);
  return (await converted.json()) as Record<string, any>;
}

export async function openaiToAnthropicStream(
  upstream: ReadableStream<Uint8Array>
): Promise<ReadableStream<Uint8Array>> {
  const transformer = new AnthropicTransformer();
  const { logger, context } = makeVendorRuntime();
  transformer.logger = logger;

  const response = new Response(upstream as any, {
    headers: { "Content-Type": "text/event-stream" },
  });
  const converted = await transformer.transformResponseIn(response, context);
  if (!converted.body) {
    throw new Error("vendor stream conversion returned no body");
  }
  return converted.body as unknown as ReadableStream<Uint8Array>;
}
