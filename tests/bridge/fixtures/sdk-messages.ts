// Realistic SDK-message fixtures for Bridge B1 pool tests.
//
// Shapes are trimmed from Phase 0 real streams (smoke/results) and the SDK
// d.ts (SDKSystemMessage init / SDKAssistantMessage / SDKResultMessage). The
// pool only reads `type` + `session_id` off these; the rest is passthrough
// payload B2 will normalize. No API keys, no secrets.

import type { SdkMessageLike } from "../../../src/bridge/pool";

/** A test message: the minimal fields the pool reads, plus realistic payload. */
export interface TestMsg extends SdkMessageLike {
  subtype?: string;
  model?: string;
  message?: { role: string; content: unknown };
  result?: string;
  is_error?: boolean;
  parent_tool_use_id?: string | null;
}

/** A one-turn stream: init → assistant text → success result, all sharing one
 *  session_id (as the real SDK emits). */
export function oneTurnStream(sessionId: string, text: string): TestMsg[] {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
      model: "claude-sonnet-4-20250514",
    },
    {
      type: "assistant",
      session_id: sessionId,
      message: { role: "assistant", content: [{ type: "text", text }] },
    },
    {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      result: text,
      is_error: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// B2 fixtures — richer shapes for src/bridge/events.ts normalization tests.
//
// Shapes below are sourced from smoke/checks.mjs (the real harness) +
// node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts +
// @anthropic-ai/sdk's beta/messages/messages.d.ts. Nothing here is invented:
// every field name/nesting matches one of those two sources.
// ---------------------------------------------------------------------------

/** Extra fields beyond TestMsg that B2's richer fixture messages carry
 *  (tool_use/tool_result/subagent/compact_boundary/stream_event/usage). */
export interface TestMsgB2 extends TestMsg {
  parent_tool_use_id?: string | null;
  event?: unknown;
  compact_metadata?: { trigger: string; pre_tokens: number; post_tokens?: number };
  usage?: Record<string, unknown>;
  total_cost_usd?: number;
  duration_ms?: number;
}

/** A single full-stream fixture covering every SDK message shape B2's
 *  normalizeSdkStream must map: system:init → stream_event (text_delta +
 *  thinking_delta) → assistant(tool_use) → user(tool_result) →
 *  assistant(parent_tool_use_id = subagent activity) →
 *  user(parent_tool_use_id = subagent tool_result) →
 *  system:compact_boundary → result(success, usage, cost).
 *
 *  `finalText` is deliberately built to also exercise auditClaimedPaths: it
 *  claims one real path (must exist), one fabricated path inside cwd (must
 *  not exist), and one fabricated absolute path OUTSIDE cwd (Phase 0's
 *  "model invents E:\Users\... trees" finding). Callers pass the cwd whose
 *  existsSyncFn should resolve the first two.
 */
export function fullTurnStream(opts: {
  sessionId: string;
  toolUseId: string;
  subagentToolUseId: string;
  finalText: string;
}): TestMsgB2[] {
  const { sessionId, toolUseId, subagentToolUseId, finalText } = opts;
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
      model: "claude-sonnet-4-20250514",
    },
    // stream_event: text_delta (SDK partial-message shape per sdk.d.ts
    // SDKPartialAssistantMessage + BetaRawContentBlockDeltaEvent).
    {
      type: "stream_event",
      session_id: sessionId,
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Look" },
      },
    },
    {
      type: "stream_event",
      session_id: sessionId,
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "ing" },
      },
    },
    // stream_event: thinking_delta.
    {
      type: "stream_event",
      session_id: sessionId,
      parent_tool_use_id: null,
      event: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "thinking_delta", thinking: "considering the file" },
      },
    },
    // assistant turn: a tool_use block (top-level, not subagent).
    {
      type: "assistant",
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: "Read",
            input: { file_path: "leemo.config.json" },
          },
        ],
      },
    },
    // user turn: matching tool_result (top-level).
    {
      type: "user",
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: "{}",
            is_error: false,
          },
        ],
      },
    },
    // assistant turn WITH parent_tool_use_id → subagent activity, tool
    // real name is "Agent" per brief's "工具名注意" (SDK 0.3.210 dual-naming;
    // init's tool list says "Task" but the emitted tool_use name is "Agent").
    {
      type: "assistant",
      session_id: sessionId,
      parent_tool_use_id: subagentToolUseId,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_sub_inner_001",
            name: "Agent",
            input: { description: "sub-task" },
          },
        ],
      },
    },
    // user turn WITH parent_tool_use_id → subagent tool_result, and this one
    // is an error (exercises tool.finished isError=true).
    {
      type: "user",
      session_id: sessionId,
      parent_tool_use_id: subagentToolUseId,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_sub_inner_001",
            content: "boom",
            is_error: true,
          },
        ],
      },
    },
    // compaction boundary — numeric fields must pass through unchanged.
    {
      type: "system",
      subtype: "compact_boundary",
      session_id: sessionId,
      compact_metadata: { trigger: "auto", pre_tokens: 154000, post_tokens: 12000 },
    },
    // result: success, carries usage + duration + cost.
    {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      result: finalText,
      is_error: false,
      duration_ms: 4231,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 10,
      },
    },
  ];
}

/** Same shape as fullTurnStream's result, but total_cost_usd > 0 (real
 *  Anthropic-endpoint pricing known to the SDK) — costSource must be 'sdk'. */
export function resultWithSdkCost(sessionId: string, text: string): TestMsgB2 {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    result: text,
    is_error: false,
    duration_ms: 1000,
    total_cost_usd: 0.123456,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/** Same shape, but total_cost_usd is absent/0 AND usage carries B0's
 *  leemo_estimated:true backfill marker — tokensEstimated must read true. */
export function resultWithEstimatedUsage(sessionId: string, text: string): TestMsgB2 {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    result: text,
    is_error: false,
    duration_ms: 900,
    total_cost_usd: 0,
    usage: {
      input_tokens: 400,
      output_tokens: 80,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      leemo_estimated: true,
    },
  };
}

/** Result whose usage has no pricing-table entry AND no sdk cost AND no
 *  estimated marker — costSource must be 'unpriced', tokensEstimated false. */
export function resultUnpriced(sessionId: string, text: string): TestMsgB2 {
  return {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    result: text,
    is_error: false,
    duration_ms: 500,
    total_cost_usd: 0,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/** A result:error message — normalizeSdkStream must still emit run.finished
 *  (isError=true) and an 'error' event carrying result.result as message. */
export function resultError(sessionId: string, message: string): TestMsgB2 {
  return {
    type: "result",
    subtype: "error_during_execution",
    session_id: sessionId,
    result: message,
    is_error: true,
    duration_ms: 300,
    total_cost_usd: 0,
    usage: {
      input_tokens: 5,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
