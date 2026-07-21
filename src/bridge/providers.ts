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
//   GATEWAY (apiFormat === "openai")
//     The SDK talks to the local loopback gateway; ANTHROPIC_AUTH_TOKEN is the
//     placeholder `leemo-gw:<providerId>`. The real key NEVER enters this env —
//     it lives only in the gateway process (see src/gateway/registry.ts). The
//     model name is disguised with a `claude-` prefix so the SDK surfaces it,
//     matching the gateway's /v1/models discovery contract (G3).
//
// buildConversationEnv is PURE: it maps (provider, modelId, gatewayPort?) to the
// env object and reads nothing from process.env / .env / disk. The pool is
// responsible for spreading process.env and setting CLAUDE_CONFIG_DIR.

/** Per-model capability flags (06 §3.1). */
export interface ModelCapabilities {
  thinking: boolean;
  vision: boolean;
}

/** The CC model-alias slots (宪法 B4 + Phase 0 smoke/lib.mjs parity — 6 slots).
 *  A provider's envTemplate may pin any subset; unpinned slots default to the
 *  conversation's chosen modelId. */
export interface EnvTemplate {
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_SMALL_FAST_MODEL?: string;
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
  apiFormat: "anthropic" | "openai";
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelCapabilities: Record<string, ModelCapabilities>;
  envTemplate: EnvTemplate;
}

/** The env map handed to the SDK (`options.env`). Values are string | undefined
 *  to match the SDK's own `env?: {[k]: string | undefined}` field. */
export type ConversationEnv = Record<string, string | undefined>;

/** Order matters only for readability; all six slots are always emitted.
 *  Mirrors the env face Phase 0 verified in smoke/lib.mjs (buildEnv). */
const SLOT_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
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

/** True if an env var name looks like it carries a secret. */
function isSecretEnvName(name: string): boolean {
  return SECRET_ENV_PATTERNS.some((re) => re.test(name));
}

/**
 * Drop every secret-shaped variable from a host env snapshot.
 *
 * The SDK REPLACES the child's environment (see buildConversationEnv callers),
 * so the pool must spread `process.env` for PATH/HOME/etc. But in production
 * `process.env` carries the gateway's real upstream keys (RELAY2_API_KEY …) and
 * potentially sibling-provider secrets — a child that can run bash could
 * `printenv` them. sanitizeHostEnv removes them BEFORE the conversation's own
 * token is layered on (buildConversationEnv sets ANTHROPIC_AUTH_TOKEN after), so
 * direct wiring keeps its own key and no sibling secret rides along.
 *
 * Pure: never mutates the input; returns a fresh object.
 */
export function sanitizeHostEnv(
  hostEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(hostEnv)) {
    if (isSecretEnvName(name)) continue;
    out[name] = value;
  }
  return out;
}

/**
 * Build the SDK `options.env` for one conversation round.
 *
 * @param provider   upstream descriptor
 * @param modelId    the model chosen for THIS conversation (not necessarily
 *                   provider.models[0]); becomes the default for every alias slot
 * @param gatewayPort loopback port of the running gateway — REQUIRED for
 *                   apiFormat==="openai", ignored for "anthropic"
 *
 * Never mutates its inputs; returns a fresh object each call.
 */
export function buildConversationEnv(
  provider: Provider,
  modelId: string,
  gatewayPort?: number
): ConversationEnv {
  const gateway = provider.apiFormat === "openai";

  // The value each alias slot defaults to when the template does not pin it.
  // Direct: the raw modelId. Gateway: the claude--disguised modelId.
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
  };

  for (const slot of SLOT_KEYS) {
    // In gateway mode the template (which names raw model ids) is ignored: the
    // wire model must be the claude--disguised name the gateway advertises.
    const pinned = gateway ? undefined : provider.envTemplate[slot];
    env[slot] = pinned ?? slotDefault;
  }

  return env;
}
