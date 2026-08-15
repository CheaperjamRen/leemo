import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CaptureEditor from "./CaptureEditor";

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
});
