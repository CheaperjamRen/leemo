import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note, QuickDraft } from "../../captures";
import type { UserTask } from "../../tasks";
import type { QuickCaptureClient } from "../capture/client";

vi.mock("../components/CaptureEditor", () => ({
  default: ({
    markdown,
    onMarkdownChange,
    onSave,
    onPasteImage,
    onDropFiles,
    disabled,
  }: {
    markdown: string;
    onMarkdownChange(value: string): void;
    onSave(): void;
    onPasteImage?(file: File): void;
    onDropFiles?(files: File[]): void;
    disabled?: boolean;
  }) => (
    <textarea
      aria-label="便签正文"
      value={markdown}
      disabled={disabled}
      onChange={(event) => onMarkdownChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onSave();
        }
      }}
      onPaste={(event) => {
        const file = [...event.clipboardData.files].find((candidate) => candidate.type.startsWith("image/"));
        if (file) onPasteImage?.(file);
      }}
      onDrop={(event) => onDropFiles?.([...event.dataTransfer.files])}
    />
  ),
}));

import QuickCaptureApp from "./QuickCaptureApp";

const draft: QuickDraft = {
  id: "quick",
  mode: "note",
  title: "今天",
  markdown: "先投一份简历",
  plannedAt: null,
  dueAt: null,
  reminderAt: null,
  recurrence: null,
  revision: 3,
  updatedAt: 42,
};

const note: Note = {
  id: "note-1",
  title: draft.title,
  markdown: draft.markdown,
  revision: 1,
  createdAt: 43,
  updatedAt: 43,
};

const task: UserTask = {
  id: "task-1",
  title: "投递简历",
  details: "先整理作品集",
  status: "open",
  plannedAt: new Date("2026-08-10T09:00").getTime(),
  dueAt: new Date("2026-08-12T18:00").getTime(),
  reminderAt: new Date("2026-08-10T08:30").getTime(),
  reminderOffsetMinutes: null,
  recurrence: "weekly",
  notebookId: null,
  noteId: null,
  revision: 1,
  createdAt: 43,
  updatedAt: 43,
  completedAt: null,
};

function createClient(overrides: Partial<QuickCaptureClient> = {}): QuickCaptureClient {
  return {
    getQuickDraft: vi.fn().mockResolvedValue(draft),
    saveQuickDraft: vi.fn().mockImplementation(async (input) => ({
      ...draft,
      ...input,
      revision: input.expectedRevision + 1,
      updatedAt: 43,
    })),
    commitQuickDraft: vi.fn().mockResolvedValue(note),
    createTask: vi.fn().mockResolvedValue(task),
    attachImageBytes: vi.fn().mockResolvedValue({ ...note, revision: 2 }),
    attachDroppedFile: vi.fn().mockResolvedValue({ ...note, revision: 2 }),
    pathForFile: vi.fn(() => "E:/dropped-file.pdf"),
    hide: vi.fn().mockResolvedValue(undefined),
    onChanged: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

describe("QuickCaptureApp", () => {
  it("restores the persisted note draft in the default note mode", async () => {
    const client = createClient();
    render(<QuickCaptureApp client={client} />);

    expect(await screen.findByDisplayValue("今天")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveValue("先投一份简历");
    expect(screen.getByText("便签")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "待办" })).toBeInTheDocument();
  });

  it("uses the approved quiet-capture identity and footer language", async () => {
    const client = createClient();
    const { container } = render(<QuickCaptureApp client={client} />);

    await screen.findByDisplayValue("今天");

    expect(screen.getByLabelText("Leemo 标志")).toBeInTheDocument();
    expect(screen.getByText("快速记录")).toBeInTheDocument();
    expect(screen.queryByText("LEEMO / CAPTURE")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已自动保存");
    expect(screen.getByText(/Ctrl\+S 收下/u)).toBeInTheDocument();
    expect(screen.getByText(/Esc 稍后继续/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收下" })).toBeInTheDocument();
    expect(container.querySelector(".quick-capture__modes")?.parentElement).toHaveClass(
      "quick-capture__mode-bar",
    );
  });

  it("restores all scheduled fields from a persisted task draft", async () => {
    const client = createClient({
      getQuickDraft: vi.fn().mockResolvedValue({
        ...draft,
        mode: "task",
        title: "投递简历",
        markdown: "带上作品集",
        plannedAt: new Date("2026-08-10T09:00").getTime(),
        dueAt: new Date("2026-08-12T18:00").getTime(),
        reminderAt: new Date("2026-08-10T08:30").getTime(),
        recurrence: "weekly",
      }),
    });
    render(<QuickCaptureApp client={client} />);

    expect(await screen.findByRole("textbox", { name: "待办标题" })).toHaveValue("投递简历");
    expect(screen.getByRole("textbox", { name: "待办说明" })).toHaveValue("带上作品集");
    expect(screen.getByLabelText("计划时间")).toHaveValue("2026-08-10T09:00");
    expect(screen.getByLabelText("截止时间")).toHaveValue("2026-08-12T18:00");
    expect(screen.getByLabelText("提醒时间")).toHaveValue("2026-08-10T08:30");
    expect(screen.getByLabelText("重复")).toHaveValue("weekly");
  });

  it("debounces draft persistence in Markdown format", async () => {
    const client = createClient();
    render(<QuickCaptureApp client={client} debounceMs={10} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });

    fireEvent.change(editor, { target: { value: "**重要**" } });

    await waitFor(() => expect(client.saveQuickDraft).toHaveBeenLastCalledWith({
      mode: "note",
      title: "今天",
      markdown: "**重要**",
      plannedAt: null,
      dueAt: null,
      reminderAt: null,
      recurrence: null,
      expectedRevision: 3,
    }));
  });

  it("keeps a pasted image pending until the note is committed", async () => {
    const client = createClient();
    render(<QuickCaptureApp client={client} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });
    const image = new File([new Uint8Array([1, 2, 3])], "截图.png", { type: "image/png" });
    Object.defineProperty(image, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    fireEvent.paste(editor, { clipboardData: { files: [image] } });

    expect(await screen.findByText("已添加 1 个附件")).toBeInTheDocument();
    expect(screen.getByText("截图.png")).toBeInTheDocument();
  });

  it("commits the note before attaching a pasted image and then hides", async () => {
    const user = userEvent.setup();
    const savedDraft = { ...draft, revision: 4 };
    const attachedNote = { ...note, revision: 2 };
    const client = createClient({
      saveQuickDraft: vi.fn().mockResolvedValue(savedDraft),
      commitQuickDraft: vi.fn().mockResolvedValue(note),
      attachImageBytes: vi.fn().mockResolvedValue(attachedNote),
    });
    render(<QuickCaptureApp client={client} debounceMs={60_000} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });
    const image = new File([new Uint8Array([7, 8])], "剪贴图.png", { type: "image/png" });
    Object.defineProperty(image, "arrayBuffer", {
      value: async () => new Uint8Array([7, 8]).buffer,
    });

    fireEvent.paste(editor, { clipboardData: { files: [image] } });
    await screen.findByText("已添加 1 个附件");
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => expect(client.attachImageBytes).toHaveBeenCalledWith({
      noteId: "note-1",
      expectedRevision: 1,
      name: "剪贴图.png",
      mimeType: "image/png",
      bytes: new Uint8Array([7, 8]),
    }));
    expect(client.commitQuickDraft).toHaveBeenCalledWith({ expectedRevision: 3 });
    expect(client.hide).toHaveBeenCalledOnce();
  });

  it("keeps the committed note's remaining attachments visible when storing one fails", async () => {
    const user = userEvent.setup();
    const client = createClient({
      commitQuickDraft: vi.fn().mockResolvedValue(note),
      attachImageBytes: vi.fn().mockRejectedValue(new Error("请先在设置里选择 Leemo 文件存储位置。")),
    });
    render(<QuickCaptureApp client={client} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });
    const image = new File([new Uint8Array([9])], "存储失败.png", { type: "image/png" });
    Object.defineProperty(image, "arrayBuffer", { value: async () => new Uint8Array([9]).buffer });

    fireEvent.paste(editor, { clipboardData: { files: [image] } });
    await screen.findByText("已添加 1 个附件");
    await user.keyboard("{Control>}s{/Control}");

    expect(await screen.findByRole("alert")).toHaveTextContent("选择 Leemo 文件存储位置");
    expect(screen.getByText(/已添加 1 个附件/u)).toBeInTheDocument();
    expect(client.hide).not.toHaveBeenCalled();
  });

  it("Ctrl+S flushes the current draft, commits it, then hides the window", async () => {
    const user = userEvent.setup();
    const savedDraft = { ...draft, markdown: "完成投递", revision: 4 };
    const client = createClient({
      saveQuickDraft: vi.fn().mockResolvedValue(savedDraft),
      commitQuickDraft: vi.fn().mockResolvedValue({ ...note, markdown: "完成投递" }),
    });
    render(<QuickCaptureApp client={client} debounceMs={60_000} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });
    await user.clear(editor);
    await user.type(editor, "完成投递");

    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => expect(client.saveQuickDraft).toHaveBeenCalledWith({
      mode: "note",
      title: "今天",
      markdown: "完成投递",
      plannedAt: null,
      dueAt: null,
      reminderAt: null,
      recurrence: null,
      expectedRevision: 3,
    }));
    expect(client.commitQuickDraft).toHaveBeenCalledWith({ expectedRevision: 4 });
    expect(client.hide).toHaveBeenCalledOnce();
  });

  it("does not commit or hide an empty draft", async () => {
    const user = userEvent.setup();
    const client = createClient({
      getQuickDraft: vi.fn().mockResolvedValue({ ...draft, title: "", markdown: "", revision: 0 }),
    });
    render(<QuickCaptureApp client={client} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });

    await user.click(editor);
    await user.keyboard("{Control>}s{/Control}");

    expect(await screen.findByRole("alert")).toHaveTextContent("请先写下一点内容");
    expect(client.commitQuickDraft).not.toHaveBeenCalled();
    expect(client.hide).not.toHaveBeenCalled();
  });

  it("Escape only hides and never commits", async () => {
    const client = createClient();
    render(<QuickCaptureApp client={client} debounceMs={60_000} />);
    await screen.findByDisplayValue("今天");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(client.hide).toHaveBeenCalledOnce());
    expect(client.commitQuickDraft).not.toHaveBeenCalled();
  });

  it("creates a task from the same window, clears the note draft, and hides", async () => {
    const user = userEvent.setup();
    const client = createClient({
      getQuickDraft: vi.fn().mockResolvedValue({ ...draft, title: "", markdown: "", revision: 0 }),
      saveQuickDraft: vi.fn().mockImplementation(async (input) => ({
        id: "quick",
        ...input,
        revision: input.expectedRevision + 1,
        updatedAt: 44,
      })),
    });
    render(<QuickCaptureApp client={client} debounceMs={60_000} />);

    await screen.findByRole("button", { name: "待办" });
    await user.click(screen.getByRole("button", { name: "待办" }));
    await user.type(screen.getByRole("textbox", { name: "待办标题" }), "投递简历");
    await user.type(screen.getByRole("textbox", { name: "待办说明" }), "先整理作品集");
    await user.type(screen.getByLabelText("计划时间"), "2026-08-10T09:00");
    await user.type(screen.getByLabelText("截止时间"), "2026-08-12T18:00");
    await user.type(screen.getByLabelText("提醒时间"), "2026-08-10T08:30");
    await user.selectOptions(screen.getByLabelText("重复"), "weekly");

    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => expect(client.createTask).toHaveBeenCalledWith({
      title: "投递简历",
      details: "先整理作品集",
      plannedAt: new Date("2026-08-10T09:00").getTime(),
      dueAt: new Date("2026-08-12T18:00").getTime(),
      reminderAt: new Date("2026-08-10T08:30").getTime(),
      recurrence: "weekly",
    }));
    expect(client.saveQuickDraft).toHaveBeenLastCalledWith({
      mode: "note",
      title: "",
      markdown: "",
      plannedAt: null,
      dueAt: null,
      reminderAt: null,
      recurrence: null,
      expectedRevision: 1,
    });
    expect(client.hide).toHaveBeenCalledOnce();
  });

  it("lets a task be saved after its missing-title validation is corrected", async () => {
    const user = userEvent.setup();
    const client = createClient({
      getQuickDraft: vi.fn().mockResolvedValue({ ...draft, title: "", markdown: "", revision: 0 }),
    });
    render(<QuickCaptureApp client={client} debounceMs={60_000} />);

    await user.click(await screen.findByRole("button", { name: "待办" }));
    await user.keyboard("{Control>}s{/Control}");
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写待办标题");

    await user.type(screen.getByRole("textbox", { name: "待办标题" }), "投递简历");
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => expect(client.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "投递简历",
    })));
  });

  it("keeps the current input visible when saving fails", async () => {
    const user = userEvent.setup();
    const client = createClient({
      saveQuickDraft: vi.fn().mockRejectedValue(new Error("内容已在别处更新，请刷新后重试。")),
    });
    render(<QuickCaptureApp client={client} debounceMs={60_000} />);
    const editor = await screen.findByRole("textbox", { name: "便签正文" });
    await user.clear(editor);
    await user.type(editor, "不能丢的内容");

    await user.keyboard("{Control>}s{/Control}");

    expect(await screen.findByRole("alert")).toHaveTextContent("内容已在别处更新");
    expect(editor).toHaveValue("不能丢的内容");
    expect(screen.getByDisplayValue("今天")).toBeInTheDocument();
    expect(client.commitQuickDraft).not.toHaveBeenCalled();
    expect(client.hide).not.toHaveBeenCalled();
  });
});
