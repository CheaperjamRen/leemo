import { describe, expect, it, vi } from "vitest";
import type { CreateTaskInput, UserTask } from "../../tasks";
import type { TaskClient } from "../tasks/client";
import { createTasksStore } from "./tasks";

const openTask: UserTask = {
  id: "task-1",
  title: "整理秋招作品集",
  details: "先补项目说明",
  status: "open",
  plannedAt: null,
  dueAt: 1786112400000,
  reminderAt: null,
  reminderOffsetMinutes: 120,
  recurrence: null,
  notebookId: null,
  noteId: null,
  revision: 1,
  createdAt: 10,
  updatedAt: 10,
  completedAt: null,
};

function taskClient(overrides: Partial<TaskClient> = {}): TaskClient {
  return {
    listTasks: vi.fn(async () => []),
    createTask: vi.fn(async (input: CreateTaskInput) => ({ ...openTask, ...input })),
    createManyTasks: vi.fn(async ({ tasks }: { tasks: CreateTaskInput[] }) => tasks.map((task: CreateTaskInput, index: number) => ({
      ...openTask,
      ...task,
      id: `task-${index + 2}`,
    }))),
    updateTask: vi.fn(async (input) => ({
      ...openTask,
      ...input,
      revision: input.expectedRevision + 1,
    })),
    deleteTask: vi.fn(async () => undefined),
    ...overrides,
  } as TaskClient;
}

describe("tasks store", () => {
  it("projects linked tasks for one source note without duplicating records", async () => {
    const linked = { ...openTask, noteId: "note-1" };
    const other = { ...openTask, id: "task-2", noteId: "note-2" };
    const store = createTasksStore(taskClient({ listTasks: vi.fn(async () => [linked, other]) }));
    await store.getState().refresh();

    expect(store.getState().tasksForNote("note-1")).toEqual([linked]);
    expect(store.getState().tasks).toEqual([linked, other]);
  });
  it("loads persisted tasks without inventing examples", async () => {
    const listTasks = vi.fn(async () => [openTask]);
    const store = createTasksStore(taskClient({ listTasks }));

    await store.getState().refresh();

    expect(listTasks).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      tasks: [openTask],
      status: "ready",
      error: null,
    });
  });

  it("creates multiple parsed tasks in one operation", async () => {
    const createManyTasks = vi.fn(async ({ tasks }: { tasks: CreateTaskInput[] }) => tasks.map((task: CreateTaskInput, index: number) => ({
      ...openTask,
      ...task,
      id: `batch-${index}`,
    })));
    const store = createTasksStore(taskClient({ createManyTasks }));

    await store.getState().createMany([
      { title: "修改简历" },
      { title: "投递岗位", dueAt: 1786112400000 },
    ]);

    expect(createManyTasks).toHaveBeenCalledWith({
      tasks: [
        { title: "修改简历" },
        { title: "投递岗位", dueAt: 1786112400000 },
      ],
    });
    expect(store.getState().tasks.map((task) => task.title)).toEqual(["修改简历", "投递岗位"]);
  });

  it("marks a task complete and can reopen it with its current revision", async () => {
    const done = { ...openTask, status: "done" as const, revision: 2, completedAt: 20 };
    const reopened = { ...done, status: "open" as const, revision: 3, completedAt: null };
    const updateTask = vi.fn()
      .mockResolvedValueOnce(done)
      .mockResolvedValueOnce(reopened);
    const store = createTasksStore(taskClient({
      listTasks: vi.fn(async () => [openTask]),
      updateTask,
    }));
    await store.getState().refresh();

    await store.getState().toggle(openTask.id);
    await store.getState().toggle(openTask.id);

    expect(updateTask).toHaveBeenNthCalledWith(1, {
      id: openTask.id,
      expectedRevision: 1,
      status: "done",
    });
    expect(updateTask).toHaveBeenNthCalledWith(2, {
      id: openTask.id,
      expectedRevision: 2,
      status: "open",
    });
    expect(store.getState().tasks).toEqual([reopened]);
  });
});
