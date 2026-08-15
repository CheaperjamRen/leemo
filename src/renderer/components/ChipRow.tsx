const CHIPS = ["帮我规划今天", "继续昨天的复习", "随便聊聊", "帮我理清思路", "一起做个决定"];

const CHIP_ICONS = [
  <svg key="cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="leemo-chip-ico h-[13px] w-[13px] text-[var(--leemo-ink-3)] transition-colors" aria-hidden>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M3.5 10h17" />
    <path d="m9.6 15.2 1.7 1.7 3.1-3.4" />
  </svg>,
  <svg key="book" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="leemo-chip-ico h-[13px] w-[13px] text-[var(--leemo-ink-3)] transition-colors" aria-hidden>
    <path d="M2.8 5.6A9.3 9.3 0 0 1 12 4a9.3 9.3 0 0 1 9.2 1.6v13.2A9.3 9.3 0 0 0 12 17.2a9.3 9.3 0 0 0-9.2 1.6V5.6Z" />
    <path d="M12 4v13.2" />
  </svg>,
  <svg key="coffee" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="leemo-chip-ico h-[13px] w-[13px] text-[var(--leemo-ink-3)] transition-colors" aria-hidden>
    <path d="M4.5 9.5h11.5V14a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5V9.5Z" />
    <path d="M16 10.8h1a2.6 2.6 0 0 1 0 5.2h-1" />
    <path d="M7.5 6.2c0-1 .9-1.1 .9-2.1" />
    <path d="M11.2 6.2c0-1 .9-1.1 .9-2.1" />
  </svg>,
  <svg key="thought" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="leemo-chip-ico h-[13px] w-[13px] text-[var(--leemo-ink-3)] transition-colors" aria-hidden>
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M8.2 14.6A7 7 0 1 1 15.8 14.6c-.8.7-1.3 1.4-1.5 2.2h-4.6c-.2-.8-.7-1.5-1.5-2.2Z" />
  </svg>,
  <svg key="decision" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="leemo-chip-ico h-[13px] w-[13px] text-[var(--leemo-ink-3)] transition-colors" aria-hidden>
    <circle cx="6" cy="12" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="18" cy="18" r="2" />
    <path d="M8 12h2.5c3 0 3.2-6 5.5-6" />
    <path d="M8 12h2.5c3 0 3.2 6 5.5 6" />
  </svg>,
];

export default function ChipRow({
  onPick,
  disabled = false,
}: {
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="leemo-buddy-starter-row flex flex-nowrap items-center justify-center gap-2.5 overflow-hidden py-3">
      {CHIPS.map((c, i) => (
        <button key={c} onClick={() => onPick(c)} disabled={disabled}
          data-priority={i + 1}
          className="leemo-chip flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-card)]/75 px-3.5 py-[7px] text-[12.5px] text-[var(--leemo-ink-2)] backdrop-blur disabled:cursor-wait disabled:opacity-45">
          {CHIP_ICONS[i]}
          {c}
        </button>
      ))}
    </div>
  );
}
