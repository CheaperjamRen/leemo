import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createTaskAdmin } from "../../src/main/task-admin";
import { createTaskPersistence } from "../../src/main/persistence/task-persistence";

function createHarness() {
  let currentTime = 100;
  let nextId = 1;
  const admin = createTaskAdmin({
    persistence: createTaskPersistence(new Database(":memory:")),
    now: () => currentTime,
    randomId: () => `task-${nextId++}`,
  });
  return {
    admin,
    setTime(value: number) {
      currentTime = value;
    },
  };
}

describe("task admin", () => {
  it("creates, completes, reopens, and deletes a real task", () => {
    const { admin, setTime } = createHarness();
    const created = admin.createTask({
      title: "  准备作品集  ",
      details: "第一行\r\n第二行",
      dueAt: 2_000,
      reminderOffsetMinutes: 60,
      recurrence: "weekly",
      notebookId: "job-search",
    });

    expect(created).toEqual({
      id: "task-1",
      title: "准备作品集",
      details: "第一行\n第二行",
      status: "open",
      plannedAt: null,
      dueAt: 2_000,
      reminderAt: null,
      reminderOffsetMinutes: 60,
      recurrence: "weekly",
      notebookId: "job-search",
      noteId: null,
      revision: 1,
      createdAt: 100,
      updatedAt: 100,
      completedAt: null,
    });

    setTime(200);
    const completed = admin.updateTask({
      id: created.id,
      expectedRevision: 1,
      status: "done",
    });
    expect(completed).toMatchObject({ status: "done", revision: 2, completedAt: 200 });

    setTime(300);
    const reopened = admin.updateTask({
      id: created.id,
      expectedRevision: 2,
      status: "open",
    });
    expect(reopened).toMatchObject({ status: "open", revision: 3, completedAt: null });
    expect(() => admin.updateTask({
      id: created.id,
      expectedRevision: 2,
      title: "旧窗口写入",
    })).toThrow(/更新|版本/);

    admin.deleteTask({ id: created.id, expectedRevision: 3 });
    expect(admin.listTasks()).toEqual([]);
  });

  it("validates a batch before creating any tasks", () => {
    const { admin } = createHarness();

    expect(() => admin.createManyTasks({
      tasks: [
        { title: "第一条", details: "会成功" },
        { title: "   ", details: "标题为空" },
      ],
    })).toThrow(/标题/);
    expect(admin.listTasks()).toEqual([]);

    expect(admin.createManyTasks({
      tasks: [{ title: "第一条" }, { title: "第二条", plannedAt: 1_000 }],
    }).map(({ id }) => id)).toEqual(["task-1", "task-2"]);
  });
});
