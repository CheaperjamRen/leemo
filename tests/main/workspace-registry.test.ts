import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOME_WORKSPACE_ID,
  createWorkspaceRegistry,
  registerPickedWorkspace,
} from "../../src/main/workspace-registry";
import { expectSameExistingPath } from "../helpers/path-identity";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-workspace-registry-"));
  cleanup.push(root);
  const homeRoot = path.join(root, "home", "Leemo");
  const externalRoot = path.join(root, "projects", "毕业设计");
  fs.mkdirSync(homeRoot, { recursive: true });
  fs.mkdirSync(externalRoot, { recursive: true });
  let now = 100;
  const registry = createWorkspaceRegistry({
    homeRoot,
    registryFile: path.join(root, "user-data", "workspaces.json"),
    now: () => now,
  });
  return {
    root,
    homeRoot,
    externalRoot,
    registryFile: path.join(root, "user-data", "workspaces.json"),
    registry,
    advance(value = 1) { now += value; },
  };
}

describe("WorkspaceRegistry", () => {
  it("always exposes the Leemo home workspace without persisting it as a recent external folder", () => {
    const f = fixture();
    const [home] = f.registry.list();
    expect(home).toMatchObject({
      id: HOME_WORKSPACE_ID,
      name: "Leemo",
      kind: "home",
      available: true,
      lastOpenedAt: 0,
    });
    expectSameExistingPath(home?.displayPath, f.homeRoot);
    expect(fs.existsSync(f.registryFile)).toBe(false);
  });

  it("registers an existing directory with a stable opaque id and does not write into that directory", () => {
    const f = fixture();
    const first = f.registry.register(f.externalRoot);
    const second = f.registry.register(path.join(f.externalRoot, "."));

    expect(second.id).toBe(first.id);
    expect(first.id).toMatch(/^workspace-[a-f0-9]{20}$/);
    expect(first.id).not.toContain("毕业设计");
    expect(first).toMatchObject({
      name: "毕业设计",
      kind: "external",
      available: true,
      lastOpenedAt: 100,
    });
    expectSameExistingPath(first.displayPath, f.externalRoot);
    expect(f.registry.list().filter((entry) => entry.kind === "external")).toHaveLength(1);
    expect(fs.existsSync(path.join(f.externalRoot, ".leemo"))).toBe(false);
  });

  it("orders recent folders by last use and touch never creates a duplicate", () => {
    const f = fixture();
    const other = path.join(f.root, "projects", "英语学习");
    fs.mkdirSync(other, { recursive: true });
    const first = f.registry.register(f.externalRoot);
    f.advance(20);
    const second = f.registry.register(other);
    expect(f.registry.list().slice(1).map((entry) => entry.id)).toEqual([second.id, first.id]);

    f.advance(20);
    f.registry.touch(first.id);
    expect(f.registry.list().slice(1).map((entry) => entry.id)).toEqual([first.id, second.id]);
  });

  it("reports a missing recent folder without dropping the record, then resolves it again when restored", () => {
    const f = fixture();
    const entry = f.registry.register(f.externalRoot);
    const moved = `${f.externalRoot}-moved`;
    fs.renameSync(f.externalRoot, moved);
    expect(f.registry.list().find((item) => item.id === entry.id)?.available).toBe(false);
    expect(() => f.registry.resolve(entry.id)).toThrow(/找不到这个工作区/);

    fs.renameSync(moved, f.externalRoot);
    expectSameExistingPath(f.registry.resolve(entry.id).root, f.externalRoot);
  });

  it("forget removes only the recent record and never deletes user files", () => {
    const f = fixture();
    const marker = path.join(f.externalRoot, "我的文件.txt");
    fs.writeFileSync(marker, "keep", "utf8");
    const entry = f.registry.register(f.externalRoot);
    expect(f.registry.forget(entry.id)).toBe(true);
    expect(f.registry.list().some((item) => item.id === entry.id)).toBe(false);
    expect(fs.readFileSync(marker, "utf8")).toBe("keep");
    expect(() => f.registry.forget(HOME_WORKSPACE_ID)).toThrow(/不能移除/);
  });

  it("persists display rename and archive without touching the external folder", () => {
    const f = fixture();
    const marker = path.join(f.externalRoot, "实验数据.csv");
    fs.writeFileSync(marker, "keep", "utf8");
    const entry = f.registry.register(f.externalRoot);

    expect(f.registry.update(entry.id, { name: "毕业论文资料", archived: true })).toMatchObject({
      id: entry.id,
      name: "毕业论文资料",
      archived: true,
    });
    expect(f.registry.list().find((item) => item.id === entry.id)).toMatchObject({
      name: "毕业论文资料",
      archived: true,
    });
    expect(fs.readFileSync(marker, "utf8")).toBe("keep");

    const reopened = createWorkspaceRegistry({
      homeRoot: f.homeRoot,
      registryFile: f.registryFile,
    });
    expect(reopened.list().find((item) => item.id === entry.id)).toMatchObject({
      name: "毕业论文资料",
      archived: true,
    });
  });

  it("migrates version 1 registry entries as unarchived", () => {
    const f = fixture();
    const entry = f.registry.register(f.externalRoot);
    const legacy = JSON.parse(fs.readFileSync(f.registryFile, "utf8")) as { workspaces: unknown[] };
    fs.writeFileSync(f.registryFile, `${JSON.stringify({ version: 1, workspaces: legacy.workspaces })}\n`, "utf8");

    const reopened = createWorkspaceRegistry({ homeRoot: f.homeRoot, registryFile: f.registryFile });
    expect(reopened.list().find((item) => item.id === entry.id)).toMatchObject({ archived: false });
  });

  it("rejects files and unknown ids with user-facing errors", () => {
    const f = fixture();
    const file = path.join(f.root, "not-a-folder.txt");
    fs.writeFileSync(file, "x", "utf8");
    expect(() => f.registry.register(file)).toThrow(/不是文件夹/);
    expect(() => f.registry.resolve("workspace-does-not-exist")).toThrow(/没有登记/);
  });

  it("survives a damaged registry and replaces it only when the user registers a new folder", () => {
    const f = fixture();
    fs.mkdirSync(path.dirname(f.registryFile), { recursive: true });
    fs.writeFileSync(f.registryFile, "{broken", "utf8");
    expect(f.registry.list().map((entry) => entry.id)).toEqual([HOME_WORKSPACE_ID]);

    const entry = f.registry.register(f.externalRoot);
    expect(f.registry.list().some((item) => item.id === entry.id)).toBe(true);
    expect(() => JSON.parse(fs.readFileSync(f.registryFile, "utf8"))).not.toThrow();
  });

  it("registers only the path returned by the trusted native picker and treats cancel as no-op", async () => {
    const f = fixture();
    const picker = vi.fn(async () => f.externalRoot);
    await expect(registerPickedWorkspace(f.registry, picker)).resolves.toMatchObject({ kind: "external" });
    expect(picker).toHaveBeenCalledOnce();

    const before = fs.readFileSync(f.registryFile, "utf8");
    await expect(registerPickedWorkspace(f.registry, async () => null)).resolves.toBeNull();
    expect(fs.readFileSync(f.registryFile, "utf8")).toBe(before);
  });
});
