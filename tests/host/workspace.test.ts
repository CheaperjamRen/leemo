import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import * as workspaceModule from "../../src/host/workspace";
import {
  workspaceRootFor,
  listNotebooks,
  createNotebook,
  updateNotebookPresentation,
  readTree,
  dropFiles,
  moveFile,
  suggestNotebook,
  readNotebookMemory,
  readTextFile,
  readPreview,
  planWorkspaceReveal,
  resolveWorkspaceOpenFile,
  writeMarkdownFile,
  looksLikeText,
  PREVIEW_TEXT_MAX_BYTES,
  PREVIEW_BINARY_MAX_BYTES,
  ensureWorkspace,
  ensureStarterNotebook,
  STARTER_NOTEBOOK_TITLE,
  DEFAULT_WORKSPACE_DIR,
  LEGACY_INBOX_DIR,
  type WorkspaceIO,
} from "../../src/host/workspace";

/** In-memory filesystem good enough for the workspace manager's needs.
 *  Keyed by absolute path; directories are tracked as a separate set. */
function fakeFs(seed: {
  dirs?: string[];
  files?: Record<string, string>;
  /** Raw-byte files, for the preview reader's text-vs-binary decision (轮 4). */
  bytes?: Record<string, Buffer>;
  mtimes?: Record<string, number>;
} = {}) {
  const dirs = new Set<string>(seed.dirs ?? []);
  const files = new Map<string, string>(Object.entries(seed.files ?? {}));
  const blobs = new Map<string, Buffer>(Object.entries(seed.bytes ?? {}));
  const mtimes = new Map<string, number>(Object.entries(seed.mtimes ?? {}));

  /** Bytes of whatever is at `p`, however it was seeded. */
  const bytesAt = (p: string): Buffer | undefined => {
    const blob = blobs.get(p);
    if (blob !== undefined) return blob;
    const text = files.get(p);
    return text === undefined ? undefined : Buffer.from(text, "utf8");
  };

  // Every seeded file implies its parent chain exists.
  for (const f of files.keys()) {
    let dir = path.dirname(f);
    while (dir && !dirs.has(dir) && dir !== path.dirname(dir)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }

  const io: WorkspaceIO = {
    exists: (p) => dirs.has(p) || files.has(p) || blobs.has(p),
    isDirectory: (p) => dirs.has(p),
    mkdirp: (p) => {
      let dir = p;
      const chain: string[] = [];
      while (dir && !dirs.has(dir) && dir !== path.dirname(dir)) {
        chain.push(dir);
        dir = path.dirname(dir);
      }
      for (const d of chain.reverse()) dirs.add(d);
    },
    readdir: (p) => {
      if (!dirs.has(p)) throw new Error(`ENOENT: ${p}`);
      const out: { name: string; isDirectory: boolean }[] = [];
      for (const d of dirs) if (path.dirname(d) === p) out.push({ name: path.basename(d), isDirectory: true });
      for (const f of new Set([...files.keys(), ...blobs.keys()])) {
        if (path.dirname(f) === p) out.push({ name: path.basename(f), isDirectory: false });
      }
      return out;
    },
    // Byte length, not string length — the preview reader's size caps are in
    // bytes, and one CJK char is 3 of them.
    stat: (p) => ({ mtimeMs: mtimes.get(p) ?? 0, size: bytesAt(p)?.length ?? 0 }),
    readFile: (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    readBinary: (p, maxBytes) => {
      const buf = bytesAt(p);
      if (buf === undefined) throw new Error(`ENOENT: ${p}`);
      return maxBytes === undefined ? buf : buf.subarray(0, maxBytes);
    },
    writeFile: (p, contents) => {
      files.set(p, contents);
      let dir = path.dirname(p);
      while (dir && !dirs.has(dir) && dir !== path.dirname(dir)) {
        dirs.add(dir);
        dir = path.dirname(dir);
      }
    },
    replaceTextFile: (p, contents, expectedText) => {
      if (files.get(p) !== expectedText) {
        throw new Error("文件已在其他地方发生了变化。你的草稿还在，请重新载入后再保存。");
      }
      files.set(p, contents);
    },
    copyFile: (from, to) => {
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, v);
    },
    rename: (from, to) => {
      if (dirs.has(from)) {
        if (dirs.has(to) || files.has(to) || blobs.has(to)) throw new Error(`EEXIST: ${to}`);
        const beneath = (candidate: string): boolean => candidate === from || candidate.startsWith(`${from}${path.sep}`);
        const remap = (candidate: string): string => `${to}${candidate.slice(from.length)}`;
        for (const dir of [...dirs].filter(beneath).sort((a, b) => a.length - b.length)) {
          dirs.delete(dir);
          dirs.add(remap(dir));
        }
        for (const [file, value] of [...files].filter(([file]) => beneath(file))) {
          files.delete(file);
          files.set(remap(file), value);
        }
        for (const [file, value] of [...blobs].filter(([file]) => beneath(file))) {
          blobs.delete(file);
          blobs.set(remap(file), value);
        }
        return;
      }
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, v);
    },
    removeEmptyDir: (dir: string) => {
      const hasChildDir = [...dirs].some((candidate) => path.dirname(candidate) === dir);
      const hasChildFile = [...files.keys(), ...blobs.keys()].some((candidate) => path.dirname(candidate) === dir);
      if (hasChildDir || hasChildFile) throw new Error(`ENOTEMPTY: ${dir}`);
      dirs.delete(dir);
    },
  };

  return { io, dirs, files, blobs, mtimes };
}

const HOME = path.resolve("/fake-home");
const ROOT = path.join(HOME, "Leemo");
const j = (...parts: string[]): string => path.join(ROOT, ...parts);

describe("workspaceRootFor", () => {
  it("is <home>/Leemo — the same user-visible dir as the memory bank (06 §五)", () => {
    expect(workspaceRootFor(HOME)).toBe(ROOT);
  });
});

describe("migrateLegacyInbox", () => {
  type MigrateLegacyInbox = (
    root: string,
    io: WorkspaceIO,
  ) => {
    renamedLegacyRoot: boolean;
    moves: Array<{ from: string; to: string }>;
    conflicts: string[];
  };

  const migrate = (workspaceModule as unknown as { migrateLegacyInbox?: MigrateLegacyInbox })
    .migrateLegacyInbox;

  it("renames the intact legacy directory when the new default does not exist", () => {
    expect(migrate).toEqual(expect.any(Function));
    if (!migrate) return;
    const { io, dirs, files } = fakeFs({
      dirs: [ROOT, j("Inbox"), j("Inbox", "资料")],
      files: { [j("Inbox", "资料", "讲义.md")]: "body" },
    });

    const report = migrate(ROOT, io);

    expect(report).toEqual({
      renamedLegacyRoot: true,
      moves: [{ from: "Inbox", to: DEFAULT_WORKSPACE_DIR }],
      conflicts: [],
    });
    expect(dirs.has(j("Inbox"))).toBe(false);
    expect(dirs.has(j(DEFAULT_WORKSPACE_DIR, "资料"))).toBe(true);
    expect(files.get(j(DEFAULT_WORKSPACE_DIR, "资料", "讲义.md"))).toBe("body");
  });

  it("merges only non-conflicting entries and never overwrites a same-name file", () => {
    expect(migrate).toEqual(expect.any(Function));
    if (!migrate) return;
    const { io, dirs, files } = fakeFs({
      dirs: [ROOT, j("Inbox"), j(DEFAULT_WORKSPACE_DIR)],
      files: {
        [j("Inbox", "可移动.md")]: "legacy-only",
        [j("Inbox", "冲突.md")]: "legacy-version",
        [j(DEFAULT_WORKSPACE_DIR, "冲突.md")]: "current-version",
      },
    });

    const report = migrate(ROOT, io);

    expect(report).toEqual({
      renamedLegacyRoot: false,
      moves: [{ from: "Inbox/可移动.md", to: `${DEFAULT_WORKSPACE_DIR}/可移动.md` }],
      conflicts: ["Inbox/冲突.md"],
    });
    expect(files.get(j(DEFAULT_WORKSPACE_DIR, "可移动.md"))).toBe("legacy-only");
    expect(files.get(j(DEFAULT_WORKSPACE_DIR, "冲突.md"))).toBe("current-version");
    expect(files.get(j("Inbox", "冲突.md"))).toBe("legacy-version");
    expect(dirs.has(j("Inbox"))).toBe(true);
  });

  it("is idempotent after a completed rename", () => {
    expect(migrate).toEqual(expect.any(Function));
    if (!migrate) return;
    const fs = fakeFs({ dirs: [ROOT, j("Inbox")], files: { [j("Inbox", "a.md")]: "a" } });
    migrate(ROOT, fs.io);

    expect(migrate(ROOT, fs.io)).toEqual({
      renamedLegacyRoot: false,
      moves: [],
      conflicts: [],
    });
  });
});

describe("routeRootWritePath", () => {
  type RouteRootWritePath = (
    relativePath: string,
    containers: readonly string[],
    pathExists?: (normalizedRelativePath: string) => boolean,
  ) => string;
  const route = (workspaceModule as unknown as { routeRootWritePath?: RouteRootWritePath })
    .routeRootWritePath;
  const containers = [DEFAULT_WORKSPACE_DIR, "高等数学", "求职"];

  it.each([
    ["报告.md", `${DEFAULT_WORKSPACE_DIR}/报告.md`],
    ["资料/报告.md", `${DEFAULT_WORKSPACE_DIR}/资料/报告.md`],
    ["资料\\报告.md", `${DEFAULT_WORKSPACE_DIR}/资料/报告.md`],
  ])("routes an unscoped new path %s into the default workspace", (input, expected) => {
    expect(route).toEqual(expect.any(Function));
    if (!route) return;
    expect(route(input, containers)).toBe(expected);
  });

  it.each([
    [`${DEFAULT_WORKSPACE_DIR}/报告.md`, `${DEFAULT_WORKSPACE_DIR}/报告.md`],
    ["高等数学/报告.md", "高等数学/报告.md"],
    ["求职\\简历.md", "求职/简历.md"],
    ["C:\\Users\\R\\Desktop\\报告.md", "C:\\Users\\R\\Desktop\\报告.md"],
    ["/tmp/报告.md", "/tmp/报告.md"],
    ["../报告.md", "../报告.md"],
    [".leemo/memory/global/MEMORY.md", ".leemo/memory/global/MEMORY.md"],
  ])("preserves an explicit or security-sensitive path %s", (input, expected) => {
    expect(route).toEqual(expect.any(Function));
    if (!route) return;
    expect(route(input, containers)).toBe(expected);
  });

  it("preserves an existing root file instead of creating a default-workspace duplicate", () => {
    expect(route).toEqual(expect.any(Function));
    if (!route) return;
    expect(route("已有报告.md", containers, (candidate) => candidate === "已有报告.md")).toBe("已有报告.md");
  });
});

describe("listNotebooks", () => {
  it("returns one notebook per directory, alphabetical, id === directory name", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("高等数学"), j("数据结构")] });
    const books = listNotebooks(ROOT, io);
    expect(books.map((b) => b.id)).toEqual(["数据结构", "高等数学"]);
    expect(books[0]).toMatchObject({ id: "数据结构", title: "数据结构", dir: j("数据结构") });
  });

  it("skips current and legacy fallback dirs — migration conflicts never become notebooks", () => {
    const { io } = fakeFs({
      dirs: [ROOT, j("memory"), j(".claude"), j(DEFAULT_WORKSPACE_DIR), j(LEGACY_INBOX_DIR), j("真本子")],
      files: { [j("CLAUDE.md")]: "# index" },
    });
    expect(listNotebooks(ROOT, io).map((b) => b.id)).toEqual(["真本子"]);
  });

  it("is empty (not a throw) when the workspace does not exist yet", () => {
    const { io } = fakeFs();
    expect(listNotebooks(ROOT, io)).toEqual([]);
  });

  it("assigns a STABLE color per name (same name → same color across calls)", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("甲"), j("乙")] });
    const first = listNotebooks(ROOT, io);
    const second = listNotebooks(ROOT, io);
    expect(first.map((b) => b.color)).toEqual(second.map((b) => b.color));
    expect(["blue", "green", "red"]).toContain(first[0].color);
  });

  it("reports memory only when the temporal ledger replays to a current fact", () => {
    const currentEvent = JSON.stringify({
      version: 1,
      changeId: "change-current",
      action: "remember",
      before: [],
      after: [{ id: "memory-current", status: "current" }],
    });
    const deletedEvent = JSON.stringify({
      version: 1,
      changeId: "change-deleted",
      action: "remove",
      before: [],
      after: [{ id: "memory-deleted", status: "deleted" }],
    });
    const { io } = fakeFs({
      dirs: [ROOT, j("甲"), j("乙"), j("丙"), j("丁")],
      files: {
        [j("甲", "CLAUDE.md")]: "旧记忆文件不能再冒充当前记忆",
        [j("乙", ".leemo", "memory", "ledger.jsonl")]: `${currentEvent}\n`,
        [j("丙", ".leemo", "memory", "ledger.jsonl")]: `${deletedEvent}\n`,
        [j("丁", ".leemo", "memory", "ledger.jsonl")]: "broken-json\n",
      },
    });
    const books = listNotebooks(ROOT, io);
    expect(books.find((b) => b.id === "甲")!.hasMemory).toBe(false);
    expect(books.find((b) => b.id === "乙")!.hasMemory).toBe(true);
    expect(books.find((b) => b.id === "丙")!.hasMemory).toBe(false);
    expect(books.find((b) => b.id === "丁")!.hasMemory).toBe(false);
  });
});

describe("createNotebook", () => {
  it("really creates the directory and returns the notebook", () => {
    const { io, dirs } = fakeFs({ dirs: [ROOT] });
    const book = createNotebook(ROOT, "线性代数", io);
    expect(book.id).toBe("线性代数");
    expect(dirs.has(j("线性代数"))).toBe(true);
  });

  it("refuses a name that would escape the workspace", () => {
    const { io, dirs } = fakeFs({ dirs: [ROOT] });
    for (const bad of ["../evil", "a/b", "a\\b", "..", "C:\\tmp"]) {
      expect(() => createNotebook(ROOT, bad, io)).toThrow();
    }
    expect(dirs.has(path.join(HOME, "evil"))).toBe(false);
  });

  it("refuses reserved names and blank input", () => {
    const { io } = fakeFs({ dirs: [ROOT] });
    for (const bad of ["memory", ".leemo", ".claude", DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR, "   ", ""]) {
      expect(() => createNotebook(ROOT, bad, io)).toThrow();
    }
  });

  it("ACCEPTS ordinary names with spaces, hyphens, dots and digits", () => {
    // Regression: the first cut of isValidSegment folded space and '-' into the
    // Windows-illegal char class, so "高等数学 2024" and "my-notes" were refused
    // — a name the user would reasonably type, rejected with no way to tell why.
    const { io, dirs } = fakeFs({ dirs: [ROOT] });
    for (const ok of ["高等数学 2024", "my-notes", "CS 101", "v1.2 复习"]) {
      expect(() => createNotebook(ROOT, ok, io)).not.toThrow();
      expect(dirs.has(j(ok))).toBe(true);
    }
  });

  it("refuses a duplicate rather than silently adopting an existing dir", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("已存在")] });
    expect(() => createNotebook(ROOT, "已存在", io)).toThrow(/已经有/);
  });
});

describe("notebook presentation metadata", () => {
  it("renames only the displayed title, archives and restores without moving or deleting the real folder", () => {
    const { io, dirs, files } = fakeFs({ dirs: [ROOT, j("科研项目")] });

    const renamed = updateNotebookPresentation(ROOT, "科研项目", { title: "毕业论文" }, io);
    expect(renamed).toMatchObject({ id: "科研项目", title: "毕业论文", archived: false });
    expect(dirs.has(j("科研项目"))).toBe(true);
    expect(dirs.has(j("毕业论文"))).toBe(false);

    const archived = updateNotebookPresentation(ROOT, "科研项目", { archived: true }, io);
    expect(archived).toMatchObject({ id: "科研项目", title: "毕业论文", archived: true });
    expect(listNotebooks(ROOT, io)).toContainEqual(expect.objectContaining({
      id: "科研项目",
      title: "毕业论文",
      archived: true,
    }));

    updateNotebookPresentation(ROOT, "科研项目", { archived: false }, io);
    expect(listNotebooks(ROOT, io)[0]).toMatchObject({ archived: false });
    expect(files.get(j(".leemo", "notebooks.json"))).toContain("毕业论文");
  });

  it("falls back to physical folder names when presentation metadata is damaged", () => {
    const { io } = fakeFs({
      dirs: [ROOT, j("数据结构"), j(".leemo")],
      files: { [j(".leemo", "notebooks.json")]: "{broken" },
    });
    expect(listNotebooks(ROOT, io)).toContainEqual(expect.objectContaining({
      id: "数据结构",
      title: "数据结构",
      archived: false,
    }));
  });
});

describe("ensureStarterNotebook", () => {
  it("creates a real example notebook with useful starter files", () => {
    const { io, dirs, files } = fakeFs({ dirs: [ROOT] });
    const notebook = ensureStarterNotebook(ROOT, io);
    expect(notebook).toMatchObject({ id: STARTER_NOTEBOOK_TITLE, hasMemory: false });
    expect(dirs.has(j(STARTER_NOTEBOOK_TITLE))).toBe(true);
    expect(files.get(j(STARTER_NOTEBOOK_TITLE, "从这里开始.md"))).toContain("本周目标");
    expect(files.get(j(STARTER_NOTEBOOK_TITLE, "错题清单.md"))).toContain("错因");
    expect(files.get(j(STARTER_NOTEBOOK_TITLE, "CLAUDE.md"))).toContain("高等数学");
  });

  it("is idempotent and never overwrites a file the user already edited", () => {
    const edited = "这是我自己改过的内容";
    const { io, files } = fakeFs({
      dirs: [ROOT, j(STARTER_NOTEBOOK_TITLE)],
      files: { [j(STARTER_NOTEBOOK_TITLE, "从这里开始.md")]: edited },
    });
    expect(() => ensureStarterNotebook(ROOT, io)).not.toThrow();
    expect(() => ensureStarterNotebook(ROOT, io)).not.toThrow();
    expect(files.get(j(STARTER_NOTEBOOK_TITLE, "从这里开始.md"))).toBe(edited);
    expect(files.has(j(STARTER_NOTEBOOK_TITLE, "错题清单.md"))).toBe(true);
  });
});

describe("readTree", () => {
  it("mirrors the real directory, with workspace-RELATIVE paths whose first segment is the book id", () => {
    const { io } = fakeFs({
      dirs: [ROOT, j("数据结构"), j("数据结构", "第五章")],
      files: {
        [j("数据结构", "笔记.md")]: "n",
        [j("数据结构", "第五章", "树.md")]: "t",
      },
    });
    const roots = readTree(ROOT, io);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({ path: "数据结构", kind: "dir", bookId: "数据结构" });

    const children = roots[0].children!;
    // dirs before files, each alphabetical
    expect(children.map((c) => c.name)).toEqual(["第五章", "笔记.md"]);
    const chapter = children[0];
    expect(chapter.path).toBe("数据结构/第五章");
    expect(chapter.children![0]).toMatchObject({
      path: "数据结构/第五章/树.md",
      bookId: "数据结构",
      kind: "file",
    });
  });

  it("treats folders inside an external workspace as ordinary folders, not Leemo notebooks", () => {
    const { io } = fakeFs({
      dirs: [ROOT, j("src")],
      files: { [j("src", "index.ts")]: "export {};" },
    });
    const roots = readTree(ROOT, io, { notebookRoot: false });
    expect(roots[0]).toMatchObject({ path: "src", kind: "dir", bookId: null });
    expect(roots[0].children![0]).toMatchObject({ path: "src/index.ts", bookId: null });
  });

  it("hides .leemo, legacy .claude and memory but keeps 默认工作区 visible", () => {
    const { io } = fakeFs({
      dirs: [ROOT, j(".leemo"), j(".claude"), j("memory"), j(DEFAULT_WORKSPACE_DIR)],
      files: { [j(DEFAULT_WORKSPACE_DIR, "散件.pdf")]: "p" },
    });
    const names = readTree(ROOT, io).map((n) => n.name);
    expect(names).toContain(DEFAULT_WORKSPACE_DIR);
    expect(names).not.toContain(".leemo");
    expect(names).not.toContain(".claude");
    expect(names).not.toContain("memory");
  });

  it("marks a file touched in the last 24h as new", () => {
    const now = 1_000_000_000_000;
    const { io } = fakeFs({
      dirs: [ROOT, j("本")],
      files: { [j("本", "新.md")]: "a", [j("本", "旧.md")]: "b" },
      mtimes: { [j("本", "新.md")]: now - 1000, [j("本", "旧.md")]: now - 5 * 86_400_000 },
    });
    const files = readTree(ROOT, io, { now })[0].children!;
    expect(files.find((f) => f.name === "新.md")!.isNew).toBe(true);
    expect(files.find((f) => f.name === "旧.md")!.isNew).toBeFalsy();
  });

  it("is empty when the workspace does not exist", () => {
    const { io } = fakeFs();
    expect(readTree(ROOT, io)).toEqual([]);
  });
});

describe("dropFiles (06 §2.2 归类)", () => {
  const SRC = path.resolve("/downloads/讲义.pdf");

  it("copies into the target notebook and reports the workspace-relative landing spot", () => {
    const { io, files } = fakeFs({ dirs: [ROOT, j("高等数学")], files: { [SRC]: "pdf-bytes" } });
    const placed = dropFiles(ROOT, { sources: [SRC], notebookId: "高等数学" }, io);
    expect(placed).toEqual([{ path: "高等数学/讲义.pdf", name: "讲义.pdf", bookId: "高等数学" }]);
    expect(files.get(j("高等数学", "讲义.pdf"))).toBe("pdf-bytes");
    // COPY, not move: the user's original download must survive.
    expect(files.get(SRC)).toBe("pdf-bytes");
  });

  it("falls back to 默认工作区 when no notebook is given", () => {
    const { io, files } = fakeFs({ dirs: [ROOT], files: { [SRC]: "x" } });
    const placed = dropFiles(ROOT, { sources: [SRC], notebookId: null }, io);
    expect(placed[0]).toMatchObject({ path: "默认工作区/讲义.pdf", bookId: null });
    expect(files.has(j("默认工作区", "讲义.pdf"))).toBe(true);
  });

  it("copies into an external workspace root without 默认工作区 rerouting", () => {
    const { io, files } = fakeFs({ dirs: [ROOT], files: { [SRC]: "x" } });
    const placed = dropFiles(ROOT, { sources: [SRC], notebookId: null }, io, { directRoot: true });
    expect(placed[0]).toMatchObject({ path: "讲义.pdf", bookId: null });
    expect(files.has(j("讲义.pdf"))).toBe(true);
  });

  it("de-duplicates instead of overwriting an existing file", () => {
    const { io, files } = fakeFs({
      dirs: [ROOT, j("本")],
      files: { [SRC]: "new", [j("本", "讲义.pdf")]: "already-here" },
    });
    const placed = dropFiles(ROOT, { sources: [SRC], notebookId: "本" }, io);
    expect(placed[0].path).toBe("本/讲义 (2).pdf");
    expect(files.get(j("本", "讲义.pdf"))).toBe("already-here");
  });

  it("refuses an unknown / escaping notebook id", () => {
    const { io } = fakeFs({ dirs: [ROOT], files: { [SRC]: "x" } });
    expect(() => dropFiles(ROOT, { sources: [SRC], notebookId: "../evil" }, io)).toThrow();
    expect(() => dropFiles(ROOT, { sources: [SRC], notebookId: "不存在的本子" }, io)).toThrow();
  });
});

describe("moveFile (右键→移入本子)", () => {
  it("moves within the workspace and returns the new relative path", () => {
    const { io, files } = fakeFs({
      dirs: [ROOT, j(DEFAULT_WORKSPACE_DIR), j("目标")],
      files: { [j(DEFAULT_WORKSPACE_DIR, "a.md")]: "body" },
    });
    const moved = moveFile(ROOT, { path: `${DEFAULT_WORKSPACE_DIR}/a.md`, notebookId: "目标" }, io);
    expect(moved).toMatchObject({ path: "目标/a.md", bookId: "目标" });
    expect(files.has(j(DEFAULT_WORKSPACE_DIR, "a.md"))).toBe(false);
    expect(files.get(j("目标", "a.md"))).toBe("body");
  });

  it("rejects a source path that tries to escape the workspace", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("目标")] });
    for (const bad of ["../secrets.txt", "/etc/passwd", "..\\..\\x", path.join(HOME, "outside.md")]) {
      expect(() => moveFile(ROOT, { path: bad, notebookId: "目标" }, io)).toThrow();
    }
  });
});

describe("suggestNotebook (momo 的归属判断)", () => {
  const books = [
    { id: "高等数学", title: "高等数学" },
    { id: "数据结构", title: "数据结构" },
  ];

  it("suggests the notebook whose name the filename mentions", () => {
    expect(suggestNotebook("高等数学-第三章.pdf", books)).toBe("高等数学");
  });

  it("matches the other direction too (notebook name mentions the file stem)", () => {
    expect(suggestNotebook("数据结构.md", books)).toBe("数据结构");
  });

  it("returns null when it genuinely cannot tell — that is the 默认工作区 path", () => {
    expect(suggestNotebook("扫描件_0413.jpg", books)).toBeNull();
  });

  it("does not latch onto a 1-char coincidence", () => {
    expect(suggestNotebook("数.txt", books)).toBeNull();
  });
});

describe("readNotebookMemory (本子级 CLAUDE.md, 06 §7.4 中期层)", () => {
  it("reads <notebook>/CLAUDE.md", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("本")], files: { [j("本", "CLAUDE.md")]: "本子约定" } });
    expect(readNotebookMemory(ROOT, "本", io)).toEqual({
      text: "本子约定",
      dir: j("本"),
      title: "本",
    });
  });

  it("returns undefined when the notebook has no CLAUDE.md yet (normal state)", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("本")] });
    expect(readNotebookMemory(ROOT, "本", io)?.text).toBeUndefined();
    expect(readNotebookMemory(ROOT, "本", io)?.dir).toBe(j("本"));
  });

  it("returns undefined for an unknown or escaping id rather than throwing at prompt-build time", () => {
    const { io } = fakeFs({ dirs: [ROOT] });
    expect(readNotebookMemory(ROOT, "没有这个本子", io)).toBeUndefined();
    expect(readNotebookMemory(ROOT, "../..", io)).toBeUndefined();
  });
});

describe("readTextFile (预览面用)", () => {
  it("reads a file inside the workspace by relative path", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("本")], files: { [j("本", "a.md")]: "hello" } });
    expect(readTextFile(ROOT, "本/a.md", io)).toBe("hello");
  });

  it("refuses to read outside the workspace", () => {
    const { io } = fakeFs({ dirs: [ROOT], files: { [path.join(HOME, "secret.txt")]: "s" } });
    expect(() => readTextFile(ROOT, "../secret.txt", io)).toThrow();
  });
});

// ── 轮 4「预览区通电」──────────────────────────────────────────────────────
// 判据全在 main 侧、看真实字节：扩展名可以撒谎（.pdf 里装 zip、.txt 里装二进制），
// 而 readTextFile 那条路对 PDF 是**有损**的（utf8 解码回不去原字节）。

describe("looksLikeText", () => {
  it("accepts utf8 text including CJK and emoji", () => {
    expect(looksLikeText(Buffer.from("# 标题\n正文 🎈", "utf8"))).toBe(true);
    expect(looksLikeText(Buffer.from("", "utf8"))).toBe(true);
  });

  it("rejects a NUL byte — nothing we render as text contains one", () => {
    expect(looksLikeText(Buffer.from([0x68, 0x00, 0x69]))).toBe(false);
  });

  it("rejects bytes that are not valid utf8 (would render as 锟斤拷)", () => {
    // 0xFF 0xFE 单独出现不是合法 utf8 序列。
    expect(looksLikeText(Buffer.from([0xff, 0xfe, 0x41, 0x42]))).toBe(false);
  });

  it("does NOT reject a file merely because a CJK char straddles the 8KiB sample edge", () => {
    // 采样切断多字节字符会在末尾造一个 U+FFFD —— 那是采样假象，不是坏文件。
    // 用一个远超 8KiB 的纯中文文件：切点必然落在某个 3 字节字符中间。
    const big = Buffer.from("汉".repeat(20000), "utf8");
    expect(looksLikeText(big)).toBe(true);
  });
});

describe("readPreview", () => {
  it("returns text with its byte size for a markdown file", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("本")], files: { [j("本", "a.md")]: "# 标题" } });
    expect(readPreview(ROOT, "本/a.md", io)).toEqual({
      kind: "text",
      text: "# 标题",
      truncated: false,
      size: Buffer.from("# 标题", "utf8").length,
    });
  });

  it("returns text for an extensionless / unknown-extension file that IS text", () => {
    // "不认识的扩展名" 不等于 "不能预览"。README、.log、.json 都该照常显示。
    const { io } = fakeFs({ dirs: [ROOT], files: { [j("LICENSE")]: "MIT", [j("a.log")]: "line 1" } });
    expect(readPreview(ROOT, "LICENSE", io)).toMatchObject({ kind: "text", text: "MIT" });
    expect(readPreview(ROOT, "a.log", io)).toMatchObject({ kind: "text", text: "line 1" });
  });

  it("returns an empty-but-ready text payload for a 0-byte file", () => {
    const { io } = fakeFs({ dirs: [ROOT], files: { [j("empty.md")]: "" } });
    expect(readPreview(ROOT, "empty.md", io)).toEqual({ kind: "text", text: "", truncated: false, size: 0 });
  });

  it("truncates a huge text file instead of shipping it whole, and SAYS it truncated", () => {
    const huge = "a".repeat(PREVIEW_TEXT_MAX_BYTES + 500);
    const { io } = fakeFs({ dirs: [ROOT], bytes: { [j("big.txt")]: Buffer.from(huge, "utf8") } });
    const out = readPreview(ROOT, "big.txt", io);
    expect(out.kind).toBe("text");
    if (out.kind !== "text") throw new Error("unreachable");
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(PREVIEW_TEXT_MAX_BYTES);
    // size 报的是文件真实大小，不是截断后的长度 —— 界面要能说"共 x MB"。
    expect(out.size).toBe(huge.length);
  });

  it("returns a real raster image as guarded base64 bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    const { io } = fakeFs({ dirs: [ROOT], bytes: { [j("a.png")]: png } });
    const out = readPreview(ROOT, "a.png", io);
    expect(out).toEqual({
      kind: "binary",
      mimeType: "image/png",
      base64: png.toString("base64"),
      size: png.length,
      mtimeMs: 0,
    });
  });

  it("rejects a renamed non-image and an oversized image without reading the oversized bytes", () => {
    const renamed = fakeFs({ dirs: [ROOT], bytes: { [j("fake.png")]: Buffer.from("not an image") } });
    const invalid = readPreview(ROOT, "fake.png", renamed.io);
    expect(invalid.kind).toBe("unpreviewable");
    if (invalid.kind !== "unpreviewable") throw new Error("unreachable");
    expect(invalid.reason).toContain("图片");

    const readBinary = vi.fn();
    const huge = fakeFs({ dirs: [ROOT], files: { [j("huge.jpg")]: "x" } });
    const oversized = readPreview(ROOT, "huge.jpg", {
      ...huge.io,
      stat: () => ({ mtimeMs: 0, size: PREVIEW_BINARY_MAX_BYTES + 1 }),
      readBinary,
    });
    expect(oversized.kind).toBe("unpreviewable");
    if (oversized.kind !== "unpreviewable") throw new Error("unreachable");
    expect(oversized.reason).toContain("太大");
    expect(readBinary).not.toHaveBeenCalled();
  });

  it("returns a PDF as base64 bytes — the utf8 path is LOSSY and PDF.js needs the real bytes", () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0x00, 0xff, 0x10])]);
    const { io } = fakeFs({ dirs: [ROOT], bytes: { [j("doc.pdf")]: pdf } });
    const out = readPreview(ROOT, "doc.pdf", io);
    expect(out).toEqual({
      kind: "binary",
      mimeType: "application/pdf",
      base64: pdf.toString("base64"),
      size: pdf.length,
      mtimeMs: 0,
    });
    // 承重：base64 解回来必须和原字节逐字节相同。
    if (out.kind !== "binary") throw new Error("unreachable");
    expect(Buffer.from(out.base64, "base64").equals(pdf)).toBe(true);
  });

  it("catches a .pdf that is not actually a PDF (renamed zip) and says so", () => {
    // 只信扩展名会把这份东西喂给 PDF.js，症状是 worker 里一个看不懂的报错。
    const { io } = fakeFs({ dirs: [ROOT], bytes: { [j("fake.pdf")]: Buffer.from("PKrest", "utf8") } });
    const out = readPreview(ROOT, "fake.pdf", io);
    expect(out.kind).toBe("unpreviewable");
    if (out.kind !== "unpreviewable") throw new Error("unreachable");
    expect(out.reason).toContain("不是 PDF");
  });

  it("refuses an oversized PDF by size ALONE, without reading its bytes", () => {
    const readBinary = vi.fn();
    const { io } = fakeFs({ dirs: [ROOT], files: { [j("huge.pdf")]: "x" } });
    const out = readPreview(ROOT, "huge.pdf", {
      ...io,
      stat: () => ({ mtimeMs: 0, size: PREVIEW_BINARY_MAX_BYTES + 1 }),
      readBinary,
    });
    expect(out.kind).toBe("unpreviewable");
    if (out.kind !== "unpreviewable") throw new Error("unreachable");
    expect(out.reason).toContain("太大");
    // 承重：超限就别读。读了再判等于白吃一次几百兆的内存峰值。
    expect(readBinary).not.toHaveBeenCalled();
  });

  it("reads text files with a byte cap so a 400MB file never lands in memory whole", () => {
    const readBinary = vi.fn(() => Buffer.from("hi", "utf8"));
    const { io } = fakeFs({ dirs: [ROOT], files: { [j("a.txt")]: "hi" } });
    readPreview(ROOT, "a.txt", { ...io, readBinary });
    // 多读 1 字节是"有没有被截断"的判据，所以是 MAX+1 而不是 MAX。
    expect(readBinary).toHaveBeenCalledWith(expect.any(String), PREVIEW_TEXT_MAX_BYTES + 1);
  });

  it("refuses to escape the workspace, and says what a directory is", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("本")], files: { [path.join(HOME, "secret.txt")]: "s" } });
    // resolveInside 把 `..` 判成"路径不合法"（更早的一道），绝对路径才报"越出工作区"。
    expect(() => readPreview(ROOT, "../secret.txt", io)).toThrow(/路径不合法/);
    expect(() => readPreview(ROOT, "C:/secret.txt", io)).toThrow(/相对路径|工作区/);
    expect(() => readPreview(ROOT, "本", io)).toThrow(/文件夹/);
    expect(() => readPreview(ROOT, "本/nope.md", io)).toThrow(/读不到/);
  });
});

describe("planWorkspaceReveal", () => {
  it("selects files in Explorer instead of opening them", () => {
    const { io } = fakeFs({ files: { [j("本", "报告.md")]: "# 报告" } });

    expect(planWorkspaceReveal(ROOT, "本/报告.md", io)).toEqual({
      kind: "show-item",
      path: j("本", "报告.md"),
    });
  });

  it("opens directories and falls back to the nearest existing parent", () => {
    const { io } = fakeFs({ dirs: [ROOT, j("本"), j("本", "产物")] });

    expect(planWorkspaceReveal(ROOT, "本/产物", io)).toEqual({
      kind: "open-directory",
      path: j("本", "产物"),
    });
    expect(planWorkspaceReveal(ROOT, "本/产物/已删除.md", io)).toEqual({
      kind: "open-directory",
      path: j("本", "产物"),
    });
    expect(planWorkspaceReveal(ROOT, "", io)).toEqual({
      kind: "open-directory",
      path: ROOT,
    });
  });

  it("keeps renderer paths inside the selected workspace", () => {
    const { io } = fakeFs({ dirs: [ROOT] });
    expect(() => planWorkspaceReveal(ROOT, "../secret.txt", io)).toThrow(/路径不合法/);
  });
});

describe("resolveWorkspaceOpenFile", () => {
  it("returns only an existing regular file after canonical boundary validation", () => {
    const target = j("本", "报告.pdf");
    const { io } = fakeFs({ dirs: [ROOT, j("本")], files: { [target]: "%PDF-1.7" } });

    expect(resolveWorkspaceOpenFile(ROOT, "本/报告.pdf", io, {
      canonicalize: path.resolve,
      isFile: (candidate) => candidate === target,
    })).toBe(target);
    expect(() => resolveWorkspaceOpenFile(ROOT, "本", io, {
      canonicalize: path.resolve,
      isFile: () => false,
    })).toThrow(/普通文件/);
    expect(() => resolveWorkspaceOpenFile(ROOT, "本/不存在.pdf", io, {
      canonicalize: path.resolve,
      isFile: () => true,
    })).toThrow(/读不到这个文件/);
  });

  it("rejects a symlink or junction whose canonical target escapes the workspace", () => {
    const link = j("本", "外部.pdf");
    const outside = path.join(HOME, "outside", "外部.pdf");
    const { io } = fakeFs({ dirs: [ROOT, j("本")], files: { [link]: "%PDF-1.7" } });

    expect(() => resolveWorkspaceOpenFile(ROOT, "本/外部.pdf", io, {
      canonicalize: (candidate) => candidate === link ? outside : path.resolve(candidate),
      isFile: () => true,
    })).toThrow(/真实位置越出了当前工作区/);
  });
});

describe("writeMarkdownFile", () => {
  it("updates an existing markdown file only when the loaded baseline still matches", () => {
    const target = j("本", "报告.md");
    const { io, files } = fakeFs({ files: { [target]: "# 旧稿" } });

    expect(writeMarkdownFile(ROOT, "本/报告.md", "# 新稿", "# 旧稿", io)).toEqual({
      kind: "text",
      text: "# 新稿",
      truncated: false,
      size: Buffer.byteLength("# 新稿"),
    });
    expect(files.get(target)).toBe("# 新稿");
  });

  it("keeps the draft out of the file when another app changed it first", () => {
    const target = j("本", "报告.md");
    const { io, files } = fakeFs({ files: { [target]: "# 外部修改" } });

    expect(() => writeMarkdownFile(ROOT, "本/报告.md", "# 我的草稿", "# 旧稿", io))
      .toThrow(/其他地方发生了变化/);
    expect(files.get(target)).toBe("# 外部修改");
  });

  it("keeps the original when the staged replacement cannot be completed", () => {
    const target = j("本", "报告.md");
    const { io, files } = fakeFs({ files: { [target]: "# 旧稿" } });
    const failingIO: WorkspaceIO = {
      ...io,
      replaceTextFile: () => { throw new Error("ENOSPC"); },
    };

    expect(() => writeMarkdownFile(ROOT, "本/报告.md", "# 新稿", "# 旧稿", failingIO))
      .toThrow(/ENOSPC/);
    expect(files.get(target)).toBe("# 旧稿");
  });

  it("does not turn the renderer write route into an arbitrary workspace writer", () => {
    const { io } = fakeFs({
      files: {
        [j("本", "notes.txt")]: "text",
        [j(".leemo", "memory.md")]: "private",
      },
    });

    expect(() => writeMarkdownFile(ROOT, "本/notes.txt", "changed", "text", io)).toThrow(/Markdown/);
    expect(() => writeMarkdownFile(ROOT, ".leemo/memory.md", "changed", "private", io)).toThrow(/内部文件/);
    expect(() => writeMarkdownFile(ROOT, "本/missing.md", "new", "", io)).toThrow(/读不到/);
    expect(() => writeMarkdownFile(
      ROOT,
      "本/large.md",
      "a".repeat(PREVIEW_TEXT_MAX_BYTES + 1),
      "",
      io,
    )).toThrow(/太大/);
  });

  it("treats a memory folder in an external workspace as ordinary user content", () => {
    const target = j("memory", "project-notes.md");
    const { io, files } = fakeFs({ files: { [target]: "# old" } });

    writeMarkdownFile(ROOT, "memory/project-notes.md", "# new", "# old", io, {
      protectLegacyMemory: false,
    });

    expect(files.get(target)).toBe("# new");
  });

  it("refuses a workspace link whose canonical target is outside the workspace", () => {
    const target = j("linked.md");
    const outside = path.join(HOME, "outside.md");
    const { io, files } = fakeFs({ files: { [target]: "# old" } });

    expect(() => writeMarkdownFile(ROOT, "linked.md", "# new", "# old", io, {
      canonicalize: (candidate) => candidate === target ? outside : candidate,
    })).toThrow(/工作区/);
    expect(files.get(target)).toBe("# old");
  });

  it("normalizes the relative path before enforcing protected roots", () => {
    const target = j(".leemo", "internal.md");
    const { io, files } = fakeFs({ files: { [target]: "# private" } });

    expect(() => writeMarkdownFile(ROOT, " .leemo/internal.md ", "# changed", "# private", io))
      .toThrow(/内部文件/);
    expect(files.get(target)).toBe("# private");
  });

  it("enforces protected roots and markdown type on the canonical target", () => {
    const alias = j("alias.md");
    const privateTarget = j(".leemo", "internal.md");
    const textTarget = j("notes.txt");
    const { io, files } = fakeFs({ files: { [alias]: "old" } });

    expect(() => writeMarkdownFile(ROOT, "alias.md", "new", "old", io, {
      canonicalize: (candidate) => candidate === alias ? privateTarget : candidate,
    })).toThrow(/内部文件/);
    expect(() => writeMarkdownFile(ROOT, "alias.md", "new", "old", io, {
      canonicalize: (candidate) => candidate === alias ? textTarget : candidate,
    })).toThrow(/Markdown/);
    expect(files.get(alias)).toBe("old");
  });
});

describe("ensureWorkspace", () => {
  it("creates the root and 默认工作区, idempotently", () => {
    const { io, dirs } = fakeFs();
    ensureWorkspace(ROOT, io);
    expect(dirs.has(ROOT)).toBe(true);
    expect(dirs.has(j(DEFAULT_WORKSPACE_DIR))).toBe(true);
    expect(() => ensureWorkspace(ROOT, io)).not.toThrow();
  });
});
