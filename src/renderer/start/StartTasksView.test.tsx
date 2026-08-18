import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UserTask } from "../../tasks";
import type { TaskClient } from "../tasks/client";
import { BridgeProvider } from "../bridge/context";
import StartTasksView from "./StartTasksView";

const task: UserTask = {
  id: "task-1",
  title: "打磨产品故事",
  details: "来自求职主线",
  status: "open",
  plannedAt: null,
  dueAt: null,
  reminderAt: null,
  reminderOffsetMinutes: null,
  recurrence: null,
  notebookId: null,
  noteId: "note-source",
  revision: 1,
  createdAt: 100,
  updatedAt: 100,
  completedAt: null,
};

describe("StartTasksView", () => {
  it("opens a linked source note without toggling Todo completion", async () => {
    const updateTask = vi.fn();
    const client: TaskClient = {
      listTasks: vi.fn(async () => [task]),
      createTask: vi.fn(),
      createManyTasks: vi.fn(),
      updateTask,
      deleteTask: vi.fn(),
    };
    const onOpenNote = vi.fn();
    render(<BridgeProvider tasks={client}><StartTasksView selectedTaskId={null} onOpenNote={onOpenNote} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "打开来源便签" }));
    expect(onOpenNote).toHaveBeenCalledWith("note-source");
    expect(updateTask).not.toHaveBeenCalled();
  });
});
