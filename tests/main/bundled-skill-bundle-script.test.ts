import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const script = path.join(root, "scripts", "verify-bundled-skills.mjs");
const tempRoots: string[] = [];

function tempRoot(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-bundled-skill-script-"));
  tempRoots.push(target);
  fs.mkdirSync(path.join(target, "default-enabled"), { recursive: true });
  fs.mkdirSync(path.join(target, "optional"), { recursive: true });
  return target;
}

function writeSkill(target: string, group: "default-enabled" | "optional", directory: string, name = directory): void {
  const skillRoot = path.join(target, group, directory);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} performs a concrete workflow.\n---\n\n# ${name}\n`,
    "utf8",
  );
}

function run(target: string) {
  return spawnSync(process.execPath, [script, target], { encoding: "utf8" });
}

afterEach(() => {
  for (const target of tempRoots.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe("bundled Skill build validator", () => {
  it("reports deterministic inventory data without a hardcoded skill-name list", () => {
    const target = tempRoot();
    writeSkill(target, "default-enabled", "one", "first-skill");
    writeSkill(target, "optional", "two", "second-skill");
    fs.writeFileSync(path.join(target, "catalog.json"), JSON.stringify({
      version: 1,
      skills: { one: { sourceLabel: "Example" }, two: { sourceLabel: "Example" } },
    }), "utf8");

    const result = run(target);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      groups: { defaultEnabled: 1, optional: 1 },
      skillCount: 2,
      skills: ["one", "two"],
    });
    expect(JSON.parse(result.stdout).files).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(result.stdout).sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects malformed skills, duplicate trigger names, caches and catalog drift", () => {
    const malformed = tempRoot();
    fs.mkdirSync(path.join(malformed, "default-enabled", "broken"), { recursive: true });
    expect(run(malformed).stderr).toMatch(/SKILL\.md/u);

    const duplicate = tempRoot();
    writeSkill(duplicate, "default-enabled", "one", "same");
    writeSkill(duplicate, "optional", "two", "same");
    expect(run(duplicate).stderr).toMatch(/触发名重复/u);

    const cache = tempRoot();
    writeSkill(cache, "default-enabled", "one");
    fs.mkdirSync(path.join(cache, "default-enabled", "one", "node_modules"));
    expect(run(cache).stderr).toMatch(/node_modules/u);

    const drift = tempRoot();
    fs.writeFileSync(path.join(drift, "catalog.json"), JSON.stringify({
      version: 1,
      skills: { missing: { sourceLabel: "Ghost" } },
    }), "utf8");
    expect(run(drift).stderr).toMatch(/missing/u);

    const duplicateDisplay = tempRoot();
    writeSkill(duplicateDisplay, "default-enabled", "one");
    writeSkill(duplicateDisplay, "optional", "two");
    fs.writeFileSync(path.join(duplicateDisplay, "catalog.json"), JSON.stringify({
      version: 1,
      skills: {
        one: { displayName: "同名技能" },
        two: { displayName: "同名技能" },
      },
    }), "utf8");
    expect(run(duplicateDisplay).stderr).toMatch(/展示名称重复/u);
  });

  it("locks the current release inventory while allowing future folders without code changes", () => {
    const result = run(path.join(root, "bundled-skills"));

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      groups: { defaultEnabled: 8, optional: 17 },
      skillCount: 25,
    });
  });
});
