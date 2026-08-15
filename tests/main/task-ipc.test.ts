import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createTaskAdmin } from "../../src/main/task-admin";
import { createTaskIpcDispatcher } from "../../src/main/task-ipc";
import { createTaskPersistence } from "../../src/main/persistence/task-persistence";

function createHarness() {
  let nextId = 1;
  const admin = createTaskAdmin({
    persistence: createTaskPersistence(new Database(":memory:")),
    now: () => 100,
    randomId: () => `task-${nextId++}`,
  });
  return createTaskIpcDispatcher(admin);
}

describe("task IPC dispatcher", () => {
  it("allows the quick window to create one task but nothing else", () => {
    const ipc = createHarness();

    expect(ipc.handle("quick", {
      op: "createTask",
      payload: { title: "从快捷窗创建", details: "不需要再打开编辑页" },
    })).toMatchObject({
      ok: true,
      response: { id: "task-1", title: "从快捷窗创建", details: "不需要再打开编辑页" },
    });
    expect(ipc.handle("quick", { op: "listTasks" })).toMatchObject({ ok: false });
    expect(ipc.handle("quick", {
      op: "updateTask",
      payload: { id: "task-1", expectedRevision: 1, title: "不应更新" },
    })).toMatchObject({ ok: false });
  });

  it("exposes list, create, createMany, update, and delete to the main renderer", () => {
    const ipc = createHarness();

    expect(ipc.handle("main", {
      op: "createTask",
      payload: { title: "单条待办" },
    })).toMatchObject({ ok: true, response: { id: "task-1", revision: 1 } });
    expect(ipc.handle("main", {
      op: "createManyTasks",
      payload: { tasks: [{ title: "批量一" }, { title: "批量二" }] },
    })).toMatchObject({ ok: true, response: [{ id: "task-2" }, { id: "task-3" }] });
    expect(ipc.handle("main", { op: "listTasks" })).toMatchObject({
      ok: true,
      response: expect.arrayContaining([
        expect.objectContaining({ id: "task-1", title: "单条待办" }),
      ]),
    });
    expect(ipc.handle("main", {
      op: "updateTask",
      payload: { id: "task-1", expectedRevision: 1, status: "done" },
    })).toMatchObject({ ok: true, response: { revision: 2, status: "done" } });
    expect(ipc.handle("main", {
      op: "deleteTask",
      payload: { id: "task-1", expectedRevision: 2 },
    })).toEqual({ ok: true, response: undefined });
  });

  it("rejects unknown senders, operations, and malformed payloads without throwing", () => {
    const ipc = createHarness();

    expect(ipc.handle(null, { op: "listTasks" })).toMatchObject({ ok: false });
    expect(ipc.handle("main", { op: "surprise" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/未知|不支持/),
    });
    expect(ipc.handle("main", {
      op: "createTask",
      payload: { title: "" },
    })).toMatchObject({ ok: false, error: expect.stringMatching(/标题/) });
  });
});
