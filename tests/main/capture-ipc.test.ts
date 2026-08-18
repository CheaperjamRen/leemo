import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createCaptureAdmin } from "../../src/main/capture-admin";
import { createCaptureIpcDispatcher } from "../../src/main/capture-ipc";
import type { CaptureStorageService } from "../../src/main/capture-storage";
import { createPersistence } from "../../src/main/persistence/schema";

function createHarness(fileDropMode: "reference" | "copy" = "reference") {
  let nextId = 1;
  let nextAttachmentId = 1;
  const storage: CaptureStorageService = {
    storeImageBytes: async (_root, _noteId, input) => ({
      id: `attachment-${nextAttachmentId++}`,
      kind: "image",
      storage: "managed",
      name: input.name,
      path: "note-images/note-1/paste.png",
      mimeType: input.mimeType,
      size: input.bytes.byteLength,
      createdAt: 100,
    }),
    referenceExternalFile: async (sourcePath) => ({
      id: `attachment-${nextAttachmentId++}`,
      kind: "file",
      storage: "external",
      name: "resume.pdf",
      path: sourcePath,
      size: 1,
      createdAt: 100,
    }),
    copyExternalFile: async (_root, _noteId, sourcePath) => ({
      id: `attachment-${nextAttachmentId++}`,
      kind: "file",
      storage: "managed",
      name: "resume.pdf",
      path: `inbox-attachments/file-copies/note-1/${sourcePath.split(/[\\/]/u).at(-1)}`,
      size: 1,
      createdAt: 100,
    }),
    removeAttachment: async () => undefined,
    migrateManagedStorage: async () => "E:/Leemo-files",
    cleanupManagedStorage: async () => undefined,
  };
  const admin = createCaptureAdmin({
    persistence: createPersistence(new Database(":memory:")),
    now: () => 100,
    randomId: () => `note-${nextId++}`,
    storage,
    getStorageRoot: () => "E:/Leemo-files",
    setStorageRoot: () => undefined,
  });
  return { admin, ipc: createCaptureIpcDispatcher(admin, { getQuickCaptureFileDropMode: () => fileDropMode }) };
}

describe("capture IPC dispatcher", () => {
  it("lets the narrow quick sender get, save, and commit only its draft", async () => {
    const { ipc } = createHarness();

    expect(await ipc.handle("quick", { op: "getQuickDraft" })).toMatchObject({
      ok: true,
      response: { id: "quick", revision: 0 },
    });
    expect(await ipc.handle("quick", {
      op: "saveQuickDraft",
      payload: {
        mode: "note",
        title: "快捷便签",
        markdown: "正文",
        expectedRevision: 0,
      },
    })).toMatchObject({ ok: true, response: { revision: 1 } });
    expect(await ipc.handle("quick", {
      op: "commitQuickDraft",
      payload: { expectedRevision: 1 },
    })).toMatchObject({ ok: true, response: { id: "note-1", markdown: "正文" } });

    for (const op of ["listNotes", "listArchivedNotes", "getNote", "createNote", "updateNote", "moveNote", "setNotePinned", "markNoteOrganized", "archiveNote", "unarchiveNote", "deleteNote", "attachExternalFile", "attachFileCopy", "removeAttachment", "migrateStorageRoot"]) {
      expect(await ipc.handle("quick", { op, payload: {} })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/无权|不能|不允许/),
      });
    }
  });

  it("lets the main sender perform note CRUD and list notes", async () => {
    const { ipc } = createHarness();
    const created = await ipc.handle("main", {
      op: "createNote",
      payload: { title: "主窗口", markdown: "正文" },
    });
    expect(created).toMatchObject({ ok: true, response: { id: "note-1", revision: 1 } });

    expect(await ipc.handle("main", { op: "listNotes" })).toMatchObject({
      ok: true,
      response: [{ id: "note-1" }],
    });
    expect(await ipc.handle("main", {
      op: "getNote",
      payload: { id: "note-1" },
    })).toMatchObject({ ok: true, response: { title: "主窗口" } });
    expect(await ipc.handle("main", {
      op: "updateNote",
      payload: {
        id: "note-1",
        title: "已更新",
        markdown: "新版",
        expectedRevision: 1,
      },
    })).toMatchObject({ ok: true, response: { revision: 2, title: "已更新" } });
    expect(await ipc.handle("main", {
      op: "archiveNote",
      payload: { id: "note-1", expectedRevision: 2 },
    })).toMatchObject({ ok: true, response: { revision: 3, archivedAt: expect.any(Number) } });
    expect(await ipc.handle("main", { op: "listNotes" })).toEqual({ ok: true, response: [] });
    expect(await ipc.handle("main", { op: "listArchivedNotes" })).toMatchObject({
      ok: true, response: [{ id: "note-1" }],
    });
    expect(await ipc.handle("main", {
      op: "unarchiveNote",
      payload: { id: "note-1", expectedRevision: 3 },
    })).toMatchObject({ ok: true, response: { revision: 4 } });
    expect(await ipc.handle("main", {
      op: "deleteNote",
      payload: { id: "note-1", expectedRevision: 4 },
    })).toEqual({ ok: true, response: undefined });
    expect(await ipc.handle("main", { op: "listNotes" })).toEqual({ ok: true, response: [] });
  });

  it("lets only the main sender organize notes through the typed operation path", async () => {
    const { ipc } = createHarness();
    const parent = await ipc.handle("main", {
      op: "createNote",
      payload: { title: "求职准备", markdown: "" },
    });
    const child = await ipc.handle("main", {
      op: "createNote",
      payload: { title: "简历", markdown: "" },
    });
    expect(parent).toMatchObject({ ok: true, response: { id: "note-1" } });
    expect(child).toMatchObject({ ok: true, response: { id: "note-2" } });

    expect(await ipc.handle("quick", {
      op: "moveNote",
      payload: { id: "note-2", expectedRevision: 1, parentId: "note-1", index: 0 },
    })).toMatchObject({ ok: false, error: expect.stringMatching(/无权|不能|不允许/) });
    expect(await ipc.handle("main", {
      op: "moveNote",
      payload: { id: "note-2", expectedRevision: 1, parentId: "note-1", index: 0 },
    })).toMatchObject({
      ok: true,
      response: expect.arrayContaining([expect.objectContaining({
        id: "note-2", parentId: "note-1", revision: 2,
      })]),
    });
    expect(await ipc.handle("main", {
      op: "setNotePinned",
      payload: { id: "note-2", expectedRevision: 2, pinned: true },
    })).toMatchObject({ ok: true, response: { pinnedAt: 100, revision: 3 } });
    expect(await ipc.handle("main", {
      op: "markNoteOrganized",
      payload: { id: "note-2", expectedRevision: 3, organized: true },
    })).toMatchObject({ ok: true, response: { organizedAt: 100, revision: 4 } });
  });

  it("lets the quick window attach only to its committed note and honors the file-drop preference", async () => {
    const { ipc } = createHarness();
    const created = await ipc.handle("quick", {
      op: "saveQuickDraft",
      payload: { mode: "note", title: "附件", markdown: "正文", expectedRevision: 0 },
    });
    expect(created).toMatchObject({ ok: true, response: { revision: 1 } });
    const committed = await ipc.handle("quick", { op: "commitQuickDraft", payload: { expectedRevision: 1 } });
    expect(committed).toMatchObject({ ok: true, response: { id: "note-1", revision: 1 } });

    await expect(ipc.handle("quick", {
      op: "attachExternalFile",
      payload: { noteId: "note-1", expectedRevision: 1, path: "E:/resume.pdf" },
    })).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/无权|不能|不允许/) });

    await expect(ipc.handle("quick", {
      op: "attachImageBytes",
      payload: { noteId: "note-1", expectedRevision: 1, name: "截图.png", mimeType: "image/png", bytes: new Uint8Array([1]) },
    })).resolves.toMatchObject({
      ok: true,
      response: {
        revision: 2,
        attachments: [{ storage: "managed", name: "截图.png" }],
      },
    });

    await expect(ipc.handle("quick", {
      op: "attachDroppedFile",
      payload: { noteId: "note-1", expectedRevision: 2, path: "E:/resume.pdf" },
    })).resolves.toMatchObject({
      ok: true,
      response: {
        revision: 3,
        attachments: [
          { storage: "managed", name: "截图.png" },
          { storage: "external", name: "resume.pdf", path: "E:/resume.pdf" },
        ],
      },
    });

    const copyHarness = createHarness("copy");
    const copied = await copyHarness.ipc.handle("main", {
      op: "createNote",
      payload: { title: "副本", markdown: "" },
    });
    expect(copied).toMatchObject({ ok: true, response: { id: "note-1", revision: 1 } });
    await expect(copyHarness.ipc.handle("quick", {
      op: "attachDroppedFile",
      payload: { noteId: "note-1", expectedRevision: 1, path: "E:/resume.pdf" },
    })).resolves.toMatchObject({ ok: true, response: { attachments: [{ storage: "managed" }] } });
  });

  it("rejects unknown senders, unknown operations, and malformed payloads without throwing", async () => {
    const { ipc } = createHarness();

    expect(await ipc.handle(null, { op: "getQuickDraft" })).toMatchObject({ ok: false });
    expect(await ipc.handle("main", { op: "surprise" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/未知|不支持/),
    });
    expect(await ipc.handle("quick", {
      op: "saveQuickDraft",
      payload: { mode: "note", title: "缺字段" },
    })).toMatchObject({ ok: false, error: expect.any(String) });
  });
});
