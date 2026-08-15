import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createCaptureAdmin } from "../../src/main/capture-admin";
import { createPersistence } from "../../src/main/persistence/schema";
import { createTaskAdmin } from "../../src/main/task-admin";
import { createTaskPersistence } from "../../src/main/persistence/task-persistence";
import { createTrashIpcDispatcher } from "../../src/main/trash-ipc";

function createHarness() {
  let noteId = 1;
  let taskId = 1;
  const captures = createCaptureAdmin({
    persistence: createPersistence(new Database(":memory:")),
    now: () => 100,
    randomId: () => `note-${noteId++}`,
  });
  const tasks = createTaskAdmin({
    persistence: createTaskPersistence(new Database(":memory:")),
    now: () => 100,
    randomId: () => `task-${taskId++}`,
  });
  return { captures, tasks, trash: createTrashIpcDispatcher({ captures, tasks }) };
}

describe("trash IPC dispatcher", () => {
  it("lists, restores, and permanently deletes trashed notes and tasks for the main window only", async () => {
    const { captures, tasks, trash } = createHarness();
    const note = captures.createNote({ title: "临时便签", markdown: "正文" });
    const task = tasks.createTask({ title: "临时待办", details: "详情", noteId: note.id });
    captures.deleteNote({ id: note.id, expectedRevision: 1 });
    tasks.deleteTask({ id: task.id, expectedRevision: 1 });

    expect(await trash.handle("quick", { op: "list" })).toMatchObject({ ok: false });
    expect(await trash.handle("main", { op: "list" })).toMatchObject({
      ok: true,
      response: {
        notes: [{ id: note.id, title: "临时便签", revision: 2 }],
        tasks: [{ id: task.id, title: "临时待办", details: "详情", revision: 2 }],
      },
    });

    expect(await trash.handle("main", {
      op: "restore",
      payload: { kind: "note", id: note.id, expectedRevision: 2 },
    })).toMatchObject({ ok: true, response: { id: note.id, revision: 3 } });
    expect(captures.getNote(note.id)).toMatchObject({ title: "临时便签" });

    expect(await trash.handle("main", {
      op: "permanentlyDelete",
      payload: { kind: "task", id: task.id, expectedRevision: 2 },
    })).toEqual({ ok: true, response: undefined });
    expect(tasks.listTrash()).toEqual([]);
  });
});
