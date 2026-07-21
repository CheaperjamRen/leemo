// Leemo Bridge — SDK message stream → LeemoEvent normalization (Task B2).
//
// Consumes B1's `ConversationHandle.send()` output (AsyncIterable<SdkMessageLike>
// — SDK messages passed through UNTOUCHED by the pool) and maps it onto a
// discriminated union the frontend renders against (工具卡/活动卡/审批条 + 用量
// hover per 02 v2.0). Also builds UsageRecord (cost/estimated bookkeeping) and
// runs the anti-hallucination claimed-path audit (08 §三纪律③).
//
// SDK message shapes below are NOT invented: they are transcribed from
// docs/sdd/br-b2-brief.md's authoritative table, itself sourced from
// smoke/checks.mjs (Phase 0 real harness, ground truth) plus
// node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts and
// @anthropic-ai/sdk's beta/messages/messages.d.ts. The ONE unverified piece
// is stream_event's internal delta shape (risk ① below) — handled
// defensively so a wrong guess there can't take down the structural (tool/
// usage/compaction/run.finished) events, which ARE pinned by the table.

import fs from "node:fs";
import path from "node:path";
import type { SdkMessageLike } from "./pool";
import type { ModelPricing } from "./pricing";

// ---------------------------------------------------------------------------
// UsageRecord — field face must be able to fill 08 §四's double-log table
// (proxy_request_logs). See docs/sdd/br-b2-report.md for the field-by-field
// comparison against that NewMax-derived schema.
// ---------------------------------------------------------------------------

export interface UsageRecord {
  providerId: string;
  modelId: string;
  inputTokens: number; // usage.input_tokens
  outputTokens: number; // usage.output_tokens
  cacheReadTokens: number; // usage.cache_read_input_tokens
  cacheCreationTokens: number; // usage.cache_creation_input_tokens
  durationMs?: number; // result.duration_ms, when available
  costUsd?: string; // 6-decimal TEXT (NewMax precision discipline); undefined when unpriced
  costSource: "sdk" | "local-pricing" | "unpriced";
  tokensEstimated: boolean; // usage.leemo_estimated === true (B0's gateway backfill marker)
}

export interface PathClaim {
  path: string;
  exists: boolean;
  withinCwd: boolean;
}

export interface PathAudit {
  claimed: PathClaim[];
}

// ---------------------------------------------------------------------------
// LeemoEvent — discriminated union (`type` is the discriminant). Every
// variant the brief lists is present below.
// ---------------------------------------------------------------------------

export type LeemoEvent =
  | { type: "conversation.started"; sessionId: string }
  | { type: "text.delta"; text: string }
  | { type: "thinking.delta"; text: string }
  | { type: "text.final"; text: string }
  | { type: "tool.started"; toolUseId: string; name: string; input: unknown; subagent: boolean }
  | { type: "tool.finished"; toolUseId: string; isError: boolean; contentSummary: string }
  | { type: "subagent.activity"; parentToolUseId: string }
  | { type: "compact.boundary"; trigger: string; preTokens: number; postTokens?: number }
  | { type: "usage.final"; usage: UsageRecord }
  | { type: "run.finished"; subtype: string; isError: boolean; finalText: string; pathAudit: PathAudit }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// buildUsageRecord — cost/estimated bookkeeping (NewMax cost formula, 用户
// 7/21 拍板).
// ---------------------------------------------------------------------------

/** Raw usage fields as the SDK emits them (snake_case, per BetaUsage /
 *  result.usage). Optional/nullable because real streams sometimes omit
 *  fields or set them null (cache fields in particular). `leemo_estimated`
 *  is B0's non-standard gateway backfill marker (risk ②: unverified whether
 *  it survives SDK's aggregation into result.usage — read if present, else
 *  false, per the brief's explicit risk-handling instruction). */
export interface RawUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  leemo_estimated?: boolean;
  [key: string]: unknown;
}

export interface BuildUsageRecordCtx {
  providerId: string;
  modelId: string;
  /** result.total_cost_usd, when the caller has it (only meaningful when
   *  called from normalizeSdkStream's result-message handling). */
  totalCostUsd?: number;
  durationMs?: number;
  pricing?: ModelPricing;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Build a UsageRecord from a raw SDK usage object + context. Cost resolution
 * order (NewMax mode, 用户 7/21 拍板):
 *   1. ctx.totalCostUsd > 0  → costSource='sdk' (official Anthropic endpoint,
 *      SDK already knows the real price).
 *   2. ctx.pricing present   → costSource='local-pricing', computed as
 *      (input*inPrice + output*outPrice + cacheRead*cacheReadPrice) / 1e6,
 *      cache price defaulting to the input price when the table doesn't
 *      quote a separate cache-hit rate.
 *   3. neither                → costSource='unpriced', costUsd left undefined.
 * tokensEstimated reads `usage.leemo_estimated === true` (present→true, else
 * false) — never inferred any other way.
 */
export function buildUsageRecord(usage: RawUsageLike, ctx: BuildUsageRecordCtx): UsageRecord {
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);
  const cacheCreationTokens = num(usage.cache_creation_input_tokens);
  const tokensEstimated = usage.leemo_estimated === true;

  const base: UsageRecord = {
    providerId: ctx.providerId,
    modelId: ctx.modelId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    costSource: "unpriced",
    tokensEstimated,
  };
  if (ctx.durationMs !== undefined) base.durationMs = ctx.durationMs;

  if (ctx.totalCostUsd !== undefined && ctx.totalCostUsd > 0) {
    return { ...base, costUsd: ctx.totalCostUsd.toFixed(6), costSource: "sdk" };
  }

  if (ctx.pricing) {
    const cacheReadPrice = ctx.pricing.cacheReadPerMTok ?? ctx.pricing.inputPerMTok;
    const cost =
      (inputTokens * ctx.pricing.inputPerMTok +
        outputTokens * ctx.pricing.outputPerMTok +
        cacheReadTokens * cacheReadPrice) /
      1_000_000;
    return { ...base, costUsd: cost.toFixed(6), costSource: "local-pricing" };
  }

  return base;
}

// ---------------------------------------------------------------------------
// auditClaimedPaths — anti-hallucination path audit (08 §三纪律③; Phase 0
// hard finding: models fabricate absolute paths outside cwd, e.g. building a
// directory tree under E:\Users\... that was never actually created).
// ---------------------------------------------------------------------------

// Path-style token patterns: Windows absolute (`X:\...` or `X:/...`), Unix
// absolute (`/...`), and relative (`./...`, `../...`). Deliberately also
// matches tokens wrapped in backticks/quotes by first stripping common wrapper
// punctuation from each match. Kept intentionally simple (best-effort token
// extraction, not a full grammar) — false negatives here just mean a claimed
// path wasn't audited, not a wrong audit.
const PATH_TOKEN_RE = /[A-Za-z]:[\\/][^\s`'"),;]+|(?:\.{1,2}\/)[^\s`'"),;]+|\/[^\s`'"),;]+/g;

function stripWrappers(token: string): string {
  return token.replace(/[.,;:!?]+$/, "");
}

/**
 * Extract path-like tokens from `finalText`, then check each against
 * `existsSyncFn` and whether it resolves inside `cwd`. `withinCwd=false` is
 * the workspace-escape signal Phase 0 flagged (a model claiming to have
 * created files at an absolute path outside the project directory).
 */
export function auditClaimedPaths(
  finalText: string,
  cwd: string,
  existsSyncFn: (p: string) => boolean = fs.existsSync
): PathAudit {
  const seen = new Set<string>();
  const claimed: PathClaim[] = [];

  const matches = finalText.match(PATH_TOKEN_RE) ?? [];
  for (const raw of matches) {
    const token = stripWrappers(raw);
    if (!token || seen.has(token)) continue;
    seen.add(token);

    let exists = false;
    try {
      exists = existsSyncFn(token);
    } catch {
      exists = false;
    }

    const resolved = path.resolve(cwd, token);
    const resolvedCwd = path.resolve(cwd);
    const withinCwd = resolved === resolvedCwd || resolved.startsWith(resolvedCwd + path.sep);

    claimed.push({ path: token, exists, withinCwd });
  }

  return { claimed };
}

// ---------------------------------------------------------------------------
// normalizeSdkStream — the main entry point.
// ---------------------------------------------------------------------------

export interface NormalizeCtx {
  providerId: string;
  modelId: string;
  cwd: string;
  pricing?: ModelPricing;
  existsSyncFn?: (p: string) => boolean;
}

// Structural shapes read off incoming messages. Kept local/minimal (not
// importing the real SDK's d.ts types) since normalizeSdkStream must accept
// anything satisfying SdkMessageLike — including fixtures/fakes in tests and,
// in B4, the real SDK stream. Every field read here traces to the brief's
// shape table.
interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  text?: string;
}
interface IncomingMsg extends SdkMessageLike {
  subtype?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  message?: { role?: string; content?: unknown };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: RawUsageLike;
  compact_metadata?: { trigger?: string; pre_tokens?: number; post_tokens?: number };
  event?: {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string };
  };
}

function contentSummaryOf(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** Map one assistant/user message's content blocks to events. `parentToolUseId`
 *  is the message-level `parent_tool_use_id` (present ⇒ subagent activity,
 *  per the brief's "工具名注意": subagent detection uses this field's
 *  presence, NEVER a tool-name check — the subagent tool's real emitted name
 *  is "Agent" even though init's tool list says "Task", an SDK 0.3.210
 *  dual-naming quirk Phase 0 confirmed). */
function* eventsFromContentBlocks(
  content: unknown,
  parentToolUseId: string | null | undefined
): Generator<LeemoEvent> {
  const isSubagent = parentToolUseId != null && parentToolUseId !== "";
  if (isSubagent) {
    yield { type: "subagent.activity", parentToolUseId: parentToolUseId as string };
  }

  if (!Array.isArray(content)) return;
  for (const block of content as ContentBlock[]) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool_use") {
      yield {
        type: "tool.started",
        toolUseId: block.id ?? "",
        name: block.name ?? "",
        input: block.input,
        subagent: isSubagent,
      };
    } else if (block.type === "tool_result") {
      yield {
        type: "tool.finished",
        toolUseId: block.tool_use_id ?? "",
        isError: block.is_error === true,
        contentSummary: contentSummaryOf(block.content),
      };
    }
    // block.type === 'text' (top-level assistant text block, not the
    // streamed stream_event delta) is intentionally NOT re-emitted as
    // text.delta here — text.final (authoritative) comes from result.result,
    // and the streaming deltas already covered the live-typing UX. Emitting
    // it a third time would double the text in any naive concatenation.
  }
}

/** Defensive stream_event → text.delta/thinking.delta mapping (risk ①: this
 *  internal shape is SDK-documented but has no live佐证 in this card — a
 *  mismatch here must not throw or affect any structural event). Optional
 *  chaining throughout; anything that doesn't match the expected shape is
 *  silently skipped. */
function eventFromStreamEvent(msg: IncomingMsg): LeemoEvent | undefined {
  const delta = msg.event?.delta;
  if (delta?.type === "text_delta" && typeof delta.text === "string") {
    return { type: "text.delta", text: delta.text };
  }
  if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
    return { type: "thinking.delta", text: delta.thinking };
  }
  return undefined;
}

/**
 * Normalize a raw SDK message stream (B1's `ConversationHandle.send()` output
 * — passed through untouched) into `LeemoEvent`s the frontend renders
 * against. Structural events (tool/usage/compaction/run.finished) come from
 * assistant/user/result/system messages, whose shapes are pinned by the
 * brief's table. text.delta/thinking.delta are best-effort streaming sugar
 * from stream_event (risk ①, handled defensively — see eventFromStreamEvent).
 *
 * Never throws on a malformed individual message: unexpected shapes are
 * skipped (structural events) or silently dropped (streaming sugar), so one
 * odd frame can't derail the rest of the run. Errors thrown BY the underlying
 * iterable itself surface as a single `{type:'error'}` event (strict catch:
 * `e` is `unknown`, message extracted via
 * `e instanceof Error ? e.message : String(e)`).
 */
export async function* normalizeSdkStream(
  sdkMessages: AsyncIterable<SdkMessageLike>,
  ctx: NormalizeCtx
): AsyncIterable<LeemoEvent> {
  try {
    for await (const raw of sdkMessages) {
      const msg = raw as IncomingMsg;

      switch (msg.type) {
        case "system": {
          if (msg.subtype === "init") {
            yield { type: "conversation.started", sessionId: msg.session_id ?? "" };
          } else if (msg.subtype === "compact_boundary") {
            const meta = msg.compact_metadata;
            if (meta && typeof meta.pre_tokens === "number") {
              const ev: LeemoEvent = {
                type: "compact.boundary",
                trigger: meta.trigger ?? "unknown",
                preTokens: meta.pre_tokens,
              };
              if (typeof meta.post_tokens === "number") ev.postTokens = meta.post_tokens;
              yield ev;
            }
          }
          break;
        }

        case "stream_event": {
          const ev = eventFromStreamEvent(msg);
          if (ev) yield ev;
          break;
        }

        case "assistant":
        case "user": {
          yield* eventsFromContentBlocks(msg.message?.content, msg.parent_tool_use_id);
          break;
        }

        case "result": {
          const finalText = msg.result ?? "";
          const isError = msg.is_error === true;

          if (isError) {
            yield { type: "error", message: finalText || "run failed" };
          }

          if (msg.usage) {
            const usageRecord = buildUsageRecord(msg.usage, {
              providerId: ctx.providerId,
              modelId: ctx.modelId,
              totalCostUsd: msg.total_cost_usd,
              durationMs: msg.duration_ms,
              pricing: ctx.pricing,
            });
            yield { type: "usage.final", usage: usageRecord };
          }

          if (finalText) {
            yield { type: "text.final", text: finalText };
          }

          const pathAudit = auditClaimedPaths(finalText, ctx.cwd, ctx.existsSyncFn);
          yield {
            type: "run.finished",
            subtype: msg.subtype ?? "",
            isError,
            finalText,
            pathAudit,
          };
          break;
        }

        default:
          // Unknown message type (forward-compat: a future SDK message kind
          // we haven't wired yet) — skip rather than throw.
          break;
      }
    }
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
