import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { loadSkillArchive, loadSkillDirectory } from "../../src/host/skill-package";

const SKILL = "---\nname: demo-skill\ndescription: Converts a page\n---\nUse the bundled script.";

function zip(files: Record<string, string>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [path, Buffer.from(contents, "utf8")]),
  )));
}

function unixSymlinkZip(): Buffer {
  const archive = zip({ "demo/SKILL.md": SKILL, "demo/link": "../outside" });
  let offset = 0;
  let seen = 0;
  while ((offset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
    if (seen === 1) {
      archive.writeUInt16LE((3 << 8) | 20, offset + 4);
      archive.writeUInt32LE((0o120777 << 16) >>> 0, offset + 38);
      return archive;
    }
    seen += 1;
    offset += 4;
  }
  throw new Error("central directory entry not found");
}

describe("loadSkillArchive", () => {
  it("finds a Skill inside a repository-shaped ZIP and keeps only its subtree", () => {
    const loaded = loadSkillArchive(zip({
      "repo-main/README.md": "repo readme",
      "repo-main/skills/demo/SKILL.md": SKILL,
      "repo-main/skills/demo/scripts/convert.js": "export const convert = () => 'ok';",
      "repo-main/skills/other/README.md": "not part of demo",
    }));

    expect(loaded.candidates).toHaveLength(1);
    expect(loaded.candidates[0]).toMatchObject({
      name: "demo-skill",
      description: "Converts a page",
    });
    expect(loaded.candidates[0].files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "scripts/convert.js",
    ]);
  });

  it("keeps an arbitrary product category instead of restricting community Skills to built-in labels", () => {
    const loaded = loadSkillArchive(zip({
      "demo/SKILL.md": "---\nname: xiaohongshu-publish\ndescription: 发布小红书图文\ncategory: social-publishing\ncategory-label: 内容发布\n---\nPublish carefully.",
    }));

    expect(loaded.candidates[0]).toMatchObject({
      category: "social-publishing",
      categoryLabel: "内容发布",
    });
  });

  it("preserves YAML block descriptions used by official community Skills", () => {
    const loaded = loadSkillArchive(zip({
      "nested/SKILL.md": "---\nname: nested-metadata\ndescription: |\n  第一行说明。\n  第二行说明。\nmetadata:\n  description: nested value\n---\nUse the workflow.",
    }));

    expect(loaded.candidates[0]?.description).toBe("第一行说明。\n第二行说明。");
  });

  it("rejects path traversal before extraction", () => {
    expect(() => loadSkillArchive(zip({
      "demo/SKILL.md": SKILL,
      "../outside.txt": "escape",
    }))).toThrow("不安全路径");
  });

  it("rejects symbolic links recorded in ZIP metadata", () => {
    expect(() => loadSkillArchive(unixSymlinkZip())).toThrow("符号链接");
  });

  it("rejects an archive whose declared expanded size exceeds the limit", () => {
    expect(() => loadSkillArchive(zip({
      "demo/SKILL.md": SKILL,
      "demo/large.txt": "x".repeat(2048),
    }), { maxExpandedBytes: 1024 })).toThrow("解压后超过");
  });
});

describe("loadSkillDirectory", () => {
  it("loads one local Skill folder without following unrelated siblings", () => {
    const root = mkdtempSync(join(tmpdir(), "leemo-skill-"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "SKILL.md"), SKILL);
    writeFileSync(join(root, "scripts", "convert.js"), "export {};\n");

    const loaded = loadSkillDirectory(root);

    expect(loaded.candidates).toHaveLength(1);
    expect(loaded.candidates[0].files.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "scripts/convert.js",
    ]);
  });

  it("rejects local symbolic links instead of copying their targets", () => {
    const root = mkdtempSync(join(tmpdir(), "leemo-skill-link-"));
    writeFileSync(join(root, "SKILL.md"), SKILL);
    writeFileSync(join(root, "outside.txt"), "secret");
    try {
      symlinkSync(join(root, "outside.txt"), join(root, "linked.txt"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    expect(() => loadSkillDirectory(root)).toThrow("符号链接");
  });
});
