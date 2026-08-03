import type { TimelineItem } from "../../stores/message-model";

export default function PlanCard({ item }: { item: Extract<TimelineItem, { kind: "plan" }> }) {
  const done = item.todos.filter((t) => t.status === "done").length;
  return (
    <div className="leemo-card-shadow overflow-hidden rounded-[12px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--leemo-line-2)] bg-[var(--leemo-panel)] px-3.5 py-[7px]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
          className="h-[14px] w-[14px] text-[var(--leemo-ink-2)]" aria-hidden>
          <path d="M8.5 6h12" /><path d="M8.5 12h12" /><path d="M8.5 18h12" />
          <path d="m3.2 5.4 1 1 2-2.2" /><path d="m3.2 11.4 1 1 2-2.2" /><path d="m3.2 17.4 1 1 2-2.2" />
        </svg>
        <span className="text-[12.5px] font-medium text-[var(--leemo-ink)]">计划</span>
        <span className="ml-auto text-[11px] tabular-nums text-[var(--leemo-ink-3)]">{done} / {item.todos.length}</span>
      </div>
      <ol className="px-1.5 py-1">
        {item.todos.map((t, i) => (
          <li key={i}
            className={`flex items-center gap-2.5 rounded-[8px] px-2 py-[5px] text-[13px] ${
              t.status === "done"
                ? "text-[var(--leemo-ink-3)]"
                : t.status === "active"
                  ? "bg-[var(--leemo-amber-bg)] font-medium text-[var(--leemo-ink)] ring-1 ring-[var(--leemo-amber-line)]"
                  : "text-[var(--leemo-ink-2)]"
            }`}>
            {t.status === "done" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                className="h-[15px] w-[15px] shrink-0 text-[var(--leemo-ok)]" aria-hidden>
                <path d="m4.8 12.6 4.6 4.6 9.8-10.4" />
              </svg>
            ) : t.status === "active" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                className="h-[15px] w-[15px] shrink-0 leemo-spin text-[var(--leemo-amber)]" aria-hidden>
                <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                className="h-[15px] w-[15px] shrink-0 text-[var(--leemo-ink-3)]" aria-hidden>
                <circle cx="12" cy="12" r="7.5" />
              </svg>
            )}
            <span>{t.text}</span>
            {t.status === "active" && (
              <span className="ml-auto text-[11px] font-normal text-[var(--leemo-amber-ink)]">进行中</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
