import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it } from "vitest";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import WorkbenchActivityRail from "./WorkbenchActivityRail";
import { startStore } from "../stores/start";

function Capture({ onReady }: { onReady: (stores: BridgeStores) => void }): null {
  onReady(useContext(BridgeContext) as BridgeStores);
  return null;
}

describe("WorkbenchActivityRail", () => {
  it("keeps files, overview, and search mutually exclusive in the right slot", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );

    const rail = screen.getByRole("toolbar", { name: "工作工具" });
    expect(rail).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "概览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();

    act(() => {
      stores.ui.getState().setWorkbenchSidebarPreference("pinned");
      stores.conversations.setState({
        byId: {
          overview: {
            id: "overview", title: "空间契约", titleManuallyUpdated: true, bookId: null, workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 1, unread: false,
          },
        },
        order: ["overview"], openTabs: ["overview"], activeId: "overview",
        timelines: { overview: [{ kind: "plan", id: "plan", runId: "run", toolUseId: "plan", todos: [{ text: "检查空间契约", status: "active" }] }] },
        runIds: { overview: "run" },
      });
    });

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-tool", "files");
    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-tool", "overview");
    expect(screen.getByText("空间契约")).toBeInTheDocument();
    expect(screen.getAllByText("检查空间契约")).toHaveLength(2);
    expect(stores.ui.getState().view).toBe("chat");
    expect(stores.ui.getState().workbenchSidebarPreference).toBe("pinned");
    expect(screen.getByRole("button", { name: "概览" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.queryByTestId("workbench-tool-panel")).not.toBeInTheDocument();
  });

  it("opens as an overlay when docking would crush the central stage", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchActivityRail shellWidth={960} />
      </BridgeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-presentation", "overlay");
    expect(screen.getByTestId("workbench-tool-backdrop")).toHaveAttribute("data-dimming", "false");
  });

  it("opens search at the approved readable panel width on a desktop", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveStyle({ width: "480px" });
  });

  it("uses the global conversation file list instead of the hidden home tree", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );
    act(() => {
      stores.conversations.setState({
        byId: {
          global: {
            id: "global", title: "临时讨论", titleManuallyUpdated: true, bookId: null, workspaceId: "leemo-home",
            source: "buddy", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 1, unread: false,
          },
        },
        order: ["global"], activeId: "global",
        timelines: { global: [{
          kind: "text", id: "u", runId: "r", role: "user", text: "看看", streaming: false,
          attachments: [{ name: "这次的资料.pdf", size: 20, sourceKind: "local" }],
        }] },
        runIds: { global: null },
      });
      stores.fileTree.setState({ roots: [{ path: "默认工作区/不相关.md", name: "不相关.md", kind: "file", bookId: null }] });
      stores.ui.getState().activateWorkbenchScope("global");
    });

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByText("本次文件")).toBeInTheDocument();
    expect(screen.getByText("这次的资料.pdf")).toBeInTheDocument();
    expect(screen.queryByText("不相关.md")).not.toBeInTheDocument();
  });

  it("reveals a file after closing an overlay panel on a narrow workbench", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={960} />
      </BridgeProvider>,
    );
    act(() => {
      stores.notebooks.setState({
        list: [{ id: "课程", title: "课程", dir: "C:/Leemo/课程", color: "blue", hasMemory: false }],
        activeId: "课程",
      });
      stores.fileTree.setState({ roots: [{ path: "课程/笔记.md", name: "笔记.md", kind: "file", bookId: "课程" }] });
      stores.ui.getState().activateWorkbenchScope("notebook:课程");
    });

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-presentation", "overlay");
    await user.click(screen.getByText("笔记.md"));
    expect(stores.ui.getState().previewActivePath).toBe("课程/笔记.md");
    expect(screen.queryByTestId("workbench-tool-panel")).not.toBeInTheDocument();
  });

  it("builds notebook and conversation overview scopes and wires artifacts and the full board", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );

    act(() => {
      stores.notebooks.setState({
        list: [{ id: "math", title: "高等数学", dir: "E:/Leemo/math", color: "blue", hasMemory: false }],
        activeId: "math",
      });
      stores.conversations.setState({
        byId: {
          active: {
            id: "active", title: "整理高数复习重点", titleManuallyUpdated: true, bookId: "math", workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
          },
          waiting: {
            id: "waiting", title: "错题归纳", titleManuallyUpdated: true, bookId: "math", workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 2, lastActivityAt: 3, unread: false,
          },
        },
        order: ["active", "waiting"], openTabs: ["active", "waiting"], activeId: "active",
        timelines: {
          active: [
            {
              kind: "overview", id: "active-overview", runId: "run", toolUseId: "overview", createdAt: 100,
              overview: { theme: "整理高数复习重点", summary: "只汇总这次对话。" },
            },
            {
              kind: "plan", id: "plan", runId: "run", toolUseId: "plan",
              todos: [{ text: "归纳高频错题", status: "active" }],
            },
          ],
          waiting: [{
            kind: "overview", id: "notebook-overview", runId: "old", toolUseId: "overview", createdAt: 200,
            overview: { theme: "高等数学期末复习", summary: "汇总本子里的复习路线。" },
          }],
        },
        runIds: { active: "run", waiting: null },
      });
      stores.approvals.setState({
        pendingByConversation: {
          waiting: {
            kind: "question", id: "question", conversationId: "waiting", runId: "old", receivedAt: 10,
            questions: [{ question: "第 4 章资料缺失，是否先按现有内容继续？", options: [{ label: "继续" }] }],
          },
        },
      });
      stores.artifacts.setState({
        entries: [{
          id: "review", kind: "file", path: "math/三天复习计划.md", title: "三天复习计划.md", bookId: "math",
          workspaceId: "leemo-home", sourceConversationId: "active", sourceRunId: "run", createdAt: 100, escaped: false,
        }],
      });
      stores.ui.getState().activateWorkbenchScope("notebook:math");
      stores.ui.getState().setWorkbenchSidebarPreference("pinned");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveStyle({ width: "480px" });
    expect(screen.getByRole("button", { name: "当前本子" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("高等数学期末复习")).toBeInTheDocument();
    expect(screen.getByText("第 4 章资料缺失，是否先按现有内容继续？")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开待处理 第 4 章资料缺失，是否先按现有内容继续？" }));
    expect(stores.conversations.getState().activeId).toBe("waiting");
    expect(screen.queryByTestId("workbench-tool-panel")).not.toBeInTheDocument();
    act(() => {
      stores.conversations.getState().switchActive("active");
      stores.ui.getState().openScopeConversation("active");
    });
    await user.click(screen.getByRole("button", { name: "概览" }));
    await user.click(screen.getByRole("button", { name: "本次会话" }));
    expect(screen.getByText("整理高数复习重点")).toBeInTheDocument();
    expect(screen.queryByText("高等数学期末复习")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "当前本子" }));
    await user.click(screen.getByRole("button", { name: "打开成果 三天复习计划.md" }));
    expect(stores.ui.getState().previewActivePath).toBe("math/三天复习计划.md");
    expect(screen.queryByTestId("workbench-tool-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "概览" }));
    await user.click(screen.getByRole("button", { name: "打开完整看板" }));
    expect(stores.ui.getState().activeWorkbenchTool).toBeNull();
    expect(stores.settings.getState().surface).toBe("start");
    expect(startStore.getState().destination).toBe("home");
  });
});
