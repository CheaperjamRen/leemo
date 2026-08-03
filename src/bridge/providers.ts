// Leemo Bridge — Provider directory type + pure conversation-env builder.
//
// A Provider is the data-driven upstream descriptor from 06 §3.1. Two wiring
// modes (06 §3.2) decide how a conversation's SDK child process is pointed at
// its model:
//
//   DIRECT  (apiFormat === "anthropic")
//     The SDK talks straight to the provider endpoint. ANTHROPIC_AUTH_TOKEN
//     carries the REAL key — this is the direct-wiring semantics the
//     constitution allows (zero translation, zero gateway hop).
//
//   GATEWAY (apiFormat !== "anthropic")
//     The SDK talks to the local loopback gateway; ANTHROPIC_AUTH_TOKEN is the
//     placeholder `leemo-gw:<providerId>`. The real key NEVER enters this env —
//     it lives only in the gateway process (see src/gateway/registry.ts). The
//     model name is disguised with a `claude-` prefix so the SDK surfaces it,
//     matching the gateway's /v1/models discovery contract (G3).
//
// buildConversationEnv is PURE: it maps (provider, modelId, gatewayPort?) to the
// env object and reads nothing from process.env / .env / disk. The pool is
// responsible for spreading process.env and setting CLAUDE_CONFIG_DIR.

import type { ProviderApiFormat } from "./contract";

/** Per-model capability flags (06 §3.1). */
export interface ModelCapabilities {
  thinking: boolean;
  vision: boolean;
}

/** Optional task-model choices expressed in product language. Missing values
 *  mean automatic behavior: fast work follows the Harness default and
 *  subtasks inherit the current conversation model natively. */
export interface TaskModelRouting {
  fastModelId?: string;
  subagentModelId?: string;
}

/** Internal Harness model slots. `ANTHROPIC_MODEL` is always the model chosen
 *  for this conversation. Product-level task routing is translated into the
 *  fast and subtask slots by the host catalog; the remaining ordinary slots
 *  follow the current model and are never exposed as user settings. */
export interface EnvTemplate {
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_FABLE_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  CLAUDE_CODE_SUBAGENT_MODEL?: string;
}

/** Upstream provider descriptor (06 §3.1 shape).
 *
 *  `apiKey` is the REAL secret. In direct wiring it rides ANTHROPIC_AUTH_TOKEN
 *  into the SDK child; in gateway wiring it is NEVER emitted here (the gateway
 *  holds it). Tests use obviously-fake `sk-test-…` sentinels. */
export interface Provider {
  id: string;
  name: string;
  category: "cn_official" | "official" | "custom";
  apiFormat: ProviderApiFormat;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelCapabilities: Record<string, ModelCapabilities>;
  envTemplate: EnvTemplate;
}

/** The env map handed to the SDK (`options.env`). Values are string | undefined
 *  to match the SDK's own `env?: {[k]: string | undefined}` field. */
export type ConversationEnv = Record<string, string | undefined>;

/** Ordinary aliases may safely default to the current model. The subtask slot
 *  is deliberately handled separately: omitting it restores native model
 *  inheritance, while assigning the current model would freeze a hidden
 *  override into every later turn. */
const SLOT_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

/** Suffix/name patterns for secret-shaped host env vars we refuse to spread into
 *  the SDK child. Strip-not-allowlist: Windows children depend on too many
 *  system vars to enumerate an allowlist safely, so we drop the sensitive ones
 *  and keep the rest. Case-insensitive. */
const SECRET_ENV_PATTERNS: RegExp[] = [
  /_API_KEY$/i,
  /_AUTH_TOKEN$/i,
  /_SECRET(_|$)/i,
  /_ACCESS_KEY/i,
  /^ANTHROPIC_API_KEY$/i,
];

const HARNESS_MODEL_ENV_NAMES = new Set([
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
]);

/** True if an env var name looks like it carries a secret. */
function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_PATTERNS.some((re) => re.test(name));
}

/**
 * Drop secret-shaped variables and stale Harness model controls from a host env
 * snapshot.
 *
 * The SDK REPLACES the child's environment (see buildConversationEnv callers),
 * so the pool must spread `process.env` for PATH/HOME/etc. But in production
 * `process.env` carries the gateway's real upstream keys (RELAY2_API_KEY …) and
 * potentially sibling-provider secrets — a child that can run bash could
 * `printenv` them. Old model controls are equally important to remove: an
 * ambient subtask override would otherwise defeat the product's "automatic
 * inheritance" choice. The conversation's own token and routing are layered
 * on afterward by buildConversationEnv.
 *
 * Pure: never mutates the input; returns a fresh object.
 */
export function sanitizeHostEnv(
  hostEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (isSecretEnvName(name) || HARNESS_MODEL_ENV_NAMES.has(name.toUpperCase())) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Build the SDK `options.env` for one conversation round.
 *
 * @param provider   upstream descriptor
 * @param modelId    the model chosen for THIS conversation (not necessarily
 *                   provider.models[0]); becomes the current and ordinary task
 *                   default, while subtasks inherit unless explicitly pinned
 * @param gatewayPort loopback port of the running gateway — REQUIRED for
 *                   apiFormat==="openai", ignored for "anthropic"
 *
 * Never mutates its inputs; returns a fresh object each call.
 */
export function buildConversationEnv(
  provider: Provider,
  modelId: string,
  gatewayPort?: number,
  searchShimPort?: number
): ConversationEnv {
  const gateway = provider.apiFormat !== "anthropic";
  // SHIM wiring (轮 4 卡 H2) — anthropic 家 + 本地搜索 shim 在跑。
  // 它不翻译协议，只是一根认得出「CC 内置 WebSearch 的嵌套服务端工具请求」的
  // 哑管道：那一种请求由 Leemo 自己的搜索链答掉，其余原样透传。于是内置
  // WebSearch 在每一家 provider 上行为一致，且全程不回连 claude.ai。
  // 详见 src/host/search-shim.ts 顶部注释。
  const shim = !gateway && searchShimPort !== undefined;

  // Direct/shim sends raw model ids. Gateway disguises each raw id with a
  // claude- prefix, then restores it before the OpenAI upstream call.
  const slotDefault = gateway ? `claude-${modelId}` : modelId;

  let baseUrl: string;
  let authToken: string;

  if (gateway) {
    if (gatewayPort === undefined) {
      throw new Error(
        `buildConversationEnv: gateway port is required for openai provider "${provider.id}"`
      );
    }
    baseUrl = `http://127.0.0.1:${gatewayPort}`;
    authToken = `leemo-gw:${provider.id}`;
  } else if (shim) {
    baseUrl = `http://127.0.0.1:${searchShimPort}`;
    // Placeholder, same discipline as the gateway: the real key stays in the
    // host process registry. This is strictly SAFER than direct wiring, where
    // the real key sits in the SDK child's env and any bash round can read it.
    authToken = `leemo-search:${provider.id}`;
  } else {
    baseUrl = provider.baseUrl;
    authToken = provider.apiKey; // real key — direct-wiring semantics
  }

  const env: ConversationEnv = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    // Blank the API-key channel so an ambient ANTHROPIC_API_KEY (spread from
    // process.env by the pool) can never shadow AUTH_TOKEN. (Phase 0 buildEnv.)
    ANTHROPIC_API_KEY: "",
    // Suppress non-essential background traffic in the SDK child (Phase 0
    // smoke/lib.mjs precedent). Both wiring modes.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    // Office/document Skills run short Python helpers from Windows workspaces.
    // Force deterministic Unicode output and keep imports from scattering
    // __pycache__ files through user folders or the managed Skill bundle.
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
  };

  for (const slot of SLOT_KEYS) {
    if (slot === "ANTHROPIC_MODEL") {
      env[slot] = slotDefault;
      continue;
    }
    const pinned = provider.envTemplate[slot]?.trim();
    env[slot] = pinned ? (gateway ? `claude-${pinned}` : pinned) : slotDefault;
  }

  const subagentModel = provider.envTemplate.CLAUDE_CODE_SUBAGENT_MODEL?.trim();
  if (subagentModel) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = gateway ? `claude-${subagentModel}` : subagentModel;
  }

  return env;
}
