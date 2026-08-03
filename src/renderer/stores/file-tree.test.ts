import { describe, it, expect, vi } from "vitest";
import { createFileTreeStore, type FileNode } from "./file-tree";
import type { WorkspaceClient, PlacedFile } from "../workspace/client";

// 轮 3 卡 G: paths are workspace-RELATIVE and the FIRST SEGMENT is the notebook
// id. The old fixture used "/books/A/file.md", whose first segment is "books" —
// which silently broke artifacts.ts bookForPath.
const ROOTS: FileNode[] = [
  {
    path: "数据结构",
    name: "数据结构",
    kind: "dir",
    bookId: "数据结构",
    children: [{ path: "数据结构/笔记.md", name: "笔记.md", kind: "file", bookId: "数据结构" }],
  },
  { path: "默认工作区/散件.pdf", name: "散件.pdf", kind: "file", bookId: null },
];

function fakeWorkspace(over: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [] }),
    createNotebook: async () => ({ id: "x", title: "x", dir: "/w/Leemo/x", color: "blue", hasMemory: false }),
    ensureStarterNotebook: async () => ({ id: "例：高等数学", title: "例：高等数学", dir: "/w/Leemo/例：高等数学", color: "blue", hasMemory: true }),
    readTree: async () => ROOTS,
    dropFiles: async () => [],
    moveFile: async () => ({ path: "x", name: "x", bookId: null }),
    suggestNotebook: async () => null,
    readTextFile: async () => "",
    readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
    reveal: async () => {},
    pathForFile: () => "",
    ...over,
  };
}

describe("file-tree store — expand state", () => {
  it("toggleExpand adds then removes a path", () => {
    const store = createFileTreeStore(undefined, ROOTS);
    store.getState().toggleExpand("数据结构");
    expect(store.getState().expandedPaths.has("数据结构")).toBe(true);
    store.getState().toggleExpand("数据结构");
    expect(store.getState().expandedPaths.has("数据结构")).toBe(false);
  });

  it("initializes with provided roots and no filesystem", () => {
    const store = createFileTreeStore(undefined, ROOTS);
    expect(store.getState().roots).toEqual(ROOTS);
    expect(store.getState().expandedPaths.size).toBe(0);
  });
});

describe("file-tree store — real ~/Leemo tree (轮 3 卡 G)", () => {
  it("refresh() loads the real tree, first segment === notebook id", async () => {
    const store = createFileTreeStore(fakeWorkspace());
    await store.getState().refresh();
    expect(store.getState().roots[0].path).toBe("数据结构");
    expect(store.getState().roots[0].children![0].bookId).toBe("数据结构");
    // 默认工作区 files are unfiled: bookId remains null.
    expect(store.getState().roots[1].bookId).toBeNull();
  });

  it("keeps the visible tree when a read fails", async () => {
    const store = createFileTreeStore(
      fakeWorkspace({ readTree: async () => { throw new Error("EPERM"); } }),
      ROOTS,
    );
    await store.getState().refresh();
    expect(store.getState().roots).toEqual(ROOTS);
    expect(store.getState().error).toMatch(/EPERM/);
  });

  it("moveToBook MOVES the file on disk and re-reads the tree", async () => {
    // The old store only relabelled bookId in memory: the file never moved, so
    // the label was a claim the next refresh silently reverted.
    const moveFile = vi.fn(
      async (path: string, notebookId: string | null): Promise<PlacedFile> => ({
        path: `${notebookId}/${path.split("/").pop()}`,
        name: path.split("/").pop()!,
        bookId: notebookId,
      }),
    );
    const readTree = vi.fn(async () => ROOTS);
    const store = createFileTreeStore(fakeWorkspace({ moveFile, readTree }));

    await store.getState().moveToBook("默认工作区/散件.pdf", "数据结构");
    expect(moveFile).toHaveBeenCalledWith("默认工作区/散件.pdf", "数据结构");
    expect(readTree).toHaveBeenCalledTimes(1); // truth comes from disk, not local edits
  });

  it("propagates a failed move instead of showing it as done", async () => {
    const store = createFileTreeStore(
      fakeWorkspace({ moveFile: async () => { throw new Error("没有这个本子：X"); } }),
      ROOTS,
    );
    await expect(store.getState().moveToBook("默认工作区/散件.pdf", "X")).rejects.toThrow(/没有这个本子/);
    expect(store.getState().error).toMatch(/没有这个本子/);
    expect(store.getState().roots).toEqual(ROOTS);
  });

  it("dropFiles files OS paths into a notebook, re-reads, and reveals where they landed", async () => {
    const dropFiles = vi.fn(async (): Promise<PlacedFile[]> => [
      { path: "数据结构/讲义.pdf", name: "讲义.pdf", bookId: "数据结构" },
    ]);
    const readTree = vi.fn(async () => ROOTS);
    const store = createFileTreeStore(fakeWorkspace({ dropFiles, readTree }));

    const placed = await store.getState().dropFiles(["C:\\Downloads\\讲义.pdf"], "数据结构");
    expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\讲义.pdf"], "数据结构");
    expect(placed[0].path).toBe("数据结构/讲义.pdf");
    expect(readTree).toHaveBeenCalledTimes(1);
    // Auto-expand the receiving notebook: a drop the user cannot see looks lost.
    expect(store.getState().expandedPaths.has("数据结构")).toBe(true);
  });

  it("does not expand a notebook for a 默认工作区 drop", async () => {
    const store = createFileTreeStore(
      fakeWorkspace({
        dropFiles: async () => [{ path: "默认工作区/a.pdf", name: "a.pdf", bookId: null }],
      }),
    );
    await store.getState().dropFiles(["/d/a.pdf"], null);
    expect(store.getState().expandedPaths.size).toBe(0);
  });

  it("de-duplicates concurrent refreshes", async () => {
    const readTree = vi.fn(async () => ROOTS);
    const store = createFileTreeStore(fakeWorkspace({ readTree }));
    await Promise.all([store.getState().refresh(), store.getState().refresh()]);
    expect(readTree).toHaveBeenCalledTimes(1);
  });

  it("reads the currently selected workspace by opaque id", async () => {
    const readTree = vi.fn(async () => ROOTS);
    const store = createFileTreeStore(
      fakeWorkspace({ readTree }),
      [],
      { resolveWorkspaceId: () => "workspace-123" },
    );
    await store.getState().refresh();
    expect(readTree).toHaveBeenCalledWith("workspace-123");
  });

  it("does not let a slower previous workspace overwrite the selected project tree", async () => {
    const homeRoots: FileNode[] = [{ path: "home.md", name: "home.md", kind: "file", bookId: null }];
    const projectRoots: FileNode[] = [{ path: "project.md", name: "project.md", kind: "file", bookId: null }];
    let activeWorkspaceId = "leemo-home";
    let resolveHome!: (value: FileNode[]) => void;
    let resolveProject!: (value: FileNode[]) => void;
    const readTree = vi.fn((workspaceId?: string) => new Promise<FileNode[]>((resolve) => {
      if (workspaceId === "workspace-123") resolveProject = resolve;
      else resolveHome = resolve;
    }));
    const store = createFileTreeStore(
      fakeWorkspace({ readTree }),
      [],
      { resolveWorkspaceId: () => activeWorkspaceId },
    );

    const homeRead = store.getState().refresh();
    activeWorkspaceId = "workspace-123";
    const projectRead = store.getState().refresh();
    expect(readTree).toHaveBeenCalledTimes(2);
    resolveProject(projectRoots);
    await projectRead;
    resolveHome(homeRoots);
    await homeRead;

    expect(store.getState().roots).toEqual(projectRoots);
  });

  it("mutating ops are safe no-ops without a workspace (browser dev)", async () => {
    const store = createFileTreeStore(undefined, ROOTS);
    await expect(store.getState().moveToBook("默认工作区/a.md", "X")).resolves.toBeUndefined();
    await expect(store.getState().dropFiles(["/d/a.pdf"], null)).resolves.toEqual([]);
  });
});
