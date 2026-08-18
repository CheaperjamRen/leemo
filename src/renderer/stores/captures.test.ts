import { describe, expect, it, vi } from "vitest";
import type { CaptureClient } from "../capture/client";
import type { Note } from "../../captures";
import { createCapturesStore } from "./captures";

const first: Note = {
  id: "note-1",
  title: "面试前确认",
  markdown: "- [ ] 带作品集",
  revision: 1,
  createdAt: 10,
  updatedAt: 10,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
};

const second: Note = {
  id: "note-2",
  title: "",
  markdown: "记录一个还没有标题的想法",
  revision: 1,
  createdAt: 20,
  updatedAt: 20,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
};

function captureClient(overrides: Partial<CaptureClient> = {}): CaptureClient {
  return {
    getQuickDraft: vi.fn(),
    saveQuickDraft: vi.fn(),
    commitQuickDraft: vi.fn(),
    listNotes: vi.fn(async () => []),
    listArchivedNotes: vi.fn(async () => []),
    createNote: vi.fn(async () => first),
    updateNote: vi.fn(async () => first),
    moveNote: vi.fn(async () => [first]),
    setNotePinned: vi.fn(async () => first),
    markNoteOrganized: vi.fn(async () => first),
    archiveNote: vi.fn(async () => ({ ...first, archivedAt: 20, revision: 2 })),
    unarchiveNote: vi.fn(async () => first),
    deleteNote: vi.fn(async () => undefined),
    onChanged: vi.fn(() => vi.fn()),
    ...overrides,
  } as CaptureClient;
}

describe("captures store", () => {
  it("keeps the browser fixture as an honest empty ready state", async () => {
    const store = createCapturesStore();

    expect(store.getState()).toMatchObject({
      notes: [],
      status: "ready",
      error: null,
      selectedId: null,
    });

    await store.getState().refresh();
    expect(store.getState().notes).toEqual([]);
  });

  it("loads the note list from the capture client", async () => {
    const listNotes = vi.fn(async () => [second, first]);
    const store = createCapturesStore(captureClient({ listNotes }));

    await store.getState().refresh();

    expect(listNotes).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      notes: [second, first],
      status: "ready",
      error: null,
    });
  });

  it("creates a real note and selects the returned record", async () => {
    const createNote = vi.fn(async () => second);
    const store = createCapturesStore(captureClient({ createNote }));

    const created = await store.getState().createNote({
      title: "",
      markdown: second.markdown,
    });

    expect(createNote).toHaveBeenCalledWith({ title: "", markdown: second.markdown });
    expect(created).toEqual(second);
    expect(store.getState()).toMatchObject({
      notes: [second],
      selectedId: second.id,
      saving: false,
      error: null,
    });
  });

  it("updates with the visible revision and keeps the old record when saving fails", async () => {
    const updated = { ...first, title: "面试材料", revision: 2, updatedAt: 30 };
    const updateNote = vi.fn()
      .mockResolvedValueOnce(updated)
      .mockRejectedValueOnce(new Error("内容已在别处更新，请刷新后重试。"));
    const store = createCapturesStore(captureClient({
      listNotes: vi.fn(async () => [first]),
      updateNote,
    }));
    await store.getState().refresh();

    await expect(store.getState().updateNote({
      id: first.id,
      title: updated.title,
      markdown: first.markdown,
      expectedRevision: first.revision,
    })).resolves.toEqual(updated);
    expect(store.getState().notes).toEqual([updated]);

    await expect(store.getState().updateNote({
      id: first.id,
      title: "不会覆盖",
      markdown: first.markdown,
      expectedRevision: updated.revision,
    })).rejects.toThrow("内容已在别处更新，请刷新后重试。");
    expect(store.getState().notes).toEqual([updated]);
    expect(store.getState()).toMatchObject({
      saving: false,
      error: "内容已在别处更新，请刷新后重试。",
    });
  });

  it("applies an organization sibling snapshot without refreshing or losing selection", async () => {
    const movedFirst = { ...first, sortOrder: 1 };
    const movedSecond = { ...second, sortOrder: 0, revision: 2, parentId: first.id };
    const listNotes = vi.fn(async () => [first, second]);
    const moveNote = vi.fn(async () => [movedFirst, movedSecond]);
    const store = createCapturesStore(captureClient({ listNotes, moveNote }));
    await store.getState().refresh();
    store.getState().selectNote(second.id);

    await expect(store.getState().moveNote({
      id: second.id,
      expectedRevision: second.revision,
      parentId: first.id,
      index: 0,
    })).resolves.toEqual([movedFirst, movedSecond]);

    expect(moveNote).toHaveBeenCalledOnce();
    expect(listNotes).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      notes: [movedFirst, movedSecond],
      selectedId: second.id,
      saving: false,
      error: null,
    });
  });

  it("keeps the current list and selection when an organization write fails", async () => {
    const setNotePinned = vi.fn(async () => {
      throw new Error("内容已在别处更新，请刷新后重试。");
    });
    const store = createCapturesStore(captureClient({
      listNotes: vi.fn(async () => [first]),
      setNotePinned,
    }));
    await store.getState().refresh();
    store.getState().selectNote(first.id);

    await expect(store.getState().setNotePinned({
      id: first.id,
      expectedRevision: first.revision,
      pinned: true,
    })).rejects.toThrow(/更新|版本/);
    expect(store.getState()).toMatchObject({
      notes: [first],
      selectedId: first.id,
      saving: false,
      error: "内容已在别处更新，请刷新后重试。",
    });
  });
});
