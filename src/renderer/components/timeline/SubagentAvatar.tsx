const VARIANTS = [
  ["plain"],
  ["glasses"],
  ["ponytail"],
  ["headphones"],
  ["lollipop"],
  ["glasses", "ponytail"],
  ["glasses", "lollipop"],
  ["headphones", "lollipop"],
] as const;
type Cue = typeof VARIANTS[number][number];

function slotFor(identity: string): number {
  let hash = 0;
  for (const char of identity) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % VARIANTS.length;
}

export default function SubagentAvatar({
  identity,
  size = 28,
  siblingIndex,
}: {
  identity: string;
  size?: number;
  siblingIndex?: number;
}) {
  const slot = siblingIndex ?? slotFor(identity);
  const cues: readonly Cue[] = VARIANTS[slot % VARIANTS.length];
  const marker = siblingIndex !== undefined && siblingIndex >= VARIANTS.length
    ? siblingIndex + 1
    : null;
  const variant = `${cues.join("-")}${marker === null ? "" : `-${marker}`}`;
  const hasCue = (cue: Cue) => cues.includes(cue);
  return (
    <svg
      role="img"
      aria-label={`${identity}头像`}
      data-variant={variant}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className="shrink-0"
    >
      <circle cx="16" cy="16" r="12" fill="var(--leemo-card)" stroke="var(--leemo-ink-2)" strokeWidth="1.6" />
      <circle cx="12" cy="16" r="1.7" fill="var(--leemo-ink)" />
      <circle cx="20" cy="16" r="1.7" fill="var(--leemo-ink)" />
      <circle cx="16" cy="4" r="2" fill="var(--leemo-accent)" />
      {hasCue("glasses") && <g fill="none" stroke="var(--leemo-accent)" strokeWidth="1.4"><circle cx="12" cy="16" r="3.4" /><circle cx="20" cy="16" r="3.4" /><path d="M15.4 16h1.2" /></g>}
      {hasCue("ponytail") && <path d="M27 19c4 2 3 7-1 8-2 .5-3-1-2-2 2-1 2-3 1-5Z" fill="var(--leemo-ink-2)" />}
      {hasCue("headphones") && <g fill="none" stroke="var(--leemo-accent)" strokeWidth="2"><path d="M6 16a10 10 0 0 1 20 0" /><path d="M6 16v5M26 16v5" /></g>}
      {hasCue("lollipop") && <g fill="none" stroke="var(--leemo-accent)" strokeWidth="1.4"><circle cx="7" cy="24" r="2.2" /><path d="m8.6 25.6 2.2 2.2" /></g>}
      {hasCue("plain") && <path d="M7 13v7M25 13v7" stroke="var(--leemo-accent)" strokeWidth="1.8" strokeLinecap="round" />}
      {marker !== null && (
        <text x="24.5" y="28" fontSize="5.5" fontWeight="600" textAnchor="middle" fill="var(--leemo-ink-2)">
          {marker}
        </text>
      )}
    </svg>
  );
}
