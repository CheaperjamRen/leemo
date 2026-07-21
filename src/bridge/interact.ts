// Leemo Bridge — interaction bridge (Task B3): approval broker + ask_user MCP.
//
// Two process-in interaction primitives, both fully transport-injected (zero
// live SDK / Electron / network):
//
//   ① ApprovalBroker — adapts the SDK `canUseTool` callback (06 §2.9) into a
//      three-tier approval flow brokered to the host: allow-once / allow-
//      conversation / allow-permanent, with danger commands NEVER eligible for
//      the permanent tier (06 §2.9 — "危险操作永不提供永久允许档").
//
//   ② createAskUserMcp — a process-in SDK MCP server exposing `ask_user`
//      (08 §二). When momo needs to disambiguate it emits a structured option
//      card and BLOCKS on the host's answer (NewMax ~80-line waiters-Map
//      pattern): a pending Promise parked in a Map keyed by request id, resolved
//      when the host replies, timing out / rejecting into an explanatory error
//      result rather than hanging the tool.
//
// SDK API face was verified against node_modules/@anthropic-ai/claude-agent-sdk/
// sdk.d.ts (NOT inferred) — see docs/sdd/br-b3-report.md for the quoted
// signatures. Key facts the brief guessed differently:
//   • CanUseTool options carries a REQUIRED `signal` (not `signal?`) plus
//     `toolUseID` + `requestId` (both required) and many optional UI hints; the
//     return type is `Promise<PermissionResult | null>` (null is reserved for
//     out-of-band control_response — this broker never returns null).
//   • PermissionResult's allow branch has NO `message`; the deny branch's
//     `message` is REQUIRED.

import {
  createSdkMcpServer,
  tool,
  type CanUseTool,
  type PermissionResult,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";

// ===========================================================================
// Risk classification (danger seed list — 06 §2.9)
// ===========================================================================

/** Approval risk tier. `dangerous` is the only tier the permanent whitelist
 *  refuses (danger-never-permanent, 06 §2.9). */
export type RiskLevel = "safe" | "moderate" | "dangerous";

/** Tools that only read — never eligible for an approval prompt in practice,
 *  but classified explicitly so the broker/host can auto-treat them as safe. */
const READONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "NotebookRead",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
]);

/**
 * Bash danger patterns — a SEED list, deliberately NOT exhaustive (06 §2.9
 * names rm -rf / disk format / registry writes as examples, not a closed set).
 * The guarantee this list backs is narrow and safe-by-omission: a match forces
 * `dangerous` (⇒ permanent tier refused). A miss only means the command still
 * goes through the normal ask-the-host flow at `moderate` — it is never
 * silently auto-allowed. Extend freely; Phase 1 may source this from config.
 */
const BASH_DANGER_PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*\b/i, // rm -rf / rm -fr / rm -r … (recursive/force delete)
  /\brmdir\s+\/s\b/i, // Windows recursive dir delete
  /\bdel\s+\/[a-z]/i, // del /f /q … (force/quiet delete)
  /\bformat\b\s+[a-z]:/i, // format C:
  /\bmkfs(\.\w+)?\b/i, // mkfs / mkfs.ext4 … (make filesystem = wipe)
  /\bdd\b[^\n]*\bof=\/dev\//i, // dd … of=/dev/sdX (raw device write)
  /\bdiskpart\b/i, // Windows disk partitioner
  /\bfdisk\b/i, // partition table editor
  /\breg\s+(add|delete)\b/i, // registry write/delete
  /\bshutdown\b/i, // host power state
  /:\(\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;/, // classic fork-bomb :(){ :|:& };:
];

/** Tools whose invocation mutates state or executes code (⇒ at least moderate). */
const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "Write",
  "Edit",
  "NotebookEdit",
  "KillShell",
]);

/**
 * Classify an approval request's risk from the tool name + input. Pure and
 * synchronous. `dangerous` is reserved for Bash inputs matching the seed
 * pattern list; read-only tools are `safe`; everything else that mutates is
 * `moderate`. Unknown tools default to `moderate` (fail-cautious: prompt).
 */
export function classifyRisk(toolName: string, input: Record<string, unknown>): RiskLevel {
  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (BASH_DANGER_PATTERNS.some((re) => re.test(command))) return "dangerous";
    return "moderate";
  }
  if (READONLY_TOOLS.has(toolName)) return "safe";
  if (MUTATING_TOOLS.has(toolName)) return "moderate";
  // Unknown / third-party MCP tool: prompt (never auto-allow an unknown).
  return "moderate";
}

// ===========================================================================
// Approval types (outward — re-exported by contract.ts)
// ===========================================================================

/** The three approval tiers the host offers (06 §2.9). `deny` is the refusal
 *  outcome; not a persisted tier. */
export type ApprovalTier = "allow-once" | "allow-conversation" | "allow-permanent" | "deny";

/** A request the broker sends the host for a decision. `inputSummary` is a
 *  short human-readable rendering (never the raw input — no secrets leak into
 *  the approval UI/log). */
export interface ApprovalRequest {
  id: string;
  toolName: string;
  inputSummary: string;
  risk: RiskLevel;
}

/** The host's answer to an ApprovalRequest. `id` echoes the request so
 *  concurrent waiters route correctly. `message` accompanies a `deny`. */
export interface ApprovalDecision {
  id: string;
  decision: ApprovalTier;
  message?: string;
}

/** A persisted permanent-whitelist entry. Keyed by (toolName, risk); a
 *  dangerous entry is never written (danger-never-permanent). */
export interface WhitelistEntry {
  toolName: string;
  risk: RiskLevel;
}

/** Host channel for approval prompts. In Phase 1 the Electron main process
 *  implements this over IPC (bridge:approvalRequest ↔ bridge:approvalDecision);
 *  tests inject a fake. */
export interface ApprovalTransport {
  request(req: ApprovalRequest): Promise<ApprovalDecision>;
}

/** Persistence hook for the permanent whitelist (externalized per user 7/21 —
 *  the broker does NOT self-persist). Phase 1 backs this with SQLite; tests use
 *  an in-memory array. Both sync and async implementations are accepted. */
export interface ApprovalPersistence {
  getWhitelist(): Promise<WhitelistEntry[]> | WhitelistEntry[];
  addToWhitelist(entry: WhitelistEntry): Promise<void> | void;
}

/** What createApprovalBroker returns: a `canUseTool` callback ready to hand the
 *  SDK, matching its real signature. */
export interface ApprovalBroker {
  canUseTool: CanUseTool;
}

// ===========================================================================
// ApprovalBroker
// ===========================================================================

/** Cache key: same tool + same risk tier are treated as equivalent for the
 *  conversation/permanent auto-allow (a per-input key would defeat the point —
 *  the user approved "this tool at this risk", not one exact argument). */
function cacheKey(toolName: string, risk: RiskLevel): string {
  return `${toolName} :: ${risk}`;
}

/** Best-effort, secret-safe one-line summary of a tool input for the approval
 *  card. Prefers a `command`/`file_path`/`pattern` field, else a truncated
 *  JSON. Never throws. */
function summarizeInput(toolName: string, input: Record<string, unknown>): string {
  const pick = (k: string): string | undefined =>
    typeof input[k] === "string" ? (input[k] as string) : undefined;
  const head = pick("command") ?? pick("file_path") ?? pick("path") ?? pick("pattern");
  if (head !== undefined) {
    const trimmed = head.length > 200 ? head.slice(0, 197) + "…" : head;
    return `${toolName}: ${trimmed}`;
  }
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    json = String(input);
  }
  if (json.length > 200) json = json.slice(0, 197) + "…";
  return `${toolName} ${json}`;
}

const allow = (): PermissionResult => ({ behavior: "allow" });

/**
 * Create an ApprovalBroker over an injected transport + persistence.
 *
 * Each broker instance is ONE conversation's approval context: its allow-
 * conversation cache lives for the broker's lifetime and never leaks to a
 * sibling conversation. The permanent whitelist is shared (via persistence) so
 * a permanent grant carries across conversations.
 *
 * Flow per canUseTool call:
 *   1. classifyRisk(toolName, input).
 *   2. If a permanent whitelist entry (from persistence) matches → allow, no ask.
 *   3. Else if a conversation-cache entry matches → allow, no ask.
 *   4. Else build an ApprovalRequest, ask the host via transport, await the
 *      decision:
 *        - deny               → PermissionResult deny (with message).
 *        - allow-once         → allow, cache nothing.
 *        - allow-conversation → allow, cache for this broker.
 *        - allow-permanent    → allow; persist UNLESS risk==='dangerous', in
 *          which case DOWNGRADE to allow-once (refuse to persist; do not cache).
 *
 * Concurrency: every call carries its own request id and awaits its own
 * transport Promise — nothing is shared but the two caches, which are only
 * read/written with the resolved decision, so overlapping calls never cross.
 */
export function createApprovalBroker(
  transport: ApprovalTransport,
  persistence: ApprovalPersistence
): ApprovalBroker {
  // Conversation-scoped auto-allow cache (in-memory, this broker only).
  const conversationAllow = new Set<string>();

  const canUseTool: CanUseTool = async (toolName, input, _options) => {
    const risk = classifyRisk(toolName, input);
    const key = cacheKey(toolName, risk);

    // (2) permanent whitelist — shared across conversations via persistence.
    const whitelist = await persistence.getWhitelist();
    if (whitelist.some((e) => e.toolName === toolName && e.risk === risk)) {
      return allow();
    }

    // (3) conversation-scoped cache.
    if (conversationAllow.has(key)) {
      return allow();
    }

    // (4) ask the host.
    const req: ApprovalRequest = {
      id: randomUUID(),
      toolName,
      inputSummary: summarizeInput(toolName, input),
      risk,
    };
    const decision = await transport.request(req);

    switch (decision.decision) {
      case "deny":
        return {
          behavior: "deny",
          message: decision.message ?? `Denied: ${toolName}`,
        };

      case "allow-permanent": {
        // Danger-never-permanent (06 §2.9): refuse to persist a dangerous tool
        // even when the host returns allow-permanent — downgrade to allow-once
        // (allow THIS time, cache nothing, so the next call asks again).
        if (risk === "dangerous") {
          return allow();
        }
        await persistence.addToWhitelist({ toolName, risk });
        return allow();
      }

      case "allow-conversation":
        conversationAllow.add(key);
        return allow();

      case "allow-once":
      default:
        return allow();
    }
  };

  return { canUseTool };
}

// ===========================================================================
// ask_user MCP (08 §二)
// ===========================================================================

/** One option in an ask_user question card. `description` is an optional
 *  secondary line; `label` is what the user picks. */
export interface AskUserOption {
  label: string;
  description?: string;
}

/** One question in an ask_user card. Mirrors the AskUserQuestion shape but
 *  trimmed: a header, the question text, options, and single/multi select. */
export interface AskUserQuestion {
  question: string;
  header?: string;
  options: AskUserOption[];
  multiSelect?: boolean;
}

/** The tool's raw arguments (what the model passes to ask_user). */
export interface AskUserInput {
  questions: AskUserQuestion[];
}

/** The payload the host receives (the input plus a correlation id). */
export interface AskUserPayload extends AskUserInput {
  id: string;
}

/** The host's answer. `items[i]` answers `questions[i]`: `selected` are chosen
 *  option labels; `other` is free-text from the "Other" field (用户偏好 — the
 *  user writes high-quality supplements there). */
export interface AskUserAnswerItem {
  selected: string[];
  other?: string;
}
export interface AskUserAnswer {
  id: string;
  items: AskUserAnswerItem[];
}

/** Host channel for ask_user cards. Phase 1: Electron main over IPC
 *  (bridge:askUser ↔ bridge:askUserAnswer). Tests inject a fake. */
export interface AskUserTransport {
  ask(payload: AskUserPayload): Promise<void>;
}

/** Minimal shape of the SDK MCP `CallToolResult` this tool returns. The real
 *  type comes from @modelcontextprotocol/sdk; we produce exactly this subset
 *  (a single text block, optional isError) which structurally satisfies it. */
export interface AskUserToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface AskUserMcpOptions {
  /** How long to block before giving up on the host (ms). Default: no timeout
   *  (permission-style prompts have no park deadline — the host is expected to
   *  answer or cancel). Tests set a small value. */
  timeoutMs?: number;
}

/** What createAskUserMcp returns. `server` plugs into the SDK
 *  (options.mcpServers); `handle`/`provideAnswer`/`failAsk` are the host-side
 *  round-trip surface (also what tests drive directly). */
export interface AskUserMcp {
  server: McpSdkServerConfigWithInstance;
  /** Run one ask_user round (also the tool handler's body). Blocks until the
   *  host answers, cancels, or the timeout fires. */
  handle(input: AskUserInput): Promise<AskUserToolResult>;
  /** Host delivers an answer for a pending ask; returns false if id unknown. */
  provideAnswer(id: string, answer: AskUserAnswer): boolean;
  /** Host cancels/rejects a pending ask (e.g. card dismissed); returns false if
   *  id unknown. Resolves the blocked tool with an explanatory error result. */
  failAsk(id: string, reason: string): boolean;
}

/** Render a host answer into the text the tool returns to the model. */
function renderAnswer(answer: AskUserAnswer): string {
  const parts = answer.items.map((item, i) => {
    const chosen = item.selected.join(", ");
    const other = item.other ? ` (other: ${item.other})` : "";
    return `Q${i + 1}: ${chosen}${other}`;
  });
  return parts.join("\n");
}

function textResult(text: string, isError = false): AskUserToolResult {
  const res: AskUserToolResult = { content: [{ type: "text", text }] };
  if (isError) res.isError = true;
  return res;
}

/**
 * Create the ask_user MCP (08 §二; NewMax ~80-line waiters-Map pattern).
 *
 * A `waiters` Map keyed by request id holds each blocked round's resolver +
 * timer. `handle()` registers a waiter, pushes the payload to the host via
 * `transport.ask`, and returns the pending Promise — which stays unresolved
 * until the host calls `provideAnswer(id, …)` (→ answer text) or `failAsk(id,
 * …)` (→ error result), or the optional timeout fires (→ error result). Every
 * settle path clears the timer and deletes the waiter, so nothing hangs and no
 * id lingers. Concurrent asks each own a distinct id → answers never cross.
 *
 * A transport.ask rejection settles the round immediately as an error result
 * (the model gets an explicable failure instead of a hung tool call).
 */
export function createAskUserMcp(
  transport: AskUserTransport,
  options: AskUserMcpOptions = {}
): AskUserMcp {
  interface Waiter {
    resolve: (r: AskUserToolResult) => void;
    timer?: ReturnType<typeof setTimeout>;
  }
  const waiters = new Map<string, Waiter>();

  function settle(id: string, result: AskUserToolResult): boolean {
    const w = waiters.get(id);
    if (!w) return false;
    if (w.timer) clearTimeout(w.timer);
    waiters.delete(id);
    w.resolve(result);
    return true;
  }

  async function handle(input: AskUserInput): Promise<AskUserToolResult> {
    const id = randomUUID();
    const payload: AskUserPayload = { id, questions: input.questions };

    const pending = new Promise<AskUserToolResult>((resolve) => {
      const w: Waiter = { resolve };
      if (options.timeoutMs !== undefined) {
        w.timer = setTimeout(() => {
          waiters.delete(id);
          resolve(textResult(`ask_user timed out after ${options.timeoutMs}ms`, true));
        }, options.timeoutMs);
        // Don't keep the process alive purely for this timer.
        w.timer.unref?.();
      }
      waiters.set(id, w);
    });

    try {
      await transport.ask(payload);
    } catch (e: unknown) {
      // Host channel failed to even accept the ask → settle now (don't hang).
      const msg = e instanceof Error ? e.message : String(e);
      settle(id, textResult(`ask_user transport error: ${msg}`, true));
    }

    return pending;
  }

  function provideAnswer(id: string, answer: AskUserAnswer): boolean {
    return settle(id, textResult(renderAnswer(answer)));
  }

  function failAsk(id: string, reason: string): boolean {
    return settle(id, textResult(`ask_user cancelled: ${reason}`, true));
  }

  // The SDK tool: schema mirrors AskUserQuestion (zod 4, the SDK's own zod
  // major — verified transitively resolvable). The handler simply delegates to
  // handle(), so the blocking round-trip and the tool call share one code path.
  const optionSchema = z.object({
    label: z.string(),
    description: z.string().optional(),
  });
  const questionSchema = z.object({
    question: z.string(),
    header: z.string().optional(),
    options: z.array(optionSchema),
    multiSelect: z.boolean().optional(),
  });
  const askUserTool = tool(
    "ask_user",
    "Ask the user a structured multiple-choice question when the request is " +
      "ambiguous. Renders as an in-conversation option card (single/multi select " +
      "+ an Other free-text field). Blocks until the user answers. Prefer this " +
      "over asking in prose when confirming scope or picking among options.",
    { questions: z.array(questionSchema) },
    async (args) => {
      const result = await handle({ questions: args.questions as AskUserQuestion[] });
      // Return the exact CallToolResult subset (content + isError).
      return result as unknown as Awaited<ReturnType<Parameters<typeof tool>[3]>>;
    }
  );

  const server = createSdkMcpServer({
    name: "leemo-ask-user",
    version: "1.0.0",
    tools: [askUserTool],
  });

  return { server, handle, provideAnswer, failAsk };
}
