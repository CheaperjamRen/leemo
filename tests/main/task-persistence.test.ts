import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { UserTask } from "../../src/tasks";
import { createTaskPersistence } from "../../src/main/persistence/task-persistence";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function task(overrides: Partial<UserTask> = {}): UserTask {
  return {
    id: "task-1",
    title: "准备面试",
    details: "整理项目讲解",
    status: "open",
    plannedAt: 1_000,
    dueAt: 2_000,
    reminderAt: 900,
    reminderOffsetMinutes: 30,
    recurrence: "weekdays",
    notebookId: "job-search",
    noteId: "note-1",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
    ...overrides,
  };
}

describe("task persistence", () => {
  it("creates one or many tasks and restores every field after reopening the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "leemo-tasks-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "leemo.sqlite");
    const firstDb = new Database(file);
    const first = createTaskPersistence(firstDb);

    first.createTask(task());
    first.createManyTasks([
      task({ id: "task-2", title: "投递简历", recurrence: null, noteId: null }),
      task({ id: "task-3", title: "复习英语", plannedAt: null, dueAt: null }),
    ]);
    firstDb.close();

    const secondDb = new Database(file);
    const restored = createTaskPersistence(secondDb);
    expect(restored.getTask("task-1")).toEqual(task());
    expect(restored.listTasks().map(({ id }) => id).sort()).toEqual([
      "task-1",
      "task-2",
      "task-3",
    ]);
    secondDb.close();
  });

  it("updates and deletes only the expected revision", () => {
    const persistence = createTaskPersistence(new Database(":memory:"));
    persistence.createTask(task());

    const updated = task({
      title: "准备终面",
      status: "done",
      revision: 2,
      updatedAt: 200,
      completedAt: 200,
    });
    expect(persistence.updateTask(updated, 1)).toEqual(updated);
    expect(() => persistence.updateTask(task({ revision: 3 }), 1)).toThrow(/更新|版本/);
    expect(() => persistence.deleteTask("task-1", 1, 300, 2_592_000_300)).toThrow(/更新|版本/);

    persistence.deleteTask("task-1", 2, 300, 2_592_000_300);
    expect(persistence.getTask("task-1")).toBeUndefined();
  });

  it("moves a task to trash and restores every task detail after reopening", () => {
    const directory = mkdtempSync(join(tmpdir(), "leemo-trash-tasks-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "leemo.sqlite");
    const firstDb = new Database(file);
    const first = createTaskPersistence(firstDb);
    first.createTask(task());

    const trashed = first.deleteTask("task-1", 1, 200, 2_592_000_200);
    expect(first.listTasks()).toEqual([]);
    expect(trashed).toMatchObject({ revision: 2, deletedAt: 200, purgeAfter: 2_592_000_200 });
    firstDb.close();

    const secondDb = new Database(file);
    const reopened = createTaskPersistence(secondDb) as typeof first;
    expect(reopened.listTrash()).toMatchObject([{
      id: "task-1",
      details: "整理项目讲解",
      notebookId: "job-search",
      noteId: "note-1",
      deletedAt: 200,
    }]);
    expect(reopened.restoreTask("task-1", 2, 300)).toMatchObject({
      revision: 3,
      updatedAt: 300,
      details: "整理项目讲解",
      notebookId: "job-search",
      noteId: "note-1",
    });
    secondDb.close();
  });
});
