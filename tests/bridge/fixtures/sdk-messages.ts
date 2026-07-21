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
