// Leemo gateway core — token counting + endpoint-face classification (⑬).
//
// count_tokens uses gpt-tokenizer's o200k_base as a provider-agnostic
// approximation (Claude's real tokenizer is closed; CC's compaction logic only
// needs a stable estimate). classifyEndpoint is the pure routing helper G3's
// http shell uses to recognise the Anthropic endpoint face the SDK always hits:
// /v1/messages (with the mandatory ?beta=true), the count_tokens sub-path,
// /v1/models and /health.

import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { AnthropicChatRequest } from "./normalize";

/** Collect all human/tool text in an Anthropic request into one string. */
function gatherText(req: AnthropicChatRequest): string {
  const parts: string[] = [];

  const pushContent = (content: unknown): void => {
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block === null || typeof block !== "object") continue;
        const b = block as Record<string, any>;
        if (typeof b.text === "string") parts.push(b.text);
        if (typeof b.content === "string") parts.push(b.content);
        else if (Array.isArray(b.content)) pushContent(b.content);
        if (b.input) parts.push(JSON.stringify(b.input));
      }
    }
  };

  if (req.system) pushContent(req.system);
  for (const msg of req.messages ?? []) pushContent(msg.content);
  if (Array.isArray(req.tools)) {
    for (const t of req.tools) {
      if (t.name) parts.push(t.name);
      if (t.description) parts.push(t.description);
      if (t.input_schema) parts.push(JSON.stringify(t.input_schema));
    }
  }
  return parts.join("\n");
}

/** Approximate token count for an Anthropic request, using o200k_base.
 *  Stable + deterministic; used by count_tokens. */
export function countTokens(req: AnthropicChatRequest): number {
  const text = gatherText(req);
  if (!text) return 0;
  return encode(text).length;
}

/** Approximate token count for a bare string, using o200k_base. Used by the
 *  streaming usage backfill (B0) to estimate output_tokens from the accumulated
 *  assistant text when the upstream emits no usage frame. */
export function countText(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export type EndpointKind =
  | "messages"
  | "count_tokens"
  | "models"
  | "health"
  | "unknown";

export interface EndpointFace {
  kind: EndpointKind;
  /** whether the request carried the ?beta=true the SDK always sends */
  beta: boolean;
}

/** Classify an incoming request path+query into the endpoint face. Pure. */
export function classifyEndpoint(url: string): EndpointFace {
  const [pathRaw, queryRaw = ""] = url.split("?");
  const path = pathRaw.replace(/\/+$/, "") || "/";
  const beta = /(^|&)beta=true(&|$)/.test(queryRaw);

  let kind: EndpointKind;
  if (path === "/v1/messages/count_tokens") kind = "count_tokens";
  else if (path === "/v1/messages") kind = "messages";
  else if (path === "/v1/models") kind = "models";
  else if (path === "/health") kind = "health";
  else kind = "unknown";

  return { kind, beta };
}
