import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUNDLED_SKILL_PLUGIN_NAME,
  discoverBundledSkills,
  bundledSkillMetadata,
} from "../../src/host/bundled-skills";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-bundled-skills-test-"));
  roots.push(root);
  return root;
}

function writeSkill(
  root: string,
  group: "default-enabled" | "optional",
  directory: string,
  name = directory,
  extraFrontmatter = "",
): string {
  const skillRoot = path.join(root, group, directory);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} does one real job.\n${extraFrontmatter}---\n\n# ${name}\n`,
    "utf8",
  );
  return skillRoot;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bundled Skill discovery", () => {
  it("discovers the release library through the same parser used at runtime", () => {
    const releaseRoot = path.resolve(__dirname, "..", "..", "bundled-skills");

    const result = discoverBundledSkills(releaseRoot);

    expect(result).toHaveLength(25);
    expect(result.filter((skill) => skill.defaultEnabled)).toHaveLength(8);
    expect(result.find((skill) => skill.directory === "frontend-design")?.sourceLabel).toBe("Anthropic 官方");
    expect(result.some((skill) => skill.directory === "claude-api")).toBe(false);
  });

  it("derives stable ids and first-install policy from the two drop folders", () => {
    const root = tempRoot();
    writeSkill(root, "default-enabled", "front-end", "frontend-design");
    writeSkill(root, "optional", "image-work", "image-gen", "category: content\ncategory-label: 内容创作\n");

    const result = discoverBundledSkills(root);

    expect(BUNDLED_SKILL_PLUGIN_NAME).toBe("leemo-library");
    expect(result.map((skill) => ({
      id: skill.id,
      directory: skill.directory,
      name: skill.name,
      defaultEnabled: skill.defaultEnabled,
      qualifiedName: skill.qualifiedName,
      category: skill.category,
      categoryLabel: skill.categoryLabel,
    }))).toEqual([
      {
        id: "bundled:front-end",
        directory: "front-end",
        name: "frontend-design",
        defaultEnabled: true,
        qualifiedName: "leemo-library:frontend-design",
        category: "other",
        categoryLabel: "其他",
      },
      {
        id: "bundled:image-work",
        directory: "image-work",
        name: "image-gen",
        defaultEnabled: false,
        qualifiedName: "leemo-library:image-gen",
        category: "content",
        categoryLabel: "内容创作",
      },
    ]);
  });

  it("uses optional catalog metadata without requiring it for manually pasted folders", () => {
    const root = tempRoot();
    writeSkill(root, "default-enabled", "frontend-design");
    writeSkill(root, "optional", "my-future-skill");
    fs.writeFileSync(path.join(root, "catalog.json"), JSON.stringify({
      version: 1,
      skills: {
        "frontend-design": {
          sourceLabel: "Anthropic 官方",
          sourceUrl: "https://github.com/anthropics/skills",
          license: "Apache-2.0",
          displayName: "前端设计",
          description: "设计并实现有明确视觉方向的前端界面。",
          category: "design",
          categoryLabel: "设计与创作",
        },
      },
    }), "utf8");

    const [official, pasted] = discoverBundledSkills(root);
    expect(official).toMatchObject({
      name: "前端设计",
      commandName: "frontend-design",
      description: "设计并实现有明确视觉方向的前端界面。",
      qualifiedName: "leemo-library:frontend-design",
      sourceLabel: "Anthropic 官方",
      sourceUrl: "https://github.com/anthropics/skills",
      license: "Apache-2.0",
      category: "design",
      categoryLabel: "设计与创作",
    });
    expect(pasted).toMatchObject({
      id: "bundled:my-future-skill",
      sourceLabel: "Leemo 精选",
      category: "other",
      categoryLabel: "其他",
    });
  });

  it("reads standard YAML block descriptions", () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "default-enabled"), { recursive: true });
    const skillRoot = path.join(root, "optional", "nested-metadata");
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(path.join(skillRoot, "SKILL.md"), `---
name: nested-metadata
description: |
  第一行说明。
  第二行说明。
homepage: https://example.com
---
`, "utf8");

    expect(discoverBundledSkills(root)[0]?.description)
      .toBe("第一行说明。\n第二行说明。");
  });

  it("rejects duplicate folders, duplicate trigger names and malformed direct children", () => {
    const duplicateDirectory = tempRoot();
    writeSkill(duplicateDirectory, "default-enabled", "same", "one");
    writeSkill(duplicateDirectory, "optional", "same", "two");
    expect(() => discoverBundledSkills(duplicateDirectory)).toThrow(/目录名重复/);

    const duplicateName = tempRoot();
    writeSkill(duplicateName, "default-enabled", "first", "same-name");
    writeSkill(duplicateName, "optional", "second", "same-name");
    expect(() => discoverBundledSkills(duplicateName)).toThrow(/触发名重复/);

    const malformed = tempRoot();
    fs.mkdirSync(path.join(malformed, "default-enabled", "bad"), { recursive: true });
    fs.mkdirSync(path.join(malformed, "optional"), { recursive: true });
    expect(() => discoverBundledSkills(malformed)).toThrow(/SKILL\.md/);
  });

  it("rejects a catalog entry that points at no bundled directory", () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "default-enabled"), { recursive: true });
    fs.mkdirSync(path.join(root, "optional"), { recursive: true });
    fs.writeFileSync(path.join(root, "catalog.json"), JSON.stringify({
      version: 1,
      skills: { ghost: { sourceLabel: "不存在" } },
    }), "utf8");

    expect(() => discoverBundledSkills(root)).toThrow(/catalog.*ghost/i);
  });

  it("projects cards without leaking packaged or app-data paths", () => {
    const root = tempRoot();
    writeSkill(root, "default-enabled", "frontend-design");
    fs.mkdirSync(path.join(root, "optional"), { recursive: true });
    const definitions = discoverBundledSkills(root);

    const cards = bundledSkillMetadata({
      status: "ready",
      pluginPath: path.join(root, "private-runtime"),
      revision: "sha256-test",
      skills: definitions,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "bundled:frontend-design",
      source: "builtin",
      trust: "leemo",
      sourceKind: "leemo",
      available: true,
      canRemove: false,
    });
    expect(JSON.stringify(cards)).not.toContain(root);
  });
});
