import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveBundledSkillRoot,
  resolveOfficeBundleRoot,
} from "../../src/main/bundled-resource-roots";

describe("bundled resource roots", () => {
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
  });
});
