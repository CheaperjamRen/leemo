import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import MarkdownContent from "./MarkdownContent";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

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
    expect(container.querySelector("pre.prism-code")).toHaveTextContent("const answer = 42;");
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

  it("hands relative file links to the desktop host instead of opening a web route", () => {
    const onOpenLocalLink = vi.fn();
    render(
      <MarkdownContent
        text="[面经题库](../面经/题库与参考答案/)"
        variant="preview"
        onOpenLocalLink={onOpenLocalLink}
      />,
    );

    const link = screen.getByRole("link", { name: "面经题库" });
    expect(link).not.toHaveAttribute("target", "_blank");
    fireEvent.click(link);
    expect(onOpenLocalLink).toHaveBeenCalledWith("../%E9%9D%A2%E7%BB%8F/%E9%A2%98%E5%BA%93%E4%B8%8E%E5%8F%82%E8%80%83%E7%AD%94%E6%A1%88/");
  });

  it.each(["answer", "process", "preview"] as const)(
    "exposes a stable %s density hook",
    (variant) => {
      render(<MarkdownContent text="正文" variant={variant} />);
      expect(screen.getByTestId("markdown-content")).toHaveAttribute("data-variant", variant);
    },
  );

  it("keeps ordinary answers at a readable chat size", () => {
    render(<MarkdownContent text="正文" variant="answer" />);
    expect(screen.getByTestId("markdown-content")).toHaveClass("text-[14.5px]");
  });

  it("renders math, footnotes and callouts through the shared surface", () => {
    render(
      <MarkdownContent
        text={[
          "行内公式 $E = mc^2$。",
          "",
          "$$\\int_0^1 x^2 \\, dx$$",
          "",
          "> [!NOTE]",
          "> 公式里的符号可以直接复制。",
          "",
          "结论有来源。[^paper]",
          "",
          "[^paper]: 示例论文，第 3 页。",
        ].join("\n")}
      />,
    );

    expect(screen.getByTestId("markdown-callout")).toHaveAttribute("data-callout", "note");
    expect(document.querySelectorAll(".katex").length).toBeGreaterThan(0);
    expect(document.querySelector("section[data-footnotes]")).toHaveTextContent("示例论文");
  });

  it("keeps frontmatter available without presenting it as body copy", () => {
    render(<MarkdownContent text={"---\ntitle: 论文笔记\ntags: [AI, PDF]\n---\n\n# 正文"} variant="preview" />);

    expect(screen.getByText("文档信息")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-frontmatter")).toHaveTextContent("title: 论文笔记");
    expect(screen.getByRole("heading", { name: "正文" })).toBeInTheDocument();
  });

  it("renders Mermaid lazily and preserves source when rendering fails", async () => {
    render(<MarkdownContent text={"```mermaid\ngraph TD\n  A-->B\n```"} />);

    expect(screen.getByTestId("mermaid-diagram")).toHaveTextContent("graph TD");
    await act(async () => undefined);
  });

  it("clears an earlier Mermaid failure after streaming source becomes valid", async () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Leemo test renderer" });
    const renderMermaid = vi.mocked(mermaid.render);
    renderMermaid
      .mockRejectedValueOnce(new Error("unfinished diagram"))
      .mockResolvedValueOnce({ svg: "<svg aria-label=\"valid diagram\"></svg>" } as Awaited<ReturnType<typeof mermaid.render>>);

    const view = render(<MarkdownContent text={"```mermaid\ngraph TD\n  A--\n```"} />);
    expect(await screen.findByText("图表没有渲染，已保留源码。")).toBeInTheDocument();

    view.rerender(<MarkdownContent text={"```mermaid\ngraph TD\n  A-->B\n```"} />);
    await waitFor(() => expect(screen.queryByText("图表没有渲染，已保留源码。")).not.toBeInTheDocument());
    expect(document.querySelector("svg[aria-label='valid diagram']")).toBeInTheDocument();

    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
  });

  it("offers a compact copy action for fenced code", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MarkdownContent text={"```ts\nconst answer = 42;\n```"} />);

    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    expect(writeText).toHaveBeenCalledWith("const answer = 42;\n");
  });

  it("labels copy-ready plain text as user-facing content instead of a language code", () => {
    render(<MarkdownContent text={"```text\n一段可以直接复制的文字。\n```"} />);

    expect(screen.getByText("纯文本")).toBeInTheDocument();
    expect(screen.queryByText("TEXT")).not.toBeInTheDocument();
  });
});
