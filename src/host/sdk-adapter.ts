import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage, McpServerConfig, Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn, QueryParams, QueryStream } from "../bridge/pool";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode } from "../bridge/interact";
import { createManagedClaudeProcessSpawner } from "./sdk-process";

export interface ConversationExtras {
  cwd: string;
  canUseTool: CanUseTool;
  /** Host-owned execution guards. Unlike `canUseTool`, PreToolUse hooks still
   * run when the SDK auto-approves edits, so workspace routing and governed
   * memory boundaries cannot be skipped by a permission mode. */
  hooks?: Options["hooks"];
  mcpServers: Record<string, McpServerConfig>;
  maxTurns?: number;
  /** SDK-native permission mode. Kept in the mutable extras object so a
   * settings change reaches an existing conversation on its next round. */
  permissionMode?: PermissionMode;
  /** momo's assembled persona prompt, APPENDED to the claude_code preset
   *  (06 §7.2). Deliberately not a bare string: per sdk.d.ts a string
   *  systemPrompt REPLACES the preset, which would strip CC's tool-use and
   *  workflow scaffolding — we want momo's persona on top of it, not instead
   *  of it. Omit to leave the preset untouched. */
  systemPromptAppend?: string;
  /** User-owned local plugin path. Kept as a compatibility alias for callers
   *  written before built-ins gained their own managed plugin. */
  pluginPath?: string;
  /** Ordered local plugin paths. The first is Leemo's managed built-in plugin,
   *  the second (when present) is the user's editable plugin. `[]` means no
   *  plugin at all and is intentionally distinct from an omitted field. */
  pluginPaths?: string[];
  /** QUALIFIED skill names ("leemo:pdf") to allow this conversation.
   *
   *  ⚠️ `[]` and `undefined` are DIFFERENT to the SDK (sdk.d.ts:1877): omitted
   *  means "no SDK auto-configuration, CLI defaults still apply" — explicitly
   *  NOT skills-off — while an empty array is a real, empty allow-list. So
   *  "user turned everything off" must reach the SDK as `[]`, and it must be
   *  possible to say nothing at all. Hence `?: string[]` with the empty array
   *  forwarded verbatim rather than treated as absent. */
  enabledSkills?: string[];
  /** Built-in tools to take off the table for this conversation (轮 4 卡 H).
   *  Used to retire the SDK's own `WebSearch`/`WebFetch` in favour of Leemo's
   *  in-process search MCP: the built-ins only work on Anthropic's own endpoint,
   *  and even there we want the failure/degradation and anti-hallucination
   *  wording to be ours. One search path on every provider beats two that
   *  behave differently. Omit to leave the SDK's defaults alone. */
  disallowedTools?: string[];
  /** Claude Code settings injected via the CLI's `--settings` flag tier
   *  (轮 4 卡 H2). Used to switch off WebFetch's domain preflight — see
   *  bridge-host for the full why. Omit to change nothing.
   *
   *  Why the flag tier and not `Options.managedSettings`: managedSettings is
   *  filtered through a restrictive-only allow-list (sdk.d.ts:2621 — "non-
   *  restrictive keys such as `model`, `env` … are silently dropped"), and
   *  `skipWebFetchPreflight` is not on it, so it would vanish without a word.
   *  `--settings` takes "a settings JSON file or a JSON string", sits at the
   *  `'flag'` tier (sdk.d.ts:2575), and is NOT filtered.
   *
   *  Verified rather than assumed: smoke/webfetch-preflight-probe.mjs arm ②
   *  passes it exactly this way, with `settingSources: []` still in force, and
   *  WebFetch stops phoning home. The two are independent tiers. */
  cliSettings?: Partial<Settings>;
  /** Native Auto Memory runs against a host-owned round directory. These are
   * mutable because the settings toggle and round directory apply next turn. */
  autoMemoryEnabled?: boolean;
  autoMemoryDirectory?: string;
  /** Leemo never opts users into background model spend. */
  autoDreamEnabled?: false;
  /** 原生 CLI 二进制的绝对路径（轮 5 打包）。**只有打包态才传。**
   *
   *  为什么必须显式传：SDK 自己是 `createRequire(sdk.mjs).resolve(平台包)` 找
   *  CLI 的，而打包后 sdk.mjs 在 app.asar 里，解出来是个 asar 内部路径 ——
   *  `existsSync` 对它为 **true**，`spawn` 却必然失败（进程加载器不认 asar）。
   *  见 src/main/cli-binary.ts。dev 态省略，让 SDK 自己解（那时它解得对）。 */
  cliExecutablePath?: string;
}

function wrapPrompt(prompt: string | AsyncIterable<unknown>): AsyncIterable<SDKUserMessage> {
  if (typeof prompt !== "string") return prompt as AsyncIterable<SDKUserMessage>;
  return (async function* () {
    yield {
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
      session_id: "",
    } as SDKUserMessage;
  })();
}

export function buildQueryFn(
  extras: ConversationExtras,
  queryImpl: typeof sdkQuery = sdkQuery
): QueryFn {
  const queryFn = ((params: QueryParams) => {
    const { prompt, options } = params;
    const permissionMode = extras.permissionMode ?? "default";
    // Leemo's broker owns the product-facing modes. Passing acceptEdits or
    // bypassPermissions to the native SDK makes it execute Write before either
    // canUseTool or PreToolUse is called (verified in the packaged r10 user
    // path), which skips default-workspace routing and governed-memory guards.
    // Keep only native plan mode: it adds a useful read-only boundary. All
    // other modes stay `default` here and are made frictionless by the broker.
    const sdkPermissionMode = permissionMode === "plan" ? "plan" : "default";
    const settings: Settings = {
      ...(extras.cliSettings ?? {}),
      ...(extras.autoMemoryEnabled !== undefined
        ? { autoMemoryEnabled: extras.autoMemoryEnabled }
        : {}),
      ...(extras.autoMemoryDirectory !== undefined
        ? { autoMemoryDirectory: extras.autoMemoryDirectory }
        : {}),
      ...(extras.autoDreamEnabled !== undefined
        ? { autoDreamEnabled: extras.autoDreamEnabled }
        : {}),
    };
    const pluginPaths = extras.pluginPaths ?? (
      extras.pluginPath === undefined ? undefined : [extras.pluginPath]
    );
    const disallowedTools = extras.disallowedTools !== undefined || options?.disallowedTools !== undefined
      ? [...new Set([...(extras.disallowedTools ?? []), ...(options?.disallowedTools ?? [])])]
      : undefined;
    return queryImpl({
      prompt: wrapPrompt(prompt),
      options: {
        env: options?.env,
        abortController: options?.abortController,
        // Windows only kills the direct CLI process by default, leaving an
        // active Bash/PowerShell grandchild behind. Bind this query's own abort
        // to its own process tree so Stop is real and conversation-isolated.
        spawnClaudeCodeProcess: createManagedClaudeProcessSpawner(options?.abortController?.signal),
        ...(options?.resume !== undefined ? { resume: options.resume } : {}),
        cwd: extras.cwd,
        permissionMode: sdkPermissionMode,
        includePartialMessages: true,
        // The SDK otherwise forwards only nested tool calls. Full forwarding
        // keeps each subagent's text/thinking attached to parent_tool_use_id so
        // Leemo can render an inspectable child transcript instead of a pulse.
        forwardSubagentText: true,
        settingSources: [],
        maxTurns: extras.maxTurns ?? 50,
        canUseTool: extras.canUseTool,
        ...(extras.hooks !== undefined ? { hooks: extras.hooks } : {}),
        // Snapshot per round. Settings can hot-add/remove internal or custom
        // MCPs for the NEXT turn; mutating a shared object must not rewrite the
        // options already handed to an in-flight query.
        mcpServers: { ...extras.mcpServers } as Record<string, McpServerConfig>,
        ...(pluginPaths !== undefined && pluginPaths.length > 0
          ? { plugins: pluginPaths.map((pluginPath) => ({ type: "local" as const, path: pluginPath })) }
          : {}),
        // Spread-on-defined, NOT `skills: extras.enabledSkills ?? []`: an empty
        // array is a meaningful value here (see ConversationExtras above), so
        // the key must be genuinely absent when we have nothing to say.
        ...(extras.enabledSkills !== undefined ? { skills: extras.enabledSkills } : {}),
        ...(disallowedTools !== undefined
          ? { disallowedTools }
          : {}),
        ...(options?.tools !== undefined
          ? { tools: [...options.tools] }
          : {}),
        // `Options.settings` is the SDK's flag-tier settings object. Keep app
        // settings and native memory in one object so neither silently replaces
        // the other; no environment-variable shim is involved.
        ...(Object.keys(settings).length > 0
          ? { settings }
          : {}),
        // 打包态才有值。spread-on-defined 而不是 `?? undefined`：这个键一旦存在，
        // SDK 就完全按它来、不再自己解析（sdk.mjs 里 `if(!pathToClaudeCode…)`），
        // 所以 dev 态必须让它**真的不存在**。
        ...(extras.cliExecutablePath !== undefined
          ? { pathToClaudeCodeExecutable: extras.cliExecutablePath }
          : {}),
        ...(extras.systemPromptAppend !== undefined
          ? {
              systemPrompt: {
                type: "preset" as const,
                preset: "claude_code" as const,
                append: extras.systemPromptAppend,
              },
            }
          : {}),
      },
    }) as QueryStream;
  }) as QueryFn;
  // Keep one CLI subprocess and one byte-stable system/tool prefix across
  // adjacent user turns. The pool owns the open input queue, turn boundaries,
  // idle recycling and resume fallback; the adapter only declares that this is
  // the real SDK path capable of that contract.
  queryFn.supportsPersistentInput = true;
  return queryFn;
}
