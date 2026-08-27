import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import type { CaptureClient } from "../capture/client";
import type { TaskClient } from "../tasks/client";
import type { CreateTaskInput, UserTask } from "../../tasks";
import { BridgeProvider } from "../bridge/context";
import StartDocumentsView from "./StartDocumentsView";

if (!("getBoundingClientRect" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

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
    previewAttachment: vi.fn(),
    openAttachment: vi.fn(),
    revealAttachment: vi.fn(),
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

function selectText(node: Node, start?: number, end?: number): void {
  const range = document.createRange();
  if (typeof start === "number" && typeof end === "number") {
    range.setStart(node, start);
    range.setEnd(node, end);
  } else {
    range.selectNodeContents(node);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}

function noteDataTransfer(noteId: string): DataTransfer {
  const payload = JSON.stringify({ noteId });
  return {
    files: [] as unknown as FileList,
    types: ["application/x-leemo-note"],
    effectAllowed: "move",
    dropEffect: "move",
    setData: vi.fn(),
    getData: (type: string) => type === "application/x-leemo-note" ? payload : "",
  } as unknown as DataTransfer;
}

describe("StartDocumentsView", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as Window & { leemoCapture?: unknown }).leemoCapture;
    delete (window as Window & { leemoWorkspace?: unknown }).leemoWorkspace;
  });

  it("uses a conventional empty document state without narrating AI behavior", async () => {
    const { client } = captureClient([]);
    render(<BridgeProvider capture={client}><StartDocumentsView /></BridgeProvider>);

    expect(await screen.findByRole("heading", { name: "还没有文档" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "新建文档" })).toHaveLength(2);
    expect(screen.queryByText(/不会自动调用模型|本地文档与便签工具/)).not.toBeInTheDocument();
  });

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

  it("offers one-step undo after moving a document in the tree", async () => {
    const first = note("first", { title: "第一章", sortOrder: 0 });
    const second = note("second", { title: "第二章", sortOrder: 1 });
    const captures = captureClient([first, second]);
    captures.client.moveNote = vi.fn()
      .mockResolvedValueOnce([{ ...first, parentId: second.id, sortOrder: 0, revision: 2 }])
      .mockResolvedValueOnce([{ ...first, parentId: null, sortOrder: 0, revision: 3 }]);
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={first.id} /></BridgeProvider>);

    fireEvent.drop(await screen.findByRole("treeitem", { name: /第二章/ }), {
      dataTransfer: noteDataTransfer(first.id),
    });
    await waitFor(() => expect(captures.client.moveNote).toHaveBeenNthCalledWith(1, {
      id: first.id,
      expectedRevision: first.revision,
      parentId: second.id,
      index: 0,
    }));

    expect(screen.getByRole("status", { name: "文档移动结果" })).toHaveTextContent("已移动「第一章」");
    await userEvent.click(screen.getByRole("button", { name: "撤销移动" }));
    await waitFor(() => expect(captures.client.moveNote).toHaveBeenNthCalledWith(2, {
      id: first.id,
      expectedRevision: 2,
      parentId: null,
      index: 0,
    }));
    expect(screen.queryByRole("button", { name: "撤销移动" })).not.toBeInTheDocument();
  });

  it("shows only the immediate parent in a compact document location without leaking ancestor body text", async () => {
    const grandparent = note("grandparent", {
      title: "",
      markdown: "这段祖先正文不该泄露到当前文档标题栏",
    });
    const parent = note("parent", {
      title: "求职材料整理与面试故事",
      parentId: grandparent.id,
    });
    const child = note("child", { title: "数据分析实习", parentId: parent.id });
    const captures = captureClient([grandparent, parent, child]);
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={child.id} /></BridgeProvider>);

    const location = await screen.findByRole("navigation", { name: "文档位置" });
    expect(within(location).getByRole("button", { name: "打开父文档 求职材料整理与面试故事" })).toBeInTheDocument();
    expect(location).toHaveTextContent("…");
    expect(location).not.toHaveTextContent("这段祖先正文不该泄露到当前文档标题栏");
    expect(screen.getByDisplayValue("数据分析实习")).toBeInTheDocument();
  });

  it("buffers unsaved edits immediately and restores them after switching documents and remounting", async () => {
    const source = note("source", { title: "求职主线", markdown: "先写自己的判断" });
    const other = note("other", { title: "资料清单", markdown: "稍后整理" });
    const captures = captureClient([source, other]);
    const view = render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "求职主线与独立思考");
    expect(localStorage.getItem("leemo:document-recovery:v1")).toContain("求职主线与独立思考");

    await userEvent.click(screen.getByRole("button", { name: "资料清单" }));
    await userEvent.click(screen.getByRole("button", { name: "求职主线" }));
    expect(screen.getByDisplayValue("求职主线与独立思考")).toBeInTheDocument();

    view.unmount();
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);
    expect(await screen.findByDisplayValue("求职主线与独立思考")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveTextContent("先写自己的判断");
  });

  it("autosaves an edited document after a short idle period and clears its recovery buffer", async () => {
    const source = note("source", { title: "求职主线", markdown: "先写自己的判断" });
    const captures = captureClient([source]);
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "求职主线 v2");

    await waitFor(() => expect(captures.updateNote).toHaveBeenCalledWith(expect.objectContaining({
      id: source.id,
      title: "求职主线 v2",
      expectedRevision: source.revision,
    })), { timeout: 2_500 });
    expect(localStorage.getItem("leemo:document-recovery:v1")).not.toContain("求职主线 v2");
  });

  it("keeps the editor writable while an autosave is in flight and queues newer text", async () => {
    const source = note("source", { title: "求职主线", markdown: "先写自己的判断" });
    const captures = captureClient([source]);
    let finishFirstSave: (() => void) | undefined;
    captures.updateNote.mockImplementationOnce((input) => new Promise((resolve) => {
      finishFirstSave = () => resolve({
        ...source,
        title: input.title,
        markdown: input.markdown,
        revision: input.expectedRevision + 1,
        updatedAt: 200,
      });
    }));
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "求职主线 v2");
    await waitFor(() => expect(captures.updateNote).toHaveBeenCalledOnce(), { timeout: 2_500 });

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    expect(editor).toHaveAttribute("contenteditable", "true");
    await userEvent.click(editor);
    await userEvent.keyboard("，再补一条证据");
    expect(localStorage.getItem("leemo:document-recovery:v1")).toContain("再补一条证据");
    expect(screen.getByText("正在保存")).toBeInTheDocument();

    finishFirstSave?.();
    await waitFor(() => expect(captures.updateNote).toHaveBeenCalledTimes(2), { timeout: 2_500 });
    await waitFor(() => expect(localStorage.getItem("leemo:document-recovery:v1")).not.toContain("再补一条证据"));
  });

  it("keeps a stale local draft and offers reload or copy instead of overwriting a newer revision", async () => {
    const source = note("source", { title: "求职主线", markdown: "远端正文" });
    const captures = captureClient([source]);
    captures.updateNote.mockRejectedValueOnce(new Error("内容已在别处更新，请刷新后重试。"));
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "本地未保存版本");
    await userEvent.click(screen.getByRole("button", { name: "保存文档" }));

    const conflict = await screen.findByRole("alert", { name: "内容在别处更新" });
    expect(within(conflict).getByRole("button", { name: "重新载入" })).toBeInTheDocument();
    expect(within(conflict).getByRole("button", { name: "复制本地草稿" })).toBeInTheDocument();
    expect(localStorage.getItem("leemo:document-recovery:v1")).toContain("本地未保存版本");
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

  it("inserts a note reference at the current source caret instead of appending it", async () => {
    const source = note("source", { title: "来源", markdown: "第一段\n\n第二段" });
    const target = note("target", { title: "目标" });
    const { client } = captureClient([source, target]);
    render(<BridgeProvider capture={client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    await userEvent.click(screen.getByRole("button", { name: "编辑 Markdown 源码" }));
    const editor = screen.getByRole("textbox", { name: "Markdown 源码" }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(3, 3);
    fireEvent.select(editor);

    await userEvent.click(screen.getByRole("button", { name: "引用便签" }));
    await userEvent.click(screen.getByRole("option", { name: /目标/ }));

    expect(editor).toHaveValue("第一段[目标](leemo-note://target)\n\n第二段");
  });

  it("copies only the selected document line into a linked Todo and keeps the source unchanged", async () => {
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

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const editor = screen.getByRole("textbox", { name: "便签正文" });
    const firstLine = editor.querySelector("li");
    expect(firstLine).not.toBeNull();
    selectText(firstLine!);

    await userEvent.click(screen.getByRole("button", { name: "从便签创建待办" }));
    const panel = screen.getByLabelText("创建待办预览");
    await userEvent.click(within(panel).getByRole("button", { name: "创建 1 条待办" }));

    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [
        { title: "打磨产品故事", details: "打磨产品故事", noteId: source.id },
      ],
    }));
    expect(screen.getByText("已创建 1 条待办 · 便签原文保留")).toBeInTheDocument();
    expect(captures.updateNote).not.toHaveBeenCalled();
  });

  it("previews, opens, and reveals a real attachment from its compact row", async () => {
    const source = note("source", {
      title: "研究资料",
      markdown: "见附件",
      attachments: [{
        id: "attachment-1",
        kind: "file",
        storage: "external",
        name: "资料.md",
        path: "E:/资料.md",
        size: 12,
        createdAt: 100,
      }],
    });
    const captures = captureClient([source]);
    const invoke = vi.fn(async (op: string) => op === "previewAttachment"
      ? { ok: true, response: { kind: "markdown", name: "资料.md", text: "# 资料正文" } }
      : { ok: true });
    Object.defineProperty(window, "leemoCapture", {
      configurable: true,
      value: { invoke, onChanged: vi.fn(() => vi.fn()) },
    });
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "预览附件 资料.md" }));
    const preview = screen.getByRole("dialog", { name: "预览 资料.md" });
    expect(within(preview).getByRole("heading", { name: "资料正文" })).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole("button", { name: "关闭预览" }));
    await userEvent.click(screen.getByRole("button", { name: "打开附件 资料.md" }));
    await userEvent.click(screen.getByRole("button", { name: "在资源管理器中显示 资料.md" }));

    expect(invoke).toHaveBeenNthCalledWith(1, "previewAttachment", { noteId: source.id, attachmentId: "attachment-1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "openAttachment", { noteId: source.id, attachmentId: "attachment-1" });
    expect(invoke).toHaveBeenNthCalledWith(3, "revealAttachment", { noteId: source.id, attachmentId: "attachment-1" });
  });

  it("saves the latest document text before mutating its attachments", async () => {
    const source = note("source", { title: "研究资料", markdown: "原文" });
    const captures = captureClient([source]);
    const invoke = vi.fn(async (op: string, input: { expectedRevision?: number }) => {
      if (op === "attachExternalFile" || op === "attachFileCopy") {
        return {
          ok: true,
          response: note("source", {
            title: "研究资料 v2",
            markdown: "原文",
            revision: Number(input.expectedRevision) + 1,
            attachments: [{
              id: "attachment-1",
              kind: "file",
              storage: "external",
              name: "证据.txt",
              path: "E:/证据.txt",
              size: 4,
              createdAt: 200,
            }],
          }),
        };
      }
      return { ok: true };
    });
    Object.defineProperty(window, "leemoCapture", {
      configurable: true,
      value: { invoke, onChanged: vi.fn(() => vi.fn()) },
    });
    Object.defineProperty(window, "leemoWorkspace", {
      configurable: true,
      value: { pathForFile: vi.fn(() => "E:/证据.txt") },
    });
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "研究资料 v2");
    await userEvent.upload(screen.getByLabelText("添加文件"), new File(["证据"], "证据.txt", { type: "text/plain" }));

    await waitFor(() => expect(captures.updateNote).toHaveBeenCalledWith({
      id: source.id,
      title: "研究资料 v2",
      markdown: "原文",
      expectedRevision: 1,
    }));
    const attachmentCall = invoke.mock.calls.find(([op]) => op === "attachExternalFile" || op === "attachFileCopy");
    expect(attachmentCall?.[1]).toEqual(expect.objectContaining({ noteId: source.id, expectedRevision: 2, path: "E:/证据.txt" }));
    expect(screen.getByText("证据.txt")).toBeInTheDocument();
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

  it("starts with the Explorer closed on a narrow document and restores focus after Escape", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(max-width: 819px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const source = note("source", { title: "求职主线", markdown: "正文" });
    const captures = captureClient([source]);
    render(<BridgeProvider capture={captures.client}><StartDocumentsView selectedNoteId={source.id} /></BridgeProvider>);

    const surface = await screen.findByTestId("start-documents-view");
    const toggle = screen.getByRole("button", { name: "打开文档列表" });
    expect(surface).toHaveAttribute("data-explorer-open", "false");
    await userEvent.click(toggle);
    expect(surface).toHaveAttribute("data-explorer-open", "true");
    expect(screen.getByRole("button", { name: "关闭文档列表" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(surface).toHaveAttribute("data-explorer-open", "false");
    expect(toggle).toHaveFocus();
  });
});
