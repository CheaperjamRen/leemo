import type { TimelineItem } from "../../stores/message-model";

export default function CompactDivider({ item }: { item: Extract<TimelineItem, { kind: "compact" }> }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[11px] text-[var(--leemo-ink-3)]">
      <span className="h-px flex-1 bg-[var(--leemo-line-2)]" />
      <span className="tabular-nums">上下文已压缩 · {item.preTokens}{item.postTokens !== undefined ? ` → ${item.postTokens}` : ""}</span>
      <span className="h-px flex-1 bg-[var(--leemo-line-2)]" />
    </div>
  );
}
