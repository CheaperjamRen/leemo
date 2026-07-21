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

export type { LeemoEvent, UsageRecord, PathAudit, PathClaim } from "./events";

// ===========================================================================
// Re-exports — B2 pricing (src/bridge/pricing.ts) + balance (balance.ts)
// ===========================================================================

export type { ModelPricing } from "./pricing";
export type { BalanceInfo } from "./balance";

// ===========================================================================
// Re-exports — B1 conversation pool (src/bridge/pool.ts)
// ===========================================================================
//
// ConversationConfig / ConversationState cross the boundary as-is.
// ConversationHandle is a PROCESS-IN object (methods, live AbortController) and
// does NOT cross IPC — its serializable projection is `ConversationRef` below.
export type { ConversationConfig, ConversationState } from "./pool";

// Provider (src/bridge/providers.ts) is DELIBERATELY NOT re-exported: it
// carries `apiKey` (the real secret) and is a process-in descriptor. Secrets
// never reach the renderer — the IPC-facing provider projection is
// `ProviderSpec` below (no key). Only the pure, key-free `ModelCapabilities`
// shape is re-exported, since ProviderSpec references it.
export type { ModelCapabilities } from "./providers";

// ===========================================================================
// Re-exports — B3 interaction bridge (src/bridge/interact.ts)
// ===========================================================================

export type {
  RiskLevel,
  ApprovalTier,
  ApprovalRequest,
  ApprovalDecision,
  WhitelistEntry,
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
import type { ApprovalRequest, ApprovalDecision, AskUserPayload, AskUserAnswer } from "./interact";
import type { ModelCapabilities } from "./providers";

// ===========================================================================
// Provider serializable projection — the EXTENSIBILITY AXES live here
// (user 7/21: 20+ future providers — official APIs, OAuth-subscription /
// coding-plan quota, relay/中转站, custom-as-first-class).
// ===========================================================================

/** How a provider authenticates.
 *  - 'api-key'            — a static key (first release implements ONLY this).
 *  - 'oauth-subscription' — login-based, quota not balance (Claude Max / Kimi /
 *    智谱 coding plan, 火山方舟/阿里百炼/百度千帆 coding plans). Slot RESERVED;
 *    no adapter ships first release, but the axis exists so adding one later is
 *    catalog data, not a contract change. */
export type ProviderAuthMode = "api-key" | "oauth-subscription";

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
  "anthropic",
  "openrouter",
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
  apiFormat: "anthropic" | "openai";
  /** Auth axis — first release 'api-key' only; 'oauth-subscription' reserved. */
  authMode: ProviderAuthMode;
  baseUrl: string;
  /** "Where to get a key" guidance link (06 §3.1 apiKeyUrl). */
  apiKeyUrl?: string;
  models: string[];
  /** Per-model thinking/vision flags (06 §3.1); optional in the projection. */
  modelCapabilities?: Record<string, ModelCapabilities>;
  /** Declared capabilities — the dispatch axis for balance/pricing/quota. */
  capabilities: ProviderCapabilities;
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
  range: "today" | "last7d";
  providerId?: string;
}

/** Per-provider roll-up row. `costUsd` is 6-decimal TEXT (NewMax precision
 *  discipline, matching UsageRecord.costUsd); undefined when the window's rows
 *  were all unpriced. */
export interface UsageSummaryByProvider {
  providerId: string;
  costUsd?: string;
  inputTokens: number;
  outputTokens: number;
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
  byProvider: UsageSummaryByProvider[];
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
  /** Loopback gateway port for openai-format providers; omitted for anthropic. */
  gatewayPort?: number;
}

/** Serializable projection of a ConversationHandle — the id is the only thing
 *  that crosses IPC; interrupt()/setModel()/dispose() are invoke channels
 *  keyed by this id. */
export interface ConversationRef {
  conversationId: string;
}

/** Start-a-round request. Events flow back on the `bridge:event` channel, not
 *  as this invoke's response. */
export interface SendRequest {
  conversationId: string;
  prompt: string;
}

/** Change-model-for-next-round request (env-level; not retroactive — B1). */
export interface SetModelRequest {
  conversationId: string;
  modelId: string;
}

/** Instant-balance request (B2 fetchBalance), by provider id. */
export interface FetchBalanceRequest {
  providerId: string;
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
  interrupt: "bridge:interrupt",
  setModel: "bridge:setModel",
  disposeConversation: "bridge:disposeConversation",
  // invoke — provider / balance / usage
  listProviders: "bridge:listProviders",
  fetchBalance: "bridge:fetchBalance",
  usageSummary: "bridge:usageSummary", // Phase 1 (reserved)
  // invoke — interaction replies (host → bridge)
  approvalDecision: "bridge:approvalDecision",
  askUserAnswer: "bridge:askUserAnswer",
  // event — main → renderer push
  event: "bridge:event",
  approvalRequest: "bridge:approvalRequest",
  askUser: "bridge:askUser",
} as const;

/** invoke channels → {request,response}. `void` = no meaningful payload. */
export interface BridgeInvokeMap {
  "bridge:createConversation": { request: CreateConversationRequest; response: ConversationRef };
  "bridge:send": { request: SendRequest; response: void };
  "bridge:interrupt": { request: ConversationRef; response: void };
  "bridge:setModel": { request: SetModelRequest; response: void };
  "bridge:disposeConversation": { request: ConversationRef; response: void };
  "bridge:listProviders": { request: void; response: ProviderSpec[] };
  "bridge:fetchBalance": { request: FetchBalanceRequest; response: BalanceInfo };
  /** Phase 1 (reserved — unimplemented first release). */
  "bridge:usageSummary": { request: UsageSummaryQuery; response: UsageSummary };
  "bridge:approvalDecision": { request: ApprovalDecision; response: void };
  "bridge:askUserAnswer": { request: AskUserAnswer; response: void };
}

/** event channels → push payload (main → renderer). */
export interface BridgeEventMap {
  "bridge:event": LeemoEvent;
  "bridge:approvalRequest": ApprovalRequest;
  "bridge:askUser": AskUserPayload;
}

/** The full set of channel-name string literals (union), for exhaustive host
 *  wiring. */
export type BridgeChannel = (typeof BRIDGE_CHANNELS)[keyof typeof BRIDGE_CHANNELS];
