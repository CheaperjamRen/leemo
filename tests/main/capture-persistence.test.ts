import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type {
  Note,
  NoteAttachment,
  QuickDraft,
  SaveQuickDraftInput,
  UpdateNoteInput,
} from "../../src/captures";
import { createPersistence } from "../../src/main/persistence/schema";

interface CaptureStoreForTest {
  getQuickDraft(): QuickDraft | undefined;
  saveQuickDraft(input: SaveQuickDraftInput & { updatedAt: number }): QuickDraft;
  commitQuickDraft(note: Note, expectedRevision: number): Note;
  listNotes(): Note[];
  getNote(id: string): Note | undefined;
  createNote(note: Note): Note;
  updateNote(input: UpdateNoteInput & { updatedAt: number }): Note;
  listArchivedNotes(): Note[];
  archiveNote(id: string, expectedRevision: number, archivedAt: number): Note;
  unarchiveNote(id: string, expectedRevision: number, updatedAt: number): Note;
  deleteNote(id: string, expectedRevision: number, deletedAt: number, purgeAfter: number): Note;
  listTrash(): Note[];
  restoreNote(id: string, expectedRevision: number, updatedAt: number): Note;
  permanentlyDeleteNote(id: string, expectedRevision: number): Note;
  purgeExpired(now: number): Note[];
  addNoteAttachment(
    noteId: string,
    attachment: NoteAttachment,
    expectedRevision: number,
    updatedAt: number,
  ): Note;
  removeNoteAttachment(
    noteId: string,
    attachmentId: string,
    expectedRevision: number,
    updatedAt: number,
  ): Note;
}

function createStore(db = new Database(":memory:")): CaptureStoreForTest {
  return createPersistence(db) as unknown as CaptureStoreForTest;
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "第一条",
    markdown: "正文",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe("capture persistence", () => {
  it("starts without a persisted quick draft", () => {
    const persistence = createStore();

    expect(persistence.getQuickDraft()).toBeUndefined();
  });

  it("increments the quick draft revision and rejects stale writes", () => {
    const persistence = createStore();

    const first = persistence.saveQuickDraft({
      mode: "note",
      title: "想法",
      markdown: "第一版",
      expectedRevision: 0,
      updatedAt: 100,
    });
    expect(first).toEqual({
      id: "quick",
      mode: "note",
      title: "想法",
      markdown: "第一版",
      plannedAt: null,
      dueAt: null,
      reminderAt: null,
      recurrence: null,
      revision: 1,
      updatedAt: 100,
    });

    expect(() => persistence.saveQuickDraft({
      mode: "note",
      title: "旧窗口",
      markdown: "不应覆盖",
      expectedRevision: 0,
      updatedAt: 200,
    })).toThrow(/更新|版本/);
    expect(persistence.getQuickDraft()).toEqual(first);

    expect(persistence.saveQuickDraft({
      mode: "task",
      title: "稍后任务",
      markdown: "第二版",
      expectedRevision: 1,
      updatedAt: 300,
    })).toMatchObject({ revision: 2, mode: "task", markdown: "第二版" });
  });

  it("migrates a legacy quick draft table and restores task scheduling fields after reopening", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE quick_drafts (
        id TEXT PRIMARY KEY CHECK (id = 'quick'),
        mode TEXT NOT NULL CHECK (mode IN ('note', 'task')),
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const persistence = createStore(db);
    const saved = persistence.saveQuickDraft({
      mode: "task",
      title: "投递简历",
      markdown: "带上作品集",
      plannedAt: 1_786_006_800_000,
      dueAt: 1_786_211_600_000,
      reminderAt: 1_786_005_000_000,
      recurrence: "weekly",
      expectedRevision: 0,
      updatedAt: 100,
    });

    expect(saved).toMatchObject({
      plannedAt: 1_786_006_800_000,
      dueAt: 1_786_211_600_000,
      reminderAt: 1_786_005_000_000,
      recurrence: "weekly",
    });
    expect(createStore(db).getQuickDraft()).toEqual(saved);
  });

  it("atomically creates a note and clears its quick draft", () => {
    const persistence = createStore();
    persistence.saveQuickDraft({
      mode: "note",
      title: "草稿",
      markdown: "要留下",
      expectedRevision: 0,
      updatedAt: 100,
    });

    expect(persistence.commitQuickDraft(note(), 1)).toEqual(note());
    expect(persistence.getQuickDraft()).toBeUndefined();
    expect(persistence.listNotes()).toEqual([note()]);
  });

  it("keeps the draft when note creation fails inside commit", () => {
    const persistence = createStore();
    persistence.createNote(note());
    const draft = persistence.saveQuickDraft({
      mode: "note",
      title: "重复 id",
      markdown: "仍需保留",
      expectedRevision: 0,
      updatedAt: 200,
    });

    expect(() => persistence.commitQuickDraft(note({ title: "冲突" }), 1)).toThrow();
    expect(persistence.getQuickDraft()).toEqual(draft);
    expect(persistence.listNotes()).toEqual([note()]);
  });

  it("lists and updates notes while protecting them from stale revisions", () => {
    const persistence = createStore();
    persistence.createNote(note());
    persistence.createNote(note({ id: "note-2", title: "较新", createdAt: 200, updatedAt: 200 }));

    expect(persistence.listNotes().map(({ id }) => id)).toEqual(["note-2", "note-1"]);
    const updated = persistence.updateNote({
      id: "note-1",
      title: "已修改",
      markdown: "新版",
      expectedRevision: 1,
      updatedAt: 300,
    });
    expect(updated).toEqual(note({
      title: "已修改",
      markdown: "新版",
      revision: 2,
      updatedAt: 300,
    }));
    expect(persistence.getNote("note-1")).toEqual(updated);

    expect(() => persistence.updateNote({
      id: "note-1",
      title: "旧修改",
      markdown: "不应覆盖",
      expectedRevision: 1,
      updatedAt: 400,
    })).toThrow(/更新|版本/);
    expect(() => persistence.deleteNote("note-1", 1, 400, 2_592_000_400)).toThrow(/更新|版本/);

    persistence.deleteNote("note-1", 2, 500, 2_592_000_500);
    expect(persistence.getNote("note-1")).toBeUndefined();
  });

  it("migrates legacy notes and keeps archived notes readable outside the active list", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        purge_after INTEGER
      );
      INSERT INTO notes VALUES ('legacy-note', '旧便签', '旧正文', 1, 10, 10, NULL, NULL);
    `);
    const persistence = createStore(db);

    const archived = persistence.archiveNote("legacy-note", 1, 200);

    expect(persistence.listNotes()).toEqual([]);
    expect(persistence.getNote("legacy-note")).toMatchObject({
      id: "legacy-note", archivedAt: 200, revision: 2,
    });
    expect(persistence.listArchivedNotes()).toEqual([archived]);
    const restored = createStore(db).unarchiveNote("legacy-note", 2, 300);
    expect(restored).toMatchObject({ revision: 3, updatedAt: 300 });
    expect(restored).not.toHaveProperty("archivedAt");
    expect(createStore(db).listNotes()).toMatchObject([{ id: "legacy-note" }]);
  });

  it("persists captures in the injected database without adding them to loadAll", () => {
    const db = new Database(":memory:");
    const persistence = createStore(db);
    persistence.createNote(note());
    persistence.saveQuickDraft({
      mode: "note",
      title: "草稿",
      markdown: "正文",
      expectedRevision: 0,
      updatedAt: 100,
    });

    expect(createStore(db).getNote("note-1")).toEqual(note());
    expect(Object.keys(createPersistence(db).loadAll())).toEqual([
      "conversations",
      "wikiEntries",
      "settings",
    ]);
  });

  it("persists attachment metadata across restart and revisions its note", () => {
    const db = new Database(":memory:");
    const persistence = createStore(db);
    persistence.createNote(note());
    const attachment: NoteAttachment = {
      id: "attachment-1",
      kind: "image",
      storage: "managed",
      name: "截图.png",
      path: "note-images/note-1/attachment-1-截图.png",
      mimeType: "image/png",
      size: 4,
      createdAt: 200,
    };

    const attached = persistence.addNoteAttachment("note-1", attachment, 1, 200);
    expect(attached).toMatchObject({ revision: 2, updatedAt: 200, attachments: [attachment] });
    expect(createStore(db).getNote("note-1")).toEqual(attached);

    const removed = createStore(db).removeNoteAttachment("note-1", attachment.id, 2, 300);
    expect(removed).toMatchObject({ revision: 3, updatedAt: 300 });
    expect(removed.attachments).toBeUndefined();
  });

  it("moves a note to trash, hides it from normal reads, and restores it after reopening", () => {
    const db = new Database(":memory:");
    const persistence = createStore(db);
    const attachment: NoteAttachment = {
      id: "attachment-1",
      kind: "file",
      storage: "managed",
      name: "作品集.pdf",
      path: "inbox-attachments/file-copies/note-1/attachment-1-作品集.pdf",
      size: 4,
      createdAt: 110,
    };
    persistence.createNote(note());
    persistence.addNoteAttachment("note-1", attachment, 1, 110);

    const trashed = persistence.deleteNote("note-1", 2, 200, 2_592_000_200);

    expect(persistence.getNote("note-1")).toBeUndefined();
    expect(persistence.listNotes()).toEqual([]);
    expect(trashed).toMatchObject({
      revision: 3,
      deletedAt: 200,
      purgeAfter: 2_592_000_200,
      attachments: [attachment],
    });
    const reopened = createStore(db);
    expect(reopened.listTrash()).toMatchObject([{
      id: "note-1",
      deletedAt: 200,
      attachments: [attachment],
    }]);
    expect(reopened.restoreNote("note-1", 3, 300)).toMatchObject({
      revision: 4,
      updatedAt: 300,
      attachments: [attachment],
    });
    expect(reopened.getNote("note-1")).toMatchObject({ id: "note-1", attachments: [attachment] });

    reopened.deleteNote("note-1", 4, 400, 500);
    expect(reopened.purgeExpired(500)).toEqual([]);
    expect(reopened.purgeExpired(501)).toMatchObject([{ id: "note-1", deletedAt: 400 }]);
    expect(reopened.listTrash()).toEqual([]);
  });
});
