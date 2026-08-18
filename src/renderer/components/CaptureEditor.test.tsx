import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaptureEditor from "./CaptureEditor";

if (!("getBoundingClientRect" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

afterEach(() => vi.unstubAllGlobals());

function selectEditorContents(editor: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(editor);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}

describe("CaptureEditor", () => {
  it("keeps the compact formatting toolbar above the writing canvas", () => {
    const { container } = render(
      <CaptureEditor markdown="" onMarkdownChange={vi.fn()} onSave={vi.fn()} />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "便签格式" });
    const canvas = container.querySelector(".capture-editor__canvas");
    expect(canvas).not.toBeNull();
    expect(toolbar.compareDocumentPosition(canvas!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(toolbar.querySelectorAll("button")).toHaveLength(7);
  });

  it("restores persisted Markdown as an editable rich-text document", () => {
    render(
      <CaptureEditor
        markdown={"**求职重点**\n\n1. 更新简历\n2. 投递岗位\n\n- [ ] 跟进回复\n\n> 只记录，不打断思路"}
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    expect(editor).toHaveTextContent("求职重点");
    expect(editor.querySelector("strong")).toHaveTextContent("求职重点");
    expect(editor.querySelector("ol")).toHaveTextContent("更新简历投递岗位");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(editor.querySelector("blockquote")).toHaveTextContent("只记录，不打断思路");
  });

  it("renders standard Markdown objects without exposing their source punctuation", () => {
    render(
      <CaptureEditor
        variant="document"
        markdown={"# 求职主线\n\n先看[产品故事](leemo-note://story)，再整理 `证据`。"}
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    expect(within(editor).getByRole("heading", { name: "求职主线" })).toBeInTheDocument();
    expect(within(editor).getByRole("link", { name: "产品故事" })).toBeInTheDocument();
    expect(editor).not.toHaveTextContent("# 求职主线");
    expect(editor).not.toHaveTextContent("leemo-note://story");
    expect(editor.querySelector("code")).toHaveTextContent("证据");
  });

  it("renders cloud-document Markdown blocks instead of leaking unsupported source", () => {
    render(
      <CaptureEditor
        variant="document"
        markdown={[
          "> [!IMPORTANT]",
          "> 先保留自己的判断。",
          "",
          "==需要复核==，公式 $\\sqrt{d_k}$。",
          "",
          "```ts",
          "const ready = true;",
          "```",
          "",
          "| 项目 | 状态 |",
          "| --- | --- |",
          "| 主线 | 进行中 |",
          "",
          "```mermaid",
          "flowchart LR",
          "  A --> B",
          "```",
        ].join("\n")}
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    expect(within(editor).getByRole("combobox", { name: "高亮块类型" })).toHaveValue("important");
    expect(within(editor).getByRole("textbox", { name: "高亮块内容" })).toHaveValue("先保留自己的判断。");
    expect(editor).not.toHaveTextContent("[!IMPORTANT]");
    expect(editor.querySelector(".capture-editor__highlight")).toHaveTextContent("需要复核");
    expect(editor.querySelector(".katex")).toBeInTheDocument();
    expect(editor.querySelector(".capture-editor__code")).toHaveTextContent("const ready = true;");
    expect(within(editor).getByRole("textbox", { name: "表头 1" })).toHaveValue("项目");
    expect(within(editor).getByRole("textbox", { name: "表头 2" })).toHaveValue("状态");
    expect(within(editor).getByRole("textbox", { name: "第 1 行第 1 列" })).toHaveValue("主线");
    expect(within(editor).getByRole("textbox", { name: "第 1 行第 2 列" })).toHaveValue("进行中");
    expect(editor.querySelector(".markdown-editor__mermaid")).toBeInTheDocument();
  });

  it("creates and edits a table as a visual document object", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        variant="document"
        markdown=""
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "插入表格" }));
    const firstHeader = await screen.findByRole("textbox", { name: "表头 1" });
    await user.clear(firstHeader);
    await user.type(firstHeader, "任务");
    await user.click(screen.getByRole("button", { name: "添加表格行" }));
    await user.click(screen.getByRole("button", { name: "切换表格对齐" }));

    await waitFor(() => {
      const markdown = String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "");
      expect(markdown).toContain("| 任务 | 列 2 |");
      expect(markdown).toContain("| :---: | :---: |");
      expect(markdown.split("\n")).toHaveLength(5);
    });
  });

  it("offers a source mode whose Ctrl+B shortcut toggles Markdown markers", async () => {
    const onMarkdownChange = vi.fn();
    const { rerender } = render(
      <CaptureEditor
        variant="document"
        mode="source"
        markdown="重点"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    const source = screen.getByRole("textbox", { name: "Markdown 源码" }) as HTMLTextAreaElement;
    source.focus();
    source.setSelectionRange(0, 2);
    fireEvent.keyDown(source, { key: "b", ctrlKey: true });
    expect(onMarkdownChange).toHaveBeenLastCalledWith("**重点**");

    rerender(
      <CaptureEditor
        variant="document"
        mode="source"
        markdown="**重点**"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );
    const wrapped = screen.getByRole("textbox", { name: "Markdown 源码" }) as HTMLTextAreaElement;
    wrapped.focus();
    wrapped.setSelectionRange(2, 4);
    fireEvent.keyDown(wrapped, { key: "b", ctrlKey: true });
    expect(onMarkdownChange).toHaveBeenLastCalledWith("重点");
  });

  it("writes bold rich text back as Markdown", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        markdown="重要想法"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    selectEditorContents(editor);

    await user.click(screen.getByRole("button", { name: "加粗" }));

    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith("**重要想法**"));
  });

  it("uses the familiar Ctrl+B shortcut in rendered editing", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        variant="document"
        markdown="重要想法"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    await user.click(editor);
    await user.keyboard("{Control>}a{/Control}{Control>}b{/Control}");

    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith("**重要想法**"));
  });

  it("writes an ordered list back as Markdown", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        markdown="第一项"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    selectEditorContents(screen.getByRole("textbox", { name: "便签正文" }));
    await user.click(screen.getByRole("button", { name: "序号列表" }));

    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith("1. 第一项"));
  });

  it.each([
    ["圆点列表", "- 第一项"],
    ["清单", "- [ ] 第一项"],
    ["引用注释", "> 第一项"],
  ])("writes %s blocks back as Markdown", async (toolName, expectedMarkdown) => {
    const user = userEvent.setup();
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        markdown="第一项"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    selectEditorContents(screen.getByRole("textbox", { name: "便签正文" }));
    await user.click(screen.getByRole("button", { name: toolName }));

    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith(expectedMarkdown));
  });

  it("undoes and redoes rich-text changes", async () => {
    const user = userEvent.setup();
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        markdown="重要想法"
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    selectEditorContents(editor);
    await user.click(screen.getByRole("button", { name: "加粗" }));
    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith("**重要想法**"));

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith("重要想法"));

    await user.click(screen.getByRole("button", { name: "重做" }));
    await waitFor(() => expect(onMarkdownChange).toHaveBeenLastCalledWith("**重要想法**"));
  });

  it("intercepts Ctrl+S and asks the caller to save", () => {
    const onSave = vi.fn();
    render(
      <CaptureEditor
        markdown="重要想法"
        onMarkdownChange={vi.fn()}
        onSave={onSave}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    expect(fireEvent.keyDown(editor, { key: "s", ctrlKey: true })).toBe(false);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("becomes read-only while a save is in flight", async () => {
    const props = {
      markdown: "重要想法",
      onMarkdownChange: vi.fn(),
      onSave: vi.fn(),
    };
    const { rerender } = render(<CaptureEditor {...props} />);
    expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveAttribute(
      "contenteditable",
      "true",
    );

    rerender(<CaptureEditor {...props} disabled />);

    await waitFor(() => expect(
      screen.getByRole("textbox", { name: "便签正文" }),
    ).toHaveAttribute("contenteditable", "false"));
    expect(screen.getByRole("button", { name: "加粗" })).toBeDisabled();
  });

  it("offers one note-reference affordance for click, @ typing and note drops", async () => {
    vi.stubGlobal("DragEvent", Event);
    const onOpenNoteReferenceMenu = vi.fn();
    const onDropNoteReference = vi.fn();
    render(
      <CaptureEditor
        markdown="正文"
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
        onOpenNoteReferenceMenu={onOpenNoteReferenceMenu}
        onDropNoteReference={onDropNoteReference}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "引用便签" }));
    expect(onOpenNoteReferenceMenu).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "便签正文" }), { key: "@" });
    expect(onOpenNoteReferenceMenu).toHaveBeenCalledTimes(2);

    const data = JSON.stringify({ noteId: "note-target" });
    fireEvent.drop(screen.getByRole("textbox", { name: "便签正文" }), {
      dataTransfer: {
        files: [],
        types: ["application/x-leemo-note"],
        getData: (type: string) => type === "application/x-leemo-note" ? data : "",
      },
    });
    expect(onDropNoteReference).toHaveBeenCalledWith("note-target");
  });
});
