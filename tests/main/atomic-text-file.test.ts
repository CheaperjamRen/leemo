import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { atomicReplaceTextFile } from "../../src/main/atomic-text-file";

const created: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function targetFile(): { dir: string; target: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-atomic-text-"));
  created.push(dir);
  const target = path.join(dir, "notes.md");
  fs.writeFileSync(target, "old", "utf8");
  return { dir, target };
}

describe("atomicReplaceTextFile", () => {
  it("replaces the file and leaves no staging file behind", () => {
    const { dir, target } = targetFile();

    atomicReplaceTextFile(target, "new", "old");

    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.readdirSync(dir)).toEqual(["notes.md"]);
  });

  it("keeps the original intact when staging the replacement fails", () => {
    const { dir, target } = targetFile();
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("ENOSPC");
    });

    expect(() => atomicReplaceTextFile(target, "new", "old")).toThrow(/ENOSPC/);
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["notes.md"]);
  });

  it("does not replace a baseline that already differs", () => {
    const { dir, target } = targetFile();

    expect(() => atomicReplaceTextFile(target, "new", "stale"))
      .toThrow(/其他地方发生了变化/);
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["notes.md"]);
  });
});
