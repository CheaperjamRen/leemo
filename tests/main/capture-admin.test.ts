import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptureChange } from "../../src/captures";
import { createCaptureAdmin } from "../../src/main/capture-admin";
import { createCaptureStorage } from "../../src/main/capture-storage";
import { createPersistence } from "../../src/main/persistence/schema";

function createHarness() {
  let currentTime = 100;
  let nextId = 1;
  const admin = createCaptureAdmin({
    persistence: createPersistence(new Database(":memory:")),
    now: () => currentTime,
    randomId: () => `note-${nextId++}`,
  });
  return {
    admin,
    setTime(value: number) {
      currentTime = value;
    },
  };
}

describe("capture admin", () => {
  it("exposes an empty draft and emits only after a successful revisioned save", () => {
    const { admin, setTime } = createHarness();
    const changes: CaptureChange[] = [];
    const unsubscribe = admin.subscribe((change) => changes.push(change));

    expect(admin.getQuickDraft()).toEqual({
      id: "quick",
      mode: "note",
      title: "",
      markdown: "",
      plannedAt: null,
      dueAt: null,
      reminderAt: null,
      recurrence: null,
      revision: 0,
      updatedAt: 0,
    });
    expect(admin.saveQuickDraft({
      mode: "note",
      title: "想法",
      markdown: "正文",
      expectedRevision: 0,
    })).toMatchObject({ revision: 1, updatedAt: 100 });
    expect(changes).toEqual([{
      entity: "quickDraft",
      action: "saved",
      id: "quick",
      revision: 1,
    }]);

    setTime(200);
    expect(() => admin.saveQuickDraft({
      mode: "note",
      title: "旧窗口",
      markdown: "不应写入",
      expectedRevision: 0,
    })).toThrow(/更新|版本/);
    expect(changes).toHaveLength(1);

    unsubscribe();
    admin.saveQuickDraft({
      mode: "note",
      title: "新版",
      markdown: "保留",
      expectedRevision: 1,
    });
    expect(changes).toHaveLength(1);
  });

  it("commits a note and broadcasts the note creation and draft clear", () => {
    const { admin, setTime } = createHarness();
    admin.saveQuickDraft({
      mode: "note",
      title: "  标题  ",
      markdown: "第一行\r\n第二行",
      expectedRevision: 0,
    });
    const changes: CaptureChange[] = [];
    admin.subscribe((change) => changes.push(change));
    setTime(200);

    const committed = admin.commitQuickDraft({ expectedRevision: 1 });

    expect(committed).toEqual({
      id: "note-1",
      title: "标题",
      markdown: "第一行\n第二行",
      revision: 1,
      createdAt: 200,
      updatedAt: 200,
      parentId: null,
      sortOrder: 0,
      pinnedAt: null,
      organizedAt: null,
    });
    expect(admin.getQuickDraft()).toMatchObject({ revision: 0, markdown: "" });
    expect(admin.listNotes()).toEqual([committed]);
    expect(changes).toEqual([
      { entity: "note", action: "created", id: "note-1", revision: 1 },
      { entity: "quickDraft", action: "cleared", id: "quick", revision: 1 },
    ]);
  });

  it("validates and emits note organization changes without partial writes", () => {
    const { admin, setTime } = createHarness();
    const parent = admin.createNote({ title: "求职准备", markdown: "" });
    const child = admin.createNote({ title: "简历", markdown: "" });
    const changes: CaptureChange[] = [];
    admin.subscribe((change) => changes.push(change));

    expect(() => admin.moveNote({
      id: child.id,
      expectedRevision: child.revision,
      parentId: "missing",
      index: 0,
    })).toThrow(/父级|不存在/);
    expect(() => admin.moveNote({
      id: child.id,
      expectedRevision: child.revision,
      parentId: parent.id,
      index: -1,
    })).toThrow(/排序|位置/);
    expect(changes).toEqual([]);

    const affected = admin.moveNote({
      id: child.id,
      expectedRevision: child.revision,
      parentId: parent.id,
      index: 0,
    });
    expect(affected.find((note) => note.id === child.id)).toMatchObject({
      parentId: parent.id,
      sortOrder: 0,
      revision: 2,
    });
    expect(() => admin.moveNote({
      id: child.id,
      expectedRevision: child.revision,
      parentId: null,
      index: 0,
    })).toThrow(/更新|版本/);

    setTime(300);
    expect(admin.setNotePinned({
      id: child.id,
      expectedRevision: 2,
      pinned: true,
    })).toMatchObject({ pinnedAt: 300, revision: 3 });
    setTime(400);
    expect(admin.markNoteOrganized({
      id: child.id,
      expectedRevision: 3,
      organized: true,
    })).toMatchObject({ organizedAt: 400, revision: 4 });
    expect(changes.map(({ action }) => action)).toEqual(["moved", "pinned", "organized"]);
  });

  it("keeps task-mode and empty drafts because Task commit is outside this milestone", () => {
    const taskHarness = createHarness();
    const taskDraft = taskHarness.admin.saveQuickDraft({
      mode: "task",
      title: "待办",
      markdown: "以后实现",
      expectedRevision: 0,
    });
    expect(() => taskHarness.admin.commitQuickDraft({ expectedRevision: 1 })).toThrow(/待办|任务/);
    expect(taskHarness.admin.getQuickDraft()).toEqual(taskDraft);

    const emptyHarness = createHarness();
    const emptyDraft = emptyHarness.admin.saveQuickDraft({
      mode: "note",
      title: "   ",
      markdown: "\n",
      expectedRevision: 0,
    });
    expect(() => emptyHarness.admin.commitQuickDraft({ expectedRevision: 1 })).toThrow(/内容|标题/);
    expect(emptyHarness.admin.getQuickDraft()).toEqual(emptyDraft);
  });

  it("provides main-process note CRUD with revision protection", () => {
    const { admin, setTime } = createHarness();
    const changes: CaptureChange[] = [];
    admin.subscribe((change) => changes.push(change));

    const created = admin.createNote({ title: "手动便签", markdown: "正文" });
    expect(admin.getNote(created.id)).toEqual(created);
    expect(admin.listNotes()).toEqual([created]);

    setTime(200);
    const updated = admin.updateNote({
      id: created.id,
      title: "新标题",
      markdown: "新正文",
      expectedRevision: 1,
    });
    expect(updated).toMatchObject({ revision: 2, updatedAt: 200 });
    expect(() => admin.updateNote({
      id: created.id,
      title: "旧写入",
      markdown: "不应覆盖",
      expectedRevision: 1,
    })).toThrow(/更新|版本/);
    expect(changes).toHaveLength(2);

    const [archived] = admin.archiveNote({ id: created.id, expectedRevision: 2, childStrategy: "subtree" });
    expect(admin.listNotes()).toEqual([]);
    expect(admin.getNote(created.id)).toMatchObject({ id: created.id, archivedAt: 200 });
    expect(admin.listArchivedNotes()).toEqual([archived]);
    const [restored] = admin.unarchiveNote({ id: created.id, expectedRevision: 3 });
    expect(restored).not.toHaveProperty("archivedAt");

    admin.deleteNote({ id: created.id, expectedRevision: 4, childStrategy: "subtree" });
    expect(admin.getNote(created.id)).toBeNull();
    expect(changes).toEqual([
      { entity: "note", action: "created", id: created.id, revision: 1 },
      { entity: "note", action: "updated", id: created.id, revision: 2 },
      { entity: "note", action: "archived", id: created.id, revision: 3 },
      { entity: "note", action: "unarchived", id: created.id, revision: 4 },
      { entity: "note", action: "deleted", id: created.id, revision: 5 },
    ]);
  });

  it("attaches managed and external files through the same revisioned note service", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-capture-admin-"));
    const source = path.join(root, "source.txt");
    fs.writeFileSync(source, "source");
    const persistence = createPersistence(new Database(":memory:"));
    let nextAttachmentId = 1;
    const admin = createCaptureAdmin({
      persistence,
      storage: createCaptureStorage({
        randomId: () => `attachment-${nextAttachmentId++}`,
        now: () => 200,
      }),
      getStorageRoot: () => path.join(root, "storage"),
      now: () => 200,
      randomId: () => "note-1",
    });

    try {
      const note = admin.createNote({ title: "附件", markdown: "正文" });
      const withImage = await admin.attachImageBytes({
        noteId: note.id,
        expectedRevision: 1,
        name: "截图.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2]),
      });
      expect(withImage).toMatchObject({ revision: 2, attachments: [{ storage: "managed" }] });

      const withExternal = await admin.attachExternalFile({
        noteId: note.id,
        expectedRevision: 2,
        path: source,
      });
      expect(withExternal.attachments).toHaveLength(2);

      const removed = await admin.removeAttachment({
        noteId: note.id,
        attachmentId: "attachment-1",
        expectedRevision: 3,
      });
      expect(removed.attachments).toEqual([expect.objectContaining({ storage: "external" })]);
      expect(fs.existsSync(source)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes only old managed directories after the migrated root is persisted", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-storage-migration-"));
    const oldRoot = path.join(root, "old");
    const newRoot = path.join(root, "new");
    fs.mkdirSync(path.join(oldRoot, "note-images", "note-1"), { recursive: true });
    fs.mkdirSync(path.join(oldRoot, "inbox-attachments", "file-copies"), { recursive: true });
    fs.writeFileSync(path.join(oldRoot, "note-images", "note-1", "image.png"), "image");
    fs.writeFileSync(path.join(oldRoot, "inbox-attachments", "file-copies", "document.pdf"), "document");
    fs.writeFileSync(path.join(oldRoot, "keep-me.txt"), "user file");
    let persistedRoot = oldRoot;
    const admin = createCaptureAdmin({
      persistence: createPersistence(new Database(":memory:")),
      storage: createCaptureStorage({ randomId: () => "migration-1" }),
      getStorageRoot: () => persistedRoot,
      setStorageRoot: (nextRoot) => { persistedRoot = nextRoot; },
    });

    try {
      await expect(admin.migrateStorageRoot({ newRoot })).resolves.toBe(path.resolve(newRoot));

      expect(persistedRoot).toBe(path.resolve(newRoot));
      expect(fs.readFileSync(path.join(newRoot, "note-images", "note-1", "image.png"), "utf8")).toBe("image");
      expect(fs.readFileSync(path.join(newRoot, "inbox-attachments", "file-copies", "document.pdf"), "utf8")).toBe("document");
      expect(fs.existsSync(oldRoot)).toBe(true);
      expect(fs.existsSync(path.join(oldRoot, "note-images"))).toBe(false);
      expect(fs.existsSync(path.join(oldRoot, "inbox-attachments"))).toBe(false);
      expect(fs.readFileSync(path.join(oldRoot, "keep-me.txt"), "utf8")).toBe("user file");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps managed attachments through normal deletion and removes only them on permanent deletion", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-trash-attachments-"));
    const source = path.join(root, "source.txt");
    fs.writeFileSync(source, "source");
    let nextAttachmentId = 1;
    const admin = createCaptureAdmin({
      persistence: createPersistence(new Database(":memory:")),
      storage: createCaptureStorage({
        randomId: () => `attachment-${nextAttachmentId++}`,
        now: () => 200,
      }),
      getStorageRoot: () => path.join(root, "storage"),
      now: () => 200,
      randomId: () => "note-1",
    });

    try {
      const note = admin.createNote({ title: "附件", markdown: "正文" });
      const withImage = await admin.attachImageBytes({
        noteId: note.id,
        expectedRevision: 1,
        name: "截图.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2]),
      });
      const withExternal = await admin.attachExternalFile({
        noteId: note.id,
        expectedRevision: 2,
        path: source,
      });
      const managedPath = path.join(root, "storage", withImage.attachments![0].path);

      admin.deleteNote({ id: note.id, expectedRevision: 3, childStrategy: "subtree" });
      expect(admin.listTrash()).toMatchObject([{ id: note.id, attachments: withExternal.attachments }]);
      expect(fs.existsSync(managedPath)).toBe(true);

      await admin.permanentlyDeleteNote({ id: note.id, expectedRevision: 4 });
      expect(admin.listTrash()).toEqual([]);
      expect(fs.existsSync(managedPath)).toBe(false);
      expect(fs.existsSync(source)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
