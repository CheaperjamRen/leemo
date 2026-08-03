import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const script = path.join(root, "scripts", "verify-electron-runtime.mjs");
const temporaryDirectories: string[] = [];

function fixture(options: { executable?: boolean; distVersion?: string } = {}): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-electron-runtime-"));
  temporaryDirectories.push(directory);
  const electronRoot = path.join(directory, "node_modules", "electron");
  const dist = path.join(electronRoot, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(electronRoot, "package.json"), JSON.stringify({ version: "37.7.0" }));
  if (options.executable) fs.writeFileSync(path.join(dist, "electron.exe"), "fixture");
  if (options.distVersion) fs.writeFileSync(path.join(dist, "version"), options.distVersion);
  return directory;
}

function verify(directory: string) {
  return spawnSync(process.execPath, [script, "--root", directory], {
    encoding: "utf8",
    windowsHide: true,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Electron packaging runtime preflight", () => {
  it("fails before packaging with an actionable message when the local runtime is absent", () => {
    const result = verify(fixture({ distVersion: "37.7.0" }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("缺少本地 Electron 运行时");
  });

  it("accepts the complete locally installed runtime without a network download", () => {
    const result = verify(fixture({ executable: true, distVersion: "37.7.0" }));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Electron 37.7.0");
  });

  it("rejects a runtime whose dist version does not match its installed package", () => {
    const result = verify(fixture({ executable: true, distVersion: "36.0.0" }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("版本不一致");
  });
});
