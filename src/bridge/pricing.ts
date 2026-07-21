// Leemo Bridge — model pricing table + lookup (Task B2).
//
// Placeholder constant table: 占位常量，正式维护随 Provider 目录 = Phase 1（届时
// Provider 目录会把真实价目喂给 overrides，这张内置表只是首发兜底）。
//
// Every price below was looked up against the vendor's own official pricing
// page/docs (not a third-party aggregator) and is cited with URL + query
// date in docs/sdd/br-b2-report.md. Models whose real price could not be
// confidently confirmed (e.g. a relay/中转站's resale rate, which is NOT the
// upstream vendor's list price) are simply absent from this table — callers
// get `undefined` and events.ts's buildUsageRecord falls through to
// costSource='unpriced'. Do not fill in a guessed number here.
//
// Units: USD per 1,000,000 tokens (inputPerMTok/outputPerMTok/cacheReadPerMTok).
// CNY-quoted vendor prices were converted at the USD/CNY rate cited alongside
// them (also dated in the report) since UsageRecord.costUsd is USD-denominated.

/** Per-model pricing, USD per 1,000,000 tokens. cacheReadPerMTok defaults to
 *  inputPerMTok (per the brief's cost formula) when the vendor doesn't quote
 *  a separate cache-hit rate. */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
}

/** Key = `${providerId}:${modelId}`. */
type PricingTable = Record<string, ModelPricing>;

// Built-in placeholder table. See docs/sdd/br-b2-report.md for the full
// value+URL+date citation per row; short pointers kept inline below so the
// source is visible without cross-referencing.
const BUILTIN_PRICING: PricingTable = {
  // DeepSeek: .env DEEPSEEK_MODEL=deepseek-chat, which currently aliases to
  // deepseek-v4-flash (non-thinking). Official pricing page:
  // https://api-docs.deepseek.com/quick_start/pricing (fetched 2026-07-21).
  "deepseek:deepseek-chat": {
    inputPerMTok: 0.14, // cache-miss input
    outputPerMTok: 0.28,
    cacheReadPerMTok: 0.0028, // cache-hit input
  },

  // GLM-5.2: .env GLM_MODEL=glm-5.2. Official pricing rendered from
  // https://open.bigmodel.cn/pricing (JS SPA; fetched via rendered browser
  // snapshot 2026-07-21) — CNY 8/28/2 per M tokens (input/output/cache-hit),
  // converted at USD/CNY=6.7669 (https://api.frankfurter.app, ECB-sourced,
  // rate dated 2026-07-20; fetched 2026-07-21).
  "glm:glm-5.2": {
    inputPerMTok: 8 / 6.7669,
    outputPerMTok: 28 / 6.7669,
    cacheReadPerMTok: 2 / 6.7669,
  },

  // Kimi k2.5: .env KIMI_MODEL=kimi-k2.5. Official pricing:
  // https://platform.moonshot.cn/docs/pricing/chat-k25 (fetched 2026-07-21)
  // — CNY 4.00/21.00/0.70 per M tokens (cache-miss-input/output/cache-hit),
  // same USD/CNY=6.7669 conversion as above.
  "kimi:kimi-k2.5": {
    inputPerMTok: 4.0 / 6.7669,
    outputPerMTok: 21.0 / 6.7669,
    cacheReadPerMTok: 0.7 / 6.7669,
  },

  // relay2's gpt-5.6-luna: DELIBERATELY ABSENT. OpenAI's own list price for
  // gpt-5.6-luna is public ($1/$6 per M), but Leemo's RELAY2 provider is a
  // third-party relay (中转站) reselling at its own (unpublished) rate — the
  // relay's actual billed price to us is not the upstream vendor's price and
  // could not be confirmed from any relay-side document. Per the brief:
  // "查不到的...→ 该 model 不进表". costSource falls through to 'unpriced'.
};

/**
 * Resolve pricing for a provider+model, checking `overrides` first (Phase 1's
 * live Provider-catalog injection point) and falling back to the built-in
 * placeholder table. Returns `undefined` on a miss in both — callers must
 * treat that as costSource='unpriced', never fabricate a rate.
 */
export function resolvePricing(
  providerId: string,
  modelId: string,
  overrides?: Record<string, ModelPricing>
): ModelPricing | undefined {
  const key = `${providerId}:${modelId}`;
  if (overrides && key in overrides) return overrides[key];
  return BUILTIN_PRICING[key];
}
