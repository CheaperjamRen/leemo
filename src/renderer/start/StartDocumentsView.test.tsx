import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import type { CaptureClient } from "../capture/client";
import type { TaskClient } from "../tasks/client";
import type { CreateTaskInput, UserTask } from "../../tasks";
import { BridgeProvider } from "../bridge/context";
import StartDocumentsView from "./StartDocumentsView";

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    markdown: "",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: 100,
    ...overrides,
  };
}

function captureClient(notes: Note[], archivedNotes: Note[] = []) {
  const updateNote = vi.fn(async (input) => ({
    ...notes.find((note) => note.id === input.id)!,
    title: input.title,
    markdown: input.markdown,
    revision: input.expectedRevision + 1,
    updatedAt: 200,
  }));
  const archiveNote = vi.fn(async ({ id }: { id: string }) => [{ ...notes.find((note) => note.id === id)!, archivedAt: 200 }]);
  const deleteNote = vi.fn(async ({ id }: { id: string }) => [{ ...notes.find((note) => note.id === id)!, deletedAt: 200 }]);
  const client: CaptureClient = {
    getQuickDraft: vi.fn(),
    saveQuickDraft: vi.fn(),
    commitQuickDraft: vi.fn(),
    listNotes: vi.fn(async () => notes),
    listArchivedNotes: vi.fn(async () => archivedNotes),
    createNote: vi.fn(async ({ title, markdown }) => note("new", { title, markdown })),
    updateNote,
    moveNote: vi.fn(async () => notes),
    setNotePinned: vi.fn(async () => notes[0]!),
    markNoteOrganized: vi.fn(async () => notes[0]!),
    archiveNote,
    unarchiveNote: vi.fn(async ({ id }) => {
      const archived = archivedNotes.find((note) => note.id === id)!;
      const { archivedAt: _archivedAt, ...restored } = archived;
      return [restored];
    }),
    deleteNote,
    attachImageBytes: vi.fn(),
    attachExternalFile: vi.fn(),
    attachFileCopy: vi.fn(),
    removeAttachment: vi.fn(),
    migrateStorageRoot: vi.fn(),
    onChanged: vi.fn(() => vi.fn()),
  };
  return { client, updateNote, archiveNote, deleteNote };
}

function taskClient() {
  const createManyTasks = vi.fn(async ({ tasks }: { tasks: CreateTaskInput[] }): Promise<UserTask[]> => tasks.map((task, index) => ({
    id: `task-${index + 1}`,
    title: task.title,
    details: task.details ?? "",
    status: "open",
    plannedAt: task.plannedAt ?? null,
    dueAt: task.dueAt ?? null,
    reminderAt: task.reminderAt ?? null,
    reminderOffsetMinutes: task.reminderOffsetMinutes ?? null,
    recurrence: task.recurrence ?? null,
    notebookId: task.notebookId ?? null,
    noteId: task.noteId ?? null,
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    completedAt: null,
  })));
  const client: TaskClient = {
    listTasks: vi.fn(async () => []),
    createTask: vi.fn(),
    createManyTasks,
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
  };
  return { client, createManyTasks };
}

describe("StartDocumentsView", () => {
  it("opens local note references inside the same library and edits the selected document", async () => {
    const parent = note("parent", {
      title: "求职准备",
      markdown: "继续看[产品故事](leemo-note://story)",
    });
    const story = note("story", { title: "产品故事", parentId: parent.id });
    const { client, updateNote } = captureClient([parent, story]);
    render(<BridgeProvider capture={client}><StartDocumentsView selectedNoteId={parent.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("link", { name: /产品故事/ }));
    expect(screen.getByDisplayValue("产品故事")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "产品故事 v2");
    await userEvent.click(screen.getByRole("button", { name: "保存文档" }));

    await waitFor(() => expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      id: story.id,
      title: "产品故事 v2",
    })));
  });

  it("defaults to rendered editing and lets the user explicitly switch to Markdown source", async () => {
    const source = note("source", {
      title: "求职主线",
      markdown: "# 先想清楚\n\n保留[产品故事](leemo-note://story)",
    });
    const story = note("story", { title: "产品故事" });
    const captures = captureClient([source, story]);
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const richEditor = screen.getByRole("textbox", { name: "便签正文" });
    expect(within(richEditor).getByRole("heading", { name: "先想清楚" })).toBeInTheDocument();
    expect(richEditor).not.toHaveTextContent("# 先想清楚");

    await userEvent.click(screen.getByRole("button", { name: "编辑 Markdown 源码" }));
    expect(screen.getByRole("textbox", { name: "Markdown 源码" })).toHaveValue(source.markdown);
  });

  it("inserts a stable reference from the @ menu and shows backlinks", async () => {
    const source = note("source", { title: "来源", markdown: "[目标](leemo-note://target)" });
    const target = note("target", { title: "目标" });
    const { client } = captureClient([source, target]);
    render(<BridgeProvider capture={client}><StartDocumentsView selectedNoteId={target.id} /></BridgeProvider>);

    expect(await screen.findByRole("button", { name: /来源/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "编辑文档" }));
    await userEvent.click(screen.getByRole("button", { name: "引用便签" }));
    await userEvent.click(screen.getByRole("option", { name: /来源/ }));
    expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveTextContent("来源");
  });

  it("copies selected document lines into linked Todos and keeps the source unchanged", async () => {
    const source = note("source", {
      title: "求职主线",
      markdown: "- [ ] 打磨产品故事\n- [ ] 优化简历",
    });
    const captures = captureClient([source]);
    const tasks = taskClient();
    render(
      <BridgeProvider capture={captures.client} tasks={tasks.client}>
        <StartDocumentsView selectedNoteId={source.id} />
      </BridgeProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "从便签创建待办" }));
    const panel = screen.getByLabelText("创建待办预览");
    await userEvent.click(within(panel).getByRole("button", { name: "创建 2 条待办" }));

    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [
        { title: "打磨产品故事", details: "- [ ] 打磨产品故事", noteId: source.id },
        { title: "优化简历", details: "- [ ] 优化简历", noteId: source.id },
      ],
    }));
    expect(screen.getByText("已创建 2 条待办 · 便签原文保留")).toBeInTheDocument();
    expect(captures.updateNote).not.toHaveBeenCalled();
  });

  it("requires an explicit subtree choice for a parent and can lift children when archiving", async () => {
    const parent = note("parent", { title: "求职准备" });
    const child = note("child", { title: "简历", parentId: parent.id });
    const captures = captureClient([parent, child]);
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={parent.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "归档文档" }));
    const dialog = screen.getByRole("dialog", { name: "归档父便签" });
    expect(within(dialog).getByText(/将影响 1 条子便签/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "只处理这条，子便签上移" }));

    await waitFor(() => expect(captures.archiveNote).toHaveBeenCalledWith({
      id: parent.id,
      expectedRevision: parent.revision,
      childStrategy: "lift",
    }));
  });

  it("opens archived documents in the same editor surface and restores their subtree", async () => {
    const archived = note("archived", { title: "旧方案", archivedAt: 200, revision: 2 });
    const captures = captureClient([], [archived]);
    const onRestored = vi.fn();
    render(
      <BridgeProvider capture={captures.client}>
        <StartDocumentsView libraryMode="archive" selectedNoteId={archived.id} onRestored={onRestored} />
      </BridgeProvider>,
    );

    expect(await screen.findByDisplayValue("旧方案")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "恢复文档" }));
    await waitFor(() => expect(captures.client.unarchiveNote).toHaveBeenCalledWith({
      id: archived.id,
      expectedRevision: archived.revision,
    }));
    expect(onRestored).toHaveBeenCalledWith(archived.id);
  });
});
