// Per-provider behavior switches for the translation core.
//
// G3's shell resolves one ProviderOpts per registered upstream (DeepSeek / GLM /
// relay endpoint …) and hands it to translate.anthropicToOpenAI. The three
// fields named by the G2 card are the load-bearing switches:
//   - reasoningInjection: gate the vendor's reasoning injection (pitfall ⑨ /
//     LEEMO-PATCH ①). 'off' for providers that don't understand reasoning.
//   - includeUsage: whether streaming requests set stream_options.include_usage
//     (pitfall ⑩). Some OpenAI-compat endpoints choke on it.
//   - maxTokensCap: optional hard clamp on max_tokens (pitfall ⑥).
// The remaining optionals drive normalizeThinking (⑨ budget) and the ⑥
// max_completion_tokens rename; they are additive and default to safe values.

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderOpts {
  /** Gate for the vendor reasoning injection (LEEMO-PATCH ①). Default 'auto'. */
  reasoningInjection: "auto" | "off";
  /** Force stream_options.include_usage on streaming requests. Default true. */
  includeUsage: boolean;
  /** Hard upper bound for max_tokens; omitted = no cap. */
  maxTokensCap?: number;
  /** Whether the target model actually supports thinking/reasoning. Default true. */
  thinkingCapability?: boolean;
  /** Desired reasoning effort → budget via EFFORT_BUDGET_MAP. Default undefined → default budget. */
  thinkingEffort?: EffortLevel;
  /** Which key carries the token cap on the wire. Newer OpenAI models want
   *  max_completion_tokens; classic chat/completions wants max_tokens. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** Flatten anyOf/oneOf/$ref/$defs out of tool schemas (GLM, pitfall ⑪). */
  flattenSchemas?: boolean;
  /** Streaming usage recovery (B0). The vendor drops upstream usage frames that
   *  arrive in the SAME network read as finish_reason (its inner loop breaks on
   *  finish_reason), and hardcodes message_start.input_tokens=0. So a first-party
   *  transform over the vendor's Anthropic stream ALWAYS passes REAL upstream
   *  usage through to the terminal message_delta (never double-counting). This
   *  switch only gates the O200K FALLBACK when no upstream usage frame exists:
   *    - 'auto' (default): backfill message_start.input_tokens (o200k of request)
   *      + terminal message_delta.output_tokens (o200k of accumulated output),
   *      and mark the terminal usage `leemo_estimated:true` so B2 sets estimated.
   *    - 'off': no o200k fallback; leave the vendor's zeros. Real passthrough
   *      still applies when an upstream usage frame is present. */
  usageBackfill?: "auto" | "off";
}

/** Field-complete defaults; a bare `{}` from a caller resolves to these. */
export const DEFAULT_PROVIDER_OPTS: ProviderOpts = {
  reasoningInjection: "auto",
  includeUsage: true,
  maxTokensField: "max_tokens",
  thinkingCapability: true,
  usageBackfill: "auto",
};

/** Merge caller-supplied opts over the defaults (missing keys → defaults). */
export function resolveProviderOpts(opts?: Partial<ProviderOpts>): ProviderOpts {
  return { ...DEFAULT_PROVIDER_OPTS, ...(opts ?? {}) };
}
