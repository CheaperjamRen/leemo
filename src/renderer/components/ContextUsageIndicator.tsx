import type { ModelContextPolicy } from "../../bridge/contract";
import type { ConversationContextUsage } from "../stores/context-usage";

export interface ContextUsageIndicatorProps {
  usage?: ConversationContextUsage;
  providerId?: string;
  modelId?: string;
  updating?: boolean;
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

function formatReadingTokens(tokens: number, estimated: boolean): string {
  if (!estimated || tokens < 1_000) return formatContextTokens(tokens);
  return tokens >= 1_000_000
    ? formatContextTokens(tokens)
    : `${Math.round(tokens / 1_000)}K`;
}

export default function ContextUsageIndicator({
  usage,
  providerId,
  modelId,
  updating = false,
  policy,
}: ContextUsageIndicatorProps): React.JSX.Element {
  const stale = usage !== undefined
    && ((Boolean(providerId) && usage.providerId !== providerId)
      || (Boolean(modelId) && usage.modelId !== modelId));
  const current = stale ? undefined : usage;
  const capacity = current?.capacityTokens ?? effectiveContextCapacity(policy);
  const configuredMaximum = policy?.contextWindowTokens;
  const runtimeMaximum = current?.rawMaxTokens;
  const modelMaximum = runtimeMaximum ?? configuredMaximum;
  const runtimeMismatch = current !== undefined
    && configuredMaximum !== undefined
    && runtimeMaximum !== undefined
    && configuredMaximum !== runtimeMaximum;
  const used = current === undefined ? undefined : Math.max(0, current.currentTokens);
  const percent = used !== undefined && capacity
    ? Math.min(100, Math.round((used / capacity) * 100))
    : undefined;
  const remaining = used !== undefined && capacity !== undefined
    ? Math.max(0, capacity - used)
    : undefined;
  const estimated = current?.accuracy === "estimated";
  const approximate = estimated ? "约" : "";
  const baseAccessibleLabel = stale
    ? "上下文等待新模型更新"
    : current === undefined
      ? updating ? "上下文正在更新" : "上下文尚未读取"
      : percent === undefined
        ? `上下文${approximate}已用 ${formatContextTokens(used ?? 0)}`
        : `上下文${approximate}已用 ${percent}%${remaining === undefined ? "" : `，整理前${approximate}剩 ${formatContextTokens(remaining)}`}`;
  const accessibleLabel = runtimeMismatch
    ? `${baseAccessibleLabel}，设置目标 ${formatContextTokens(configuredMaximum)}，当前运行 ${formatContextTokens(runtimeMaximum)}`
    : baseAccessibleLabel;
  const ringDegrees = percent === undefined ? 0 : percent * 3.6;
  const pendingCopy = stale
    ? "模型已切换，下一条消息后更新"
    : updating
      ? "正在读取本轮背景信息"
      : "尚未读取当前话题的背景信息 · 等待首轮确认";

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
            background: current && capacity
              ? `conic-gradient(var(--leemo-amber-strong) ${ringDegrees}deg, var(--leemo-line) ${ringDegrees}deg)`
              : "conic-gradient(var(--leemo-line) 0deg 300deg, transparent 300deg)",
          }}
        >
          <span className="absolute inset-[3px] rounded-full bg-[var(--leemo-card)]" />
        </span>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 z-[80] w-max max-w-[240px] -translate-x-1/2 rounded-[14px] bg-[var(--leemo-surface-inverse)] px-4 py-3 text-center text-[var(--leemo-text-on-inverse)] opacity-0 shadow-[var(--leemo-shadow-popover)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="block text-[12px] text-[var(--leemo-text-on-inverse-muted)]">当前话题背景</span>
        {current === undefined ? (
          <span className="mt-1 block text-[13px] font-medium text-[var(--leemo-text-on-inverse)]">{pendingCopy}</span>
        ) : (
          <>
            {percent !== undefined && (
              <span className="mt-0.5 block text-[14px] text-[var(--leemo-text-on-inverse-muted)]">{approximate}{percent}% 已用</span>
            )}
            <span className="mt-1 block text-[13.5px] font-medium">
              {capacity
                ? `${estimated ? "约 " : ""}${formatReadingTokens(used ?? 0, estimated)} / ${formatContextTokens(capacity)}`
                : `${approximate}已用 ${formatReadingTokens(used ?? 0, estimated)}`}
            </span>
            {remaining !== undefined && (
              <span className="mt-1 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">
                整理前{approximate}剩 {formatContextTokens(remaining)}
              </span>
            )}
            {updating && <span className="mt-1 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">本轮更新中</span>}
            {current.justCompacted && <span className="mt-1 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">刚刚整理过</span>}
          </>
        )}
        {runtimeMismatch && (
          <>
            <span className="mt-1.5 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">设置目标 {formatContextTokens(configuredMaximum)}</span>
            <span className="mt-0.5 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">当前运行上限 {formatContextTokens(runtimeMaximum)}</span>
          </>
        )}
        {!runtimeMismatch && current === undefined && configuredMaximum && (
          <span className="mt-1.5 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">设置目标 {formatContextTokens(configuredMaximum)}</span>
        )}
        {!runtimeMismatch && current !== undefined && modelMaximum && modelMaximum !== capacity && (
          <span className="mt-1 block text-[11px] text-[var(--leemo-text-on-inverse-muted)]">模型上限 {formatContextTokens(modelMaximum)}</span>
        )}
      </span>
    </span>
  );
}
