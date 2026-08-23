import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import InputArea from "./InputArea";
import type { SkillInfo } from "../../bridge/contract";
import type { ComposerDraft } from "../stores/composer-drafts";
import type { WorkspaceFileNode } from "../workspace/client";
import type { Note } from "../../captures";

const NOTE_ORGANIZATION = {
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
} as const;

describe("InputArea", () => {
  it("shares one composer across surfaces with a real plus menu and standalone slash/reference actions", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <InputArea {...defaultProps} surface="workbench" resolveFilePath={resolveFilePath} />,
    );

    expect(screen.getByTestId("shared-composer")).toHaveAttribute("data-surface", "workbench");
    expect(screen.getAllByRole("button", { name: "/ 技能" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "@ 引用" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "添加" }));
    const menu = screen.getByRole("menu", { name: "添加到对话" });
    const composer = screen.getByTestId("composer-surface");
    expect(composer).toContainElement(menu);
    expect(menu).toHaveClass("absolute", "bottom-[calc(100%+8px)]");
    expect(menu).toHaveClass("sm:w-[440px]");
    expect(within(menu).getByRole("menuitem", { name: /^文件/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemcheckbox", { name: /计划模式/ })).toBeInTheDocument();
    expect(within(menu).queryByText(/麦克风|塔罗|队列|浏览器|Skill|技能/)).not.toBeInTheDocument();

    rerender(<InputArea {...defaultProps} surface="buddy" resolveFilePath={resolveFilePath} />);
    expect(screen.getByTestId("shared-composer")).toHaveAttribute("data-surface", "buddy");
    const buddySurface = screen.getByTestId("composer-surface");
    expect(within(buddySurface).getByRole("button", { name: "切换模型" })).toBeInTheDocument();
    expect(within(buddySurface).getByRole("button", { name: "权限模式：风险确认" })).toBeInTheDocument();
    expect(within(buddySurface).getByRole("button", { name: "本轮自动召集助手" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "切换模型" })).toHaveLength(1);
  });

  const resolveFilePath = (file: File) => `C:\\Users\\Rengar\\Downloads\\${file.name}`;
  const defaultProps = {
    conversationId: "conv-1",
    value: "",
    onChange: vi.fn(),
    onSend: vi.fn(),
    busy: false,
    onStop: vi.fn(),
  };

  it("uses a floating composer surface without a redundant toolbar divider", () => {
    const { container } = render(<InputArea {...defaultProps} />);
    const root = container.firstElementChild;
    expect(root).toHaveClass("bg-transparent");
    expect(root).not.toHaveClass("border-t");
    expect(container.querySelector(".leemo-input-shadow")).toBeInTheDocument();
  });

  it("keeps the primary composer action right-aligned even when the shortcut hint is hidden", () => {
    const { rerender } = render(<InputArea {...defaultProps} />);
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass(
      "ml-auto",
      "h-[38px]",
      "w-[38px]",
      "rounded-[12px]",
    );
    expect(screen.getByRole("button", { name: "/ 技能" })).toHaveClass("h-8", "w-8");
    expect(screen.getByRole("button", { name: "@ 引用" })).toHaveClass("h-8", "w-8");
    expect(screen.getByRole("button", { name: "/ 技能" }).querySelector("span")).toHaveClass(
      "leemo-composer-slash-glyph",
      "leading-none",
    );

    rerender(<InputArea {...defaultProps} busy />);
    expect(screen.getByRole("button", { name: "停止" })).toHaveClass("ml-auto", "h-10", "w-10");
  });

  it("uses icon fallbacks for constrained workbench widths and exposes no fake voice action", () => {
    render(<InputArea {...defaultProps} surface="workbench" currentModelId="deepseek-chat" />);

    expect(screen.getByTestId("composer-model-label")).toHaveClass("leemo-composer-responsive-label");
    expect(screen.getByTestId("composer-permission-label")).toHaveClass("leemo-composer-responsive-label");
    expect(screen.getByTestId("composer-shortcut-hint")).toHaveClass("leemo-composer-shortcut");
    expect(screen.queryByRole("button", { name: /语音|麦克风/ })).not.toBeInTheDocument();
  });

  it("renders textarea with placeholder", () => {
    const { rerender } = render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);
    const textarea = screen.getByPlaceholderText("输入消息…");
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveStyle({ minHeight: "66px" });
    expect(textarea).toHaveClass("text-[14.5px]");

    rerender(<InputArea {...defaultProps} surface="buddy" resolveFilePath={resolveFilePath} />);
    expect(screen.getByPlaceholderText("输入消息…")).toHaveClass("text-[15.5px]");
  });

  it("displays current value", () => {
    render(<InputArea {...defaultProps} value="Hello momo" />);
    const textarea = screen.getByDisplayValue("Hello momo");
    expect(textarea).toBeInTheDocument();
  });

  it("calls onChange when typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} onChange={onChange} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.type(textarea, "H");

    expect(onChange).toHaveBeenCalledWith("H");
  });

  it("sends message on Enter key (non-composing, non-busy)", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} value="Test message" onSend={onSend} onChange={onChange} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("Test message", undefined);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("adds multiple @ note references as chips and sends only their stable ids", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const notes: Note[] = [
      { id: "note-course", title: "课程计划", markdown: "复习第三章", revision: 1, createdAt: 1, updatedAt: 1, ...NOTE_ORGANIZATION },
      { id: "note-job", title: "求职记录", markdown: "投递两家公司", revision: 1, createdAt: 1, updatedAt: 1, ...NOTE_ORGANIZATION },
    ];
    function ControlledComposer() {
      const [value, setValue] = useState("请帮我整理 @课");
      return <InputArea {...defaultProps} value={value} onChange={setValue} onSend={onSend} notes={notes} />;
    }

    render(<ControlledComposer />);
    await user.click(screen.getByRole("button", { name: "引用便签 课程计划" }));
    const textarea = screen.getByLabelText("输入消息");
    await user.type(textarea, " @求");
    await user.click(screen.getByRole("button", { name: "引用便签 求职记录" }));

    expect(screen.getByRole("button", { name: "移除便签引用 课程计划" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除便签引用 求职记录" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledWith(
      "请帮我整理 @课程计划  @求职记录",
      undefined,
      undefined,
      { noteReferences: ["note-course", "note-job"] },
    );
  });

  it("opens one unified @ picker with both notes and workspace files", async () => {
    const user = userEvent.setup();
    const notes: Note[] = [
      { id: "note-course", title: "课程计划", markdown: "复习第三章", revision: 1, createdAt: 1, updatedAt: 1, ...NOTE_ORGANIZATION },
    ];
    const workspaceFiles: WorkspaceFileNode[] = [{
      name: "课程",
      path: "课程",
      kind: "dir",
      bookId: "课程",
      children: [
        { name: "复习清单.md", path: "课程/复习清单.md", kind: "file", bookId: "课程" },
      ],
    }];

    function ControlledComposer() {
      const [value, setValue] = useState("");
      return (
        <InputArea
          {...defaultProps}
          value={value}
          onChange={setValue}
          notes={notes}
          workspaceFiles={workspaceFiles}
          workspaceId="workspace-course"
        />
      );
    }

    render(<ControlledComposer />);
    await user.click(screen.getByRole("button", { name: "@ 引用" }));

    const picker = screen.getByRole("listbox", { name: "引用文件或便签" });
    expect(within(picker).getByRole("option", { name: /便签 课程计划/ })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: /文件 复习清单\.md/ })).toBeInTheDocument();
    expect(within(picker).queryByRole("option", { name: /文件 课程 课程/ })).not.toBeInTheDocument();

    await user.click(within(picker).getByRole("option", { name: /文件 复习清单\.md/ }));
    expect(screen.getByRole("button", { name: "移除引用 复习清单.md" })).toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toHaveValue("@复习清单.md ");
  });

  it("queues the next message on Enter when busy without calling ordinary send", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onQueue = vi.fn();
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} value="Test" busy onSend={onSend} onQueue={onQueue} onChange={onChange} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).toHaveBeenCalledWith("Test", undefined);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("queues a busy turn with a note reference and its per-turn helper option intact", async () => {
    const user = userEvent.setup();
    const onQueue = vi.fn();
    const notes: Note[] = [
      { id: "note-course", title: "课程计划", markdown: "复习第三章", revision: 1, createdAt: 1, updatedAt: 1, ...NOTE_ORGANIZATION },
    ];
    function ControlledComposer() {
      const [value, setValue] = useState("运行中也整理 @课");
      return (
        <InputArea
          {...defaultProps}
          value={value}
          onChange={setValue}
          onQueue={onQueue}
          notes={notes}
          busy
        />
      );
    }

    render(<ControlledComposer />);
    await user.click(screen.getByRole("button", { name: "引用便签 课程计划" }));
    await user.click(screen.getByRole("button", { name: "本轮自动召集助手" }));
    await user.click(screen.getByLabelText("输入消息"));
    await user.keyboard("{Enter}");

    expect(onQueue).toHaveBeenCalledWith(
      "运行中也整理 @课程计划",
      undefined,
      undefined,
      { allowSubagents: false, noteReferences: ["note-course"] },
    );
  });

  it("shows one compact queued-turn row with icon actions and an honest rich-guide guard", async () => {
    const user = userEvent.setup();
    const onEditQueuedTurn = vi.fn();
    const onDeleteQueuedTurn = vi.fn();
    const onGuideQueuedTurn = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        busy
        queuedTurns={[{
          id: "queued-1",
          text: "按岗位要求继续修改这份简历并保留原版",
          attachments: [{ name: "JD.pdf", path: "C:\\Temp\\JD.pdf", size: 1 }],
          workspaceFiles: [],
        }]}
        onEditQueuedTurn={onEditQueuedTurn}
        onDeleteQueuedTurn={onDeleteQueuedTurn}
        onGuideQueuedTurn={onGuideQueuedTurn}
      />,
    );

    const row = screen.getByTestId("queued-turn-row");
    expect(row).toHaveTextContent("按岗位要求继续修改这份简历");
    expect(row).toHaveTextContent("1 个文件");
    expect(row.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "转为引导" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "转为引导" })).toHaveAttribute(
      "title",
      "含附件、文件或便签，不能转为引导",
    );
    await user.click(screen.getByRole("button", { name: "编辑排队消息" }));
    expect(onEditQueuedTurn).toHaveBeenCalledWith("queued-1");
    await user.click(screen.getByRole("button", { name: "删除排队消息" }));
    expect(onDeleteQueuedTurn).toHaveBeenCalledWith("queued-1");
    expect(onGuideQueuedTurn).not.toHaveBeenCalled();
  });

  it("expands later queued turns into a bounded list where every row remains actionable", async () => {
    const user = userEvent.setup();
    const onEditQueuedTurn = vi.fn();
    const onDeleteQueuedTurn = vi.fn();
    const onGuideQueuedTurn = vi.fn(async () => ({ delivery: "applied" as const }));
    render(
      <InputArea
        {...defaultProps}
        busy
        queuedTurns={[
          { id: "queued-1", text: "第一条排队消息", attachments: [], workspaceFiles: [] },
          { id: "queued-2", text: "第二条排队消息", attachments: [], workspaceFiles: [] },
          { id: "queued-3", text: "第三条排队消息", attachments: [], workspaceFiles: [] },
        ]}
        onEditQueuedTurn={onEditQueuedTurn}
        onDeleteQueuedTurn={onDeleteQueuedTurn}
        onGuideQueuedTurn={onGuideQueuedTurn}
      />,
    );

    expect(screen.queryByText("第二条排队消息")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "另有 2 条" }));

    const extraRows = screen.getAllByTestId("queued-turn-extra-row");
    expect(extraRows).toHaveLength(2);
    expect(screen.getByTestId("queued-turn-list")).toHaveClass("max-h-36", "overflow-y-auto");
    await user.click(within(extraRows[0]).getByRole("button", { name: "编辑排队消息" }));
    await user.click(within(extraRows[0]).getByRole("button", { name: "转为引导" }));
    await user.click(within(extraRows[1]).getByRole("button", { name: "删除排队消息" }));

    expect(onEditQueuedTurn).toHaveBeenCalledWith("queued-2");
    expect(onGuideQueuedTurn).toHaveBeenCalledWith("queued-2");
    expect(onDeleteQueuedTurn).toHaveBeenCalledWith("queued-3");
  });

  it("guides a pure-text queued row and reports native queued delivery honestly", async () => {
    const user = userEvent.setup();
    const onGuideQueuedTurn = vi.fn(async () => ({ delivery: "queued" as const }));
    render(
      <InputArea
        {...defaultProps}
        busy
        queuedTurns={[{ id: "queued-plain", text: "先不要改原文件", attachments: [], workspaceFiles: [] }]}
        onGuideQueuedTurn={onGuideQueuedTurn}
      />,
    );

    await user.click(screen.getByRole("button", { name: "转为引导" }));
    expect(onGuideQueuedTurn).toHaveBeenCalledWith("queued-plain");
    expect(await screen.findByText("已排队，将在下一轮送达")).toBeInTheDocument();
  });

  it("uses Ctrl+Enter to guide the running task and keeps ordinary send untouched while idle", async () => {
    const user = userEvent.setup();
    const onGuide = vi.fn(async () => ({ delivery: "applied" as const }));
    const onSend = vi.fn();
    const onChange = vi.fn();
    const { rerender } = render(
      <InputArea {...defaultProps} value="先看第三章" busy onGuide={onGuide} onSend={onSend} onChange={onChange} />,
    );
    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(onGuide).toHaveBeenCalledWith("先看第三章"));
    expect(onSend).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getByText("已加入当前任务")).toBeInTheDocument();

    rerender(<InputArea {...defaultProps} value="普通消息" onGuide={onGuide} onSend={onSend} onChange={onChange} />);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSend).toHaveBeenCalledWith("普通消息", undefined);
  });

  it("keeps guidance text when native steering fails", async () => {
    const user = userEvent.setup();
    const onGuide = vi.fn(async () => { throw new Error("暂时无法加入当前任务"); });
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} value="别删除原文件" busy onGuide={onGuide} onChange={onChange} />);

    await user.click(screen.getByPlaceholderText("输入消息…"));
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法加入当前任务");
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("keeps a composer error compact and dismissible without clearing the draft", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [draft, setDraft] = useState<ComposerDraft>({
        text: "保留这段草稿",
        attachments: [],
        workspaceFiles: [],
        submitPending: false,
        retryPending: false,
        submitError: "还没有配置 API Key，先去设置页完成模型接入。",
        pendingStageCount: 0,
        assignedConversationId: null,
      });
      return (
        <InputArea
          {...defaultProps}
          value="保留这段草稿"
          draftState={draft}
          onDraftStateChange={setDraft}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByRole("alert")).toHaveClass("leemo-composer-alert");
    await user.click(screen.getByRole("button", { name: "关闭错误提示" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toHaveValue("保留这段草稿");
  });

  it("keeps rich input out of Ctrl+Enter guidance and points it to the next-round queue", async () => {
    const user = userEvent.setup();
    const onGuide = vi.fn(async () => ({ delivery: "applied" as const }));
    const file = new File(["jd"], "JD.pdf", { type: "application/pdf" });
    render(
      <InputArea
        {...defaultProps}
        value="结合附件继续"
        busy
        onGuide={onGuide}
        resolveFilePath={resolveFilePath}
      />,
    );
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /^文件/ }));
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);

    await user.click(screen.getByPlaceholderText("输入消息…"));
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onGuide).not.toHaveBeenCalled();
    expect(screen.getByText("引导只支持纯文字；附件、文件或便签可按 Enter 排到下一轮")).toBeInTheDocument();
  });

  it("inserts newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} value="Line 1" onChange={onChange} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onChange).toHaveBeenCalledWith("Line 1\n");
  });

  it("does not send empty message", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputArea {...defaultProps} value="   " onSend={onSend} />);

    const sendButton = screen.getByLabelText("发送");
    expect(sendButton).toHaveClass("leemo-composer-submit");
    expect(sendButton).not.toHaveClass("bg-[var(--leemo-amber)]");
    await user.click(sendButton);

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends message on send button click", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} value="Button test" onSend={onSend} onChange={onChange} />);

    const sendButton = screen.getByLabelText("发送");
    expect(sendButton).toHaveClass("leemo-composer-submit");
    expect(sendButton).not.toHaveClass("bg-[var(--leemo-amber)]");
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith("Button test", undefined);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("lets the user disable helpers for this turn and resets after acknowledgement", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => {});
    render(<InputArea {...defaultProps} value="我自己和 momo 做" onSend={onSend} />);

    const enabledButton = screen.getByRole("button", { name: "本轮自动召集助手" });
    expect(enabledButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("assistant-disabled-slash")).not.toBeInTheDocument();

    await user.click(enabledButton);
    const disabledButton = screen.getByRole("button", { name: "本轮不使用助手" });
    expect(disabledButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("assistant-disabled-slash")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledWith(
      "我自己和 momo 做",
      undefined,
      undefined,
      { allowSubagents: false },
    );
    expect(screen.getByRole("button", { name: "本轮自动召集助手" })).toBeInTheDocument();
  });

  it("shows stop button when busy", () => {
    render(<InputArea {...defaultProps} busy={true} />);
    const stopButton = screen.getByLabelText("停止");
    expect(stopButton).toBeInTheDocument();
  });

  it("calls onStop when stop button clicked", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<InputArea {...defaultProps} busy={true} onStop={onStop} />);

    const stopButton = screen.getByLabelText("停止");
    await user.click(stopButton);

    expect(onStop).toHaveBeenCalled();
  });

  it("shows attachment row when files selected", async () => {
    const user = userEvent.setup();
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /^文件/ }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(screen.getByText("test.txt")).toBeInTheDocument();
  });

  it("treats files dropped on the composer as turn attachments and shows a clear drop state", () => {
    const file = new File(["content"], "课程讲义.pdf", { type: "application/pdf" });
    const { container } = render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);
    const composer = container.querySelector(".leemo-input-shadow") as HTMLElement;
    const transfer = { files: [file], types: ["Files"] };

    fireEvent.dragEnter(composer, { dataTransfer: transfer });
    expect(screen.getByText("松开作为本轮附件")).toBeInTheDocument();
    expect(composer).toHaveAttribute("data-file-drop-active", "true");

    fireEvent.drop(composer, { dataTransfer: transfer });
    expect(screen.getByText("课程讲义.pdf")).toBeInTheDocument();
    expect(screen.queryByText("松开作为本轮附件")).not.toBeInTheDocument();
  });

  it("accepts a workspace Explorer drag as a guarded reference for this turn", () => {
    const { container } = render(
      <InputArea
        {...defaultProps}
        workspaceId="leemo-home"
        workspaceFiles={[{ name: "课程讲义.pdf", path: "课程/课程讲义.pdf", kind: "file", bookId: "课程" }]}
      />,
    );
    const composer = container.querySelector(".leemo-input-shadow") as HTMLElement;
    const transfer = {
      files: [],
      types: ["application/x-leemo-workspace-file"],
      getData: (type: string) => type === "application/x-leemo-workspace-file"
        ? JSON.stringify({ name: "课程讲义.pdf", workspaceId: "leemo-home", workspacePath: "课程/课程讲义.pdf" })
        : "",
    };

    fireEvent.dragEnter(composer, { dataTransfer: transfer });
    expect(screen.getByText("松开作为本轮附件")).toBeInTheDocument();
    fireEvent.drop(composer, { dataTransfer: transfer });

    expect(screen.getByText("课程讲义.pdf")).toBeInTheDocument();
    expect(screen.getByText("工作区")).toBeInTheDocument();
  });

  it("claims a file drop inside the composer so the workspace does not import it too", () => {
    const parentDrop = vi.fn();
    const file = new File(["content"], "只发本轮.txt", { type: "text/plain" });
    const { container } = render(
      <div onDrop={parentDrop}>
        <InputArea {...defaultProps} resolveFilePath={resolveFilePath} />
      </div>,
    );
    const composer = container.querySelector(".leemo-input-shadow") as HTMLElement;

    fireEvent.drop(composer, { dataTransfer: { files: [file], types: ["Files"] } });

    expect(screen.getByText("只发本轮.txt")).toBeInTheDocument();
    expect(parentDrop).not.toHaveBeenCalled();
  });

  it("stages a pasted clipboard image as a real local attachment", async () => {
    const stageClipboardImage = vi.fn(async () => ({
      name: "粘贴图片.png",
      path: "C:\\Temp\\Leemo\\clipboard-1.png",
      size: 321,
      mimeType: "image/png",
    }));
    render(
      <InputArea
        {...defaultProps}
        resolveFilePath={() => ""}
        stageClipboardImage={stageClipboardImage}
      />,
    );
    const textarea = screen.getByLabelText("输入消息");
    const image = new File(["pixels"], "image.png", { type: "image/png" });

    fireEvent.paste(textarea, {
      clipboardData: { files: [image], types: ["Files", "image/png"] },
    });

    expect(stageClipboardImage).toHaveBeenCalledOnce();
    expect(screen.getByText("正在添加图片…")).toBeInTheDocument();
    expect(await screen.findByText("粘贴图片.png")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("正在添加图片…")).not.toBeInTheDocument());
  });

  it("releases a staged clipboard image when the user removes it from the draft", async () => {
    const releaseClipboardImage = vi.fn(async () => {});
    render(
      <InputArea
        {...defaultProps}
        resolveFilePath={() => ""}
        stageClipboardImage={async () => ({
          name: "待移除截图.png",
          path: "C:\\Temp\\Leemo\\owned.png",
          size: 12,
          mimeType: "image/png",
        })}
        releaseClipboardImage={releaseClipboardImage}
      />,
    );
    fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: {
        files: [new File(["pixels"], "image.png", { type: "image/png" })],
        types: ["Files", "image/png"],
      },
    });
    expect(await screen.findByText("待移除截图.png")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "移除附件" }));

    expect(releaseClipboardImage).toHaveBeenCalledWith("C:\\Temp\\Leemo\\owned.png");
    expect(screen.queryByText("待移除截图.png")).not.toBeInTheDocument();
  });

  it("releases a staged image when its reserved attachment slot was externally filled", async () => {
    let resolveStage!: (attachment: {
      name: string; path: string; size: number; mimeType: "image/png";
    }) => void;
    const stageClipboardImage = vi.fn(() => new Promise<{
      name: string; path: string; size: number; mimeType: "image/png";
    }>((resolve) => { resolveStage = resolve; }));
    const releaseClipboardImage = vi.fn(async () => {});
    const existing = Array.from({ length: 19 }, (_, index) => ({
      id: `existing-${index}`,
      name: `已有附件-${index}.txt`,
      path: `C:\\Temp\\existing-${index}.txt`,
      size: 1,
      mimeType: "text/plain",
    }));

    function Harness() {
      const [draft, setDraft] = useState<ComposerDraft>({
        text: "",
        attachments: existing,
        submitPending: false,
        retryPending: false,
        submitError: null,
        pendingStageCount: 0,
        assignedConversationId: "conv-1",
      });
      return (
        <>
          <button type="button" onClick={() => setDraft((current) => ({
            ...current,
            attachments: [...current.attachments, {
              id: "external-final-slot",
              name: "外部占位.txt",
              path: "C:\\Temp\\external-final-slot.txt",
              size: 1,
              mimeType: "text/plain",
            }],
          }))}>模拟外部占位</button>
          <InputArea
            {...defaultProps}
            resolveFilePath={() => ""}
            stageClipboardImage={stageClipboardImage}
            releaseClipboardImage={releaseClipboardImage}
            draftScope="conversation:conv-1"
            draftState={draft}
            onDraftStateChange={(update) => setDraft(update)}
          />
        </>
      );
    }

    render(<Harness />);
    fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: {
        files: [new File(["pixels"], "image.png", { type: "image/png" })],
        types: ["Files", "image/png"],
      },
    });
    expect(stageClipboardImage).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "模拟外部占位" }));
    resolveStage({
      name: "无法接纳的截图.png",
      path: "C:\\Temp\\Leemo\\orphan.png",
      size: 16,
      mimeType: "image/png",
    });

    await waitFor(() => expect(releaseClipboardImage).toHaveBeenCalledWith("C:\\Temp\\Leemo\\orphan.png"));
    expect(screen.queryByText("无法接纳的截图.png")).not.toBeInTheDocument();
    expect(screen.getByText("外部占位.txt")).toBeInTheDocument();
    expect(screen.getByText("一次最多添加 20 个附件。")).toBeInTheDocument();
  });

  it("accepts a staged clipboard image into the reserved twentieth attachment slot", async () => {
    const stageClipboardImage = vi.fn(async () => ({
      name: "第20个附件.png",
      path: "C:\\Temp\\Leemo\\twentieth.png",
      size: 16,
      mimeType: "image/png" as const,
    }));
    const releaseClipboardImage = vi.fn(async () => {});
    const existing = Array.from({ length: 19 }, (_, index) => ({
      id: `existing-${index}`,
      name: `已有附件-${index}.txt`,
      path: `C:\\Temp\\existing-${index}.txt`,
      size: 1,
      mimeType: "text/plain",
    }));

    function Harness() {
      const [draft, setDraft] = useState<ComposerDraft>({
        text: "",
        attachments: existing,
        submitPending: false,
        retryPending: false,
        submitError: null,
        pendingStageCount: 0,
        assignedConversationId: "conv-1",
      });
      return (
        <InputArea
          {...defaultProps}
          resolveFilePath={() => ""}
          stageClipboardImage={stageClipboardImage}
          releaseClipboardImage={releaseClipboardImage}
          draftScope="conversation:conv-1"
          draftState={draft}
          onDraftStateChange={(update) => setDraft(update)}
        />
      );
    }

    render(<Harness />);
    fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: {
        files: [new File(["pixels"], "image.png", { type: "image/png" })],
        types: ["Files", "image/png"],
      },
    });

    expect(await screen.findByText("第20个附件.png")).toBeInTheDocument();
    expect(releaseClipboardImage).not.toHaveBeenCalled();
    expect(screen.queryByText("一次最多添加 20 个附件。")).not.toBeInTheDocument();
  });

  it("uses a pasted local image file directly instead of restaging the clipboard bitmap", () => {
    const stageClipboardImage = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        resolveFilePath={resolveFilePath}
        stageClipboardImage={stageClipboardImage}
      />,
    );
    const image = new File(["pixels"], "本地图片.png", { type: "image/png" });

    fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: { files: [image], types: ["Files", "image/png"] },
    });

    expect(screen.getByText("本地图片.png")).toBeInTheDocument();
    expect(stageClipboardImage).not.toHaveBeenCalled();
  });

  it("keeps each conversation's attachment draft isolated across switches", async () => {
    const user = userEvent.setup();
    const file = new File(["a"], "对话A.pdf", { type: "application/pdf" });
    const { rerender } = render(
      <InputArea {...defaultProps} conversationId="conversation-a" resolveFilePath={resolveFilePath} />,
    );
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(screen.getByText("对话A.pdf")).toBeInTheDocument();

    rerender(<InputArea {...defaultProps} conversationId="conversation-b" resolveFilePath={resolveFilePath} />);
    expect(screen.queryByText("对话A.pdf")).not.toBeInTheDocument();

    rerender(<InputArea {...defaultProps} conversationId="conversation-a" resolveFilePath={resolveFilePath} />);
    expect(screen.getByText("对话A.pdf")).toBeInTheDocument();
  });

  it("returns an asynchronously staged image to the conversation where paste started", async () => {
    let resolveStage!: (attachment: {
      name: string; path: string; size: number; mimeType: "image/png";
    }) => void;
    const stageClipboardImage = vi.fn(() => new Promise<{
      name: string; path: string; size: number; mimeType: "image/png";
    }>((resolve) => { resolveStage = resolve; }));
    const props = { ...defaultProps, resolveFilePath: () => "", stageClipboardImage };
    const { rerender } = render(<InputArea {...props} conversationId="conversation-a" />);

    fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: { files: [new File(["x"], "image.png", { type: "image/png" })], types: ["Files"] },
    });
    rerender(<InputArea {...props} conversationId="conversation-b" />);
    resolveStage({ name: "A的截图.png", path: "C:\\Temp\\a.png", size: 8, mimeType: "image/png" });
    await waitFor(() => expect(stageClipboardImage).toHaveBeenCalledOnce());
    expect(screen.queryByText("A的截图.png")).not.toBeInTheDocument();

    rerender(<InputArea {...props} conversationId="conversation-a" />);
    expect(await screen.findByText("A的截图.png")).toBeInTheDocument();
  });

  it("stays pending until every concurrent clipboard image has finished staging", async () => {
    const resolvers: Array<(attachment: {
      name: string; path: string; size: number; mimeType: "image/png";
    }) => void> = [];
    const stageClipboardImage = vi.fn(() => new Promise<{
      name: string; path: string; size: number; mimeType: "image/png";
    }>((resolve) => { resolvers.push(resolve); }));
    render(
      <InputArea
        {...defaultProps}
        value="等图片"
        resolveFilePath={() => ""}
        stageClipboardImage={stageClipboardImage}
      />,
    );
    const paste = () => fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: { files: [new File(["x"], "image.png", { type: "image/png" })], types: ["Files"] },
    });
    paste();
    paste();
    expect(stageClipboardImage).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("发送")).toBeDisabled();

    resolvers[0]!({ name: "第一张.png", path: "C:\\Temp\\1.png", size: 8, mimeType: "image/png" });
    expect(await screen.findByText("第一张.png")).toBeInTheDocument();
    expect(screen.getByLabelText("发送")).toBeDisabled();
    expect(screen.getByText("正在添加图片…")).toBeInTheDocument();

    resolvers[1]!({ name: "第二张.png", path: "C:\\Temp\\2.png", size: 8, mimeType: "image/png" });
    expect(await screen.findByText("第二张.png")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("发送")).toBeEnabled());
  });

  it("keeps the entire composer, including existing attachment chips, as the turn drop zone", async () => {
    const user = userEvent.setup();
    const parentDrop = vi.fn();
    const first = new File(["a"], "第一份.pdf", { type: "application/pdf" });
    const second = new File(["b"], "第二份.pdf", { type: "application/pdf" });
    render(
      <div onDrop={parentDrop}>
        <InputArea {...defaultProps} resolveFilePath={resolveFilePath} />
      </div>,
    );
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, first);

    fireEvent.drop(screen.getByText("第一份.pdf"), {
      dataTransfer: { files: [second], types: ["Files"] },
    });

    expect(screen.getByText("第二份.pdf")).toBeInTheDocument();
    expect(parentDrop).not.toHaveBeenCalled();
  });

  it("removes attachment when × clicked", async () => {
    const user = userEvent.setup();
    const file = new File(["content"], "test.txt", { type: "text/plain" });
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /^文件/ }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    const removeButton = screen.getByLabelText("移除附件");
    await user.click(removeButton);

    expect(screen.queryByText("test.txt")).not.toBeInTheDocument();
  });

  it("sends attachments with message", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const file = new File(["content"], "doc.pdf", { type: "application/pdf" });
    render(<InputArea {...defaultProps} value="With file" onSend={onSend} resolveFilePath={resolveFilePath} />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /^文件/ }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    const sendButton = screen.getByLabelText("发送");
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith(
      "With file",
      expect.arrayContaining([
        expect.objectContaining({
          name: "doc.pdf",
          path: "C:\\Users\\Rengar\\Downloads\\doc.pdf",
          size: 7,
          mimeType: "application/pdf",
        })
      ])
    );
  });

  it("clears attachments after send", async () => {
    const user = userEvent.setup();
    const file = new File(["test"], "file.txt", { type: "text/plain" });
    render(<InputArea {...defaultProps} value="Message" resolveFilePath={resolveFilePath} />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /^文件/ }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    const sendButton = screen.getByLabelText("发送");
    await user.click(sendButton);

    expect(screen.queryByText("file.txt")).not.toBeInTheDocument();
  });

  it("clears only the submitted snapshot when the shared draft changes before acknowledgement", async () => {
    let resolveSend!: () => void;
    const sendPending = new Promise<void>((resolve) => { resolveSend = resolve; });
    const sent = {
      id: "sent", name: "本次发送.pdf", path: "C:\\Temp\\sent.pdf", size: 4,
      mimeType: "application/pdf",
    };
    const later = {
      id: "later", name: "下一条附件.pdf", path: "C:\\Temp\\later.pdf", size: 5,
      mimeType: "application/pdf",
    };

    function Harness() {
      const [draft, setDraft] = useState<ComposerDraft>({
        text: "先分析这份",
        attachments: [sent],
        submitPending: false,
        retryPending: false,
        submitError: null,
        pendingStageCount: 0,
        assignedConversationId: "conv-1",
      });
      return (
        <>
          <button type="button" onClick={() => setDraft((current) => ({
            ...current,
            text: "下一条继续处理",
            attachments: [...current.attachments, later],
          }))}>模拟稍后草稿</button>
          <InputArea
            {...defaultProps}
            value={draft.text}
            onChange={(text) => setDraft((current) => ({ ...current, text }))}
            onSend={() => sendPending}
            resolveFilePath={resolveFilePath}
            draftScope="conversation:conv-1"
            draftState={draft}
            onDraftStateChange={(update) => setDraft(update)}
          />
        </>
      );
    }

    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
    expect(screen.getByLabelText("/ 技能")).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "模拟稍后草稿" }));
    resolveSend();

    await waitFor(() => expect(screen.getByLabelText("输入消息")).toHaveValue("下一条继续处理"));
    expect(screen.queryByText("本次发送.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("下一条附件.pdf")).toBeInTheDocument();
  });

  it("turns an @ workspace-file pick into a real attachment and sends it", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const workspaceFiles: WorkspaceFileNode[] = [{
      path: "课程/复习计划.md",
      name: "复习计划.md",
      kind: "file",
      bookId: "课程",
    }];

    function Harness() {
      const [draft, setDraft] = useState<ComposerDraft>({
        text: "",
        attachments: [],
        submitPending: false,
        retryPending: false,
        submitError: null,
        pendingStageCount: 0,
        assignedConversationId: null,
      });
      return (
        <InputArea
          {...defaultProps}
          value={draft.text}
          onChange={(text) => setDraft((current) => ({ ...current, text }))}
          onSend={onSend}
          draftState={draft}
          onDraftStateChange={(update) => setDraft(update)}
          workspaceFiles={workspaceFiles}
          workspaceId="workspace-course"
        />
      );
    }

    render(<Harness />);
    await user.type(screen.getByLabelText("输入消息"), "总结 @复习");
    expect(screen.getByRole("listbox", { name: "引用工作区文件" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /复习计划\.md/ }));

    expect(await screen.findByText("复习计划.md")).toBeInTheDocument();
    expect(screen.getByLabelText("输入消息")).toHaveValue("总结 ");

    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledWith("总结", undefined, [{
      name: "复习计划.md",
      workspaceId: "workspace-course",
      workspacePath: "课程/复习计划.md",
    }]);
  });

  it("counts workspace references toward the same 20-file limit as local attachments", () => {
    const workspaceRefs = Array.from({ length: 20 }, (_, index) => ({
      id: `workspace-${index}`,
      name: `资料-${index}.md`,
      workspaceId: "workspace-course",
      workspacePath: `课程/资料-${index}.md`,
    }));

    function Harness() {
      const [draft, setDraft] = useState<ComposerDraft>({
        text: "",
        attachments: [],
        workspaceFiles: workspaceRefs,
        submitPending: false,
        retryPending: false,
        submitError: null,
        pendingStageCount: 0,
        assignedConversationId: null,
      });
      return (
        <InputArea
          {...defaultProps}
          resolveFilePath={resolveFilePath}
          draftState={draft}
          onDraftStateChange={(update) => setDraft(update)}
        />
      );
    }

    const { container } = render(<Harness />);
    const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(picker, {
      target: { files: [new File(["new"], "不应加入.pdf", { type: "application/pdf" })] },
    });

    expect(screen.queryByText("不应加入.pdf")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("一次最多添加 20 个附件。");
  });

  it("the / button seeds a slash query instead of the old placeholder box", async () => {
    // 轮 2 卡 E replaced the "（占位）" grey box with the real SlashMenu, which is
    // driven by the draft text — so the button's job is now to type the slash.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        onChange={onChange}
        skills={[{
          name: "pdf",
          description: "阅读 PDF",
          qualifiedName: "leemo:pdf",
          dir: "/skills/pdf",
          source: "user",
        }]}
      />,
    );

    await user.click(screen.getByLabelText("/ 技能"));

    expect(onChange).toHaveBeenCalledWith("/");
    expect(screen.queryByText("/ 技能选择（占位）")).not.toBeInTheDocument();
  });

  it("keeps every compact composer icon on one shared 32px control baseline", () => {
    render(<InputArea {...defaultProps} />);

    const controls = screen.getAllByTestId("composer-icon-control");
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      expect(control).toHaveClass("h-8", "w-8", "place-items-center");
    }
  });

  it("explains why the / menu is empty instead of looking like a dead button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        value="@"
        onChange={onChange}
        skills={[]}
        workspaceId="book-1"
        workspaceFiles={[{ name: "笔记.md", path: "/笔记.md", kind: "file", bookId: "book-1" }]}
      />,
    );

    expect(screen.getByRole("listbox", { name: "引用工作区文件" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("/ 技能"));

    expect(screen.getByRole("status")).toHaveTextContent("还没有启用技能");
    expect(screen.getByRole("status")).toHaveTextContent("技能中心");
    expect(screen.queryByRole("listbox", { name: "引用工作区文件" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith("/");
  });

  it("toggles model picker panel", async () => {
    const user = userEvent.setup();
    render(<InputArea {...defaultProps} />);

    // 轮 3 卡 F: the panel is real now. With no `providers` prop there is nothing
    // configured, so it opens on its guidance state rather than a placeholder.
    const statusBar = screen.getByRole("button", { name: "切换模型" });
    await user.click(statusBar);

    expect(screen.getByText(/还没有可用的模型/)).toBeInTheDocument();
    const composer = screen.getByTestId("composer-surface");
    const menu = screen.getByTestId("model-picker-menu");
    expect(composer).toContainElement(menu);
    expect(menu).toHaveClass("absolute", "bottom-[calc(100%+8px)]");

    await user.click(statusBar);
    expect(screen.queryByText(/还没有可用的模型/)).not.toBeInTheDocument();
  });

  it("keeps legacy plan state out of the approval selector", () => {
    render(<InputArea {...defaultProps} permissionMode="plan" />);

    expect(screen.getByRole("button", { name: "权限模式：风险确认" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "权限模式：只规划" })).not.toBeInTheDocument();
  });

  it("switches permission modes from a concise inline menu without opening settings", async () => {
    const user = userEvent.setup();
    const onSelectPermissionMode = vi.fn();
    const onOpenPermissionSettings = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        permissionMode="acceptEdits"
        onSelectPermissionMode={onSelectPermissionMode}
        onOpenPermissionSettings={onOpenPermissionSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: "权限模式：风险确认" }));

    const menu = screen.getByRole("menu", { name: "权限模式" });
    expect(screen.getByTestId("composer-surface")).toContainElement(menu);
    expect(menu).toHaveClass("absolute", "bottom-[calc(100%+8px)]");
    expect(within(menu).getByText("常规改动直接做，风险操作再询问")).toBeInTheDocument();
    expect(within(menu).queryByText("只分析与给方案，不执行改动")).not.toBeInTheDocument();

    await user.click(within(menu).getByRole("menuitemradio", { name: /每次确认/ }));

    expect(onSelectPermissionMode).toHaveBeenCalledWith("default");
    expect(onOpenPermissionSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "权限模式" })).not.toBeInTheDocument();
    expect(screen.queryByText(/还没有可用的模型/)).not.toBeInTheDocument();
  });

  it("keeps composer popovers mutually exclusive instead of stacking them", async () => {
    const user = userEvent.setup();
    render(<InputArea {...defaultProps} permissionMode="acceptEdits" />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByRole("menu", { name: "添加到对话" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "权限模式：风险确认" }));
    expect(screen.queryByRole("menu", { name: "添加到对话" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "权限模式" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.queryByRole("menu", { name: "权限模式" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "添加到对话" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换模型" }));
    expect(screen.queryByRole("menu", { name: "添加到对话" })).not.toBeInTheDocument();
    expect(screen.getByTestId("model-picker-menu")).toBeInTheDocument();
  });

  it("closes button-opened composer popovers with Escape", async () => {
    const user = userEvent.setup();
    render(<InputArea {...defaultProps} permissionMode="acceptEdits" />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "添加到对话" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换模型" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("model-picker-menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "权限模式：风险确认" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "权限模式" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "@ 引用" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "引用文件或便签" })).not.toBeInTheDocument();
  });

  it("enters plan mode from the plus menu and carries it with the turn", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<InputArea {...defaultProps} value="先分析方案" onSend={onSend} permissionMode="acceptEdits" />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /计划模式/ }));

    expect(screen.getByRole("button", { name: "添加，计划模式已开启" })).toBeInTheDocument();
    expect(screen.getByTestId("composer-plan-mode-indicator")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]?.[3]).toMatchObject({ permissionMode: "plan" });
  });

  it("creates a persistent goal from the plus menu and keeps its compact card closest to the composer", async () => {
    const user = userEvent.setup();
    const queuedTurns = [{
      id: "queued-before-goal",
      text: "先补充竞品截图",
      attachments: [],
      workspaceFiles: [],
    }];

    function Harness() {
      const [goal, setGoal] = useState<{
        text: string;
        status: "active" | "paused";
        createdAt: number;
        updatedAt: number;
      }>();
      return (
        <InputArea
          {...defaultProps}
          queuedTurns={queuedTurns}
          goal={goal}
          onSaveGoal={(text) => setGoal((current) => ({
            text,
            status: current?.status ?? "active",
            createdAt: current?.createdAt ?? Date.now() - 95_000,
            updatedAt: Date.now(),
          }))}
          onToggleGoalPaused={() => setGoal((current) => current
            ? { ...current, status: current.status === "active" ? "paused" : "active" }
            : current)}
          onDeleteGoal={() => setGoal(undefined)}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /目标模式/ }));
    await user.type(screen.getByRole("textbox", { name: "目标内容" }), "完成主界面视觉复现");
    await user.click(screen.getByRole("button", { name: "保存目标" }));

    const queue = screen.getByTestId("queued-turn-list");
    const goalCard = screen.getByTestId("conversation-goal-card");
    const composer = screen.getByTestId("composer-surface");
    expect(goalCard).toHaveTextContent("进行中的目标");
    expect(goalCard).toHaveTextContent("完成主界面视觉复现");
    expect(queue.compareDocumentPosition(goalCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(goalCard.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "暂停目标" }));
    expect(goalCard).toHaveTextContent("已暂停的目标");
    expect(screen.getByRole("button", { name: "继续目标" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑目标" }));
    expect(screen.getByRole("textbox", { name: "目标内容" })).toHaveValue("完成主界面视觉复现");
    await user.click(screen.getByRole("button", { name: "取消编辑目标" }));
    await user.click(screen.getByRole("button", { name: "删除目标" }));
    expect(screen.queryByTestId("conversation-goal-card")).not.toBeInTheDocument();
  });

  it("keeps full access inside the same permission menu", async () => {
    const user = userEvent.setup();
    const onSelectPermissionMode = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        permissionMode="bypassPermissions"
        onSelectPermissionMode={onSelectPermissionMode}
      />,
    );

    await user.click(screen.getByRole("button", { name: "权限模式：完全访问" }));

    const menu = screen.getByRole("menu", { name: "权限模式" });
    expect(within(menu).getByRole("menuitemradio", { name: /完全访问/ })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByText("不再请求权限；仅在信任当前任务时使用")).toBeInTheDocument();
    expect(screen.queryByText("绕过权限")).not.toBeInTheDocument();
  });

  it("disables the real file action when no desktop path resolver exists", async () => {
    render(<InputArea {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(screen.getByRole("menuitem", { name: /^文件/ })).toBeDisabled();
  });

  it("displays hint text for keyboard shortcuts", () => {
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);
    expect(screen.getByText("Enter 发送 · Shift+Enter 换行")).toBeInTheDocument();
  });

  it("formats file sizes correctly", async () => {
    const user = userEvent.setup();
    const file = new File([new ArrayBuffer(1024 * 1.5)], "test.txt");
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);

    await user.click(screen.getByRole("button", { name: "添加" }));
    await user.click(screen.getByRole("menuitem", { name: /^文件/ }));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, file);

    expect(screen.getByText(/1\.5KB/)).toBeInTheDocument();
  });

  it("keeps the draft and attachment visible when sending is rejected", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn(async () => { throw new Error("附件已经被移动，请重新选择"); });
    const onChange = vi.fn();
    const file = new File(["cv"], "简历.pdf", { type: "application/pdf" });
    render(
      <InputArea
        {...defaultProps}
        value="帮我检查"
        onSend={onSend}
        onChange={onChange}
        resolveFilePath={resolveFilePath}
      />,
    );

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await user.click(screen.getByLabelText("发送"));

    expect(await screen.findByText("附件已经被移动，请重新选择")).toBeInTheDocument();
    expect(screen.getByText("简历.pdf")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("shows a post-ack retry notice with the preserved message and attachments", () => {
    render(
      <InputArea
        {...defaultProps}
        retryDraft={{
          runId: "run-1",
          text: "帮我看简历",
          attachments: [{
            name: "秋招简历.pdf",
            path: "C:\\Users\\Rengar\\Downloads\\秋招简历.pdf",
            size: 2048,
            mimeType: "application/pdf",
          }],
          providerId: "deepseek",
          modelId: "deepseek-v4",
          errorMessage: "服务暂时不可用",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("服务暂时不可用");
    expect(screen.getByRole("alert")).toHaveTextContent("原消息和附件已保留");
    expect(screen.getByRole("alert")).toHaveTextContent("秋招简历.pdf");
    expect(screen.getByRole("button", { name: "仍用当前模型重试" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择其他模型" })).toBeInTheDocument();
  });

  it("does not duplicate a retry notice already rendered by the terminal recovery card", () => {
    render(
      <InputArea
        {...defaultProps}
        retryRecoveryRendered
        retryDraft={{
          runId: "run-terminal",
          text: "帮我看简历",
          attachments: [],
          providerId: "deepseek",
          modelId: "deepseek-v4",
          errorMessage: "服务暂时不可用",
        }}
      />,
    );

    expect(screen.queryByText("原消息和附件已保留")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "仍用当前模型重试" })).not.toBeInTheDocument();
  });

  it("keeps a many-attachment retry notice compact instead of expanding the composer", () => {
    const attachment = (name: string) => ({ name, path: `C:\\${name}`, size: 1 });
    render(
      <InputArea
        {...defaultProps}
        retryDraft={{
          runId: "run-1",
          text: "批量分析",
          attachments: [
            attachment("第一份超长附件名称.pdf"),
            attachment("第二份超长附件名称.pdf"),
            attachment("第三份不应展开.pdf"),
            attachment("第四份不应展开.pdf"),
          ],
          providerId: "p",
          modelId: "m",
          errorMessage: "失败",
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("第一份超长附件名称.pdf、第二份超长附件名称.pdf，另有 2 个");
    expect(alert).not.toHaveTextContent("第三份不应展开.pdf");
  });

  it("retries through the store action instead of rebuilding a text-only send", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onSend = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        onSend={onSend}
        onRetry={onRetry}
        retryDraft={{
          runId: "run-1",
          text: "带附件的原消息",
          attachments: [{ name: "图.png", path: "C:\\图.png", size: 3, mimeType: "image/png" }],
          providerId: "p",
          modelId: "m",
          errorMessage: "失败",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "仍用当前模型重试" }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("dismisses only the retry notice when the user closes it", async () => {
    const user = userEvent.setup();
    const onDismissRetry = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        onDismissRetry={onDismissRetry}
        retryDraft={{
          runId: "run-1",
          text: "问题",
          attachments: [],
          providerId: "p",
          modelId: "m",
          errorMessage: "失败",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "关闭重试提示" }));
    expect(onDismissRetry).toHaveBeenCalledOnce();
  });
});

describe("InputArea — / skill menu (轮 2 卡 E)", () => {
  const skill = (name: string, description = `${name} 说明`): SkillInfo => ({
    name,
    description,
    qualifiedName: `leemo:${name}`,
    dir: `/skills/${name}`,
    source: "user",
  });
  const SKILLS = [skill("pdf"), skill("期末速通")];
  const base = {
    conversationId: "conv-1",
    onChange: vi.fn(),
    onSend: vi.fn(),
    busy: false,
    onStop: vi.fn(),
    skills: SKILLS,
  };

  it("opens on a leading slash and lists the enabled skills", () => {
    render(<InputArea {...base} value="/" />);
    expect(screen.getByTestId("slash-menu")).toBeInTheDocument();
    expect(screen.getByText("/pdf")).toBeInTheDocument();
  });

  it("stays closed for ordinary text", () => {
    render(<InputArea {...base} value="帮我看看这个" />);
    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
  });

  it("stays closed when no skills are installed (zero-skill machine)", () => {
    render(<InputArea {...base} value="/" skills={[]} />);
    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
  });

  it("filters as the user types", () => {
    render(<InputArea {...base} value="/期末" />);
    expect(screen.getByText("/期末速通")).toBeInTheDocument();
    expect(screen.queryByText("/pdf")).not.toBeInTheDocument();
  });

  it("closes once the command word is finished", () => {
    render(<InputArea {...base} value="/pdf 帮我填表" />);
    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
  });

  it("puts '/<bare name> ' in the box on click — no prefix ever (铁律)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InputArea {...base} value="/" onChange={onChange} />);
    await user.click(screen.getByText("/期末速通"));
    expect(onChange).toHaveBeenCalledWith("/期末速通 ");
    expect(onChange.mock.calls.flat().join()).not.toContain("leemo:");
  });

  it("↓ then Enter picks the second skill instead of sending", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSend = vi.fn();
    render(<InputArea {...base} value="/" onChange={onChange} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{ArrowDown}{Enter}");
    // Enter belongs to the open menu here — sending "/" would be meaningless.
    expect(onChange).toHaveBeenCalledWith("/期末速通 ");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter with the menu open never sends the raw slash text", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputArea {...base} value="/pd" onSend={onSend} />);
    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Escape closes the menu and hands Enter back to sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputArea {...base} value="/pdf" onSend={onSend} />);
    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("/pdf", undefined);
  });

  it("reopens after Escape once the query changes", () => {
    // Escape dismisses THIS query, not the feature.
    const { rerender } = render(<InputArea {...base} value="/pdf" />);
    rerender(<InputArea {...base} value="/pd" />);
    expect(screen.getByTestId("slash-menu")).toBeInTheDocument();
  });

  it("shows nothing when the query matches no skill", () => {
    render(<InputArea {...base} value="/zzzz" />);
    expect(screen.queryByTestId("slash-menu")).not.toBeInTheDocument();
  });

  it("the / toolbar button opens the same real menu (no placeholder text)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InputArea {...base} value="" onChange={onChange} />);
    await user.click(screen.getByLabelText("/ 技能"));
    // Old behaviour was a "（占位）" grey box; now it seeds a real slash query.
    expect(onChange).toHaveBeenCalledWith("/");
  });
});
