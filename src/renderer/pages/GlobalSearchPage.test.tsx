import { describe, it, expect } from "vitest";
import { render, screen, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import GlobalSearchPage from "./GlobalSearchPage";
import { BridgeProvider, BridgeContext, type BridgeStores } from "../bridge/context";
import type { WorkspaceClient } from "../workspace/client";

/** Test harness: seeds a conversation + artifact into the real stores via
 * BridgeContext before rendering GlobalSearchPage, so the search runs against
 * live store state instead of the removed Phase-1 mocks. */
function Seed({ children }: { children: React.ReactNode }) {
  const stores = useContext(BridgeContext) as BridgeStores;
  // Plain synchronous store mutation during render (not React state, so no
  // act() wrapper needed). Runs once per stores instance, before paint.
  if (!stores.conversations.getState().byId["conv-1"]) {
    stores.conversations.setState((state) => ({
      byId: {
        ...state.byId,
        "conv-1": {
          id: "conv-1",
          title: "新对话 1",
          titleManuallyUpdated: true,
          bookId: "示例本子",
          source: "workbench",
          providerId: "deepseek",
          modelId: "deepseek-chat",
          createdAt: 1,
          lastActivityAt: 1,
          unread: false,
        },
      },
      order: ["conv-1"],
    }));
    stores.artifacts.getState().registerArtifact({
      id: "art-1",
      kind: "file",
      path: "docs/report.md",
      title: "分析报告",
      bookId: null,
      sourceConversationId: "conv-1",
      sourceRunId: "run-1",
      createdAt: 1,
      escaped: false,
    });
    stores.fileTree.setState({
      roots: [{
        path: "示例本子",
        name: "示例本子",
        kind: "dir",
        bookId: "示例本子",
        children: [{
          path: "示例本子/课程",
          name: "课程",
          kind: "dir",
          bookId: "示例本子",
          children: [{
            path: "示例本子/课程/复习提纲.md",
            name: "复习提纲.md",
            kind: "file",
            bookId: "示例本子",
          }],
        }],
      }],
    });
    stores.wikiEntries.setState({
      entries: [{
        id: "wiki-1",
        filePath: "示例本子/课程/数据结构.md",
        quotedText: "平衡二叉树",
        turns: [{ question: "红黑树有什么用？", answer: "保持近似平衡。" }],
        createdAt: 2,
      }],
    });
  }
  return <>{children}</>;
}

function renderSeeded() {
  return render(
    <BridgeProvider>
      <Seed>
        <GlobalSearchPage />
      </Seed>
    </BridgeProvider>
  );
}

function externalWorkspaceClient(): WorkspaceClient {
  return {
    listWorkspaces: async () => [{ id: "leemo-home", name: "Leemo", displayPath: "C:/Leemo", kind: "home", available: true, lastOpenedAt: 0 }, { id: "external", name: "毕业设计", displayPath: "D:/毕业设计", kind: "external", available: true, lastOpenedAt: 1 }],
    touchWorkspace: async (id) => ({ id, name: id === "external" ? "毕业设计" : "Leemo", displayPath: id === "external" ? "D:/毕业设计" : "C:/Leemo", kind: id === "external" ? "external" : "home", available: true, lastOpenedAt: 2 }),
    listNotebooks: async () => ({ root: "C:/Leemo", notebooks: [] }),
    createNotebook: async () => { throw new Error("not used"); },
    ensureStarterNotebook: async () => { throw new Error("not used"); },
    readTree: async (workspaceId) => workspaceId === "external"
      ? [{ path: "项目.md", name: "项目.md", kind: "file", bookId: null }]
      : [],
    dropFiles: async () => [],
    moveFile: async () => { throw new Error("not used"); },
    suggestNotebook: async () => null,
    readTextFile: async () => "",
    readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
    reveal: async () => {},
    pathForFile: () => "",
  };
}

describe("GlobalSearchPage", () => {
  it("renders search input with placeholder", () => {
    renderSeeded();
    expect(screen.getByPlaceholderText("搜索对话、文件、成果...")).toBeInTheDocument();
  });

  it("autofocuses search input", () => {
    renderSeeded();
    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    expect(input).toHaveFocus();
  });

  it("keeps the field, scope, and type controls in the approved order and clears in place", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <Seed>
          <GlobalSearchPage embedded initialScope="current" />
        </Seed>
      </BridgeProvider>,
    );

    const field = screen.getByTestId("global-search-field");
    const scope = screen.getByRole("group", { name: "搜索范围" });
    const types = screen.getByRole("group", { name: "结果类型" });
    expect(field.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scope.compareDocumentPosition(types) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "分析报告");
    await user.click(screen.getByRole("button", { name: "清空搜索" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("renders all filter buttons", () => {
    renderSeeded();
    const filters = within(screen.getByRole("group", { name: "结果类型" }));
    expect(filters.getByRole("button", { name: "全部" })).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "对话" })).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "文件" })).toBeInTheDocument();
    expect(filters.getByRole("button", { name: "成果" })).toBeInTheDocument();
  });

  it("shows empty state when query is empty", () => {
    renderSeeded();
    expect(screen.getByText("输入关键词搜索").closest("div")).toHaveAttribute("data-state", "idle");
  });

  it("offers an explicit close action", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function Capture() {
      stores = useContext(BridgeContext) as BridgeStores;
      return <GlobalSearchPage />;
    }
    render(
      <BridgeProvider>
        <Capture />
      </BridgeProvider>,
    );
    act(() => stores.ui.getState().toggleSearch());

    await user.click(screen.getByRole("button", { name: "关闭搜索" }));
    expect(stores.ui.getState().searchOpen).toBe(false);
  });

  it("filters results when typing query", async () => {
    const user = userEvent.setup();
    renderSeeded();
    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "对话");
    expect(screen.getByText("新对话 1")).toBeInTheDocument();
  });

  it("shows no results message when no matches", async () => {
    const user = userEvent.setup();
    renderSeeded();
    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "不存在的内容xyz");
    expect(screen.getByText("没找到相关内容")).toBeInTheDocument();
  });

  it("defaults the embedded search to the current scope and lets the user widen it", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <Seed>
          <GlobalSearchPage embedded initialScope="current" />
        </Seed>
      </BridgeProvider>,
    );

    await user.type(screen.getByPlaceholderText("搜索对话、文件、成果..."), "新对话");
    expect(screen.getByText("没找到相关内容")).toBeInTheDocument();

    await user.click(within(screen.getByRole("group", { name: "搜索范围" })).getByRole("button", { name: "全部" }));
    expect(screen.getByRole("button", { name: /新对话 1/ })).toBeInTheDocument();
  });

  it("switches workspace search results through the guarded scope transaction", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function SeedExternal() {
      stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId.external) {
        stores.conversations.setState({
          byId: { external: { id: "external", title: "毕业设计讨论", titleManuallyUpdated: true, bookId: null, workspaceId: "external", source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 1, unread: false } },
          order: ["external"], activeId: null,
        });
        stores.ui.getState().openPreview("旧文件.md", "旧文件.md", "markdown");
      }
      return <GlobalSearchPage />;
    }
    render(<BridgeProvider workspace={externalWorkspaceClient()}><SeedExternal /></BridgeProvider>);

    await user.type(screen.getByPlaceholderText("搜索对话、文件、成果..."), "毕业设计");
    await user.click(screen.getByRole("button", { name: /毕业设计讨论/ }));

    await waitFor(() => expect(stores.workspaces?.getState().activeId).toBe("external"));
    expect(stores.ui.getState().activeScopeKey).toBe("workspace:external");
    expect(stores.ui.getState().previewTabs).toEqual([]);
    expect(stores.fileTree.getState().roots).toEqual([{ path: "项目.md", name: "项目.md", kind: "file", bookId: null }]);
  });

  it("keeps the current workspace when a search jump would abandon a dirty Markdown draft", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function SeedExternal() {
      stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId.external) {
        stores.conversations.setState({
          byId: { external: { id: "external", title: "毕业设计讨论", titleManuallyUpdated: true, bookId: null, workspaceId: "external", source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 1, unread: false } },
          order: ["external"], activeId: null,
        });
        stores.previewContent.getState().beginEdit("草稿.md", "旧内容");
        stores.previewContent.getState().updateDraft("草稿.md", "新内容");
      }
      return <GlobalSearchPage />;
    }
    render(<BridgeProvider workspace={externalWorkspaceClient()}><SeedExternal /></BridgeProvider>);

    await user.type(screen.getByPlaceholderText("搜索对话、文件、成果..."), "毕业设计");
    await user.click(screen.getByRole("button", { name: /毕业设计讨论/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Markdown 修改没有保存");
    expect(stores.workspaces?.getState().activeId).toBe("leemo-home");
    expect(stores.previewContent.getState().drafts["leemo-home\u0000草稿.md"]?.status).toBe("dirty");
  });

  it("switches filter to conversations", async () => {
    const user = userEvent.setup();
    renderSeeded();
    const conversationsBtn = within(screen.getByRole("group", { name: "结果类型" })).getByRole("button", { name: "对话" });
    await user.click(conversationsBtn);
    expect(conversationsBtn).toHaveClass("active");
  });

  it("filters only conversations when filter is active", async () => {
    const user = userEvent.setup();
    renderSeeded();

    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "分析");

    // 全部模式：应该找到成果
    expect(screen.getByText("分析报告")).toBeInTheDocument();

    // 切换到对话模式
    const conversationsBtn = within(screen.getByRole("group", { name: "结果类型" })).getByRole("button", { name: "对话" });
    await user.click(conversationsBtn);

    // 对话模式：不应该找到成果
    expect(screen.queryByText("分析报告")).not.toBeInTheDocument();
  });

  it("result cards are keyboard accessible", async () => {
    const user = userEvent.setup();
    renderSeeded();

    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "对话");

    const resultCard = screen.getByRole("button", { name: /新对话 1/ });
    expect(resultCard).toHaveAttribute("tabIndex", "0");
  });

  it("clicking a conversation result switches active conversation, sets chat view, and closes search", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function Capture() {
      stores = useContext(BridgeContext) as BridgeStores;
      return null;
    }
    render(
      <BridgeProvider>
        <Seed>
          <Capture />
          <GlobalSearchPage />
        </Seed>
      </BridgeProvider>
    );
    act(() => {
      stores.ui.getState().toggleSearch();
    });

    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "对话");
    await user.click(screen.getByRole("button", { name: /新对话 1/ }));

    expect(stores.conversations.getState().activeId).toBe("conv-1");
    expect(stores.workspaces?.getState().activeId).toBe("leemo-home");
    expect(stores.notebooks.getState().activeId).toBe("示例本子");
    expect(stores.settings.getState().mode).toBe("workbench");
    expect(stores.ui.getState().view).toBe("chat");
    expect(stores.ui.getState().searchOpen).toBe(false);
  });

  it("clicking an artifact result returns to chat, opens preview, and closes search", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function Capture() {
      stores = useContext(BridgeContext) as BridgeStores;
      return null;
    }
    render(
      <BridgeProvider>
        <Seed>
          <Capture />
          <GlobalSearchPage />
        </Seed>
      </BridgeProvider>
    );
    act(() => {
      stores.ui.getState().setView("artifacts");
      stores.ui.getState().toggleSearch();
    });

    const input = screen.getByPlaceholderText("搜索对话、文件、成果...");
    await user.type(input, "分析报告");
    await user.click(screen.getByRole("button", { name: /分析报告/ }));

    expect(stores.ui.getState().previewOpen).toBe(true);
    expect(stores.ui.getState().previewActivePath).toBe("docs/report.md");
    expect(stores.ui.getState().view).toBe("chat");
    expect(stores.ui.getState().searchOpen).toBe(false);
  });

  it("finds a real workspace file by name or path and opens its preview", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    function Capture() {
      stores = useContext(BridgeContext) as BridgeStores;
      return null;
    }
    render(
      <BridgeProvider>
        <Seed>
          <Capture />
          <GlobalSearchPage />
        </Seed>
      </BridgeProvider>,
    );
    act(() => stores.ui.getState().toggleSearch());

    await user.click(within(screen.getByRole("group", { name: "结果类型" })).getByRole("button", { name: "文件" }));
    await user.type(screen.getByPlaceholderText("搜索对话、文件、成果..."), "课程/复习");
    await user.click(screen.getByRole("button", { name: /复习提纲\.md/ }));

    expect(stores.ui.getState().previewActivePath).toBe("示例本子/课程/复习提纲.md");
    expect(stores.ui.getState().previewTabs.at(-1)?.kind).toBe("markdown");
    expect(stores.ui.getState().searchOpen).toBe(false);
  });

  it("includes matching wiki entries in the all-results search", async () => {
    const user = userEvent.setup();
    renderSeeded();
    await user.type(screen.getByPlaceholderText("搜索对话、文件、成果..."), "红黑树");
    expect(screen.getByRole("button", { name: /平衡二叉树/ })).toBeInTheDocument();
  });
});
