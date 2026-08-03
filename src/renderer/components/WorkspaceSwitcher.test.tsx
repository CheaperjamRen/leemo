import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useContext } from "react";
import type { WorkspaceClient, WorkspaceRootInfo } from "../workspace/client";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

const HOME: WorkspaceRootInfo = {
  id: "leemo-home",
  name: "Leemo",
  displayPath: "C:/Users/me/Leemo",
  kind: "home",
  available: true,
  lastOpenedAt: 0,
};
const PROJECT: WorkspaceRootInfo = {
  id: "workspace-123",
  name: "毕业设计",
  displayPath: "D:/Projects/毕业设计",
  kind: "external",
  available: true,
  lastOpenedAt: 20,
};

function workspace(over: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    listWorkspaces: async () => [HOME, PROJECT],
    pickWorkspace: async () => PROJECT,
    touchWorkspace: async (id) => id === HOME.id ? HOME : PROJECT,
    forgetWorkspace: async () => true,
    listNotebooks: async () => ({ root: HOME.displayPath, notebooks: [] }),
    createNotebook: async () => { throw new Error("unused"); },
    ensureStarterNotebook: async () => { throw new Error("unused"); },
    readTree: async () => [],
    dropFiles: async () => [],
    moveFile: async () => { throw new Error("unused"); },
    suggestNotebook: async () => null,
    readTextFile: async () => "",
    readPreview: async () => ({ kind: "unpreviewable", reason: "unused", size: 0 }),
    reveal: async () => {},
    pathForFile: () => "",
    ...over,
  };
}

function CaptureStores({ onReady }: { onReady: (stores: BridgeStores) => void }): null {
  onReady(useContext(BridgeContext) as BridgeStores);
  return null;
}

describe("WorkspaceSwitcher", () => {
  it("presents managed folders and opened folders as one book list", async () => {
    render(
      <BridgeProvider workspace={workspace({
        listNotebooks: async () => ({
          root: HOME.displayPath,
          notebooks: [{
            id: "高等数学",
            title: "高等数学",
            dir: `${HOME.displayPath}/高等数学`,
            color: "blue",
            hasMemory: true,
          }],
        }),
      })}>
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );

    const trigger = await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" });
    await userEvent.click(trigger);

    expect(screen.getByRole("menu", { name: "本子" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开本子 高等数学" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开本子 毕业设计" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建本子" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开已有文件夹" })).toBeInTheDocument();
    expect(screen.queryByText("工作区")).not.toBeInTheDocument();
  });

  it("opens a managed book and activates only that book's conversation scope", async () => {
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({
        listNotebooks: async () => ({
          root: HOME.displayPath,
          notebooks: [{
            id: "高等数学",
            title: "高等数学",
            dir: `${HOME.displayPath}/高等数学`,
            color: "blue",
            hasMemory: false,
          }],
        }),
      })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(stores.notebooks.getState().list).toHaveLength(1));
    act(() => stores.conversations.setState({
      byId: {
        global: {
          id: "global", title: "全局对话", titleManuallyUpdated: true, bookId: null,
          source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
          createdAt: 1, lastActivityAt: 3, unread: false,
        },
        calculus: {
          id: "calculus", title: "微积分复习", titleManuallyUpdated: true, bookId: "高等数学",
          source: "workbench", providerId: "deepseek", modelId: "deepseek-chat",
          createdAt: 1, lastActivityAt: 2, unread: false,
        },
      },
      order: ["global", "calculus"],
      activeId: "global",
      timelines: { global: [], calculus: [] },
      runIds: { global: null, calculus: null },
    }));

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 高等数学" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 高等数学" })).toBeInTheDocument());
    expect(stores.notebooks.getState().activeId).toBe("高等数学");
    expect(stores.conversations.getState().activeId).toBe("calculus");
  });

  it("creates a managed book from the same menu and enters it immediately", async () => {
    const createNotebook = vi.fn(async (title: string) => ({
      id: title,
      title,
      dir: `${HOME.displayPath}/${title}`,
      color: "blue" as const,
      hasMemory: false,
    }));
    render(
      <BridgeProvider workspace={workspace({ createNotebook })}>
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "新建本子" }));
    await userEvent.type(screen.getByRole("textbox", { name: "新本子名称" }), "英语学习");
    await userEvent.click(screen.getByRole("button", { name: "创建本子" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 英语学习" })).toBeInTheDocument());
    expect(createNotebook).toHaveBeenCalledWith("英语学习");
  });

  it("shows the current workspace, recent folders and native open-folder command", async () => {
    render(<BridgeProvider workspace={workspace()}><WorkspaceSwitcher /></BridgeProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    expect(screen.getByRole("menu", { name: "本子" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开本子 毕业设计" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开已有文件夹" })).toBeInTheDocument();
    expect(screen.getByText("D:/Projects/毕业设计")).toBeInTheDocument();
  });

  it("switches by opaque id and refreshes the selected tree", async () => {
    const touchWorkspace = vi.fn(async () => PROJECT);
    const readTree = vi.fn(async () => []);
    render(
      <BridgeProvider workspace={workspace({ touchWorkspace, readTree })}>
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 毕业设计" })).toBeInTheDocument());
    expect(touchWorkspace).toHaveBeenCalledWith(PROJECT.id);
    await waitFor(() => expect(readTree).toHaveBeenLastCalledWith(PROJECT.id));
  });

  it("keeps a dirty preview visible until the user decides how to switch", async () => {
    const touchWorkspace = vi.fn(async () => PROJECT);
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({ touchWorkspace })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => {
      stores.previewContent.getState().beginEdit("notes.md", "old");
      stores.previewContent.getState().updateDraft("notes.md", "my draft");
    });

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));

    expect(screen.getByRole("dialog", { name: "有未保存的修改" })).toBeInTheDocument();
    expect(touchWorkspace).not.toHaveBeenCalled();
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]?.text).toBe("my draft");

    await userEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.queryByRole("dialog", { name: "有未保存的修改" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument();
  });

  it("can save all dirty markdown before switching and drops stale clean drafts", async () => {
    const writeMarkdownFile = vi.fn(async (_path: string, text: string) => ({
      kind: "text" as const,
      text,
      truncated: false,
      size: text.length,
    }));
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({ writeMarkdownFile })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => {
      stores.previewContent.getState().beginEdit("notes.md", "old");
      stores.previewContent.getState().updateDraft("notes.md", "saved draft");
    });

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));
    await userEvent.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 毕业设计" })).toBeInTheDocument());
    expect(writeMarkdownFile).toHaveBeenCalledWith("notes.md", "saved draft", "old", HOME.id);
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]).toBeUndefined();
  });

  it("does not open a different folder until a dirty draft is resolved", async () => {
    const pickWorkspace = vi.fn(async () => PROJECT);
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({ pickWorkspace })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => {
      stores.previewContent.getState().beginEdit("notes.md", "old");
      stores.previewContent.getState().updateDraft("notes.md", "throw away");
    });

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开已有文件夹" }));
    expect(pickWorkspace).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "不保存并继续" }));
    await waitFor(() => expect(pickWorkspace).toHaveBeenCalledTimes(1));
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]).toBeUndefined();
  });

  it("keeps the draft when the user cancels the folder picker after choosing discard", async () => {
    const pickWorkspace = vi.fn(async () => null);
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({ pickWorkspace })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => {
      stores.previewContent.getState().beginEdit("notes.md", "old");
      stores.previewContent.getState().updateDraft("notes.md", "still here");
    });

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开已有文件夹" }));
    await userEvent.click(screen.getByRole("button", { name: "不保存并继续" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "有未保存的修改" })).not.toBeInTheDocument());
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]?.text).toBe("still here");
  });

  it("cleans a late draft only after a slow workspace switch succeeds", async () => {
    let finishTouch!: () => void;
    const touchWorkspace = vi.fn(() => new Promise<WorkspaceRootInfo>((resolve) => {
      finishTouch = () => resolve(PROJECT);
    }));
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({ touchWorkspace })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => stores.previewContent.getState().beginEdit("notes.md", "old"));

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));
    expect(screen.getByRole("status", { name: "正在切换本子" })).toBeInTheDocument();
    expect(stores.ui.getState().workspaceTransitioning).toBe(true);

    act(() => stores.previewContent.getState().updateDraft("notes.md", "late change"));
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]?.status).toBe("dirty");
    act(() => finishTouch());

    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 毕业设计" })).toBeInTheDocument());
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]).toBeUndefined();
    expect(stores.ui.getState().workspaceTransitioning).toBe(false);
  });

  it("does not remove the active folder while its draft is unresolved", async () => {
    const forgetWorkspace = vi.fn(async () => true);
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace({ forgetWorkspace })}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => {
      stores.workspaces?.setState({ activeId: PROJECT.id });
      stores.previewContent.getState().beginEdit("notes.md", "old");
      stores.previewContent.getState().updateDraft("notes.md", "keep me");
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 毕业设计" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 毕业设计" }));
    await userEvent.click(screen.getByRole("button", { name: "从本子列表移除 毕业设计" }));

    expect(screen.getByRole("dialog", { name: "有未保存的修改" })).toBeInTheDocument();
    expect(forgetWorkspace).not.toHaveBeenCalled();
    expect(stores.previewContent.getState().drafts[`${PROJECT.id}\u0000notes.md`]?.text).toBe("keep me");
  });

  it("discards a clean editor snapshot on a direct workspace switch", async () => {
    let stores!: BridgeStores;
    render(
      <BridgeProvider workspace={workspace()}>
        <CaptureStores onReady={(value) => { stores = value; }} />
        <WorkspaceSwitcher />
      </BridgeProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" })).toBeInTheDocument());
    act(() => stores.previewContent.getState().beginEdit("notes.md", "old"));

    await userEvent.click(screen.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开本子 毕业设计" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "选择本子，当前 毕业设计" })).toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "有未保存的修改" })).not.toBeInTheDocument();
    expect(stores.previewContent.getState().drafts["leemo-home\u0000notes.md"]).toBeUndefined();
  });

  it("shows one quiet .leemo notice after opening a new folder", async () => {
    render(<BridgeProvider workspace={workspace()}><WorkspaceSwitcher /></BridgeProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开已有文件夹" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已作为本子打开。对话和本地记忆会跟着这个文件夹。",
    );
  });

  it("keeps a missing recent folder visible but disabled", async () => {
    const missing = { ...PROJECT, available: false };
    render(<BridgeProvider workspace={workspace({ listWorkspaces: async () => [HOME, missing] })}><WorkspaceSwitcher /></BridgeProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    expect(screen.getByRole("menuitem", { name: "打开本子 毕业设计" })).toBeDisabled();
    expect(screen.getByText("找不到文件夹")).toBeInTheDocument();
  });

  it("removes a recent entry with an icon action and does not claim to delete files", async () => {
    const forgetWorkspace = vi.fn(async () => true);
    render(<BridgeProvider workspace={workspace({ forgetWorkspace })}><WorkspaceSwitcher /></BridgeProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.click(screen.getByRole("button", { name: "从本子列表移除 毕业设计" }));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "打开本子 毕业设计" })).not.toBeInTheDocument());
    expect(forgetWorkspace).toHaveBeenCalledWith(PROJECT.id);
    expect(document.body.textContent).not.toContain("删除文件");
  });

  it("closes the menu with Escape", async () => {
    render(<BridgeProvider workspace={workspace()}><WorkspaceSwitcher /></BridgeProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "选择本子，当前 Leemo 工作台" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "本子" })).not.toBeInTheDocument();
  });
});
