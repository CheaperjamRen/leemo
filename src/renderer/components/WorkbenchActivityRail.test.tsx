import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WorkOverviewUserCorrection } from "../../bridge/work-overview";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import type { TimelineItem } from "../stores/message-model";
import WorkbenchActivityRail from "./WorkbenchActivityRail";

function Capture({ onReady }: { onReady: (stores: BridgeStores) => void }): null {
  onReady(useContext(BridgeContext) as BridgeStores);
  return null;
}

function semanticOverview(
  conversationId: string,
  objective: string,
  options: {
    runId?: string;
    phase?: string;
    nextKnown?: string[];
    completed?: Array<{ evidenceId: string; text: string; basisEventIds: string[] }>;
  } = {},
): Extract<TimelineItem, { kind: "overview" }> {
  const runId = options.runId ?? `run-${conversationId}`;
  const toolUseId = `overview-${conversationId}`;
  return {
    kind: "overview",
    id: toolUseId,
    runId,
    toolUseId,
    createdAt: 100,
    overview: {
      revision: 1,
      scopeConversationId: conversationId,
      sourceRunId: runId,
      sourceToolUseId: toolUseId,
      updatedAt: 100,
      updateReason: "run-completed",
      basisEventIds: [runId, toolUseId],
      actor: "momo",
      objective,
      objectiveSource: "semantic",
      successCriteria: [],
      ...(options.phase ? { currentPhase: options.phase } : {}),
      nextKnown: options.nextKnown ?? [],
      blockers: [],
      decisions: [],
      completedHighlights: options.completed ?? [],
      fieldAuthority: { objective: "momo" },
    },
  };
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

  it("preserves docked, focused, and restored overview presentation", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-presentation", "docked");
    await user.click(screen.getByRole("button", { name: "展开面板" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-presentation", "focused");
    await user.click(screen.getByRole("button", { name: "收起面板" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveAttribute("data-presentation", "docked");
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

  it("opens the global Explorer by default while keeping the conversation file list", async () => {
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
    expect(screen.getByRole("button", { name: "工作区文件" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(screen.getByText("不相关.md")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "本次文件" }));
    expect(within(screen.getByTestId("conversation-files-panel")).getByText("本次文件")).toBeInTheDocument();
    expect(screen.getByText("这次的资料.pdf")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
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

  it("opens and switches overview scopes locally while keeping every projection source-scoped", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );

    const refreshWorkOverview = vi.fn(async () => undefined);
    const correctWorkOverview = vi.fn(async (_conversationId: string, _correction: WorkOverviewUserCorrection) => undefined);
    const send = vi.fn(async () => undefined);
    act(() => {
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
          foreign: {
            id: "foreign", title: "英语复习", titleManuallyUpdated: true, bookId: "english", workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 3, lastActivityAt: 4, unread: false,
          },
        },
        order: ["active", "waiting", "foreign"], openTabs: ["active", "waiting"], activeId: "active",
        timelines: {
          active: [
            semanticOverview("active", "只整理这次会话的高频错题", {
              runId: "run-active",
              phase: "归纳错题类型",
              completed: [{ evidenceId: "answer-active", text: "资料范围已确认", basisEventIds: ["answer-active"] }],
            }),
            {
              kind: "plan", id: "plan", runId: "run-active", toolUseId: "plan",
              todos: [{ text: "归纳高频错题", status: "active" }],
            },
          ],
          waiting: [semanticOverview("waiting", "补齐第四章错题资料", { runId: "run-waiting", nextKnown: ["等待资料范围确认"] })],
          foreign: [semanticOverview("foreign", "整理英语听力材料")],
        },
        runIds: { active: null, waiting: null, foreign: null },
        refreshWorkOverview,
        correctWorkOverview,
        send,
      });
      stores.approvals.setState({
        pendingByConversation: {
          waiting: {
            kind: "question", id: "question", conversationId: "waiting", runId: "run-waiting", receivedAt: 10,
            questions: [{ question: "第 4 章资料缺失，是否先按现有内容继续？", options: [{ label: "继续" }] }],
          },
        },
        resolvedByRun: {
          "run-active": [{
            kind: "question", id: "answer-active", runId: "run-active",
            questions: [{ question: "资料范围？", options: [{ label: "现有资料" }] }],
            items: [{ selected: ["现有资料"] }],
          }],
        },
      });
      stores.notebooks.setState({
        list: [{ id: "math", title: "高等数学", dir: "E:/Leemo/math", color: "blue", hasMemory: false }],
        activeId: "math",
      });
      stores.ui.getState().activateWorkbenchScope("notebook:math");
      stores.ui.getState().setWorkbenchSidebarPreference("pinned");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByTestId("workbench-tool-panel")).toHaveStyle({ width: "480px" });
    expect(screen.getByRole("button", { name: "本次会话" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("只整理这次会话的高频错题")).toBeInTheDocument();
    expect(screen.getByText("资料范围已确认")).toBeInTheDocument();
    expect(screen.queryByText("补齐第四章错题资料")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "当前本子" }));
    expect(screen.getByText("只整理这次会话的高频错题")).toBeInTheDocument();
    expect(screen.getByText("补齐第四章错题资料")).toBeInTheDocument();
    expect(screen.queryByText("整理英语听力材料")).not.toBeInTheDocument();
    expect(refreshWorkOverview).not.toHaveBeenCalled();
    expect(correctWorkOverview).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "打开会话 错题归纳" }));
    expect(stores.conversations.getState().activeId).toBe("waiting");
    expect(stores.ui.getState().scopeSessions["notebook:math"]?.activeConversationId).toBe("waiting");
    expect(screen.queryByTestId("workbench-tool-panel")).not.toBeInTheDocument();
  });

  it("routes refresh, local correction, and artifact opening through the active source only", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );
    const refreshWorkOverview = vi.fn(async () => undefined);
    const correctWorkOverview = vi.fn(async (_conversationId: string, _correction: WorkOverviewUserCorrection) => undefined);
    const send = vi.fn(async () => undefined);
    act(() => {
      stores.conversations.setState({
        byId: {
          active: {
            id: "active", title: "整理高数复习重点", titleManuallyUpdated: true, bookId: "math", workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
          },
        },
        order: ["active"], openTabs: ["active"], activeId: "active",
        timelines: { active: [semanticOverview("active", "整理高数复习重点", { runId: "run-active" })] },
        runIds: { active: null },
        refreshWorkOverview,
        correctWorkOverview,
        send,
      });
      stores.artifacts.setState({
        entries: [{
          id: "review", kind: "file", path: "math/三天复习计划.md", title: "三天复习计划.md", bookId: "math",
          workspaceId: "leemo-home", sourceConversationId: "active", sourceRunId: "run-active", createdAt: 100, escaped: false,
        }],
      });
      stores.ui.getState().activateWorkbenchScope("notebook:math");
      stores.ui.getState().setWorkbenchSidebarPreference("pinned");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "更新概览" }));
    expect(refreshWorkOverview).toHaveBeenCalledTimes(1);
    expect(refreshWorkOverview).toHaveBeenCalledWith("active");

    await user.click(screen.getByRole("button", { name: "概览操作" }));
    await user.click(screen.getByRole("button", { name: "编辑工作目标" }));
    await user.clear(screen.getByRole("textbox", { name: "工作目标" }));
    await user.type(screen.getByRole("textbox", { name: "工作目标" }), "重新固定复习范围");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(correctWorkOverview).toHaveBeenCalledTimes(1);
    expect(correctWorkOverview).toHaveBeenCalledWith("active", { objective: "重新固定复习范围", clearFields: ["successCriteria"] });
    expect(send).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "打开成果 三天复习计划.md" }));
    expect(stores.ui.getState().previewActivePath).toBe("math/三天复习计划.md");
    expect(screen.queryByTestId("workbench-tool-panel")).not.toBeInTheDocument();
  });

  it("retains an empty AskUser interaction and blocks refresh after the run id clears", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );
    const refreshWorkOverview = vi.fn(async () => undefined);
    act(() => {
      stores.conversations.setState({
        byId: {
          active: {
            id: "active", title: "等待选择的整理", titleManuallyUpdated: true, bookId: null, workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
          },
        },
        order: ["active"], openTabs: ["active"], activeId: "active",
        timelines: { active: [semanticOverview("active", "等待选择的整理", { runId: "run-active" })] },
        runIds: { active: null },
        refreshWorkOverview,
      });
      stores.approvals.setState({
        pendingByConversation: {
          active: {
            kind: "question", id: "empty-question", conversationId: "active", runId: "run-active", receivedAt: 10,
            questions: [],
          },
        },
      });
      stores.ui.getState().activateWorkbenchScope("global");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByText("等待你的选择")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    const refreshButton = screen.getByRole("button", { name: "更新概览" });
    expect(refreshButton).toBeDisabled();
    await user.click(refreshButton);
    expect(refreshWorkOverview).not.toHaveBeenCalled();
  });

  it("retains an empty approval interaction and blocks refresh while permission is pending", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );
    const refreshWorkOverview = vi.fn(async () => undefined);
    act(() => {
      stores.conversations.setState({
        byId: {
          active: {
            id: "active", title: "等待权限的整理", titleManuallyUpdated: true, bookId: null, workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
          },
        },
        order: ["active"], openTabs: ["active"], activeId: "active",
        timelines: { active: [semanticOverview("active", "等待权限的整理", { runId: "run-active" })] },
        runIds: { active: null },
        refreshWorkOverview,
      });
      stores.approvals.setState({
        pendingByConversation: {
          active: {
            kind: "approval", id: "empty-approval", conversationId: "active", runId: "run-active", receivedAt: 10,
            toolName: "Bash", inputSummary: "   ", risk: "moderate",
          },
        },
      });
      stores.ui.getState().activateWorkbenchScope("global");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByText("等待权限确认")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    const refreshButton = screen.getByRole("button", { name: "更新概览" });
    expect(refreshButton).toBeDisabled();
    await user.click(refreshButton);
    expect(refreshWorkOverview).not.toHaveBeenCalled();
  });

  it("keeps refresh disabled for a real active run with a pending interaction", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );
    const refreshWorkOverview = vi.fn(async () => undefined);
    act(() => {
      stores.conversations.setState({
        byId: {
          active: {
            id: "active", title: "运行中的整理", titleManuallyUpdated: true, bookId: null, workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
          },
        },
        order: ["active"], openTabs: ["active"], activeId: "active",
        timelines: { active: [semanticOverview("active", "运行中的整理", { runId: "run-active" })] },
        runIds: { active: "run-active" },
        refreshWorkOverview,
      });
      stores.approvals.setState({
        pendingByConversation: {
          active: {
            kind: "approval", id: "approval", conversationId: "active", runId: "run-active", receivedAt: 10,
            toolName: "Bash", inputSummary: "读取目录", risk: "moderate",
          },
        },
      });
      stores.ui.getState().activateWorkbenchScope("global");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    expect(screen.getByText("读取目录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新概览" })).toBeDisabled();
    expect(refreshWorkOverview).not.toHaveBeenCalled();

    act(() => {
      stores.approvals.setState({
        pendingByConversation: {
          active: {
            kind: "question", id: "question", conversationId: "active", runId: "run-active", receivedAt: 11,
            questions: [{ question: "要继续整理下一章吗？", options: [{ label: "继续" }] }],
          },
        },
      });
    });
    expect(screen.getByText("要继续整理下一章吗？")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新概览" })).toBeDisabled();
  });

  it("renders local scope facts without an active conversation and disables semantic refresh", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <Capture onReady={(value) => { stores = value; }} />
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );
    const refreshWorkOverview = vi.fn(async () => undefined);
    act(() => {
      stores.conversations.setState({
        byId: {
          history: {
            id: "history", title: "历史会话", titleManuallyUpdated: true, bookId: null, workspaceId: "leemo-home",
            source: "workbench", providerId: "deepseek", modelId: "deepseek-chat", createdAt: 1, lastActivityAt: 2, unread: false,
          },
        },
        order: ["history"], openTabs: [], activeId: null,
        timelines: { history: [semanticOverview("history", "本地仍可读取的目标")] },
        runIds: { history: null },
        refreshWorkOverview,
      });
      stores.ui.getState().activateWorkbenchScope("global");
    });

    await user.click(screen.getByRole("button", { name: "概览" }));
    expect(screen.getByText("本地仍可读取的目标")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本次会话" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "概览操作" }));
    expect(screen.getByRole("button", { name: "更新概览" })).toBeDisabled();
    expect(refreshWorkOverview).not.toHaveBeenCalled();
  });

  it("keeps the existing search branch mounted after the overview integration", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <WorkbenchActivityRail shellWidth={1440} />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByTestId("embedded-search-page")).toBeInTheDocument();
  });
});
