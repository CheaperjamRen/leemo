import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MarkdownEditor, { applyMarkdownFormat } from "./MarkdownEditor";

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

    expect(screen.getByRole("textbox", { name: "编辑 notes.md" })).toBeDisabled();
    expect(screen.getByText("正在切换…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
