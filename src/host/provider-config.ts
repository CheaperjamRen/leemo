/**
 * Provider configuration — the PURE data layer behind the encrypted store
 * (轮 3 卡 F).
 *
 * `src/main/secrets.ts` owns the encrypt/decrypt/write side; this module owns the
 * SHAPE: what one stored instance looks like, how a `ProviderDraft` from the
 * settings form folds into it, and how an older on-disk blob migrates forward.
 * Everything here is a pure function over plain objects — no fs, no crypto, no
 * Electron — so the whole write path is unit-testable under the node project.
 *
 * ── `id` is an INSTANCE, `kind` is a FAMILY ────────────────────────────────
 * A user may hold two DeepSeek accounts and three relays, so nothing may assume
 * one instance per family. The four preset families keep ids equal to their kind
 * (`deepseek`/`glm`/`kimi`/`qwen`) so conversations and usage rows that already
 * reference them keep resolving; every other instance gets a minted id.
 *
 * ── KEY DISCIPLINE ────────────────────────────────────────────────────────
 * `StoredProvider.apiKey` is the REAL secret. It only ever exists in memory here
 * and inside the OS-encrypted blob on disk. This module never logs it, and the
 * IPC projection that reaches the renderer (`ProviderConfigView`) reports
 * `hasApiKey` + a masked tail instead. Never widen that.
 */

import type {
  ModelCapabilities,
  ModelContextPolicy,
  ModelCapabilityEvidence,
  ProviderAuthMode,
  ProviderApiFormat,
  ProviderCapabilities,
  ProviderDraft,
  ProviderProductKind,
  TaskModelRouting,
} from "../bridge/contract";
import {
  cloneStoredMcpServers,
  sanitizeStoredMcpServers,
  type StoredMcpServers,
} from "./mcp-config";

/** One provider instance as persisted inside the encrypted blob. Mirrors
 *  `ProviderDraft` minus `id` (the id is the record's key in `providers`). */
export interface StoredProvider {
  kind: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  /** Missing in older encrypted blobs means the family/default `api-key` mode. */
  authMode?: ProviderAuthMode;
  productKind?: ProviderProductKind;
  category: "cn_official" | "official" | "custom";
  /** The real key. Absent = never configured / explicitly cleared. */
  apiKey?: string;
  models?: string[];
  modelCapabilities?: Record<string, ModelCapabilities>;
  modelContextPolicies?: Record<string, ModelContextPolicy>;
  modelCapabilityEvidence?: Record<string, ModelCapabilityEvidence>;
  taskModelRouting?: TaskModelRouting;
  headers?: Record<string, string>;
  /** Legacy read-only input. New saves are normalized into taskModelRouting. */
  envTemplate?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
  modelsUrl?: string;
  apiKeyUrl?: string;
}

/** The whole persisted document. `version` exists so the NEXT migration has a
 *  discriminator to branch on (this one has to sniff shapes instead). */
export interface ProviderConfigFile {
  version: 1;
  providers: Record<string, StoredProvider>;
  /** 轮 4 卡 H —— 搜索源的 API key。
   *
   *  刻意放进**这一份**加密件、而不是新开一个：整个 ProviderConfigFile 已经走
   *  safeStorage(DPAPI/Keychain/libsecret) 加密落盘，多开一份就是第二套加密、
   *  第二条迁移路径、第二个会漏明文的地方 —— 凭据只应有一个家。
   *
   *  可选字段：老的加密件里没有它，读出来就是 undefined，不需要抬 version。
   *  默认源 AnySearch 免 key，所以这里全空也能搜（06 §四）。 */
  searchKeys?: {
    anysearch?: string;
    doubao?: string;
    metaso?: string;
    tavily?: string;
    bocha?: string;
    google?: string;
    googleCx?: string;
    exa?: string;
    brave?: string;
    serpapi?: string;
    serper?: string;
    firecrawl?: string;
  };
  /** User MCP configs may carry API tokens in env/headers, so they live in this
   * same safeStorage-encrypted document. */
  mcpServers?: StoredMcpServers;
}

/** Env var names per preset family. Kept here (not in the catalog) because
 *  migration needs them to bootstrap instances out of `.env` on first run. */
const ENV_BOOTSTRAP: readonly {
  id: string;
  kind: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  keyEnv: string;
  modelEnv: string;
  baseUrlEnv?: string;
}[] = [
  {
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    apiFormat: "anthropic",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
  },
  {
    id: "glm",
    kind: "glm",
    name: "GLM（智谱）",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    apiFormat: "anthropic",
    keyEnv: "GLM_API_KEY",
    modelEnv: "GLM_MODEL",
  },
  {
    id: "kimi",
    kind: "kimi",
    name: "Kimi（月之暗面）",
    baseUrl: "https://api.moonshot.cn/anthropic",
    apiFormat: "anthropic",
    keyEnv: "KIMI_API_KEY",
    modelEnv: "KIMI_MODEL",
  },
  {
    id: "qwen",
    kind: "qwen",
    name: "通义千问（百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openai",
    keyEnv: "DASHSCOPE_API_KEY",
    modelEnv: "QWEN_MODEL",
    baseUrlEnv: "QWEN_BASE_URL",
  },
];

/** A brand-new, empty config. Fresh object every call. */
export function emptyConfig(): ProviderConfigFile {
  return { version: 1, providers: {} };
}

const ACTIVE_ENV_TEMPLATE_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
] as const;

/** Keep only runtime-supported role mappings and fold the deprecated fast slot
 * into Haiku. This runs on reads and writes so stale or arbitrary env fields do
 * not persist as settings that appear saved but can never take effect. */
function normalizeEnvTemplate(raw: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const key of ACTIVE_ENV_TEMPLATE_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value) normalized[key] = value;
  }
  if (!normalized.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    const legacyFast = raw.ANTHROPIC_SMALL_FAST_MODEL;
    if (typeof legacyFast === "string" && legacyFast) {
      normalized.ANTHROPIC_DEFAULT_HAIKU_MODEL = legacyFast;
    }
  }
  return normalized;
}

function sanitizeTaskModelRouting(raw: unknown): TaskModelRouting {
  if (!isRecord(raw)) return {};
  const out: TaskModelRouting = {};
  if (typeof raw.fastModelId === "string" && raw.fastModelId.trim()) {
    out.fastModelId = raw.fastModelId.trim();
  }
  if (typeof raw.subagentModelId === "string" && raw.subagentModelId.trim()) {
    out.subagentModelId = raw.subagentModelId.trim();
  }
  return out;
}

function taskModelRoutingFromEnv(raw: Record<string, unknown> | undefined): TaskModelRouting {
  if (!raw) return {};
  const env = normalizeEnvTemplate(raw);
  return sanitizeTaskModelRouting({
    fastModelId: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    subagentModelId: env.CLAUDE_CODE_SUBAGENT_MODEL,
  });
}

function cleanHeaderRecord(raw: Record<string, unknown>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const key = name.trim();
    if (key && typeof value === "string") cleaned[key] = value;
  }
  return cleaned;
}

/** Apply renderer edits without returning existing secret values to it. Header
 * names are case-insensitive; the latest spelling wins. */
export function mergeProviderHeaders(
  previous: Record<string, string> | undefined,
  patch: Record<string, string> | undefined,
  removeKeys: readonly string[] | undefined,
): Record<string, string> | undefined {
  if (patch !== undefined && Object.keys(patch).length === 0 && !removeKeys?.length) return {};
  if (patch === undefined && !removeKeys?.length) {
    return previous ? { ...previous } : undefined;
  }

  const merged = { ...(previous ?? {}) };
  const deleteName = (name: string) => {
    const lower = name.trim().toLowerCase();
    if (!lower) return;
    for (const existing of Object.keys(merged)) {
      if (existing.toLowerCase() === lower) delete merged[existing];
    }
  };
  for (const name of removeKeys ?? []) deleteName(name);
  for (const [name, value] of Object.entries(patch ?? {})) {
    const key = name.trim();
    if (!key) continue;
    deleteName(key);
    merged[key] = value;
  }
  return merged;
}

function cloneModelCapabilities(
  value: Record<string, ModelCapabilities> | undefined,
): Record<string, ModelCapabilities> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([modelId, capabilities]) => [modelId, { ...capabilities }]),
  );
}

const MIN_CONTEXT_WINDOW_TOKENS = 8_000;
const MAX_CONTEXT_WINDOW_TOKENS = 2_000_000;
const MIN_AUTO_COMPACT_WINDOW_TOKENS = 100_000;
const MAX_AUTO_COMPACT_WINDOW_TOKENS = 1_000_000;

function validIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function sanitizeModelContextPolicies(
  raw: unknown,
  allowedModels?: readonly string[],
): Record<string, ModelContextPolicy> | undefined {
  if (!isRecord(raw)) return undefined;
  const allowed = allowedModels ? new Set(allowedModels) : undefined;
  const out: Record<string, ModelContextPolicy> = {};
  for (const [modelId, value] of Object.entries(raw)) {
    if (!modelId || UNSAFE_RECORD_KEYS.has(modelId) || (allowed && !allowed.has(modelId)) || !isRecord(value)) continue;
    const policy: ModelContextPolicy = {};
    if (validIntegerInRange(value.contextWindowTokens, MIN_CONTEXT_WINDOW_TOKENS, MAX_CONTEXT_WINDOW_TOKENS)) {
      policy.contextWindowTokens = value.contextWindowTokens;
    }
    if (validIntegerInRange(value.autoCompactWindowTokens, MIN_AUTO_COMPACT_WINDOW_TOKENS, MAX_AUTO_COMPACT_WINDOW_TOKENS)) {
      policy.autoCompactWindowTokens = policy.contextWindowTokens
        ? Math.min(value.autoCompactWindowTokens, policy.contextWindowTokens)
        : value.autoCompactWindowTokens;
    }
    if (Object.keys(policy).length > 0) out[modelId] = policy;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cloneStoredProvider(provider: StoredProvider): StoredProvider {
  return {
    ...provider,
    ...(provider.models ? { models: [...provider.models] } : {}),
    ...(provider.modelCapabilities
      ? { modelCapabilities: cloneModelCapabilities(provider.modelCapabilities) }
      : {}),
    ...(provider.modelContextPolicies
      ? { modelContextPolicies: sanitizeModelContextPolicies(provider.modelContextPolicies, provider.models) }
      : {}),
    ...(provider.modelCapabilityEvidence
      ? {
          modelCapabilityEvidence: sanitizeModelCapabilityEvidence(
            provider.modelCapabilityEvidence,
            provider.models,
          ),
        }
      : {}),
    ...(provider.taskModelRouting
      ? { taskModelRouting: { ...provider.taskModelRouting } }
      : {}),
    ...(provider.headers ? { headers: { ...provider.headers } } : {}),
    ...(provider.envTemplate ? { envTemplate: { ...provider.envTemplate } } : {}),
    ...(provider.capabilities ? { capabilities: { ...provider.capabilities } } : {}),
  };
}

/** Structural clone deep enough for this document (plain JSON only). */
function cloneConfig(config: ProviderConfigFile): ProviderConfigFile {
  const providers: Record<string, StoredProvider> = {};
  for (const [id, provider] of Object.entries(config.providers)) {
    providers[id] = cloneStoredProvider(provider);
  }
  return {
    version: 1,
    providers,
    ...(config.searchKeys ? { searchKeys: { ...config.searchKeys } } : {}),
    ...(config.mcpServers ? { mcpServers: cloneStoredMcpServers(config.mcpServers) } : {}),
  };
}

/**
 * Create or update one instance.
 *
 * - No `draft.id` → create with `mintId()`.
 * - With `draft.id` → update that instance (or create it under that exact id,
 *   which is how the four presets get their stable ids).
 *
 * `apiKey` semantics match the form's 「留空即不改」 UX:
 *   - omitted (`undefined`) → KEEP whatever is stored
 *   - `""`                  → explicitly CLEAR
 *   - non-empty             → replace
 *
 * Every other optional field follows the same shape: omitted keeps the stored
 * value, an explicit `[]`/`{}` clears it. PURE — the input config is untouched.
 */
export function upsertProvider(
  config: ProviderConfigFile,
  draft: ProviderDraft,
  mintId: () => string,
): { config: ProviderConfigFile; id: string } {
  const next = cloneConfig(config);
  const id = draft.id ?? mintId();
  const prev = next.providers[id];

  const merged: StoredProvider = {
    kind: draft.kind,
    name: draft.name,
    baseUrl: draft.baseUrl,
    apiFormat: draft.apiFormat,
    category: draft.category ?? prev?.category ?? "custom",
  };
  const authMode = draft.authMode ?? prev?.authMode;
  if (authMode) merged.authMode = authMode;
  const productKind = draft.productKind ?? prev?.productKind;
  if (productKind) merged.productKind = productKind;

  // Key: undefined keeps, "" clears, value replaces.
  const key = draft.apiKey === undefined ? prev?.apiKey : draft.apiKey;
  if (key) merged.apiKey = key;

  if (draft.models !== undefined) merged.models = [...draft.models];
  else if (prev?.models) merged.models = [...prev.models];

  if (draft.modelCapabilities !== undefined) {
    merged.modelCapabilities = cloneModelCapabilities(draft.modelCapabilities);
  } else if (prev?.modelCapabilities) {
    merged.modelCapabilities = cloneModelCapabilities(prev.modelCapabilities);
  }

  if (draft.modelContextPolicies !== undefined) {
    merged.modelContextPolicies = sanitizeModelContextPolicies(draft.modelContextPolicies, merged.models);
  } else if (prev?.modelContextPolicies) {
    merged.modelContextPolicies = sanitizeModelContextPolicies(prev.modelContextPolicies, merged.models);
  }

  if (draft.modelCapabilityEvidence !== undefined) {
    merged.modelCapabilityEvidence = sanitizeModelCapabilityEvidence(
      draft.modelCapabilityEvidence,
      merged.models,
    );
  } else if (prev?.modelCapabilityEvidence) {
    merged.modelCapabilityEvidence = sanitizeModelCapabilityEvidence(
      prev.modelCapabilityEvidence,
      merged.models,
    );
  }

  const headers = mergeProviderHeaders(prev?.headers, draft.headers, draft.removeHeaderKeys);
  if (headers !== undefined) merged.headers = headers;

  if (draft.taskModelRouting !== undefined) {
    merged.taskModelRouting = sanitizeTaskModelRouting(draft.taskModelRouting);
  } else if (draft.envTemplate !== undefined) {
    // Transitional old renderer: accept its payload once, but persist only the
    // two product-level choices. Arbitrary environment names never reach disk.
    merged.taskModelRouting = taskModelRoutingFromEnv(draft.envTemplate);
  } else if (prev?.taskModelRouting !== undefined) {
    merged.taskModelRouting = sanitizeTaskModelRouting(prev.taskModelRouting);
  } else if (prev?.envTemplate) {
    merged.taskModelRouting = taskModelRoutingFromEnv(prev.envTemplate);
  }

  if (draft.capabilities !== undefined) merged.capabilities = { ...draft.capabilities };
  else if (prev?.capabilities) merged.capabilities = { ...prev.capabilities };

  const modelsUrl = draft.modelsUrl ?? prev?.modelsUrl;
  if (modelsUrl) merged.modelsUrl = modelsUrl;
  const apiKeyUrl = draft.apiKeyUrl ?? prev?.apiKeyUrl;
  if (apiKeyUrl) merged.apiKeyUrl = apiKeyUrl;

  next.providers[id] = merged;
  return { config: next, id };
}

/** Forget one instance. Unknown id = no-op. PURE. */
export function removeProvider(config: ProviderConfigFile, id: string): ProviderConfigFile {
  const next = cloneConfig(config);
  delete next.providers[id];
  return next;
}

/** True for a plain (non-array, non-null) object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const CAPABILITY_STATUSES = new Set(["verified", "failed", "unknown"]);
const UNSAFE_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitizeCapabilityEvidence(raw: unknown): ModelCapabilityEvidence["image"] | undefined {
  if (!isRecord(raw)) return undefined;
  const out: NonNullable<ModelCapabilityEvidence["image"]> = {};

  if (isRecord(raw.probe)) {
    const { status, checkedAt } = raw.probe;
    if (typeof status === "string" && CAPABILITY_STATUSES.has(status) && validTimestamp(checkedAt)) {
      out.probe = {
        status: status as "verified" | "failed" | "unknown",
        checkedAt,
        ...(typeof raw.probe.detail === "string"
          ? { detail: raw.probe.detail.slice(0, 300) }
          : {}),
      };
    }
  }

  if (
    isRecord(raw.userOverride)
    && raw.userOverride.supported === true
    && validTimestamp(raw.userOverride.updatedAt)
  ) {
    out.userOverride = { supported: true, updatedAt: raw.userOverride.updatedAt };
  }

  return out.probe || out.userOverride ? out : undefined;
}

function sanitizeModelCapabilityEvidence(
  raw: unknown,
  allowedModels?: readonly string[],
): Record<string, ModelCapabilityEvidence> {
  if (!isRecord(raw)) return {};
  const allowed = allowedModels ? new Set(allowedModels) : undefined;
  const out: Record<string, ModelCapabilityEvidence> = {};

  for (const [modelId, value] of Object.entries(raw)) {
    if (!modelId || UNSAFE_RECORD_KEYS.has(modelId) || (allowed && !allowed.has(modelId))) continue;
    if (!isRecord(value)) continue;
    const image = sanitizeCapabilityEvidence(value.image);
    const reasoning = sanitizeCapabilityEvidence(value.reasoning);
    if (image || reasoning) {
      out[modelId] = {
        ...(image ? { image } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
    }
  }

  return out;
}

/** Accept a stored entry only if its required fields are really strings — a
 *  half-written blob must not become a provider with `undefined` baseUrl. */
function sanitizeStored(raw: unknown): StoredProvider | undefined {
  if (!isRecord(raw)) return undefined;
  const { kind, name, baseUrl, apiFormat } = raw;
  if (typeof kind !== "string" || typeof name !== "string" || typeof baseUrl !== "string") return undefined;
  if (apiFormat !== "anthropic" && apiFormat !== "openai" && apiFormat !== "openai-responses") return undefined;
  const category = raw.category === "cn_official" || raw.category === "official" ? raw.category : "custom";
  const out: StoredProvider = { kind, name, baseUrl, apiFormat, category };
  if (raw.authMode === "api-key" || raw.authMode === "plan-key" || raw.authMode === "oauth-subscription" || raw.authMode === "none") {
    out.authMode = raw.authMode;
  }
  if (raw.productKind === "metered-api" || raw.productKind === "coding-plan" || raw.productKind === "aggregator" || raw.productKind === "local" || raw.productKind === "self-hosted" || raw.productKind === "consumer-subscription") {
    out.productKind = raw.productKind;
  }
  if (typeof raw.apiKey === "string" && raw.apiKey) out.apiKey = raw.apiKey;
  if (Array.isArray(raw.models)) out.models = raw.models.filter((m): m is string => typeof m === "string");
  if (isRecord(raw.modelCapabilities)) {
    out.modelCapabilities = cloneModelCapabilities(raw.modelCapabilities as Record<string, ModelCapabilities>);
  }
  if (isRecord(raw.modelContextPolicies)) {
    out.modelContextPolicies = sanitizeModelContextPolicies(raw.modelContextPolicies, out.models);
  }
  if (isRecord(raw.modelCapabilityEvidence)) {
    out.modelCapabilityEvidence = sanitizeModelCapabilityEvidence(raw.modelCapabilityEvidence, out.models);
  }
  if (isRecord(raw.headers)) out.headers = cleanHeaderRecord(raw.headers);
  if (Object.prototype.hasOwnProperty.call(raw, "taskModelRouting")) {
    // Presence matters: `{}` is the user's explicit "automatic" choice and
    // must suppress stale aliases that may still coexist in an old blob.
    out.taskModelRouting = sanitizeTaskModelRouting(raw.taskModelRouting);
  } else if (isRecord(raw.envTemplate)) {
    out.taskModelRouting = taskModelRoutingFromEnv(raw.envTemplate);
  }
  if (isRecord(raw.capabilities)) out.capabilities = raw.capabilities as Partial<ProviderCapabilities>;
  if (typeof raw.modelsUrl === "string") out.modelsUrl = raw.modelsUrl;
  if (typeof raw.apiKeyUrl === "string") out.apiKeyUrl = raw.apiKeyUrl;
  return out;
}

/** The pre-卡F encrypted blob: a flat DeepSeek-only pair. */
function fromLegacyBlob(raw: Record<string, unknown>): ProviderConfigFile {
  const out = emptyConfig();
  const key = typeof raw.DEEPSEEK_API_KEY === "string" ? raw.DEEPSEEK_API_KEY : "";
  const model = typeof raw.DEEPSEEK_MODEL === "string" ? raw.DEEPSEEK_MODEL : "";
  if (!key && !model) return out;

  const preset = ENV_BOOTSTRAP[0]; // deepseek
  const stored: StoredProvider = {
    kind: preset.kind,
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiFormat: "anthropic",
    category: "cn_official",
  };
  if (key) stored.apiKey = key;
  // The legacy blob knew exactly ONE model and it was the user's default. Keep
  // it at models[0]; the catalog fills the rest of the family's picks in.
  if (model) stored.models = [model];
  out.providers[preset.id] = stored;
  return out;
}

/**
 * Normalize whatever is on disk (or nothing at all) into the current shape, then
 * bootstrap any preset family whose instance is MISSING from `env`.
 *
 * ⚠️ This is the irreversible migration point — the user's real keys pass
 * through here. Contract:
 *   - new shape (`{providers:{…}}`)   → kept as-is (entry-by-entry sanitized)
 *   - legacy shape (`{DEEPSEEK_*}`)   → folded into a `deepseek` instance
 *   - anything else (null/junk/array) → `emptyConfig()`, never a throw
 *
 * Env NEVER overwrites a stored key: `.env` is the dev/bootstrap channel, the
 * app's own config is the source of truth (same precedence the catalog applies).
 */
export function migrateLegacyConfig(
  raw: unknown,
  env: Record<string, string | undefined>,
): ProviderConfigFile {
  let base: ProviderConfigFile;

  if (isRecord(raw) && isRecord(raw.providers)) {
    base = emptyConfig();
    for (const [id, entry] of Object.entries(raw.providers)) {
      const clean = sanitizeStored(entry);
      if (clean) base.providers[id] = clean;
    }
    if (isRecord(raw.searchKeys)) {
      const searchKeys: NonNullable<ProviderConfigFile["searchKeys"]> = {};
      for (const source of [
        "anysearch",
        "doubao",
        "metaso",
        "tavily",
        "bocha",
        "google",
        "googleCx",
        "exa",
        "brave",
        "serpapi",
        "serper",
        "firecrawl",
      ] as const) {
        const value = raw.searchKeys[source];
        if (typeof value === "string" && value) searchKeys[source] = value;
      }
      if (Object.keys(searchKeys).length > 0) base.searchKeys = searchKeys;
    }
    const mcpServers = sanitizeStoredMcpServers(raw.mcpServers);
    if (mcpServers) base.mcpServers = mcpServers;
  } else if (isRecord(raw) && ("DEEPSEEK_API_KEY" in raw || "DEEPSEEK_MODEL" in raw)) {
    base = fromLegacyBlob(raw);
  } else {
    base = emptyConfig();
  }

  for (const preset of ENV_BOOTSTRAP) {
    if (base.providers[preset.id]) continue; // stored config wins
    const key = env[preset.keyEnv];
    if (!key) continue;
    const baseUrl = (preset.baseUrlEnv ? env[preset.baseUrlEnv] : undefined) || preset.baseUrl;
    // Preserve explicit legacy Qwen workspace URLs while moving the default
    // bootstrap route to the current OpenAI-compatible endpoint.
    const apiFormat = preset.kind === "qwen" && /\/apps\/anthropic\/?$/i.test(baseUrl)
      ? "anthropic"
      : preset.apiFormat;
    const stored: StoredProvider = {
      kind: preset.kind,
      name: preset.name,
      baseUrl,
      apiFormat,
      category: "cn_official",
      apiKey: key,
    };
    const model = env[preset.modelEnv];
    if (model) stored.models = [model];
    base.providers[preset.id] = stored;
  }

  return base;
}
