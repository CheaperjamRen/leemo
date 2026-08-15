import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useContext } from "react";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import WorkbenchSidebar from "./WorkbenchSidebar";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import type { WorkspaceClient } from "../workspace/client";

function Seed({ onReady }: { onReady?: (stores: BridgeStores) => void }): null {
  const stores = useContext(BridgeContext) as BridgeStores;
  onReady?.(stores);
  if (!stores.conversations.getState().byId["global-chat"]) {
    stores.notebooks.setState({
      list: [
        { id: "math", title: "高等数学", dir: "C:/Leemo/高等数学", color: "blue", hasMemory: true },
        { id: "career", title: "求职", dir: "C:/Leemo/求职", color: "green", hasMemory: false },
      ],
      activeId: "math",
    });
    stores.conversations.setState({
      byId: {
        "global-chat": {
          id: "global-chat", title: "和 momo 讨论方向", titleManuallyUpdated: true, bookId: null,
          workspaceId: HOME_WORKSPACE_ID, source: "buddy", providerId: "deepseek", modelId: "deepseek-chat",
          createdAt: 1, lastActivityAt: 4, unread: true,
        },
        "math-chat": {
          id: "math-chat", title: "微积分复习", titleManuallyUpdated: true, bookId: "math",
          workspaceId: HOME_WORKSPACE_ID, source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
          createdAt: 1, lastActivityAt: 3, unread: false,
        },
        "career-chat": {
          id: "career-chat", title: "简历修改", titleManuallyUpdated: true, bookId: "career",
          workspaceId: HOME_WORKSPACE_ID, source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
          createdAt: 1, lastActivityAt: 2, unread: false,
        },
      },
      order: ["global-chat", "math-chat", "career-chat"],
      activeId: "math-chat",
      timelines: { "global-chat": [], "math-chat": [], "career-chat": [] },
      runIds: { "global-chat": null, "math-chat": null, "career-chat": null },
    });
  }
  return null;
}

function EmptySeed(): null {
  const stores = useContext(BridgeContext) as BridgeStores;
  if (stores.notebooks.getState().list.length > 0 || stores.conversations.getState().order.length > 0) {
    stores.notebooks.setState({ list: [], activeId: null });
    stores.conversations.setState({
      byId: {},
      order: [],
      activeId: null,
      timelines: {},
      runIds: {},
    });
  }
  return null;
}

describe("WorkbenchSidebar", () => {
  it.each([
    ["auto", 960, "compact"],
    ["compact", 1440, "compact"],
    ["pinned", 960, "expanded"],
  ] as const)("resolves %s preference at %ipx as %s", (preference, shellWidth, expected) => {
    render(
      <BridgeProvider>
        <Seed onReady={(stores) => stores.ui.getState().setWorkbenchSidebarPreference(preference)} />
        <WorkbenchSidebar onNewConversation={() => {}} shellWidth={shellWidth} />
      </BridgeProvider>,
    );

    const sidebar = screen.getByTestId("workbench-sidebar");
    if (expected === "compact") {
      expect(sidebar).toHaveStyle({ width: "52px" });
      expect(within(sidebar).queryByRole("button", { name: "展开侧栏" })).not.toBeInTheDocument();
    } else {
      expect(sidebar).toHaveStyle({ width: "288px" });
      expect(within(sidebar).queryByRole("button", { name: "收起侧栏" })).not.toBeInTheDocument();
    }
  });

  it("starts directly with workbench navigation instead of repeating the shared product chrome", () => {
    render(
      <BridgeProvider>
        <EmptySeed />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    expect(screen.queryByTestId("workbench-product-identity")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "momo 的头像" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "模式切换" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建对话" })).toHaveClass("h-10");
    expect(screen.queryByRole("button", { name: "收起侧栏" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工作台快捷入口" })).toHaveClass("min-h-14");
  });

  it("gives both empty maps a compact hierarchy without adding fake actions", () => {
    render(
      <BridgeProvider>
        <EmptySeed />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    const notebookEmpty = screen.getByTestId("workbench-notebook-empty");
    expect(within(notebookEmpty).getByText("还没有本子")).toBeInTheDocument();
    expect(within(notebookEmpty).getByText("用右上角 + 创建或连接")).toBeInTheDocument();
    expect(within(notebookEmpty).queryByRole("button")).not.toBeInTheDocument();

    const globalEmpty = screen.getByTestId("workbench-global-empty");
    expect(within(globalEmpty).getByText("还没有对话")).toBeInTheDocument();
    expect(within(globalEmpty).getByText("点 + 开始一段全局对话")).toBeInTheDocument();
    expect(within(globalEmpty).queryByRole("button")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "新建全局对话" })).toBeInTheDocument();
  });

  it("keeps notebooks above a separately scrolling global momo section", () => {
    render(
      <BridgeProvider>
        <Seed />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    const notebooks = screen.getByTestId("workbench-notebook-map");
    const global = screen.getByTestId("workbench-global-map");
    expect(within(notebooks).getByText("本子")).toBeInTheDocument();
    expect(within(global).getByText("与 momo 的对话")).toBeInTheDocument();
    expect(within(global).getByText("和 momo 讨论方向")).toBeInTheDocument();
    expect(within(notebooks).getByText("高等数学")).toBeInTheDocument();
    expect(within(notebooks).getByText("求职")).toBeInTheDocument();
    expect(within(notebooks).getByText("微积分复习")).toBeInTheDocument();
    expect(within(notebooks).queryByText("简历修改")).not.toBeInTheDocument();
    expect(notebooks).toHaveClass("max-h-[55%]");
    expect(global).toHaveClass("flex-1");
    expect(notebooks).not.toHaveClass("overflow-y-auto");
    expect(global).not.toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("workbench-notebook-list")).toHaveClass("overflow-y-auto");
    expect(screen.getByTestId("workbench-global-list")).toHaveClass("overflow-y-auto");
    expect(global).toHaveClass("min-h-[164px]");
  });

  it("uses the dense workbench row rhythm", () => {
    render(
      <BridgeProvider>
        <Seed />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    const newConversation = screen.getByRole("button", { name: "新建对话" });
    expect(newConversation).toHaveClass("h-10", "w-full");
    expect(within(newConversation).getByText("新对话")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开本子 高等数学" })).toHaveClass("h-9");

    const shortcuts = screen.getByRole("navigation", { name: "工作台快捷入口" });
    for (const button of within(shortcuts).getAllByRole("button")) {
      expect(button).toHaveClass("h-[42px]");
    }
  });

  it("renames, archives and restores a managed notebook without presenting a delete action", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(
      <BridgeProvider>
        <Seed onReady={(stores) => {
          stores.notebooks.setState({
            renameNotebook: async (id, title) => {
              stores.notebooks.setState((state) => ({
                list: state.list.map((book) => book.id === id ? { ...book, title } : book),
              }));
              return true;
            },
            setNotebookArchived: async (id, archived) => {
              stores.notebooks.setState((state) => ({
                list: state.list.map((book) => book.id === id ? { ...book, archived } : book),
                activeId: archived && state.activeId === id ? null : state.activeId,
              }));
              return true;
            },
          });
        }} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "高等数学本子菜单" }));
    expect(screen.queryByRole("menuitem", { name: /删除/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "重命名显示名称" }));
    const input = screen.getByLabelText("显示名称");
    await user.clear(input);
    await user.type(input, "微积分复习本");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("button", { name: "打开本子 微积分复习本" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "微积分复习本本子菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "归档本子" }));
    expect(screen.queryByRole("button", { name: "打开本子 微积分复习本" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "已归档本子 1" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    await user.click(screen.getByRole("button", { name: "恢复本子 微积分复习本" }));
    expect(await screen.findByRole("button", { name: "打开本子 微积分复习本" })).toBeInTheDocument();

    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: originalScrollIntoView });
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    }
  });

  it("removes an external folder only from Leemo through an explicit menu action", async () => {
    const user = userEvent.setup();
    const forget = vi.fn(async () => true);
    render(
      <BridgeProvider>
        <Seed onReady={(stores) => {
          const workspaces = stores.workspaces;
          if (!workspaces) return;
          workspaces.setState({
            list: [
              ...workspaces.getState().list,
              {
                id: "workspace-external",
                name: "毕业设计",
                displayPath: "D:/毕业设计",
                kind: "external",
                available: true,
                lastOpenedAt: 1,
                archived: false,
              },
            ],
            forget,
          });
        }} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "毕业设计本子菜单" }));
    expect(screen.getByRole("menuitem", { name: "从 Leemo 移除" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /删除文件/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "从 Leemo 移除" }));
    expect(forget).toHaveBeenCalledWith("workspace-external");
  });

  it("switches to a notebook and restores its scope session", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Seed onReady={(value) => { stores = value; }} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开本子 求职" }));
    expect(stores.notebooks.getState().activeId).toBe("career");
    expect(stores.conversations.getState().activeId).toBe("career-chat");
    expect(stores.ui.getState().activeScopeKey).toBe("notebook:career");
  });

  it("leaves the active notebook before opening a global momo conversation", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Seed onReady={(value) => { stores = value; }} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "和 momo 讨论方向" }));

    await waitFor(() => {
      expect(stores.notebooks.getState().activeId).toBeNull();
      expect(stores.conversations.getState().activeId).toBe("global-chat");
      expect(stores.ui.getState().activeScopeKey).toBe("global");
    });
  });

  it("creates from the global momo section outside the active notebook", async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn().mockResolvedValue(undefined);
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Seed onReady={(value) => { stores = value; }} />
        <WorkbenchSidebar onNewConversation={onNewConversation} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "新建全局对话" }));

    await waitFor(() => {
      expect(stores.notebooks.getState().activeId).toBeNull();
      expect(stores.ui.getState().activeScopeKey).toBe("global");
      expect(onNewConversation).toHaveBeenCalledWith({
        workspaceId: HOME_WORKSPACE_ID,
        bookId: null,
      });
    });
  });

  it("does not switch scopes while a Markdown draft is unresolved", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    const workspace: WorkspaceClient = {
      listNotebooks: async () => ({
        root: "C:/Leemo",
        notebooks: [
          { id: "math", title: "高等数学", dir: "C:/Leemo/高等数学", color: "blue", hasMemory: false },
          { id: "career", title: "求职", dir: "C:/Leemo/求职", color: "green", hasMemory: false },
        ],
      }),
      touchWorkspace: async (id: string) => ({ id, name: id, displayPath: `C:/${id}`, kind: "external", available: true, lastOpenedAt: 1 }),
      readTree: async () => [],
      readPreview: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
      writeMarkdownFile: async () => ({ kind: "text", text: "", truncated: false, size: 0 }),
    } as unknown as WorkspaceClient;
    render(
      <BridgeProvider workspace={workspace}>
        <Seed onReady={(value) => { stores = value; }} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );
    act(() => {
      stores.previewContent.getState().beginEdit("notes.md", "old");
      stores.previewContent.getState().updateDraft("notes.md", "new");
    });
    await user.click(screen.getByRole("button", { name: "打开本子 求职" }));
    expect(screen.getByRole("dialog", { name: "有未保存的修改" })).toBeInTheDocument();
    expect(stores.notebooks.getState().activeId).toBe("math");
    await user.click(screen.getByRole("button", { name: "不保存并继续" }));
    expect(stores.notebooks.getState().activeId).toBe("career");
  });

  it("supports the collapsed rail without shrinking labels into unreadable text", async () => {
    render(
      <BridgeProvider>
        <Seed onReady={(stores) => stores.ui.getState().setWorkbenchSidebarPreference("compact")} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );
    const sidebar = screen.getByTestId("workbench-sidebar");
    expect(sidebar).toHaveStyle({ width: "52px" });
    expect(within(sidebar).queryByText("Leemo")).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("button", { name: "展开侧栏" })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "新建对话" })).toBeInTheDocument();
    expect(within(sidebar).queryByRole("navigation", { name: "模式切换" })).not.toBeInTheDocument();
  });

  it("uses the approved 看板 / 技能 / 定时 / 设置 shortcut row", () => {
    render(
      <BridgeProvider>
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    const shortcuts = screen.getByRole("navigation", { name: "工作台快捷入口" });
    expect(shortcuts).toHaveClass("grid", "grid-cols-4");
    expect(within(shortcuts).queryByRole("button", { name: "英语学习" })).not.toBeInTheDocument();
    expect(within(shortcuts).getByRole("button", { name: "看板" })).toHaveTextContent("看板");
    expect(within(shortcuts).getByRole("button", { name: "技能" })).toHaveTextContent("技能");
    expect(within(shortcuts).getByRole("button", { name: "定时任务" })).toHaveTextContent("定时");
    expect(within(shortcuts).queryByRole("button", { name: "成果" })).not.toBeInTheDocument();
    expect(within(shortcuts).getByRole("button", { name: "设置" })).toHaveTextContent("设置");
    expect(within(shortcuts).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "看板",
      "技能",
      "定时任务",
      "设置",
    ]);
  });

  it("keeps the shared mode switcher out of the sidebar at the minimum width", () => {
    render(
      <BridgeProvider>
        <Seed onReady={(stores) => stores.ui.setState({ workbenchSidebarWidth: 252 })} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    expect(screen.queryByRole("navigation", { name: "模式切换" })).not.toBeInTheDocument();
  });

  it("keeps the sidebar width bounded and offers a keyboard reset", () => {
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Seed onReady={(value) => { stores = value; }} />
        <WorkbenchSidebar onNewConversation={() => {}} />
      </BridgeProvider>,
    );

    const separator = screen.getByRole("separator", { name: "调整侧栏宽度" });
    act(() => {
      fireEvent.keyDown(separator, { key: "ArrowRight" });
    });
    expect(stores.ui.getState().workbenchSidebarWidth).toBe(296);
    act(() => fireEvent.doubleClick(separator));
    expect(stores.ui.getState().workbenchSidebarWidth).toBe(288);
  });
});
