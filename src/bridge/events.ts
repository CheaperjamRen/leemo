// Leemo Bridge — SDK message stream → LeemoEvent normalization (Task B2).
//
// Consumes B1's `ConversationHandle.send()` output (AsyncIterable<SdkMessageLike>
// — SDK messages passed through UNTOUCHED by the pool) and maps it onto a
// discriminated union the frontend renders against (工具卡/活动卡/审批条 + 用量
// hover per 02 v2.0). Also builds UsageRecord (cost/estimated bookkeeping) and
// runs the anti-hallucination claimed-path audit (08 §三纪律③).
//
// SDK message shapes below are NOT invented: they are sourced from
// smoke/checks.mjs (the real harness) plus
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
// UsageRecord keeps the fields required by the persisted request log and UI.
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
  /** Main-loop, per-turn prompt size. Unlike model totals, this is safe for
   * the context meter and intentionally excludes subagents/sidechains. */
  contextInputTokens?: number;
  contextCacheReadTokens?: number;
  contextCacheCreationTokens?: number;
  contextOutputTokens?: number;
  /** Provider/API time is kept separate from the interactive wall clock so a
   * question card waiting on the user does not look like model latency. */
  apiDurationMs?: number;
  ttftMs?: number;
  timeToRequestMs?: number;
  /** Per-model delta for this Leemo round. `modelUsage` is cumulative in a
   * streaming SDK session, so raw SDK totals never cross this boundary. */
  modelBreakdown?: UsageModelRecord[];
}

export interface UsageModelRecord {
  providerId: string;
  modelId: string;
  servingProvider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: string;
}

export type RunOutcome =
  | "completed"
  | "cancelled"
  | "permission-denied"
  | "rate-limited"
  | "overloaded"
  | "timeout"
  | "budget"
  | "max-turns"
  | "failed";

export interface PathClaim {
  path: string;
  exists: boolean;
  withinCwd: boolean;
  /** Present only when the surrounding prose asserted a completed write.
   * Legacy records omitted this and may contain reference-only false alarms. */
  writeClaim?: true;
}

export interface PathAudit {
  claimed: PathClaim[];
}

/** Renderer-safe memory identifiers. Paths and ledger internals never cross
 * this boundary; a notebook scope is addressed only by its validated id. */
export type MemoryScopeView =
  | { type: "global" }
  | { type: "notebook"; notebookId: string }
  | { type: "workspace"; workspaceId: string };

export type MemoryChangeAction =
  | "remembered"
  | "candidate"
  | "confirmed"
  | "updated"
  | "removed"
  | "pinned"
  | "unpinned"
  | "undone";

export interface BrowserCaptureRef {
  id: string;
  mimeType: "image/png" | "image/jpeg";
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
  | {
      type: "context.snapshot";
      currentTokens: number;
      maxTokens: number;
      rawMaxTokens: number;
      autoCompactThreshold?: number;
      isAutoCompactEnabled: boolean;
      providerId: string;
      model: string;
    }
  | { type: "context.live"; currentTokens: number; providerId: string; model: string }
  | {
      /** Passive progress from an upstream runtime retrying the same request.
       * Leemo never uses this event as permission to resend the user turn. */
      type: "stream.retry";
      attempt: number;
      maxAttempts: number;
      summary: string;
      detail: string;
      scope?: "connection" | "subagent";
      retryId?: string;
    }
  | { type: "tool.started"; toolUseId: string; name: string; input: unknown; subagent: boolean; parentToolUseId?: string }
  | {
      type: "tool.finished";
      toolUseId: string;
      isError: boolean;
      contentSummary: string;
      outcome?: "completed" | "failed" | "denied" | "cancelled" | "interrupted";
      userFeedback?: string;
      /** Opaque app-data filename for a browser screenshot. The image bytes
       * stay out of renderer persistence and are fetched only when expanded. */
      browserCapture?: BrowserCaptureRef;
      parentToolUseId?: string;
    }
  | { type: "subagent.activity"; parentToolUseId: string }
  | { type: "subagent.output"; parentToolUseId: string; kind: "text" | "thinking"; text: string }
  | { type: "compact.boundary"; trigger: string; preTokens: number; postTokens?: number; providerId?: string; model?: string }
  | { type: "usage.final"; usage: UsageRecord }
  | {
      type: "file.changed";
      /** Friendly path shown to the user, relative to the current book/project. */
      path: string;
      /** Workspace-root-relative operand used by preview/reveal; never rendered. */
      workspacePath?: string;
      change: "added" | "modified" | "deleted";
      /** Additional net changes intentionally left out of the expanded list. */
      omitted?: number;
    }
  | {
      type: "memory.changed";
      changeId: string;
      action: MemoryChangeAction;
      label: string;
      scope: MemoryScopeView;
      /** Present only for an undo event. It points at the receipt that should
       * change state instead of creating a second visible receipt. */
      targetChangeId?: string;
    }
  /** `sessionId` (轮 2 卡 C) is the SDK session this round ran under. The
   *  renderer persists it so a conversation re-claimed after a restart can be
   *  resumed. Optional: pre-existing producers/fixtures omit it, and a stream
   *  that never carried a session_id has none to report. */
  | {
      type: "run.finished";
      subtype: string;
      isError: boolean;
      finalText: string;
      pathAudit: PathAudit;
      sessionId?: string;
      /** Provider that owns sessionId. A session token is opaque and cannot be
       * resumed by a different provider after a model switch. */
      sessionProviderId?: string;
      outcome?: RunOutcome;
      retryable?: boolean;
      statusCode?: number;
    }
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

export interface RawModelUsageLike {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  costUSD?: number | null;
  canonicalModel?: string;
  provider?: string;
  [key: string]: unknown;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function optionalNonNegativeNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function completeInputSideUsage(value: unknown): value is RawUsageLike {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as RawUsageLike;
  const validCacheField = (key: "cache_read_input_tokens" | "cache_creation_input_tokens"): boolean => (
    hasOwn(usage, key)
    && (usage[key] === null || optionalNonNegativeNumber(usage[key]) !== undefined)
  );
  return hasOwn(usage, "input_tokens")
    && optionalNonNegativeNumber(usage.input_tokens) !== undefined
    && validCacheField("cache_read_input_tokens")
    && validCacheField("cache_creation_input_tokens");
}

function completeIterationUsage(value: unknown): value is RawUsageLike {
  return completeInputSideUsage(value)
    && hasOwn(value, "output_tokens")
    && optionalNonNegativeNumber(value.output_tokens) !== undefined;
}

/** BetaUsage 顶层可能是多次服务端循环的账单累计；当前窗口只读取最后一个
 * 完整 iteration。没有 iterations 的兼容帧必须至少完整提供输入侧三字段。 */
function currentWindowUsageFrom(usage: RawUsageLike): RawUsageLike | undefined {
  if (hasOwn(usage, "iterations") && usage.iterations !== undefined) {
    if (!Array.isArray(usage.iterations)) return undefined;
    for (let index = usage.iterations.length - 1; index >= 0; index -= 1) {
      const iteration = usage.iterations[index];
      if (completeIterationUsage(iteration)) return iteration;
    }
    return undefined;
  }
  return completeInputSideUsage(usage) ? usage : undefined;
}

function contextUsageFields(usage: RawUsageLike): Pick<UsageRecord,
  "contextInputTokens" | "contextCacheReadTokens" | "contextCacheCreationTokens" | "contextOutputTokens"> | Record<never, never> {
  if (!completeInputSideUsage(usage)) return {};
  return {
    contextInputTokens: num(usage.input_tokens),
    contextCacheReadTokens: num(usage.cache_read_input_tokens),
    contextCacheCreationTokens: num(usage.cache_creation_input_tokens),
    contextOutputTokens: num(usage.output_tokens),
  };
}

function contextTokensFromUsage(usage: RawUsageLike): number {
  return Math.max(0,
    num(usage.input_tokens)
      + num(usage.cache_read_input_tokens)
      + num(usage.cache_creation_input_tokens)
      + num(usage.output_tokens));
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

function buildModelUsageRecord(
  modelUsage: Record<string, RawModelUsageLike>,
  ctx: NormalizeCtx,
  durationMs?: number,
): UsageRecord {
  const modelBreakdown: UsageModelRecord[] = [];

  for (const [rawModelId, now] of Object.entries(modelUsage)) {
    const inputTokens = num(now.inputTokens);
    const outputTokens = num(now.outputTokens);
    const cacheReadTokens = num(now.cacheReadInputTokens);
    const cacheCreationTokens = num(now.cacheCreationInputTokens);
    const costUsd = num(now.costUSD);
    modelBreakdown.push({
      providerId: ctx.providerId,
      modelId: typeof now.canonicalModel === "string" && now.canonicalModel ? now.canonicalModel : rawModelId,
      ...(typeof now.provider === "string" && now.provider ? { servingProvider: now.provider } : {}),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd: costUsd.toFixed(6),
    });
  }

  const aggregate = modelBreakdown.reduce((sum, row) => ({
    inputTokens: sum.inputTokens + row.inputTokens,
    outputTokens: sum.outputTokens + row.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + row.cacheReadTokens,
    cacheCreationTokens: sum.cacheCreationTokens + row.cacheCreationTokens,
    costUsd: sum.costUsd + Number(row.costUsd),
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });

  return {
    providerId: ctx.providerId,
    modelId: ctx.modelId,
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    cacheReadTokens: aggregate.cacheReadTokens,
    cacheCreationTokens: aggregate.cacheCreationTokens,
    ...(durationMs !== undefined ? { durationMs } : {}),
    costUsd: aggregate.costUsd.toFixed(6),
    costSource: "sdk",
    tokensEstimated: false,
    modelBreakdown,
  };
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
/**
 * 轮 7 C6 —— URLs are not paths.
 *
 * Stripped BEFORE path matching because a URL contains two things that look
 * exactly like paths: `https:` matches the Windows drive-letter shape (`s:` +
 * `/`), and `//host/a/b` matches the POSIX absolute shape. Live-observed
 * symptom: momo cites two sources and the user sees
 *   `⚠ 声称写到工作区外：s://www.nobelprize.org/…、s://nerdsip.com/…`
 * i.e. the most alarming element on screen is a parse artefact. Scrubbing first
 * is simpler (and easier to reason about) than teaching one regex to know it is
 * inside a URL.
 */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Path-like tokens in momo's prose. Three shapes, each anchored so it cannot
 * start mid-token:
 *   1. `C:\x` / `C:/x`      — drive-letter absolute. Lookbehind rejects a
 *                             preceding letter/digit so `https:` cannot match.
 *   2. `./x` / `../x`       — explicitly relative, only at a token boundary.
 *   3. `/x/y`               — POSIX absolute, only at a token boundary.
 *
 * Shape 3's lookbehind is the other half of 轮 7 C6: without it, the `/` inside
 * a plain relative path (`诊断/写文件测试.md`) matched, yielding the fragment
 * `/写文件测试.md`, which resolves against the filesystem ROOT and was therefore
 * reported as an escape — so a perfectly correct write raised a warning. Bare
 * relative paths are otherwise not audited. Shape 2 covers an explicit token
 * beginning with `.` or `..`; path expressions with traversal buried inside a
 * longer relative token need a structured parser and stay unclassified rather
 * than raising another fragment-based false warning.
 *
 * It is written as "not preceded by a word-ish char" (letters, digits, CJK, `_`,
 * `.`, `-`) rather than "preceded by one of these openers": momo's prose wraps
 * paths in backticks, quotes, brackets, CJK punctuation and plain spaces, and an
 * opener allow-list silently stops auditing whenever it meets a new one — the
 * failure direction there is a MISSED escape, which is the expensive one.
 */
const PATH_TOKEN_RE =
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s`'"),;]+|(?<![A-Za-z0-9一-鿿_.\\/\-])(?:\.{1,2}[\\/])[^\s`'"),;]+|(?<![A-Za-z0-9一-鿿_.\-])[\\/][^\s`'"),;]+/g;

/** A path mention is not automatically a write claim. Plan mode often explains
 * an internal plan-file path while explicitly saying it did not create the
 * user's file; reference answers also say "see /path". Only completed write
 * language should trigger the escape warning rendered as "声称写到工作区外". */
const WRITE_CLAIM_RE =
  /(?:已|已经|成功|刚刚|现已)?(?:写入|写到|写进|创建|新建|保存|生成|输出|导出|落盘|放在)|(?:文件|结果|产物|路径)(?:现在|位于|是在|在)|\b(?:wrote|written|created|saved|generated|output|exported|located\s+at)\b/i;

/** Remove a nearby write verb when it is negated, hypothetical, planned, or an
 * instruction. Keeping this separate from WRITE_CLAIM_RE makes the positive
 * vocabulary auditable and prevents "不能创建 X" from matching "创建 X". */
const NON_CLAIMED_WRITE_RE =
  /(?:没有|并未|尚未|未曾|未能|不能|无法|不(?:会|能|允许)|禁止|只(?:能)?|请|需要|将(?:会)?|准备|计划|可以|应该|希望|尝试)[^，。！？；;\n]{0,24}(?:写入|写到|写进|创建|新建|保存|生成|输出|导出|落盘|编辑|修改)|\b(?:did\s+not|didn't|has\s+not|hasn't|cannot|can't|could\s+not|won't|unable\s+to|read[- ]only|plan(?:s|ned)?\s+to|need(?:s)?\s+to|will|should|please)\b[^,.!?;\n]{0,36}\b(?:write|wrote|create|save|generate|output|export|edit)\w*/gi;

function hasWriteClaimContext(text: string, matchIndex: number, matchLength: number): boolean {
  // Long enough for "已创建以下文件：" followed by a short path list, but short
  // enough that an unrelated earlier write does not bless every path in a long
  // answer. Sentence punctuation remains in the window and limits regex spans.
  const start = Math.max(0, matchIndex - 180);
  const end = Math.min(text.length, matchIndex + matchLength + 80);
  const context = text.slice(start, end).replace(NON_CLAIMED_WRITE_RE, " ");
  return WRITE_CLAIM_RE.test(context);
}

function stripWrappers(token: string): string {
  return token.replace(/[.,;:!?]+$/, "");
}

function isDisplayAbbreviation(token: string): boolean {
  return token.split(/[\\/]/).some((segment) => segment === "..." || segment === "…");
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

  // 轮 7 C6: scrub URLs first — see URL_RE. Replaced with a space (not "") so
  // removal cannot fuse two neighbouring tokens into one bogus path.
  const scrubbed = finalText.replace(URL_RE, " ");
  const matches = scrubbed.matchAll(PATH_TOKEN_RE);
  for (const match of matches) {
    const raw = match[0];
    if (!hasWriteClaimContext(scrubbed, match.index, raw.length)) continue;
    const token = stripWrappers(raw);
    if (!token || isDisplayAbbreviation(token) || seen.has(token)) continue;
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

    claimed.push({ path: token, exists, withinCwd, writeClaim: true });
  }

  return { claimed };
}

// ---------------------------------------------------------------------------
// normalizeSdkStream — the main entry point.
// ---------------------------------------------------------------------------

export interface NormalizeCtx {
  providerId: string;
  modelId: string;
  /** User/provider configured upstream context policy. The Harness control
   * response reports the applied compact window as rawMaxTokens on custom
   * models; the configured upstream ceiling remains a separate product fact. */
  contextPolicy?: {
    contextWindowTokens?: number;
    autoCompactWindowTokens?: number;
  };
  cwd: string;
  pricing?: ModelPricing;
  existsSyncFn?: (p: string) => boolean;
  /** Trusted Playwright output directory. Only screenshot paths contained by
   * this directory may become renderer-visible opaque capture ids. */
  browserOutputDir?: string;
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
  thinking?: string;
}
interface IncomingMsg extends SdkMessageLike {
  subtype?: string;
  contextUsage?: {
    totalTokens?: unknown;
    maxTokens?: unknown;
    rawMaxTokens?: unknown;
    autoCompactThreshold?: unknown;
    isAutoCompactEnabled?: unknown;
    model?: unknown;
  };
  model?: string;
  parent_tool_use_id?: string | null;
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  ttft_ms?: number;
  time_to_request_ms?: number;
  usage?: RawUsageLike;
  modelUsage?: Record<string, RawModelUsageLike>;
  permission_denials?: Array<{ tool_name?: string; tool_use_id?: string; tool_input?: Record<string, unknown> }>;
  errors?: string[];
  api_error_status?: number | null;
  terminal_reason?: string;
  aborted?: true;
  tool_name?: string;
  tool_use_id?: string;
  message?: { role?: string; content?: unknown; usage?: RawUsageLike } | string;
  decision_reason?: string;
  tool_result_meta?: unknown;
  subagent_retry?: {
    agent_id?: string;
    attempt?: number;
    max_retries?: number;
    retry_delay_ms?: number;
    error_status?: number | null;
    error_category?: string;
  };
  attempt?: number;
  max_retries?: number;
  retry_delay_ms?: number;
  error_status?: number | null;
  error?: string;
  compact_metadata?: { trigger?: string; pre_tokens?: number; post_tokens?: number };
  event?: {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string };
  };
}

const MAX_TOOL_SUMMARY_CHARS = 12_000;
const MAX_TOOL_SUMMARY_STRING_CHARS = 8_000;

function shortenSummaryString(value: string): string {
  if (/^data:[^;,]+;base64,/i.test(value)) {
    return `[data URI omitted: ${value.length} characters]`;
  }
  if (value.length <= MAX_TOOL_SUMMARY_STRING_CHARS) return value;
  const omitted = value.length - MAX_TOOL_SUMMARY_STRING_CHARS;
  return `${value.slice(0, MAX_TOOL_SUMMARY_STRING_CHARS)}… [tool output truncated: ${omitted} characters omitted]`;
}

function summarySafeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return shortenSummaryString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular value omitted]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => summarySafeValue(item, seen));

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (key === "data" && typeof item === "string" && (record.type === "base64" || item.length > 1_024)) {
      out[key] = `[${item.length} base64 characters omitted]`;
    } else {
      out[key] = summarySafeValue(item, seen);
    }
  }
  return out;
}

/** Tool cards and notebook archives need a compact diagnostic, not the raw
 * binary response. Browser screenshot tools can otherwise persist an entire
 * base64 PNG into every renderer store, SQLite row and portable conversation
 * archive. Keep useful text, redact binary payloads and put a hard ceiling on
 * unusually large results. The SDK/model still receives the original result. */
function contentSummaryOf(content: unknown): string {
  try {
    const safe = summarySafeValue(content, new WeakSet());
    const summary = typeof safe === "string" ? safe : JSON.stringify(safe);
    if (summary.length <= MAX_TOOL_SUMMARY_CHARS) return summary;
    const suffix = "… [tool output truncated]";
    return `${summary.slice(0, MAX_TOOL_SUMMARY_CHARS - suffix.length)}${suffix}`;
  } catch {
    return shortenSummaryString(String(content));
  }
}

function browserCaptureOf(
  content: unknown,
  browserOutputDir: string | undefined,
  cwd: string,
): BrowserCaptureRef | undefined {
  if (!browserOutputDir || !Array.isArray(content)) return undefined;
  let mimeType: "image/png" | "image/jpeg" | undefined;
  let text = "";
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") text += `${block.text}\n`;
    if (block.type !== "image") continue;
    const direct = block.mimeType;
    const source = block.source && typeof block.source === "object"
      ? block.source as Record<string, unknown>
      : undefined;
    const candidate = typeof direct === "string" ? direct : source?.media_type;
    if (candidate === "image/png" || candidate === "image/jpeg") mimeType = candidate;
  }
  const linked = /\[Screenshot[^\]]*\]\(([^)]+)\)/i.exec(text)?.[1];
  if (!linked) return undefined;
  const root = path.resolve(browserOutputDir);
  // Playwright resolves a caller-supplied relative `filename` from the MCP
  // process cwd, not from its transient output directory. Resolve the result
  // the same way, then keep the private capture channel limited to files that
  // are actually inside Leemo's controlled output root. Named workspace
  // screenshots remain ordinary artifacts and are reported by file tracking.
  const capturePath = path.resolve(cwd, linked);
  const relative = path.relative(root, capturePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  const id = path.basename(capturePath);
  if (id !== relative || !/^[A-Za-z0-9._-]+\.(?:png|jpe?g)$/i.test(id)) return undefined;
  mimeType ??= /\.jpe?g$/i.test(id) ? "image/jpeg" : "image/png";
  return { id, mimeType };
}

interface ToolResultMetaView {
  outcome?: "denied" | "cancelled" | "interrupted";
  userFeedback?: string;
}

function toolResultMetaOf(meta: unknown, toolUseId: string, index: number): ToolResultMetaView | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const root = meta as Record<string, unknown>;
  const candidate = Array.isArray(meta)
    ? meta.find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const fields = entry as Record<string, unknown>;
        return fields.id === toolUseId || fields.tool_use_id === toolUseId || fields.toolUseId === toolUseId;
      }) ?? meta[index]
    : root[toolUseId] ?? root[String(index)] ?? (
        root.tool_use_id === toolUseId || root.toolUseId === toolUseId ? root : undefined
      );
  if (!candidate || typeof candidate !== "object") return undefined;
  const fields = candidate as Record<string, unknown>;
  const rawKind = String(fields.non_execution_kind ?? fields.nonExecutionKind ?? "").toLowerCase();
  const outcome = /den(?:y|ied)|permission|reject/.test(rawKind)
    ? "denied" as const
    : /interrupt/.test(rawKind)
      ? "interrupted" as const
      : /cancel|abort/.test(rawKind)
        ? "cancelled" as const
        : undefined;
  const feedback = fields.user_feedback ?? fields.userFeedback;
  return {
    ...(outcome ? { outcome } : {}),
    ...(typeof feedback === "string" && feedback.trim() ? { userFeedback: feedback.trim() } : {}),
  };
}

/** Map one assistant/user message's content blocks to events. `parentToolUseId`
 *  is the message-level `parent_tool_use_id` (present ⇒ subagent activity,
 *  per the brief's "工具名注意": subagent detection uses this field's
 *  presence, NEVER a tool-name check — the subagent tool's real emitted name
 *  is "Agent" even though init's tool list says "Task", an SDK 0.3.210
 *  dual-naming quirk Phase 0 confirmed). */
function* eventsFromContentBlocks(
  content: unknown,
  parentToolUseId: string | null | undefined,
  cwd: string,
  browserOutputDir?: string,
  toolResultMeta?: unknown,
): Generator<LeemoEvent> {
  const isSubagent = parentToolUseId != null && parentToolUseId !== "";
  if (isSubagent) {
    yield { type: "subagent.activity", parentToolUseId: parentToolUseId as string };
  }

  if (!Array.isArray(content)) return;
  for (const [blockIndex, block] of (content as ContentBlock[]).entries()) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool_use") {
      const event: LeemoEvent = {
        type: "tool.started",
        toolUseId: block.id ?? "",
        name: block.name ?? "",
        input: block.input,
        subagent: isSubagent,
      };
      if (isSubagent) event.parentToolUseId = parentToolUseId as string;
      yield event;
    } else if (block.type === "tool_result") {
      const toolUseId = block.tool_use_id ?? "";
      const meta = toolResultMetaOf(toolResultMeta, toolUseId, blockIndex);
      const event: LeemoEvent = {
        type: "tool.finished",
        toolUseId,
        isError: block.is_error === true,
        contentSummary: contentSummaryOf(block.content),
        outcome: meta?.outcome ?? (block.is_error === true ? "failed" : "completed"),
      };
      if (meta?.userFeedback) event.userFeedback = meta.userFeedback;
      const browserCapture = browserCaptureOf(block.content, browserOutputDir, cwd);
      if (browserCapture) event.browserCapture = browserCapture;
      if (isSubagent) event.parentToolUseId = parentToolUseId as string;
      yield event;
    } else if (isSubagent && block.type === "thinking" && typeof block.thinking === "string") {
      yield { type: "subagent.output", parentToolUseId: parentToolUseId as string, kind: "thinking", text: block.thinking };
    } else if (isSubagent && block.type === "text" && typeof block.text === "string") {
      yield { type: "subagent.output", parentToolUseId: parentToolUseId as string, kind: "text", text: block.text };
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

/** Translate execution-layer failures at the last boundary before they reach
 * the renderer. Provider details remain actionable, but SDK/product internals
 * must never become momo's voice or leak into the user-facing timeline. */
export function toUserFacingRunError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "任务运行失败，请重试。";

  const unwrapped = raw
    .replace(/^Claude Code returned an error result:\s*/i, "")
    .trim();
  const statusMatch = unwrapped.match(/(?:API\s+Error:\s*)?(\d{3})(?:\b|\D)/i);
  const status = statusMatch?.[1];

  if (/LEEMO_UPSTREAM_PERMISSION/i.test(unwrapped) || status === "403") {
    return "当前账号没有所选模型的访问权限（403）。请在模型设置中换一个可用模型，或确认服务商已开通权限。";
  }
  if (/LEEMO_UPSTREAM_AUTH/i.test(unwrapped) || status === "401") {
    return "服务商未接受当前 API Key（401）。请在模型设置中检查或重新填写 Key。";
  }
  if (status === "404") {
    return "服务商找不到模型或接口（404）。请检查模型名称和接口地址后重试。";
  }
  if (status === "408" || /\b(?:ETIMEDOUT|timed?\s*out|timeout)\b/i.test(unwrapped)) {
    return "服务商响应超时。请检查网络后重试，或换一个模型。";
  }
  if (status === "429" || /\brate[ -]?limit/i.test(unwrapped)) {
    return "服务商请求过于频繁（429）。请稍后重试，或换一个模型。";
  }
  if (status === "529" || /\boverload(?:ed)?\b/i.test(unwrapped)) {
    return "服务商当前过载（529）。自动重试仍未恢复，请稍后重试或换一个模型。";
  }
  if (status) {
    return `服务商返回错误（${status}）。请检查模型配置、接口地址或额度后重试。`;
  }
  if (/No conversation found with session ID/i.test(unwrapped)) {
    return "上次会话上下文已失效，请重新发送；若仍失败，请新建对话。";
  }
  if (/Claude Code|Claude Agent SDK|CLAUDE_CODE_|ANTHROPIC_DEFAULT_/i.test(raw)) {
    return "任务运行失败，请重试；若持续失败，请检查模型配置。";
  }
  if (/^API\s+Error\b/i.test(unwrapped)) {
    return "服务商请求失败，请检查模型配置、接口地址或额度后重试。";
  }
  return Array.from(unwrapped).slice(0, 240).join("");
}

interface RunClassification {
  outcome: RunOutcome;
  retryable: boolean;
  statusCode?: number;
}

function classifyRun(result: IncomingMsg | undefined, streamError: string | undefined, aborted: boolean): RunClassification {
  const statusCode = typeof result?.api_error_status === "number"
    ? result.api_error_status
    : (() => {
        const haystack = `${streamError ?? ""} ${(result?.errors ?? []).join(" ")} ${result?.is_error ? result.result ?? "" : ""}`;
        const match = haystack.match(/(?:API\s+Error:\s*)?(\d{3})(?:\b|\D)/i);
        return match ? Number(match[1]) : undefined;
      })();
  if (aborted || result?.terminal_reason === "aborted_streaming" || result?.terminal_reason === "aborted_tools") {
    return { outcome: "cancelled", retryable: false, ...(statusCode !== undefined ? { statusCode } : {}) };
  }
  const isError = streamError !== undefined || result?.is_error === true;
  if (!isError) return { outcome: "completed", retryable: false, ...(statusCode !== undefined ? { statusCode } : {}) };
  if (statusCode === 429) return { outcome: "rate-limited", retryable: true, statusCode };
  if (statusCode === 529) return { outcome: "overloaded", retryable: true, statusCode };
  if (statusCode === 408 || /\b(?:ETIMEDOUT|timed?\s*out|timeout)\b/i.test(streamError ?? "")) {
    return { outcome: "timeout", retryable: true, ...(statusCode !== undefined ? { statusCode } : {}) };
  }
  if (result?.subtype === "error_max_budget_usd" || result?.terminal_reason === "budget_exhausted") {
    return { outcome: "budget", retryable: false, ...(statusCode !== undefined ? { statusCode } : {}) };
  }
  if (result?.subtype === "error_max_turns" || result?.terminal_reason === "max_turns") {
    return { outcome: "max-turns", retryable: false, ...(statusCode !== undefined ? { statusCode } : {}) };
  }
  if ((result?.permission_denials?.length ?? 0) > 0 && (result?.errors?.length ?? 0) === 0) {
    return { outcome: "permission-denied", retryable: false, ...(statusCode !== undefined ? { statusCode } : {}) };
  }
  const terminalClientError = statusCode !== undefined
    && statusCode >= 400
    && statusCode < 500
    && ![408, 425, 429].includes(statusCode);
  const apiRetryable = !terminalClientError
    && (result?.terminal_reason === "api_error" || result?.subtype === "error_during_execution");
  return { outcome: "failed", retryable: apiRetryable, ...(statusCode !== undefined ? { statusCode } : {}) };
}

function* terminalEvents(
  result: IncomingMsg | undefined,
  ctx: NormalizeCtx,
  sessionId: string | undefined,
  streamError?: string,
  aborted = false,
  reportedPermissionDenials: ReadonlySet<string> = new Set(),
  terminalContextUsage: ReturnType<typeof contextUsageFields> = {},
): Generator<LeemoEvent> {
  const classification = classifyRun(result, streamError, aborted);
  const cancelled = classification.outcome === "cancelled";
  const rawFinalText = cancelled ? "" : result?.result ?? "";
  const isError = classification.outcome !== "completed" && !cancelled;
  const structuredError = classification.statusCode !== undefined
    ? `API Error: ${classification.statusCode}`
    : result?.errors?.find((error) => typeof error === "string" && error.trim());
  const rawError = streamError ?? (isError ? (structuredError ?? (rawFinalText || "run failed")) : undefined);
  const errorMessage = rawError === undefined ? undefined : toUserFacingRunError(rawError);
  // An execution error is status, not momo-authored content. Rendering the raw
  // provider result as text.final creates a duplicate assistant bubble and
  // makes SDK/provider wording look like momo said it.
  const finalText = isError ? "" : rawFinalText;

  if (errorMessage) yield { type: "error", message: errorMessage };
  for (const denial of result?.permission_denials ?? []) {
    const toolUseId = denial.tool_use_id ?? "";
    if (!toolUseId || reportedPermissionDenials.has(toolUseId)) continue;
    yield {
      type: "tool.finished",
      toolUseId,
      isError: true,
      outcome: "denied",
      contentSummary: `未获允许：${denial.tool_name ?? "工具操作"}`,
    };
  }
  if (result?.usage) {
    const timing = {
      ...(optionalNonNegativeNumber(result.duration_api_ms) !== undefined
        ? { apiDurationMs: optionalNonNegativeNumber(result.duration_api_ms) }
        : {}),
      ...(optionalNonNegativeNumber(result.ttft_ms) !== undefined
        ? { ttftMs: optionalNonNegativeNumber(result.ttft_ms) }
        : {}),
      ...(optionalNonNegativeNumber(result.time_to_request_ms) !== undefined
        ? { timeToRequestMs: optionalNonNegativeNumber(result.time_to_request_ms) }
        : {}),
    };
    yield {
      type: "usage.final",
      usage: result.modelUsage && Object.keys(result.modelUsage).length > 0
        ? {
            ...buildModelUsageRecord(result.modelUsage, ctx, result.duration_ms),
            ...terminalContextUsage,
            ...timing,
          }
        : {
            ...buildUsageRecord(result.usage, {
              providerId: ctx.providerId,
              modelId: ctx.modelId,
              totalCostUsd: result.total_cost_usd,
              durationMs: result.duration_ms,
              pricing: ctx.pricing,
            }),
            ...terminalContextUsage,
            ...timing,
          },
    };
  }
  if (finalText) yield { type: "text.final", text: finalText };

  const finished: LeemoEvent = {
    type: "run.finished",
    subtype: cancelled ? "interrupted" : streamError !== undefined ? "error" : result?.subtype ?? "",
    isError,
    finalText,
    pathAudit: auditClaimedPaths(finalText, ctx.cwd, ctx.existsSyncFn),
    outcome: classification.outcome,
    retryable: classification.retryable,
  };
  if (classification.statusCode !== undefined) finished.statusCode = classification.statusCode;
  if (sessionId) finished.sessionId = sessionId;
  yield finished;
}

function positiveRetryCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function safeRetryDetail(value: unknown): string {
  return String(value ?? "unknown")
    .replace(/\bBearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[已隐藏凭据]");
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
  // Last session id seen on ANY message this round. The result message normally
  // carries it, but reading it off the whole stream keeps run.finished's
  // sessionId correct even if a provider omits it there (轮 2 卡 C).
  let sessionId: string | undefined;
  // Agent SDK may emit an intermediate result while a background subagent is
  // still attached to the SAME iterator. Only the final result at stream close
  // ends the user turn; emitting run.finished early lets the next prompt race
  // the still-running SDK session and misattributes the delayed child output.
  let pendingResult: IncomingMsg | undefined;
  let aborted = false;
  const reportedPermissionDenials = new Set<string>();
  // Billing totals on the terminal result can aggregate several model calls.
  // Track the latest main-loop frame separately so the persisted context meter
  // reflects one current prompt, and let a later exact snapshot remain final.
  let contextObservationOrder = 0;
  let latestMainContextOrder = -1;
  let latestExactContextOrder = -1;
  let latestMainContextUsage: RawUsageLike | undefined;
  const terminalContextUsage = (): ReturnType<typeof contextUsageFields> => (
    latestMainContextUsage && latestMainContextOrder > latestExactContextOrder
      ? contextUsageFields(latestMainContextUsage)
      : {}
  );
  try {
    for await (const raw of sdkMessages) {
      const msg = raw as IncomingMsg;
      if (typeof msg.session_id === "string" && msg.session_id) sessionId = msg.session_id;

      switch (msg.type) {
        case "leemo_context_snapshot": {
          const snapshot = msg.contextUsage;
          if (
            snapshot
            && typeof snapshot.totalTokens === "number"
            && Number.isFinite(snapshot.totalTokens)
            && typeof snapshot.maxTokens === "number"
            && Number.isFinite(snapshot.maxTokens)
            && typeof snapshot.rawMaxTokens === "number"
            && Number.isFinite(snapshot.rawMaxTokens)
          ) {
            const configuredMaximum = ctx.contextPolicy?.contextWindowTokens;
            const configuredCompact = ctx.contextPolicy?.autoCompactWindowTokens ?? configuredMaximum;
            const runtimeMatchesConfiguredCompact = configuredMaximum !== undefined
              && configuredCompact !== undefined
              && (snapshot.rawMaxTokens === configuredCompact || snapshot.maxTokens === configuredCompact);
            const event: Extract<LeemoEvent, { type: "context.snapshot" }> = {
              type: "context.snapshot",
              currentTokens: Math.max(0, snapshot.totalTokens),
              // Preserve the actual working window. When it exactly matches the
              // configured compact window, the control response proves that
              // policy was applied; expose the distinct configured model ceiling
              // for the tooltip. A 200K fallback still remains 200K.
              maxTokens: Math.max(0, snapshot.maxTokens),
              rawMaxTokens: Math.max(0, runtimeMatchesConfiguredCompact
                ? configuredMaximum
                : snapshot.rawMaxTokens),
              isAutoCompactEnabled: snapshot.isAutoCompactEnabled === true,
              providerId: ctx.providerId,
              // The SDK may expose its gateway disguise or a stale model from
              // the compatibility session. The host-selected identity is the
              // semantic source shared with Settings and the model picker.
              model: ctx.modelId,
            };
            if (typeof snapshot.autoCompactThreshold === "number" && Number.isFinite(snapshot.autoCompactThreshold)) {
              event.autoCompactThreshold = Math.max(0, snapshot.autoCompactThreshold);
            }
            latestExactContextOrder = ++contextObservationOrder;
            yield event;
          }
          break;
        }

        case "system": {
          if (msg.subtype === "init") {
            yield { type: "conversation.started", sessionId: msg.session_id ?? "" };
          } else if (msg.subtype === "api_retry") {
            const maxAttempts = Math.min(5, positiveRetryCount(msg.max_retries, 5));
            const attempt = Math.min(maxAttempts, positiveRetryCount(msg.attempt, 1));
            const status = typeof msg.error_status === "number" ? `HTTP ${msg.error_status}` : "连接错误";
            const delay = typeof msg.retry_delay_ms === "number" && Number.isFinite(msg.retry_delay_ms)
              ? `${Math.max(0, Math.round(msg.retry_delay_ms))}ms 后重试`
              : "稍后重试";
            yield {
              type: "stream.retry",
              attempt,
              maxAttempts,
              summary: `正在重新连接 ${attempt}/${maxAttempts}`,
              detail: `${safeRetryDetail(msg.error)} · ${status} · ${delay}`,
              scope: "connection",
            };
          } else if (msg.subtype === "permission_denied") {
            const toolUseId = msg.tool_use_id ?? "";
            if (toolUseId && !reportedPermissionDenials.has(toolUseId)) {
              reportedPermissionDenials.add(toolUseId);
              const rawMessage = typeof msg.message === "string" ? msg.message : msg.decision_reason;
              yield {
                type: "tool.finished",
                toolUseId,
                isError: true,
                outcome: "denied",
                contentSummary: typeof rawMessage === "string" && rawMessage.trim()
                  ? rawMessage.trim()
                  : `未获允许：${msg.tool_name ?? "工具操作"}`,
              };
            }
          } else if (msg.subtype === "compact_boundary") {
            const meta = msg.compact_metadata;
            if (meta && typeof meta.pre_tokens === "number") {
              const ev: LeemoEvent = {
                type: "compact.boundary",
                trigger: meta.trigger ?? "unknown",
                preTokens: meta.pre_tokens,
                providerId: ctx.providerId,
                model: ctx.modelId,
              };
              if (typeof meta.post_tokens === "number") ev.postTokens = meta.post_tokens;
              latestExactContextOrder = ++contextObservationOrder;
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
          if (msg.type === "assistant" && msg.aborted === true) aborted = true;
          if (
            msg.type === "assistant"
            && !msg.parent_tool_use_id
            && typeof msg.message === "object"
            && msg.message !== null
            && msg.message.usage
          ) {
            const currentWindowUsage = currentWindowUsageFrom(msg.message.usage);
            if (currentWindowUsage) {
              latestMainContextUsage = currentWindowUsage;
              latestMainContextOrder = ++contextObservationOrder;
              yield {
                type: "context.live",
                currentTokens: contextTokensFromUsage(currentWindowUsage),
                providerId: ctx.providerId,
                model: ctx.modelId,
              };
            }
          }
          const messageContent = typeof msg.message === "object" && msg.message !== null
            ? msg.message.content
            : undefined;
          yield* eventsFromContentBlocks(
            messageContent,
            msg.parent_tool_use_id,
            ctx.cwd,
            ctx.browserOutputDir,
            msg.tool_result_meta,
          );
          break;
        }

        case "tool_progress": {
          const retry = msg.subagent_retry;
          if (retry) {
            const maxAttempts = Math.min(5, positiveRetryCount(retry.max_retries, 5));
            const attempt = Math.min(maxAttempts, positiveRetryCount(retry.attempt, 1));
            const status = typeof retry.error_status === "number" ? `HTTP ${retry.error_status}` : "连接错误";
            const delay = typeof retry.retry_delay_ms === "number" && Number.isFinite(retry.retry_delay_ms)
              ? `${Math.max(0, Math.round(retry.retry_delay_ms))}ms 后重试`
              : "稍后重试";
            yield {
              type: "stream.retry",
              scope: "subagent",
              retryId: retry.agent_id ?? msg.tool_use_id ?? "subagent",
              attempt,
              maxAttempts,
              summary: `子任务正在重试 ${attempt}/${maxAttempts}`,
              detail: `${status} · ${safeRetryDetail(retry.error_category)} · ${delay}`,
            };
          }
          break;
        }

        case "result": {
          pendingResult = msg;
          break;
        }

        default:
          // Unknown message type (forward-compat: a future SDK message kind
          // we haven't wired yet) — skip rather than throw.
          break;
      }
    }
    if (pendingResult) {
      yield* terminalEvents(
        pendingResult,
        ctx,
        sessionId,
        undefined,
        aborted,
        reportedPermissionDenials,
        terminalContextUsage(),
      );
    }
  } catch (e) {
    yield* terminalEvents(
      pendingResult,
      ctx,
      sessionId,
      e instanceof Error ? e.message : String(e),
      aborted,
      reportedPermissionDenials,
      terminalContextUsage(),
    );
  }
}
