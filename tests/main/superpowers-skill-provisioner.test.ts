import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuperpowersSkillProvisioner } from "../../src/main/superpowers-skill-provisioner";

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

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-superpowers-test-"));
  roots.push(root);
  return root;
}

function releaseFixture(root: string): string {
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "..", "..", "bundled-skills", "superpowers", "release", "LICENSE.upstream"),
    path.join(root, "LICENSE.upstream"),
  );
  for (const name of EXPECTED_SKILLS) {
    const skillDir = path.join(root, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} fixture workflow\n---\n\n# ${name}\n`,
      "utf8",
    );
  }
  const referenceDir = path.join(root, "skills", "brainstorming", "references");
  fs.mkdirSync(referenceDir, { recursive: true });
  fs.writeFileSync(path.join(referenceDir, "prompt.md"), "brainstorming reference\n", "utf8");
  const files: Array<{ path: string; bytes: number; sha256: string; mode: string }> = [];
  const visit = (directory: string, relativeRoot = ""): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "manifest.json") continue;
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else {
        const data = fs.readFileSync(absolute);
        files.push({
          path: relative,
          bytes: data.byteLength,
          sha256: createHash("sha256").update(data).digest("hex"),
          mode: "100644",
        });
      }
    }
  };
  visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  fs.writeFileSync(path.join(root, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    repository: "https://github.com/obra/superpowers.git",
    revision: "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9",
    version: "6.2.0",
    author: "Jesse Vincent",
    license: "MIT",
    licenseFile: "LICENSE.upstream",
    skills: EXPECTED_SKILLS,
    files,
  }, null, 2)}\n`, "utf8");
  return root;
}

function copiedPinnedRelease(): string {
  const target = path.join(tempRoot(), "release");
  fs.cpSync(
    path.resolve(__dirname, "..", "..", "bundled-skills", "superpowers", "release"),
    target,
    { recursive: true },
  );
  return target;
}

function refreshManifestFile(root: string, relative: string): void {
  const manifestFile = path.join(root, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const data = fs.readFileSync(path.join(root, ...relative.split("/")));
  const entry = manifest.files.find((file: { path: string }) => file.path === relative);
  entry.bytes = data.byteLength;
  entry.sha256 = createHash("sha256").update(data).digest("hex");
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (directory: string, relativeRoot = ""): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else result[relative] = fs.readFileSync(absolute).toString("base64");
    }
  };
  visit(root);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Superpowers offline plugin provisioning", () => {
  it("materializes the complete pinned 50-file Skill tree on Windows", async () => {
    const configDir = tempRoot();
    const bundledRoot = path.resolve(__dirname, "..", "..", "bundled-skills", "superpowers", "release");

    const result = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(result).toMatchObject({ status: "ready", skills: expect.any(Array) });
    if (result.status !== "ready") throw new Error("expected pinned Superpowers runtime to be ready");
    expect(fs.readdirSync(path.join(result.pluginPath, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())).toHaveLength(14);
    expect(Object.keys(readTree(path.join(result.pluginPath, "skills")))).toHaveLength(50);
    expect(fs.existsSync(path.join(
      result.pluginPath,
      "skills",
      "writing-skills",
      "anthropic-best-practices.md",
    ))).toBe(true);
  });

  it.each(["EPERM", "EBUSY", "ENOTEMPTY"])(
    "retries a transient %s while publishing a verified staging directory",
    async (code) => {
      const configDir = tempRoot();
      const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
      const pluginRoot = path.join(configDir, "runtime", "superpowers");
      const staging = path.resolve(`${pluginRoot}.staging`);
      const realRename = fs.promises.rename.bind(fs.promises);
      let attempts = 0;
      vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
        if (path.resolve(String(oldPath)) === staging && path.resolve(String(newPath)) === path.resolve(pluginRoot)) {
          attempts += 1;
          if (attempts < 3) throw Object.assign(new Error(`injected ${code}`), { code });
        }
        return realRename(oldPath, newPath);
      });

      const result = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

      expect(result).toMatchObject({ status: "ready", pluginPath: pluginRoot });
      expect(attempts).toBe(3);
    },
  );

  it("does not retry a non-transient staging publish failure", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const pluginRoot = path.join(configDir, "runtime", "superpowers");
    const staging = path.resolve(`${pluginRoot}.staging`);
    const realRename = fs.promises.rename.bind(fs.promises);
    let attempts = 0;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      if (path.resolve(String(oldPath)) === staging && path.resolve(String(newPath)) === path.resolve(pluginRoot)) {
        attempts += 1;
        throw Object.assign(new Error("injected EACCES"), { code: "EACCES" });
      }
      return realRename(oldPath, newPath);
    });

    const result = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(result).toMatchObject({ status: "error" });
    expect(attempts).toBe(1);
  });

  it("materializes all fourteen Skills and their complete trees into one local plugin", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const runtime = createSuperpowersSkillProvisioner({ configDir, bundledRoot });

    const result = await runtime.ensureReady();

    expect(result).toMatchObject({ status: "ready", skills: expect.any(Array) });
    if (result.status !== "ready") throw new Error("expected ready Superpowers runtime");
    expect(result.pluginPath).toBe(path.join(configDir, "runtime", "superpowers"));
    expect(JSON.parse(fs.readFileSync(
      path.join(result.pluginPath, ".claude-plugin", "plugin.json"),
      "utf8",
    ))).toMatchObject({ name: "superpowers", version: result.revision });
    expect(fs.readdirSync(path.join(result.pluginPath, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()).toEqual([...EXPECTED_SKILLS].sort());
    expect(fs.readFileSync(
      path.join(result.pluginPath, "skills", "brainstorming", "references", "prompt.md"),
      "utf8",
    )).toBe("brainstorming reference\n");
  });

  it("coalesces concurrent ensureReady callers into the same operation", async () => {
    const runtime = createSuperpowersSkillProvisioner({
      configDir: tempRoot(),
      bundledRoot: releaseFixture(path.join(tempRoot(), "release")),
    });

    const first = runtime.ensureReady();
    const second = runtime.ensureReady();

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({ status: "ready" });
  });

  it("reuses an unchanged content revision without replacing the runtime directory", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const first = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Superpowers runtime");
    const manifest = path.join(first.pluginPath, ".claude-plugin", "plugin.json");
    const preservedTime = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(manifest, preservedTime, preservedTime);

    const second = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(second).toMatchObject({
      status: "ready",
      pluginPath: first.pluginPath,
      revision: first.revision,
    });
    expect(fs.statSync(manifest).mtimeMs).toBe(preservedTime.getTime());
  });

  it("rebuilds a cached plugin when a Skill file is changed, missing, or unlisted", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const first = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Superpowers runtime");
    const cachedSkill = path.join(first.pluginPath, "skills", "brainstorming", "SKILL.md");
    const cachedReference = path.join(first.pluginPath, "skills", "brainstorming", "references", "prompt.md");
    const unlisted = path.join(first.pluginPath, "skills", "brainstorming", "unlisted.md");
    fs.writeFileSync(cachedSkill, "tampered runtime instructions\n", "utf8");
    fs.rmSync(cachedReference);
    fs.writeFileSync(unlisted, "unlisted runtime file\n", "utf8");

    const repaired = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(repaired).toMatchObject({ status: "ready", pluginPath: first.pluginPath });
    expect(fs.readFileSync(cachedSkill, "utf8")).toContain("brainstorming fixture workflow");
    expect(fs.readFileSync(cachedReference, "utf8")).toBe("brainstorming reference\n");
    expect(fs.existsSync(unlisted)).toBe(false);
  });

  it("replaces a cached skills junction that escapes the runtime plugin", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const first = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Superpowers runtime");
    const cachedSkills = path.join(first.pluginPath, "skills");
    const outsideSkills = path.join(tempRoot(), "outside-skills");
    fs.cpSync(cachedSkills, outsideSkills, { recursive: true });
    fs.rmSync(cachedSkills, { recursive: true, force: true });
    fs.symlinkSync(outsideSkills, cachedSkills, "junction");

    const repaired = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(repaired).toMatchObject({ status: "ready", pluginPath: first.pluginPath });
    expect(fs.lstatSync(cachedSkills).isSymbolicLink()).toBe(false);
    expect(fs.realpathSync(cachedSkills).startsWith(fs.realpathSync(first.pluginPath))).toBe(true);
  });

  it("rebuilds a cached plugin whose host-owned manifest gains untrusted fields", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const first = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Superpowers runtime");
    const manifestFile = path.join(first.pluginPath, ".claude-plugin", "plugin.json");
    const tampered = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    tampered.hooks = { SessionStart: [{ command: "unexpected" }] };
    fs.writeFileSync(manifestFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const repaired = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(repaired).toMatchObject({ status: "ready", pluginPath: first.pluginPath });
    expect(JSON.parse(fs.readFileSync(manifestFile, "utf8"))).toEqual({
      name: "superpowers",
      description: "Superpowers 开发方法套件",
      version: first.revision,
    });
  });

  it("restores the previous plugin when atomic replacement fails", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const first = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Superpowers runtime");
    const runtimeSkill = path.join(first.pluginPath, "skills", "brainstorming", "SKILL.md");
    const previousContents = fs.readFileSync(runtimeSkill, "utf8");
    fs.appendFileSync(path.join(bundledRoot, "skills", "brainstorming", "SKILL.md"), "\nchanged source\n", "utf8");
    refreshManifestFile(bundledRoot, "skills/brainstorming/SKILL.md");

    const realRename = fs.promises.rename.bind(fs.promises);
    const staging = path.resolve(`${first.pluginPath}.staging`);
    let injected = false;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      if (path.resolve(String(oldPath)) === staging && path.resolve(String(newPath)) === path.resolve(first.pluginPath)) {
        injected = true;
        throw new Error("injected replacement failure");
      }
      return realRename(oldPath, newPath);
    });

    const failed = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(injected).toBe(true);
    expect(failed).toMatchObject({ status: "error" });
    expect(fs.readFileSync(runtimeSkill, "utf8")).toBe(previousContents);
    expect(fs.existsSync(`${first.pluginPath}.staging`)).toBe(false);
    expect(fs.existsSync(`${first.pluginPath}.backup`)).toBe(false);
  });

  it("restores a valid backup before discarding an invalid runtime root", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const first = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();
    if (first.status !== "ready") throw new Error("expected ready Superpowers runtime");
    const backup = `${first.pluginPath}.backup`;
    fs.renameSync(first.pluginPath, backup);
    fs.mkdirSync(path.join(first.pluginPath, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(first.pluginPath, ".claude-plugin", "plugin.json"),
      "{\"name\":\"interrupted-install\"}\n",
      "utf8",
    );

    const realRename = fs.promises.rename.bind(fs.promises);
    const staging = path.resolve(`${first.pluginPath}.staging`);
    let attemptedStagingInstall = false;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      if (path.resolve(String(oldPath)) === staging && path.resolve(String(newPath)) === path.resolve(first.pluginPath)) {
        attemptedStagingInstall = true;
        throw new Error("injected staging install failure");
      }
      return realRename(oldPath, newPath);
    });

    const recovered = await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(recovered).toMatchObject({ status: "ready", pluginPath: first.pluginPath, revision: first.revision });
    expect(attemptedStagingInstall).toBe(false);
    expect(fs.existsSync(backup)).toBe(false);
    expect(fs.readFileSync(
      path.join(first.pluginPath, "skills", "brainstorming", "SKILL.md"),
      "utf8",
    )).toContain("brainstorming fixture workflow");
  });

  it("never modifies the bundled source tree", async () => {
    const configDir = tempRoot();
    const bundledRoot = releaseFixture(path.join(tempRoot(), "release"));
    const before = readTree(bundledRoot);

    await createSuperpowersSkillProvisioner({ configDir, bundledRoot }).ensureReady();

    expect(readTree(bundledRoot)).toEqual(before);
    expect(fs.existsSync(path.join(bundledRoot, ".claude-plugin"))).toBe(false);
  });

  it("rejects nested caches and linked directories before copying source files", async () => {
    const cachedRoot = releaseFixture(path.join(tempRoot(), "cached-release"));
    fs.mkdirSync(path.join(cachedRoot, "skills", "brainstorming", "node_modules"));
    await expect(createSuperpowersSkillProvisioner({
      configDir: tempRoot(),
      bundledRoot: cachedRoot,
    }).ensureReady()).resolves.toMatchObject({ status: "error" });

    const linkedRoot = releaseFixture(path.join(tempRoot(), "linked-release"));
    const outside = tempRoot();
    fs.writeFileSync(path.join(outside, "outside.md"), "outside", "utf8");
    fs.symlinkSync(outside, path.join(linkedRoot, "skills", "brainstorming", "linked-reference"), "junction");
    const linked = await createSuperpowersSkillProvisioner({
      configDir: tempRoot(),
      bundledRoot: linkedRoot,
    }).ensureReady();

    expect(linked).toMatchObject({ status: "error" });
    expect("pluginPath" in linked).toBe(false);
  });

  it("enters an error snapshot before use when the pinned payload no longer matches its manifest", () => {
    const bundledRoot = copiedPinnedRelease();
    fs.appendFileSync(path.join(bundledRoot, "skills", "brainstorming", "SKILL.md"), "\ntampered\n", "utf8");

    const runtime = createSuperpowersSkillProvisioner({ configDir: tempRoot(), bundledRoot });

    expect(runtime.snapshot()).toMatchObject({ status: "error", skills: [] });
  });

  it("removes pinned provenance when the payload drifts after runtime construction", async () => {
    const bundledRoot = copiedPinnedRelease();
    const runtime = createSuperpowersSkillProvisioner({ configDir: tempRoot(), bundledRoot });
    expect(runtime.snapshot()).toMatchObject({ status: "preparing", skills: expect.any(Array) });
    fs.appendFileSync(path.join(bundledRoot, "skills", "brainstorming", "SKILL.md"), "\ntampered later\n", "utf8");

    const failed = await runtime.ensureReady();

    expect(failed).toMatchObject({ status: "error", skills: [] });
  });
});
