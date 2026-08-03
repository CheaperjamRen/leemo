import type { SkillInfo } from "../../bridge/contract";
import { applySlashPick } from "./slash-menu";

const CHIPS = ["帮我规划今天", "继续昨天的复习", "随便聊聊"];

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
];

/** How many skill chips may ride along behind the three starters. The row is
 *  centred under the greeting; more than this and it wraps into a second line
 *  that competes with the input box for attention. */
const MAX_SKILL_CHIPS = 3;

export default function ChipRow({
  onPick,
  skills = [],
  disabled = false,
}: {
  onPick: (text: string) => void;
  /** ENABLED skills. Empty (the zero-skill case) renders exactly the old row. */
  skills?: SkillInfo[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5 py-3">
      {CHIPS.map((c, i) => (
        <button key={c} onClick={() => onPick(c)} disabled={disabled}
          className="leemo-chip flex items-center gap-1.5 rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-card)]/75 px-3.5 py-[7px] text-[12.5px] text-[var(--leemo-ink-2)] backdrop-blur disabled:cursor-wait disabled:opacity-45">
          {CHIP_ICONS[i]}
          {c}
        </button>
      ))}
      {skills.slice(0, MAX_SKILL_CHIPS).map((skill) => (
        <button
          key={skill.qualifiedName}
          onClick={() => onPick(applySlashPick(skill))}
          disabled={disabled}
          title={skill.description}
          aria-label={`触发技能 ${skill.name}`}
          className="leemo-chip flex items-center gap-1.5 rounded-full border border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-bg)]/75 px-3.5 py-[7px] text-[12.5px] text-[var(--leemo-ink-2)] backdrop-blur disabled:cursor-wait disabled:opacity-45"
        >
          {/* Bare name only — the leemo: prefix is internal (卡 E §二). */}
          /{skill.name}
        </button>
      ))}
    </div>
  );
}
