import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyE2EIsolationFromArgv,
  resolveE2EIsolationRoot,
  resolveE2EWorkspaceCandidate,
} from "../../src/main/e2e-isolation";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function makeRoot(prefix = "leemo-e2e-test-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

describe("resolveE2EIsolationRoot", () => {
  it("keeps normal launches unchanged", () => {
    expect(resolveE2EIsolationRoot(["Leemo.exe"], os.tmpdir())).toBeUndefined();
  });

  it("accepts exactly one direct temp child with the dedicated prefix", () => {
    const root = makeRoot();
    expect(resolveE2EIsolationRoot(["Leemo.exe", `--leemo-e2e-root=${root}`], os.tmpdir())).toBe(
      fs.realpathSync(root),
    );
  });

  it("accepts a root directly below the child process's private TEMP", () => {
    const privateTemp = makeRoot("leemo-e2e-parent-");
    const root = fs.mkdtempSync(path.join(privateTemp, "leemo-e2e-run-"));
    expect(resolveE2EIsolationRoot(
      ["Leemo.exe", `--leemo-e2e-root=${root}`],
      privateTemp,
    )).toBe(fs.realpathSync(root));
  });

  it.each([
    ["outside temp", () => path.join(path.parse(os.tmpdir()).root, "leemo-e2e-outside")],
    ["wrong prefix", () => makeRoot("ordinary-test-")],
    ["nested below temp", () => {
      const root = makeRoot();
      const nested = path.join(root, "nested");
      fs.mkdirSync(nested);
      return nested;
    }],
  ])("rejects %s", (_label, target) => {
    expect(() => resolveE2EIsolationRoot(["Leemo.exe", `--leemo-e2e-root=${target()}`], os.tmpdir())).toThrow(
      /拒绝 E2E 隔离路径/,
    );
  });

  it("rejects duplicate isolation flags", () => {
    const one = makeRoot();
    const two = makeRoot();
    expect(() => resolveE2EIsolationRoot([
      "Leemo.exe",
      `--leemo-e2e-root=${one}`,
      `--leemo-e2e-root=${two}`,
    ], os.tmpdir())).toThrow(/只能传一次/);
  });

  it("rejects a symlink even when its name looks valid", () => {
    const target = makeRoot("e2e-target-");
    const link = path.join(os.tmpdir(), `leemo-e2e-link-${Date.now()}`);
    cleanup.push(link);
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => resolveE2EIsolationRoot(["Leemo.exe", `--leemo-e2e-root=${link}`], os.tmpdir())).toThrow(
      /符号链接/,
    );
  });
});

describe("applyE2EIsolationFromArgv", () => {
  it("creates isolated app paths and sets all three before startup", () => {
    const root = makeRoot();
    const setPath = vi.fn();

    const result = applyE2EIsolationFromArgv(
      { setPath },
      ["Leemo.exe", `--leemo-e2e-root=${root}`],
      os.tmpdir(),
    );

    expect(result).toEqual({
      root: fs.realpathSync(root),
      home: path.join(fs.realpathSync(root), "home"),
      userData: path.join(fs.realpathSync(root), "user-data"),
      sessionData: path.join(fs.realpathSync(root), "session-data"),
    });
    expect(setPath.mock.calls).toEqual([
      ["home", result?.home],
      ["userData", result?.userData],
      ["sessionData", result?.sessionData],
    ]);
    expect(fs.statSync(result!.home).isDirectory()).toBe(true);
    expect(fs.statSync(result!.userData).isDirectory()).toBe(true);
    expect(fs.statSync(result!.sessionData).isDirectory()).toBe(true);
  });

  it("does not touch app paths in a normal launch", () => {
    const setPath = vi.fn();
    expect(applyE2EIsolationFromArgv({ setPath }, ["Leemo.exe"], os.tmpdir())).toBeUndefined();
    expect(setPath).not.toHaveBeenCalled();
  });
});

describe("resolveE2EWorkspaceCandidate", () => {
  it("accepts a real directory inside the active isolation root", () => {
    const root = makeRoot();
    const project = path.join(root, "external-project");
    fs.mkdirSync(project);
    expect(resolveE2EWorkspaceCandidate(
      ["Leemo.exe", `--leemo-e2e-workspace=${project}`],
      root,
    )).toBe(fs.realpathSync(project));
  });

  it("is absent from a normal isolated run when no workspace flag is supplied", () => {
    expect(resolveE2EWorkspaceCandidate(["Leemo.exe"], makeRoot())).toBeUndefined();
  });

  it("rejects the flag outside isolation mode", () => {
    const project = makeRoot("leemo-e2e-project-");
    expect(() => resolveE2EWorkspaceCandidate(
      ["Leemo.exe", `--leemo-e2e-workspace=${project}`],
      undefined,
    )).toThrow(/只能和 --leemo-e2e-root 一起使用/);
  });

  it("rejects outside paths, duplicate flags, and symlinked candidates", () => {
    const root = makeRoot();
    const outside = makeRoot("leemo-e2e-project-");
    expect(() => resolveE2EWorkspaceCandidate(
      ["Leemo.exe", `--leemo-e2e-workspace=${outside}`],
      root,
    )).toThrow(/必须位于本次 E2E 隔离目录内/);

    const project = path.join(root, "project");
    fs.mkdirSync(project);
    expect(() => resolveE2EWorkspaceCandidate([
      "Leemo.exe",
      `--leemo-e2e-workspace=${project}`,
      `--leemo-e2e-workspace=${project}`,
    ], root)).toThrow(/只能传一次/);

    const target = path.join(root, "target");
    const link = path.join(root, "project-link");
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => resolveE2EWorkspaceCandidate(
      ["Leemo.exe", `--leemo-e2e-workspace=${link}`],
      root,
    )).toThrow(/符号链接/);
  });
});
