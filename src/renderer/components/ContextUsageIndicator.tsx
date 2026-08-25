import type { ModelContextPolicy } from "../../bridge/contract";

export interface ContextUsageIndicatorProps {
  currentTokens: number;
  capacityTokens?: number;
  rawMaxTokens?: number;
  policy?: ModelContextPolicy;
}

export function effectiveContextCapacity(policy: ModelContextPolicy | undefined): number | undefined {
  if (!policy) return undefined;
  const requested = policy.autoCompactWindowTokens ?? policy.contextWindowTokens;
  if (!requested || requested <= 0) return undefined;
  return policy.contextWindowTokens
    ? Math.min(requested, policy.contextWindowTokens)
    : requested;
}

export function formatContextTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  if (tokens >= 100_000) return `${Math.round(tokens / 1_000)}K`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.max(0, Math.round(tokens)));
}

export default function ContextUsageIndicator({
  currentTokens,
  capacityTokens,
  rawMaxTokens,
  policy,
}: ContextUsageIndicatorProps): React.JSX.Element {
  const used = Math.max(0, currentTokens);
  const capacity = capacityTokens ?? effectiveContextCapacity(policy);
  const modelMaximum = rawMaxTokens ?? policy?.contextWindowTokens;
  const percent = capacity ? Math.min(100, Math.round((used / capacity) * 100)) : undefined;
  const accessibleLabel = percent === undefined
    ? `上下文已用 ${formatContextTokens(used)}，容量自动识别`
    : `上下文已用 ${percent}%`;
  const ringDegrees = percent === undefined ? 0 : percent * 3.6;

  return (
    <span className="leemo-context-meter group relative inline-grid h-8 w-7 shrink-0 place-items-center">
      <button
        type="button"
        aria-label={accessibleLabel}
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--leemo-ink-3)] outline-none transition-colors hover:bg-[var(--leemo-hover)] focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-soft)]"
      >
        <span
          aria-hidden="true"
          className="relative block h-[18px] w-[18px] rounded-full"
          style={{
            background: capacity
              ? `conic-gradient(var(--leemo-amber-strong) ${ringDegrees}deg, var(--leemo-line) ${ringDegrees}deg)`
              : "conic-gradient(var(--leemo-line) 0deg 300deg, transparent 300deg)",
          }}
        >
          <span className="absolute inset-[3px] rounded-full bg-[var(--leemo-card)]" />
        </span>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 z-[80] w-max max-w-[240px] -translate-x-1/2 rounded-[14px] bg-[var(--leemo-ink)] px-4 py-3 text-center text-white opacity-0 shadow-[0_12px_30px_rgba(20,29,36,0.2)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="block text-[12px] text-white/65">背景信息窗口</span>
        {percent !== undefined && <span className="mt-0.5 block text-[14px] text-white/75">{percent}% 已用</span>}
        <span className="mt-1 block text-[13.5px] font-medium">
          {capacity
            ? `已用 ${formatContextTokens(used)}，整理窗口 ${formatContextTokens(capacity)}`
            : `已用 ${formatContextTokens(used)}`}
        </span>
        {modelMaximum && modelMaximum !== capacity ? (
          <span className="mt-1 block text-[11px] text-white/60">模型上限 {formatContextTokens(modelMaximum)}</span>
        ) : !capacity ? (
          <span className="mt-1 block text-[11px] text-white/60">容量由当前模型自动识别</span>
        ) : null}
      </span>
    </span>
  );
}
