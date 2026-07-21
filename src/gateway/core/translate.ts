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
import { countTokens, countText } from "./tokens";
import {
  normalizeThinking,
  promoteToolResultImages,
  flattenToolSchema,
  stripServerTools,
  type AnthropicChatRequest,
  type AnthropicTool,
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

/** Result of anthropicToOpenAI: the OpenAI wire body PLUS the server/builtin
 *  tools that were observably stripped (pitfall ②). G3's shell reads `stripped`
 *  for logging WITHOUT ever touching the vendor transformer. `stripped` is
 *  guaranteed consistent with `result.tools` — both derive from the single
 *  isServerTool predicate applied once, first-party, before the vendor runs. */
export interface AnthropicToOpenAIResult {
  result: OpenAIChatBody;
  stripped: AnthropicTool[];
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
): Promise<AnthropicToOpenAIResult> {
  const o = resolveProviderOpts(opts);

  // ---- first-party pre-processing on the Anthropic shape ----
  let working: AnthropicChatRequest = promoteToolResultImages(req); // ⑧

  // ② Strip server/builtin tools FIRST-PARTY, before the vendor runs. This is
  // the single ACTIVE strip: `stripped` is exactly what left the request, so
  // the facade return is provably consistent with the wire tools (no reliance
  // on reading the vendor's internal strippedServerTools). The vendor
  // LEEMO-PATCH ② remains as a defense-in-depth backstop using the SAME
  // isServerTool predicate.
  const serverStrip = stripServerTools(working);
  working = serverStrip.request;
  const stripped = serverStrip.stripped;

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
  // reasoningInjection gate = LEEMO-PATCH ①; server-tool strip backstop = LEEMO-PATCH ②.
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
  // tools: [] (all server tools stripped) → omit; OpenAI rejects [].
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

  return { result: body, stripped };
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

/** Real usage the sniffer scraped off the OpenAI SSE, in Anthropic token terms
 *  (cached deducted from input). Present only when the upstream emitted a usage
 *  frame at all. */
interface ScrapedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

/** Options for openaiToAnthropicStream. When omitted, behaves like the legacy
 *  single-arg form (no backfill, no passthrough repair — vendor output verbatim). */
export interface StreamTranslateOpts {
  /** The originating Anthropic request — used for the o200k input estimate. */
  request?: AnthropicChatRequest;
  /** Per-provider switches; only `usageBackfill` is read here. */
  opts?: Partial<ProviderOpts>;
}

/** Extract usage from ONE OpenAI SSE `data:` JSON payload, or null. Mirrors the
 *  vendor's cached-token deduction so passthrough matches non-stream semantics. */
function scrapeUsage(obj: any): ScrapedUsage | null {
  if (!obj || typeof obj !== "object" || obj.usage == null) return null;
  const u = obj.usage;
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    input_tokens: (u.prompt_tokens || 0) - cached,
    output_tokens: u.completion_tokens || 0,
    cache_read_input_tokens: cached,
  };
}

/** A passthrough transform that forwards the upstream OpenAI SSE bytes UNCHANGED
 *  while scraping any usage frame the vendor would drop (the live relay batches
 *  the usage line into the same read as finish_reason, and the vendor's inner
 *  loop breaks on finish_reason before reaching it). `sink.usage` is populated
 *  as soon as a usage-bearing frame passes by. Pure observation — never mutates
 *  the byte stream, so vendor parsing is unaffected. */
function sniffUpstreamUsage(
  upstream: ReadableStream<Uint8Array>,
  sink: { usage: ScrapedUsage | null }
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  const scan = (text: string): void => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const scraped = scrapeUsage(JSON.parse(data));
        if (scraped) sink.usage = scraped;
      } catch {
        /* partial/garbled line — ignore; next read reassembles it */
      }
    }
  };
  const reader = upstream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer) scan("\n"); // flush any trailing bufferless line
        controller.close();
        return;
      }
      scan(decoder.decode(value, { stream: true }));
      controller.enqueue(value);
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

/** Rewrite the vendor's Anthropic SSE so usage is correct:
 *  - message_start.input_tokens ← upfront o200k estimate (auto) — nonzero so CC
 *    auto-compaction can trigger; the real prompt_tokens only arrives at stream
 *    end (co-arriving with finish_reason) and cannot land here without buffering.
 *  - terminal message_delta.usage ← REAL scraped upstream usage (passthrough,
 *    unmarked) when present; else o200k fallback (auto, marked leemo_estimated)
 *    over the accumulated output text; else left as-is ('off').
 *  Accumulates output text_delta to size the output estimate. */
function rewriteUsage(
  vendorStream: ReadableStream<Uint8Array>,
  sink: { usage: ScrapedUsage | null },
  inputEstimate: number,
  backfill: "auto" | "off"
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let outputText = "";

  const rewriteBlock = (block: string): string => {
    // A block is `event: X\ndata: {...}` WITHOUT its trailing `\n\n` (the caller
    // re-appends the separator uniformly). Parse the data line; patch; re-serialize.
    const lines = block.split("\n");
    let evName = "";
    let dataStr = "";
    for (const l of lines) {
      if (l.startsWith("event:")) evName = l.slice(6).trim();
      else if (l.startsWith("data:")) dataStr = l.slice(5).trim();
    }
    if (!dataStr) return block;
    let data: any;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return block; // not JSON (shouldn't happen for vendor output)
    }

    if (evName === "message_start" && data?.message?.usage) {
      if (backfill === "auto" && !sink.usage) {
        data.message.usage.input_tokens = inputEstimate;
      }
      return `event: message_start\ndata: ${JSON.stringify(data)}`;
    }

    if (evName === "content_block_delta" && data?.delta?.type === "text_delta") {
      if (typeof data.delta.text === "string") outputText += data.delta.text;
      return block; // unchanged
    }

    if (evName === "message_delta" && data?.usage) {
      if (sink.usage) {
        // real upstream usage — passthrough, never estimated
        data.usage.input_tokens = sink.usage.input_tokens;
        data.usage.output_tokens = sink.usage.output_tokens;
        data.usage.cache_read_input_tokens = sink.usage.cache_read_input_tokens;
      } else if (backfill === "auto") {
        data.usage.input_tokens = inputEstimate;
        data.usage.output_tokens = countText(outputText);
        data.usage.cache_read_input_tokens = data.usage.cache_read_input_tokens || 0;
        data.usage.leemo_estimated = true;
      }
      // backfill 'off' with no upstream usage → leave the vendor's zeros
      return `event: message_delta\ndata: ${JSON.stringify(data)}`;
    }

    return block;
  };

  const reader = vendorStream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        const rest = buffer.replace(/\n+$/, "");
        if (rest.trim()) controller.enqueue(encoder.encode(rewriteBlock(rest) + "\n\n"));
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      // emit complete `\n\n`-delimited blocks; keep the remainder buffered
      let idx: number;
      let out = "";
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        out += rewriteBlock(block) + "\n\n";
      }
      if (out) controller.enqueue(encoder.encode(out));
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
    },
  });
}

export async function openaiToAnthropicStream(
  upstream: ReadableStream<Uint8Array>,
  streamOpts?: StreamTranslateOpts
): Promise<ReadableStream<Uint8Array>> {
  const transformer = new AnthropicTransformer();
  const { logger, context } = makeVendorRuntime();
  transformer.logger = logger;

  // Legacy single-arg form: no request/opts → vendor output verbatim.
  if (!streamOpts) {
    const response = new Response(upstream as any, {
      headers: { "Content-Type": "text/event-stream" },
    });
    const converted = await transformer.transformResponseIn(response, context);
    if (!converted.body) throw new Error("vendor stream conversion returned no body");
    return converted.body as unknown as ReadableStream<Uint8Array>;
  }

  const o = resolveProviderOpts(streamOpts.opts);
  const backfill: "auto" | "off" = o.usageBackfill === "off" ? "off" : "auto";
  const inputEstimate =
    backfill === "auto" && streamOpts.request ? countTokens(streamOpts.request) : 0;

  // 1) sniff the upstream OpenAI bytes for the usage frame the vendor drops,
  //    forwarding bytes unchanged into the vendor transformer.
  const sink: { usage: ScrapedUsage | null } = { usage: null };
  const sniffed = sniffUpstreamUsage(upstream, sink);

  const response = new Response(sniffed as any, {
    headers: { "Content-Type": "text/event-stream" },
  });
  const converted = await transformer.transformResponseIn(response, context);
  if (!converted.body) throw new Error("vendor stream conversion returned no body");

  // 2) rewrite the vendor's Anthropic output using the scraped real usage (or
  //    the o200k fallback). By the time the vendor emits its terminal
  //    message_delta, the sniffer has already seen the co-arriving usage frame.
  return rewriteUsage(
    converted.body as unknown as ReadableStream<Uint8Array>,
    sink,
    inputEstimate,
    backfill
  );
}
