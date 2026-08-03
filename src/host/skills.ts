// Leemo — Skills discovery & plugin scaffold (启动轮 2 卡 E).
//
// WHY THIS EXISTS: Skills were not working AT ALL. 卡 A froze
// `settingSources: []` (方案 C) to keep the user's personal ~/.claude out of
// momo's context, and four rounds of real-SDK probing showed that flag also
// switches Skills discovery off — `skills:'all'` does not bring it back, and the
// discovery path has nothing to do with CLAUDE_CONFIG_DIR either.
//
// THE DECIDED FIX (方案 G, 实证): hand the engine an explicit LOCAL PLUGIN whose
// path is <memoryDir>/.leemo. `plugins` takes an absolute path, is independent
// of `cwd`, and works with `settingSources: []` untouched — so both load-bearing
// boundaries survive:
//   • the Phase 0 sandbox stays `cwd` (the model still cannot wander), and
//   • unrelated engine-level user settings and skills stay OUT of momo's
//     context. Omitting settingSources would have pulled all of them in — 15
//     skills → 45. That was rejected as a privacy / blast-radius problem.
// Leemo owns the user-facing product path. Skills therefore live at
// <memoryDir>/.leemo/skills/<name>/SKILL.md: user-visible, editable and
// draggable without exposing an implementation-provider directory as product
// vocabulary. The required `.claude-plugin` manifest remains an internal file.
//
// NAMING 铁律 (see SkillInfo in contract.ts): CC addresses plugin skills as
// `<plugin>:<skill>`, but the user must never see that prefix. This module is
// the single normalization point — it emits a bare `name` for the UI and a
// separate `qualifiedName` for the SDK, and drops any skill whose frontmatter
// name contains ':' rather than rendering a mangled label.

import type { SkillInfo } from "../bridge/contract";
import { parseSkillFrontmatterFields } from "./skill-frontmatter";

export type { SkillInfo };

/** Plugin manifest name. Without `.claude-plugin/plugin.json` the engine falls
 *  back to the directory name and qualified names become `.claude:<skill>` —
 *  ugly, and brittle if the layout ever moves. Pinned here. */
export const LEEMO_PLUGIN_NAME = "leemo";

/** Synchronous fs seam. Injected so this module is unit-testable with no real
 *  filesystem and stays platform/transport agnostic (mirrors MemoryBankIO). */
export interface SkillsIO {
  /** Entry names (not full paths) directly under `dir`. Throws when absent. */
  readdir(dir: string): string[];
  /** UTF-8 file contents. Throws when absent/unreadable. */
  readFile(path: string): string;
  exists(path: string): boolean;
  /** Only ever used to create the plugin manifest, never to overwrite one. */
  writeFile(path: string, contents: string): void;
  mkdirp(dir: string): void;
  /** Mutations are optional for legacy user-skill scanners. Built-in runtime
   * materialization requires both and fails closed when either is absent. */
  remove?(path: string): void;
  rename?(from: string, to: string): void;
}

/** Keep the caller's separator style (Windows backslash / posix slash) so paths
 *  we hand to the SDK and to the prompt are ones the OS actually accepts —
 *  same discipline as momo-prompt.ts layer ⑥ and memory-bank.ts. */
function sepOf(dir: string): string {
  return dir.includes("\\") ? "\\" : "/";
}

function join(base: string, ...parts: string[]): string {
  return [base, ...parts].join(sepOf(base));
}

/** The plugin directory handed to the SDK as `plugins:[{type:'local',path}]`. */
export function pluginRootFor(memoryDir: string): string {
  return join(memoryDir, ".leemo");
}

/** Where the user's SKILL.md folders live (06 §3.6). */
export function skillsRootFor(memoryDir: string): string {
  return join(memoryDir, ".leemo", "skills");
}

/** Minimal frontmatter reader: take the leading `---` fenced block and read
 *  `key: value` lines. Deliberately NOT a YAML dependency — we need exactly two
 *  scalar fields, and a parser we own cannot surprise us on a user's hand-edited
 *  file. Returns undefined when there is no closed frontmatter block at all. */
function parseFrontmatter(raw: string): Record<string, string> | undefined {
  return parseSkillFrontmatterFields(raw);
}

function optionalCategoryField(value: string | undefined, maxLength: number): string | undefined {
  const clean = value?.trim();
  if (!clean || clean.length > maxLength || /[\u0000-\u001f]/.test(clean)) return undefined;
  return clean;
}

/**
 * Scan `<skillsRoot>/<dir>/SKILL.md` and report every skill that is actually
 * loadable, sorted by bare name for a stable UI order.
 *
 * Resilience is the point: one hand-edited file must never blank the whole
 * list. A missing root, an unreadable file, a subdirectory holding notes or
 * assets instead of a SKILL.md, absent/unterminated frontmatter, a missing
 * `name` — each is skipped individually and the scan continues. A missing
 * `description` is NOT a reason to skip (it becomes "").
 */
export function scanSkills(skillsRoot: string, pluginName: string, io: SkillsIO): SkillInfo[] {
  // Absent root is the normal first-run state (and what the user sees if they
  // delete the folder): no skills, no error, chat unaffected.
  if (!io.exists(skillsRoot)) return [];

  let entries: string[];
  try {
    entries = io.readdir(skillsRoot);
  } catch {
    return [];
  }

  const found: SkillInfo[] = [];
  for (const entry of entries) {
    const dir = join(skillsRoot, entry);
    const file = join(dir, "SKILL.md");
    if (!io.exists(file)) continue; // README / assets folder, not a skill

    let fields: Record<string, string> | undefined;
    try {
      fields = parseFrontmatter(io.readFile(file));
    } catch {
      continue; // unreadable: bad encoding, EACCES, vanished mid-scan
    }
    if (!fields) continue;

    const name = fields.name?.trim();
    // No name = the SDK could not address this skill either, so listing it
    // would promise a card that can never fire.
    if (!name) continue;
    // A ':' in the name would BOTH leak prefix-shaped text into the UI and
    // collide with CC's plugin:skill qualification. Skip rather than mangle —
    // this keeps `SkillInfo.name` colon-free as an absolute invariant.
    if (name.includes(":")) continue;

    found.push({
      name,
      description: fields.description?.trim() ?? "",
      qualifiedName: `${pluginName}:${name}`,
      dir,
      source: "user",
      ...(optionalCategoryField(fields.category, 48) ? {
        category: optionalCategoryField(fields.category, 48),
      } : {}),
      ...(optionalCategoryField(fields["category-label"] ?? fields.category_label, 32) ? {
        categoryLabel: optionalCategoryField(fields["category-label"] ?? fields.category_label, 32),
      } : {}),
    });
  }

  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The manifest we write on first run. `name` is what makes qualified names read
 *  `leemo:<skill>`; description/version are cosmetic but make the file legible
 *  to a user who opens it. */
function manifestJson(): string {
  return `${JSON.stringify(
    {
      name: LEEMO_PLUGIN_NAME,
      description: "Leemo 用户安装和自建的技能目录",
      version: "1.0.0",
    },
    null,
    2,
  )}\n`;
}

/**
 * Make sure `<memoryDir>/.leemo` is a valid local plugin: create
 * `.claude-plugin/plugin.json` and the `skills/` directory. Idempotent.
 *
 * HARD RULE (same as 卡 B's ensureMemoryBank): an EXISTING plugin.json is the
 * user's file and is never read, compared, or overwritten — they may have
 * renamed or annotated it. We only ever create the missing one.
 */
export function ensureSkillsPlugin(memoryDir: string, io: SkillsIO): void {
  const pluginRoot = pluginRootFor(memoryDir);
  const manifestDir = join(pluginRoot, ".claude-plugin");
  const manifest = join(manifestDir, "plugin.json");

  // skills/ first: it is the directory the user drops folders into, and prompt
  // layer ⑥ hands momo its absolute path, so it must exist even when the
  // manifest is already there.
  io.mkdirp(skillsRootFor(memoryDir));

  if (io.exists(manifest)) return;
  io.mkdirp(manifestDir);
  io.writeFile(manifest, manifestJson());
}
