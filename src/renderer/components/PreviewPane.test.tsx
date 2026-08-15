import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BridgeProvider } from "../bridge/context";
import { useUi } from "../bridge/context";
import PreviewPane from "./PreviewPane";
import type { PreviewPayload, WorkspaceClient } from "../workspace/client";

/** 轮 4「预览区通电」后 PreviewPane 从 workspace 读真内容，所以测试必须给它一个
 *  workspace。fixture 时代那份 `FIXTURE_CONTENT = {}` 已经删掉了。 */
const CONTENT: Record<string, PreviewPayload> = {
  "math/a.md": { kind: "text", text: "# 真标题\n\n真正文", truncated: false, size: 20 },
  "math/b.html": { kind: "text", text: "<p>hi</p>", truncated: false, size: 9 },
  "math/c.pdf": { kind: "binary", mimeType: "application/pdf", base64: "JVBERi0=", size: 8 },
  "math/d.bin": { kind: "unpreviewable", reason: "这是二进制文件，没法当文本预览", size: 4 },
  "math/e.log": { kind: "text", text: "line 1\nline 2", truncated: false, size: 13 },
};

function fakeWorkspace(over?: Partial<Record<string, PreviewPayload>>, fail?: string) {
  const readPreview = vi.fn(async (path: string) => {
    if (fail) throw new Error(fail);
    const payload = { ...CONTENT, ...over }[path];
    if (!payload) throw new Error(`读不到这个文件：${path}`);
    return payload;
  });
  const writeMarkdownFile = vi.fn(async (_path: string, text: string) => ({
    kind: "text" as const,
    text,
    truncated: false,
    size: Buffer.byteLength(text),
  }));
  const openFile = vi.fn(async () => {});
  const reveal = vi.fn(async () => {});
  return {
    client: { readPreview, writeMarkdownFile, openFile, reveal } as unknown as WorkspaceClient,
    readPreview,
    writeMarkdownFile,
    openFile,
    reveal,
  };
}

function TabSetup() {
  const openPreview = useUi((s) => s.openPreview);
  return (
    <div>
      <button onClick={() => openPreview("math/a.md", "File A", "markdown")}>open-a</button>
      <button onClick={() => openPreview("math/b.html", "File B", "html")}>open-b</button>
      <button onClick={() => openPreview("math/c.pdf", "File C", "pdf")}>open-c</button>
      <button onClick={() => openPreview("math/d.bin", "File D", "other")}>open-d</button>
      <button onClick={() => openPreview("math/e.log", "File E", "other")}>open-e</button>
      <PreviewPane />
    </div>
  );
}

function setup(over?: Partial<Record<string, PreviewPayload>>, fail?: string) {
  const ws = fakeWorkspace(over, fail);
  render(
    <BridgeProvider workspace={ws.client}>
      <TabSetup />
    </BridgeProvider>,
  );
  return ws;
}

describe("PreviewPane", () => {
  it("renders empty state when previewTabs is empty", () => {
    render(
      <BridgeProvider workspace={fakeWorkspace().client}>
        <PreviewPane />
      </BridgeProvider>,
    );
    expect(screen.getByText(/没有打开的文件/)).toBeInTheDocument();
  });

  it("renders tab bar with close buttons", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-a"));
    await user.click(screen.getByText("open-b"));
    expect(screen.getAllByText("File A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("File B").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("关闭 File A")).toBeInTheDocument();
    expect(screen.getByLabelText("关闭 File B")).toBeInTheDocument();
  });

  it("renders sanitized html content in a script-free iframe", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <BridgeProvider workspace={fakeWorkspace().client}>
        <TabSetup />
      </BridgeProvider>,
    );
    await user.click(screen.getByText("open-b"));
    await waitFor(() => expect(container.querySelector("iframe")).toBeInTheDocument());
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.getAttribute("srcdoc")).toContain("<p>hi</p>");
    expect(iframe?.getAttribute("srcdoc")).toContain("script-src 'none'");
  });

  it("switches active tab on click", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-a"));
    await user.click(screen.getByText("open-b"));
    await user.click(screen.getByText("File A"));
    await waitFor(() => expect(screen.getByTestId("preview-markdown")).toBeInTheDocument());
  });

  it("calls closePreviewTab on close button click", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-a"));
    await user.click(screen.getByText("open-b"));
    await user.click(screen.getByLabelText("关闭 File A"));
    expect(screen.queryByText("File A")).not.toBeInTheDocument();
    expect(screen.getAllByText("File B").length).toBeGreaterThan(0);
  });
});

// ── 轮 4「预览区通电」──────────────────────────────────────────────────────
// 通电前：FIXTURE_CONTENT 是 {}，点开任何文件都显示 "(内容加载中)" —— 永远。
describe("PreviewPane — 真文件内容", () => {
  it("reads the clicked file and renders its REAL markdown (not a fixture, not 加载中)", async () => {
    const user = userEvent.setup();
    const { readPreview } = setup();
    await user.click(screen.getByText("open-a"));

    await waitFor(() => expect(screen.getByText("真标题")).toBeInTheDocument());
    expect(screen.getByText("真正文")).toBeInTheDocument();
    expect(readPreview).toHaveBeenCalledWith("math/a.md", "leemo-home");
    // 承重：不许再出现那句永久占位。
    expect(screen.queryByText(/内容加载中/)).not.toBeInTheDocument();
  });

  it("renders markdown as markdown — a heading becomes a real heading, not a literal #", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "真标题" })).toBeInTheDocument());
  });

  it("opens a relative markdown folder link inside the workspace instead of localhost", async () => {
    const user = userEvent.setup();
    const { reveal } = setup({
      "math/a.md": {
        kind: "text",
        text: "[面经题库](../面经/题库与参考答案/)",
        truncated: false,
        size: 48,
      },
    });
    await user.click(screen.getByText("open-a"));
    await user.click(await screen.findByRole("link", { name: "面经题库" }));

    expect(reveal).toHaveBeenCalledWith("面经/题库与参考答案", "leemo-home");
  });

  it("opens a relative markdown file as another Leemo preview tab", async () => {
    const user = userEvent.setup();
    setup({
      "math/a.md": {
        kind: "text",
        text: "[参考答案](../面经/参考答案.md)",
        truncated: false,
        size: 40,
      },
    });
    await user.click(screen.getByText("open-a"));
    await user.click(await screen.findByRole("link", { name: "参考答案" }));

    expect(screen.getByLabelText("关闭 参考答案.md")).toBeInTheDocument();
  });

  it("keeps the real file path and system actions in one compact document header", async () => {
    const user = userEvent.setup();
    const { openFile, reveal } = setup();
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByTestId("preview-document-header")).toBeInTheDocument());

    const header = screen.getByTestId("preview-document-header");
    expect(header).toHaveTextContent("math");
    expect(header).toHaveTextContent("File A");
    await user.click(screen.getByRole("button", { name: "用默认应用打开 File A" }));
    await user.click(screen.getByRole("button", { name: "在文件夹中显示 File A" }));
    expect(openFile).toHaveBeenCalledWith("math/a.md", "leemo-home");
    expect(reveal).toHaveBeenCalledWith("math/a.md", "leemo-home");
  });

  it("shows plain text verbatim rather than parsing it as markdown", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-e"));
    await waitFor(() => expect(screen.getByTestId("preview-plaintext")).toBeInTheDocument());
    expect(screen.getByTestId("preview-plaintext").textContent).toBe("line 1\nline 2");
  });

  it("says WHY a binary file can't be previewed instead of going blank", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-d"));
    await waitFor(() => expect(screen.getByTestId("preview-unpreviewable")).toBeInTheDocument());
    expect(screen.getByTestId("preview-unpreviewable").textContent).toContain("二进制");
    expect(screen.getByTestId("preview-unpreviewable")).toHaveTextContent("math/d.bin");
    expect(screen.getByRole("button", { name: "在文件夹中显示" })).toBeInTheDocument();
  });

  it("shows a loading state while the read is in flight, then the content", async () => {
    let release: (p: PreviewPayload) => void = () => {};
    const readPreview = vi.fn(() => new Promise<PreviewPayload>((r) => { release = r; }));
    render(
      <BridgeProvider workspace={{ readPreview } as unknown as WorkspaceClient}>
        <TabSetup />
      </BridgeProvider>,
    );
    await userEvent.click(screen.getByText("open-a"));
    expect(screen.getByTestId("preview-loading")).toBeInTheDocument();

    release({ kind: "text", text: "来了", truncated: false, size: 6 });
    await waitFor(() => expect(screen.getByText("来了")).toBeInTheDocument());
  });

  it("surfaces a read failure with a retry that really re-reads", async () => {
    const user = userEvent.setup();
    const { readPreview } = setup(undefined, "读不到这个文件：math/a.md");
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByTestId("preview-error")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "文件已经不在这里" })).toBeInTheDocument();
    expect(screen.getByTestId("preview-error")).toHaveTextContent("math/a.md");
    expect(screen.getByTestId("preview-error")).toHaveTextContent("移动、改名或删除");

    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(readPreview).toHaveBeenCalledTimes(2));
  });

  it("turns a permission failure into a clear user action instead of raw EACCES", async () => {
    const user = userEvent.setup();
    setup(undefined, "EACCES: permission denied, open 'C:\\Users\\me\\Leemo\\math\\a.md'");
    await user.click(screen.getByText("open-a"));

    await waitFor(() => expect(screen.getByRole("heading", { name: "暂时没有权限读取" })).toBeInTheDocument());
    const error = screen.getByTestId("preview-error");
    expect(error).toHaveTextContent("math/a.md");
    expect(error).toHaveTextContent("检查文件权限");
    expect(error).not.toHaveTextContent("C:\\Users\\me");
  });

  it("recovers visibly after retry when the file becomes readable", async () => {
    const user = userEvent.setup();
    const readPreview = vi.fn()
      .mockRejectedValueOnce(new Error("读不到这个文件：math/a.md"))
      .mockResolvedValueOnce(CONTENT["math/a.md"]);
    render(
      <BridgeProvider workspace={{ readPreview } as unknown as WorkspaceClient}>
        <TabSetup />
      </BridgeProvider>,
    );
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "文件已经不在这里" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "真标题" })).toBeInTheDocument());
    expect(screen.queryByTestId("preview-error")).not.toBeInTheDocument();
    expect(readPreview).toHaveBeenCalledTimes(2);
  });

  it("tells the user when a big file was cut short", async () => {
    const user = userEvent.setup();
    setup({ "math/a.md": { kind: "text", text: "开头", truncated: true, size: 9_000_000 } });
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByText(/只显示了开头一部分/)).toBeInTheDocument());
  });

  it("reads each path once — switching between two open tabs hits no disk again", async () => {
    const user = userEvent.setup();
    const { readPreview } = setup();
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByTestId("preview-markdown")).toBeInTheDocument());
    await user.click(screen.getByText("open-e"));
    await waitFor(() => expect(screen.getByTestId("preview-plaintext")).toBeInTheDocument());
    await user.click(screen.getByText("File A"));
    await waitFor(() => expect(screen.getByTestId("preview-markdown")).toBeInTheDocument());

    expect(readPreview).toHaveBeenCalledTimes(2);
  });

  it("edits and saves markdown without leaving the preview pane", async () => {
    const user = userEvent.setup();
    const { writeMarkdownFile } = setup();
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "真标题" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "编辑 File A" }));
    const editor = screen.getByRole("textbox", { name: "编辑 File A" });
    selectEditorContents(editor);
    await user.click(screen.getByRole("button", { name: "加粗" }));
    expect(screen.getByText("未保存")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(writeMarkdownFile).toHaveBeenCalledWith(
      "math/a.md",
      "# **真标题**\n\n**真正文**",
      "# 真标题\n\n真正文",
      "leemo-home",
    ));
    expect(screen.getAllByText(/已自动保存/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "阅读 File A" }));
    expect(screen.getByRole("heading", { name: "真标题" })).toBeInTheDocument();
  });

  it("guards a dirty tab and keeps the draft when saving fails", async () => {
    const user = userEvent.setup();
    const ws = fakeWorkspace();
    ws.client.writeMarkdownFile = vi.fn(async () => {
      throw new Error("文件已在其他地方发生了变化。你的草稿还在，请重新载入后再保存。");
    });
    render(
      <BridgeProvider workspace={ws.client}>
        <TabSetup />
      </BridgeProvider>,
    );
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "真标题" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "编辑 File A" }));
    const editor = screen.getByRole("textbox", { name: "编辑 File A" });
    selectEditorContents(editor);
    await user.click(screen.getByRole("button", { name: "加粗" }));
    await user.click(screen.getByLabelText("关闭 File A"));

    expect(screen.getByRole("dialog", { name: "保存这份修改？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));
    await waitFor(() => expect(screen.getByText(/草稿还在/)).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "编辑 File A" })).toHaveTextContent("真标题真正文");
    expect(screen.getByRole("button", { name: "复制草稿" })).toBeInTheDocument();
    expect(screen.getAllByText("File A").length).toBeGreaterThan(0);
  });

  it("does not offer editing for a truncated markdown preview", async () => {
    const user = userEvent.setup();
    setup({ "math/a.md": { kind: "text", text: "开头", truncated: true, size: 9_000_000 } });
    await user.click(screen.getByText("open-a"));
    await waitFor(() => expect(screen.getByText(/只显示了开头一部分/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "编辑 File A" })).not.toBeInTheDocument();
  });

  it("hands a PDF to the PDF.js view (lazy — pdfjs must not load until a PDF is opened)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText("open-c"));
    // jsdom 里 pdfjs 起不来，所以这里只钉"走了 PDF 分支"：要么 Suspense 占位，
    // 要么 PdfView 自己挂载。真实渲染由用户目验（02 §九 TextLayer 选区）。
    await waitFor(() =>
      expect(
        screen.queryByTestId("preview-pdf-loading") ??
        screen.queryByTestId("pdf-view") ??
        screen.queryByTestId("pdf-error"),
      ).toBeTruthy(),
    );
  });
});
function selectEditorContents(editor: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(editor);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
}
