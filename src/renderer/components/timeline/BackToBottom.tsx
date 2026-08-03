export default function BackToBottom({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button type="button" aria-label="回到底部" onClick={onClick}
      className="leemo-fab absolute bottom-4 right-4 z-20 grid h-9 w-9 place-items-center rounded-full border border-[var(--leemo-line-2)] bg-[var(--leemo-card)] text-[var(--leemo-ink-2)] hover:text-[var(--leemo-ink)] animate-[fadeIn_.2s_ease]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[15px] w-[15px]" aria-hidden>
        <path d="M12 5v14" /><path d="m5 12 7 7 7-7" />
      </svg>
    </button>
  );
}
