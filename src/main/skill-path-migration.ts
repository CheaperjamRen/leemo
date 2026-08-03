import fs from "node:fs";
import path from "node:path";

export interface LegacySkillMigrationResult {
  copied: number;
  skipped: number;
  failed: number;
}

/**
 * Copy legacy `<workspace>/.claude/skills/*` folders into Leemo's product-owned
 * `.leemo/skills` root. The old tree is never deleted and an existing target is
 * never overwritten. Each copy lands through a sibling staging directory so a
 * crash cannot expose a half-copied Skill to discovery.
 */
export function migrateLegacySkills(workspaceRoot: string): LegacySkillMigrationResult {
  const legacyRoot = path.join(workspaceRoot, ".claude", "skills");
  const targetRoot = path.join(workspaceRoot, ".leemo", "skills");
  const result: LegacySkillMigrationResult = { copied: 0, skipped: 0, failed: 0 };
  if (!fs.existsSync(legacyRoot)) return result;

  fs.mkdirSync(targetRoot, { recursive: true });
  for (const entry of fs.readdirSync(legacyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const source = path.join(legacyRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (fs.existsSync(target)) {
      result.skipped += 1;
      continue;
    }
    const staging = path.join(targetRoot, `.${entry.name}.migrating-${process.pid}`);
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
      fs.renameSync(staging, target);
      result.copied += 1;
    } catch {
      fs.rmSync(staging, { recursive: true, force: true });
      result.failed += 1;
    }
  }
  return result;
}
