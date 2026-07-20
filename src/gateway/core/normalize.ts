// Leemo gateway core — anthropic-request normalization helpers (first-party).
//
// These operate on the *Anthropic* request shape BEFORE it reaches the vendor
// AnthropicTransformer, plus one JSON-Schema flattener for the unified/OpenAI
// tool shape. They are pure functions: no I/O, no vendor types on the surface,
// and they never mutate their input (structuredClone at every entry).
//
// Covered pitfalls: ②(server-tool observable strip — first-party helper for the
// G3 shell to log; the vendor patch is the in-pipeline strip) ⑤(cache_control
// handled in translate) ⑧(tool_result image promotion) ⑨(thinking budget per
// NewMax EFFORT_BUDGET_MAP) ⑪(GLM anyOf/oneOf/$ref/$defs flatten).

import type { EffortLevel } from "./provider-opts";

// ---- Structural Anthropic request types (permissive; not vendor-derived) ----

export type JsonSchema = { [k: string]: any };

export interface AnthropicTool {
  name?: string;
  description?: string;
  input_schema?: JsonSchema;
  /** Server/builtin tools carry a versioned `type` (web_search_*, computer_*,
   *  bash_*, text_editor_*, code_execution_*); client custom tools do not
   *  (or use type:"custom"). */
  type?: string;
  [k: string]: unknown;
}

export interface AnthropicMessage {
  role: "user" | "assistant" | "system" | string;
  content: string | any[];
  [k: string]: unknown;
}

export interface AnthropicChatRequest {
  model: string;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  system?: string | any[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: unknown;
  thinking?: { type: "enabled" | "disabled"; budget_tokens?: number };
  [k: string]: unknown;
}

// NewMax 逆向图纸: effort → thinking budget_tokens. default 16000.
export const EFFORT_BUDGET_MAP: Record<EffortLevel, number> = {
  low: 4000,
  medium: 12000,
  high: 24000,
  xhigh: 40000,
  max: 60000,
};
export const DEFAULT_THINKING_BUDGET = 16000;

/** Deep clone safe for our plain-JSON request shapes. */
function clone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * Map a NewMax effort level → thinking budget, or disable thinking entirely for
 * models without the capability. Returns a modified copy; never mutates input.
 * (Pitfall ⑨, request-side normalization. The per-provider *injection* gate is
 * enforced separately by LEEMO-PATCH ① inside the vendor transformer.)
 */
export function normalizeThinking(
  req: AnthropicChatRequest,
  capability: boolean,
  effort?: EffortLevel
): AnthropicChatRequest {
  const out = clone(req);
  if (!capability) {
    // Model can't think — force-disable so we never inject reasoning that breaks it.
    out.thinking = { type: "disabled", budget_tokens: -1 };
    return out;
  }
  const budget = effort ? EFFORT_BUDGET_MAP[effort] : DEFAULT_THINKING_BUDGET;
  out.thinking = { type: "enabled", budget_tokens: budget };
  return out;
}

/**
 * The SINGLE source of truth for "is this a server/builtin tool?" (pitfall ②).
 * A server tool carries a versioned, non-"custom" `type` (web_search_*,
 * computer_*, bash_*, text_editor_*, code_execution_*). Client custom tools
 * have no `type`, or `type:"custom"`. Deliberately does NOT inspect
 * input_schema: server tools MAY carry one, and an input_schema clause here was
 * the source of the vendor/normalize predicate divergence. Both the facade
 * (translate.ts) and the vendor backstop (LEEMO-PATCH ②) defer to this rule.
 */
export function isServerTool(tool: AnthropicTool): boolean {
  const type = typeof tool?.type === "string" ? tool.type : "";
  return type !== "" && type !== "custom";
}

/**
 * Observably strip server/builtin tools (pitfall ②, first-party half). Client
 * custom tools (no `type`, or type:"custom") are kept; everything else is
 * removed and returned in `stripped` so the shell can log it. When nothing
 * remains, the `tools` key is dropped entirely (OpenAI rejects tools:[]).
 */
export function stripServerTools(req: AnthropicChatRequest): {
  request: AnthropicChatRequest;
  stripped: AnthropicTool[];
} {
  const request = clone(req);
  const stripped: AnthropicTool[] = [];
  if (Array.isArray(request.tools)) {
    const kept: AnthropicTool[] = [];
    for (const t of request.tools) {
      if (isServerTool(t)) stripped.push(t);
      else kept.push(t);
    }
    if (kept.length) request.tools = kept;
    else delete request.tools;
  }
  return { request, stripped };
}

/**
 * Lift images nested inside a tool_result into a standalone following user
 * message (pitfall ⑧). The vendor JSON-stringifies tool_result content into a
 * role:tool message, which would destroy any nested image; promoting them first
 * lets the vendor map them to OpenAI image_url blocks. Never mutates input.
 */
export function promoteToolResultImages(
  req: AnthropicChatRequest
): AnthropicChatRequest {
  const request = clone(req);
  const newMessages: AnthropicMessage[] = [];
  for (const msg of request.messages) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const promoted: any[] = [];
      for (const block of msg.content as any[]) {
        if (block && block.type === "tool_result" && Array.isArray(block.content)) {
          const kept: any[] = [];
          for (const inner of block.content) {
            if (inner && inner.type === "image" && inner.source) promoted.push(inner);
            else kept.push(inner);
          }
          if (promoted.length && kept.length === 0) {
            kept.push({
              type: "text",
              text: "[image content moved to a following message]",
            });
          }
          block.content = kept;
        }
      }
      newMessages.push(msg);
      if (promoted.length) {
        newMessages.push({ role: "user", content: promoted });
      }
    } else {
      newMessages.push(msg);
    }
  }
  request.messages = newMessages;
  return request;
}

// ---- JSON-Schema flattening (pitfall ⑪; GLM rejects anyOf/oneOf/$ref/$defs) --

function resolveRef(ref: string, root: JsonSchema): JsonSchema | undefined {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/");
  let cur: any = root;
  for (const raw of parts) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur && typeof cur === "object" && key in cur) cur = cur[key];
    else return undefined;
  }
  return cur;
}

/** Pick a representative subschema from an anyOf/oneOf list: prefer one with a
 *  non-null `type`, else the first with any `type`, else the first element. */
function pickSubschema(list: JsonSchema[]): JsonSchema {
  const nonNull = list.find(
    (s) => s && typeof s === "object" && s.type && s.type !== "null"
  );
  if (nonNull) return nonNull;
  const typed = list.find((s) => s && typeof s === "object" && s.type);
  if (typed) return typed;
  return list[0] ?? {};
}

/**
 * Produce an equivalent JSON-Schema free of anyOf/oneOf/$ref/$defs: unions
 * collapse to a representative branch, $ref is resolved inline against the
 * root's $defs/definitions. Never mutates input.
 */
export function flattenToolSchema(schema: JsonSchema): JsonSchema {
  const root = clone(schema);
  const seenRefs = new Set<string>();

  const walk = (node: any): any => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(walk);

    // Resolve $ref (with a simple cycle guard).
    if (typeof node.$ref === "string") {
      const ref = node.$ref;
      if (seenRefs.has(ref)) return {};
      seenRefs.add(ref);
      const resolved = resolveRef(ref, root);
      const { $ref, ...siblings } = node;
      const merged =
        resolved !== undefined ? { ...clone(resolved), ...siblings } : siblings;
      const result = walk(merged);
      seenRefs.delete(ref);
      return result;
    }

    // Collapse anyOf / oneOf into the node.
    let base: JsonSchema = node;
    for (const key of ["anyOf", "oneOf"] as const) {
      if (Array.isArray(base[key]) && base[key].length) {
        const chosen = pickSubschema(base[key]);
        const { [key]: _drop, ...rest } = base;
        base = { ...rest, ...chosen };
      }
    }

    // Recurse, dropping schema-container keys the target rejects.
    const out: JsonSchema = {};
    for (const k of Object.keys(base)) {
      if (k === "$defs" || k === "definitions") continue;
      out[k] = walk(base[k]);
    }
    return out;
  };

  return walk(root);
}

export { clone as _clone };
