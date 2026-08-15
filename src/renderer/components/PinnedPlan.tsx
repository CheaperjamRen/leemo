import { useState } from "react";
import { useConversations } from "../bridge/context";
import type { TimelineItem } from "../stores/message-model";

export default function PinnedPlan() {
  const [open, setOpen] = useState(false);
  const plan = useConversations((s) => {
    const timeline = s.activeId ? s.timelines[s.activeId] : undefined;
    const activeRunId = s.activeId ? s.runIds[s.activeId] : null;
    if (!timeline || !activeRunId) return undefined;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const it = timeline[i];
      if (it.kind === "plan" && it.runId === activeRunId) {
        return it as Extract<TimelineItem, { kind: "plan" }>;
      }
    }
    return undefined;
  });
  if (!plan) return null;
  const done = plan.todos.filter((t) => t.status === "done").length;
  return (
    <div className="mx-auto w-full max-w-[640px]">
      <div className="leemo-card-shadow overflow-hidden rounded-[12px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)]">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-[12.5px] text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-panel)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
            className={`h-[12px] w-[12px] text-[var(--leemo-ink-3)] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
            <path d="m9.2 6 6 6-6 6" />
          </svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
            className="h-[13px] w-[13px] text-[var(--leemo-ink-2)]" aria-hidden>
            <path d="M8.5 6h12" /><path d="M8.5 12h12" /><path d="M8.5 18h12" />
            <path d="m3.2 5.4 1 1 2-2.2" /><path d="m3.2 11.4 1 1 2-2.2" /><path d="m3.2 17.4 1 1 2-2.2" />
          </svg>
          <span className="font-medium text-[var(--leemo-ink)]">当前任务</span>
          <span className="ml-auto text-[11px] tabular-nums text-[var(--leemo-ink-3)]">{done} / {plan.todos.length}</span>
        </button>
        {open && (
          <ol className="border-t border-[var(--leemo-line-2)] px-1.5 py-1">
            {plan.todos.map((t, i) => (
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
                    className="h-[14px] w-[14px] shrink-0 text-[var(--leemo-ok)]" aria-hidden>
                    <path d="m4.8 12.6 4.6 4.6 9.8-10.4" />
                  </svg>
                ) : t.status === "active" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                    className="h-[14px] w-[14px] shrink-0 leemo-spin text-[var(--leemo-amber)]" aria-hidden>
                    <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
                    className="h-[14px] w-[14px] shrink-0 text-[var(--leemo-ink-3)]" aria-hidden>
                    <circle cx="12" cy="12" r="7.5" />
                  </svg>
                )}
                <span>{t.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
