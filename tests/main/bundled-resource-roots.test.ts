import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveBundledSkillRoot,
  resolveOfficeBundleRoot,
  resolveSuperpowersBundleRoot,
} from "../../src/main/bundled-resource-roots";

describe("bundled resource roots", () => {
  it("passes the profile data root once so the provisioner owns runtime/superpowers", () => {
    const mainSource = fs.readFileSync(path.resolve("src", "main", "main.ts"), "utf8");
    const devSource = fs.readFileSync(path.resolve("src", "host", "dev.ts"), "utf8");

    for (const source of [mainSource, devSource]) {
      expect(source).toMatch(/createSuperpowersSkillProvisioner\(\{[\s\S]*?configDir: dataDir,[\s\S]*?bundledRoot:/u);
      expect(source).not.toMatch(/createSuperpowersSkillProvisioner\(\{[\s\S]*?configDir: path\.join\(dataDir, "runtime"\)/u);
    }
  });

  it("finds repository bundles one level above dist-electron in development", () => {
    const mainDirectory = path.resolve("workspace", "dist-electron");

    expect(resolveBundledSkillRoot({
      packaged: false,
      appPath: path.resolve("unused-app"),
      mainDirectory,
    })).toBe(path.resolve("workspace", "bundled-skills"));
    expect(resolveOfficeBundleRoot({
      packaged: false,
      appPath: path.resolve("unused-app"),
      mainDirectory,
    })).toBe(path.resolve("workspace", "bundled-skills", "office", "release"));
    expect(resolveSuperpowersBundleRoot({
      packaged: false,
      appPath: path.resolve("unused-app"),
      mainDirectory,
    })).toBe(path.resolve("workspace", "bundled-skills", "superpowers", "release"));
  });

  it("uses packaged resource locations without applying development traversal", () => {
    const appPath = path.resolve("package", "resources", "app.asar");
    const resourcesPath = path.resolve("package", "resources");

    expect(resolveBundledSkillRoot({
      packaged: true,
      appPath,
      mainDirectory: path.resolve("unused-main"),
    })).toBe(path.join(appPath, "bundled-skills"));
    expect(resolveOfficeBundleRoot({
      packaged: true,
      appPath,
      mainDirectory: path.resolve("unused-main"),
    })).toBe(path.join(appPath, "bundled-skills", "office", "release"));
    expect(resolveSuperpowersBundleRoot({
      packaged: true,
      appPath,
      mainDirectory: path.resolve("unused-main"),
    })).toBe(path.join(appPath, "bundled-skills", "superpowers", "release"));
  });
});
