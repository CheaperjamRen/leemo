import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownContent from "./MarkdownContent";

const COMPLETE_MARKDOWN = [
  "# 学习计划",
  "",
  "> 先看结论，再做练习。",
  "",
  "- [x] 整理概念",
  "- [ ] 完成练习",
  "  - 记录错题",
  "",
  "| 模块 | 状态 |",
  "| --- | --- |",
  "| 概念 | 完成 |",
  "",
  "行内 `npm test` 与 [参考资料](https://example.com/a/very/long/path)。",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "very-long-token-".repeat(20),
].join("\n");

describe("MarkdownContent", () => {
  it("renders the shared GFM surface instead of exposing markdown syntax", () => {
    const { container } = render(<MarkdownContent text={COMPLETE_MARKDOWN} variant="answer" />);

    expect(screen.getByRole("heading", { name: "学习计划" })).toBeInTheDocument();
    expect(screen.getByRole("blockquote")).toHaveTextContent("先看结论");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("const answer = 42;").closest("pre")).toBeInTheDocument();
    expect(container.textContent).not.toContain("| --- | --- |");
  });

  it("opens external links safely and keeps long content inside its parent", () => {
    const { container } = render(<MarkdownContent text={COMPLETE_MARKDOWN} variant="preview" />);
    const link = screen.getByRole("link", { name: /参考资料/ });

    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.firstElementChild).toHaveClass("min-w-0");
    expect(container.firstElementChild?.className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByRole("table").parentElement).toHaveClass("overflow-x-auto");
  });

  it.each(["answer", "process", "preview"] as const)(
    "exposes a stable %s density hook",
    (variant) => {
      render(<MarkdownContent text="正文" variant={variant} />);
      expect(screen.getByTestId("markdown-content")).toHaveAttribute("data-variant", variant);
    },
  );
});
