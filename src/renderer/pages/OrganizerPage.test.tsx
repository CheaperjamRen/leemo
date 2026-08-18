import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useContext } from "react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CaptureClient } from "../capture/client";
import type { Note } from "../../captures";
import type { CreateTaskInput, UserTask } from "../../tasks";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import type { TaskClient } from "../tasks/client";
import type { WorkspaceClient } from "../workspace/client";
import type { BridgeClient } from "../bridge/client";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import OrganizerPage from "./OrganizerPage";

const titled: Note = {
  id: "note-1",
  title: "秋招材料",
  markdown: "- [ ] 更新作品集",
  revision: 1,
  createdAt: 10,
  updatedAt: 10,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
};

const untitled: Note = {
  id: "note-2",
  title: "",
  markdown: "一个还没来得及整理的想法",
  revision: 1,
  createdAt: 20,
  updatedAt: 20,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
};

const openTask: UserTask = {
  id: "task-1",
  title: "整理秋招作品集",
  details: "补齐项目说明",
  status: "open",
  plannedAt: null,
  dueAt: new Date("2026-08-10T17:00").getTime(),
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

function captureClient(notes: Note[] = [], archivedNotes: Note[] = []): CaptureClient {
  return {
    getQuickDraft: vi.fn(),
    saveQuickDraft: vi.fn(),
    commitQuickDraft: vi.fn(),
    listNotes: vi.fn(async () => notes),
    listArchivedNotes: vi.fn(async () => archivedNotes),
    createNote: vi.fn(async ({ title, markdown }) => ({
      id: "note-new",
      title,
      markdown,
      revision: 1,
      createdAt: 30,
      updatedAt: 30,
      parentId: null,
      sortOrder: 0,
      pinnedAt: null,
      organizedAt: null,
    })),
    updateNote: vi.fn(async ({ id, title, markdown, expectedRevision }) => ({
      id,
      title,
      markdown,
      revision: expectedRevision + 1,
      createdAt: 10,
      updatedAt: 40,
      parentId: null,
      sortOrder: 0,
      pinnedAt: null,
      organizedAt: null,
    })),
    moveNote: vi.fn(async () => notes),
    setNotePinned: vi.fn(async ({ id, expectedRevision, pinned }) => ({
      ...(notes.find((note) => note.id === id)!),
      pinnedAt: pinned ? 50 : null,
      revision: expectedRevision + 1,
      updatedAt: 50,
    })),
    markNoteOrganized: vi.fn(async ({ id, expectedRevision, organized }) => ({
      ...(notes.find((note) => note.id === id)!),
      organizedAt: organized ? 50 : null,
      revision: expectedRevision + 1,
      updatedAt: 50,
    })),
    archiveNote: vi.fn(async ({ id, expectedRevision }) => ({
      ...(notes.find((note) => note.id === id)!), archivedAt: 50, revision: expectedRevision + 1, updatedAt: 50,
    })),
    unarchiveNote: vi.fn(async ({ id, expectedRevision }) => {
      const note = archivedNotes.find((candidate) => candidate.id === id)!;
      const { archivedAt: _archivedAt, ...restored } = note;
      return { ...restored, revision: expectedRevision + 1, updatedAt: 50 };
    }),
    deleteNote: vi.fn(async () => undefined),
    attachImageBytes: vi.fn(),
    attachExternalFile: vi.fn(),
    attachFileCopy: vi.fn(),
    removeAttachment: vi.fn(),
    migrateStorageRoot: vi.fn(),
    onChanged: vi.fn(() => vi.fn()),
  };
}

function taskClient(tasks: UserTask[] = []): TaskClient {
  return {
    listTasks: vi.fn(async () => tasks),
    createTask: vi.fn(async (input: CreateTaskInput) => ({
      ...openTask,
      ...input,
      id: "task-created",
      revision: 1,
    })),
    createManyTasks: vi.fn(async ({ tasks: inputs }: { tasks: CreateTaskInput[] }) => inputs.map((input: CreateTaskInput, index: number) => ({
      ...openTask,
      ...input,
      id: `task-created-${index}`,
      revision: 1,
    }))),
    updateTask: vi.fn(async (input) => ({
      ...openTask,
      ...input,
      revision: input.expectedRevision + 1,
    })),
    deleteTask: vi.fn(async () => undefined),
  };
}

function workspaceClient(): WorkspaceClient {
  return {
    listNotebooks: vi.fn(async () => ({
      root: "C:/Leemo",
      notebooks: [
        { id: "求职", title: "求职", dir: "C:/Leemo/求职", color: "blue", hasMemory: false },
        { id: "课程", title: "课程", dir: "C:/Leemo/课程", color: "green", hasMemory: false },
      ],
    })),
  } as unknown as WorkspaceClient;
}

function StoreCapture({ onReady }: { onReady: (stores: BridgeStores) => void }): null {
  onReady(useContext(BridgeContext) as BridgeStores);
  return null;
}

function renderPage(
  capture: CaptureClient,
  tasks: TaskClient = taskClient(),
  onReady?: (stores: BridgeStores) => void,
  workspace?: WorkspaceClient,
  client?: BridgeClient,
) {
  return render(
    <BridgeProvider client={client} capture={capture} tasks={tasks} workspace={workspace}>
      {onReady ? <StoreCapture onReady={onReady} /> : null}
      <OrganizerPage />
    </BridgeProvider>,
  );
}

function taskResolutionClient(
  resolve: (texts: string[]) => Promise<{ ok: true; items: Array<{ index: number; fields: Array<{ kind: "planned" | "due"; date: string; source: string }> }> }>,
): BridgeClient {
  const fixture = new FixtureBridgeClient();
  return {
    subscribe: fixture.subscribe.bind(fixture),
    invoke: (async (channel, request) => {
      if (channel === "bridge:resolveTaskTimes") {
        const payload = request as { texts: string[] };
        return resolve(payload.texts);
      }
      return fixture.invoke(channel as never, request as never);
    }) as BridgeClient["invoke"],
  };
}

describe("OrganizerPage", () => {
  it("uses the approved compact workboard title without a second explanatory banner", () => {
    renderPage(captureClient());

    expect(screen.getByRole("heading", { level: 1, name: "看板" })).toBeInTheDocument();
    expect(screen.queryByText("便签与待办都留在这里，momo 只在你需要时参与。")).not.toBeInTheDocument();
  });

  it("starts on today and summarizes only real captured notes", async () => {
    renderPage(captureClient([untitled, titled]));

    expect(screen.getByRole("tab", { name: "今天" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "便签" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "待办" })).toBeInTheDocument();
    expect(await screen.findByText("2 条便签")).toBeInTheDocument();
    expect(screen.getAllByText("一个还没来得及整理的想法").length).toBeGreaterThan(0);
    expect(screen.queryByText(/测试待办|示例任务/)).not.toBeInTheDocument();
  });

  it("keeps action and Agent status ahead of records and results on Today", async () => {
    renderPage(captureClient([titled]));

    const primary = screen.getByRole("region", { name: "今天的行动与状态" });
    expect(within(primary).getByRole("region", { name: "今天要做" })).toBeInTheDocument();
    expect(within(primary).getByRole("region", { name: "正在执行" })).toBeInTheDocument();
    expect(within(primary).getByRole("region", { name: "等你处理" })).toBeInTheDocument();

    const secondary = screen.getByRole("region", { name: "今天的记录与成果" });
    expect(within(secondary).getByRole("region", { name: "收集箱" })).toBeInTheDocument();
    expect(within(secondary).getByRole("region", { name: "最近成果" })).toBeInTheDocument();
    expect(within(secondary).getByRole("region", { name: "继续记录" })).toBeInTheDocument();
  });

  it("shows only conversations with a live run under ongoing work", () => {
    let stores!: BridgeStores;
    renderPage(captureClient(), taskClient(), (value) => { stores = value; });

    act(() => {
      stores.conversations.setState({
        byId: {
          active: {
            id: "active", title: "整理岗位资料", titleManuallyUpdated: true, bookId: null,
            source: "workbench", providerId: "test", modelId: "test", createdAt: 1, lastActivityAt: 20, unread: false,
          },
          completed: {
            id: "completed", title: "已经结束的对话", titleManuallyUpdated: true, bookId: null,
            source: "workbench", providerId: "test", modelId: "test", createdAt: 1, lastActivityAt: 10, unread: false,
          },
        },
        order: ["active", "completed"],
        runIds: { active: "run-active", completed: null },
      });
    });

    const ongoing = screen.getByRole("region", { name: "正在执行" });
    expect(within(ongoing).getByRole("button", { name: "整理岗位资料" })).toBeInTheDocument();
    expect(within(ongoing).queryByText("已经结束的对话")).not.toBeInTheDocument();
  });

  it("shows pending approval as attention and opens its real conversation", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    renderPage(captureClient(), taskClient(), (value) => { stores = value; });

    act(() => {
      stores.conversations.setState({
        byId: {
          approval: {
            id: "approval", title: "导出作品集", titleManuallyUpdated: true, bookId: null,
            source: "workbench", providerId: "test", modelId: "test", createdAt: 1, lastActivityAt: 20, unread: false,
          },
        },
        order: ["approval"],
        runIds: { approval: "run-approval" },
      });
      stores.approvals.setState({
        pendingByConversation: {
          approval: {
            kind: "approval", id: "permit-1", conversationId: "approval", runId: "run-approval",
            toolName: "写入文件", inputSummary: "", risk: "moderate", receivedAt: 20,
          },
        },
      });
    });

    const attention = screen.getByRole("region", { name: "等你处理" });
    await user.click(within(attention).getByRole("button", { name: "导出作品集（等你确认）" }));
    expect(stores.conversations.getState().activeId).toBe("approval");
    expect(stores.ui.getState().view).toBe("chat");
  });

  it("shows real recent results and opens the existing results view", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    renderPage(captureClient(), taskClient(), (value) => { stores = value; });

    act(() => {
      stores.artifacts.setState({
        entries: [{
          id: "artifact-1", kind: "file", path: "默认工作区/作品集.md", title: "作品集.md", bookId: null,
          sourceConversationId: "source", sourceRunId: "run-source", createdAt: 20, escaped: false,
        }],
      });
    });

    const results = screen.getByRole("region", { name: "最近成果" });
    await user.click(within(results).getByRole("button", { name: "作品集.md" }));
    expect(stores.ui.getState().view).toBe("artifacts");
  });

  it("opens a real note and saves edits against its visible revision", async () => {
    const capture = captureClient([titled]);
    const user = userEvent.setup();
    renderPage(capture);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    const title = screen.getByLabelText("便签标题");
    expect(title).toHaveValue("秋招材料");
    expect(screen.getByLabelText("便签正文")).toHaveTextContent("更新作品集");

    await user.clear(title);
    await user.type(title, "秋招材料清单");
    await user.click(screen.getByRole("button", { name: "保存便签" }));

    await waitFor(() => expect(capture.updateNote).toHaveBeenCalledWith({
      id: titled.id,
      title: "秋招材料清单",
      markdown: titled.markdown,
      expectedRevision: titled.revision,
    }));
    expect(await screen.findByRole("button", { name: /秋招材料清单/ })).toBeInTheDocument();
  });

  it("keeps the note list and immersive editor as distinct navigation levels", async () => {
    const user = userEvent.setup();
    renderPage(captureClient([titled]));

    await user.click(screen.getByRole("tab", { name: "便签" }));
    expect(screen.getByRole("complementary", { name: "便签列表" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "便签编辑" })).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    expect(screen.getByRole("button", { name: "返回便签列表" })).toBeInTheDocument();
    expect(screen.getByLabelText("便签标题")).toHaveValue("秋招材料");
  });

  it("searches note titles and content, then restores an archived note", async () => {
    const archived: Note = { ...untitled, title: "已完成的想法", markdown: "只在归档中出现的词", archivedAt: 30 };
    const capture = captureClient([titled], [archived]);
    const user = userEvent.setup();
    renderPage(capture);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索便签" }), "更新作品集");
    expect(await screen.findByRole("button", { name: /秋招材料/ })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "搜索便签" }));
    await user.click(screen.getByRole("button", { name: "已归档" }));
    expect(await screen.findByRole("button", { name: /已完成的想法/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /已完成的想法/ }));
    await user.click(screen.getByRole("button", { name: "恢复便签" }));
    await waitFor(() => expect(capture.unarchiveNote).toHaveBeenCalledWith({
      id: archived.id,
      expectedRevision: archived.revision,
    }));
  });

  it("moves ordinary notes and tasks to the trash without confirmation", async () => {
    const capture = captureClient([titled]);
    const tasks = taskClient([openTask]);
    const user = userEvent.setup();
    renderPage(capture, tasks);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    await user.click(screen.getByRole("button", { name: "移入回收站" }));
    await waitFor(() => expect(capture.deleteNote).toHaveBeenCalledWith({
      id: titled.id,
      expectedRevision: titled.revision,
    }));

    await user.click(screen.getByRole("tab", { name: "待办" }));
    await user.click(screen.getByRole("button", { name: "移入回收站 整理秋招作品集" }));
    await waitFor(() => expect(tasks.deleteTask).toHaveBeenCalledWith({
      id: openTask.id,
      expectedRevision: openTask.revision,
    }));
  });

  it("adds an external file to a saved note and lets the user remove it", async () => {
    const user = userEvent.setup();
    let revision = titled.revision;
    let attachments: Note["attachments"] = [];
    const invoke = vi.fn(async (op: string, payload: { path?: string }) => {
      if (op === "attachExternalFile") {
        revision += 1;
        attachments = [{
          id: "attachment-1",
          kind: "file",
          storage: "external",
          name: "resume.pdf",
          path: payload.path!,
          size: 12,
          createdAt: 10,
        }];
      }
      if (op === "removeAttachment") {
        revision += 1;
        attachments = [];
      }
      return { ok: true, response: { ...titled, revision, attachments } };
    });
    Object.defineProperty(window, "leemoCapture", {
      configurable: true,
      value: { invoke, onChanged: vi.fn(() => vi.fn()) },
    });
    Object.defineProperty(window, "leemoWorkspace", {
      configurable: true,
      value: { pathForFile: vi.fn(() => "E:/Downloads/resume.pdf") },
    });
    try {
      renderPage(captureClient([titled]));
      await user.click(screen.getByRole("tab", { name: "便签" }));
      await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
      const file = new File(["pdf"], "resume.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByLabelText("添加附件"), { target: { files: [file] } });

      expect(await screen.findByText("E:/Downloads/resume.pdf")).toBeInTheDocument();
      expect(invoke).toHaveBeenCalledWith("attachExternalFile", expect.objectContaining({
        noteId: titled.id,
        expectedRevision: titled.revision,
        path: "E:/Downloads/resume.pdf",
      }));
      await user.click(screen.getByRole("button", { name: "移除附件 resume.pdf" }));
      await waitFor(() => expect(screen.queryByText("E:/Downloads/resume.pdf")).not.toBeInTheDocument());
      expect(invoke).toHaveBeenCalledWith("removeAttachment", expect.objectContaining({
        noteId: titled.id,
        attachmentId: "attachment-1",
      }));
    } finally {
      delete (window as Window & { leemoCapture?: unknown }).leemoCapture;
      delete (window as Window & { leemoWorkspace?: unknown }).leemoWorkspace;
    }
  });

  it("does not create an empty record and saves a new note from the editor", async () => {
    const capture = captureClient();
    const user = userEvent.setup();
    renderPage(capture);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(within(screen.getByLabelText("便签列表")).getByTitle("新建便签"));
    expect(capture.createNote).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存便签" })).toBeDisabled();

    await user.type(screen.getByLabelText("便签标题"), "突然想到的产品问题");
    await user.click(screen.getByRole("button", { name: "保存便签" }));

    await waitFor(() => expect(capture.createNote).toHaveBeenCalledWith({
      title: "突然想到的产品问题",
      markdown: "",
    }));
    expect(await screen.findByRole("button", { name: /突然想到的产品问题/ })).toBeInTheDocument();
  });

  it("turns ordinary lines and unfinished markdown list items into linked tasks in one batch", async () => {
    const note: Note = {
      ...titled,
      markdown: [
        "整理投递节奏",
        "- 修改简历",
        "2. 2026-08-10 前投递岗位",
        "- [ ] 跟进面试",
        "- [x] 已经完成",
      ].join("\n"),
    };
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient([note]), tasks);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    await user.click(screen.getByRole("button", { name: "从便签创建待办" }));

    const preview = screen.getByLabelText("创建待办预览");
    expect(within(preview).getAllByRole("checkbox")).toHaveLength(4);
    expect(within(preview).queryByDisplayValue("已经完成")).not.toBeInTheDocument();
    await user.click(within(preview).getByRole("button", { name: "创建 4 条待办" }));

    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [
        { title: "整理投递节奏", details: "整理投递节奏", noteId: note.id },
        { title: "修改简历", details: "- 修改简历", noteId: note.id },
        {
          title: "2026-08-10 前投递岗位",
          details: "2. 2026-08-10 前投递岗位",
          noteId: note.id,
          dueAt: new Date("2026-08-10T00:00").getTime(),
        },
        { title: "跟进面试", details: "- [ ] 跟进面试", noteId: note.id },
      ],
    }));
    expect(screen.queryByLabelText("创建待办预览")).not.toBeInTheDocument();
    expect(screen.getByText("已创建 4 条待办 · 便签原文保留")).toBeInTheDocument();
  });

  it("lets a user exclude a note line before creating the task batch", async () => {
    const note: Note = { ...titled, markdown: "- 修改简历\n- 跟进面试" };
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient([note]), tasks);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    await user.click(screen.getByRole("button", { name: "从便签创建待办" }));
    await user.click(screen.getByRole("checkbox", { name: "选择待办 修改简历" }));
    await user.click(screen.getByRole("button", { name: "创建 1 条待办" }));

    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [{ title: "跟进面试", details: "- 跟进面试", noteId: note.id }],
    }));
  });

  it("does not guess ambiguous dates when turning a note into tasks", async () => {
    const note: Note = { ...titled, markdown: "周五和周日看两家公司" };
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient([note]), tasks);

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    await user.click(screen.getByRole("button", { name: "从便签创建待办" }));

    expect(screen.getByText(/多个日期.*无法.*判断/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 1 条待办" })).toBeDisabled();
    const title = screen.getByRole("textbox", { name: "待办标题 1" });
    await user.clear(title);
    await user.type(title, "看两家公司");
    await user.click(screen.getByRole("button", { name: "创建 1 条待办" }));

    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [{
        title: "看两家公司",
        details: "周五和周日看两家公司",
        noteId: note.id,
      }],
    }));
  });

  it("resolves and lets the user edit time labels before a note becomes a task batch", async () => {
    const note: Note = { ...titled, markdown: "周五开始整理材料，周日之前提交" };
    const tasks = taskClient();
    let stores!: BridgeStores;
    const resolve = vi.fn(async () => ({
      ok: true as const,
      items: [{
        index: 0,
        fields: [
          { kind: "planned" as const, date: "2026-08-14", source: "周五" },
          { kind: "due" as const, date: "2026-08-16", source: "周日" },
        ],
      }],
    }));
    const user = userEvent.setup();
    renderPage(
      captureClient([note]),
      tasks,
      (value) => { stores = value; },
      undefined,
      taskResolutionClient(resolve),
    );
    act(() => stores.settings.getState().setDefaultModel("deepseek", "deepseek-chat"));

    await user.click(screen.getByRole("tab", { name: "便签" }));
    await user.click(await screen.findByRole("button", { name: /秋招材料/ }));
    await user.click(screen.getByRole("button", { name: "从便签创建待办" }));
    await user.click(await screen.findByRole("button", { name: "截止 8月16日" }));
    fireEvent.change(screen.getByLabelText("截止时间 1"), { target: { value: "2026-08-17T18:00" } });
    await user.click(screen.getByRole("button", { name: "创建 1 条待办" }));

    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [expect.objectContaining({
        title: "周五开始整理材料，周日之前提交",
        plannedAt: new Date("2026-08-14T00:00").getTime(),
        dueAt: new Date("2026-08-17T18:00").getTime(),
      })],
    }));
  });

  it("parses a quick task locally and shows editable meaning before saving", async () => {
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient(), tasks);

    await user.click(screen.getByRole("tab", { name: "待办" }));
    await user.type(screen.getByLabelText("快速新增待办"), "2026-08-10 17:00 前提交作品集");

    expect(screen.getByText(/截止.*8月10日.*17:00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增待办" }));

    await waitFor(() => expect(tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "2026-08-10 17:00 前提交作品集",
      dueAt: new Date("2026-08-10T17:00").getTime(),
    })));
    expect(await screen.findByText("2026-08-10 17:00 前提交作品集")).toBeInTheDocument();
  });

  it("lets a user fill all common task details in the first creation flow", async () => {
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient(), tasks);

    await user.click(screen.getByRole("tab", { name: "待办" }));
    await user.type(screen.getByLabelText("快速新增待办"), "准备群面");
    await user.click(screen.getByRole("button", { name: "补充信息" }));
    await user.type(screen.getByLabelText("待办详情"), "复盘岗位要求");
    fireEvent.change(screen.getByLabelText("计划时间"), { target: { value: "2026-08-09T19:00" } });
    fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2026-08-10T17:00" } });
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "2026-08-10T15:00" } });
    await user.selectOptions(screen.getByLabelText("重复"), "weekdays");
    await user.click(screen.getByRole("button", { name: "新增待办" }));

    await waitFor(() => expect(tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "准备群面",
      details: "复盘岗位要求",
      plannedAt: new Date("2026-08-09T19:00").getTime(),
      dueAt: new Date("2026-08-10T17:00").getTime(),
      reminderAt: new Date("2026-08-10T15:00").getTime(),
      recurrence: "weekdays",
    })));
  });

  it("lets a user choose a notebook when creating and editing a task", async () => {
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient(), tasks, undefined, workspaceClient());

    await user.click(screen.getByRole("tab", { name: "待办" }));
    await user.type(screen.getByLabelText("快速新增待办"), "准备面试");
    await user.click(screen.getByRole("button", { name: "补充信息" }));
    await user.selectOptions(await screen.findByLabelText("关联本子"), "求职");
    await user.click(screen.getByRole("button", { name: "新增待办" }));

    await waitFor(() => expect(tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "准备面试",
      notebookId: "求职",
    })));
    await user.click(screen.getByRole("button", { name: "编辑 准备面试" }));
    await user.selectOptions(screen.getByLabelText("关联本子"), "课程");
    await user.click(screen.getByRole("button", { name: "保存待办" }));

    await waitFor(() => expect(tasks.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: "task-created",
      notebookId: "课程",
    })));
  });

  it("creates one task per non-empty line but never guesses ambiguous date roles", async () => {
    const tasks = taskClient();
    const user = userEvent.setup();
    renderPage(captureClient(), tasks);

    await user.click(screen.getByRole("tab", { name: "待办" }));
    const input = screen.getByLabelText("快速新增待办");
    await user.type(input, "修改简历{enter}2026-08-10 前投递岗位");
    await user.click(screen.getByRole("button", { name: "批量新增 2 条待办" }));
    await waitFor(() => expect(tasks.createManyTasks).toHaveBeenCalledWith({
      tasks: [
        expect.objectContaining({ title: "修改简历" }),
        expect.objectContaining({
          title: "2026-08-10 前投递岗位",
          dueAt: new Date("2026-08-10T00:00").getTime(),
        }),
      ],
    }));

    await user.type(input, "周五和周日看两家公司");
    expect(await screen.findByText(/需要确认.*计划、截止还是提醒/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增待办" })).toBeDisabled();
  });

  it("uses the same date category for an undated task created today on Today and in the task list", async () => {
    const createdAt = Date.now();
    const newUndatedTask: UserTask = {
      ...openTask,
      id: "task-new-undated",
      title: "整理今天收集的岗位",
      plannedAt: null,
      dueAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    const user = userEvent.setup();
    renderPage(captureClient(), taskClient([newUndatedTask]));

    const today = screen.getByRole("region", { name: "今天要做" });
    expect(await within(today).findByText(newUndatedTask.title)).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "待办" }));
    const todayGroup = await screen.findByRole("region", { name: "今天待办" });
    expect(within(todayGroup).getByText(newUndatedTask.title)).toBeInTheDocument();
  });

  it("groups an overdue open task as overdue instead of upcoming", async () => {
    const overdueAt = new Date();
    overdueAt.setDate(overdueAt.getDate() - 1);
    overdueAt.setHours(17, 0, 0, 0);
    const overdueTask: UserTask = {
      ...openTask,
      id: "task-overdue",
      title: "补交昨天到期的材料",
      dueAt: overdueAt.getTime(),
    };
    const user = userEvent.setup();
    renderPage(captureClient(), taskClient([overdueTask]));

    await user.click(screen.getByRole("tab", { name: "待办" }));

    const overdueGroup = await screen.findByRole("region", { name: "已过期待办" });
    expect(within(overdueGroup).getByText(overdueTask.title)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "接下来待办" })).not.toBeInTheDocument();
  });

  it("shows saved reminder recurrence and notebook information in a compact task row", async () => {
    const reminderAt = new Date();
    reminderAt.setDate(reminderAt.getDate() + 1);
    reminderAt.setHours(15, 0, 0, 0);
    const taskWithMetadata: UserTask = {
      ...openTask,
      id: "task-with-metadata",
      title: "准备明天的群面",
      reminderAt: reminderAt.getTime(),
      reminderOffsetMinutes: null,
      recurrence: "weekdays",
      notebookId: "求职",
    };
    const user = userEvent.setup();
    renderPage(captureClient(), taskClient([taskWithMetadata]), undefined, workspaceClient());

    await user.click(screen.getByRole("tab", { name: "待办" }));

    const row = (await screen.findByText(taskWithMetadata.title)).closest("article");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(/^提醒 /)).toBeInTheDocument();
    expect(within(row!).getByText("工作日重复")).toBeInTheDocument();
    expect(within(row!).getByText("本子 求职")).toBeInTheDocument();
  });

  it("filters the task list using only persisted status and dates", async () => {
    const completedTask: UserTask = {
      ...openTask,
      id: "task-done",
      title: "已经完成的简历检查",
      status: "done",
      completedAt: 20,
    };
    const user = userEvent.setup();
    renderPage(captureClient(), taskClient([openTask, completedTask]));

    await user.click(screen.getByRole("tab", { name: "待办" }));
    expect(await screen.findByText(openTask.title)).toBeInTheDocument();
    expect(screen.queryByText(completedTask.title)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "已完成 1" }));
    expect(screen.getByText(completedTask.title)).toBeInTheDocument();
    expect(screen.queryByText(openTask.title)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "补充信息" })).toHaveAttribute("aria-expanded", "false");
  });

  it("uses the configured model once for ambiguous task lines and keeps the result editable", async () => {
    const tasks = taskClient();
    let stores!: BridgeStores;
    const resolve = vi.fn(async (texts: string[]) => ({
      ok: true as const,
      items: texts.map((_, index) => ({
        index,
        fields: [
          { kind: "planned" as const, date: "2026-08-14", source: "周五" },
          { kind: "due" as const, date: "2026-08-16", source: "周日" },
        ],
      })),
    }));
    renderPage(
      captureClient(),
      tasks,
      (value) => { stores = value; },
      undefined,
      taskResolutionClient(resolve),
    );
    act(() => stores.settings.getState().setDefaultModel("deepseek", "deepseek-chat"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "待办" }));
    await user.type(screen.getByLabelText("快速新增待办"), "周五开始整理材料，周日之前提交");

    expect(await screen.findByText("计划 8月14日")).toBeInTheDocument();
    expect(screen.getByText("截止 8月16日")).toBeInTheDocument();
    expect(resolve).toHaveBeenCalledWith(["周五开始整理材料，周日之前提交"]);
    await user.click(screen.getByRole("button", { name: "计划 8月14日" }));
    expect(screen.getByLabelText("计划时间")).toHaveValue("2026-08-14T00:00");
    expect(screen.getByLabelText("截止时间")).toHaveValue("2026-08-16T00:00");
    await user.click(screen.getByRole("button", { name: "新增待办" }));
    await waitFor(() => expect(tasks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      plannedAt: new Date("2026-08-14T00:00").getTime(),
      dueAt: new Date("2026-08-16T00:00").getTime(),
    })));
  });

  it("completes, reopens and edits a real persisted task", async () => {
    const tasks = taskClient([openTask]);
    const user = userEvent.setup();
    renderPage(captureClient(), tasks);

    await user.click(screen.getByRole("tab", { name: "待办" }));
    const check = await screen.findByRole("checkbox", { name: `完成 ${openTask.title}` });
    await user.click(check);
    await waitFor(() => expect(tasks.updateTask).toHaveBeenCalledWith({
      id: openTask.id,
      expectedRevision: openTask.revision,
      status: "done",
    }));

    await user.click(await screen.findByRole("button", { name: "已完成 1" }));
    await user.click(await screen.findByRole("checkbox", { name: `重新打开 ${openTask.title}` }));
    await waitFor(() => expect(tasks.updateTask).toHaveBeenCalledWith({
      id: openTask.id,
      expectedRevision: 2,
      status: "open",
    }));

    await user.click(await screen.findByRole("button", { name: "未完成 1" }));
    await user.click(screen.getByRole("button", { name: `编辑 ${openTask.title}` }));
    const title = screen.getByLabelText("快速新增待办");
    await user.clear(title);
    await user.type(title, "整理秋招项目材料");
    await user.click(screen.getByRole("button", { name: "保存待办" }));
    await waitFor(() => expect(tasks.updateTask).toHaveBeenLastCalledWith(expect.objectContaining({
      id: openTask.id,
      title: "整理秋招项目材料",
    })));
  });

  it("lists deleted notes and tasks, restores them, and confirms permanent deletion once", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const trashedNote: Note = { ...titled, revision: 2, deletedAt: 100, purgeAfter: 2_592_000_100 };
    const trashedTask: UserTask = { ...openTask, revision: 2, deletedAt: 100, purgeAfter: 2_592_000_100 };
    const invoke = vi.fn(async (op: string) => {
      if (op === "list") return { ok: true, response: { notes: [trashedNote], tasks: [trashedTask] } };
      return { ok: true, response: undefined };
    });
    Object.defineProperty(window, "leemoTrash", { configurable: true, value: { invoke } });
    try {
      renderPage(captureClient(), taskClient());
      await user.click(screen.getByRole("tab", { name: "回收站" }));

      expect(await screen.findByText("秋招材料")).toBeInTheDocument();
      expect(screen.queryByText("整理秋招作品集")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "查看已删除待办 1" }));
      expect(screen.getByText("整理秋招作品集")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "恢复便签 秋招材料" }));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("restore", {
        kind: "note", id: titled.id, expectedRevision: 2,
      }));

      await user.click(screen.getByRole("button", { name: "彻底删除待办 整理秋招作品集" }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith("permanentlyDelete", {
        kind: "task", id: openTask.id, expectedRevision: 2,
      });
    } finally {
      confirm.mockRestore();
      delete (window as Window & { leemoTrash?: unknown }).leemoTrash;
    }
  });
});
