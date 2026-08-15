import { toolActionLabel } from "../tool-labels";

export default function LiveStatusBar({ toolName }: { toolName?: string }) {
  if (!toolName) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--leemo-amber-ink)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
        className="h-[11px] w-[11px] leemo-spin text-[var(--leemo-amber)]" aria-hidden>
        <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
      </svg>
      正在{toolActionLabel(toolName)}…
    </span>
  );
}
