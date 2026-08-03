import type { TimelineItem } from "../../stores/message-model";
import MarkdownContent from "../MarkdownContent";

/** SDK 显式返回的过程说明，收在过程折叠卡里，与工具/计划卡按时序交织。 */
export default function ThinkingCard({ item }: { item: Extract<TimelineItem, { kind: "thinking" }> }) {
  return (
    <div className="flex gap-2.5 rounded-[8px] border border-dashed border-[var(--leemo-line-2)] bg-[var(--leemo-panel)]/50 px-3 py-2">
      <span className="mt-[1px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-amber-bg)] text-[var(--leemo-amber)] ring-1 ring-[var(--leemo-amber-line)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
          className="h-[11px] w-[11px]" aria-hidden>
          <path d="M9 18h6" /><path d="M10 21h4" />
          <path d="M12 3a6 6 0 0 0-4 10.5c.5.5.9 1.2 1 2h6c.1-.8.5-1.5 1-2A6 6 0 0 0 12 3Z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1 italic text-[var(--leemo-ink-3)]">
        <MarkdownContent text={item.text} variant="process" />
        {item.streaming && (
          <span aria-hidden
            className="leemo-caret ml-[2px] inline-block h-[12px] w-[2px] translate-y-[2px] rounded-[1px] bg-[var(--leemo-ink-3)]" />
        )}
      </div>
    </div>
  );
}
