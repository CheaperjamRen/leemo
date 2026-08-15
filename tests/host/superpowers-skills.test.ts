import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SUPERPOWERS_PLUGIN_NAME,
  discoverSuperpowersSkills,
  superpowersSkillMetadata,
} from "../../src/host/superpowers-skills";

const EXPECTED_SKILLS = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;

const roots: string[] = [];

function copiedRelease(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-superpowers-discovery-test-"));
  roots.push(root);
  const target = path.join(root, "release");
  fs.cpSync(
    path.resolve(__dirname, "..", "..", "bundled-skills", "superpowers", "release"),
    target,
    { recursive: true },
  );
  return target;
}

function updateManifest(root: string, update: (manifest: any) => void): void {
  const file = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  update(manifest);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Superpowers Skill discovery", () => {
  it("discovers exactly the pinned suite as default-off developer cards", () => {
    const releaseRoot = path.resolve(__dirname, "..", "..", "bundled-skills", "superpowers", "release");

    const definitions = discoverSuperpowersSkills(releaseRoot);

    expect(SUPERPOWERS_PLUGIN_NAME).toBe("superpowers");
    expect(definitions.map((skill) => skill.directory)).toEqual(EXPECTED_SKILLS);
    expect(definitions.map((skill) => skill.qualifiedName)).toEqual(
      EXPECTED_SKILLS.map((name) => `superpowers:${name}`),
    );
    expect(definitions.every((skill) => skill.defaultEnabled === false)).toBe(true);
    expect(definitions.every((skill) => skill.source === "builtin")).toBe(true);
    expect(definitions.every((skill) => skill.category === "developer")).toBe(true);
    expect(definitions.every((skill) => skill.sourceLabel === "社区精选")).toBe(true);
    expect(definitions.every((skill) => skill.collectionId === "superpowers")).toBe(true);
    expect(definitions.every((skill) => skill.collectionLabel === "Superpowers 开发方法套件")).toBe(true);
  });

  it("projects cards without leaking packaged source or app-data paths", () => {
    const releaseRoot = path.resolve(__dirname, "..", "..", "bundled-skills", "superpowers", "release");
    const definitions = discoverSuperpowersSkills(releaseRoot);
    const pluginPath = path.join(releaseRoot, "private-profile", "runtime", "superpowers");

    const cards = superpowersSkillMetadata({
      status: "ready",
      pluginPath,
      revision: "sha256-test",
      skills: definitions,
    });

    expect(cards).toHaveLength(14);
    expect(cards[0]).toMatchObject({
      id: "superpowers:brainstorming",
      source: "builtin",
      trust: "community",
      sourceKind: "leemo",
      sourceLabel: "社区精选",
      available: true,
      canRemove: false,
      canUpdate: false,
    });
    expect(JSON.stringify(cards)).not.toContain(releaseRoot);
    expect(JSON.stringify(cards)).not.toContain(pluginPath);
    expect(cards.every((card) => !("sourceDir" in card) && !("directory" in card))).toBe(true);
  });

  it("rejects a manifest file path that can escape the release root", () => {
    const releaseRoot = copiedRelease();
    updateManifest(releaseRoot, (manifest) => {
      manifest.files[0].path = "../LICENSE.upstream";
    });

    expect(() => discoverSuperpowersSkills(releaseRoot)).toThrow(/path|路径/u);
  });

  it("rejects executable mode drift in the pinned manifest", () => {
    const releaseRoot = copiedRelease();
    updateManifest(releaseRoot, (manifest) => {
      const entry = manifest.files.find((file: { path: string }) => (
        file.path === "skills/brainstorming/scripts/start-server.sh"
      ));
      entry.mode = "100644";
    });

    expect(() => discoverSuperpowersSkills(releaseRoot)).toThrow(/mode/u);
  });

  it("rejects an unlisted file in the release payload", () => {
    const releaseRoot = copiedRelease();
    fs.writeFileSync(path.join(releaseRoot, "skills", "brainstorming", "unlisted.md"), "unlisted\n", "utf8");

    expect(() => discoverSuperpowersSkills(releaseRoot)).toThrow(/清单|manifest/u);
  });

  it("rejects a non-string extra member hidden in the fourteen-Skill identity list", () => {
    const releaseRoot = copiedRelease();
    updateManifest(releaseRoot, (manifest) => {
      manifest.skills.push(null);
    });

    expect(() => discoverSuperpowersSkills(releaseRoot)).toThrow(/14 项技能/u);
  });

  it("rejects a consistently rewritten license that is not the pinned upstream file", () => {
    const releaseRoot = copiedRelease();
    const license = Buffer.from("MIT License\nrewritten fixture\n", "utf8");
    fs.writeFileSync(path.join(releaseRoot, "LICENSE.upstream"), license);
    updateManifest(releaseRoot, (manifest) => {
      const entry = manifest.files.find((file: { path: string }) => file.path === "LICENSE.upstream");
      entry.bytes = license.byteLength;
      entry.sha256 = createHash("sha256").update(license).digest("hex");
    });

    expect(() => discoverSuperpowersSkills(releaseRoot)).toThrow(/许可证|LICENSE/u);
  });
});
