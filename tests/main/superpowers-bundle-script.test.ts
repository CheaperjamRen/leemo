import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const script = path.join(root, "scripts", "verify-superpowers-bundle.mjs");
const refreshScript = path.join(root, "scripts", "refresh-superpowers-bundle.mjs");
const upstreamRoot = process.env.SUPERPOWERS_UPSTREAM_ROOT;
const bundledLicense = path.join(root, "bundled-skills", "superpowers", "release", "LICENSE.upstream");
const hasUpstreamCheckout = typeof upstreamRoot === "string"
  && fs.existsSync(path.join(upstreamRoot, ".git"));
const revision = "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9";
const skills = [
  "brainstorming", "dispatching-parallel-agents", "executing-plans",
  "finishing-a-development-branch", "receiving-code-review",
  "requesting-code-review", "subagent-driven-development",
  "systematic-debugging", "test-driven-development", "using-git-worktrees",
  "using-superpowers", "verification-before-completion", "writing-plans",
  "writing-skills",
];
const tempRoots: string[] = [];

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeFixture(): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-superpowers-bundle-"));
  tempRoots.push(target);
  const files: Array<{ path: string; bytes: number; sha256: string; mode: string }> = [];
  const addFile = (relative: string, content: Buffer, mode = "100644") => {
    const absolute = path.join(target, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    files.push({ path: relative, bytes: content.byteLength, sha256: sha256(content), mode });
  };

  addFile("LICENSE.upstream", fs.readFileSync(bundledLicense));
  for (const skill of skills) {
    addFile(`skills/${skill}/SKILL.md`, Buffer.from(`---\nname: ${skill}\ndescription: ${skill} workflow\n---\n`, "utf8"));
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    repository: "https://github.com/obra/superpowers.git",
    revision,
    version: "6.2.0",
    author: "Jesse Vincent",
    license: "MIT",
    licenseFile: "LICENSE.upstream",
    skills,
    files,
  }, null, 2), "utf8");
  return target;
}

function run(target: string) {
  return spawnSync(process.execPath, [script, target], { encoding: "utf8" });
}

function runRefresh(bundleParent: string, nextRevision = revision) {
  if (!upstreamRoot) throw new Error("SUPERPOWERS_UPSTREAM_ROOT is required for refresh integration tests");
  return spawnSync(process.execPath, [
    refreshScript,
    "--source", upstreamRoot,
    "--revision", nextRevision,
    "--bundle-parent", bundleParent,
  ], { encoding: "utf8" });
}

function updateManifest(target: string, update: (manifest: any) => void): void {
  const file = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  update(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), "utf8");
}

afterEach(() => {
  for (const target of tempRoots.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe("Superpowers offline bundle verifier", () => {
  it("accepts the fixed 14-Skill identity set and reports a deterministic payload digest", () => {
    const result = run(makeFixture());

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      skillCount: 14,
      skills,
      files: 15,
    });
    expect(JSON.parse(result.stdout).bytes).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout).sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a missing or fifteenth Skill directory", () => {
    const missing = makeFixture();
    fs.rmSync(path.join(missing, "skills", "brainstorming"), { recursive: true });
    expect(run(missing).status).not.toBe(0);

    const extra = makeFixture();
    fs.mkdirSync(path.join(extra, "skills", "unexpected-skill"));
    expect(run(extra).status).not.toBe(0);
  });

  it("rejects a symlink and cache directory in the release payload", () => {
    const link = makeFixture();
    const linkPath = path.join(link, "skills", "brainstorming", "linked.md");
    try {
      fs.symlinkSync(path.join(link, "LICENSE.upstream"), linkPath, "file");
      expect(run(link).status).not.toBe(0);
    } catch (error: any) {
      if (error?.code !== "EPERM") throw error;
    }

    const cache = makeFixture();
    fs.mkdirSync(path.join(cache, "skills", "brainstorming", "node_modules"));
    expect(run(cache).status).not.toBe(0);
  });

  it("rejects manifest hash, license, and identity drift", () => {
    const mismatch = makeFixture();
    fs.appendFileSync(path.join(mismatch, "skills", "brainstorming", "SKILL.md"), "changed\n");
    expect(run(mismatch).status).not.toBe(0);

    const license = makeFixture();
    const licenseContent = Buffer.from("Apache License\n", "utf8");
    fs.writeFileSync(path.join(license, "LICENSE.upstream"), licenseContent);
    updateManifest(license, (manifest) => {
      const entry = manifest.files.find((file: { path: string }) => file.path === "LICENSE.upstream");
      entry.bytes = licenseContent.byteLength;
      entry.sha256 = sha256(licenseContent);
    });
    expect(run(license).status).not.toBe(0);

    const identity = makeFixture();
    updateManifest(identity, (manifest) => { manifest.revision = "0".repeat(40); });
    expect(run(identity).status).not.toBe(0);
  });

  it.skipIf(!hasUpstreamCheckout)("atomically replaces a verified release and preserves it when source validation fails", () => {
    const bundleParent = path.join(makeFixture(), "superpowers");
    const release = path.join(bundleParent, "release");
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, "old-release-marker"), "old", "utf8");

    const refreshed = runRefresh(bundleParent);

    expect(refreshed.status, refreshed.stderr).toBe(0);
    expect(fs.existsSync(path.join(release, "old-release-marker"))).toBe(false);
    const manifest = fs.readFileSync(path.join(release, "manifest.json"));

    const rejected = runRefresh(bundleParent, "0".repeat(40));

    expect(rejected.status).not.toBe(0);
    expect(fs.readFileSync(path.join(release, "manifest.json"))).toEqual(manifest);
  }, 15_000);
});
