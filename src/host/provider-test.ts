// Leemo Host — provider connection test (轮 3 卡 F2).
//
// Sends a real (but injected-fetch, zero-live-network-in-tests) tiny probe
// request to a provider and reports latency/modelEcho/thinking/vision.
// Never throws: every failure path goes through classifyProviderError and
// resolves to {ok:false, error}. fetchFn + now are both injected so tests
// stay fully deterministic (mirrors src/bridge/balance.ts's discipline).
//
// KEY REALITY CHECK baked in below (卡 F probe, not assumption): HTTP 200
// does NOT mean vision is supported. DeepSeek happily accepts an image
// block, answers 200, and its text says "I cannot see your image" — so
// vision detection reads the REPLY TEXT, never just the status code.

import type {
  CapabilityProbeEvidence,
  ConnectionTestResult,
  ProviderApiFormat,
  ProviderAuthMode,
  ProviderError,
} from "../bridge/contract";
import { classifyProviderError } from "./provider-errors";

export interface ProviderTestTarget {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  apiFormat: ProviderApiFormat;
  authMode?: ProviderAuthMode;
  apiKeyHeader?: "authorization" | "x-api-key";
  headers?: Record<string, string>;
}

export interface ProviderTestDeps {
  fetchFn: typeof fetch;
  now?: () => number;
}

export interface ProviderTextRequestDeps {
  fetchFn: typeof fetch;
  maxTokens?: number;
}

export type ProviderTextRequestResult =
  | { ok: true; text: string }
  | { ok: false; error: ProviderError };

const ANTHROPIC_VERSION = "2023-06-01";

function buildAuthHeaders(target: ProviderTestTarget): Record<string, string> {
  if (target.authMode === "none") return {};
  return target.apiKeyHeader === "x-api-key"
    ? { "x-api-key": target.apiKey }
    : { authorization: `Bearer ${target.apiKey}` };
}

function withRequiredHeaders(
  custom: Record<string, string> | undefined,
  required: Record<string, string>,
): Record<string, string> {
  const reserved = new Set(Object.keys(required).map((name) => name.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(custom ?? {})) {
    if (!reserved.has(name.toLowerCase())) out[name] = value;
  }
  return { ...out, ...required };
}

// A real 32x32 red/blue checkerboard, tiny hand-built PNG. Deliberately NOT
// 1x1: qwen rejects a 1x1 image outright ("height:1 or width:1 must be
// larger than 10") and kimi fails to decode a degenerate 1x1 PNG — neither
// of those is a vision-capability signal, so the probe must dodge them by
// using a real multi-pixel image (卡 F finding).
const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAG0lEQVR4nGP8z8DAwIQHM+GRZmRkYGRgYAcAT3sD/wSSjQwAAAAASUVORK5CYII=";

// The reply-text signal for "this model actually described the image", not
// merely "the request returned 200" (卡 F: DeepSeek returns 200 + "I cannot
// see your image" for the same image block). Bilingual — 中/英 both covered.
const VISION_POSITIVE_RE = /red|blue|红|蓝/i;
const VISION_NEGATIVE_RE =
  /cannot see|can't see|无法查看|看不到|无法看到|do not have (the )?ability to (see|view)|not able to (see|view)/i;

interface AnthropicMessageResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      thinking?: string;
    };
  }>;
  usage?: {
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface OpenAIResponsesResponse {
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
    summary?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { output_tokens_details?: { reasoning_tokens?: number } };
}

function buildAnthropicHeaders(target: ProviderTestTarget): Record<string, string> {
  return withRequiredHeaders(target.headers, {
    ...buildAuthHeaders(target),
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  });
}

function buildOpenAIHeaders(target: ProviderTestTarget): Record<string, string> {
  return withRequiredHeaders(target.headers, {
    ...buildAuthHeaders(target),
    "content-type": "application/json",
  });
}

async function parseJsonSafe(res: Response): Promise<{ body?: unknown; rawText?: string }> {
  let text: string | undefined;
  try {
    text = await res.text();
  } catch {
    return {};
  }
  if (text === undefined) return {};
  try {
    return { body: JSON.parse(text) as unknown, rawText: text };
  } catch {
    return { rawText: text };
  }
}

/** Extract the reply text out of either wire shape, for the vision-reply-text
 *  check and (later, if ever needed) other text-based signals. */
function replyTextOf(apiFormat: ProviderApiFormat, body: unknown): string {
  if (apiFormat === "anthropic") {
    const anth = body as AnthropicMessageResponse;
    const blocks = anth.content ?? [];
    return blocks
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  if (apiFormat === "openai-responses") {
    return ((body as OpenAIResponsesResponse).output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("\n");
  }
  const oa = body as OpenAIChatResponse;
  return oa.choices?.[0]?.message?.content ?? "";
}

function hasThinkingBlock(apiFormat: ProviderApiFormat, body: unknown): boolean {
  if (apiFormat === "anthropic") {
    const anth = body as AnthropicMessageResponse;
    const blocks = anth.content ?? [];
    return blocks.some((b) => b && b.type === "thinking" && typeof b.thinking === "string");
  }
  if (apiFormat === "openai-responses") {
    const responses = body as OpenAIResponsesResponse;
    return (responses.output ?? []).some((item) =>
      item.type === "reasoning" && (item.summary ?? []).some((part) => typeof part.text === "string" && part.text.trim().length > 0)
    ) || (responses.usage?.output_tokens_details?.reasoning_tokens ?? 0) > 0;
  }
  const openai = body as OpenAIChatResponse;
  const message = openai.choices?.[0]?.message;
  return [message?.reasoning_content, message?.reasoning, message?.thinking]
    .some((value) => typeof value === "string" && value.trim().length > 0)
    || (openai.usage?.completion_tokens_details?.reasoning_tokens ?? 0) > 0;
}

function modelEchoOf(body: unknown): string | undefined {
  const rec = body as { model?: unknown };
  return typeof rec.model === "string" ? rec.model : undefined;
}

/** Verified only when the reply materially describes the red/blue image, and
 *  failed only when it explicitly says it cannot see the image. Empty or
 *  ambiguous replies stay unknown because a cheap probe is advisory evidence,
 *  never a permission gate. */
function classifyVisionReply(replyText: string): CapabilityProbeEvidence["status"] {
  if (VISION_NEGATIVE_RE.test(replyText)) return "failed";
  return VISION_POSITIVE_RE.test(replyText) ? "verified" : "unknown";
}

function evidence(
  status: CapabilityProbeEvidence["status"],
  checkedAt: number,
  error?: ProviderError,
): CapabilityProbeEvidence {
  return {
    status,
    checkedAt,
    ...(error ? { detail: error.message } : {}),
  };
}

async function postJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  payload: unknown
): Promise<{ status: number; body?: unknown; rawText?: string }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  } as RequestInit);
  const parsed = await parseJsonSafe(res);
  return { status: res.status, ...parsed };
}

function joinEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Make one small text-only request through an already configured provider.
 * This is intentionally not a second agent runtime: no tools, streaming or
 * conversation state are created, and provider credentials stay in Host.
 */
export async function requestProviderText(
  target: ProviderTestTarget,
  prompt: string,
  deps: ProviderTextRequestDeps,
): Promise<ProviderTextRequestResult> {
  const maxTokens = deps.maxTokens ?? 512;
  const isAnthropic = target.apiFormat === "anthropic";
  const isResponses = target.apiFormat === "openai-responses";

  try {
    const url = joinEndpoint(
      target.baseUrl,
      isAnthropic ? "/v1/messages" : isResponses ? "/responses" : "/chat/completions",
    );
    const headers = isAnthropic ? buildAnthropicHeaders(target) : buildOpenAIHeaders(target);
    const payload = isAnthropic
      ? {
          model: target.modelId,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }
      : isResponses
        ? {
            model: target.modelId,
            max_output_tokens: maxTokens,
            store: false,
            input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
          }
        : {
            model: target.modelId,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }],
          };
    const result = await postJson(deps.fetchFn, url, headers, payload);
    if (result.status < 200 || result.status >= 300) {
      return {
        ok: false,
        error: classifyProviderError({
          httpStatus: result.status,
          body: result.body,
          rawText: result.rawText,
          apiKey: target.apiKey,
        }),
      };
    }
    const text = replyTextOf(target.apiFormat, result.body).trim();
    if (!text) {
      return {
        ok: false,
        error: classifyProviderError({
          body: result.body,
          rawText: result.rawText,
          apiKey: target.apiKey,
        }),
      };
    }
    return { ok: true, text };
  } catch (thrown) {
    return { ok: false, error: classifyProviderError({ thrown, apiKey: target.apiKey }) };
  }
}

/**
 * Run a real (fetch-injected) connection probe against a provider. Never
 * throws. A failed baseline resolves to `{ok:false, error}` and skips the two
 * capability probes. Once the baseline succeeds, image and reasoning probes
 * run independently so one inconclusive capability check cannot hide the
 * other or overturn the working connection.
 */
export async function testProviderConnection(
  target: ProviderTestTarget,
  deps: ProviderTestDeps,
): Promise<ConnectionTestResult> {
  const { fetchFn } = deps;
  const now = deps.now ?? (() => Date.now());
  const isAnthropic = target.apiFormat === "anthropic";
  const isResponses = target.apiFormat === "openai-responses";

  const start = now();
  let status: number;
  let body: unknown;
  let rawText: string | undefined;

  try {
    if (isAnthropic) {
      const url = joinEndpoint(target.baseUrl, "/v1/messages");
      const headers = buildAnthropicHeaders(target);
      const payload = {
        model: target.modelId,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with OK." }],
      };
      const result = await postJson(fetchFn, url, headers, payload);
      status = result.status;
      body = result.body;
      rawText = result.rawText;
    } else {
      const url = joinEndpoint(target.baseUrl, isResponses ? "/responses" : "/chat/completions");
      const headers = buildOpenAIHeaders(target);
      const payload = isResponses
        ? {
            model: target.modelId,
            max_output_tokens: 16,
            store: false,
            input: [{ role: "user", content: [{ type: "input_text", text: "Reply with OK." }] }],
          }
        : {
            model: target.modelId,
            max_tokens: 16,
            messages: [{ role: "user", content: "Reply with OK." }],
          };
      const result = await postJson(fetchFn, url, headers, payload);
      status = result.status;
      body = result.body;
      rawText = result.rawText;
    }
  } catch (thrown) {
    return {
      ok: false,
      error: classifyProviderError({ thrown, apiKey: target.apiKey }),
    };
  }

  const latencyMs = now() - start;
  const succeeded = isAnthropic
    ? status >= 200 && status < 300 && Array.isArray((body as AnthropicMessageResponse | undefined)?.content)
    : isResponses
      ? status >= 200 && status < 300 && Array.isArray((body as OpenAIResponsesResponse | undefined)?.output)
      : status >= 200 && status < 300 && Array.isArray((body as OpenAIChatResponse | undefined)?.choices) &&
        (body as OpenAIChatResponse).choices!.length > 0;

  if (!succeeded) {
    return {
      ok: false,
      error: classifyProviderError({ httpStatus: status, body, rawText, apiKey: target.apiKey }),
    };
  }

  const result: ConnectionTestResult = {
    ok: true,
    latencyMs,
  };
  const echo = modelEchoOf(body);
  if (echo !== undefined) result.modelEcho = echo;
  result.thinking = hasThinkingBlock(target.apiFormat, body);
  let imageEvidence: CapabilityProbeEvidence;
  try {
    let visionHttpStatus: number;
    let visionBody: unknown;
    let visionRawText: string | undefined;

    if (isAnthropic) {
      const url = joinEndpoint(target.baseUrl, "/v1/messages");
      const headers = buildAnthropicHeaders(target);
      const payload = {
        model: target.modelId,
        max_tokens: 24,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: TEST_IMAGE_BASE64 },
              },
              { type: "text", text: "What colors do you see in this image? Answer briefly." },
            ],
          },
        ],
      };
      const r = await postJson(fetchFn, url, headers, payload);
      visionHttpStatus = r.status;
      visionBody = r.body;
      visionRawText = r.rawText;
    } else {
      const url = joinEndpoint(target.baseUrl, isResponses ? "/responses" : "/chat/completions");
      const headers = buildOpenAIHeaders(target);
      const payload = isResponses
        ? {
            model: target.modelId,
            max_output_tokens: 24,
            store: false,
            input: [{ role: "user", content: [
              { type: "input_image", image_url: `data:image/png;base64,${TEST_IMAGE_BASE64}` },
              { type: "input_text", text: "What colors do you see in this image? Answer briefly." },
            ] }],
          }
        : {
            model: target.modelId,
            max_tokens: 24,
            messages: [{ role: "user", content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${TEST_IMAGE_BASE64}` } },
              { type: "text", text: "What colors do you see in this image? Answer briefly." },
            ] }],
          };
      const r = await postJson(fetchFn, url, headers, payload);
      visionHttpStatus = r.status;
      visionBody = r.body;
      visionRawText = r.rawText;
    }

    const visionSucceeded = visionHttpStatus >= 200 && visionHttpStatus < 300;
    if (!visionSucceeded) {
      // Keep the legacy boolean undefined: an HTTP rejection is evidence about
      // this probe, not permission to ban image sends for the model.
      result.visionProbeError = classifyProviderError({
        httpStatus: visionHttpStatus,
        body: visionBody,
        rawText: visionRawText,
        apiKey: target.apiKey,
      });
      imageEvidence = evidence("failed", now(), result.visionProbeError);
    } else {
      const replyText = replyTextOf(target.apiFormat, visionBody);
      const status = classifyVisionReply(replyText);
      imageEvidence = evidence(status, now());
      if (status === "verified") result.vision = true;
      else if (status === "failed") result.vision = false;
    }
  } catch (e) {
    // Text already worked; a network failure on this one probe stays unknown.
    result.visionProbeError = classifyProviderError({ thrown: e, apiKey: target.apiKey });
    imageEvidence = evidence("unknown", now(), result.visionProbeError);
  }

  let reasoningEvidence: CapabilityProbeEvidence;
  try {
    const url = joinEndpoint(
      target.baseUrl,
      isAnthropic ? "/v1/messages" : isResponses ? "/responses" : "/chat/completions",
    );
    const headers = isAnthropic ? buildAnthropicHeaders(target) : buildOpenAIHeaders(target);
    const payload = isAnthropic
      ? {
          model: target.modelId,
          max_tokens: 1088,
          thinking: { type: "enabled", budget_tokens: 1024 },
          messages: [{ role: "user", content: "What is 2+2? Answer with only the number." }],
        }
      : isResponses
        ? {
            model: target.modelId,
            max_output_tokens: 64,
            store: false,
            reasoning: { effort: "low", summary: "auto" },
            input: [{ role: "user", content: [{ type: "input_text", text: "What is 2+2? Answer with only the number." }] }],
          }
        : {
          model: target.modelId,
          max_completion_tokens: 64,
          reasoning_effort: "low",
          messages: [{ role: "user", content: "What is 2+2? Answer with only the number." }],
        };
    const reasoning = await postJson(fetchFn, url, headers, payload);
    if (reasoning.status < 200 || reasoning.status >= 300) {
      const error = classifyProviderError({
        httpStatus: reasoning.status,
        body: reasoning.body,
        rawText: reasoning.rawText,
        apiKey: target.apiKey,
      });
      reasoningEvidence = evidence("failed", now(), error);
    } else {
      const status = hasThinkingBlock(target.apiFormat, reasoning.body) ? "verified" : "unknown";
      reasoningEvidence = evidence(status, now());
      result.thinking = result.thinking === true || status === "verified";
    }
  } catch (e) {
    const error = classifyProviderError({ thrown: e, apiKey: target.apiKey });
    reasoningEvidence = evidence("unknown", now(), error);
  }

  result.capabilityProbes = { image: imageEvidence, reasoning: reasoningEvidence };
  return result;
}
