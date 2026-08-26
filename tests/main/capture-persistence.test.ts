import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type {
  Note,
  NoteAttachment,
  MutateNoteTreeInput,
  QuickDraft,
  SaveQuickDraftInput,
  UpdateNoteInput,
} from "../../src/captures";
import { createPersistence } from "../../src/main/persistence/schema";
import { createTaskPersistence } from "../../src/main/persistence/task-persistence";

interface CaptureStoreForTest {
  getQuickDraft(): QuickDraft | undefined;
  saveQuickDraft(input: SaveQuickDraftInput & { updatedAt: number }): QuickDraft;
  commitQuickDraft(note: Note, expectedRevision: number): Note;
  listNotes(): Note[];
  getNote(id: string): Note | undefined;
  createNote(note: Note): Note;
  updateNote(input: UpdateNoteInput & { updatedAt: number }): Note;
  listArchivedNotes(): Note[];
  archiveNote(input: MutateNoteTreeInput & { updatedAt: number }): Note[];
  unarchiveNote(id: string, expectedRevision: number, updatedAt: number): Note[];
  deleteNote(input: MutateNoteTreeInput & { deletedAt: number; purgeAfter: number }): Note[];
  listTrash(): Note[];
  restoreNote(id: string, expectedRevision: number, updatedAt: number): Note[];
  permanentlyDeleteNote(id: string, expectedRevision: number): Note[];
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
  moveNote(input: {
    id: string;
    expectedRevision: number;
    parentId: string | null;
    index: number;
  }): Note[];
  setNotePinned(input: {
    id: string;
    expectedRevision: number;
    pinned: boolean;
    updatedAt: number;
  }): Note;
  markNoteOrganized(input: {
    id: string;
    expectedRevision: number;
    organized: boolean;
    updatedAt: number;
  }): Note;
}

type OrganizedNote = Note & {
  parentId: string | null;
  sortOrder: number;
  pinnedAt: number | null;
  organizedAt: number | null;
};

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
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: null,
    ...overrides,
  };
}

function organizedNote(overrides: Partial<OrganizedNote> = {}): OrganizedNote {
  return {
    ...note(),
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: null,
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
    expect(() => persistence.deleteNote({ id: "note-1", expectedRevision: 1, childStrategy: "subtree", deletedAt: 400, purgeAfter: 2_592_000_400 })).toThrow(/更新|版本/);

    persistence.deleteNote({ id: "note-1", expectedRevision: 2, childStrategy: "subtree", deletedAt: 500, purgeAfter: 2_592_000_500 });
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

    const [archived] = persistence.archiveNote({ id: "legacy-note", expectedRevision: 1, childStrategy: "subtree", updatedAt: 200 });

    expect(persistence.listNotes()).toEqual([]);
    expect(persistence.getNote("legacy-note")).toMatchObject({
      id: "legacy-note", archivedAt: 200, revision: 2,
    });
    expect(persistence.listArchivedNotes()).toEqual([archived]);
    const [restored] = createStore(db).unarchiveNote("legacy-note", 2, 300);
    expect(restored).toMatchObject({ revision: 3, updatedAt: 300 });
    expect(restored).not.toHaveProperty("archivedAt");
    expect(createStore(db).listNotes()).toMatchObject([{ id: "legacy-note" }]);
  });

  it("migrates legacy notes with explicit organization defaults", () => {
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
        purge_after INTEGER,
        archived_at INTEGER
      );
      INSERT INTO notes VALUES ('legacy-note', '旧便签', '旧正文', 1, 10, 10, NULL, NULL, NULL);
    `);

    expect(createStore(db).listNotes()[0]).toMatchObject({
      id: "legacy-note",
      parentId: null,
      sortOrder: 0,
      pinnedAt: null,
      organizedAt: null,
    });
  });

  it("moves notes between parents and reindexes only the affected sibling groups", () => {
    const persistence = createStore();
    persistence.createNote(organizedNote({ id: "parent", title: "求职准备", sortOrder: 2 }));
    persistence.createNote(organizedNote({ id: "root-a", title: "根一", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "root-b", title: "根二", sortOrder: 1 }));
    persistence.createNote(organizedNote({ id: "child-a", title: "简历", parentId: "parent", sortOrder: 0 }));

    const affected = persistence.moveNote({
      id: "root-b",
      expectedRevision: 1,
      parentId: "parent",
      index: 0,
    });

    expect(persistence.getNote("root-b")).toMatchObject({
      parentId: "parent",
      sortOrder: 0,
      revision: 2,
    });
    expect(persistence.getNote("child-a")).toMatchObject({ parentId: "parent", sortOrder: 1, revision: 1 });
    expect(persistence.getNote("root-a")).toMatchObject({ parentId: null, sortOrder: 0, revision: 1 });
    expect(persistence.getNote("parent")).toMatchObject({ parentId: null, sortOrder: 1, revision: 1 });
    expect(affected.map(({ id }) => id)).toEqual(["root-a", "parent", "root-b", "child-a"]);

    persistence.moveNote({
      id: "child-a",
      expectedRevision: 1,
      parentId: "parent",
      index: 0,
    });
    expect(persistence.getNote("child-a")).toMatchObject({ sortOrder: 0, revision: 2 });
    expect(persistence.getNote("root-b")).toMatchObject({ sortOrder: 1, revision: 2 });
  });

  it("rejects missing parents, self-parenting and descendant cycles without partial reorder", () => {
    const persistence = createStore();
    persistence.createNote(organizedNote({ id: "parent", title: "父级", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "child", title: "子级", parentId: "parent", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "sibling", title: "同级", sortOrder: 1 }));

    expect(() => persistence.moveNote({
      id: "parent",
      expectedRevision: 1,
      parentId: "missing",
      index: 0,
    })).toThrow(/父级|不存在/);
    expect(() => persistence.moveNote({
      id: "parent",
      expectedRevision: 1,
      parentId: "parent",
      index: 0,
    })).toThrow(/自己|循环/);
    expect(() => persistence.moveNote({
      id: "parent",
      expectedRevision: 1,
      parentId: "child",
      index: 0,
    })).toThrow(/循环/);

    expect(persistence.getNote("parent")).toMatchObject({ parentId: null, sortOrder: 0, revision: 1 });
    expect(persistence.getNote("child")).toMatchObject({ parentId: "parent", sortOrder: 0, revision: 1 });
    expect(persistence.getNote("sibling")).toMatchObject({ parentId: null, sortOrder: 1, revision: 1 });
  });

  it("archives and restores an entire note subtree without losing its structure", () => {
    const persistence = createStore();
    persistence.createNote(organizedNote({ id: "parent", title: "求职", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "child", title: "简历", parentId: "parent", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "grandchild", title: "项目", parentId: "child", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "sibling", title: "学习", sortOrder: 1 }));

    expect(persistence.archiveNote({
      id: "parent",
      expectedRevision: 1,
      childStrategy: "subtree",
      updatedAt: 200,
    })).toMatchObject([
      { id: "parent", archivedAt: 200, revision: 2, parentId: null },
      { id: "child", archivedAt: 200, revision: 2, parentId: "parent" },
      { id: "grandchild", archivedAt: 200, revision: 2, parentId: "child" },
    ]);
    expect(persistence.listNotes()).toMatchObject([{ id: "sibling" }]);

    expect(persistence.unarchiveNote("parent", 2, 300)).toMatchObject([
      { id: "parent", revision: 3, parentId: null },
      { id: "child", revision: 3, parentId: "parent" },
      { id: "grandchild", revision: 3, parentId: "child" },
    ]);
    expect(persistence.listNotes().map(({ id }) => id)).toEqual(expect.arrayContaining(["parent", "child", "grandchild", "sibling"]));
  });

  it("can archive only a parent while lifting its children into the parent position", () => {
    const persistence = createStore();
    persistence.createNote(organizedNote({ id: "before", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "parent", sortOrder: 1 }));
    persistence.createNote(organizedNote({ id: "after", sortOrder: 2 }));
    persistence.createNote(organizedNote({ id: "child-a", parentId: "parent", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "child-b", parentId: "parent", sortOrder: 1 }));

    persistence.archiveNote({
      id: "parent",
      expectedRevision: 1,
      childStrategy: "lift",
      updatedAt: 200,
    });

    expect(persistence.listNotes().sort((a, b) => a.sortOrder - b.sortOrder)).toMatchObject([
      { id: "before", parentId: null, sortOrder: 0 },
      { id: "child-a", parentId: null, sortOrder: 1, revision: 2 },
      { id: "child-b", parentId: null, sortOrder: 2, revision: 2 },
      { id: "after", parentId: null, sortOrder: 3 },
    ]);
    expect(persistence.listArchivedNotes()).toMatchObject([{ id: "parent", revision: 2 }]);
  });

  it("trashes and restores a subtree atomically, while lift leaves children active", () => {
    const persistence = createStore();
    persistence.createNote(organizedNote({ id: "parent", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "child", parentId: "parent", sortOrder: 0 }));

    expect(persistence.deleteNote({
      id: "parent",
      expectedRevision: 1,
      childStrategy: "subtree",
      deletedAt: 200,
      purgeAfter: 2_592_000_200,
    })).toMatchObject([
      { id: "parent", deletedAt: 200, revision: 2 },
      { id: "child", deletedAt: 200, revision: 2, parentId: "parent" },
    ]);
    expect(persistence.restoreNote("parent", 2, 300)).toMatchObject([
      { id: "parent", revision: 3 },
      { id: "child", revision: 3, parentId: "parent" },
    ]);

    persistence.deleteNote({
      id: "parent",
      expectedRevision: 3,
      childStrategy: "lift",
      deletedAt: 400,
      purgeAfter: 2_592_000_400,
    });
    expect(persistence.listNotes()).toMatchObject([{ id: "child", parentId: null }]);
    expect(persistence.listTrash()).toMatchObject([{ id: "parent" }]);
  });

  it("keeps note organization atomic when a stale revision tries to move it", () => {
    const persistence = createStore();
    persistence.createNote(organizedNote({ id: "note-a", sortOrder: 0 }));
    persistence.createNote(organizedNote({ id: "note-b", sortOrder: 1 }));
    persistence.updateNote({
      id: "note-b",
      title: "已更新",
      markdown: "正文",
      expectedRevision: 1,
      updatedAt: 200,
    });

    expect(() => persistence.moveNote({
      id: "note-b",
      expectedRevision: 1,
      parentId: null,
      index: 0,
    })).toThrow(/更新|版本/);
    expect(persistence.getNote("note-a")).toMatchObject({ sortOrder: 0, revision: 1 });
    expect(persistence.getNote("note-b")).toMatchObject({ sortOrder: 1, revision: 2 });
  });

  it("persists pin and inbox-organization timestamps with optimistic revisions", () => {
    const db = new Database(":memory:");
    const persistence = createStore(db);
    persistence.createNote(organizedNote());

    expect(persistence.setNotePinned({
      id: "note-1",
      expectedRevision: 1,
      pinned: true,
      updatedAt: 200,
    })).toMatchObject({ pinnedAt: 200, revision: 2, updatedAt: 200 });
    expect(persistence.markNoteOrganized({
      id: "note-1",
      expectedRevision: 2,
      organized: true,
      updatedAt: 300,
    })).toMatchObject({ organizedAt: 300, revision: 3, updatedAt: 300 });

    expect(createStore(db).getNote("note-1")).toMatchObject({
      pinnedAt: 200,
      organizedAt: 300,
      revision: 3,
    });
    expect(() => persistence.setNotePinned({
      id: "note-1",
      expectedRevision: 2,
      pinned: false,
      updatedAt: 400,
    })).toThrow(/更新|版本/);
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
      "composerDrafts",
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

    const [trashed] = persistence.deleteNote({ id: "note-1", expectedRevision: 2, childStrategy: "subtree", deletedAt: 200, purgeAfter: 2_592_000_200 });

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
    expect(reopened.restoreNote("note-1", 3, 300)[0]).toMatchObject({
      revision: 4,
      updatedAt: 300,
      attachments: [attachment],
    });
    expect(reopened.getNote("note-1")).toMatchObject({ id: "note-1", attachments: [attachment] });

    reopened.deleteNote({ id: "note-1", expectedRevision: 4, childStrategy: "subtree", deletedAt: 400, purgeAfter: 500 });
    expect(reopened.purgeExpired(500)).toEqual([]);
    expect(reopened.purgeExpired(501)).toMatchObject([{ id: "note-1", deletedAt: 400 }]);
    expect(reopened.listTrash()).toEqual([]);
  });

  it("normalizes the complete flat legacy fixture idempotently", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
        purge_after INTEGER, archived_at INTEGER
      );
      CREATE TABLE note_attachments (
        id TEXT PRIMARY KEY, note_id TEXT NOT NULL, kind TEXT NOT NULL, storage TEXT NOT NULL,
        name TEXT NOT NULL, file_path TEXT NOT NULL, mime_type TEXT, size INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO notes VALUES
        ('legacy-active', '进行中', '正文', 2, 10, 20, NULL, NULL, NULL),
        ('legacy-archive', '已归档', '旧正文', 3, 11, 21, NULL, NULL, 30),
        ('legacy-trash', '已删除', '待恢复', 4, 12, 22, 40, 2592000040, NULL);
      INSERT INTO note_attachments VALUES
        ('managed', 'legacy-active', 'file', 'managed', '简历.pdf', 'inbox-attachments/file-copies/legacy-active/resume.pdf', 'application/pdf', 12, 25),
        ('external', 'legacy-active', 'file', 'external', '原稿.docx', 'E:/Documents/原稿.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 24, 26);
      CREATE TABLE user_tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL,
        planned_at INTEGER, due_at INTEGER, reminder_at INTEGER, reminder_offset_minutes INTEGER,
        recurrence TEXT, notebook_id TEXT, note_id TEXT, revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
      );
      INSERT INTO user_tasks VALUES
        ('legacy-task', '继续整理', '来源便签', 'open', NULL, NULL, NULL, NULL, NULL, NULL, 'legacy-active', 1, 10, 20, NULL);
    `);

    const normalized = () => {
      const captures = createStore(db);
      const tasks = createTaskPersistence(db);
      return {
        active: captures.listNotes(),
        archived: captures.listArchivedNotes(),
        trash: captures.listTrash(),
        tasks: tasks.listTasks(),
      };
    };
    const first = normalized();
    const second = normalized();

    expect(second).toEqual(first);
    expect(first.active).toMatchObject([{
      id: "legacy-active",
      parentId: null,
      sortOrder: 0,
      pinnedAt: null,
      organizedAt: null,
      attachments: [
        { id: "managed", storage: "managed" },
        { id: "external", storage: "external", path: "E:/Documents/原稿.docx" },
      ],
    }]);
    expect(first.archived).toMatchObject([{ id: "legacy-archive", archivedAt: 30 }]);
    expect(first.trash).toMatchObject([{ id: "legacy-trash", deletedAt: 40 }]);
    expect(first.tasks).toMatchObject([{ id: "legacy-task", noteId: "legacy-active" }]);
  });
});
