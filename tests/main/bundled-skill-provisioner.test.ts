import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBundledSkillProvisioner } from "../../src/main/bundled-skill-provisioner";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-library-test-"));
  roots.push(root);
  return root;
}

function libraryFixture(root: string): string {
  for (const [group, name] of [["default-enabled", "alpha"], ["optional", "beta"]] as const) {
    const skillRoot = path.join(root, group, name);
    fs.mkdirSync(path.join(skillRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} fixture\n---\n\n# ${name}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(skillRoot, "scripts", "run.js"), `export const name = "${name}";\n`, "utf8");
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bundled Skill library provisioning", () => {
  it("materializes the full release library into one flat runtime plugin", async () => {
    const configDir = tempRoot();
    const bundledRoot = path.resolve(__dirname, "..", "..", "bundled-skills");
    const runtime = createBundledSkillProvisioner({ configDir, bundledRoot });

    const result = await runtime.ensureReady();

    expect(result).toMatchObject({ status: "ready", skills: expect.any(Array) });
    if (result.status !== "ready") {
      throw new Error(result.status === "error" ? result.error : "expected ready bundled Skill runtime");
    }
    expect(result.skills).toHaveLength(25);
    expect(result.skills.filter((skill) => skill.defaultEnabled)).toHaveLength(8);
    expect(fs.readdirSync(path.join(result.pluginPath, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())).toHaveLength(25);
    expect(fs.existsSync(path.join(result.pluginPath, "default-enabled"))).toBe(false);
    expect(fs.existsSync(path.join(result.pluginPath, "optional"))).toBe(false);
  });

  it("copies the offline source atomically into one real local plugin", async () => {
    const configDir = tempRoot();
    const bundledRoot = libraryFixture(path.join(tempRoot(), "bundled-skills"));
    const runtime = createBundledSkillProvisioner({ configDir, bundledRoot });

    expect(runtime.snapshot()).toMatchObject({ status: "preparing", skills: expect.arrayContaining([
      expect.objectContaining({ id: "bundled:alpha", defaultEnabled: true }),
      expect.objectContaining({ id: "bundled:beta", defaultEnabled: false }),
    ]) });
    await expect(runtime.ensureReady()).resolves.toMatchObject({ status: "ready", skills: expect.any(Array) });

    const snapshot = runtime.snapshot();
    if (snapshot.status !== "ready") throw new Error("expected ready bundled Skill runtime");
    expect(snapshot.pluginPath).toBe(path.join(configDir, "runtime", "leemo-library"));
    expect(JSON.parse(fs.readFileSync(
      path.join(snapshot.pluginPath, ".claude-plugin", "plugin.json"),
      "utf8",
    ))).toMatchObject({ name: "leemo-library", version: snapshot.revision });
    expect(fs.readFileSync(path.join(snapshot.pluginPath, "skills", "alpha", "scripts", "run.js"), "utf8"))
      .toContain("alpha");
    expect(fs.readFileSync(path.join(snapshot.pluginPath, "skills", "beta", "SKILL.md"), "utf8"))
      .toContain("beta fixture");
    expect(fs.existsSync(path.join(snapshot.pluginPath, ".staging"))).toBe(false);
  });

  it("reuses the same content revision and coalesces concurrent callers", async () => {
    const configDir = tempRoot();
    const bundledRoot = libraryFixture(path.join(tempRoot(), "bundled-skills"));
    const runtime = createBundledSkillProvisioner({ configDir, bundledRoot });

    const [first, second] = await Promise.all([runtime.ensureReady(), runtime.ensureReady()]);
    expect(first).toEqual(second);
    if (first.status !== "ready") throw new Error("expected ready bundled Skill runtime");
    const manifest = path.join(first.pluginPath, ".claude-plugin", "plugin.json");
    const before = fs.statSync(manifest).mtimeMs;

    const nextRuntime = createBundledSkillProvisioner({ configDir, bundledRoot });
    await expect(nextRuntime.ensureReady()).resolves.toMatchObject({
      status: "ready",
      revision: first.revision,
      pluginPath: first.pluginPath,
    });
    expect(fs.statSync(manifest).mtimeMs).toBe(before);
  });

  it("never mutates the product-owner source folders", async () => {
    const configDir = tempRoot();
    const bundledRoot = libraryFixture(path.join(tempRoot(), "bundled-skills"));
    const before = fs.readFileSync(path.join(bundledRoot, "default-enabled", "alpha", "SKILL.md"), "utf8");
    const runtime = createBundledSkillProvisioner({ configDir, bundledRoot });

    await runtime.ensureReady();

    expect(fs.readFileSync(path.join(bundledRoot, "default-enabled", "alpha", "SKILL.md"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(bundledRoot, ".claude-plugin"))).toBe(false);
  });

  it("degrades clearly when either drop folder is missing", async () => {
    const bundledRoot = tempRoot();
    fs.mkdirSync(path.join(bundledRoot, "default-enabled"));
    const runtime = createBundledSkillProvisioner({ configDir: tempRoot(), bundledRoot });

    await expect(runtime.ensureReady()).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("按需启用"),
    });
    expect("pluginPath" in runtime.snapshot()).toBe(false);
  });
});
