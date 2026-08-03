import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import InputArea from "./InputArea";
import type { SkillInfo } from "../../bridge/contract";
import type { ComposerDraft } from "../stores/composer-drafts";
import type { WorkspaceFileNode } from "../workspace/client";

describe("InputArea", () => {
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
    expect(screen.getByRole("button", { name: "发送" })).toHaveClass("ml-auto");

    rerender(<InputArea {...defaultProps} busy />);
    expect(screen.getByRole("button", { name: "停止" })).toHaveClass("ml-auto");
  });

  it("renders textarea with placeholder", () => {
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);
    const textarea = screen.getByPlaceholderText("输入消息…");
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
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

  it("does not send on Enter when busy", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<InputArea {...defaultProps} value="Test" busy={true} onSend={onSend} />);

    const textarea = screen.getByPlaceholderText("输入消息…");
    await user.click(textarea);
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
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
    await user.click(sendButton);

    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends message on send button click", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<InputArea {...defaultProps} value="Button test" onSend={onSend} onChange={onChange} />);

    const sendButton = screen.getByLabelText("发送");
    await user.click(sendButton);

    expect(onSend).toHaveBeenCalledWith("Button test", undefined);
    expect(onChange).toHaveBeenCalledWith("");
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

    const attachButton = screen.getByLabelText("附件");
    await user.click(attachButton);

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

    const attachButton = screen.getByLabelText("附件");
    await user.click(attachButton);

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

    const attachButton = screen.getByLabelText("附件");
    await user.click(attachButton);

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

    const attachButton = screen.getByLabelText("附件");
    await user.click(attachButton);

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
    expect(screen.getByLabelText("附件")).toBeDisabled();
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
    render(<InputArea {...defaultProps} onChange={onChange} />);

    await user.click(screen.getByLabelText("/ 技能"));

    expect(onChange).toHaveBeenCalledWith("/");
    expect(screen.queryByText("/ 技能选择（占位）")).not.toBeInTheDocument();
  });

  it("toggles model picker panel", async () => {
    const user = userEvent.setup();
    render(<InputArea {...defaultProps} />);

    // 轮 3 卡 F: the panel is real now. With no `providers` prop there is nothing
    // configured, so it opens on its guidance state rather than a placeholder.
    const statusBar = screen.getByRole("button", { name: "切换模型" });
    await user.click(statusBar);

    expect(screen.getByText(/还没有可用的模型/)).toBeInTheDocument();

    await user.click(statusBar);
    expect(screen.queryByText(/还没有可用的模型/)).not.toBeInTheDocument();
  });

  it("shows the active permission mode instead of a hardcoded standard label", () => {
    render(<InputArea {...defaultProps} permissionMode="plan" />);

    expect(screen.getByRole("button", { name: "权限模式：只规划" })).toBeInTheDocument();
    expect(screen.queryByText("标准权限")).not.toBeInTheDocument();
  });

  it("opens permission settings without toggling the model picker", async () => {
    const user = userEvent.setup();
    const onOpenPermissionSettings = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        permissionMode="acceptEdits"
        onOpenPermissionSettings={onOpenPermissionSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: "权限模式：任务中少打扰" }));

    expect(onOpenPermissionSettings).toHaveBeenCalledOnce();
    expect(screen.queryByText(/还没有可用的模型/)).not.toBeInTheDocument();
  });

  it("shows full access in plain language and disables it directly", async () => {
    const user = userEvent.setup();
    const onDisableFullAccess = vi.fn();
    const onOpenPermissionSettings = vi.fn();
    render(
      <InputArea
        {...defaultProps}
        permissionMode="bypassPermissions"
        onDisableFullAccess={onDisableFullAccess}
        onOpenPermissionSettings={onOpenPermissionSettings}
      />,
    );

    await user.click(screen.getByRole("button", { name: "关闭完全访问" }));

    expect(onDisableFullAccess).toHaveBeenCalledOnce();
    expect(onOpenPermissionSettings).not.toHaveBeenCalled();
    expect(screen.queryByText("绕过权限")).not.toBeInTheDocument();
  });

  it("disables attachments when no desktop path resolver exists", () => {
    render(<InputArea {...defaultProps} />);
    expect(screen.getByLabelText("附件")).toBeDisabled();
  });

  it("displays hint text for keyboard shortcuts", () => {
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);
    expect(screen.getByText("Enter 发送 · Shift+Enter 换行")).toBeInTheDocument();
  });

  it("formats file sizes correctly", async () => {
    const user = userEvent.setup();
    const file = new File([new ArrayBuffer(1024 * 1.5)], "test.txt");
    render(<InputArea {...defaultProps} resolveFilePath={resolveFilePath} />);

    const attachButton = screen.getByLabelText("附件");
    await user.click(attachButton);

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
