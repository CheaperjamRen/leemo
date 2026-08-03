export default function LightArtifactCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="leemo-card-shadow leemo-rise group mx-auto flex w-full max-w-[430px] items-center gap-3.5 rounded-2xl border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--leemo-amber-soft)] hover:shadow-[0_2px_4px_rgba(96,74,38,.06),0_18px_40px_-16px_rgba(96,74,38,.24)]"
      style={{ animationDelay: ".34s" }}
    >
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--leemo-amber-soft)] text-[var(--leemo-amber)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[19px] w-[19px]">
          <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z" />
          <path d="M13.5 3v5.5H19" />
          <path d="M9 13.2h6" />
          <path d="M9 16.6h4" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-[var(--leemo-ink)]">{title}</span>
        <span className="mt-[3px] block text-[12px] text-[var(--leemo-ink-3)]">{subtitle}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--leemo-amber)]">
        去工作台查看
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[13px] w-[13px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden>
          <path d="M4.5 12h15" />
          <path d="m13.5 6 6 6-6 6" />
        </svg>
      </span>
    </div>
  );
}
