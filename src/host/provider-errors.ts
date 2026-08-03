// Leemo Host — provider error humanization (轮 3 卡 F2).
//
// Translates a raw upstream failure (HTTP status + body, or a thrown
// network-level error) into a `ProviderError` a person can act on (06 §3.5).
// Mirrors src/bridge/balance.ts's discipline: never throws, and never lets
// the caller's apiKey leak into `message`/`detail` (redaction is the last
// line of defense — callers should not echo the key in the first place).
//
// Classification is grounded in FOUR REAL VENDORS' ACTUAL RESPONSES (卡 F
// probes against deepseek/kimi/glm/dashscope — not vendor docs). See the
// per-branch comments below and the test fixtures, which use the exact body
// shapes/text the probes captured. Two kinds (`balance`, `region`) have NO
// real fixture from any of the four vendors probed this round — those
// branches are best-effort keyword heuristics, called out below and in the
// test file, so a future real fixture can replace the placeholder without
// hunting for where the logic lives.

import type { ProviderError, ProviderErrorKind } from "../bridge/contract";

export interface ClassifyProviderErrorInput {
  httpStatus?: number;
  body?: unknown;
  rawText?: string;
  thrown?: unknown;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Redaction — identical discipline to balance.ts's redact(): a literal
// substring removal of the caller's key, guarded against an empty key (which
// would otherwise `.split('').join(...)` and mangle every character).
// ---------------------------------------------------------------------------

function redact(text: string, apiKey: string | undefined): string {
  if (!apiKey) return text;
  return text.split(apiKey).join("<redacted>");
}

function stringifyBody(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

// ---------------------------------------------------------------------------
// Structural field extraction — duck-typed, no vendor-specific interfaces.
// Every real shape probed this round is one of:
//   { error: { type, message } }        deepseek / kimi
//   { error: { type: "401", message } } glm (non-standard: type is a string
//                                        status code, not an error category)
//   { code, message }                   dashscope (NO `error` wrapper at all)
//   { message, type }                   dashscope 403 (also no wrapper)
// so `type`/`message`/`code` are each checked at `body.error.<field>` first,
// then at `body.<field>` — covering all four shapes with one extractor.
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function extractType(body: unknown): string | undefined {
  const rec = asRecord(body);
  if (!rec) return undefined;
  const err = asRecord(rec.error);
  if (err && typeof err.type === "string") return err.type;
  if (typeof rec.type === "string") return rec.type;
  return undefined;
}

function extractCode(body: unknown): string | undefined {
  const rec = asRecord(body);
  if (!rec) return undefined;
  if (typeof rec.code === "string") return rec.code;
  return undefined;
}

function extractMessage(body: unknown): string | undefined {
  const rec = asRecord(body);
  if (!rec) return undefined;
  const err = asRecord(rec.error);
  if (err && typeof err.message === "string") return err.message;
  if (typeof rec.message === "string") return rec.message;
  return undefined;
}

// ---------------------------------------------------------------------------
// Keyword heuristics — used where no real fixture exists (balance/region) or
// as a cross-vendor safety net (model-missing message wording) that a status
// code alone can't disambiguate.
// ---------------------------------------------------------------------------

// GLM encodes the REAL reason as a bracketed business code inside `message`,
// independent of (and sometimes more reliable than) the HTTP status it ships
// with. Confirmed codes (卡 F probes): 1211 model missing, 1220 no
// permission, 1305 overloaded (that one arrives on HTTP 529, but the code is
// authoritative even if a future response ships it under a different status).
const GLM_BRACKET_RE = /\[(\d{3,4})\]/;
const GLM_BRACKET_KIND: Record<string, ProviderErrorKind> = {
  "1211": "model_missing",
  "1220": "permission",
  "1305": "overloaded",
};

// deepseek's model-missing body (real text, 卡 F probe): "The supported API
// model names are deepseek-v4-pro or deepseek-v4-flash, but you passed X."
// No vendor-specific error `type` was captured for this case, so message
// wording is the only signal — kept narrow (a real error message about a bad
// model name) to avoid false-positiving on unrelated text.
const MODEL_MISSING_TEXT_RE = /model names?.*(?:but you passed)|model_not_found|no such model/i;

// NOT backed by a real probe from any of the four vendors this round — every
// vendor tested had credit on the account, so no "insufficient balance" body
// was ever observed. Best-effort bilingual keyword match; replace with a real
// fixture the day a vendor actually returns one.
const BALANCE_TEXT_RE = /insufficient[_ ]?(balance|quota|credit)|余额不足|quota exceeded/i;

// Also NOT backed by a real probe — no vendor in this round geo-blocked the
// probing network. Best-effort keyword match.
const REGION_TEXT_RE = /not available in your (country|region)|geo.?blocked|blocked in your region|地区.*(不支持|限制)|不支持.*地区/i;

// AbortController/fetch timeout signatures. Node's fetch throws a DOMException
// named "AbortError" when the passed AbortSignal fires (including
// AbortSignal.timeout()'s own internal abort with reason "TimeoutError" in
// newer runtimes) — both names are treated as `timeout`, everything else
// thrown by fetch (DNS/TCP/TLS failures, ECONNREFUSED, etc.) as `network`.
function isTimeoutThrow(thrown: unknown): boolean {
  const name = thrown instanceof Error ? thrown.name : undefined;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /timeout|timed out/i.test(message);
}

// ---------------------------------------------------------------------------
// Human-facing (Chinese) message per kind. Deliberately STATIC text with no
// upstream-text interpolation — the surest way to guarantee `message` never
// carries a leaked apiKey is to never build it out of upstream data at all.
// The (redacted) upstream original lives in `detail` for "展开详情".
// ---------------------------------------------------------------------------

const KIND_MESSAGE: Record<ProviderErrorKind, string> = {
  auth: "API key 无效或已过期，请检查设置里填的 key 是否正确。",
  permission: "这个 key 没有权限访问该模型，请确认账号已开通对应模型的权限。",
  model_missing: "填的模型名称不存在，请检查拼写或换一个模型试试。",
  balance: "账户余额不足，请前往服务商充值后再试。",
  rate_limit: "请求太频繁，被服务商限流了，稍后再试。",
  overloaded: "服务商当前负载过高，暂时无法响应，稍后再试。",
  network: "连不上服务商，请检查网络连接（或代理设置）。",
  timeout: "请求超时了，服务商响应太慢，请稍后再试。",
  region: "这个服务商在当前网络环境下可能被地域限制，可能需要代理才能访问。",
  bad_request: "请求参数有问题（通常是程序的 bug，不是你的操作问题），可以反馈给开发者。",
  server: "服务商出错了（5xx），不是你这边的问题，请稍后再试。",
  unknown: "遇到一个没见过的错误，建议展开详情看看原始信息，或换个 provider 再试。",
};

function classifyFromStatus(httpStatus: number | undefined): ProviderErrorKind {
  if (httpStatus === undefined) return "unknown";
  if (httpStatus === 401) return "auth";
  if (httpStatus === 403) return "permission"; // canonical fallback; real per-vendor
  // ambiguity (dashscope=auth via body.type, glm=permission) is resolved by
  // the body-specific rules BEFORE this fallback runs.
  if (httpStatus === 404) return "model_missing";
  if (httpStatus === 402) return "balance";
  if (httpStatus === 429) return "rate_limit";
  if (httpStatus === 529) return "overloaded";
  if (httpStatus >= 500) return "server";
  if (httpStatus === 400) return "bad_request";
  return "unknown";
}

/**
 * Classify a provider failure into a `ProviderError` a person can act on.
 * Never throws. `message` is static Chinese (no upstream interpolation, so it
 * can never carry a leaked key); `detail` is the redacted upstream original.
 */
export function classifyProviderError(input: ClassifyProviderErrorInput): ProviderError {
  const { httpStatus, body, rawText, thrown, apiKey } = input;

  // Thrown path: no HTTP response ever arrived (DNS/TCP/TLS failure, or an
  // AbortSignal fired). Body/rawText are irrelevant here.
  if (thrown !== undefined) {
    const kind: ProviderErrorKind = isTimeoutThrow(thrown) ? "timeout" : "network";
    const rawMessage = thrown instanceof Error ? thrown.message : String(thrown);
    return {
      kind,
      message: KIND_MESSAGE[kind],
      detail: redact(rawMessage, apiKey),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
  }

  const type = extractType(body);
  const code = extractCode(body);
  const bodyMessage = extractMessage(body);
  const msgText = bodyMessage ?? rawText ?? "";

  let kind: ProviderErrorKind | undefined;

  const bracket = msgText.match(GLM_BRACKET_RE);
  if (bracket && GLM_BRACKET_KIND[bracket[1]]) {
    kind = GLM_BRACKET_KIND[bracket[1]];
  } else if (type === "resource_not_found_error") {
    kind = "model_missing"; // kimi: model missing/no permission, 404
  } else if (type === "authentication_error" || type === "invalid_authentication_error" || type === "401") {
    kind = "auth"; // deepseek/kimi (type), dashscope 403 (type=authentication_error), glm (type literal "401")
  } else if (code === "InvalidApiKey") {
    kind = "auth"; // dashscope 401, no `error` wrapper
  } else if (code === "InvalidParameter") {
    kind = "bad_request"; // dashscope malformed request / unsupported endpoint
  } else if (BALANCE_TEXT_RE.test(msgText)) {
    kind = "balance"; // heuristic — no real fixture this round
  } else if (REGION_TEXT_RE.test(msgText)) {
    kind = "region"; // heuristic — no real fixture this round
  } else if (MODEL_MISSING_TEXT_RE.test(msgText)) {
    kind = "model_missing"; // deepseek: message wording, no distinct `type`
  }

  if (!kind) kind = classifyFromStatus(httpStatus);

  const rawDetail = rawText ?? stringifyBody(body);
  const detail = rawDetail !== undefined ? redact(rawDetail, apiKey) : undefined;

  return {
    kind,
    message: KIND_MESSAGE[kind],
    ...(detail !== undefined ? { detail } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
}
