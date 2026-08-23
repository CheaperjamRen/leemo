import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHumanFolderRegistry } from "../../src/main/human-folder-registry";
import { expectSameExistingPath } from "../helpers/path-identity";

const cleanup: string[] = [];

afterEach(() => {
  for (const target of cleanup.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-human-folders-"));
  cleanup.push(root);
  const folder = path.join(root, "Documents", "求职资料");
  const registryFile = path.join(root, "user-data", "human-folders.json");
  fs.mkdirSync(folder, { recursive: true });
  let now = 100;
  return {
    root,
    folder,
    registryFile,
    registry: createHumanFolderRegistry({ registryFile, now: () => now }),
    advance(value = 1) { now += value; },
  };
}

describe("HumanFolderRegistry", () => {
  it("keeps a human-only shortcut across restart without writing into the selected folder", () => {
    const f = fixture();
    const entry = f.registry.register(f.folder);

    expect(entry.id).toMatch(/^human-folder-[a-f0-9]{20}$/);
    expect(entry.name).toBe("求职资料");
    expect(entry.available).toBe(true);
    expect(fs.existsSync(path.join(f.folder, ".leemo"))).toBe(false);

    const reopened = createHumanFolderRegistry({ registryFile: f.registryFile });
    const restored = reopened.list().find((item) => item.id === entry.id);
    expect(restored).toMatchObject({ name: "求职资料", available: true });
    expectSameExistingPath(restored?.displayPath, f.folder);
  });

  it("reports unavailable shortcuts without silently forgetting them", () => {
    const f = fixture();
    const entry = f.registry.register(f.folder);
    const moved = `${f.folder}-moved`;
    fs.renameSync(f.folder, moved);

    expect(f.registry.list().find((item) => item.id === entry.id)?.available).toBe(false);
    expect(() => f.registry.resolve(entry.id)).toThrow(/找不到这个文件夹/);
  });

  it("touches and orders shortcuts by last use", () => {
    const f = fixture();
    const other = path.join(f.root, "Documents", "论文");
    fs.mkdirSync(other, { recursive: true });
    const first = f.registry.register(f.folder);
    f.advance(10);
    const second = f.registry.register(other);
    expect(f.registry.list().map((item) => item.id)).toEqual([second.id, first.id]);

    f.advance(10);
    f.registry.touch(first.id);
    expect(f.registry.list().map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("forget removes only Leemo's shortcut and never deletes the folder or its files", () => {
    const f = fixture();
    const marker = path.join(f.folder, "简历.md");
    fs.writeFileSync(marker, "keep", "utf8");
    const entry = f.registry.register(f.folder);

    expect(f.registry.forget(entry.id)).toBe(true);
    expect(f.registry.list()).toEqual([]);
    expect(fs.readFileSync(marker, "utf8")).toBe("keep");
  });

  it("rejects a file because the familiar-folder surface only accepts directories", () => {
    const f = fixture();
    const file = path.join(f.root, "not-a-folder.txt");
    fs.writeFileSync(file, "x", "utf8");
    expect(() => f.registry.register(file)).toThrow(/不是文件夹/);
  });
});
