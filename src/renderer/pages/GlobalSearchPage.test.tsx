import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import GlobalSearchPage from "./GlobalSearchPage";
import { BridgeProvider, BridgeContext, type BridgeStores } from "../bridge/context";

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

  it("renders all filter buttons", () => {
    renderSeeded();
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.getByText("文件")).toBeInTheDocument();
    expect(screen.getByText("成果")).toBeInTheDocument();
  });

  it("shows empty state when query is empty", () => {
    renderSeeded();
    expect(screen.getByText("输入关键词搜索")).toBeInTheDocument();
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

  it("switches filter to conversations", async () => {
    const user = userEvent.setup();
    renderSeeded();
    const conversationsBtn = screen.getByText("对话");
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
    const conversationsBtn = screen.getByText("对话");
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

    await user.click(screen.getByRole("button", { name: "文件" }));
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
