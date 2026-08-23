import { render, screen, waitFor } from "@testing-library/react";
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

    expect(screen.getByText("按计划和完成状态整理你的待办。")).toBeInTheDocument();
    expect(screen.queryByText(/momo 的回执/)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "打开来源便签" }));
    expect(onOpenNote).toHaveBeenCalledWith("note-source");
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("creates a user Todo from the empty state and restores it after remount", async () => {
    const persisted: UserTask[] = [];
    const client: TaskClient = {
      listTasks: vi.fn(async () => [...persisted]),
      createTask: vi.fn(async (input) => {
        const created: UserTask = {
          ...task,
          id: "task-created",
          title: input.title,
          details: input.details ?? "",
          noteId: input.noteId ?? null,
          plannedAt: input.plannedAt ?? null,
        };
        persisted.unshift(created);
        return created;
      }),
      createManyTasks: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
    };
    const user = userEvent.setup();
    const first = render(
      <BridgeProvider tasks={client}><StartTasksView selectedTaskId={null} /></BridgeProvider>,
    );

    expect(await screen.findByText("这里还没有待办。")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "新建待办" })[0]!);
    await user.type(screen.getByRole("textbox", { name: "待办标题" }), "完善作品集");
    await user.type(screen.getByRole("textbox", { name: "待办说明" }), "补充真实验收截图");
    await user.type(screen.getByLabelText("计划日期"), "2026-08-24");
    await user.click(screen.getByRole("button", { name: "创建待办" }));

    expect(client.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "完善作品集",
      details: "补充真实验收截图",
      plannedAt: expect.any(Number),
    }));
    expect(await screen.findByText("完善作品集")).toBeInTheDocument();

    first.unmount();
    render(<BridgeProvider tasks={client}><StartTasksView selectedTaskId={null} /></BridgeProvider>);
    expect(await screen.findByText("完善作品集")).toBeInTheDocument();
  });

  it("edits and deletes a Todo without conflating either action with completion", async () => {
    let current = { ...task };
    const updateTask = vi.fn(async (input) => {
      current = { ...current, ...input, revision: current.revision + 1 };
      return current;
    });
    const deleteTask = vi.fn(async () => undefined);
    const client: TaskClient = {
      listTasks: vi.fn(async () => [current]),
      createTask: vi.fn(),
      createManyTasks: vi.fn(),
      updateTask,
      deleteTask,
    };
    const user = userEvent.setup();
    render(<BridgeProvider tasks={client}><StartTasksView selectedTaskId={null} /></BridgeProvider>);

    await user.click(await screen.findByRole("button", { name: "编辑待办 打磨产品故事" }));
    const title = screen.getByRole("textbox", { name: "待办标题" });
    await user.clear(title);
    await user.type(title, "打磨 Leemo 产品故事");
    await user.click(screen.getByRole("button", { name: "保存待办" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-1",
      expectedRevision: 1,
      title: "打磨 Leemo 产品故事",
    })));

    await user.click(await screen.findByRole("button", { name: "删除待办 打磨 Leemo 产品故事" }));
    expect(screen.getByRole("dialog", { name: "删除待办？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith({ id: "task-1", expectedRevision: 2 }));
    expect(screen.queryByText("打磨 Leemo 产品故事")).not.toBeInTheDocument();
  });
});
