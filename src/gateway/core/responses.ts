// OpenAI Responses API <-> Anthropic Messages conversion.
//
// Leemo keeps the Claude Agent SDK on the Anthropic side of its local gateway,
// while Responses-native providers (OpenAI, TokenFlux, MiMo...) speak their
// current upstream wire format. This module is intentionally first-party and
// structural: it does not depend on the vendor Chat Completions transformer.

import { Buffer } from "node:buffer";
import { resolveProviderOpts, type ProviderOpts } from "./provider-opts";
import {
  stripServerTools,
  type AnthropicChatRequest,
  type AnthropicTool,
} from "./normalize";

export interface ResponsesBody {
  model: string;
  input: any[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  tool_choice?: unknown;
  reasoning?: { effort: string; summary?: "auto" };
  include?: string[];
  /** Keep conversation state in the Claude harness, not provider-side storage. */
  store: false;
  [key: string]: unknown;
}

export interface AnthropicToResponsesResult {
  result: ResponsesBody;
  stripped: AnthropicTool[];
}

function textFromBlocks(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as any).text === "string") {
        return (part as any).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function imageUrl(block: any): string | undefined {
  const source = block?.source;
  if (!source || typeof source !== "object") return undefined;
  if (typeof source.url === "string") return source.url;
  if (typeof source.data === "string" && typeof source.media_type === "string") {
    return `data:${source.media_type};base64,${source.data}`;
  }
  return undefined;
}

const REASONING_ENVELOPE_PREFIX = "leemo-openai-reasoning-v1:";

function encodeReasoningItem(item: any): string | undefined {
  if (item?.type !== "reasoning") return undefined;
  const content = Array.isArray(item.content)
    ? item.content.filter((part: any) =>
        part?.type === "reasoning_text" && typeof part.text === "string"
      ).map((part: any) => ({ type: "reasoning_text", text: part.text }))
    : [];
  const encryptedContent = typeof item.encrypted_content === "string" && item.encrypted_content
    ? item.encrypted_content
    : undefined;
  if (!encryptedContent && content.length === 0) return undefined;
  const replay = {
    ...(typeof item.id === "string" ? { id: item.id } : {}),
    type: "reasoning",
    ...(Array.isArray(item.summary) ? { summary: item.summary } : {}),
    ...(content.length > 0 ? { content } : {}),
    ...(encryptedContent ? { encrypted_content: encryptedContent } : {}),
  };
  return `${REASONING_ENVELOPE_PREFIX}${Buffer.from(JSON.stringify(replay), "utf8").toString("base64url")}`;
}

function decodeReasoningItem(value: unknown): any | undefined {
  if (typeof value !== "string" || !value.startsWith(REASONING_ENVELOPE_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(REASONING_ENVELOPE_PREFIX.length), "base64url").toString("utf8"));
    const hasEncrypted = typeof parsed?.encrypted_content === "string" && parsed.encrypted_content.length > 0;
    const hasReasoningText = Array.isArray(parsed?.content) && parsed.content.some((part: any) =>
      part?.type === "reasoning_text" && typeof part.text === "string"
    );
    return parsed?.type === "reasoning" && (hasEncrypted || hasReasoningText) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function messageInputs(role: string, content: unknown): any[] {
  if (typeof content === "string") {
    return [{
      role: role === "assistant" ? "assistant" : "user",
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text: content }],
    }];
  }
  if (!Array.isArray(content)) return [];
  const out: any[] = [];
  const parts: any[] = [];
  const flush = () => {
    if (!parts.length) return;
    out.push({ role: role === "assistant" ? "assistant" : "user", content: parts.splice(0) });
  };
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ type: role === "assistant" ? "output_text" : "input_text", text: block.text });
    } else if (role !== "assistant" && block.type === "image") {
      const url = imageUrl(block);
      if (url) parts.push({ type: "input_image", image_url: url });
    } else {
      flush();
      if (role === "assistant" && (block.type === "thinking" || block.type === "redacted_thinking")) {
        const reasoning = decodeReasoningItem(block.type === "thinking" ? block.signature : block.data);
        if (reasoning) out.push(reasoning);
      } else if (role === "assistant" && block.type === "tool_use") {
        out.push({
          type: "function_call",
          call_id: String(block.id ?? ""),
          name: String(block.name ?? ""),
          arguments: JSON.stringify(block.input ?? {}),
        });
      } else if (role !== "assistant" && block.type === "tool_result") {
        out.push({
          type: "function_call_output",
          call_id: String(block.tool_use_id ?? ""),
          output: toolResultOutput(block.content),
        });
      }
    }
  }
  flush();
  return out;
}

function toolResultOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  const text = textFromBlocks(content);
  return text || JSON.stringify(content);
}

function responsesToolChoice(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const choice = value as any;
  if (choice.type === "tool" && typeof choice.name === "string") {
    return { type: "function", name: choice.name };
  }
  if (choice.type === "any") return "required";
  if (choice.type === "auto" || choice.type === "none") return choice.type;
  return value;
}

/** Convert an Anthropic Messages request into a stateless Responses request. */
export function anthropicToResponses(
  req: AnthropicChatRequest,
  opts?: Partial<ProviderOpts>
): AnthropicToResponsesResult {
  const provider = resolveProviderOpts(opts);
  const { request, stripped } = stripServerTools(req);
  const input: any[] = [];

  for (const message of request.messages) {
    input.push(...messageInputs(message.role, message.content));
  }

  const body: ResponsesBody = {
    model: request.model,
    input,
    store: false,
  };
  if (provider.responsesDialect === "openai") {
    body.include = ["reasoning.encrypted_content"];
  }
  const instructions = textFromBlocks(request.system);
  if (instructions) body.instructions = instructions;
  if (typeof request.max_tokens === "number") body.max_output_tokens = request.max_tokens;
  if (typeof request.temperature === "number") body.temperature = request.temperature;
  if (request.stream !== undefined) body.stream = request.stream;
  if (request.tool_choice !== undefined) body.tool_choice = responsesToolChoice(request.tool_choice);
  if (Array.isArray(request.tools) && request.tools.length) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema ?? { type: "object", properties: {} },
    }));
  }
  if (request.thinking?.type === "enabled" || provider.thinkingEffort) {
    body.reasoning = provider.responsesDialect === "mimo"
      ? { effort: provider.thinkingEffort ?? "medium" }
      : { effort: provider.thinkingEffort ?? "medium", summary: "auto" };
  }

  return { result: body, stripped };
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function reasoningSummary(item: any): string {
  const summary = item?.summary;
  if (typeof summary === "string") return summary;
  const parts = Array.isArray(summary) ? summary : Array.isArray(item?.content) ? item.content : [];
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function anthropicReasoningBlock(item: any): Record<string, unknown> | undefined {
  const summary = reasoningSummary(item);
  const envelope = encodeReasoningItem(item);
  if (envelope) {
    return summary
      ? { type: "thinking", thinking: summary, signature: envelope }
      : { type: "redacted_thinking", data: envelope };
  }
  return summary ? { type: "thinking", thinking: summary } : undefined;
}

function usageFromResponses(usage: any): Record<string, number> {
  const cached = Number(usage?.input_tokens_details?.cached_tokens ?? 0);
  const input = Number(usage?.input_tokens ?? 0);
  return {
    input_tokens: Math.max(0, input - cached),
    output_tokens: Number(usage?.output_tokens ?? 0),
    cache_read_input_tokens: cached,
  };
}

function responseStopReason(response: any, hasToolUse: boolean): "end_turn" | "tool_use" | "max_tokens" {
  if (hasToolUse) return "tool_use";
  const reason = response?.incomplete_details?.reason;
  if (response?.status === "incomplete" && (reason === "max_output_tokens" || reason === "max_tokens")) {
    return "max_tokens";
  }
  return "end_turn";
}

/** Convert a complete Responses result. Only public reasoning summaries are emitted. */
export function responsesToAnthropicResponse(response: any): Record<string, any> {
  const content: any[] = [];
  let hasToolUse = false;
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "reasoning") {
      const block = anthropicReasoningBlock(item);
      if (block) content.push(block);
    } else if (item.type === "message") {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      hasToolUse = true;
      content.push({
        type: "tool_use",
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
        input: parseArguments(item.arguments),
      });
    }
  }
  if (!content.length) content.push({ type: "text", text: "" });
  return {
    id: String(response?.id ?? ""),
    type: "message",
    role: "assistant",
    model: String(response?.model ?? ""),
    content,
    stop_reason: responseStopReason(response, hasToolUse),
    stop_sequence: null,
    usage: usageFromResponses(response?.usage),
  };
}

type OutputBlockKind = "text" | "thinking" | "tool_use";
interface StreamState {
  messageStarted: boolean;
  nextIndex: number;
  active?: { id: string; index: number; kind: OutputBlockKind };
  blocks: Map<string, { index: number; kind: OutputBlockKind; sawArguments?: boolean; sawText?: boolean }>;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage: Record<string, number>;
}

function sse(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function anthropicError(message: string): string {
  return sse("error", { type: "error", error: { type: "api_error", message } });
}

function ensureMessageStart(state: StreamState, out: string[], response?: any): void {
  if (state.messageStarted) return;
  state.messageStarted = true;
  out.push(sse("message_start", {
    type: "message_start",
    message: {
      id: String(response?.id ?? ""),
      type: "message",
      role: "assistant",
      model: String(response?.model ?? ""),
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: usageFromResponses(response?.usage),
    },
  }));
}

function closeActive(state: StreamState, out: string[]): void {
  if (!state.active) return;
  out.push(sse("content_block_stop", { type: "content_block_stop", index: state.active.index }));
  state.active = undefined;
}

function openBlock(
  state: StreamState,
  out: string[],
  id: string,
  kind: OutputBlockKind,
  contentBlock: Record<string, unknown>
): number {
  if (state.active?.id === id) return state.active.index;
  closeActive(state, out);
  const existing = state.blocks.get(id);
  const index = existing?.index ?? state.nextIndex++;
  state.blocks.set(id, { index, kind, sawArguments: existing?.sawArguments, sawText: existing?.sawText });
  state.active = { id, index, kind };
  out.push(sse("content_block_start", { type: "content_block_start", index, content_block: contentBlock }));
  return index;
}

function completeStream(state: StreamState, out: string[], response: any): void {
  ensureMessageStart(state, out, response);
  closeActive(state, out);
  const hasToolUse = [...state.blocks.values()].some((block) => block.kind === "tool_use");
  state.stopReason = responseStopReason(response, hasToolUse);
  state.usage = usageFromResponses(response?.usage);
  out.push(sse("message_delta", {
    type: "message_delta",
    delta: { stop_reason: state.stopReason, stop_sequence: null },
    usage: state.usage,
  }));
  out.push(sse("message_stop", { type: "message_stop" }));
}

function handleResponsesEvent(state: StreamState, event: any): string[] {
  const out: string[] = [];
  const type = typeof event?.type === "string" ? event.type : "";
  if (type === "response.created") {
    ensureMessageStart(state, out, event.response);
    return out;
  }
  if (type === "response.failed" || type === "error") {
    const message = event?.response?.error?.message ?? event?.error?.message ?? "Responses upstream failed";
    out.push(anthropicError(String(message)));
    return out;
  }
  if (type === "response.completed" || type === "response.incomplete") {
    completeStream(state, out, event.response ?? {});
    return out;
  }

  ensureMessageStart(state, out);
  if (type === "response.output_item.added") {
    const item = event.item ?? {};
    const id = String(item.id ?? `output-${event.output_index ?? state.nextIndex}`);
    if (item.type === "function_call") {
      openBlock(state, out, id, "tool_use", {
        type: "tool_use",
        id: String(item.call_id ?? item.id ?? ""),
        name: String(item.name ?? ""),
        input: {},
      });
    } else if (item.type === "reasoning") {
      state.blocks.set(id, { index: state.nextIndex++, kind: "thinking" });
    }
    return out;
  }
  if (type === "response.output_text.delta") {
    const id = `text-${event.output_index ?? 0}`;
    const index = openBlock(state, out, id, "text", { type: "text", text: "" });
    if (typeof event.delta === "string" && event.delta) {
      out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: event.delta } }));
    }
    return out;
  }
  if (
    type === "response.reasoning_summary_text.delta"
    || type === "response.reasoning.delta"
    || type === "response.reasoning_text.delta"
  ) {
    const id = String(event.item_id ?? "reasoning");
    const index = openBlock(state, out, id, "thinking", { type: "thinking", thinking: "", signature: "" });
    if (typeof event.delta === "string" && event.delta) {
      const block = state.blocks.get(id);
      state.blocks.set(id, { index, kind: "thinking", sawText: true, sawArguments: block?.sawArguments });
      out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: event.delta } }));
    }
    return out;
  }
  if (type === "response.function_call_arguments.delta") {
    const id = String(event.item_id ?? `tool-${event.output_index ?? 0}`);
    const block = state.blocks.get(id);
    const index = block?.index ?? openBlock(state, out, id, "tool_use", { type: "tool_use", id, name: "", input: {} });
    if (typeof event.delta === "string" && event.delta) {
      state.blocks.set(id, { index, kind: "tool_use", sawArguments: true });
      out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: event.delta } }));
    }
    return out;
  }
  if (type === "response.function_call_arguments.done") {
    const id = String(event.item_id ?? `tool-${event.output_index ?? 0}`);
    const block = state.blocks.get(id);
    const argumentsText = event.arguments ?? event.item?.arguments;
    if (block && !block.sawArguments && typeof argumentsText === "string" && argumentsText) {
      out.push(sse("content_block_delta", { type: "content_block_delta", index: block.index, delta: { type: "input_json_delta", partial_json: argumentsText } }));
      state.blocks.set(id, { ...block, sawArguments: true });
    }
    return out;
  }
  if (type === "response.output_item.done" && event.item?.type === "reasoning") {
    const item = event.item;
    const id = String(item.id ?? event.item_id ?? `reasoning-${event.output_index ?? 0}`);
    let block = state.blocks.get(id);
    const summary = reasoningSummary(item);
    if (summary && !block?.sawText) {
      const index = openBlock(state, out, id, "thinking", { type: "thinking", thinking: "", signature: "" });
      out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: summary } }));
      block = { ...(state.blocks.get(id) ?? { index, kind: "thinking" as const }), sawText: true };
      state.blocks.set(id, block);
    }
    const envelope = encodeReasoningItem(item);
    if (envelope) {
      if (!block?.sawText) {
        const index = openBlock(state, out, id, "thinking", { type: "redacted_thinking", data: envelope });
        block = { index, kind: "thinking" };
        state.blocks.set(id, block);
      } else {
        const index = state.active?.id === id
          ? state.active.index
          : openBlock(state, out, id, "thinking", { type: "thinking", thinking: "", signature: "" });
        out.push(sse("content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: envelope } }));
      }
    }
    if (state.active?.id === id) closeActive(state, out);
    return out;
  }
  if (
    type === "response.output_item.done"
    || type === "response.content_part.done"
    || type === "response.output_text.done"
    || type === "response.reasoning.done"
    || type === "response.reasoning_text.done"
  ) {
    const id = String(event.item_id ?? event.item?.id ?? `text-${event.output_index ?? 0}`);
    if (state.active?.id === id) closeActive(state, out);
  }
  return out;
}

export interface ResponsesStreamOptions {
  /** Passed through from the upstream fetch so cancellation reaches the reader. */
  signal?: AbortSignal;
}

/** Convert a fragmented Responses SSE byte stream to Anthropic SSE. */
export function responsesToAnthropicStream(
  upstream: ReadableStream<Uint8Array>,
  options: ResponsesStreamOptions = {}
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: StreamState = {
    messageStarted: false,
    nextIndex: 0,
    blocks: new Map(),
    stopReason: "end_turn",
    usage: usageFromResponses(undefined),
  };
  let buffer = "";
  let done = false;
  let cancelled = false;
  const cancel = (reason?: unknown) => {
    if (cancelled) return;
    cancelled = true;
    reader.cancel(reason).catch(() => {});
  };
  options.signal?.addEventListener("abort", () => cancel(options.signal?.reason), { once: true });

  const parseBlock = (block: string): any | undefined => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return undefined;
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) {
        controller.close();
        return;
      }
      if (options.signal?.aborted) {
        cancel(options.signal.reason);
        done = true;
        controller.error(options.signal.reason ?? new DOMException("Aborted", "AbortError"));
        return;
      }
      // A TCP read often ends halfway through one SSE block. Keep reading until
      // there is a complete downstream event to enqueue, otherwise a consumer
      // waiting on this pull would never cause another pull and the relay stalls.
      while (!done) {
        const { value, done: upstreamDone } = await reader.read();
        if (upstreamDone) {
          done = true;
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary: RegExpMatchArray | null;
        let emitted = "";
        while ((boundary = buffer.match(/\r?\n\r?\n/)) !== null) {
          const cut = boundary.index ?? 0;
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + boundary[0].length);
          const event = parseBlock(block);
          if (event) emitted += handleResponsesEvent(state, event).join("");
        }
        if (emitted) {
          controller.enqueue(encoder.encode(emitted));
          return;
        }
      }
    },
    cancel(reason) {
      cancel(reason);
    },
  });
}
