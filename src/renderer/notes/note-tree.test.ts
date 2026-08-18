import { describe, expect, it } from "vitest";
import type { Note } from "../../captures";
import { buildNoteTree, noteSystemViews } from "./note-tree";

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    markdown: "",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: null,
    ...overrides,
  };
}

describe("note tree projections", () => {
  it("builds a deterministic nested tree without mutating the source notes", () => {
    const notes = [
      note("child-b", { parentId: "parent", sortOrder: 1, updatedAt: 300 }),
      note("root-b", { sortOrder: 1, updatedAt: 200 }),
      note("parent", { sortOrder: 0, updatedAt: 100 }),
      note("child-a", { parentId: "parent", sortOrder: 0, updatedAt: 100 }),
      note("root-a", { sortOrder: 1, updatedAt: 400 }),
    ];
    const before = structuredClone(notes);

    const tree = buildNoteTree(notes);

    expect(tree.map(({ note }) => note.id)).toEqual(["parent", "root-a", "root-b"]);
    expect(tree[0]?.children.map(({ note }) => note.id)).toEqual(["child-a", "child-b"]);
    expect(notes).toEqual(before);
  });

  it("promotes missing-parent and corrupt-cycle notes to recoverable top-level rows", () => {
    const tree = buildNoteTree([
      note("missing-child", { parentId: "missing" }),
      note("cycle-a", { parentId: "cycle-b" }),
      note("cycle-b", { parentId: "cycle-a" }),
      note("self", { parentId: "self" }),
    ]);

    expect(tree.map(({ note }) => note.id)).toEqual([
      "cycle-a",
      "cycle-b",
      "missing-child",
      "self",
    ]);
    expect(tree.every(({ children }) => children.length === 0)).toBe(true);
  });

  it("derives inbox, pinned and recent lenses from the same note objects", () => {
    const now = 1_000;
    const inboxPinned = note("inbox-pinned", { updatedAt: 700, pinnedAt: 800 });
    const organizedRecent = note("organized", { updatedAt: 900, organizedAt: 600 });
    const olderPinned = note("older-pinned", { updatedAt: 500, pinnedAt: 700, organizedAt: 500 });
    const archived = note("archived", { updatedAt: 950, archivedAt: 960 });
    const deleted = note("deleted", { updatedAt: 980, deletedAt: 990, purgeAfter: 2_000 });

    const views = noteSystemViews([
      olderPinned,
      deleted,
      organizedRecent,
      inboxPinned,
      archived,
    ], now);

    expect(views.inbox).toEqual([inboxPinned]);
    expect(views.pinned).toEqual([inboxPinned, olderPinned]);
    expect(views.recent).toEqual([organizedRecent, inboxPinned, olderPinned]);
    expect(views.pinned[0]).toBe(inboxPinned);
  });
});
