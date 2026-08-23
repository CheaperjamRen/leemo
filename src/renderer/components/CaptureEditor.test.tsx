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
  const losslessDocumentFixture = [
    "**斐波那契数列**（Fibonacci sequence）由以下递推关系定义：",
    "",
    "行内公式 $F_0 = 0, F_1 = 1$。",
    "",
    "$$",
    "F_n = F_{n-1} + F_{n-2}",
    "$$",
    "",
    "| 性质名称 | 数学表达 | 直观说明 |",
    "| --- | --- | --- |",
    "| 黄金分割 | $\\varphi^2 = \\varphi + 1$ | 相邻项比值收敛 |",
    "",
    "> [!NOTE]",
    "> 初始说明",
  ].join("\n");

  it("does not rewrite a valid Markdown document merely because rich mode hydrated", async () => {
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        variant="document"
        markdown={losslessDocumentFixture}
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveTextContent("斐波那契数列");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onMarkdownChange).not.toHaveBeenCalled();
  });

  it("imports copied Markdown as document objects instead of escaping it as plain text", async () => {
    vi.stubGlobal("DragEvent", class DragEvent extends Event {});
    vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        variant="document"
        markdown=""
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    selectEditorContents(editor);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        items: [],
        types: ["text/plain"],
        getData: (type: string) => type === "text/plain" ? losslessDocumentFixture : "",
      },
    });

    await waitFor(() => expect(onMarkdownChange).toHaveBeenCalled());
    const latest = String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "");
    expect(latest).toContain("**斐波那契数列**");
    expect(latest).not.toContain("\\**斐波那契数列\\**");
    expect(latest).toContain("$F_0 = 0, F_1 = 1$");
    expect(latest).toContain("| 性质名称 | 数学表达 | 直观说明 |\n| --- | --- | --- |");
    expect(within(editor).getByRole("textbox", { name: "表头 1" })).toHaveValue("性质名称");
  });

  it("preserves untouched bold, math, and adjacent GFM table rows after a real rich edit", async () => {
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        variant="document"
        markdown={losslessDocumentFixture}
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    const calloutInput = screen.getByRole("textbox", { name: "高亮块内容" });
    await userEvent.clear(calloutInput);
    await userEvent.type(calloutInput, "复核说明");

    await waitFor(() => expect(onMarkdownChange).toHaveBeenCalled());
    const latest = String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "");
    expect(latest).toContain("**斐波那契数列**");
    expect(latest).not.toContain("\\**斐波那契数列\\**");
    expect(latest).toContain("$F_0 = 0, F_1 = 1$");
    expect(latest).toContain("F_n = F_{n-1} + F_{n-2}");
    expect(latest).toContain([
      "| 性质名称 | 数学表达 | 直观说明 |",
      "| --- | --- | --- |",
      "| 黄金分割 | $\\varphi^2 = \\varphi + 1$ | 相邻项比值收敛 |",
    ].join("\n"));
    expect(latest).toContain("> [!NOTE]\n> 复核说明");
  });

  it("keeps the compact formatting toolbar below the writing canvas", () => {
    const { container } = render(
      <CaptureEditor markdown="" onMarkdownChange={vi.fn()} onSave={vi.fn()} />,
    );

    const toolbar = screen.getByRole("toolbar", { name: "便签格式" });
    const canvas = container.querySelector(".capture-editor__canvas");
    expect(canvas).not.toBeNull();
    expect(canvas!.compareDocumentPosition(toolbar)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(toolbar.querySelectorAll("button")).toHaveLength(7);
  });

  it("marks the quick-capture surface so its compact proportions stay isolated from documents", () => {
    render(
      <CaptureEditor
        markdown=""
        onMarkdownChange={() => undefined}
        onSave={() => undefined}
        variant="capture"
      />,
    );

    expect(screen.getByTestId("capture-editor")).toHaveClass("capture-editor--capture");
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

  it("balances direct document tools with one complete more menu", async () => {
    render(
      <CaptureEditor
        variant="document"
        markdown="正文"
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "加粗" })).toBeVisible();
    expect(screen.getByRole("button", { name: "清单" })).toBeVisible();
    expect(screen.getByRole("button", { name: "插入链接" })).toBeVisible();
    expect(screen.getByRole("button", { name: "插入表格" })).toBeVisible();
    expect(screen.getByRole("button", { name: "插入公式" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "更多格式" }));
    const menu = screen.getByRole("menu", { name: "更多格式" });
    expect(within(menu).getByRole("menuitem", { name: "插入链接" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "代码块" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "高亮块" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "插入公式" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "插入 Mermaid 图表" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "插入表格" })).toBeInTheDocument();
  });

  it("lets the user edit formula and Mermaid source inside rendered objects", async () => {
    const onMarkdownChange = vi.fn();
    render(
      <CaptureEditor
        variant="document"
        markdown={"公式 $x$。\n\n```mermaid\nflowchart LR\nA --> B\n```"}
        onMarkdownChange={onMarkdownChange}
        onSave={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "编辑公式" }));
    const formula = screen.getByLabelText("公式内容");
    await userEvent.clear(formula);
    await userEvent.type(formula, "x^2");
    await userEvent.click(screen.getByRole("button", { name: "编辑 Mermaid 图表" }));
    const mermaid = screen.getByLabelText("Mermaid 图表源码");
    await userEvent.clear(mermaid);
    await userEvent.type(mermaid, "flowchart TD{enter}A --> C");

    await waitFor(() => {
      const latest = String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "");
      expect(latest).toContain("$x^2$");
      expect(latest).toContain("flowchart TD\nA --> C");
    });
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
    await user.click(screen.getByRole("button", { name: "选择第 1 行" }));
    await user.click(screen.getByRole("button", { name: "在下方插入行" }));
    await user.click(screen.getByRole("button", { name: "选择第 1 列" }));
    await user.click(screen.getByRole("button", { name: "切换所选列对齐" }));

    await waitFor(() => {
      const markdown = String(onMarkdownChange.mock.calls.at(-1)?.[0] ?? "");
      expect(markdown).toContain("| 任务 | 列 2 |");
      expect(markdown).toContain("| :---: | --- |");
      expect(markdown.split("\n")).toHaveLength(5);
    });
  });

  it("leaves a real paragraph after an inserted callout so the document can continue", async () => {
    const user = userEvent.setup();
    render(
      <CaptureEditor
        variant="document"
        markdown="正文"
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    selectEditorContents(screen.getByRole("textbox", { name: "便签正文" }));
    await user.click(screen.getByRole("button", { name: "更多格式" }));
    await user.click(screen.getByRole("menuitem", { name: "高亮块" }));

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    const callout = editor.querySelector("[data-testid=\"markdown-editor-callout\"]");
    expect(callout).toBeInTheDocument();
    expect(callout?.parentElement?.nextElementSibling).toMatchObject({ tagName: "P" });
  });

  it("allows deleting a callout from the document flow", async () => {
    const user = userEvent.setup();
    render(
      <CaptureEditor
        variant="document"
        markdown={"> [!IMPORTANT]\n> 需要复核\n\n后续内容"}
        onMarkdownChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "便签正文" });
    const callout = within(editor).getByTestId("markdown-editor-callout");
    await user.click(callout);
    await user.keyboard("{Backspace}");

    expect(within(editor).queryByTestId("markdown-editor-callout")).not.toBeInTheDocument();
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
