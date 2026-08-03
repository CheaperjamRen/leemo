import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacySkills } from "../../src/main/skill-path-migration";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-skill-path-test-"));
  roots.push(root);
  return root;
}

function writeSkill(root: string, name: string, body: string): void {
  const skill = path.join(root, name);
  fs.mkdirSync(path.join(skill, "assets"), { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), body, "utf8");
  fs.writeFileSync(path.join(skill, "assets", "data.bin"), Buffer.from([0, 1, 2, 255]));
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("legacy Skill path migration", () => {
  it("copies every non-conflicting legacy Skill into .leemo without deleting the source", () => {
    const workspace = tempRoot();
    const legacy = path.join(workspace, ".claude", "skills");
    const target = path.join(workspace, ".leemo", "skills");
    writeSkill(legacy, "research", "legacy research");

    expect(migrateLegacySkills(workspace)).toEqual({ copied: 1, skipped: 0, failed: 0 });
    expect(fs.readFileSync(path.join(target, "research", "SKILL.md"), "utf8")).toBe("legacy research");
    expect(fs.readFileSync(path.join(target, "research", "assets", "data.bin")))
      .toEqual(Buffer.from([0, 1, 2, 255]));
    expect(fs.readFileSync(path.join(legacy, "research", "SKILL.md"), "utf8")).toBe("legacy research");
  });

  it("never overwrites a Skill already owned by .leemo", () => {
    const workspace = tempRoot();
    const legacy = path.join(workspace, ".claude", "skills");
    const target = path.join(workspace, ".leemo", "skills");
    writeSkill(legacy, "same", "legacy");
    writeSkill(target, "same", "current");

    expect(migrateLegacySkills(workspace)).toEqual({ copied: 0, skipped: 1, failed: 0 });
    expect(fs.readFileSync(path.join(target, "same", "SKILL.md"), "utf8")).toBe("current");
    expect(fs.readFileSync(path.join(legacy, "same", "SKILL.md"), "utf8")).toBe("legacy");
  });

  it("is an idempotent no-op when the legacy directory does not exist", () => {
    expect(migrateLegacySkills(tempRoot())).toEqual({ copied: 0, skipped: 0, failed: 0 });
  });
});
