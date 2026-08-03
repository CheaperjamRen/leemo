import type { SkillInfo } from "../../bridge/contract";

export interface SlashMenuProps {
  /** Already filtered + ordered by the caller (see slash-menu.ts). */
  skills: SkillInfo[];
  selectedIndex: number;
  onPick: (skill: SkillInfo) => void;
  /** Keeps mouse hover and keyboard selection in sync — moving the mouse over a
   *  row makes it THE selection, so Enter never fires a different one. */
  onHover: (index: number) => void;
}

/**
 * The `/` command palette above the input box (轮 2 卡 E).
 *
 * Fully controlled and purely presentational: filtering, selection and the text
 * it produces all live in slash-menu.ts. Renders BARE skill names only — the
 * `leemo:` prefix the SDK needs must never reach a user-visible surface (§二).
 */
export default function SlashMenu({ skills, selectedIndex, onPick, onHover }: SlashMenuProps) {
  if (skills.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-[320px] overflow-y-auto rounded-lg border border-[var(--leemo-line)] bg-white p-1 shadow-lg"
      data-testid="slash-menu"
    >
      <ul role="listbox" aria-label="技能命令">
        {skills.map((skill, index) => (
          <li
            key={skill.qualifiedName}
            role="option"
            aria-selected={index === selectedIndex}
            // Mouse DOWN, not click: the textarea would otherwise lose focus
            // first and the menu could unmount before the click resolved.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(skill);
            }}
            onMouseEnter={() => onHover(index)}
            className={`cursor-pointer rounded-md px-2.5 py-1.5 ${
              index === selectedIndex ? "bg-[var(--leemo-amber-bg)]" : "hover:bg-[var(--leemo-hover)]"
            }`}
          >
            <div className="text-[13px] font-medium text-[var(--leemo-ink)]">/{skill.name}</div>
            {skill.description && (
              <div className="truncate text-[11.5px] text-[var(--leemo-ink-3)]">
                {skill.description}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
