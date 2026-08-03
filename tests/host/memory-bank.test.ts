import { describe, it, expect } from "vitest";
import { ensureMemoryBank, type MemoryBankIO } from "../../src/host/memory-bank";

/** In-memory fake IO — no real filesystem, mirrors the shape main.ts/dev.ts
 *  wire against real fs. */
function fakeIO(seed: Record<string, string> = {}): MemoryBankIO & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  return {
    files,
    exists: (path) => files.has(path),
    read: (path) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error(`File does not exist: ${path}`);
      return contents;
    },
    write: (path, contents) => {
      files.set(path, contents);
    },
    mkdirp: (path) => {
      dirs.add(path);
    },
  };
}

const WIN_DIR = "C:\\Users\\Rengar\\Leemo";
const POSIX_DIR = "/home/rengar/Leemo";

describe("legacy ensureMemoryBank fixture — reproduces the old five-file layout", () => {
  it("creates CLAUDE.md + memory/{bookmarks,profile,preferences,moments}.md", () => {
    const io = fakeIO();
    const created = ensureMemoryBank(WIN_DIR, io);

    expect(created.sort()).toEqual(
      [
        "CLAUDE.md",
        "memory\\bookmarks.md",
        "memory\\profile.md",
        "memory\\preferences.md",
        "memory\\moments.md",
      ].sort(),
    );
    expect(io.exists(`${WIN_DIR}\\CLAUDE.md`)).toBe(true);
    expect(io.exists(`${WIN_DIR}\\memory\\bookmarks.md`)).toBe(true);
    expect(io.exists(`${WIN_DIR}\\memory\\profile.md`)).toBe(true);
    expect(io.exists(`${WIN_DIR}\\memory\\preferences.md`)).toBe(true);
    expect(io.exists(`${WIN_DIR}\\memory\\moments.md`)).toBe(true);
  });

  it("titles each file per spec and marks empty state with 还没有记录", () => {
    const io = fakeIO();
    ensureMemoryBank(WIN_DIR, io);

    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("# momo 的记忆库");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("当前状态");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("记忆索引");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("核心事实");
    // Index lists all four memory/ files.
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("bookmarks.md");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("profile.md");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("preferences.md");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toContain("moments.md");

    expect(io.read(`${WIN_DIR}\\memory\\bookmarks.md`)).toContain("# 实时便签");
    expect(io.read(`${WIN_DIR}\\memory\\profile.md`)).toContain("# 用户画像");
    expect(io.read(`${WIN_DIR}\\memory\\preferences.md`)).toContain("# 偏好与雷区");
    expect(io.read(`${WIN_DIR}\\memory\\moments.md`)).toContain("# 重要时刻");

    for (const rel of ["CLAUDE.md", "memory\\bookmarks.md", "memory\\profile.md", "memory\\preferences.md", "memory\\moments.md"]) {
      expect(io.read(`${WIN_DIR}\\${rel}`)).toContain("还没有记录");
    }
  });

  it("bookmarks.md format line matches layer ⑥'s <YYYY-MM-DD HH:MM> convention", () => {
    const io = fakeIO();
    ensureMemoryBank(WIN_DIR, io);
    expect(io.read(`${WIN_DIR}\\memory\\bookmarks.md`)).toContain("<YYYY-MM-DD HH:MM>");
  });

  it("joins posix memory dirs without mangling the separator", () => {
    const io = fakeIO();
    const created = ensureMemoryBank(POSIX_DIR, io);
    expect(created.sort()).toEqual(
      [
        "CLAUDE.md",
        "memory/bookmarks.md",
        "memory/profile.md",
        "memory/preferences.md",
        "memory/moments.md",
      ].sort(),
    );
    expect(io.exists(`${POSIX_DIR}/memory/bookmarks.md`)).toBe(true);
    expect(io.exists(`${POSIX_DIR}\\memory\\bookmarks.md`)).toBe(false);
  });

  it("mkdirp's the memory/ subdirectory before writing into it", () => {
    const mkdirpCalls: string[] = [];
    const io: MemoryBankIO = {
      exists: () => false,
      read: () => "",
      write: () => {},
      mkdirp: (path) => mkdirpCalls.push(path),
    };
    ensureMemoryBank(WIN_DIR, io);
    expect(mkdirpCalls).toContain(`${WIN_DIR}\\memory`);
  });
});

describe("ensureMemoryBank — never touches an existing file (real memory, not a template)", () => {
  it("leaves a pre-existing CLAUDE.md byte-for-byte untouched", () => {
    const userWritten = "# momo 的记忆库\n\n## 当前状态\n用户在准备期末考。\n";
    const io = fakeIO({ [`${WIN_DIR}\\CLAUDE.md`]: userWritten });
    const created = ensureMemoryBank(WIN_DIR, io);

    expect(created).not.toContain("CLAUDE.md");
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toBe(userWritten);
  });

  it("leaves a pre-existing memory/bookmarks.md untouched while still seeding its missing siblings", () => {
    const userWritten = "# 实时便签\n\n<2026-07-24 10:00> 用户说在准备期末考 momo记住了\n";
    const io = fakeIO({ [`${WIN_DIR}\\memory\\bookmarks.md`]: userWritten });
    const created = ensureMemoryBank(WIN_DIR, io);

    expect(created).not.toContain("memory\\bookmarks.md");
    expect(io.read(`${WIN_DIR}\\memory\\bookmarks.md`)).toBe(userWritten);
    // The other three (+ CLAUDE.md) still get seeded — this file existing
    // doesn't block the rest of the bank.
    expect(created.sort()).toEqual(
      ["CLAUDE.md", "memory\\profile.md", "memory\\preferences.md", "memory\\moments.md"].sort(),
    );
  });

  it("is a true no-op (creates nothing) when all five files already exist", () => {
    const io = fakeIO({
      [`${WIN_DIR}\\CLAUDE.md`]: "existing",
      [`${WIN_DIR}\\memory\\bookmarks.md`]: "existing",
      [`${WIN_DIR}\\memory\\profile.md`]: "existing",
      [`${WIN_DIR}\\memory\\preferences.md`]: "existing",
      [`${WIN_DIR}\\memory\\moments.md`]: "existing",
    });
    const created = ensureMemoryBank(WIN_DIR, io);
    expect(created).toEqual([]);
    // Every file's content is exactly what it was before the call.
    expect(io.read(`${WIN_DIR}\\CLAUDE.md`)).toBe("existing");
    expect(io.read(`${WIN_DIR}\\memory\\bookmarks.md`)).toBe("existing");
    expect(io.read(`${WIN_DIR}\\memory\\profile.md`)).toBe("existing");
    expect(io.read(`${WIN_DIR}\\memory\\preferences.md`)).toBe("existing");
    expect(io.read(`${WIN_DIR}\\memory\\moments.md`)).toBe("existing");
  });

  it("calling ensureMemoryBank twice in a row is idempotent (no double-write, no error)", () => {
    const io = fakeIO();
    const first = ensureMemoryBank(WIN_DIR, io);
    expect(first.length).toBe(5);
    const second = ensureMemoryBank(WIN_DIR, io);
    expect(second).toEqual([]);
  });
});
