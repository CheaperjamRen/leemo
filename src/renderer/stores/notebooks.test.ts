import { describe, it, expect, vi } from "vitest";
import { createNotebooksStore } from "./notebooks";
import type { WorkspaceClient, WorkspaceNotebook } from "../workspace/client";

// 轮 3 卡 G rewrote this suite: a notebook is now a DIRECTORY under ~/Leemo, so
// the old assertions (synthetic "notebook-1" ids, creation-order color cycling,
// isSample) no longer describe anything real. id === title === directory name,
// and the color is a stable hash of that name computed in the main process.

const nb = (id: string, over: Partial<WorkspaceNotebook> = {}): WorkspaceNotebook => ({
  id,
  title: id,
  dir: `/w/Leemo/${id}`,
  color: "blue",
  hasMemory: false,
  ...over,
});

function fakeWorkspace(initial: WorkspaceNotebook[] = []): WorkspaceClient & { created: string[] } {
  let books = [...initial];
  const created: string[] = [];
  return {
    created,
    listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [...books] }),
    createNotebook: async (title: string) => {
      if (books.some((b) => b.id === title)) throw new Error(`已经有一个叫「${title}」的本子了`);
      created.push(title);
      const book = nb(title);
      books = [...books, book];
      return book;
    },
    updateNotebook: async (id, input) => {
      const current = books.find((book) => book.id === id);
      if (!current) throw new Error("没有这个本子");
      const updated = { ...current, ...input };
      books = books.map((book) => book.id === id ? updated : book);
      return updated;
    },
    ensureStarterNotebook: async () => nb("例：高等数学", { hasMemory: true }),
    readTree: async () => [],
    dropFiles: async () => [],
    moveFile: async () => ({ path: "x", name: "x", bookId: null }),
    suggestNotebook: async () => null,
    readTextFile: async () => "",
    readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
    reveal: async () => {},
    pathForFile: () => "",
  };
}

describe("notebooks store — 本子 = 目录 (轮 3 卡 G)", () => {
  it("stays empty and refresh is a no-op with no workspace client (browser dev)", async () => {
    const store = createNotebooksStore();
    expect(store.getState().list).toEqual([]);
    await store.getState().refresh();
    expect(store.getState().list).toEqual([]);
  });

  it("refresh() loads the real notebook directories", async () => {
    const ws = fakeWorkspace([nb("数据结构"), nb("高等数学", { hasMemory: true })]);
    const store = createNotebooksStore(ws);
    await store.getState().refresh();
    expect(store.getState().list.map((b) => b.id)).toEqual(["数据结构", "高等数学"]);
    expect(store.getState().list[1].hasMemory).toBe(true);
    expect(store.getState().root).toBe("/w/Leemo");
  });

  it("createNotebook() really creates a directory, and the list reflects it", async () => {
    const ws = fakeWorkspace();
    const store = createNotebooksStore(ws);
    const id = await store.getState().createNotebook("线性代数");
    expect(id).toBe("线性代数");
    expect(ws.created).toEqual(["线性代数"]);
    expect(store.getState().list.map((b) => b.id)).toEqual(["线性代数"]);
  });

  it("surfaces a create failure verbatim instead of pretending it worked", async () => {
    const ws = fakeWorkspace([nb("已存在")]);
    const store = createNotebooksStore(ws);
    await expect(store.getState().createNotebook("已存在")).rejects.toThrow(/已经有/);
    // The old store appended optimistically. A failed mkdir must NOT leave a
    // notebook in the list with no directory behind it.
    expect(store.getState().list).toEqual([]);
    expect(store.getState().error).toMatch(/已经有/);
  });

  it("does not touch the filesystem for a blank title", async () => {
    const ws = fakeWorkspace();
    const store = createNotebooksStore(ws);
    await expect(store.getState().createNotebook("   ")).rejects.toThrow();
    expect(ws.created).toEqual([]);
  });

  it("selects a newly created notebook so the next drop lands in it", async () => {
    const store = createNotebooksStore(fakeWorkspace());
    await store.getState().createNotebook("新本子");
    expect(store.getState().activeId).toBe("新本子");
  });

  it("persists display rename and archive, then leaves an archived active notebook", async () => {
    const store = createNotebooksStore(fakeWorkspace([nb("科研项目")]));
    await store.getState().refresh();
    store.getState().setActive("科研项目");

    await store.getState().renameNotebook("科研项目", "毕业论文");
    expect(store.getState().list[0]).toMatchObject({ id: "科研项目", title: "毕业论文" });

    await store.getState().setNotebookArchived("科研项目", true);
    expect(store.getState().list[0]).toMatchObject({ archived: true });
    expect(store.getState().activeId).toBeNull();
  });

  it("tracks the active notebook (drives 拖入归类 + prompt layer ⑨)", async () => {
    const store = createNotebooksStore(fakeWorkspace([nb("甲"), nb("乙")]));
    await store.getState().refresh();
    expect(store.getState().activeId).toBeNull();
    store.getState().setActive("乙");
    expect(store.getState().activeId).toBe("乙");
    store.getState().setActive(null);
    expect(store.getState().activeId).toBeNull();
  });

  it("clears an active notebook that no longer exists on disk", async () => {
    // The user can delete the folder in Explorer between refreshes; a dangling
    // activeId would keep feeding a dead bookId into new conversations.
    const store = createNotebooksStore({
      ...fakeWorkspace(),
      listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [] }),
    });
    store.setState({ activeId: "会被删掉", list: [nb("会被删掉")] });
    await store.getState().refresh();
    expect(store.getState().activeId).toBeNull();
  });

  it("reports a refresh failure without wiping the list it already had", async () => {
    const store = createNotebooksStore({
      ...fakeWorkspace(),
      listNotebooks: async () => {
        throw new Error("EACCES");
      },
    });
    store.setState({ list: [nb("甲")] });
    await store.getState().refresh();
    expect(store.getState().list.map((b) => b.id)).toEqual(["甲"]);
    expect(store.getState().error).toMatch(/EACCES/);
  });

  it("de-duplicates concurrent refreshes into one filesystem read", async () => {
    const listNotebooks = vi.fn(async () => ({ root: "/w/Leemo", notebooks: [nb("甲")] }));
    const store = createNotebooksStore({ ...fakeWorkspace(), listNotebooks });
    await Promise.all([store.getState().refresh(), store.getState().refresh()]);
    expect(listNotebooks).toHaveBeenCalledTimes(1);
  });
});
