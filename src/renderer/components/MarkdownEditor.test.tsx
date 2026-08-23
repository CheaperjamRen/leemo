import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MarkdownEditor, { applyMarkdownFormat } from "./MarkdownEditor";

function selectEditorContents(editor: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(editor);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}

describe("applyMarkdownFormat", () => {
  it("wraps inline selections without losing the selection", () => {
    expect(applyMarkdownFormat("重点内容", 0, 2, "bold")).toEqual({
      text: "**重点**内容",
      selectionStart: 2,
      selectionEnd: 4,
    });
  });

  it("prefixes every selected line for block formats", () => {
    expect(applyMarkdownFormat("第一行\n第二行", 0, 7, "quote").text).toBe("> 第一行\n> 第二行");
    expect(applyMarkdownFormat("标题", 0, 0, "heading").text).toBe("## 标题");
  });

  it("uses a fenced block for multiline code", () => {
    expect(applyMarkdownFormat("a\nb", 0, 3, "code").text).toBe("```\na\nb\n```");
  });

  it("locks editing while the workspace root is changing", () => {
    render(
      <MarkdownEditor
        title="notes.md"
        draft={{ originalText: "old", text: "draft", status: "dirty" }}
        disabled
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "编辑 notes.md" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("正在切换…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("edits the document as rich content instead of exposing markdown source", () => {
    render(
      <MarkdownEditor
        title="attention.md"
        draft={{
          originalText: "",
          text: "# 缩放点积注意力机制\n\n公式 $\\sqrt{d_k}$ 很重要。\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\n| 项目 | 状态 |\n| --- | --- |\n| 公式 | 完成 |\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n- [x] 保持方差稳定\n\n> 数学解释",
          status: "dirty",
        }}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "编辑 attention.md" });
    expect(editor.tagName).toBe("DIV");
    expect(screen.getByRole("heading", { name: "缩放点积注意力机制" })).toBeInTheDocument();
    expect(document.querySelector(".katex")).toBeInTheDocument();
    expect(editor.querySelector(".markdown-editor__math-block")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "表头 1" })).toHaveValue("项目");
    expect(screen.getByRole("textbox", { name: "表头 2" })).toHaveValue("状态");
    expect(screen.getByRole("textbox", { name: "第 1 行第 1 列" })).toHaveValue("公式");
    expect(screen.getByRole("textbox", { name: "第 1 行第 2 列" })).toHaveValue("完成");
    expect(editor.querySelector(".markdown-editor__mermaid")).toBeInTheDocument();
    expect(editor.querySelector(".markdown-editor__list-item--checked")).toHaveTextContent("保持方差稳定");
    expect(screen.getByRole("toolbar", { name: "文档格式" })).toBeInTheDocument();
  });

  it("serializes rich edits back to markdown and keeps Ctrl+S", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <MarkdownEditor
        title="notes.md"
        draft={{ originalText: "原文", text: "原文", status: "dirty" }}
        onChange={onChange}
        onSave={onSave}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "编辑 notes.md" });
    selectEditorContents(editor);
    await user.click(screen.getByRole("button", { name: "加粗" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("**原文**"));
    fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("uses standard GFM for strikethrough and explicit Feishu-compatible HTML for underline", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(
      <MarkdownEditor
        title="formats.md"
        draft={{ originalText: "原文", text: "原文", status: "dirty" }}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    let editor = screen.getByRole("textbox", { name: "编辑 formats.md" });
    selectEditorContents(editor);
    await user.click(screen.getByRole("button", { name: "删除线" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("~~原文~~"));

    unmount();
    onChange.mockClear();
    render(
      <MarkdownEditor
        title="underline.md"
        draft={{ originalText: "原文", text: "原文", status: "dirty" }}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    editor = screen.getByRole("textbox", { name: "编辑 underline.md" });
    selectEditorContents(editor);
    await user.click(screen.getByRole("button", { name: "下划线（飞书兼容）" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("<u>原文</u>"));
  });

  it("restores Feishu-compatible underline, uses semantic callout icons, and disables noisy spellcheck", () => {
    render(
      <MarkdownEditor
        title="portable.md"
        draft={{
          originalText: "",
          text: "<u>Leemo</u>\n\n> [!TIP]\n> 保留判断",
          status: "dirty",
        }}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "编辑 portable.md" });
    expect(editor).toHaveAttribute("spellcheck", "false");
    expect(editor.querySelector(".markdown-editor__underline")).toHaveTextContent("Leemo");
    expect(screen.getByRole("combobox", { name: "高亮块类型" })).toHaveDisplayValue("提示");
    expect(screen.getByRole("button", { name: "删除高亮块" })).toBeInTheDocument();
  });

  it("shows a truthful compact document status below the editor", () => {
    render(
      <MarkdownEditor
        title="notes.md"
        draft={{ originalText: "", text: "第一行\n第二", status: "dirty" }}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId("markdown-editor-status")).toHaveTextContent("5 字");
    expect(screen.getByTestId("markdown-editor-status")).toHaveTextContent("2 行");
  });
});
