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
// sdk.d.ts (NOT inferred). Key facts:
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
import { LEEMO_MEMORY_TOOL_NAMES } from "./memory-mcp";
import { LEEMO_WEB_SEARCH_TOOL } from "./web-search-mcp";
import { LEEMO_ACADEMIC_SEARCH_TOOL } from "./academic-search-mcp";
import { LEEMO_DOCUMENT_TOOL_NAMES } from "./document-mcp";
import { LEEMO_SKILL_ADMIN_TOOL_NAMES } from "./skill-admin-mcp";
import { LEEMO_LEARNING_TOOL_NAMES } from "./learning-mcp";
import { LEEMO_SCHEDULED_TASK_TOOL_NAMES } from "./scheduled-task-mcp";
import { LEEMO_CAPTURE_TASK_TOOL_NAMES } from "./capture-task-mcp";
import { LEEMO_VISUALIZATION_TOOL_NAME } from "./visualization-spec";
import { LEEMO_WORK_OVERVIEW_TOOL } from "./work-overview";
import { LEEMO_RELATIONSHIP_HISTORY_TOOL } from "./relationship-history-tool";
import { resolvePathWithinBoundary } from "./filesystem-boundary";

// ===========================================================================
// Risk classification (danger seed list — 06 §2.9)
// ===========================================================================

/** Approval risk tier. `dangerous` is the only tier the permanent whitelist
 *  refuses (danger-never-permanent, 06 §2.9). */
export type RiskLevel = "safe" | "moderate" | "dangerous";

/** MCP server name for the ask_user tool. The SDK exposes an in-process MCP
 *  tool to the model as `mcp__<server>__<tool>`; both halves are declared here
 *  so the qualified name below cannot drift from createSdkMcpServer(). */
const ASK_USER_SERVER = "leemo-ask-user";
const ASK_USER_TOOL = "ask_user";

/** The qualified name the MODEL calls, and the renderer anchors question cards
 *  to. Exported so the timeline and the broker agree on one spelling. */
export const LEEMO_ASK_USER_TOOL = `mcp__${ASK_USER_SERVER}__${ASK_USER_TOOL}`;

/** Model-facing semantic boundary for the structured question card.
 * Keep this explicit: the runtime cannot reliably infer a missed card from
 * final prose after the turn has already completed. */
export const ASK_USER_TOOL_DESCRIPTION =
  "Ask the user a structured question when their answer determines the next action or conversation path " +
  "and the useful choices fit in 2-3 concise options. This includes guided interviews and onboarding, " +
  "not only ambiguous task scope. Apply this on every qualifying round, including later rounds after earlier cards; " +
  "if the choice changes subsequent execution or memory, do not switch back to prose. Give every option a short concrete explanation. The card also provides " +
  "an Other free-text field and blocks until the user answers. Do not use it for rhetorical questions, " +
  "open-ended reflection, ordinary conversational follow-ups after a conclusion, or questions where the " +
  "user's own unrestricted wording is the point.";

/** Runtime capability switches that carry user-facing setting semantics into
 * tool exposure and permission decisions. The host passes one mutable object
 * per conversation, so a setting changed for "next round" updates every
 * consumer without rebuilding the broker. */
export interface RuntimeCapabilityState {
  webSearchEnabled: boolean;
  webFetchEnabled: boolean;
  rememberMode: boolean;
  browserEnabled: boolean;
  computerEnabled: boolean;
}

export const DEFAULT_RUNTIME_CAPABILITY_STATE: Readonly<RuntimeCapabilityState> = {
  webSearchEnabled: false,
  webFetchEnabled: false,
  rememberMode: false,
  browserEnabled: false,
  computerEnabled: false,
};

/** Built-in capabilities whose effects stay inside the task the user already
 *  requested: reads, planning, delegation, progress bookkeeping, and enabled
 *  web access. Their child/external side effects are still permission-checked
 *  at the actual Write/PowerShell/MCP call. */
const ALWAYS_AVAILABLE_BUILTIN_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "NotebookRead",
  "TodoWrite",
  "Task",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "Skill",
  "Workflow",
  "ReportFindings",
  "SendMessage",
  "CronList",
  "EnterPlanMode",
  "ExitPlanMode",
];

/** Actions from Leemo's reserved Playwright server that are safe to perform
 * after the user has enabled browser automation. Routine click/type actions
 * belong here too: prompting for every step makes an enabled browser unusable
 * and contradicts the setting's product meaning. Arbitrary code, file upload,
 * storage/cookie mutation and raw network requests stay out and still ask. */
const PLAYWRIGHT_AUTO_ACTIONS: ReadonlySet<string> = new Set([
  "browser_annotate",
  "browser_click",
  "browser_close",
  "browser_console_messages",
  "browser_cookie_get",
  "browser_cookie_list",
  "browser_drag",
  "browser_drop",
  "browser_find",
  "browser_fill_form",
  "browser_generate_locator",
  "browser_get_config",
  "browser_handle_dialog",
  "browser_hide_highlight",
  "browser_highlight",
  "browser_hover",
  "browser_localstorage_get",
  "browser_localstorage_list",
  "browser_mouse_click_xy",
  "browser_mouse_down",
  "browser_mouse_drag_xy",
  "browser_mouse_move_xy",
  "browser_mouse_up",
  "browser_mouse_wheel",
  "browser_navigate",
  "browser_navigate_back",
  "browser_navigate_forward",
  "browser_network_requests",
  "browser_press_key",
  "browser_reload",
  "browser_resize",
  "browser_resume",
  "browser_sessionstorage_get",
  "browser_sessionstorage_list",
  "browser_select_option",
  "browser_snapshot",
  "browser_storage_state",
  "browser_tabs",
  "browser_take_screenshot",
  "browser_type",
  "browser_verify_element_visible",
  "browser_verify_list_visible",
  "browser_verify_text_visible",
  "browser_verify_value",
  "browser_wait_for",
]);

function playwrightAction(toolName: string): string | undefined {
  const prefix = "mcp__playwright__";
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : undefined;
}

function isTrustedPlaywrightAutoTool(toolName: string): boolean {
  const action = playwrightAction(toolName);
  return action !== undefined && PLAYWRIGHT_AUTO_ACTIONS.has(action);
}

const COMPUTER_TOOL_PREFIX = "mcp__computer__";
const COMPUTER_SUPPORTED_ACTIONS: ReadonlySet<string> = new Set([
  "ui_snapshot",
  "ui_wait",
  "app",
  "ui_read_table",
  "screenshot_control",
  "mouse_control",
  "ui_select",
  "keyboard_control",
  "ui_type",
  "ui_click",
  "ui_read",
  "ui_find",
  "window_management",
]);

const COMPUTER_BLOCKED_LAUNCHERS: ReadonlySet<string> = new Set([
  "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
  "wscript", "wscript.exe", "cscript", "cscript.exe", "mshta", "mshta.exe",
  "rundll32", "rundll32.exe", "regsvr32", "regsvr32.exe", "msiexec", "msiexec.exe",
]);
const COMPUTER_BLOCKED_SCRIPT_EXTENSIONS = /\.(?:bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|reg|msi)$/i;

function isSafeDesktopProgram(programPath: unknown): boolean {
  if (typeof programPath !== "string" || !programPath.trim()) return false;
  const normalized = programPath.trim().replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  return !COMPUTER_BLOCKED_LAUNCHERS.has(basename)
    && !COMPUTER_BLOCKED_SCRIPT_EXTENSIONS.test(basename);
}

function computerAction(toolName: string): string | undefined {
  return toolName.startsWith(COMPUTER_TOOL_PREFIX) ? toolName.slice(COMPUTER_TOOL_PREFIX.length) : undefined;
}

function isSupportedComputerTool(toolName: string, input: Record<string, unknown>): boolean {
  const action = computerAction(toolName);
  if (!action || !COMPUTER_SUPPORTED_ACTIONS.has(action)) return false;
  // Command shells and script hosts must keep the native Shell approval path;
  // launching them here would turn one desktop grant into arbitrary execution.
  if (action === "app") return isSafeDesktopProgram(input.programPath);
  if (action === "screenshot_control") {
    const target = typeof input.target === "string" ? input.target : "primary_screen";
    const operation = typeof input.action === "string" ? input.action : "capture";
    return operation === "capture" && ["primary_screen", "window", "region"].includes(target);
  }
  if (action === "mouse_control") {
    return ["move", "click", "scroll", "get_position"].includes(String(input.action ?? ""));
  }
  if (action === "keyboard_control") {
    return ["type", "press", "release_all", "get_keyboard_layout", "wait_for_idle"].includes(String(input.action ?? ""));
  }
  if (action === "window_management") {
    return [
      "list", "find", "activate", "get_foreground", "get_state", "wait_for_state",
      "minimize", "maximize", "restore", "close", "wait_for", "move_and_activate", "ensure_visible",
    ].includes(String(input.action ?? ""));
  }
  return true;
}

const FINAL_BROWSER_ACTION_ZH_RE = /(?:提交(?:申请|订单|报名|表单|简历)?|投递(?:申请|简历)?|确认(?:发布|发送|支付|付款|购买|下单|删除|保存|覆盖)|发布|发送(?:消息|邮件|评论)?|支付|付款|购买|下单|报名|保存(?:并|为|副本)?|另存|覆盖|替换|删除(?:账号|账户|数据|文件)?)/;
const FINAL_BROWSER_ACTION_EN_RE = /\b(?:submit(?:\s+(?:application|order|form))?|publish|post|send(?:\s+(?:message|email))?|pay|purchase|buy|place\s+order|save(?:\s+as)?|overwrite|replace|delete(?:\s+(?:account|data|file))?)\b/i;

/** Routine browser work should stay quiet after the browser switch is on, but
 * the execution layer must still enforce Leemo's promise to pause at a real
 * external commitment. Playwright supplies a human-readable `element` for
 * semantic clicks; explicit submit/Enter and coordinate clicks are treated as
 * commitments because they otherwise bypass that description entirely. */
function requiresBrowserFinalActionConfirmation(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const action = playwrightAction(toolName);
  if (!action) return false;
  if (action === "browser_mouse_click_xy") return true;
  if (action === "browser_handle_dialog" && input.accept === true) return true;
  if (action === "browser_type" && input.submit === true) return true;
  if (action === "browser_press_key") {
    const key = typeof input.key === "string" ? input.key : "";
    return key.trim().split(/[+\-\s]+/).some((part) => /^(?:enter|numpadenter)$/i.test(part));
  }
  if (action !== "browser_click") return false;
  const semanticTarget = [input.element, input.label]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const normalized = semanticTarget.trim();
  // `ref`, `target`, and selectors identify an element but do not explain its
  // effect. If Playwright omits the required human-readable description, fail
  // closed at the action boundary instead of silently treating an opaque e27
  // as routine navigation.
  return normalized.length === 0
    || normalized === "确认"
    || /^confirm$/i.test(normalized)
    || FINAL_BROWSER_ACTION_ZH_RE.test(normalized)
    || FINAL_BROWSER_ACTION_EN_RE.test(normalized);
}

function computerKeyModifiers(value: unknown): ReadonlySet<string> {
  if (typeof value !== "string") return new Set();
  return new Set(value.toLowerCase().split(",").map((item) => item.trim()).filter(Boolean));
}

function requiresComputerExactApproval(
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const action = computerAction(toolName);
  if (!action) return false;
  // Starting a program carries an arbitrary executable plus arguments. Bind
  // consent to that exact launch so a normal screen grant cannot become Shell.
  if (action === "app") return true;
  if (action === "mouse_control") return input.action === "click";
  if (action === "window_management") return input.action === "close";
  if (action === "keyboard_control" && input.action === "press") {
    const key = String(input.key ?? "").trim().toLowerCase();
    const modifiers = computerKeyModifiers(input.modifiers);
    if (["enter", "numpadenter", "delete", "space", "spacebar"].includes(key)) return true;
    if (modifiers.size === 0) return false;
    const navigationOnly = modifiers.size === 1 && (
      (modifiers.has("alt") && key === "tab")
      || (modifiers.has("ctrl") && ["f", "l"].includes(key))
    );
    return !navigationOnly;
  }
  const semanticTarget = action === "ui_select"
    ? String(input.value ?? "").trim()
    : [input.name, input.nameContains, input.namePattern]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim();
  if (action === "ui_select") {
    return FINAL_BROWSER_ACTION_ZH_RE.test(semanticTarget)
      || FINAL_BROWSER_ACTION_EN_RE.test(semanticTarget);
  }
  if (action !== "ui_click") return false;
  // Element ids identify a control but do not describe its impact. The prompt
  // asks for a human label; without one this boundary fails closed.
  return semanticTarget.length === 0
    || semanticTarget === "确认"
    || /^confirm$/i.test(semanticTarget)
    || FINAL_BROWSER_ACTION_ZH_RE.test(semanticTarget)
    || FINAL_BROWSER_ACTION_EN_RE.test(semanticTarget);
}

type CapabilityGate = keyof RuntimeCapabilityState | "always";

/** Trusted capability registry. Membership is issued by Leemo code, never by
 * a tool name pattern or third-party MCP metadata. This is the single place
 * where a built-in tool joins a user-facing capability group. */
const BUILTIN_TOOL_CAPABILITIES: ReadonlyMap<string, CapabilityGate> = new Map([
  ...ALWAYS_AVAILABLE_BUILTIN_TOOLS.map((toolName) => [toolName, "always"] as const),
  ["WebSearch", "webSearchEnabled"],
  [LEEMO_WEB_SEARCH_TOOL, "webSearchEnabled"],
  [LEEMO_ACADEMIC_SEARCH_TOOL, "webSearchEnabled"],
  [LEEMO_DOCUMENT_TOOL_NAMES.read, "always"],
  ["WebFetch", "webFetchEnabled"],
  [LEEMO_ASK_USER_TOOL, "always"],
  // Source inspection and static scanning are read-only and explicitly
  // initiated by the user. Install/remove remain mutating and still prompt.
  [LEEMO_SKILL_ADMIN_TOOL_NAMES.inspect, "always"],
  [LEEMO_SKILL_ADMIN_TOOL_NAMES.scan, "always"],
  [LEEMO_SKILL_ADMIN_TOOL_NAMES.listCatalog, "always"],
  [LEEMO_SKILL_ADMIN_TOOL_NAMES.scanInstalled, "always"],
  [LEEMO_SCHEDULED_TASK_TOOL_NAMES.list, "always"],
  [LEEMO_CAPTURE_TASK_TOOL_NAMES.listNotes, "always"],
  [LEEMO_CAPTURE_TASK_TOOL_NAMES.listTasks, "always"],
  [LEEMO_WORK_OVERVIEW_TOOL, "always"],
  [LEEMO_RELATIONSHIP_HISTORY_TOOL, "always"],
  ...Object.values(LEEMO_MEMORY_TOOL_NAMES).map((toolName) => [toolName, "rememberMode"] as const),
  ...Object.values(LEEMO_LEARNING_TOOL_NAMES).map((toolName) => [toolName, "always"] as const),
]);

function capabilityGateFor(toolName: string): CapabilityGate | undefined {
  return BUILTIN_TOOL_CAPABILITIES.get(toolName);
}

export function resolveBuiltinToolAccess(
  toolName: string,
  capabilities: RuntimeCapabilityState,
  input: Record<string, unknown> = {},
): "allow" | "deny" | undefined {
  // The reserved server prefix makes the browser toggle authoritative for
  // every present and future browser tool. New actions default to prompting
  // when enabled until reviewed; when disabled they can never leak through a
  // stale SDK callback or a broad bypass-permissions mode.
  if (playwrightAction(toolName) !== undefined) {
    if (!capabilities.browserEnabled) return "deny";
    if (requiresBrowserFinalActionConfirmation(toolName, input)) return undefined;
    return isTrustedPlaywrightAutoTool(toolName) ? "allow" : undefined;
  }
  if (computerAction(toolName) !== undefined) {
    if (!capabilities.computerEnabled) return "deny";
    if (!isSupportedComputerTool(toolName, input)) return "deny";
    // Routine desktop tools intentionally reach the broker so the first one
    // creates a visible task grant. Final actions use a separate exact key.
    return undefined;
  }
  const gate = capabilityGateFor(toolName);
  if (gate === undefined) return undefined;
  if (gate === "always") return "allow";
  return capabilities[gate] ? "allow" : "deny";
}

/**
 * Bash danger patterns — a SEED list, deliberately NOT exhaustive (06 §2.9
 * names rm -rf / disk format / registry writes as examples, not a closed set).
 * The guarantee this list backs is narrow and safe-by-omission: a match forces
 * `dangerous` (⇒ permanent tier refused). A miss only means the command still
 * goes through the normal ask-the-host flow at `moderate` — it is never
 * silently auto-allowed. Extend freely; Phase 1 may source this from config.
 */
const COMMAND_DANGER_PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*\b/i, // rm -rf / rm -fr / rm -r … (recursive/force delete)
  /\bremove-item\b/i, // PowerShell deletion (aliases are covered by rm above)
  /\brmdir\s+\/s\b/i, // Windows recursive dir delete
  /\bdel\s+\/[a-z]/i, // del /f /q … (force/quiet delete)
  /\bformat\b\s+[a-z]:/i, // format C:
  /\b(format-volume|clear-disk|initialize-disk)\b/i, // PowerShell disk mutation
  /\bmkfs(\.\w+)?\b/i, // mkfs / mkfs.ext4 … (make filesystem = wipe)
  /\bdd\b[^\n]*\bof=\/dev\//i, // dd … of=/dev/sdX (raw device write)
  /\bdiskpart\b/i, // Windows disk partitioner
  /\bfdisk\b/i, // partition table editor
  /\breg\s+(add|delete)\b/i, // registry write/delete
  /\bshutdown\b/i, // host power state
  /\b(stop-computer|restart-computer)\b/i, // PowerShell host power state
  /\bgit\s+(clean\b|reset\s+--hard\b|checkout\s+--\b|restore\b[^\n]*\s--source\b|branch\s+-D\b)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;/, // classic fork-bomb :(){ :|:& };:
];

/**
 * A deliberately narrow no-prompt lane for Leemo-owned maintenance.
 *
 * The model must provide one literal, absolute target and nothing else. We do
 * not expand variables or globs, and the path must name both Leemo and a
 * recognisable temp/cache/staging location. This keeps routine renderer/build
 * cleanup quiet without turning a generic shell delete into a hidden grant.
 */
function isRoutineLeemoCleanup(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName !== "Bash" && toolName !== "PowerShell") return false;
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command || command.length > 2_048 || /[\r\n;&|`$*?\[\]]/.test(command)) return false;

  let target: string | undefined;
  if (/^Remove-Item\b/i.test(command)) {
    const literal = /-LiteralPath\s+(["'])([^"']+)\1/i.exec(command);
    if (!literal) return false;
    target = literal[2];
    const remainder = command
      .replace(/^Remove-Item\b/i, "")
      .replace(literal[0], "")
      .replace(/-(?:Recurse|Force)\b/gi, "")
      .replace(/-ErrorAction\s+(?:SilentlyContinue|Stop)\b/gi, "")
      .trim();
    if (remainder) return false;
  } else {
    const remove = /^rm\s+-(?:rf|fr)\s+(["'])([^"']+)\1\s*$/i.exec(command);
    if (!remove) return false;
    target = remove[2];
  }

  const normalized = target.replace(/\\/g, "/").toLowerCase();
  if (!/^(?:[a-z]:\/|\/)/.test(normalized) || normalized.split("/").includes("..")) return false;
  if (!normalized.includes("leemo")) return false;
  const segments = normalized.split("/").filter(Boolean);
  return normalized.includes("/temp/")
    || normalized.startsWith("/tmp/")
    || segments.some((segment) => /^(?:\.?cache|\.?staging|\.?tmp[^/]*|node-compile-cache|clipboard-attachments|\.npm-cache[^/]*)$/i.test(segment));
}

/** Tools whose invocation mutates state or executes code (⇒ at least moderate). */
const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "PowerShell",
  "Write",
  "Edit",
  "NotebookEdit",
  "KillShell",
  LEEMO_DOCUMENT_TOOL_NAMES.createWord,
  LEEMO_DOCUMENT_TOOL_NAMES.editWord,
  LEEMO_DOCUMENT_TOOL_NAMES.createPresentation,
  LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet,
  LEEMO_VISUALIZATION_TOOL_NAME,
  LEEMO_SCHEDULED_TASK_TOOL_NAMES.create,
  LEEMO_SCHEDULED_TASK_TOOL_NAMES.update,
  LEEMO_SCHEDULED_TASK_TOOL_NAMES.setStatus,
  LEEMO_SCHEDULED_TASK_TOOL_NAMES.delete,
  LEEMO_SCHEDULED_TASK_TOOL_NAMES.runNow,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.createNote,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.updateNote,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.deleteNote,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.createTask,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.createTasks,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.updateTask,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.setTaskCompleted,
  LEEMO_CAPTURE_TASK_TOOL_NAMES.deleteTask,
]);

/**
 * 轮 7 A5 —— the tools `acceptEdits` auto-allows.
 *
 * These WRITE FILES and nothing else: no shell, no network, no process. That is
 * exactly the line the user drew on 7/28 —「写文件不问，跑命令才问」, which is
 * also Claude Code's own default mode and what 06 §2.9 meant by making
 * `acceptEdits` the baseline.
 *
 * Why a separate set instead of reusing MUTATING_TOOLS minus Bash: `KillShell`
 * mutates but is not an edit, and a future edit-like tool must be added here
 * DELIBERATELY. An allow-list that grows by subtraction eventually auto-allows
 * something nobody reviewed.
 *
 * Deliberately excluded, each for a reason a user would agree with:
 *   • Bash          — arbitrary code execution; the whole point of the gate
 *   • KillShell     — kills a process the user may be watching
 *   • third-party MCPs — code we did not write (classifyRisk's fail-cautious
 *                        default already covers it). Leemo's exact document
 *                        creator names are reviewed edit tools below.
 * Undoability is the test: an unwanted file edit is visible in the 本子 and
 * fixable; a shell command may not be either.
 */
const EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "NotebookEdit",
  LEEMO_DOCUMENT_TOOL_NAMES.createWord,
  LEEMO_DOCUMENT_TOOL_NAMES.editWord,
  LEEMO_DOCUMENT_TOOL_NAMES.createPresentation,
  LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet,
  LEEMO_VISUALIZATION_TOOL_NAME,
]);

/**
 * Classify an approval request's risk from the tool name + input. Pure and
 * synchronous. `dangerous` is reserved for Bash inputs matching the seed
 * pattern list; read-only tools are `safe`; everything else that mutates is
 * `moderate`. Unknown tools default to `moderate` (fail-cautious: prompt).
 */
export function classifyRisk(toolName: string, input: Record<string, unknown>): RiskLevel {
  if (toolName === "Bash" || toolName === "PowerShell") {
    if (isRoutineLeemoCleanup(toolName, input)) return "safe";
    const command = typeof input.command === "string" ? input.command : "";
    if (COMMAND_DANGER_PATTERNS.some((re) => re.test(command))) return "dangerous";
    return "moderate";
  }
  if (requiresBrowserFinalActionConfirmation(toolName, input)) return "moderate";
  if (requiresComputerExactApproval(toolName, input)) return "moderate";
  if (capabilityGateFor(toolName) !== undefined || isTrustedPlaywrightAutoTool(toolName)) return "safe";
  if (MUTATING_TOOLS.has(toolName)) return "moderate";
  // Unknown / third-party MCP tool: prompt (never auto-allow an unknown).
  return "moderate";
}

// ===========================================================================
// Permission policy (outward — re-exported by contract.ts)
//
// 07/21 B3 revision (设计负责人 overruled B3's hard-coded "dangerous never
// caches" invariant). Rationale: most users approve everything and reject
// nothing anyway — a per-call nag reads as "annoying", not "safe". So approval
// is POLICY-driven: safe by default, but the user can remember an exact
// dangerous shell command for the current task or opt fully out with
// bypassPermissions. Permanent Shell/dangerous grants stay forbidden: a
// concrete command card must never create a hidden cross-conversation blanket.
// ===========================================================================

/** Claude-Code-aligned permission modes. `plan` is enforced by the native SDK
 *  permission mode (sdk-adapter); the broker intentionally adds no second,
 *  divergent read-only policy and treats unexpected permission callbacks like
 *  default prompts.
 *
 *  `acceptEdits` is implemented as of 轮 7 A5: it auto-allows the edit tools
 *  (Write/Edit/NotebookEdit) and nothing else. See EDIT_TOOLS. */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

/** A broker's approval policy (per-conversation overridable via
 *  `CreateConversationRequest.permissionMode`).
 *  - `mode` — see PermissionMode.
 *  - `dangerousCommandCaching` — the settings-page "记住危险操作授权" toggle.
 *    `false` (default, safe): dangerous is strictly allow-once — never cached,
 *    never persisted (B3's behavior). `true` (user opted in): dangerous may
 *    cache inside the current task only; it is still never persisted. Shell
 *    caching is scoped to the exact command. */
export interface PermissionPolicy {
  mode: PermissionMode;
  dangerousCommandCaching: boolean;
  /** Test-harness defense in depth. When present, known filesystem tools are
   * denied before every normal permission shortcut if their path escapes this
   * root. Production launches omit it and keep the user-approved no-sandbox
   * workspace model. */
  filesystemBoundary?: string;
  /** Conversation cwd used to resolve relative paths inside the boundary. */
  filesystemCwd?: string;
}

/** The broker's default policy: 06 §2.9's baseline mode, plus B3's conservative
 *  dangerous tier (strictly allow-once, never cached).
 *
 *  轮 7 A5: `acceptEdits` is now real, so this default means「写文件不问，跑命令
 *  才问」out of the box — the behavior the user asked for on 7/28. */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  mode: "acceptEdits",
  dangerousCommandCaching: false,
};

// ===========================================================================
// Approval types (outward — re-exported by contract.ts)
// ===========================================================================

/** The three approval tiers the host offers (06 §2.9). `deny` is the refusal
 *  outcome; not a persisted tier. */
export type ApprovalTier = "allow-once" | "allow-conversation" | "allow-permanent" | "deny";

/** Runtime-owned meaning of an `allow-conversation` decision. The renderer
 * must display the same scope the broker will actually cache instead of
 * reverse-engineering it from a growing list of tool names. */
export type ApprovalTaskScope =
  | "tool-class"
  | "shell-command"
  | "exact-input"
  | "computer-control";

/** A request the broker sends the host for a decision. `conversationId` routes
 *  the card to its owning conversation; `inputSummary` is a short human-readable rendering of the tool input (truncated for display) so
 *  the user can identify what they are approving. It is NOT a redaction step —
 *  showing the actual command is intentional (the user must see it to judge);
 *  secret hygiene lives upstream (env sanitization, key-free IPC payloads). */
export interface ApprovalRequest {
  id: string;
  conversationId: string;
  toolName: string;
  inputSummary: string;
  risk: RiskLevel;
  /** Exact task-level scope enforced by the broker. Optional so a newer
   * renderer can still accept requests from an older host. */
  taskScope?: ApprovalTaskScope;
  /** The SDK's `toolUseID` for the call being approved. Lets the renderer
   *  anchor the approval card to the exact tool item in the timeline instead
   *  of parking it at the end of the turn (where it read as "置底还很丑" and,
   *  worse, was easy to miss until the permission stream timed out). Optional:
   *  it rides in from the SDK's canUseTool options, so a caller without one
   *  still gets a working — merely unanchored — card. */
  toolUseId?: string;
}

/** The host's answer to an ApprovalRequest. `id` echoes the request so
 *  concurrent waiters route correctly. `message` accompanies a `deny`. */
export interface ApprovalDecision {
  id: string;
  decision: ApprovalTier;
  message?: string;
}

/** A persisted permanent-whitelist entry. Keyed by (toolName, risk); Shell and
 *  dangerous entries are never written. */
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
  removeFromWhitelist(entry: WhitelistEntry): Promise<void> | void;
}

/** What createApprovalBroker returns: a `canUseTool` callback ready to hand the
 *  SDK, matching its real signature. */
export interface ApprovalBroker {
  canUseTool: CanUseTool;
  /** Start a new user-requested task. Any temporary continuous authorization
   * from the previous turn is discarded; permanent grants are unaffected. */
  beginTask(): void;
}

// ===========================================================================
// ApprovalBroker
// ===========================================================================

function isShellToolName(toolName: string): boolean {
  return /^(?:bash|shell|powershell|command)$/i.test(toolName);
}

function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith("mcp__");
}

/** Task approval covers one tool+risk class. Moderate shell commands share the
 * class so a multi-step local task does not prompt for every command. Dangerous
 * commands stay exact even when advanced caching is enabled. */
function cacheKey(toolName: string, risk: RiskLevel, input: Record<string, unknown>): string {
  const base = `${toolName} :: ${risk}`;
  if (computerAction(toolName) !== undefined && !requiresComputerExactApproval(toolName, input)) {
    return "mcp__computer__task";
  }
  // Third-party MCPs may multiplex external targets behind one tool name. A
  // task grant for publishing a draft must not authorize production, another
  // recipient, or a different payment amount.
  if (isMcpToolName(toolName)) {
    try {
      return `${base} :: ${JSON.stringify(input)}`;
    } catch {
      return `${base} :: ${String(input)}`;
    }
  }
  if (!isShellToolName(toolName) || risk !== "dangerous") return base;
  const command = typeof input.command === "string" ? input.command.trim() : JSON.stringify(input);
  return `${base} :: ${JSON.stringify(command)}`;
}

function approvalTaskScope(toolName: string, key: string): ApprovalTaskScope {
  if (key === "mcp__computer__task") return "computer-control";
  if (isShellToolName(toolName)) return "shell-command";
  if (isMcpToolName(toolName)) return "exact-input";
  return "tool-class";
}

/** Best-effort one-line summary of a tool input for the approval card
 *  (truncated for display, so the user can identify what they're approving —
 *  not a redaction step; the actual command is shown on purpose). Prefers a
 *  `command`/`file_path`/`pattern` field, else a truncated JSON. Never throws. */
function summarizeInput(_toolName: string, input: Record<string, unknown>): string {
  const pick = (k: string): string | undefined =>
    typeof input[k] === "string" ? (input[k] as string) : undefined;
  const head = pick("command")
    ?? pick("element")
    ?? pick("name")
    ?? pick("nameContains")
    ?? pick("title")
    ?? pick("filter")
    ?? pick("automationId")
    ?? pick("file_path")
    ?? pick("path")
    ?? pick("pattern");
  if (head !== undefined) {
    const trimmed = head.length > 200 ? head.slice(0, 197) + "…" : head;
    return trimmed;
  }
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    json = String(input);
  }
  if (json.length > 200) json = json.slice(0, 197) + "…";
  return json;
}

const allow = (): PermissionResult => ({ behavior: "allow" });

const FILESYSTEM_PATH_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  Read: new Set(["file_path", "path"]),
  Write: new Set(["file_path", "path"]),
  Edit: new Set(["file_path", "path"]),
  MultiEdit: new Set(["file_path", "path"]),
  NotebookRead: new Set(["notebook_path", "file_path", "path"]),
  NotebookEdit: new Set(["notebook_path", "file_path", "path"]),
  Glob: new Set(["path", "pattern"]),
  Grep: new Set(["path"]),
  [LEEMO_DOCUMENT_TOOL_NAMES.read]: new Set(["file_path", "path"]),
  [LEEMO_DOCUMENT_TOOL_NAMES.editWord]: new Set(["file_path", "output_path", "path"]),
  [LEEMO_DOCUMENT_TOOL_NAMES.createWord]: new Set(["file_path", "path"]),
  [LEEMO_DOCUMENT_TOOL_NAMES.createPresentation]: new Set(["file_path", "path"]),
  [LEEMO_DOCUMENT_TOOL_NAMES.createSpreadsheet]: new Set(["file_path", "path"]),
  [LEEMO_VISUALIZATION_TOOL_NAME]: new Set(["file_path", "path"]),
};

function collectToolPaths(value: unknown, fields: ReadonlySet<string>, output: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectToolPaths(item, fields, output);
    return;
  }
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (fields.has(key) && typeof candidate === "string" && candidate.trim()) output.push(candidate.trim());
    else if (candidate && typeof candidate === "object") collectToolPaths(candidate, fields, output);
  }
}

function filesystemBoundaryViolation(
  toolName: string,
  input: Record<string, unknown>,
  policy: PermissionPolicy,
): string | undefined {
  if (!policy.filesystemBoundary) return undefined;
  const fields = FILESYSTEM_PATH_FIELDS[toolName];
  if (!fields) return undefined;

  const cwd = policy.filesystemCwd ?? policy.filesystemBoundary;
  const candidates: string[] = [];
  collectToolPaths(input, fields, candidates);
  return candidates.find((candidate) =>
    resolvePathWithinBoundary(policy.filesystemBoundary as string, cwd, candidate) === undefined);
}

/**
 * Create an ApprovalBroker over one conversation id plus injected transport +
 * persistence.
 *
 * Each broker instance belongs to one conversation, while its temporary allow
 * cache belongs to the current user task. The host calls beginTask() before
 * every new user turn, so a grant never silently survives into the next task.
 * The permanent whitelist is shared (via persistence) and remains explicit.
 *
 * Flow per canUseTool call:
 *   1. classifyRisk(toolName, input).
 *   2. If a permanent whitelist entry (from persistence) matches → allow, no ask.
 *   3. Else if a current-task cache entry matches → allow, no ask.
 *   4. Else build an ApprovalRequest, ask the host via transport, await the
 *      decision:
 *        - deny               → PermissionResult deny (with message).
 *        - allow-once         → allow, cache nothing.
 *        - allow-conversation → allow, cache for the current task.
 *        - allow-permanent    → allow; persist only for non-Shell, non-dangerous
 *          tools. Shell and dangerous requests are downgraded to allow-once.
 *
 * Concurrency: every call carries its own request id and awaits its own
 * transport Promise — nothing is shared but the two caches, which are only
 * read/written with the resolved decision, so overlapping calls never cross.
 *
 * Policy (07/21 revision): the optional `policy` governs approval friction.
 *   • mode 'bypassPermissions' → short-circuit: allow EVERYTHING (incl.
 *     dangerous) with no ApprovalRequest and no transport call (zero card). The
 *     user explicitly chose this — self-responsible.
 *   • mode 'acceptEdits' (轮 7 A5, DEFAULT) → auto-allow the edit tools
 *     (Write/Edit/NotebookEdit); everything else, Bash included, still asks.
 *   • mode 'plan' → native SDK enforces read-only; any callback that still
 *     reaches this broker follows the explicit host approval flow.
 *   • trusted built-in read-only tools → follow the per-conversation capability
 *     registry. Enabled tools skip repeat consent; disabled tools are denied
 *     even if a stale SDK callback reaches this broker or bypass mode is active.
 *   • dangerousCommandCaching → gates task-only dangerous caching.
 *     false (default, safe): dangerous is strictly allow-once. true (user opted
 *     in): the exact Shell command may be reused in the current task. Shell
 *     and dangerous grants are never persisted.
 * The default policy preserves B3's conservative behavior exactly.
 */
export function createApprovalBroker(
  conversationId: string,
  transport: ApprovalTransport,
  persistence: ApprovalPersistence,
  policy: PermissionPolicy = DEFAULT_PERMISSION_POLICY,
  capabilities: RuntimeCapabilityState = DEFAULT_RUNTIME_CAPABILITY_STATE,
): ApprovalBroker {
  // Task-scoped auto-allow cache. The wire value remains allow-conversation for
  // backward compatibility; beginTask gives it the product semantics users see.
  const taskAllow = new Set<string>();

  const canUseTool: CanUseTool = async (toolName, input, options) => {
    const escapedPath = filesystemBoundaryViolation(toolName, input, policy);
    if (escapedPath !== undefined) {
      return { behavior: "deny", message: `E2E 安全边界：拒绝访问隔离工作区之外的路径 ${escapedPath}` };
    }

    if (computerAction(toolName) !== undefined
      && capabilities.computerEnabled
      && !isSupportedComputerTool(toolName, input)) {
      return { behavior: "deny", message: "这个电脑操作动作尚未开放，请换用查看、点击或输入等已支持方式。" };
    }

    // A user-facing capability switch is stronger than a permission shortcut.
    // Even bypassPermissions cannot resurrect a disabled search, fetch, memory,
    // or browser tool if a stale SDK callback somehow reaches the broker.
    const builtinAccess = resolveBuiltinToolAccess(toolName, capabilities, input);
    if (builtinAccess === "deny") {
      return { behavior: "deny", message: "这项能力已在 Leemo 设置中关闭。" };
    }
    if (builtinAccess === "allow") return allow();

    // Pure cleanup of a single Leemo-owned temporary target is maintenance,
    // not a user decision. Plan mode remains read-only and never uses this
    // shortcut even if a stale runtime asks for permission unexpectedly.
    if (policy.mode !== "plan" && isRoutineLeemoCleanup(toolName, input)) {
      return allow();
    }

    // (0) bypassPermissions short-circuit — zero card. The user opted fully out
    // of approvals: allow every tool, including dangerous ones, WITHOUT building
    // an ApprovalRequest or touching the transport. `plan` is enforced by the
    // SDK; `acceptEdits` has its deliberately narrow edit-only branch below.
    if (policy.mode === "bypassPermissions") {
      return allow();
    }

    // (0b) 轮 7 A5 —— `acceptEdits` now genuinely accepts edits.
    //
    // Until 轮 7 this mode fell through to the full ask-the-host flow, so the
    // BASELINE mode (06 §2.9) prompted on every single Write. Live-measured
    // consequence: a one-line file write sat behind an approval card for 90+
    // seconds while the stop button was gone — and the full-access escape hatch
    // was itself dead (permissionMode never left the renderer).
    //
    // Ordering matters: after bypassPermissions (which allows everything) and
    // before classifyRisk, because this is a mode-level decision, not a
    // risk-level one. Bash and unknown/MCP tools still go through the normal
    // flow — an edit is undoable and visible in the 本子; a shell command is
    // neither.
    if (policy.mode === "acceptEdits" && EDIT_TOOLS.has(toolName)) {
      return allow();
    }

    const risk = classifyRisk(toolName, input);
    const key = cacheKey(toolName, risk, input);
    // When the toggle is off (default), the dangerous tier may never cache and
    // is downgraded to allow-once. When on, it may cache in the current task;
    // permanent persistence remains forbidden below.
    const dangerLocked = risk === "dangerous" && !policy.dangerousCommandCaching;

    // Shell commands, MCP operations and high-risk actions never use a broad
    // permanent whitelist. Shell grants stay inside the current task; a
    // dangerous grant may be remembered only for that task when the user
    // explicitly enabled low-friction caching.
    const permanentForbidden = isShellToolName(toolName) || isMcpToolName(toolName) || risk === "dangerous";

    // (2) permanent whitelist — shared across conversations via persistence.
    const whitelist = await persistence.getWhitelist();
    if (!permanentForbidden && whitelist.some((e) => e.toolName === toolName && e.risk === risk)) {
      return allow();
    }

    // (3) current-task cache.
    if (taskAllow.has(key)) {
      return allow();
    }

    // (4) ask the host.
    const req: ApprovalRequest = {
      id: randomUUID(),
      conversationId,
      toolName,
      inputSummary: summarizeInput(toolName, input),
      risk,
      taskScope: approvalTaskScope(toolName, key),
      // Carry the SDK's tool-call id so the UI can render this card next to the
      // tool it belongs to (sdk.d.ts: toolUseID is unique per call within an
      // assistant message). Guarded: options is untrusted runtime data.
      ...(typeof options?.toolUseID === "string" ? { toolUseId: options.toolUseID } : {}),
    };
    const decision = await transport.request(req);

    switch (decision.decision) {
      case "deny":
        return {
          behavior: "deny",
          message: decision.message ?? `Denied: ${toolName}`,
        };

      case "allow-permanent": {
        // Treat the IPC decision as untrusted: even an old or compromised host
        // cannot turn one visible shell command or any dangerous operation into
        // a cross-conversation blanket grant.
        if (permanentForbidden || dangerLocked) {
          return allow();
        }
        await persistence.addToWhitelist({ toolName, risk });
        return allow();
      }

      case "allow-conversation":
        // By default the dangerous tier is allow-once only. The advanced toggle
        // permits task caching, while cacheKey keeps dangerous Shell grants
        // exact so `rm -rf /tmp/x` never authorizes `format C:`.
        if (!dangerLocked) {
          taskAllow.add(key);
          // An exact app launch is also a natural task boundary: after the user
          // approves opening that precise program/argument pair, routine work
          // inside it should not immediately ask for a second desktop grant.
          if (computerAction(toolName) === "app") taskAllow.add("mcp__computer__task");
        }
        return allow();

      case "allow-once":
        return allow();

      default:
        // Fail-closed. `decision.decision` is typed ApprovalTier, but it rides
        // in from the host over IPC (untrusted runtime data) — a malformed or
        // future-unknown value must DENY, never coerce to allow. This mirrors
        // the broker's "don't trust the host UI" posture (danger-downgrade).
        // PRESERVED verbatim through the 07/21 revision.
        return { behavior: "deny", message: "Denied: unknown approval decision" };
    }
  };

  return {
    canUseTool,
    beginTask: () => taskAllow.clear(),
  };
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

/** The payload the host receives (the input plus a correlation id and owning
 *  conversation route). */
export interface AskUserPayload extends AskUserInput {
  id: string;
  conversationId: string;
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
  /** Use the same card/waiter flow from a non-MCP local execution engine while
   * preserving the user's selected options as structured data. */
  requestAnswer(input: AskUserInput): Promise<AskUserAnswer>;
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
 * Create the ask_user MCP for one conversation id (08 §二; NewMax ~80-line
 * waiters-Map pattern).
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
  conversationId: string,
  transport: AskUserTransport,
  options: AskUserMcpOptions = {}
): AskUserMcp {
  type AskOutcome = { answer: AskUserAnswer } | { error: string };
  interface Waiter {
    resolve: (outcome: AskOutcome) => void;
    timer?: ReturnType<typeof setTimeout>;
  }
  const waiters = new Map<string, Waiter>();

  function settle(id: string, outcome: AskOutcome): boolean {
    const w = waiters.get(id);
    if (!w) return false;
    if (w.timer) clearTimeout(w.timer);
    waiters.delete(id);
    w.resolve(outcome);
    return true;
  }

  async function requestAnswer(input: AskUserInput): Promise<AskUserAnswer> {
    const id = randomUUID();
    const payload: AskUserPayload = { id, conversationId, questions: input.questions };

    const pending = new Promise<AskOutcome>((resolve) => {
      const w: Waiter = { resolve };
      if (options.timeoutMs !== undefined) {
        w.timer = setTimeout(() => {
          waiters.delete(id);
          resolve({ error: `ask_user timed out after ${options.timeoutMs}ms` });
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
      settle(id, { error: `ask_user transport error: ${msg}` });
    }

    const outcome = await pending;
    if ("error" in outcome) throw new Error(outcome.error);
    return outcome.answer;
  }

  async function handle(input: AskUserInput): Promise<AskUserToolResult> {
    try {
      return textResult(renderAnswer(await requestAnswer(input)));
    } catch (error: unknown) {
      return textResult(error instanceof Error ? error.message : String(error), true);
    }
  }

  function provideAnswer(id: string, answer: AskUserAnswer): boolean {
    return settle(id, { answer });
  }

  function failAsk(id: string, reason: string): boolean {
    return settle(id, { error: `ask_user cancelled: ${reason}` });
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
    ASK_USER_TOOL,
    ASK_USER_TOOL_DESCRIPTION,
    { questions: z.array(questionSchema) },
    async (args) => {
      const result = await handle({ questions: args.questions as AskUserQuestion[] });
      // Return the exact CallToolResult subset (content + isError).
      return result as unknown as Awaited<ReturnType<Parameters<typeof tool>[3]>>;
    }
  );

  const server = createSdkMcpServer({
    name: ASK_USER_SERVER,
    version: "1.0.0",
    tools: [askUserTool],
  });

  return { server, requestAnswer, handle, provideAnswer, failAsk };
}
