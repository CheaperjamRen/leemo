import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficeSkillProvisioner } from "../../src/main/office-skill-provisioner";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-office-skills-test-"));
  roots.push(root);
  return root;
}

function bundledFixture(root: string, flat = false): string {
  for (const name of ["docx", "xlsx", "pptx", "pdf"]) {
    const skillDir = path.join(root, ...(flat ? [] : ["skills"]), name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: bundled ${name}\n---\n`,
      "utf8",
    );
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Office Skill local bundle provisioning", () => {
  it("copies the build-time bundle into one real local runtime plugin", async () => {
    const configDir = tempRoot();
    const bundledRoot = bundledFixture(path.join(tempRoot(), "office"));
    const runtime = createOfficeSkillProvisioner({ configDir, bundledRoot });

    await expect(runtime.ensureReady()).resolves.toMatchObject({ status: "ready", source: "bundled" });
    const snapshot = runtime.snapshot();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") throw new Error("expected ready Office runtime");
    expect(snapshot.pluginPath).toBe(path.join(configDir, "runtime", "leemo-office"));
    expect(JSON.parse(fs.readFileSync(
      path.join(snapshot.pluginPath, ".claude-plugin", "plugin.json"),
      "utf8",
    ))).toMatchObject({ name: "leemo-office" });
    for (const name of ["docx", "xlsx", "pptx", "pdf"]) {
      const runtimeSkill = path.join(snapshot.pluginPath, "skills", name);
      expect(fs.lstatSync(runtimeSkill).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(path.join(runtimeSkill, "SKILL.md"), "utf8"))
        .toContain(`bundled ${name}`);
      expect(fs.realpathSync(runtimeSkill)).not.toBe(fs.realpathSync(path.join(bundledRoot, "skills", name)));
    }
  });

  it("rejects the legacy flat bundle instead of guessing its layout", async () => {
    const runtime = createOfficeSkillProvisioner({
      configDir: tempRoot(),
      bundledRoot: bundledFixture(path.join(tempRoot(), "office"), true),
    });

    await expect(runtime.ensureReady()).resolves.toMatchObject({ status: "error" });
    expect("pluginPath" in runtime.snapshot()).toBe(false);
  });

  it("coalesces concurrent local bundle callers", async () => {
    const runtime = createOfficeSkillProvisioner({
      configDir: tempRoot(),
      bundledRoot: bundledFixture(path.join(tempRoot(), "office")),
    });
    const [first, second] = await Promise.all([runtime.ensureReady(), runtime.ensureReady()]);
    expect(first).toEqual(second);
  });

  it("reuses an unchanged content revision and atomically refreshes changed source", async () => {
    const configDir = tempRoot();
    const bundledRoot = bundledFixture(path.join(tempRoot(), "office"));
    const firstRuntime = createOfficeSkillProvisioner({ configDir, bundledRoot });
    const first = await firstRuntime.ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Office runtime");
    const runtimeSkill = path.join(first.pluginPath, "skills", "docx", "SKILL.md");
    const manifest = path.join(first.pluginPath, ".claude-plugin", "plugin.json");
    const firstMtime = fs.statSync(manifest).mtimeMs;

    const unchangedRuntime = createOfficeSkillProvisioner({ configDir, bundledRoot });
    await expect(unchangedRuntime.ensureReady()).resolves.toMatchObject({
      status: "ready",
      revision: first.revision,
      pluginPath: first.pluginPath,
    });
    expect(fs.statSync(manifest).mtimeMs).toBe(firstMtime);

    fs.appendFileSync(path.join(bundledRoot, "skills", "docx", "SKILL.md"), "\nchanged\n", "utf8");
    const changedRuntime = createOfficeSkillProvisioner({ configDir, bundledRoot });
    const changed = await changedRuntime.ensureReady();
    expect(changed).toMatchObject({ status: "ready", pluginPath: first.pluginPath });
    if (changed.status !== "ready") throw new Error("expected refreshed Office runtime");
    expect(changed.revision).not.toBe(first.revision);
    expect(fs.readFileSync(runtimeSkill, "utf8")).toContain("changed");
    expect(fs.existsSync(`${first.pluginPath}.staging`)).toBe(false);
    expect(fs.existsSync(`${first.pluginPath}.backup`)).toBe(false);
  }, 15_000);

  it("never mutates the product-owner Office source", async () => {
    const configDir = tempRoot();
    const bundledRoot = bundledFixture(path.join(tempRoot(), "office"));
    const source = path.join(bundledRoot, "skills", "docx", "SKILL.md");
    const before = fs.readFileSync(source, "utf8");

    await createOfficeSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(fs.readFileSync(source, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(bundledRoot, ".claude-plugin"))).toBe(false);
  });

  it("rejects extra skill and staging directories instead of shipping duplicate sources", async () => {
    const configDir = tempRoot();
    const bundledRoot = bundledFixture(path.join(tempRoot(), "office"));
    fs.mkdirSync(path.join(bundledRoot, "skills", "skills.staging-123"));

    const runtime = createOfficeSkillProvisioner({ configDir, bundledRoot });

    await expect(runtime.ensureReady()).resolves.toMatchObject({ status: "error" });
    expect("pluginPath" in runtime.snapshot()).toBe(false);
  });

  it("rejects nested caches before copying the bundle into app data", async () => {
    const configDir = tempRoot();
    const bundledRoot = bundledFixture(path.join(tempRoot(), "office"));
    fs.mkdirSync(path.join(bundledRoot, "skills", "docx", ".pytest_cache"));

    const runtime = createOfficeSkillProvisioner({ configDir, bundledRoot });

    await expect(runtime.ensureReady()).resolves.toMatchObject({ status: "error" });
    expect("pluginPath" in runtime.snapshot()).toBe(false);
  });

  it("rejects a bundle whose skill path escapes through a junction", async () => {
    const configDir = tempRoot();
    const bundledRoot = tempRoot();
    const outside = tempRoot();
    bundledFixture(outside, true);
    fs.mkdirSync(path.join(bundledRoot, "skills"), { recursive: true });
    for (const name of ["docx", "xlsx", "pptx"]) {
      const target = path.join(bundledRoot, "skills", name);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "SKILL.md"), `# ${name}\n`, "utf8");
    }
    fs.symlinkSync(path.join(outside, "pdf"), path.join(bundledRoot, "skills", "pdf"), "junction");

    const runtime = createOfficeSkillProvisioner({ configDir, bundledRoot });
    await expect(runtime.ensureReady()).resolves.toMatchObject({ status: "error" });
    expect("pluginPath" in runtime.snapshot()).toBe(false);
  });

  it("degrades clearly when no local bundle is present", async () => {
    const runtime = createOfficeSkillProvisioner({ configDir: tempRoot(), bundledRoot: path.join(tempRoot(), "missing") });

    await expect(runtime.ensureReady()).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("内置 Office 技能包"),
    });
  });
});
