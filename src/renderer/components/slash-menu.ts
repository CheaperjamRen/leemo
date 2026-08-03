// Pure logic behind the `/` command menu (轮 2 卡 E). Kept out of the component
// so the parts that can actually be wrong — when the menu is open, what it
// matches, where the cursor goes, what text lands in the box — are unit tested,
// while the JSX stays a dumb controlled view (前端逻辑要测 / 视觉目验).

import type { SkillInfo } from "../../bridge/contract";

/** A leading `/` followed by the first word, with no whitespace yet. Anchored at
 *  the very start: a slash inside a sentence (a path, a date) is not a command. */
const SLASH = /^\/(\S*)$/;

/**
 * The query the menu should filter on, or null when the menu must stay closed.
 * Open while the caret is still in the first word (`/`, `/pd`, `/期末`); closed
 * as soon as a space ends it (`/pdf 帮我填表` is an invocation being written, and
 * re-popping the list over it is just noise).
 */
export function parseSlashQuery(value: string): string | null {
  const match = SLASH.exec(value);
  return match ? match[1] : null;
}

/**
 * Skills matching `query`, name matches first. Name is what the user typed
 * toward; the description is a safety net for a half-remembered skill ("那个
 * 突击的"). Case-insensitive, substring-based — CJK names have no word breaks,
 * so prefix-only matching would make them unsearchable.
 */
export function filterSkillsByQuery(skills: SkillInfo[], query: string): SkillInfo[] {
  const needle = query.trim().toLowerCase();
  // Keep this boundary defensive as well as the shell-level projection: a
  // fixture, future surface, or stale renderer must never offer a capability
  // the catalog has explicitly marked unavailable.
  const available = skills.filter((skill) => skill.available !== false);
  if (!needle) return [...available];

  const byName: SkillInfo[] = [];
  const byDescription: SkillInfo[] = [];
  for (const skill of available) {
    if (skill.name.toLowerCase().includes(needle)
      || skill.commandName?.toLowerCase().includes(needle)) byName.push(skill);
    else if (skill.description.toLowerCase().includes(needle)) byDescription.push(skill);
  }
  return [...byName, ...byDescription];
}

/** Move the highlighted row by `delta`, wrapping at both ends. Also normalizes
 *  an index left over from a longer list (the filtered list shrinks as the user
 *  keeps typing), so navigation never lands on a row that isn't rendered. */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  const from = current >= length || current < 0 ? (delta > 0 ? -1 : 0) : current;
  return (((from + delta) % length) + length) % length;
}

/** The draft text a picked skill produces. BARE name by design (卡 E §二): the
 *  user installed `pdf`, so the command is `/pdf`. 实测 confirms bare-name slash
 *  commands fire, so nothing here needs the internal `leemo:` prefix. */
export function applySlashPick(skill: SkillInfo): string {
  return `/${skill.commandName ?? skill.name} `;
}
