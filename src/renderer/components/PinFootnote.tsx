export default function PinFootnote({ text }: { text: string }) {
  return (
    <p className="flex items-center justify-center gap-1.5 py-3 text-[12px] text-[var(--leemo-ink-3)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[12px] w-[12px] text-[var(--leemo-amber)]/70" aria-hidden>
        <path d="M12 21s6.8-6 6.8-10.8a6.8 6.8 0 1 0-13.6 0C5.2 15 12 21 12 21Z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
      {text}
    </p>
  );
}
