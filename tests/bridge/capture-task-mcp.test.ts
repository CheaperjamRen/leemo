import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../src/captures";
import {
  createCaptureTaskMcp,
} from "../../src/bridge/capture-task-mcp";
import type { CaptureAdminService } from "../../src/main/capture-admin";
import type { TaskAdminService } from "../../src/main/task-admin";
import type { UserTask } from "../../src/tasks";

const NOTE: Note = {
  id: "note-1",
  title: "论文想法",
  markdown: "先验证数据来源。",
  revision: 2,
  createdAt: 1,
  updatedAt: 2,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
};

const TASK: UserTask = {
  id: "task-1",
  title: "提交简历",
  details: "投递产品岗位",
  status: "open",
  plannedAt: null,
  dueAt: Date.parse("2026-08-10T18:00:00+08:00"),
  reminderAt: Date.parse("2026-08-10T16:00:00+08:00"),
  reminderOffsetMinutes: 120,
  recurrence: null,
  notebookId: "秋招",
  noteId: null,
  revision: 3,
  createdAt: 1,
  updatedAt: 2,
  completedAt: null,
};

function captureAdmin(): CaptureAdminService {
  return {
    getQuickDraft: vi.fn(),
    saveQuickDraft: vi.fn(),
    commitQuickDraft: vi.fn(),
    listNotes: vi.fn(() => [NOTE]),
    listArchivedNotes: vi.fn(() => []),
    getNote: vi.fn(() => NOTE),
    createNote: vi.fn(() => NOTE),
    updateNote: vi.fn(() => NOTE),
    moveNote: vi.fn(() => [NOTE]),
    setNotePinned: vi.fn(() => NOTE),
    markNoteOrganized: vi.fn(() => NOTE),
    archiveNote: vi.fn(() => [NOTE]),
    unarchiveNote: vi.fn(() => [NOTE]),
    deleteNote: vi.fn(() => [NOTE]),
    subscribe: vi.fn(() => () => {}),
  };
}

function taskAdmin(): TaskAdminService {
  return {
    listTasks: vi.fn(() => [TASK]),
    createTask: vi.fn(() => TASK),
    createManyTasks: vi.fn((input: Parameters<TaskAdminService["createManyTasks"]>[0]) => input.tasks.map((task, index) => ({
      ...TASK,
      id: `task-${index + 1}`,
      title: task.title,
      notebookId: task.notebookId ?? null,
    }))),
    updateTask: vi.fn(() => ({ ...TASK, status: "done" as const, completedAt: 3, revision: 4 })),
    deleteTask: vi.fn(),
  };
}

describe("momo notes and tasks MCP", () => {
  it("lists real records with the identifiers and revisions needed for a later edit", async () => {
    const mcp = createCaptureTaskMcp({
      captures: captureAdmin(),
      tasks: taskAdmin(),
      notebookId: "秋招",
    });

    const notes = await mcp.runListNotes({});
    const tasks = await mcp.runListTasks({});

    expect(notes).toMatchObject({ isError: false, text: expect.stringContaining("论文想法") });
    expect(notes.text).toContain("note-1");
    expect(notes.text).toContain("版本：2");
    expect(tasks).toMatchObject({ isError: false, text: expect.stringContaining("提交简历") });
    expect(tasks.text).toContain("task-1");
    expect(tasks.text).toContain("版本：3");
  });

  it("creates and updates notes through the same validated service", async () => {
    const captures = captureAdmin();
    const mcp = createCaptureTaskMcp({ captures, tasks: taskAdmin() });

    await mcp.runCreateNote({ title: "论文想法", markdown: "先验证数据来源。" });
    await mcp.runUpdateNote({
      id: "note-1",
      expectedRevision: 2,
      title: "论文想法（更新）",
      markdown: "补充反例。",
    });
    await mcp.runDeleteNote({ id: "note-1", expectedRevision: 2 });

    expect(captures.createNote).toHaveBeenCalledWith({
      title: "论文想法",
      markdown: "先验证数据来源。",
    });
    expect(captures.updateNote).toHaveBeenCalledWith({
      id: "note-1",
      expectedRevision: 2,
      title: "论文想法（更新）",
      markdown: "补充反例。",
    });
    expect(captures.deleteNote).toHaveBeenCalledWith({ id: "note-1", expectedRevision: 2, childStrategy: "subtree" });
  });

  it("adds one or many tasks to the current notebook without asking for its internal id", async () => {
    const tasks = taskAdmin();
    const mcp = createCaptureTaskMcp({ captures: captureAdmin(), tasks, notebookId: "秋招" });

    await mcp.runCreateTask({
      title: "提交简历",
      dueAt: "2026-08-10T18:00:00+08:00",
      reminderAt: "2026-08-10T16:00:00+08:00",
      reminderOffsetMinutes: 120,
    });
    await mcp.runCreateTasks({
      tasks: [
        { title: "修改简历" },
        { title: "准备面试", recurrence: "weekdays" },
      ],
    });

    expect(tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "提交简历",
      notebookId: "秋招",
      dueAt: Date.parse("2026-08-10T18:00:00+08:00"),
      reminderAt: Date.parse("2026-08-10T16:00:00+08:00"),
    }));
    expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [
        expect.objectContaining({ title: "修改简历", notebookId: "秋招" }),
        expect.objectContaining({ title: "准备面试", notebookId: "秋招", recurrence: "weekdays" }),
      ],
    });
  });

  it("updates a task's editable fields while keeping the current notebook by default", async () => {
    const tasks = taskAdmin();
    vi.mocked(tasks.updateTask).mockImplementation((input) => ({
      ...TASK,
      ...input,
      notebookId: input.notebookId === undefined ? "秋招" : input.notebookId,
      revision: 4,
    }));
    const mcp = createCaptureTaskMcp({ captures: captureAdmin(), tasks, notebookId: "秋招" });

    const result = await mcp.runUpdateTask({
      id: "task-1",
      expectedRevision: 3,
      title: "投递产品简历",
      details: "补上作品集链接",
      plannedAt: "2026-08-09T09:00:00+08:00",
      dueAt: "2026-08-10T18:00:00+08:00",
      reminderAt: "2026-08-10T16:00:00+08:00",
      recurrence: "weekly",
    });

    expect(tasks.updateTask).toHaveBeenCalledWith({
      id: "task-1",
      expectedRevision: 3,
      title: "投递产品简历",
      details: "补上作品集链接",
      plannedAt: Date.parse("2026-08-09T09:00:00+08:00"),
      dueAt: Date.parse("2026-08-10T18:00:00+08:00"),
      reminderAt: Date.parse("2026-08-10T16:00:00+08:00"),
      recurrence: "weekly",
      notebookId: "秋招",
    });
    expect(result).toEqual({ isError: false, text: "已更新待办“投递产品简历”。" });
  });

  it("changes completion state and reports service failures instead of claiming success", async () => {
    const tasks = taskAdmin();
    const captures = captureAdmin();
    vi.mocked(captures.createNote).mockImplementation(() => {
      throw new Error("请先写下标题或正文内容。");
    });
    const mcp = createCaptureTaskMcp({ captures, tasks });

    const completed = await mcp.runSetTaskCompleted({
      id: "task-1",
      expectedRevision: 3,
      completed: true,
    });
    const failed = await mcp.runCreateNote({ title: "", markdown: "" });

    expect(tasks.updateTask).toHaveBeenCalledWith({
      id: "task-1",
      expectedRevision: 3,
      status: "done",
    });
    expect(completed).toMatchObject({ isError: false, text: expect.stringContaining("已完成") });
    expect(failed).toEqual({
      isError: true,
      text: "便签没有更新：请先写下标题或正文内容。",
    });
  });
});
