import type { TimelineItem } from "../../stores/message-model";

export default function PlanCard({ item }: { item: Extract<TimelineItem, { kind: "plan" }> }) {
  return (
    <section data-testid="plan-card" aria-label="任务计划" className="leemo-plan-region overflow-hidden">
      <ol className="divide-y divide-[var(--leemo-line-soft)]">
        {item.todos.map((t, i) => (
          <li key={i}
            className={`leemo-plan-region__row flex min-h-[36px] items-center gap-2.5 px-2.5 py-1.5 text-[12.5px] ${
              t.status === "done"
                ? "is-done text-[var(--leemo-ink-3)]"
                : t.status === "active"
                  ? "is-active font-medium text-[var(--leemo-ink)]"
                  : "is-todo text-[var(--leemo-ink-2)]"
            }`}>
            {t.status === "done" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                className="h-[15px] w-[15px] shrink-0 text-[var(--leemo-amber)]" aria-hidden>
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
    </section>
  );
}
