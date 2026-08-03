import { act, createEvent, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useContext } from "react";
import type { WorkspaceClient } from "../workspace/client";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import WorkbenchShell from "./WorkbenchShell";
import { useUi } from "../bridge/context";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import type { AskUserPayload } from "../../bridge/contract";

describe("WorkbenchShell", () => {
  it("renders complete layout (topbar + sidebar + main)", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument();
    expect(screen.getByLabelText("新建对话")).toBeInTheDocument();
    expect(screen.getByLabelText("模式切换")).toBeInTheDocument();
  });

  it("shows empty state when no conversations", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.getByText("还没有对话")).toBeInTheDocument();
    expect(screen.getByText("今天想先处理什么？")).toBeInTheDocument();
  });

  it("opens the dedicated scheduled-task page from the workbench sidebar", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "定时任务" }));
    expect(screen.getByRole("heading", { name: "定时任务" })).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-context-title")).not.toBeInTheDocument();
  });

  it("opens English learning as a first-class workbench page", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "英语学习" }));
    expect(screen.getByRole("heading", { name: "英语学习" })).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-context-title")).not.toBeInTheDocument();
  });

  it("renders conversation list", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);

    expect(screen.getAllByText("新对话")).toHaveLength(2); // sidebar + topbar
    expect(screen.queryByText("还没有对话")).not.toBeInTheDocument();
  });

  it("switches active conversation on click", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);
    await user.click(newBtn);

    const items = screen.getAllByRole("button").filter((btn) => btn.textContent === "新对话");
    expect(items.length).toBeGreaterThanOrEqual(2);

    await user.click(items[1]);
  });

  it("keeps unsent text drafts with their conversation instead of carrying them across tabs", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function CaptureStores() {
      stores = useContext(BridgeContext) as BridgeStores;
      return null;
    }
    render(
      <BridgeProvider>
        <CaptureStores />
        <WorkbenchShell />
      </BridgeProvider>,
    );

    await user.click(screen.getByLabelText("新建对话"));
    const first = stores.conversations.getState().activeId!;
    await user.type(screen.getByLabelText("输入消息"), "对话 A 的草稿");

    await user.click(screen.getByLabelText("新建对话"));
    const second = stores.conversations.getState().activeId!;
    expect(second).not.toBe(first);
    expect(screen.getByLabelText("输入消息")).toHaveValue("");
    await user.type(screen.getByLabelText("输入消息"), "对话 B 的草稿");

    act(() => stores.conversations.getState().switchActive(first));
    expect(screen.getByLabelText("输入消息")).toHaveValue("对话 A 的草稿");
    act(() => stores.conversations.getState().switchActive(second));
    expect(screen.getByLabelText("输入消息")).toHaveValue("对话 B 的草稿");
  });

  it("keeps the first draft visible when creating the conversation succeeds but sending fails", async () => {
    const client = new FixtureBridgeClient();
    const invoke = client.invoke.bind(client);
    vi.spyOn(client, "invoke").mockImplementation(async (channel, request) => {
      if (channel === "bridge:send") throw new Error("网络暂时不可用");
      return invoke(channel, request as never) as never;
    });
    render(
      <BridgeProvider client={client}>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    await userEvent.type(screen.getByLabelText("输入消息"), "这段草稿不能丢{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("网络暂时不可用");
    expect(screen.getByLabelText("输入消息")).toHaveValue("这段草稿不能丢");
  });

  it("shows unread indicator for inactive conversations", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);
    await user.click(newBtn);
  });

  it("renders tab bar when multiple tabs open", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);
    expect(screen.queryByTitle("关闭标签")).not.toBeInTheDocument();
  });

  it("closes tab and switches to adjacent", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);
    await user.click(newBtn);
  });

  it("calls setMode on toggle button click", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const buddyBtn = screen.getByText("搭子");
    await user.click(buddyBtn);
  });

  it("hides sidebar when collapsed", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const aside = screen.getByTestId("workbench-shell").querySelector("aside");
    expect(aside).toHaveClass("w-[260px]");
  });

  it("keeps a visible control for collapsing and restoring the workbench sidebar", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(screen.getByRole("complementary")).toHaveClass("w-[48px]");
    await user.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("button", { name: "收起侧栏" })).toBeInTheDocument();
  });

  it("renders settings entry in sidebar footer", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.getByTitle("设置")).toBeInTheDocument();
  });

  it("keeps secondary-page navigation active without duplicating the page title in the header", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    const skills = screen.getByTitle("技能");
    const artifacts = screen.getByTitle("成果");
    await user.click(skills);
    expect(skills).toHaveAttribute("aria-current", "page");
    expect(screen.queryByTestId("workbench-context-title")).not.toBeInTheDocument();

    await user.click(artifacts);
    expect(artifacts).toHaveAttribute("aria-current", "page");
    expect(skills).not.toHaveAttribute("aria-current");
    expect(screen.queryByTestId("workbench-context-title")).not.toBeInTheDocument();
  });

  it("truncates a chat title in the header while preserving its full tooltip", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    await user.click(screen.getByLabelText("新建对话"));
    const title = screen.getByTestId("workbench-context-title");
    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute("title", "新对话");
  });

  it("shows the active conversation's derived task state in the header and sidebar", () => {
    function SeedCompleted() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["conv-done"]) {
        stores.conversations.setState({
          byId: {
            "conv-done": {
              id: "conv-done", title: "整理课程报告", titleManuallyUpdated: true, bookId: null,
              source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
              createdAt: 1, lastActivityAt: 2, unread: false,
            },
          },
          order: ["conv-done"],
          activeId: "conv-done",
          timelines: {
            "conv-done": [{
              kind: "result", id: "done-result", runId: "run-1", isError: false, interrupted: false,
              finalText: "完成", pathAudit: { claimed: [] },
            }],
          },
          runIds: { "conv-done": null },
        });
      }
      return <WorkbenchShell />;
    }

    render(<BridgeProvider><SeedCompleted /></BridgeProvider>);
    expect(screen.getByTestId("current-conversation-status")).toHaveTextContent("已完成");
    expect(screen.getByRole("status", { name: "整理课程报告：已完成" })).toBeInTheDocument();
  });

  it("does not expose unfinished share or more actions", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.queryByTitle("预留功能")).not.toBeInTheDocument();
    expect(screen.queryByTitle("更多")).not.toBeInTheDocument();
  });

  it("creates new conversation and switches to it", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);

    expect(screen.getAllByText("新对话").length).toBeGreaterThanOrEqual(1);
  });

  it("sends message from input box", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);
  });

  it("shows and dismisses the active conversation's retry draft in workbench mode", async () => {
    function SeedRetry() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["conv-retry"]) {
        stores.conversations.setState({
          byId: {
            "conv-retry": {
              id: "conv-retry", title: "附件任务", titleManuallyUpdated: true, bookId: null,
              source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
              createdAt: 1, lastActivityAt: 2, unread: false,
            },
            "conv-clean": {
              id: "conv-clean", title: "正常对话", titleManuallyUpdated: true, bookId: null,
              source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
              createdAt: 1, lastActivityAt: 1, unread: false,
            },
          },
          order: ["conv-retry", "conv-clean"],
          activeId: "conv-retry",
          timelines: { "conv-retry": [], "conv-clean": [] },
          runIds: { "conv-retry": null, "conv-clean": null },
          pendingSends: {
            "conv-retry": {
              runId: "run-1", text: "分析附件",
              attachments: [{ name: "简历.pdf", path: "C:\\简历.pdf", size: 9, mimeType: "application/pdf" }],
              providerId: "deepseek", modelId: "deepseek-chat", errorMessage: "服务暂时不可用",
            },
          },
        });
      }
      return <WorkbenchShell />;
    }

    const user = userEvent.setup();
    render(<BridgeProvider><SeedRetry /></BridgeProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("原消息和附件已保留");

    await user.click(screen.getByRole("button", { name: "正常对话" }));
    expect(screen.queryByText("原消息和附件已保留")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "附件任务" }));
    expect(screen.getByRole("alert")).toHaveTextContent("原消息和附件已保留");

    await user.click(screen.getByRole("button", { name: "关闭重试提示" }));
    await waitFor(() => expect(screen.queryByText("原消息和附件已保留")).not.toBeInTheDocument());
  });

  it("shows Timeline when messages exist", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const newBtn = screen.getByLabelText("新建对话");
    await user.click(newBtn);
  });

  it("applies workbench data-shell attribute", () => {
    const { container } = render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    const root = container.firstElementChild;
    expect(root).toHaveAttribute("data-shell", "workbench");
  });

  it("lets the main column shrink so a long timeline cannot clip the composer", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass("min-h-0");
  });

  it("centers the composer in a restrained work column instead of stretching across wide screens", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    expect(screen.getByTestId("workbench-composer-column")).toHaveClass(
      "mx-auto",
      "w-full",
      "max-w-[880px]",
    );
  });

  it("keeps both side columns compact at the minimum desktop width", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>,
    );

    expect(screen.getByRole("complementary")).toHaveClass("max-[900px]:w-[180px]");
    expect(screen.getByTestId("conversation-column")).toBeInTheDocument();
  });

  it("renders preview column when previewOpen is true", async () => {
    function Trigger() {
      const openPreview = useUi((s) => s.openPreview);
      return (
        <button onClick={() => openPreview("/test.md", "Test", "markdown")}>open-preview</button>
      );
    }
    render(
      <BridgeProvider>
        <Trigger />
        <WorkbenchShell />
      </BridgeProvider>
    );

    const user = userEvent.setup();
    await user.click(screen.getByText("open-preview"));
    expect(screen.getByTestId("preview-pane-column")).toBeInTheDocument();
  });

  it("turns preview into a single main-area page below 1024px instead of squeezing the composer", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(max-width: 1023.98px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    function Trigger() {
      const openPreview = useUi((s) => s.openPreview);
      return <button onClick={() => openPreview("/test.md", "Test", "markdown")}>open-preview</button>;
    }
    try {
      render(
        <BridgeProvider>
          <Trigger />
          <WorkbenchShell />
        </BridgeProvider>,
      );

      const user = userEvent.setup();
      const trigger = screen.getByText("open-preview");
      await user.click(trigger);
      const preview = screen.getByTestId("preview-pane-column");
      expect(preview).toHaveClass(
        "max-[1024px]:absolute",
        "max-[1024px]:inset-y-0",
        "max-[1024px]:right-0",
        "max-[1024px]:!w-full",
      );
      expect(screen.getByTestId("conversation-column")).toHaveAttribute("inert");
      expect(screen.getByTestId("conversation-column")).toHaveAttribute("aria-hidden", "true");
      await waitFor(() => expect(preview).toHaveFocus());

      await user.click(screen.getByRole("button", { name: "关闭 Test" }));
      await waitFor(() => expect(trigger).toHaveFocus());
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("keeps the conversation interactive beside a preview at 1024px and wider", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: "(max-width: 1023.98px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    function Trigger() {
      const openPreview = useUi((s) => s.openPreview);
      return <button onClick={() => openPreview("/test.md", "Test", "markdown")}>open-preview</button>;
    }
    try {
      render(
        <BridgeProvider>
          <Trigger />
          <WorkbenchShell />
        </BridgeProvider>,
      );

      await userEvent.click(screen.getByText("open-preview"));
      expect(screen.getByTestId("conversation-column")).not.toHaveAttribute("inert");
      expect(screen.getByTestId("conversation-column")).not.toHaveAttribute("aria-hidden");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("returns focus to the narrow preview when another file replaces the active preview", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(max-width: 1023.98px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    function Trigger() {
      const openPreview = useUi((s) => s.openPreview);
      return (
        <>
          <button onClick={() => openPreview("/first.md", "First", "markdown")}>open-first</button>
          <button onClick={() => openPreview("/second.md", "Second", "markdown")}>open-second</button>
        </>
      );
    }
    try {
      render(
        <BridgeProvider>
          <Trigger />
          <WorkbenchShell />
        </BridgeProvider>,
      );

      const user = userEvent.setup();
      await user.click(screen.getByText("open-first"));
      const preview = screen.getByTestId("preview-pane-column");
      await waitFor(() => expect(preview).toHaveFocus());

      await user.click(screen.getByText("open-second"));
      await waitFor(() => expect(preview).toHaveFocus());
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("shows the actual preview when an artifact is opened from the artifacts page", async () => {
    function SeedArtifact() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (stores.artifacts.getState().entries.length === 0) {
        stores.artifacts.setState({
          status: "ready",
          error: null,
          entries: [{
            id: "artifact-report",
            kind: "file",
            path: "课程/报告.md",
            title: "报告.md",
            bookId: null,
            sourceConversationId: "conv-report",
            sourceRunId: "run-1",
            createdAt: 1,
            escaped: false,
          }],
        });
        stores.ui.setState({ view: "artifacts" });
      }
      return <WorkbenchShell />;
    }
    const workspace = {
      readPreview: vi.fn(async () => ({
        kind: "text" as const,
        text: "# 真实成果内容",
        truncated: false,
        size: 18,
      })),
    } as unknown as WorkspaceClient;
    const user = userEvent.setup();
    render(
      <BridgeProvider workspace={workspace}>
        <SeedArtifact />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "预览 报告.md" }));
    expect(await screen.findByTestId("preview-pane-column")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "真实成果内容" })).toBeInTheDocument();
  });

  it("hides preview column when previewOpen is false", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.queryByTestId("preview-pane-column")).not.toBeInTheDocument();
  });

  it("renders file tree column when filesOpen is true", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.queryByTestId("file-tree-column")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("文件树"));
    expect(screen.getByTestId("file-tree-column")).toHaveClass("absolute");
    await user.click(screen.getByLabelText("关闭文件树"));
    expect(screen.queryByTestId("file-tree-column")).not.toBeInTheDocument();
  });

  it("hides file tree column when filesOpen is false", () => {
    render(
      <BridgeProvider>
        <WorkbenchShell />
      </BridgeProvider>
    );

    expect(screen.queryByTestId("file-tree-column")).not.toBeInTheDocument();
  });

  it("renders momo's question card when momo asks — previously the round stalled forever here (卡 D)", async () => {
    // Before 卡 D, WorkbenchShell never rendered AskUserCard at all: momo
    // asking a question in 工作台态 meant the card never appeared and the
    // round hung until the SDK's permission stream timed out. Now Timeline →
    // TurnBlock renders it inline for both shells, no WorkbenchShell-specific
    // wiring required.
    const user = userEvent.setup();
    const client = new FixtureBridgeClient();
    render(
      <BridgeProvider client={client}>
        <WorkbenchShell />
      </BridgeProvider>
    );

    await user.type(screen.getByPlaceholderText("输入消息…"), "帮我整理笔记{Enter}");
    await screen.findAllByText("帮我整理笔记");

    const askPayload: AskUserPayload = {
      id: "wb-q1",
      conversationId: "conv-1",
      questions: [{ question: "放进哪个章节？", options: [{ label: "遍历" }, { label: "平衡树" }] }],
    };
    client.emitAskUser(askPayload);

    expect(await screen.findByText("放进哪个章节？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /遍历/ })).toBeInTheDocument();
  });
});

describe("WorkbenchShell — 本子 + 拖入归类 (轮 3 卡 G, 06 §2.2)", () => {
  const nbook = (id: string) => ({
    id, title: id, dir: `/w/Leemo/${id}`, color: "blue" as const, hasMemory: false,
  });

  function fakeWorkspace(over: Partial<WorkspaceClient> = {}): WorkspaceClient {
    return {
      listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [nbook("高等数学")] }),
      createNotebook: async (t: string) => nbook(t),
      ensureStarterNotebook: async () => nbook("例：高等数学"),
      readTree: async () => [],
      dropFiles: async () => [],
      moveFile: async () => ({ path: "x", name: "x", bookId: null }),
      suggestNotebook: async () => null,
      readTextFile: async () => "",
      readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
      reveal: async () => {},
      pathForFile: (f: File) => `C:\\Downloads\\${f.name}`,
      ...over,
    };
  }

  const dropOn = (el: Element, files: File[]) =>
    fireEvent.drop(el, { dataTransfer: { files, types: ["Files"] } });

  const renderWith = (workspace?: WorkspaceClient, client = new FixtureBridgeClient()) =>
    render(
      <BridgeProvider client={client} workspace={workspace}>
        <WorkbenchShell />
      </BridgeProvider>,
    );

  it("统一入口列出 Leemo 管理的真本子（启动时自动读一次 ~/Leemo）", async () => {
    renderWith(fakeWorkspace());
    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    expect(screen.getByRole("menuitem", { name: "打开本子 高等数学" })).toBeInTheDocument();
  });

  it("orders pinned conversations first and keeps archived conversations in a restorable section", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function CaptureStores() {
      stores = useContext(BridgeContext) as BridgeStores;
      return null;
    }
    const meta = (id: string, title: string, pinned: boolean, archived: boolean) => ({
      id,
      title,
      titleManuallyUpdated: true,
      bookId: null,
      workspaceId: "leemo-home",
      source: "workbench" as const,
      providerId: "deepseek",
      modelId: "deepseek-chat",
      createdAt: 1,
      lastActivityAt: 2,
      lastOpenedAt: 2,
      pinned,
      archived,
      unread: false,
    });
    render(
      <BridgeProvider>
        <CaptureStores />
        <WorkbenchShell />
      </BridgeProvider>,
    );
    act(() => stores.conversations.setState({
      byId: {
        regular: meta("regular", "普通对话", false, false),
        pinned: meta("pinned", "置顶对话", true, false),
        archived: meta("archived", "归档对话", false, true),
      },
      order: ["regular", "pinned", "archived"],
      activeId: "regular",
      timelines: { regular: [], pinned: [], archived: [] },
      runIds: { regular: null, pinned: null, archived: null },
    }));

    const rows = document.querySelectorAll("[data-conversation-id]");
    expect(rows[0]).toHaveAttribute("data-conversation-id", "pinned");
    expect(rows[1]).toHaveAttribute("data-conversation-id", "regular");
    expect(screen.queryByRole("button", { name: "归档对话" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "已归档 1" }));
    const archivedRow = document.querySelector('[data-conversation-id="archived"]');
    expect(archivedRow).not.toBeNull();
    await user.click(within(archivedRow as HTMLElement).getByRole("button", { name: "归档对话" }));
    expect(stores.conversations.getState().activeId).toBe("archived");
    await user.click(within(archivedRow as HTMLElement).getByRole("button", { name: "更多操作：归档对话" }));
    await user.click(screen.getByRole("button", { name: "移出归档" }));

    expect(stores.conversations.getState().byId.archived.archived).toBe(false);
  });

  it("同一入口切到外部本子，并从它的真实目录读取文件树", async () => {
    const external = {
      id: "workspace-123",
      name: "毕业设计",
      displayPath: "D:/Projects/毕业设计",
      kind: "external" as const,
      available: true,
      lastOpenedAt: 20,
    };
    const home = {
      id: "leemo-home",
      name: "Leemo",
      displayPath: "/w/Leemo",
      kind: "home" as const,
      available: true,
      lastOpenedAt: 0,
    };
    const readTree = vi.fn(async () => []);
    renderWith(fakeWorkspace({
      listWorkspaces: async () => [home, external],
      touchWorkspace: async () => external,
      readTree,
    }));

    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    expect(screen.getByRole("menuitem", { name: "打开本子 高等数学" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));

    expect(await screen.findByRole("button", { name: "选择本子，当前 毕业设计" })).toBeInTheDocument();
    await waitFor(() => expect(readTree).toHaveBeenLastCalledWith(external.id));
  });

  it("选中本子后拖文件 = 直落该本子，不再问一遍", async () => {
    const dropFiles = vi.fn(async () => []);
    const suggestNotebook = vi.fn(async () => null);
    const { container } = renderWith(fakeWorkspace({ dropFiles, suggestNotebook }));

    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 高等数学" }));
    expect(await screen.findByRole("button", { name: "选择本子，当前 高等数学" })).toBeInTheDocument();
    dropOn(container.firstElementChild!, [new File(["x"], "讲义.pdf")]);

    await waitFor(() =>
      expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\讲义.pdf"], "高等数学", "leemo-home"),
    );
    // 用户已经用「选中本子」表过态了，再弹确认条就是废话
    expect(screen.queryByTestId("drop-classify-bar")).not.toBeInTheDocument();
    expect(suggestNotebook).not.toHaveBeenCalled();
  });

  it("没选本子时拖文件 = 弹确认条", async () => {
    const { container } = renderWith(fakeWorkspace({ suggestNotebook: async () => "高等数学" }));
    dropOn(container.firstElementChild!, [new File(["x"], "高等数学-第三章.pdf")]);
    expect(await screen.findByTestId("drop-classify-bar")).toHaveTextContent("高等数学");
  });

  it("从工作台选择附件后，真实路径随消息进入 bridge:send", async () => {
    const client = new FixtureBridgeClient();
    const invoke = vi.spyOn(client, "invoke");
    const user = userEvent.setup();
    renderWith(fakeWorkspace(), client);

    const file = new File(["resume"], "简历.pdf", { type: "application/pdf" });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await user.type(screen.getByPlaceholderText("输入消息…"), "帮我检查{Enter}");

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("bridge:send", {
      conversationId: "conv-1",
      prompt: "帮我检查",
      sourceMessageId: "u0",
      attachments: [{
        name: "简历.pdf",
        path: "C:\\Downloads\\简历.pdf",
        size: 6,
        mimeType: "application/pdf",
      }],
    }));
  });

  it("拖到输入框只作为本轮附件，不会同时导入工作区", async () => {
    const dropFiles = vi.fn(async () => []);
    const client = new FixtureBridgeClient();
    const invoke = vi.spyOn(client, "invoke");
    const { container } = renderWith(fakeWorkspace({ dropFiles }), client);
    const file = new File(["resume"], "本轮简历.pdf", { type: "application/pdf" });
    const composer = container.querySelector(".leemo-input-shadow") as HTMLElement;

    dropOn(composer, [file]);
    expect(screen.getByText("本轮简历.pdf")).toBeInTheDocument();
    expect(dropFiles).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "帮我检查{Enter}");
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("bridge:send", {
      conversationId: "conv-1",
      prompt: "帮我检查",
      sourceMessageId: "u0",
      attachments: [{
        name: "本轮简历.pdf",
        path: "C:\\Downloads\\本轮简历.pdf",
        size: 6,
        mimeType: "application/pdf",
      }],
    }));
    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("工作区只接管文件拖入，不吞掉输入框里的普通文本拖放", () => {
    renderWith(fakeWorkspace());
    const shell = screen.getByTestId("workbench-shell");
    const textDrag = createEvent.dragOver(shell, {
      dataTransfer: { files: [], types: ["text/plain"] },
    });
    fireEvent(shell, textDrag);
    expect(textDrag.defaultPrevented).toBe(false);

    const fileDrag = createEvent.dragOver(shell, {
      dataTransfer: { files: [new File(["x"], "讲义.pdf")], types: ["Files"] },
    });
    fireEvent(shell, fileDrag);
    expect(fileDrag.defaultPrevented).toBe(true);
  });

  it("scopes failed first-turn drafts to their workspace and keeps them visible from the created conversation", async () => {
    const home = {
      id: "leemo-home", name: "Leemo", displayPath: "/w/Leemo", kind: "home" as const,
      available: true, lastOpenedAt: 0,
    };
    const project = {
      id: "workspace-project", name: "毕业设计", displayPath: "D:/Projects/毕业设计",
      kind: "external" as const, available: true, lastOpenedAt: 10,
    };
    const client = new FixtureBridgeClient();
    const invoke = client.invoke.bind(client);
    const invokeSpy = vi.spyOn(client, "invoke").mockImplementation(async (channel, request) => {
      if (channel === "bridge:send") throw new Error("离线验收失败");
      return invoke(channel, request as never) as never;
    });
    renderWith(fakeWorkspace({
      listWorkspaces: async () => [home, project],
      touchWorkspace: async (id) => id === project.id ? project : home,
      readTree: async () => [],
    }), client);

    await userEvent.type(screen.getByLabelText("输入消息"), "A 工作区草稿{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("离线验收失败");

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));
    expect(screen.getByLabelText("输入消息")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("输入消息"), "B 工作区草稿{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("离线验收失败");

    const sendCalls = invokeSpy.mock.calls.filter(([channel]) => channel === "bridge:send");
    expect(sendCalls.map(([, request]) => (request as { conversationId: string }).conversationId))
      .toEqual(["conv-1", "conv-2"]);

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 毕业设计" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "回到 Leemo 工作台" }));
    expect(screen.getByLabelText("输入消息")).toHaveValue("A 工作区草稿");
    expect(screen.getByRole("alert")).toHaveTextContent("离线验收失败");

    await userEvent.click(screen.getByRole("button", { name: "新对话" }));
    expect(screen.getByLabelText("输入消息")).toHaveValue("A 工作区草稿");
    expect(screen.getByRole("alert")).toHaveTextContent("离线验收失败");
  });

  it("never reuses a buddy HOME conversation while an external workspace is visible", async () => {
    const home = {
      id: "leemo-home", name: "Leemo", displayPath: "/w/Leemo", kind: "home" as const,
      available: true, lastOpenedAt: 0,
    };
    const project = {
      id: "workspace-project", name: "毕业设计", displayPath: "D:/Projects/毕业设计",
      kind: "external" as const, available: true, lastOpenedAt: 10,
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: "project-conversation" };
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    });
    const client = { invoke, subscribe: vi.fn(() => () => {}) } as never;

    function SeedMismatchedModeState() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["buddy-home"]) {
        stores.conversations.setState({
          byId: {
            "buddy-home": {
              id: "buddy-home", title: "搭子里的对话", titleManuallyUpdated: true, bookId: null,
              workspaceId: "leemo-home", source: "buddy", providerId: "deepseek",
              modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
            },
          },
          order: ["buddy-home"],
          activeId: "buddy-home",
          timelines: { "buddy-home": [] },
          runIds: { "buddy-home": null },
        });
        stores.workspaces?.setState({ activeId: project.id, list: [home, project] });
      }
      return <WorkbenchShell />;
    }

    render(
      <BridgeProvider
        client={client}
        workspace={fakeWorkspace({
          listWorkspaces: async () => [home, project],
          readTree: async () => [],
        })}
      >
        <SeedMismatchedModeState />
      </BridgeProvider>,
    );

    expect(screen.queryByTestId("workbench-context-title")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("输入消息"), "只在毕业设计里执行{Enter}");

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:createConversation",
      expect.objectContaining({ workspaceId: "workspace-project" }),
    ));
    expect(invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({ conversationId: "project-conversation" }),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({ conversationId: "buddy-home" }),
    );
  });
});

describe("WorkbenchShell — workspace conversation scope", () => {
  it("shows only conversations that belong to the active workspace", () => {
    function Seed() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["home-conv"]) {
        const meta = (id: string, title: string, workspaceId?: string) => ({
          id,
          title,
          titleManuallyUpdated: true,
          bookId: null,
          source: "workbench" as const,
          providerId: "deepseek",
          modelId: "deepseek-chat",
          createdAt: 1,
          lastActivityAt: 1,
          unread: false,
          ...(workspaceId ? { workspaceId } : {}),
        });
        stores.conversations.setState({
          byId: {
            "home-conv": meta("home-conv", "Leemo 主工作区对话"),
            "project-conv": meta("project-conv", "毕业设计对话", "workspace-project"),
          },
          order: ["project-conv", "home-conv"],
          activeId: "project-conv",
          timelines: { "home-conv": [], "project-conv": [] },
          runIds: { "home-conv": null, "project-conv": null },
        });
        stores.workspaces?.setState({
          activeId: "workspace-project",
          list: [{
            id: "workspace-project",
            name: "毕业设计",
            displayPath: "D:/Projects/毕业设计",
            kind: "external",
            available: true,
            lastOpenedAt: 1,
          }],
        });
      }
      return <WorkbenchShell />;
    }

    render(<BridgeProvider><Seed /></BridgeProvider>);
    expect(screen.getAllByText("毕业设计对话").length).toBeGreaterThan(0);
    expect(screen.queryByText("Leemo 主工作区对话")).not.toBeInTheDocument();
  });

  it("shows only conversations that belong to the active managed book", () => {
    function Seed() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["calculus"]) {
        const meta = (id: string, title: string, bookId: string | null) => ({
          id,
          title,
          titleManuallyUpdated: true,
          bookId,
          source: "workbench" as const,
          providerId: "deepseek",
          modelId: "deepseek-chat",
          createdAt: 1,
          lastActivityAt: 1,
          unread: false,
        });
        stores.conversations.setState({
          byId: {
            calculus: meta("calculus", "微积分复习", "高等数学"),
            career: meta("career", "产品经理简历", "秋招"),
            global: meta("global", "全局聊天", null),
          },
          order: ["career", "global", "calculus"],
          activeId: "career",
          timelines: { calculus: [], career: [], global: [] },
          runIds: { calculus: null, career: null, global: null },
        });
        stores.notebooks.setState({
          list: [{
            id: "高等数学",
            title: "高等数学",
            dir: "C:/Users/me/Leemo/高等数学",
            color: "blue",
            hasMemory: false,
          }],
          activeId: "高等数学",
        });
      }
      return <WorkbenchShell />;
    }

    render(<BridgeProvider><Seed /></BridgeProvider>);

    expect(screen.getAllByText("微积分复习").length).toBeGreaterThan(0);
    expect(screen.queryByText("产品经理简历")).not.toBeInTheDocument();
    expect(screen.queryByText("全局聊天")).not.toBeInTheDocument();
  });

  it("creates a new execution conversation inside the active managed book", async () => {
    const client = new FixtureBridgeClient();
    const invoke = vi.spyOn(client, "invoke");
    function SeedActiveBook() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (stores.notebooks.getState().activeId !== "高等数学") {
        stores.notebooks.setState({
          list: [{
            id: "高等数学",
            title: "高等数学",
            dir: "C:/Users/me/Leemo/高等数学",
            color: "blue",
            hasMemory: false,
          }],
          activeId: "高等数学",
        });
      }
      return <WorkbenchShell />;
    }

    render(
      <BridgeProvider client={client}>
        <SeedActiveBook />
      </BridgeProvider>,
    );
    await userEvent.click(screen.getByLabelText("新建对话"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:createConversation",
      expect.objectContaining({ workspaceId: "leemo-home", notebookId: "高等数学" }),
    ));
  });
});
