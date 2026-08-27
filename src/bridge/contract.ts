// Leemo Bridge — IPC contract (Task B3): the TypeScript face of the frozen
// bridge↔renderer boundary. Human-readable freeze doc: docs/specs/09-Bridge-
// IPC契约-v1.0.md (channel names + round-trip sequences + change discipline).
//
// This module is PURE TYPES (plus two data constants). It re-exports every
// outward B1/B2/B3 type — WITHOUT redefining any — and adds the IPC-only
// wrapper types, the reserved (Phase-1) usage-summary types, and the
// provider serializable projection carrying the mandated extensibility axes.
// It imports nothing at runtime: no Electron, no SDK, no gateway, no vendor.
// (Every re-export uses `export type`, erased at compile — so pulling this file
// never drags in interact.ts's SDK runtime.)
//
// ── Freeze scope (v1.0) ────────────────────────────────────────────────────
// The channel set (BRIDGE_CHANNELS), the invoke/event payload maps, and the
// shapes below are the frozen boundary downstream frontend work builds on.
// Change discipline (see 09 doc): ADD A PROVIDER = ADD CATALOG DATA, NOT CHANGE
// THIS CONTRACT. A custom provider is first-class. balance / pricing / quota
// are per-KIND capabilities dispatched by kind/family — never welded to a
// specific provider id.
//
// ⚠️ ANTI-PATTERN (do not repeat in this contract): B2's balance.ts currently
// dispatches on `provider.id === 'deepseek' | 'kimi'` via a hardcoded FETCHERS
// map. That is an explicitly self-noted Phase-1 PLACEHOLDER, NOT a contract
// commitment. This contract must NEVER encode an id→capability assumption in
// its types. Capability is declared by the provider (ProviderCapabilities),
// discovered/dispatched by `kind`/family; taking an instance BY id is fine,
// letting id DECIDE capability is not. When the real Provider directory lands,
// balance/pricing/quota dispatch moves to kind/family.

// ===========================================================================
// Re-exports — B2 event normalization (src/bridge/events.ts)
// ===========================================================================

/** One product term, one physical directory. Both the host's write routing and
 * the renderer's artifact projection consume this value so the visible path
 * cannot drift from where files are actually stored. */
export const DEFAULT_WORKSPACE_DIR = "默认工作区";

export type {
  LeemoEvent,
  UsageRecord,
  UsageModelRecord,
  RunOutcome,
  PathAudit,
  PathClaim,
  MemoryChangeAction,
  MemoryScopeView,
  BrowserCaptureRef,
} from "./events";
import type { MemoryChangeAction, MemoryScopeView } from "./events";
import type {
  GlobalOverviewFact,
  GlobalOverviewOverride,
  GlobalOverviewSnapshot,
  GlobalOverviewTrigger,
} from "./global-pending-overview";

// ===========================================================================
// Re-exports — B2 pricing (src/bridge/pricing.ts) + balance (balance.ts)
// ===========================================================================

export type { ModelPricing } from "./pricing";
export type { BalanceInfo } from "./balance";

// ===========================================================================
// Re-exports — B1 conversation pool (src/bridge/pool.ts)
// ===========================================================================
//
// Only `ConversationState` (a plain string union) crosses the boundary as-is.
//
// `ConversationConfig` is DELIBERATELY NOT re-exported: it is a PROCESS-IN
// creation config that embeds `provider: Provider`, which carries `apiKey` (the
// real secret) — the same reason Provider itself is excluded below. No channel
// binds it: `bridge:createConversation` takes the key-free
// `CreateConversationRequest` (provider referenced by id). It stays defined in
// pool.ts (B1, unchanged); the contract just doesn't surface it.
//
// `ConversationHandle` is likewise process-in (methods, live AbortController)
// and does NOT cross IPC — its serializable projection is `ConversationRef`.
export type { ConversationState } from "./pool";

// Provider (src/bridge/providers.ts) is DELIBERATELY NOT re-exported: it
// carries `apiKey` (the real secret) and is a process-in descriptor. Secrets
// never reach the renderer — the IPC-facing provider projection is
// `ProviderSpec` below (no key). Only the pure, key-free `ModelCapabilities`
// shape is re-exported, since ProviderSpec references it.
export type { ModelCapabilities, ModelContextPolicy, TaskModelRouting } from "./providers";
export type {
  CapabilityEvidence,
  CapabilityProbeEvidence,
  CapabilityProbeResults,
  CapabilityProbeStatus,
  CapabilityUserOverride,
  ModelCapabilityEvidence,
} from "./model-capabilities";

// ===========================================================================
// Re-exports — B3 interaction bridge (src/bridge/interact.ts)
// ===========================================================================

export type {
  RiskLevel,
  ApprovalTier,
  ApprovalTaskScope,
  ApprovalRequest,
  ApprovalDecision,
  WhitelistEntry,
  PermissionMode,
  PermissionPolicy,
  AskUserOption,
  AskUserQuestion,
  AskUserInput,
  AskUserPayload,
  AskUserAnswerItem,
  AskUserAnswer,
} from "./interact";

// Local imports (type-only) so this module can compose the re-exported shapes
// into the IPC maps below without redefining them.
import type { LeemoEvent } from "./events";
import type { BalanceInfo } from "./balance";
import type {
  ApprovalRequest,
  ApprovalDecision,
  AskUserPayload,
  AskUserAnswer,
  WhitelistEntry,
  RiskLevel,
} from "./interact";
import type { PermissionMode } from "./interact";
import type { ModelCapabilities, ModelContextPolicy } from "./providers";

// ===========================================================================
// Provider serializable projection — the EXTENSIBILITY AXES live here
// (user 7/21: 20+ future providers — official APIs, OAuth-subscription /
// coding-plan quota, relay/中转站, custom-as-first-class).
// ===========================================================================

/** How a provider authenticates.
 *  - 'api-key'            — a static key.
 *  - 'oauth-subscription' — login-based, quota not balance (Claude Max / Kimi /
 *    智谱 coding plan, 火山方舟/阿里百炼/百度千帆 coding plans). Slot RESERVED;
 *    no adapter ships first release, but the axis exists so adding one later is
 *    catalog data, not a contract change.
 *  - 'none'               — no key at all: a LOCAL model server (Ollama /
 *    LM Studio, user 7/21). Points at a loopback/LAN baseUrl; nothing to
 *    authenticate. Pairs with `capabilities.local`. */
export type ProviderAuthMode = "api-key" | "plan-key" | "oauth-subscription" | "none";

/** Renderer-safe state for a login-based model subscription. Account details
 *  and tokens stay process-in; the UI only needs to know what action is next. */
export interface ProviderLoginStatus {
  state: "connected" | "disconnected" | "unavailable";
  message?: string;
}

/** Upstream wire contract. The legacy `openai` value intentionally keeps its
 * Chat Completions meaning so existing encrypted configs remain valid. */
export type ProviderApiFormat = "anthropic" | "openai" | "openai-responses";

/** Commercial/runtime shape shown in the setup journey. This is independent
 * from the wire protocol used by the upstream endpoint. */
export type ProviderProductKind =
  | "metered-api"
  | "coding-plan"
  | "aggregator"
  | "local"
  | "self-hosted"
  | "consumer-subscription";

/** Provider FAMILY identifier. INTENTIONALLY an open `string`, NOT a closed
 *  union: a new family or a user's custom provider must NOT require editing this
 *  contract. `KNOWN_PROVIDER_KINDS` offers reference values only — never treat
 *  the set as exhaustive, and never branch capability off a specific kind at
 *  the type level. */
export type ProviderKind = string;

/** Reference-only set of known provider families (NON-exhaustive; a custom
 *  provider carries `kind: 'custom'` or any string). Present for editor
 *  autocomplete / catalog seeding — the TYPE stays `string`. */
export const KNOWN_PROVIDER_KINDS = [
  "deepseek",
  "glm",
  "kimi",
  "qwen",
  "minimax",
  "doubao",
  "siliconflow",
  "anthropic",
  "openrouter",
  "ollama",
  "lmstudio",
  "relay",
  "custom",
] as const;

/** What a provider CAN do, DECLARED by the provider (not inferred from its id).
 *  balance/pricing/quota features dispatch off these flags + `kind`, never off
 *  a hardcoded id list (see the anti-pattern note at the top of this file). */
export interface ProviderCapabilities {
  /** Has an official balance-query endpoint (DeepSeek/Kimi today; a relay or an
   *  OAuth-subscription provider may set false and expose quota instead). */
  balanceApi: boolean;
  /** Supports `/v1/models` discovery (relays / token-plans expose dozens). */
  modelDiscovery: boolean;
  /** Is an OAuth-subscription / coding-plan provider — surfaces QUOTA rather
   *  than a monetary balance. Pairs with authMode='oauth-subscription'. */
  subscriptionPlan: boolean;

  // ── NewMax-parity reserve (user 7/21; all OPTIONAL) ──────────────────────
  // Convenience axes lifted from NewMax's provider deep-dive (33 presets). The
  // TYPE reserve lands now so the full catalog + settings-page UI (= Provider
  // milestone) is catalog data, not a contract change. None are read by any
  // first-release code path.
  /** Runs locally with no key (Ollama / LM Studio). Pairs with authMode='none'. */
  local?: boolean;
  /** Endpoint accepts an anthropic⇄openai Base-URL protocol switch (NewMax has
   *  ~10 such providers). Drives the direct-vs-gateway wiring choice per config. */
  protocolSwitchable?: boolean;
  /** Supports multi-key rotation (round-robin across several keys). */
  multiKey?: boolean;
  /** Overseas endpoint that needs an outbound proxy to reach. */
  requiresProxy?: boolean;
}

/** The IPC-facing, key-free projection of a Provider (06 §3.1 shape minus the
 *  secret). This is the "provider spec or equivalent" the extensibility axes are
 *  mandated on: `authMode`, `kind`, `apiFormat`, and `capabilities` are all
 *  first-class fields so the first-release single-shape (api-key + a few kinds)
 *  can grow to 20+ providers by adding CATALOG DATA, never by changing types. */
export interface ProviderSpec {
  id: string;
  name: string;
  /** Provider family — open string (see ProviderKind). */
  kind: ProviderKind;
  category: "cn_official" | "official" | "custom";
  /** Wire protocol — kept from B1/B2 (drives direct vs gateway wiring). */
  apiFormat: ProviderApiFormat;
  /** Authentication mode. Local services use `none`; subscription login stays reserved. */
  authMode: ProviderAuthMode;
  productKind?: ProviderProductKind;
  searchAliases?: string[];
  summary?: string;
  baseUrl: string;
  /** "Where to get a key" guidance link (06 §3.1 apiKeyUrl). */
  apiKeyUrl?: string;
  /** Key-free model discovery endpoint used to prefill the setup journey. */
  modelsUrl?: string;
  models: string[];
  /** Per-model thinking/vision flags (06 §3.1); optional in the projection. */
  modelCapabilities?: Record<string, ModelCapabilities>;
  /** Per-model real context ceiling and automatic compaction capacity. */
  modelContextPolicies?: Record<string, ModelContextPolicy>;
  /** Measured evidence and explicit user corrections stay separate from the
   *  preset hints above. */
  modelCapabilityEvidence?: Record<string, import("./model-capabilities").ModelCapabilityEvidence>;
  /** Declared capabilities — the dispatch axis for balance/pricing/quota. */
  capabilities: ProviderCapabilities;
  /** Whether this instance can start a conversation (轮 3 卡 F).
   *  OPTIONAL + additive: absent means "unknown", which older callers already
   *  treat as today's behaviour (everything listed WAS configured, because an
   *  unconfigured provider never entered the catalog at all).
   *
   *  Since 卡 F the catalog lists every preset family whether or not it has a
   *  key, so the settings page can show "还能配哪些家" and the input-box model
   *  picker can filter down to only what is actually usable. NOTE the invariant
   *  this creates: an entry with `configured:false` must be refused with a
   *  human-readable setup error. Key-auth providers need a key and a model;
   *  local `authMode:none` providers need only a saved model selection. */
  configured?: boolean;
  /** Whether this instance exists in the encrypted app configuration. This is
   *  distinct from `configured`: a saved custom endpoint with a missing key
   *  must remain editable instead of disappearing back into the offer catalog. */
  saved?: boolean;
}

// ===========================================================================
// Provider configuration (轮 3 卡 F) — the write side of the catalog.
//
// `id` is an INSTANCE id, `kind` is the FAMILY. Two DeepSeek accounts or three
// relays are ordinary, so nothing may assume one instance per family. The four
// preset families keep stable ids equal to their kind (`deepseek`/`glm`/`kimi`/
// `qwen`) so conversations and usage rows already referencing them keep
// resolving; custom instances get minted ids.
//
// KEY DISCIPLINE: a key may travel renderer → main (the user typed it into the
// config form — there is no other way in), but NEVER main → renderer. That is
// why `ProviderConfigView` reports `hasApiKey` + a masked tail instead of the
// secret, and why `ProviderSpec` has no key field at all.
// ===========================================================================

/** Everything the settings UI can define for one provider instance. Submitted
 *  by `bridge:saveProvider`, and accepted inline by the test/discovery channels
 *  so the wizard can verify a key BEFORE saving it. */
export interface ProviderDraft {
  /** Omit to create; supply to update an existing instance. */
  id?: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  /** Omitted legacy/custom drafts default to `api-key`. */
  authMode?: ProviderAuthMode;
  productKind?: ProviderProductKind;
  category?: "cn_official" | "official" | "custom";
  /** Plaintext key, renderer → main only. Omit on update to KEEP the stored key
   *  (the form shows a masked tail, so "leave blank to keep" is the UX). */
  apiKey?: string;
  /** Models the user enabled — pulled from the vendor or hand-typed. */
  models?: string[];
  /** Legacy/preset thinking and vision hints kept for compatibility. The UI no
   *  longer asks users to declare these manually; measured and corrected truth
   *  lives in `modelCapabilityEvidence`. */
  modelCapabilities?: Record<string, ModelCapabilities>;
  modelContextPolicies?: Record<string, ModelContextPolicy>;
  /** Probe evidence and user corrections keyed by the concrete model id. */
  modelCapabilityEvidence?: Record<string, import("./model-capabilities").ModelCapabilityEvidence>;
  /** Optional fast/background and subtask model choices. Missing values mean
   *  automatic behavior. */
  taskModelRouting?: import("./providers").TaskModelRouting;
  /** Extra request headers — relays and private gateways commonly require them.
   *  On update this is a PATCH: omitted names keep their stored values. That
   *  lets secret values stay main-process-only instead of round-tripping through
   *  the renderer. An explicit empty object keeps the legacy "clear all" shape. */
  headers?: Record<string, string>;
  /** Header names to remove from a stored instance. Names are matched
   *  case-insensitively because HTTP header names are case-insensitive. */
  removeHeaderKeys?: string[];
  /** @deprecated Transitional compatibility for the old settings form. New UI
   *  code must submit `taskModelRouting`; the host no longer persists arbitrary
   *  environment variable names. Removed with the streamlined form. */
  envTemplate?: Record<string, string>;
  capabilities?: Partial<ProviderCapabilities>;
  /** Vendor endpoint that lists models. NOT derivable from baseUrl by
   *  convention — 卡 F measured four different shapes across four vendors. */
  modelsUrl?: string;
  /** "Where to get a key" link shown in the config form. */
  apiKeyUrl?: string;
}

/** The editable view of a stored instance — the config form's GET side. API
 *  keys and secret-shaped custom header VALUES never cross this boundary. A
 *  conservative allowlist of ordinary protocol headers may be returned in
 *  `headers`; all other configured names appear in `secretHeaderKeys` only. */
export interface ProviderConfigView {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  authMode: ProviderAuthMode;
  productKind?: ProviderProductKind;
  category: "cn_official" | "official" | "custom";
  models: string[];
  modelCapabilities?: Record<string, ModelCapabilities>;
  modelContextPolicies?: Record<string, ModelContextPolicy>;
  modelCapabilityEvidence?: Record<string, import("./model-capabilities").ModelCapabilityEvidence>;
  taskModelRouting?: import("./providers").TaskModelRouting;
  headers?: Record<string, string>;
  secretHeaderKeys?: string[];
  /** @deprecated Transitional compatibility for the old settings form. */
  envTemplate?: Record<string, string>;
  capabilities: ProviderCapabilities;
  modelsUrl?: string;
  apiKeyUrl?: string;
  hasApiKey: boolean;
  /** Last few characters only (e.g. `····a1b2`), for "is this the key I think
   *  it is". Never the whole secret. */
  apiKeyMasked?: string;
  /** False for a preset family the user has never configured — it exists in the
   *  catalog as an offer, not as a saved instance. */
  saved: boolean;
}

/** Why a provider call failed, in terms a person can act on (06 §3.5).
 *
 *  Grounded in what the four vendors ACTUALLY return (卡 F probes, not docs):
 *    • every vendor answers 401 for a bad key, but in three different body
 *      shapes — `{error:{type,message}}` (deepseek/kimi), `{error:{type:"401"}}`
 *      (glm, non-standard), `{code:"InvalidApiKey",message}` (dashscope, no
 *      `error` wrapper at all);
 *    • 403 is AMBIGUOUS across vendors: dashscope uses it for a malformed key,
 *      GLM uses it for "this account may not use this model"
 *      (`[1220] 您无权访问glm-4.6-air`). So a classifier must read the body, not
 *      just the status;
 *    • GLM encodes real reasons in bracketed business codes inside `message`
 *      ([1211] no such model / [1220] no permission / [1305] overloaded);
 *    • a missing model is 404 on kimi but 400 on glm and deepseek. */
export type ProviderErrorKind =
  | "auth"          // key wrong / expired / missing
  | "permission"    // key valid, not entitled to this model
  | "model_missing" // no such model name
  | "balance"       // out of credit
  | "rate_limit"    // throttled
  | "overloaded"    // vendor capacity (GLM 1305 / HTTP 529)
  | "network"       // DNS/TCP/TLS failure
  | "timeout"
  | "region"        // geo-blocked / needs a proxy
  | "bad_request"   // malformed payload (our bug, not the user's)
  | "server"        // upstream 5xx
  | "unknown";

/** A classified provider failure. `message` is user-facing Chinese; `detail` is
 *  the redacted upstream text for the "展开详情" affordance. Neither may ever
 *  contain an API key (redaction is the classifier's responsibility). */
export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  detail?: string;
  httpStatus?: number;
}

/** Test a provider by id (saved) or by draft (pre-save wizard step). Exactly one
 *  of `providerId` / `draft` must be present. */
export interface ConnectionTestRequest {
  providerId?: string;
  draft?: ProviderDraft;
  /** Model to test with; defaults to the instance's first enabled model. */
  modelId?: string;
  /** @deprecated Capability probes now run automatically after the baseline.
   *  Kept temporarily so an older renderer can call a newer host safely. */
  probeVision?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Round-trip latency of the text probe (the "ping" the user asked for). */
  latencyMs?: number;
  /** Model name echoed by the upstream — catches silent aliasing. */
  modelEcho?: string;
  /** Structured, advisory evidence from the automatic image/reasoning probes. */
  capabilityProbes?: import("./model-capabilities").CapabilityProbeResults;
  /** Whether a `thinking` block came back. */
  thinking?: boolean;
  /** @deprecated Compatibility projection. Read `capabilityProbes.image` for
   *  evidence-aware UI. Undefined means the probe made no boolean verdict. */
  vision?: boolean;
  /** @deprecated Compatibility error for older renderers. */
  visionProbeError?: ProviderError;
  error?: ProviderError;
}

/** Pull the model list from a vendor. Accepts a draft so the wizard can list
 *  models before the instance is saved. */
export interface ListRemoteModelsRequest {
  providerId?: string;
  draft?: ProviderDraft;
}

export interface RemoteModel {
  id: string;
  displayName?: string;
  /** True when this id looks like a dated snapshot of another entry
   *  (`qwen3.7-flash-2026-07-15` → `qwen3.7-flash`), so the UI can fold them. */
  snapshotOf?: string;
}

export interface ListRemoteModelsResult {
  models: RemoteModel[];
  error?: ProviderError;
}

// ===========================================================================
// Reserved (Phase-1) — usage summaries (user 7/21: hover popup shows balance +
// today/7-day usage stats). Implementation needs SQLite = Phase 1; the CONTRACT
// types are reserved NOW so freezing v1.0 doesn't force a contract change to add
// them later. `bridge:usageSummary` is a Phase-1 channel (present, unimplemented
// first release).
// ===========================================================================

/** Which window a usage summary covers, optionally scoped to one provider. */
export interface UsageSummaryQuery {
  range: "today" | "last7d" | "last30d";
  providerId?: string;
}

/** Per-provider roll-up row. `costUsd` is 6-decimal TEXT (NewMax precision
 *  discipline, matching UsageRecord.costUsd); undefined when the window's rows
 *  were all unpriced. */
export interface UsageSummaryByProvider {
  providerId: string;
  costUsd?: string;
  callCount?: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Per-model roll-up. This is the detail row used by the settings table; the
 * provider id stays explicit because model aliases are not globally unique. */
export interface UsageSummaryByModel {
  providerId: string;
  modelId: string;
  costUsd?: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Per-day roll-up row (for the 7-day view). */
export interface UsageSummaryByDay {
  /** YYYY-MM-DD (local day). */
  date: string;
  costUsd?: string;
}

/** The aggregate a `bridge:usageSummary` invoke returns (Phase 1). */
export interface UsageSummary {
  totalCostUsd?: string;
  callCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  byProvider: UsageSummaryByProvider[];
  byModel?: UsageSummaryByModel[];
  byDay?: UsageSummaryByDay[];
}

// ===========================================================================
// IPC wrapper types — the serializable request/response projections that ride
// the invoke channels. (ConversationConfig is the process-in creation config;
// CreateConversationRequest is its IPC projection — references a provider BY ID
// so the renderer never ships a key.)
// ===========================================================================

/** Create-conversation request over IPC. References the provider by id (the
 *  main process resolves it against the encrypted catalog and builds the real
 *  ConversationConfig); the key never crosses. */
export interface CreateConversationRequest {
  providerId: string;
  modelId: string;
  /** "Claim THIS id, don't mint a new one" (轮 2 卡 C). Conversation ids are
   *  minted by the host but persisted by the renderer, and the host's registry
   *  dies with the process — so after a restart the renderer re-claims the id it
   *  already stores rather than orphaning the whole thread. Omit for a genuinely
   *  new conversation and the host mints one as before. */
  conversationId?: string;
  /** The main-process-registered workspace this conversation belongs to.
   * Renderer sends only the opaque id returned by the native folder picker;
   * host resolves and re-validates the real directory. Omit for legacy records,
   * which remain bound to Leemo's main workspace. */
  workspaceId?: string;
  /** Which 本子 (notebook) this conversation belongs to (轮 3 卡 G), i.e. a
   *  directory name directly under the workspace root — `ConversationMeta.bookId`.
   *
   *  Sent as an ID, never as text: the host resolves `<notebook>/CLAUDE.md`
   *  itself and re-reads it on every create, so a new conversation sees what
   *  momo wrote into the notebook a minute ago (same freshness rule as the
   *  global memory bank). That file is 06 §7.4's 中期记忆层, overlaid on the
   *  global layer in 工作台态. Omit for an unfiled conversation — the global
   *  layer alone then applies, which is exactly 搭子态's behavior.
   *
   *  The filesystem side of notebooks is NOT part of this contract: directory
   *  listings/reads go over the separate `leemo:workspace` channel (10 号 §S11),
   *  the same way persistence stays out of it. Only this id crosses here,
   *  because prompt assembly is genuinely inside the conversation boundary. */
  notebookId?: string | null;
  /** SDK session id to resume from on the first round (轮 2 卡 C) — the session
   *  the renderer persisted when this conversation last finished a round.
   *  Without it a re-claimed conversation could send but would remember nothing.
   *  If the session is no longer resumable the host degrades to a fresh one. */
  resumeSessionId?: string;
  /** Provider directory that physically stores the local Harness transcript.
   * It can differ from providerId after a hot model/provider switch. Keeping
   * this owner lets a restarted app resume the same chapter while the selected
   * provider supplies the next round. */
  resumeSessionOwnerProviderId?: string;
  /** Classifies the conversation for renderer/bridge assembly; wiki strategy is
   *  intentionally deferred to the later composition layer. */
  purpose?: "main" | "wiki";
  /** Loopback gateway port for openai-format providers; omitted for anthropic. */
  gatewayPort?: number;
  /** Per-conversation permission-mode override (07/21 policy-driven approval).
   *  Omit to use the broker's default policy; set e.g. 'bypassPermissions' for a
   *  zero-friction session. */
  permissionMode?: PermissionMode;
  /** 轮 7 A4 —— the settings-page「允许危险命令缓存」toggle.
   *
   *  Additive (循 Batch -1 先例). It used to be documented as "broker/settings
   *  level, not per-request", which in practice meant **nothing carried it**:
   *  the renderer had the checkbox, the broker had the policy field, and no wire
   *  connected them. Same defect class as `permissionMode` (see A4). Sending it
   *  per-create is right because policy is per-conversation — the broker is
   *  constructed once per conversation.
   *
   *  Omit ⇒ broker default `false` (dangerous stays strictly allow-once). */
  dangerousCommandCaching?: boolean;
  /** momo persona context (轮 2 卡 A) — the inputs `buildMomoSystemPrompt`
   *  needs that only the renderer knows. All optional (additive contract
   *  change): omit them and the host falls back to its built-in defaults.
   *
   *  `mode` feeds layer ③ (搭子态 vs 工作台态 tone block). */
  mode?: "buddy" | "workbench";
  /** RESOLVED persona-card body (`PersonaCard.promptText`) for layer ④ — NOT a
   *  card id. The card registry lives in the renderer's settings store; the
   *  host has none, so it could not resolve an id into prompt text. */
  personaText?: string;
  /** Talk-style slider stop for layer ⑤ (1=简洁 / 2=适度 / 3=话痨). */
  talkStyle?: 1 | 2 | 3;
  /** Whether web SEARCH is available, for layer ⑦. Already the EFFECTIVE value:
   *  the renderer applies the 统筹「联网功能」mask before sending (see
   *  `webSearchActive` in stores/settings.ts), so the host never has to know
   *  about the three-tier switch shape. Defaults to false — a host that is
   *  told nothing must not hand momo a network tool. */
  webSearchEnabled?: boolean;
  /** Whether web FETCH (built-in WebFetch) is available. Effective value, same
   *  masking rule as above.
   *
   *  Defaults to TRUE when omitted, unlike its sibling: WebFetch has been
   *  unconditionally allowed since 卡 H2, and an older renderer that does not
   *  know this field yet must keep the capability it already had rather than
   *  silently losing it. New renderers always send it explicitly. */
  webFetchEnabled?: boolean;
  /** Whether momo may read and update the global memory bank. Defaults to true
   *  for compatibility with renderers that predate the settings toggle. This
   *  does not disable Skills: their plugin is an independent capability. */
  rememberMode?: boolean;
  /** QUALIFIED skill names to enable this conversation (轮 2 卡 E) — the
   *  renderer reads them off `SkillInfo.qualifiedName`, never off a rendered
   *  label. Semantics follow the SDK exactly (sdk.d.ts:1877):
   *    • omitted  → no SDK auto-configuration; the CLI's own defaults apply.
   *                 This is NOT "skills off" — it is today's behaviour.
   *    • `[]`     → an explicit empty allow-list: every skill is filtered out.
   *                 The user turning all their skills OFF must send this, not
   *                 omit the field.
   *    • non-empty → only those skills are visible to the model. */
  enabledSkills?: string[];
}

/** Serializable projection of a ConversationHandle — the id is the only thing
 *  that crosses IPC; interrupt()/setModel()/dispose() are invoke channels
 *  keyed by this id. */
export interface ConversationRef {
  conversationId: string;
}

// ===========================================================================
// Skills (轮 2 卡 E) — one installed skill, as the renderer sees it.
// ===========================================================================
//
// ⚠️ NAMING 铁律 (user, 卡 E §二): 「不要让用户感知到 skill 的名字有什么前缀」.
// CC qualifies plugin-provided skills as `<plugin>:<skill>`, so the SDK needs
// `leemo:pdf` — but the user installed a skill called `pdf` and that is the only
// name they should ever see. The prefix therefore lives in EXACTLY two places:
// the `skills` array handed to the SDK, and `qualifiedName` below. Every
// user-visible surface (SkillsPage card, `/` menu, chips, momo's own prose)
// renders `name`. Bare-name slash commands are实测 usable (`/pdf` works), so
// nothing about the UX needs the prefix.
/** Open product category id. Leemo ships a few well-known ids, but community
 * and user Skills may introduce new ones without waiting for an app release. */
export type SkillCategory = string;

export type SkillRequirement =
  | "core"
  | "filesystem"
  | "web-search"
  | "academic-search"
  | "document-read"
  | "document-create";

export type SkillTrust = "leemo" | "community" | "personal";
export type SkillScanStatus = "unscanned" | "scanned" | "review" | "blocked";
export type SkillSourceKind = "leemo" | "manual" | "local-folder" | "local-archive" | "github" | "skillsh";

export interface SkillSecurityFindingView {
  rule: string;
  severity: "medium" | "high" | "critical";
  title: string;
  detail: string;
  file: string;
  line?: number;
}

/** A bounded, one-shot interpretation used only when deterministic task text
 * parsing cannot distinguish plan, deadline and reminder roles. Credentials
 * never cross this contract. */
export type ResolvedTaskField =
  | {
      kind: "planned" | "due" | "reminder";
      date: string;
      time?: string;
      source: string;
    }
  | {
      kind: "reminderOffset";
      minutesBefore: number;
      source: string;
    }
  | {
      kind: "recurrence";
      rule: "daily" | "weekly" | "monthly" | "weekdays";
      source: string;
    };

export interface ResolveTaskTimesRequest {
  providerId: string;
  modelId: string;
  /** Only the ambiguous task lines selected by the user; never a whole note library. */
  texts: string[];
  /** Renderer-local clock context for relative Chinese dates such as “下周五”. */
  localNow: string;
  timeZone?: string;
}

export type ResolveTaskTimesResponse =
  | { ok: true; items: Array<{ index: number; fields: ResolvedTaskField[] }> }
  | { ok: false; message: string };

export interface GenerateGlobalOverviewRequest {
  providerId: string;
  modelId: string;
  trigger: GlobalOverviewTrigger;
  localNow: string;
  timeZone?: string;
  facts: GlobalOverviewFact[];
  overrides: GlobalOverviewOverride[];
}

export type GenerateGlobalOverviewResponse =
  | { ok: true; snapshot: GlobalOverviewSnapshot }
  | { ok: false; message: string; detail?: string; retryable: boolean };

export interface SkillSourceCandidateView {
  name: string;
  description: string;
  scan?: {
    status: Exclude<SkillScanStatus, "unscanned">;
    findings: SkillSecurityFindingView[];
    analyzedFiles: number;
    analysis: "static";
  };
}

export interface SkillSourceInspectionView {
  sourceKind: Exclude<SkillSourceKind, "leemo" | "manual">;
  sourceLabel: string;
  /** Pinned upstream URL for remote sources. Local absolute paths stay in the
   * host process and are intentionally omitted from renderer/model results. */
  resolvedSource?: string;
  candidates: SkillSourceCandidateView[];
  repository?: string;
  revision?: string;
  license?: string;
}

export interface SkillMutationItem {
  id: string;
  name: string;
  description: string;
  trust: Exclude<SkillTrust, "leemo">;
  sourceKind: Exclude<SkillSourceKind, "leemo" | "manual">;
  sourceLabel: string;
  scanStatus: SkillScanStatus;
  securityFindings?: SkillSecurityFindingView[];
  license?: string;
  revision?: string;
  repository?: string;
  canUpdate: boolean;
}

export interface SkillInstallOutcome {
  installed: SkillMutationItem[];
  receipt: string;
}

export interface CommunitySkillMemberView {
  id: string;
  name: string;
  /** Curated, user-facing title. `name` stays the upstream Skill identity. */
  displayName?: string;
  description: string;
}

export interface CommunitySkillView {
  id: string;
  name: string;
  /** Curated, user-facing title. `name` stays searchable as the upstream name. */
  displayName?: string;
  description: string;
  /** A family is installed as one verified package while each member remains
   * independently switchable after installation. Omitted means one Skill. */
  kind?: "skill" | "family";
  memberCount?: number;
  members?: CommunitySkillMemberView[];
  category: SkillCategory;
  categoryLabel: string;
  /** A small, host-owned discovery collection. It controls presentation only;
   * installation trust still comes from the pinned manifest and file hashes. */
  featured: boolean;
  author: string;
  repository: string;
  revision: string;
  license: string;
  sourceUrl: string;
  /** The verified files are installed, but this package has an external
   * first-run prerequisite. It remains installable and is not "unavailable". */
  setupRequired?: boolean;
  setupMessage?: string;
  installed: boolean;
  /** Leemo's published catalog is pre-scanned. This is evidence, not a claim
   * that a Skill can never do anything surprising when the model uses it. */
  scanStatus: "scanned";
}

export interface CommunitySkillDetailsView {
  /** The pinned upstream SKILL.md content. Renderers must treat it as inert
   * Markdown; raw HTML remains disabled by the shared Markdown renderer. */
  markdown: string;
}

export interface SkillInfo {
  /** Stable preference key. Older custom skills may omit it; the host derives
   * one from their qualified name before returning the catalog. */
  id?: string;
  /** Bare name = SKILL.md frontmatter `name`. It remains the runtime identity
   *  and fallback UI label. Guaranteed free of ':' (host drops any skill that
   *  smuggles one in). */
  name: string;
  /** Optional catalog-owned title. It is never used as a runtime command or
   * qualified Skill identity; user-installed Skills leave it absent. */
  displayName?: string;
  /** Optional bare command understood by the underlying Skill runtime. It is
   * intentionally hidden from catalog cards; for example the friendly
   * "Excel 表格" card invokes the bundled `xlsx` skill. */
  commandName?: string;
  /** Frontmatter `description`; empty string when the file omits it. */
  description: string;
  /** The qualified name handed to the SDK's `skills` option, e.g. "leemo:pdf".
   *  The renderer passes it back through `enabledSkills` and MUST NOT render it. */
  qualifiedName: string;
  /** Absolute path only for user-owned skills. Built-ins never expose their
   * managed runtime directory to the renderer. */
  dir?: string;
  /** Where it came from. Everything under <workspace>/.leemo/skills is 'user';
   *  'builtin' is reserved for the read-only skills Leemo ships with. */
  source: "user" | "builtin";
  /** Built-in catalog grouping. User-authored skills may omit it. */
  category?: SkillCategory;
  /** Optional user-facing label for an open category id. */
  categoryLabel?: string;
  /** Optional product collection used to group related Skills without changing
   * their independent runtime identities or preference keys. */
  collectionId?: string;
  /** User-facing collection title. Internal plugin/package names stay hidden. */
  collectionLabel?: string;
  /** Whole-package size for shared-runtime collections. It lets the renderer
   * explain one atomic remove action without exposing package internals. */
  collectionMemberCount?: number;
  /** Runtime capabilities needed before the workflow can execute honestly. */
  requirements?: SkillRequirement[];
  /** First-run policy. User skills default to enabled when absent. */
  defaultEnabled?: boolean;
  /** False means the UI disables invocation and explains why up front. */
  available?: boolean;
  unavailableReason?: string;
  /** A non-blocking first-run prerequisite. Unlike `available: false`, this
   * never disables the Skill; the UI explains it once at collection level. */
  setupRequired?: boolean;
  setupMessage?: string;
  /** Product-facing provenance. `source` above remains the runtime ownership
   * axis; trust/source labels are what the management page communicates. */
  trust?: SkillTrust;
  sourceKind?: SkillSourceKind;
  sourceLabel?: string;
  sourceUrl?: string;
  repository?: string;
  revision?: string;
  license?: string;
  scanStatus?: SkillScanStatus;
  securityFindings?: SkillSecurityFindingView[];
  canRemove?: boolean;
  canUpdate?: boolean;
}

/** Start-a-round request. Events flow back on the `bridge:event` channel, not
 *  as this invoke's response. */
export interface AttachmentRef {
  /** Display name from the selected File. The host derives the authoritative
   * name again from `path`; never treat this field as an instruction. */
  name: string;
  /** Absolute OS path obtained only through Electron `webUtils.getPathForFile`. */
  path: string;
  /** Renderer-observed size for immediate UI only; host re-stats the file. */
  size: number;
  mimeType?: string;
}

/** A file already visible in the selected Leemo workspace. Unlike a local
 * attachment, this never exposes an absolute path to the sandboxed renderer.
 * The host resolves and verifies `workspacePath` against the conversation's
 * own workspace immediately before the round starts. */
export interface WorkspaceFileRef {
  name: string;
  workspaceId: string;
  workspacePath: string;
}

export interface SendRequest {
  conversationId: string;
  prompt: string;
  /** Active persistent objective for this conversation. The host adds it to
   * this turn's model input; paused goals are omitted by the renderer. */
  goalText?: string;
  attachments?: AttachmentRef[];
  workspaceFiles?: WorkspaceFileRef[];
  /** Stable ids for global notes explicitly attached to this turn. The host
   * re-reads their latest bodies; note text never travels from the renderer. */
  noteReferences?: string[];
  /** Per-turn helper dispatch preference. Omitted means the normal automatic
   * behavior; false removes the dispatch tools for this round only. */
  allowSubagents?: boolean;
  /** Renderer timeline id of the user message that started this round. Stored
   * only as memory provenance; never shown to the model or user. */
  sourceMessageId?: string;
}

/** Add a user correction to the currently running task. Engines with native
 * steering apply it immediately; engines without it may honestly queue it for
 * the next turn. */
export interface GuideRequest {
  conversationId: string;
  prompt: string;
}

export interface GuideResponse {
  delivery: "applied" | "queued";
}

/** Change-provider/model-for-next-round request (env-level; not retroactive). */
export interface SetModelRequest {
  conversationId: string;
  providerId: string;
  modelId: string;
}

/**
 * 轮 7 A3 —— apply changed settings to a conversation that ALREADY EXISTS.
 *
 * The defect this closes, measured on the real product: persona/web/permission
 * context only crossed at `createConversation`, so a user who opened 设置, turned
 * 「联网功能」on, and asked in the SAME conversation got
 *   「我没办法搜 —— 这轮对话里我的网络访问是关的」
 * while the switch on screen read ON. Opening a NEW conversation searched fine.
 * Nothing in the UI hinted that the distinction existed.
 *
 * Semantics are deliberately「下一轮起生效」, not「中断当前这一轮」: the host
 * rebuilds the prompt/tool wiring in the conversation's extras container, which
 * `send()` re-reads per round. Interrupting would throw away a reply the user is
 * currently waiting for — a worse trade than waiting one turn.
 *
 * Every field optional and applied only when present: the renderer sends the
 * whole persona context, and an omitted field must mean "leave as-is" rather
 * than "reset to default".
 */
export interface UpdateContextRequest {
  conversationId: string;
  mode?: "buddy" | "workbench";
  personaText?: string;
  talkStyle?: 1 | 2 | 3;
  webSearchEnabled?: boolean;
  webFetchEnabled?: boolean;
  rememberMode?: boolean;
  permissionMode?: PermissionMode;
  dangerousCommandCaching?: boolean;
}

/** Instant-balance request (B2 fetchBalance), by provider id. */
export interface FetchBalanceRequest {
  providerId: string;
}

/** IPC routing envelope for semantic SDK events. `conversationId` belongs to
 *  transport routing only; the nested `LeemoEvent` variants stay unchanged. */
export interface BridgeEventEnvelope {
  conversationId: string;
  event: LeemoEvent;
}

/** Host-owned permission expiry. AskUser remains a separate interaction with
 * its own semantics and is deliberately not covered by this event. */
export interface ApprovalExpired {
  id: string;
  conversationId: string;
}

// ===========================================================================
// Long-term memory — renderer-safe projections. Ledger paths, native cache
// files, and arbitrary filesystem targets stay in the host process.
// ===========================================================================

export type MemoryKindView = "profile" | "preference" | "state" | "goal" | "episode" | "notebook";
export type MemoryStatusView = "current" | "uncertain" | "superseded" | "deleted";
export type MemorySourceTypeView = "explicit-user" | "native-auto" | "legacy-import" | "settings-edit";

export interface MemoryView {
  id: string;
  scope: MemoryScopeView;
  kind: MemoryKindView;
  topic: string;
  statement: string;
  learnedAt: number;
  validFrom?: number;
  validTo?: number;
  lastConfirmedAt?: number;
  sourceType: MemorySourceTypeView;
  sourceConversationId?: string;
  sourceMessageId?: string;
  status: MemoryStatusView;
  supersedes?: string;
  pinned: boolean;
}

/** Historical versions carry the same provenance and temporal fields as the
 * current projection; the status tells whether a version was replaced or
 * deleted. */
export type MemoryHistoryEntry = MemoryView;

export interface MemoryChangeResult {
  changeId: string;
  action: Exclude<MemoryChangeAction, "undone">;
  label: string;
  memory: MemoryView;
}

export interface MemoryUndoResult {
  ok: boolean;
  conflict?: boolean;
  changeId?: string;
  targetChangeId: string;
  action?: "undone";
}

export interface UpdateMemoryRequest {
  scope: MemoryScopeView;
  id: string;
  topic?: string;
  statement?: string;
  kind?: MemoryKindView;
  validFrom?: number;
}

// ===========================================================================
// Channel table — the frozen channel set. Two kinds:
//   • invoke  (renderer → main, request/response)
//   • event   (main → renderer, push)
// The typed maps below bind each channel name to its payload type(s), so the
// 09 doc's channel↔type correspondence is machine-enforced (BridgeInvokeMap /
// BridgeEventMap keys ARE the channel names; their values ARE contract types).
// ===========================================================================

export const BRIDGE_CHANNELS = {
  // invoke — conversation lifecycle
  createConversation: "bridge:createConversation",
  send: "bridge:send",
  guide: "bridge:guide",
  interrupt: "bridge:interrupt",
  setModel: "bridge:setModel",
  updateContext: "bridge:updateContext",
  disposeConversation: "bridge:disposeConversation",
  // invoke — provider / balance / usage
  listProviders: "bridge:listProviders",
  fetchBalance: "bridge:fetchBalance",
  // invoke — provider configuration (轮 3 卡 F)
  getProviderConfig: "bridge:getProviderConfig",
  saveProvider: "bridge:saveProvider",
  deleteProvider: "bridge:deleteProvider",
  getProviderLoginStatus: "bridge:getProviderLoginStatus",
  loginProvider: "bridge:loginProvider",
  logoutProvider: "bridge:logoutProvider",
  testConnection: "bridge:testConnection",
  resolveTaskTimes: "bridge:resolveTaskTimes",
  generateGlobalPendingOverview: "bridge:generateGlobalPendingOverview",
  listRemoteModels: "bridge:listRemoteModels",
  usageSummary: "bridge:usageSummary", // Phase 1 (reserved)
  listWhitelist: "bridge:listWhitelist",
  revokeWhitelist: "bridge:revokeWhitelist",
  // invoke — 搜索源 key (轮 4 卡 H)
  getSearchSources: "bridge:getSearchSources",
  saveSearchKey: "bridge:saveSearchKey",
  searchAcademic: "bridge:searchAcademic",
  // invoke — MCP servers
  listMcpServers: "bridge:listMcpServers",
  saveMcpServer: "bridge:saveMcpServer",
  deleteMcpServer: "bridge:deleteMcpServer",
  testMcpServer: "bridge:testMcpServer",
  readBrowserCapture: "bridge:readBrowserCapture",
  // invoke — skills (轮 2 卡 E)
  listSkills: "bridge:listSkills",
  openSkillsDir: "bridge:openSkillsDir",
  syncEnabledSkills: "bridge:syncEnabledSkills",
  inspectSkillSource: "bridge:inspectSkillSource",
  pickSkillSource: "bridge:pickSkillSource",
  installSkill: "bridge:installSkill",
  listCommunitySkills: "bridge:listCommunitySkills",
  getCommunitySkillDetails: "bridge:getCommunitySkillDetails",
  installCommunitySkill: "bridge:installCommunitySkill",
  scanInstalledSkill: "bridge:scanInstalledSkill",
  removeSkill: "bridge:removeSkill",
  // invoke — governed long-term memory
  listMemory: "bridge:listMemory",
  updateMemory: "bridge:updateMemory",
  deleteMemory: "bridge:deleteMemory",
  pinMemory: "bridge:pinMemory",
  memoryHistory: "bridge:memoryHistory",
  undoMemory: "bridge:undoMemory",
  openMemoryDir: "bridge:openMemoryDir",
  // invoke — interaction replies (host → bridge)
  approvalDecision: "bridge:approvalDecision",
  askUserAnswer: "bridge:askUserAnswer",
  // event — main → renderer push
  event: "bridge:event",
  approvalRequest: "bridge:approvalRequest",
  approvalExpired: "bridge:approvalExpired",
  askUser: "bridge:askUser",
} as const;

/** 轮 4 卡 H —— 可配 key 的搜索源。AnySearch 也在列是因为它**可选**接 key
 *  (免 key 就能用，配了也不会前插 —— 实测某些 key 档位结果反而更差)。 */
export type SearchSourceId =
  | "anysearch"
  | "doubao"
  | "metaso"
  | "tavily"
  | "bocha"
  | "google"
  | "exa"
  | "brave"
  | "serpapi"
  | "serper"
  | "bing"
  | "firecrawl";

export type SearchCredentialField = "apiKey" | "engineId";

/** Renderer -> main only. Secrets are never projected back to the renderer. */
export interface SearchCredentialDraft {
  source: SearchSourceId;
  apiKey: string;
  /** Google Custom Search also requires its programmable search engine id. */
  engineId?: string;
}

/** A bounded, citeable arXiv record returned by Leemo's academic-search tool. */
export interface AcademicPaper {
  id: string;
  title: string;
  url: string;
  abstract: string;
  authors: string[];
  publishedAt?: string;
  updatedAt?: string;
  categories: string[];
  pdfUrl?: string;
}

export interface AcademicSearchOutcome {
  query: string;
  papers: AcademicPaper[];
  cached: boolean;
  fetchedAt: number;
}

/** 一个搜索源在设置页的状态。**没有 key 字段** —— 明文 key 不出主进程。 */
export interface SearchSourceStatus {
  id: SearchSourceId;
  /** 界面上显示的名字。 */
  label: string;
  /** 这个源没有 key 能不能用。只有 AnySearch 是 true —— 它是免 key 默认源，
   *  所以"一把 key 都没配"不是错误状态，搜索开箱就能用。 */
  keyless: boolean;
  /** 是否已存了 key。 */
  configured: boolean;
  /** Which required fields exist, never their values. */
  configuredFields: SearchCredentialField[];
  /** 一句话说明它在链里的位置与取舍，给设置页当说明文字用。 */
  note: string;
  /** 上游已退役或没有稳定公开 API 时明确阻塞；不提供伪配置入口。 */
  blockedReason?: string;
}

// ===========================================================================
// MCP servers — Claude Code's native extension surface, exposed as a real
// Leemo user path rather than hidden SDK plumbing.
// ===========================================================================

export type McpTransport = "stdio" | "http" | "sse";
export type BrowserConnectionMode = "managed" | "extension";

/** Renderer -> main. `env` and `headers` may contain plaintext credentials and
 * therefore travel in this direction only. Omitted on update means KEEP the
 * encrypted values; an explicit empty object clears them. */
export interface McpServerDraft {
  id?: string;
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
  alwaysLoad?: boolean;
  /** Built-in browser only. `managed` uses Leemo's isolated persistent profile;
   * `extension` connects to tabs in the user's current Chrome/Edge through the
   * official Playwright extension. */
  browserMode?: BrowserConnectionMode;
}

/** Main -> renderer projection. Secret values never cross back; only their key
 * names are exposed so the settings page can say what is configured. */
export interface McpServerView {
  id: string;
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  headerKeys: string[];
  enabled: boolean;
  timeoutMs?: number;
  alwaysLoad?: boolean;
  builtin?: "playwright" | "computer";
  browserMode?: BrowserConnectionMode;
  saved: boolean;
  /** False when an optional packaged runtime could not be resolved. */
  available: boolean;
}

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface McpConnectionTestResult {
  ok: boolean;
  /** Present for browser checks that distinguish a runnable MCP component
   * from a browser identity that is actually connected. */
  state?: "ready" | "waiting-for-browser";
  latencyMs?: number;
  tools: McpToolInfo[];
  error?: string;
}

export interface BrowserCapturePayload {
  mimeType: "image/png" | "image/jpeg";
  dataBase64: string;
}

/** invoke channels → {request,response}. `void` = no meaningful payload. */
export interface BridgeInvokeMap {
  "bridge:createConversation": { request: CreateConversationRequest; response: ConversationRef };
  "bridge:send": { request: SendRequest; response: void };
  "bridge:guide": { request: GuideRequest; response: GuideResponse };
  "bridge:interrupt": { request: ConversationRef; response: { state: "stopping" | "stopped" | "locked" | "idle" } };
  "bridge:setModel": { request: SetModelRequest; response: void };
  "bridge:updateContext": { request: UpdateContextRequest; response: void };
  "bridge:disposeConversation": { request: ConversationRef; response: void };
  "bridge:listProviders": { request: void; response: ProviderSpec[] };
  "bridge:fetchBalance": { request: FetchBalanceRequest; response: BalanceInfo };
  /** Editable view of one instance — headers/models yes, key never (轮 3 卡 F).
   *  Returns null for an unknown id. */
  "bridge:getProviderConfig": { request: { providerId: string }; response: ProviderConfigView | null };
  /** Create or update an instance; persists to the encrypted config and rebuilds
   *  the live catalog so the change applies without a restart. Returns the saved
   *  instance's spec (with its minted id, for a create). */
  "bridge:saveProvider": { request: ProviderDraft; response: ProviderSpec };
  /** Forget an instance. A CUSTOM instance disappears; a PRESET family reverts to
   *  its unconfigured offer (`configured:false`) rather than vanishing — the
   *  preset list is a constant, not user data. */
  "bridge:deleteProvider": { request: { providerId: string }; response: void };
  /** Login-based subscriptions expose only a coarse state. Account data and
   *  OAuth material never cross IPC. */
  "bridge:getProviderLoginStatus": { request: { providerId: string }; response: ProviderLoginStatus };
  "bridge:loginProvider": { request: { providerId: string }; response: ProviderLoginStatus };
  "bridge:logoutProvider": { request: { providerId: string }; response: ProviderLoginStatus };
  /** Real upstream round-trip with human-readable failure classification. */
  "bridge:testConnection": { request: ConnectionTestRequest; response: ConnectionTestResult };
  "bridge:resolveTaskTimes": { request: ResolveTaskTimesRequest; response: ResolveTaskTimesResponse };
  "bridge:generateGlobalPendingOverview": {
    request: GenerateGlobalOverviewRequest;
    response: GenerateGlobalOverviewResponse;
  };
  /** Ask the vendor what models exist (each family's discovery URL differs). */
  "bridge:listRemoteModels": { request: ListRemoteModelsRequest; response: ListRemoteModelsResult };
  /** Phase 1 (reserved — unimplemented first release). */
  "bridge:usageSummary": { request: UsageSummaryQuery; response: UsageSummary };
  /** 搜索源的配置状态(轮 4 卡 H)。**只回"配没配",绝不回传 key 本身** ——
   *  照 getProviderConfig 的同一条规矩:明文 key 不出主进程。 */
  "bridge:getSearchSources": { request: void; response: SearchSourceStatus[] };
  /** 存搜索源凭据。`apiKey: ""` 表示清除；Google 必须与 engineId 成对保存/清除。存进 provider 那同一份加密件
   *  (`ProviderConfigFile.searchKeys`),下一次搜索即生效、不需重启。 */
  "bridge:saveSearchKey": {
    request: SearchCredentialDraft;
    response: SearchSourceStatus[];
  };
  /** Direct diagnostic/UI entry point. momo uses the process-in academic MCP. */
  "bridge:searchAcademic": {
    request: { query: string };
    response: AcademicSearchOutcome;
  };
  "bridge:listMcpServers": { request: void; response: McpServerView[] };
  "bridge:saveMcpServer": { request: McpServerDraft; response: McpServerView };
  "bridge:deleteMcpServer": { request: { id: string }; response: void };
  /** Starts the configured server, performs MCP initialize + tools/list, then
   * closes it. This explicit user action does not spend model tokens. */
  "bridge:testMcpServer": { request: { id: string }; response: McpConnectionTestResult };
  /** Reads one opaque screenshot id emitted by the trusted browser MCP. The
   * absolute app-data path never crosses into the renderer or conversation DB. */
  "bridge:readBrowserCapture": { request: { id: string }; response: BrowserCapturePayload | null };
  /** Scan <workspace>/.leemo/skills and report what is installed (轮 2 卡 E).
   *  Bare names for the UI + qualified names for the next createConversation. */
  "bridge:listSkills": { request: void; response: SkillInfo[] };
  /** Persisted skill preferences are resolved in the renderer, then applied to
   * every live conversation from its next round without interrupting work. */
  "bridge:syncEnabledSkills": {
    request: { enabledQualifiedNames: string[] };
    response: { updatedConversations: number };
  };
  /** Reveal <workspace>/.leemo/skills in the OS file manager (shell.openPath).
   *  Main-process only — the renderer has no filesystem reach. */
  "bridge:openSkillsDir": { request: void; response: void };
  "bridge:inspectSkillSource": {
    request: { source: string; securityScan?: boolean };
    response: SkillSourceInspectionView;
  };
  "bridge:pickSkillSource": {
    request: { kind: "archive" | "folder" };
    response: { path?: string };
  };
  "bridge:installSkill": {
    request: { source: string; candidate?: string; securityScan?: boolean };
    response: SkillInstallOutcome;
  };
  "bridge:listCommunitySkills": { request: void; response: CommunitySkillView[] };
  "bridge:getCommunitySkillDetails": {
    request: { id: string };
    response: CommunitySkillDetailsView;
  };
  "bridge:installCommunitySkill": {
    request: { id: string };
    response: SkillInstallOutcome;
  };
  "bridge:scanInstalledSkill": {
    request: { id: string };
    response: SkillMutationItem;
  };
  "bridge:removeSkill": { request: { id: string }; response: void };
  "bridge:listMemory": {
    request: { scopes: MemoryScopeView[]; includeInactive?: boolean };
    response: MemoryView[];
  };
  "bridge:updateMemory": { request: UpdateMemoryRequest; response: MemoryChangeResult };
  "bridge:deleteMemory": {
    request: { scope: MemoryScopeView; id: string };
    response: MemoryChangeResult;
  };
  "bridge:pinMemory": {
    request: { scope: MemoryScopeView; id: string; pinned: boolean };
    response: MemoryChangeResult;
  };
  "bridge:memoryHistory": {
    request: { scope: MemoryScopeView; id: string };
    response: MemoryHistoryEntry[];
  };
  "bridge:undoMemory": {
    request: {
      scope: MemoryScopeView;
      targetChangeId: string;
      conversationId?: string;
    };
    response: MemoryUndoResult;
  };
  "bridge:openMemoryDir": { request: { scope: MemoryScopeView }; response: void };
  "bridge:listWhitelist": { request: void; response: WhitelistEntry[] };
  "bridge:revokeWhitelist": { request: { toolName: string; risk: RiskLevel }; response: void };
  "bridge:approvalDecision": { request: ApprovalDecision; response: void };
  "bridge:askUserAnswer": { request: AskUserAnswer; response: void };
}

/** event channels → push payload (main → renderer). */
export interface BridgeEventMap {
  "bridge:event": BridgeEventEnvelope;
  "bridge:approvalRequest": ApprovalRequest;
  "bridge:approvalExpired": ApprovalExpired;
  "bridge:askUser": AskUserPayload;
}

/** The full set of channel-name string literals (union), for exhaustive host
 *  wiring. */
export type BridgeChannel = (typeof BRIDGE_CHANNELS)[keyof typeof BRIDGE_CHANNELS];
