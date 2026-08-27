import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { useContext, useEffect, useState } from "react";
import type { WorkspaceClient } from "../workspace/client";
import userEvent from "@testing-library/user-event";
import { BridgeContext, BridgeProvider, type BridgeStores, useComposerDrafts, useSettings } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import BuddyShell from "./BuddyShell";
import type { BridgeEventEnvelope } from "../../bridge/contract";
import { FixtureBridgeClient } from "../bridge/fixture-client";
import { resolveMomoPersonaText } from "../stores/settings";
import { LEEMO_ASK_USER_TOOL_NAME } from "../bridge/tool-names";
import { EMPTY_COMPOSER_DRAFT } from "../stores/composer-drafts";
import type { PersistenceClient } from "../persistence/client";

type MockedBridgeClient = BridgeClient & { invoke: ReturnType<typeof vi.fn> };

function createBuddyClient(reply = "你好，我在", finishRun = false): MockedBridgeClient {
  let onEvent: ((payload: BridgeEventEnvelope) => void) | undefined;
  let onApproval: ((payload: unknown) => void) | undefined;
  let onAskUser: ((payload: unknown) => void) | undefined;
  let createCount = 0;
  const client = {
    invoke: vi.fn(async (channel: string, request: unknown) => {
      if (channel === "bridge:createConversation") return { conversationId: `conv-${++createCount}` };
      if (channel === "bridge:send") {
        const conversationId = (request as { conversationId: string }).conversationId;
        queueMicrotask(() => {
          onEvent?.({ conversationId, event: { type: "text.final", text: reply } });
          if (finishRun) {
            onEvent?.({
              conversationId,
              event: {
                type: "run.finished",
                subtype: "success",
                isError: false,
                finalText: reply,
                pathAudit: { claimed: [] },
              },
            });
          }
        });
      }
      if (channel === "bridge:approvalDecision") return undefined;
      if (channel === "bridge:askUserAnswer") return undefined;
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    }),
    subscribe: vi.fn((channel: string, callback: (payload: unknown) => void) => {
      if (channel === "bridge:event") onEvent = callback as (payload: BridgeEventEnvelope) => void;
      if (channel === "bridge:approvalRequest") onApproval = callback;
      if (channel === "bridge:askUser") onAskUser = callback;
      return () => {};
    }),
  } as unknown as MockedBridgeClient;
  return client;
}

function renderBuddy(client = createBuddyClient()) {
  return {
    client,
    ...render(<BridgeProvider client={client}><BuddyShell /></BridgeProvider>),
  };
}

function buddyPersistence(overrides: Partial<PersistenceClient> = {}): PersistenceClient {
  return {
    loadAll: vi.fn(async () => ({ conversations: [], wikiEntries: [], settings: {} })),
    saveConversation: vi.fn(async () => {}),
    saveRelationshipChapter: vi.fn(async () => {}),
    moveConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    saveWikiEntry: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    saveComposerDrafts: vi.fn(async () => {}),
    saveGlobalPendingOverview: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Minimal fake of the Workspace surface (轮 3 卡 G). `pathForFile` stands in
 *  for the preload's webUtils.getPathForFile. */
function fakeWorkspace(over: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    listNotebooks: async () => ({ root: "/w/Leemo", notebooks: [] }),
    createNotebook: async (title: string) => ({
      id: title, title, dir: `/w/Leemo/${title}`, color: "blue", hasMemory: false,
    }),
    ensureStarterNotebook: async () => ({
      id: "例：高等数学", title: "例：高等数学", dir: "/w/Leemo/例：高等数学", color: "blue", hasMemory: true,
    }),
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

/** jsdom has no real drag payload, so build the dataTransfer by hand. */
function dropOn(el: Element, files: File[]): void {
  fireEvent.drop(el, { dataTransfer: { files, types: ["Files"] } });
}

describe("BuddyShell", () => {
  it("applies the buddy shell scope and keeps the Leemo identity with every top-bar action", () => {
    const { container } = renderBuddy();

    expect(container.firstElementChild).toHaveAttribute("data-shell", "buddy");
    expect(container.firstElementChild).toHaveStyle({ overflow: "clip" });
    const topBar = screen.getByRole("banner");
    expect(within(topBar).getByText("Leemo")).toBeInTheDocument();
    expect(topBar.querySelector("svg[data-tone='brand']")).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: "历史对话" })).toBeInTheDocument();
    expect(within(topBar).getByRole("navigation", { name: "工作区切换" })).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: "让 momo 认识我" })).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: "回顾今天" })).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: /通知，\d+ 条未读/ })).toBeInTheDocument();
  });

  it("shows momo's greeting on first paint", () => {
    renderBuddy();
    expect(screen.getByText(/今天想从哪儿开始/)).toBeInTheDocument();
  });

  it("keeps the configured default model actionable before the first conversation exists", async () => {
    const client = new FixtureBridgeClient();
    const user = userEvent.setup();
    render(<BridgeProvider client={client}><BuddyShell /></BridgeProvider>);

    const picker = screen.getByRole("button", { name: "切换模型" });
    await user.click(picker);
    const option = await screen.findByRole("button", { name: /^deepseek-chat\b/ });
    await user.click(option);

    await waitFor(() => expect(picker).toHaveTextContent("deepseek-chat"));
  });

  it("keeps the approved compact companion landing hierarchy", () => {
    renderBuddy();

    const landing = screen.getByTestId("buddy-landing");
    expect(within(landing).getByRole("img", { name: "momo 的头像" })).toHaveAttribute("width", "42");

    const relationshipInvite = screen.getByTestId("buddy-relationship-invite");
    expect(within(relationshipInvite).getByText("想让我更懂你一点？")).toBeInTheDocument();
    expect(within(relationshipInvite).getByRole("button", { name: "现在聊聊" })).toBeInTheDocument();
    expect(within(relationshipInvite).getByRole("button", { name: "稍后再说" })).toBeInTheDocument();

    const sceneHints = screen.getByRole("group", { name: "你可以这样开始" });
    expect(within(sceneHints).getByRole("button", { name: "帮我规划今天" })).toBeInTheDocument();
    expect(within(sceneHints).getByRole("button", { name: "继续昨天的复习" })).toBeInTheDocument();
    expect(within(sceneHints).getByRole("button", { name: "随便聊聊" })).toBeInTheDocument();

    const composerDock = screen.getByTestId("buddy-composer-dock");
    expect(within(composerDock).getByTestId("shared-composer")).toBeInTheDocument();
    expect(screen.queryByText("心迹")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /语音|麦克风/u })).not.toBeInTheDocument();
  });

  it("does not invent finished work or deadlines in an empty conversation", () => {
    renderBuddy();
    expect(screen.queryByText(/第五章 · 树与二叉树/)).not.toBeInTheDocument();
    expect(screen.queryByText(/周六 23:59/)).not.toBeInTheDocument();
  });

  it("creates a first buddy conversation before it sends, then renders both user and reply bubbles", async () => {
    const { client } = renderBuddy();
    const input = screen.getByPlaceholderText("输入消息…");
    await userEvent.type(input, "在吗{Enter}");

    expect(await screen.findByText("在吗")).toBeInTheDocument();
    expect(await screen.findByText("你好，我在")).toBeInTheDocument();
    expect(client.invoke.mock.calls.filter(([channel]) =>
      channel === "bridge:createConversation" || channel === "bridge:send"
    )).toEqual([
      // The create request now carries momo's persona context (轮 2 卡 A): the
      // buddy shell runs in 搭子态 with the built-in default card.
      ["bridge:createConversation", {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        purpose: "main",
        mode: "buddy",
        personaText: resolveMomoPersonaText("你是 momo。", "companion"),
        talkStyle: 3,
        // 自动记忆默认开启；本子上下文仍独立保留。
        rememberMode: true,
        // 轮 4「三层开关」: 送的是生效值。默认统筹关 ⇒ 两个都 false。
        webSearchEnabled: false,
        webFetchEnabled: false,
        // 轮 7 A4: 权限策略此前从未过线（设置页整组是死控件）。默认 acceptEdits
        // ＝「写文件不问，跑命令才问」；危险命令缓存默认关。
        permissionMode: "acceptEdits",
        dangerousCommandCaching: false,
        workspaceId: "leemo-home",
      }],
      ["bridge:send", { conversationId: "conv-1", prompt: "在吗", sourceMessageId: "u0" }],
    ]);
  });

  it("enters a new first conversation before send acknowledgement so momo responds immediately", async () => {
    const client = createBuddyClient();
    client.invoke.mockImplementation(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: "conv-immediate" };
      if (channel === "bridge:send") return new Promise(() => undefined);
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    });
    renderBuddy(client);

    const input = screen.getByPlaceholderText("输入消息…");
    fireEvent.change(input, { target: { value: "先帮我看看" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(await screen.findByText("先帮我看看")).toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "momo 已开始处理" })).toBeInTheDocument();
  });

  it("shows starter suggestions only before a task begins", async () => {
    renderBuddy();
    expect(screen.getByText("帮我规划今天")).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "开始整理{Enter}");
    expect(await screen.findByText("开始整理")).toBeInTheDocument();
    expect(screen.queryByText("帮我规划今天")).not.toBeInTheDocument();
    expect(screen.queryByText("继续昨天的复习")).not.toBeInTheDocument();
    expect(screen.queryByText("随便聊聊")).not.toBeInTheDocument();
  });

  it("keeps a calm permanent relationship entry after the first invitation is dismissed", async () => {
    renderBuddy();

    expect(screen.getByText("想让我更懂你一点？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "稍后再说" }));

    expect(screen.queryByText("想让我更懂你一点？")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "让 momo 认识我" })).toBeInTheDocument();
  });

  it("keeps every explicit onboarding episode inside the same relationship conversation", async () => {
    const { client } = renderBuddy(createBuddyClient("那我先从一个轻松的问题开始。", true));

    await userEvent.click(screen.getByRole("button", { name: "让 momo 认识我" }));

    expect(await screen.findByText("和 momo 认识一下")).toBeInTheDocument();
    expect(await screen.findByText("那我先从一个轻松的问题开始。")).toBeInTheDocument();
    const sendRequest = client.invoke.mock.calls.find(([channel]) => channel === "bridge:send")?.[1] as {
      prompt: string;
    };
    expect(sendRequest.prompt).toMatch(/^\/meet-momo\b/u);
    expect(screen.queryByText(/meet-momo/u)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "让 momo 认识我" }));
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(2);
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")
      .map(([, request]) => (request as { conversationId: string }).conversationId))
      .toEqual(["conv-1", "conv-1"]);
  });

  it("reopens the hydrated relationship after restart and starts onboarding only on explicit click", async () => {
    const client = createBuddyClient();

    function SeedHydratedRelationship() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["conv-relationship-existing"]) {
        stores.settings.setState({
          relationshipInviteDismissed: true,
          relationshipConversationId: "conv-relationship-existing",
        });
        stores.conversations.setState({
          byId: {
            "conv-relationship-existing": {
              id: "conv-relationship-existing",
              title: "我们聊过的事",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "buddy",
              providerId: "deepseek",
              modelId: "deepseek-chat",
              createdAt: 1,
              lastActivityAt: 2,
              unread: false,
            },
          },
          order: ["conv-relationship-existing"],
          activeId: null,
          timelines: {
            "conv-relationship-existing": [{
              kind: "text",
              id: "relationship-summary",
              runId: "run-existing",
              role: "momo",
              text: "上次你说想让我更直接一点。",
              streaming: false,
              createdAt: 2,
            }],
          },
          runIds: { "conv-relationship-existing": null },
        });
      }
      return <BuddyShell />;
    }

    render(<BridgeProvider client={client}><SeedHydratedRelationship /></BridgeProvider>);
    expect(await screen.findByTestId("buddy-landing")).toBeInTheDocument();
    expect(screen.queryByText("上次你说想让我更直接一点。")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "让 momo 认识我" }));

    expect(await screen.findByText("上次你说想让我更直接一点。")).toBeInTheDocument();
    const hostClaims = client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation");
    expect(hostClaims).toHaveLength(1);
    expect(hostClaims[0]?.[1]).toEqual(expect.objectContaining({
      conversationId: "conv-relationship-existing",
    }));
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(1);
    expect(client.invoke).toHaveBeenCalledWith("bridge:send", expect.objectContaining({
      conversationId: "conv-relationship-existing",
      prompt: expect.stringMatching(/^\/meet-momo\b/u),
    }));
  });

  it("projects legacy buddy chapters into one relationship stream without leaking workbench tasks", async () => {
    const client = createBuddyClient();

    function SeedRelationshipHistory() {
      const stores = useContext(BridgeContext) as BridgeStores;
      const [ready, setReady] = useState(false);
      useEffect(() => {
        stores.settings.setState({
          relationshipInviteDismissed: true,
          relationshipConversationId: "buddy-current",
        });
        stores.conversations.setState({
          byId: {
            "buddy-old": {
              id: "buddy-old",
              title: "前几天聊到的求职焦虑",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "buddy",
              providerId: "deepseek",
              modelId: "deepseek-chat",
              createdAt: 1,
              lastActivityAt: 2,
              unread: false,
            },
            "buddy-current": {
              id: "buddy-current",
              title: "刚刚想到的一件事",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "buddy",
              providerId: "deepseek",
              modelId: "deepseek-chat",
              createdAt: 3,
              lastActivityAt: 4,
              unread: false,
            },
            "workbench-task": {
              id: "workbench-task",
              title: "整理项目代码",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "workbench",
              providerId: "deepseek",
              modelId: "deepseek-chat",
              createdAt: 5,
              lastActivityAt: 6,
              unread: false,
            },
          },
          order: ["workbench-task", "buddy-current", "buddy-old"],
          activeId: null,
          timelines: {
            "buddy-old": [{
              kind: "text",
              id: "old-message",
              runId: "run-old",
              role: "momo",
              text: "你当时说，先把简历投递节奏稳下来。",
              streaming: false,
              createdAt: 2,
            }],
            "buddy-current": [{
              kind: "text",
              id: "current-message",
              runId: "run-current",
              role: "momo",
              text: "今天我们接着聊这件事。",
              streaming: false,
              createdAt: 4,
            }],
            "workbench-task": [{
              kind: "text",
              id: "workbench-message",
              runId: "run-workbench",
              role: "momo",
              text: "这是工作台内部执行记录。",
              streaming: false,
              createdAt: 6,
            }],
          },
          runIds: { "buddy-old": null, "buddy-current": null, "workbench-task": null },
        });
        setReady(true);
      }, [stores]);
      return ready ? <BuddyShell /> : null;
    }

    render(<BridgeProvider client={client}><SeedRelationshipHistory /></BridgeProvider>);

    expect(await screen.findByTestId("buddy-landing")).toBeInTheDocument();
    expect(screen.queryByText("你当时说，先把简历投递节奏稳下来。")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-content")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "继续上次聊天" }));
    expect(await screen.findByText("你当时说，先把简历投递节奏稳下来。")).toBeInTheDocument();
    expect(screen.getByText("今天我们接着聊这件事。")).toBeInTheDocument();
    expect(screen.queryByText("这是工作台内部执行记录。")).not.toBeInTheDocument();
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(0);
  });

  it("starts a new topic transactionally, preserves the draft, and reuses the empty chapter", async () => {
    const client = createBuddyClient();

    function RelationshipStateProbe() {
      const relationshipId = useSettings((state) => state.relationshipConversationId);
      const drafts = useComposerDrafts((state) => state.drafts);
      const preservedDraft = Object.values(drafts).find((item) => item.text === "我刚想到另一件事");
      return (
        <output data-testid="relationship-state">
          {relationshipId}|{preservedDraft?.assignedConversationId ?? "unassigned"}
        </output>
      );
    }

    function SeedRelationship() {
      const stores = useContext(BridgeContext) as BridgeStores;
      const [ready, setReady] = useState(false);
      useEffect(() => {
        stores.settings.setState({
          relationshipInviteDismissed: true,
          relationshipConversationId: "buddy-current",
        });
        stores.conversations.setState({
          byId: {
            "buddy-current": {
              id: "buddy-current",
              title: "最近聊到的事",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "buddy",
              providerId: "glm",
              modelId: "glm-5.2",
              createdAt: 1,
              lastActivityAt: 2,
              unread: false,
            },
          },
          order: ["buddy-current"],
          activeId: null,
          timelines: {
            "buddy-current": [{
              kind: "text",
              id: "current-message",
              runId: "run-current",
              role: "momo",
              text: "这件事我们已经聊过一会儿了。",
              streaming: false,
              createdAt: 2,
            }],
          },
          runIds: { "buddy-current": null },
        });
        stores.composerDrafts!.setState({
          drafts: {
            "conversation:buddy-current": {
              ...EMPTY_COMPOSER_DRAFT,
              text: "我刚想到另一件事",
              assignedConversationId: "buddy-current",
            },
          },
        });
        setReady(true);
      }, [stores]);
      return ready ? <><BuddyShell /><RelationshipStateProbe /></> : null;
    }

    render(<BridgeProvider client={client}><SeedRelationship /></BridgeProvider>);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("输入消息…");
    expect(input).toHaveValue("我刚想到另一件事");

    const landing = screen.getByTestId("buddy-landing");
    await user.click(within(landing).getByRole("button", { name: "新话题" }));
    await waitFor(() => expect(screen.getByTestId("relationship-state")).toHaveTextContent("conv-1|conv-1"));
    expect(input).toHaveValue("我刚想到另一件事");
    expect(screen.queryByRole("alertdialog", { name: "开始新话题？" })).not.toBeInTheDocument();
    expect(screen.getByTestId("buddy-topic-boundary")).toHaveTextContent("新话题从这里开始");
    expect(screen.getByText("这件事我们已经聊过一会儿了。")).toBeInTheDocument();
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);
    expect(client.invoke.mock.calls.find(([channel]) => channel === "bridge:createConversation")?.[1]).toEqual(
      expect.objectContaining({ providerId: "glm", modelId: "glm-5.2" }),
    );
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(0);

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "新话题" }));
    await waitFor(() => expect(screen.getByTestId("relationship-state")).toHaveTextContent("conv-1|conv-1"));
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "撤销新话题" }));
    await waitFor(() => expect(screen.getByTestId("relationship-state")).toHaveTextContent("buddy-current|buddy-current"));
    expect(screen.queryByTestId("buddy-topic-boundary")).not.toBeInTheDocument();
    expect(input).toHaveValue("我刚想到另一件事");
    expect(client.invoke).toHaveBeenCalledWith("bridge:disposeConversation", { conversationId: "conv-1" });
  });

  it("keeps the current chapter and draft when creating a new topic fails", async () => {
    const client = createBuddyClient();
    client.invoke.mockImplementation(async (channel: string) => {
      if (channel === "bridge:createConversation") throw new Error("暂时无法准备新话题");
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    });

    function SeedRelationship() {
      const stores = useContext(BridgeContext) as BridgeStores;
      const [ready, setReady] = useState(false);
      useEffect(() => {
        stores.settings.setState({
          relationshipInviteDismissed: true,
          relationshipConversationId: "buddy-current",
        });
        stores.conversations.setState({
          byId: {
            "buddy-current": {
              id: "buddy-current",
              title: "旧话题",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "buddy",
              providerId: "deepseek",
              modelId: "deepseek-chat",
              createdAt: 1,
              lastActivityAt: 2,
              unread: false,
            },
          },
          order: ["buddy-current"],
          activeId: null,
          timelines: {
            "buddy-current": [{
              kind: "text", id: "old", runId: "old-run", role: "momo",
              text: "旧话题内容", streaming: false, createdAt: 2,
            }],
          },
          runIds: { "buddy-current": null },
        });
        stores.composerDrafts!.setState({
          drafts: {
            "conversation:buddy-current": {
              ...EMPTY_COMPOSER_DRAFT,
              text: "这句还没发",
              assignedConversationId: "buddy-current",
            },
          },
        });
        setReady(true);
      }, [stores]);
      return ready ? <BuddyShell /> : null;
    }

    render(<BridgeProvider client={client}><SeedRelationship /></BridgeProvider>);
    const user = userEvent.setup();
    expect(await screen.findByPlaceholderText("输入消息…")).toHaveValue("这句还没发");
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "新话题" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法准备新话题");
    expect(screen.getByPlaceholderText("输入消息…")).toHaveValue("这句还没发");
    expect(screen.queryByRole("alertdialog", { name: "开始新话题？" })).not.toBeInTheDocument();
  });

  it("keeps the welcome draft and disposes the host when the durable chapter commit fails", async () => {
    const client = createBuddyClient();
    const persist = buddyPersistence({
      saveRelationshipChapter: vi.fn(async () => { throw new Error("本地记录暂时无法保存"); }),
    });
    render(<BridgeProvider client={client} persist={persist}><BuddyShell /></BridgeProvider>);
    const user = userEvent.setup();
    const input = await screen.findByPlaceholderText("输入消息…");
    await user.type(input, "先留住这句草稿");

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "新话题" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("本地记录暂时无法保存");
    expect(input).toHaveValue("先留住这句草稿");
    expect(screen.queryByRole("alertdialog", { name: "开始新话题？" })).not.toBeInTheDocument();
    expect(persist.saveRelationshipChapter).toHaveBeenCalledTimes(1);
    expect(client.invoke).toHaveBeenCalledWith("bridge:disposeConversation", { conversationId: "conv-1" });
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(0);
  });

  it("retries a failed relationship kickoff in the same conversation", async () => {
    const client = createBuddyClient();
    let sendAttempts = 0;
    client.invoke.mockImplementation(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: "conv-relationship" };
      if (channel === "bridge:send" && ++sendAttempts === 1) throw new Error("模型暂时没有响应");
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    });
    renderBuddy(client);

    await userEvent.click(screen.getByRole("button", { name: "让 momo 认识我" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模型暂时没有响应");

    await userEvent.click(screen.getByRole("button", { name: "让 momo 认识我" }));
    await waitFor(() => {
      expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(2);
    });
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);
  });

  it("builds one automatic daily review from today's local records and reuses it", async () => {
    const client = createBuddyClient("今天推进了简历，明天先完成投递清单。");
    const now = Date.now();

    function SeedToday() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["conv-source"]) {
        stores.conversations.setState({
          byId: {
            "conv-source": {
              id: "conv-source",
              title: "优化简历",
              titleManuallyUpdated: true,
              bookId: null,
              workspaceId: "leemo-home",
              source: "buddy",
              providerId: "deepseek",
              modelId: "deepseek-chat",
              createdAt: now - 10_000,
              lastActivityAt: now - 5_000,
              unread: false,
            },
          },
          order: ["conv-source"],
          activeId: null,
          timelines: {
            "conv-source": [{
              kind: "text",
              id: "source-message",
              runId: "source-run",
              role: "user",
              text: "把项目经历改得更具体",
              streaming: false,
              createdAt: now - 4_000,
            }],
          },
          runIds: { "conv-source": null },
        });
        stores.artifacts.setState({
          entries: [{
            id: "artifact-today",
            kind: "file",
            path: "默认工作区/简历-v2.docx",
            title: "简历-v2.docx",
            bookId: null,
            sourceConversationId: "conv-source",
            sourceRunId: "source-run",
            createdAt: now - 3_000,
            escaped: false,
            workspaceId: "leemo-home",
          }],
          status: "ready",
          error: null,
        });
      }
      return <BuddyShell />;
    }

    render(<BridgeProvider client={client}><SeedToday /></BridgeProvider>);
    await userEvent.click(screen.getByRole("button", { name: "回顾今天" }));

    await waitFor(() => {
      const sendCall = client.invoke.mock.calls.find(([channel]) => channel === "bridge:send");
      expect(sendCall?.[1]).toEqual(expect.objectContaining({
        conversationId: "conv-source",
        prompt: expect.stringContaining("把项目经历改得更具体"),
      }));
      expect((sendCall?.[1] as { prompt: string }).prompt).toContain("简历-v2.docx");
    });
    expect(await screen.findByText("回顾今天")).toBeInTheDocument();
    expect(screen.queryByText(/<records>/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "回顾今天" }));
    const hostClaims = client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation");
    expect(hostClaims).toHaveLength(1);
    expect(hostClaims[0]?.[1]).toEqual(expect.objectContaining({ conversationId: "conv-source" }));
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(1);
  });

  it("shows a failed daily review without trapping the user in an empty conversation", async () => {
    const client = createBuddyClient();
    let failSend = true;
    client.invoke.mockImplementation(async (channel: string) => {
      if (channel === "bridge:createConversation") return { conversationId: "conv-review" };
      if (channel === "bridge:send" && failSend) throw new Error("模型服务暂时不可用");
      return undefined;
    });
    render(<BridgeProvider client={client}><BuddyShell /></BridgeProvider>);

    await userEvent.click(screen.getByRole("button", { name: "回顾今天" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模型服务暂时不可用");

    failSend = false;
    await userEvent.click(screen.getByRole("button", { name: "回顾今天" }));
    await waitFor(() => {
      expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);
      expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(2);
    });
  });

  it("从搭子态选择附件后，真实路径随消息进入 bridge:send", async () => {
    const client = createBuddyClient();
    const user = userEvent.setup();
    render(
      <BridgeProvider client={client} workspace={fakeWorkspace()}>
        <BuddyShell />
      </BridgeProvider>,
    );

    const file = new File(["notes"], "课程笔记.md", { type: "text/markdown" });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await user.type(screen.getByPlaceholderText("输入消息…"), "总结重点{Enter}");

    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:send", {
      conversationId: "conv-1",
      prompt: "总结重点",
      sourceMessageId: "u0",
      attachments: [{
        name: "课程笔记.md",
        path: "C:\\Downloads\\课程笔记.md",
        size: 5,
        mimeType: "text/markdown",
      }],
    }));
  });

  it("does not expose an external workbench tree as default-workspace @ references", async () => {
    function SeedExternalWorkspace() {
      const stores = useContext(BridgeContext) as BridgeStores;
      stores.workspaces!.setState({
        list: [
          ...stores.workspaces!.getState().list,
          {
            id: "external-project",
            name: "外部项目",
            displayPath: "D:\\外部项目",
            kind: "external",
            available: true,
            lastOpenedAt: 1,
          },
        ],
        activeId: "external-project",
      });
      stores.fileTree.setState({
        roots: [{ path: "秘密.md", name: "秘密.md", kind: "file", bookId: null }],
      });
      return <BuddyShell />;
    }

    render(
      <BridgeProvider client={createBuddyClient()}>
        <SeedExternalWorkspace />
      </BridgeProvider>,
    );
    await userEvent.type(screen.getByLabelText("输入消息"), "@秘密");

    expect(screen.queryByRole("listbox", { name: "引用工作区文件" })).not.toBeInTheDocument();
  });

  it("shows and dismisses the active conversation's retry draft in buddy mode", async () => {
    function SeedRetry() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["conv-retry"]) {
        stores.conversations.setState({
          byId: {
            "conv-retry": {
              id: "conv-retry", title: "读图失败", titleManuallyUpdated: true, bookId: null,
              source: "buddy", providerId: "deepseek", modelId: "deepseek-chat",
              createdAt: 1, lastActivityAt: 2, unread: false,
            },
          },
          order: ["conv-retry"],
          activeId: "conv-retry",
          timelines: { "conv-retry": [] },
          runIds: { "conv-retry": null },
          pendingSends: {
            "conv-retry": {
              runId: "run-1", text: "看看图片",
              attachments: [{ name: "图.png", path: "C:\\图.png", size: 3, mimeType: "image/png" }],
              providerId: "deepseek", modelId: "deepseek-chat", errorMessage: "图片请求失败",
            },
          },
        });
      }
      return <BuddyShell />;
    }

    render(<BridgeProvider client={createBuddyClient()}><SeedRetry /></BridgeProvider>);
    expect(screen.queryByTestId("buddy-landing")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("原消息和附件已保留");

    await userEvent.click(screen.getByRole("button", { name: "关闭重试提示" }));
    await waitFor(() => expect(screen.queryByText("原消息和附件已保留")).not.toBeInTheDocument());
  });

  it("lets the terminal recovery card own a matching failed run without a duplicate composer notice", () => {
    function SeedTerminalRetry() {
      const stores = useContext(BridgeContext) as BridgeStores;
      if (!stores.conversations.getState().byId["conv-terminal-retry"]) {
        stores.conversations.setState({
          byId: {
            "conv-terminal-retry": {
              id: "conv-terminal-retry", title: "网页读取失败", titleManuallyUpdated: true, bookId: null,
              source: "buddy", providerId: "deepseek", modelId: "deepseek-chat",
              createdAt: 1, lastActivityAt: 2, unread: false,
            },
          },
          order: ["conv-terminal-retry"],
          activeId: "conv-terminal-retry",
          timelines: {
            "conv-terminal-retry": [
              { kind: "text", id: "u1", runId: "run-terminal", role: "user", text: "打开网页", streaming: false },
              { kind: "error", id: "e1", runId: "run-terminal", message: "网页暂时拒绝访问" },
              {
                kind: "result", id: "r1", runId: "run-terminal", isError: true, interrupted: false,
                finalText: "", pathAudit: { claimed: [] },
              },
            ],
          },
          runIds: { "conv-terminal-retry": null },
          pendingSends: {
            "conv-terminal-retry": {
              runId: "run-terminal", text: "打开网页", attachments: [],
              providerId: "deepseek", modelId: "deepseek-chat", errorMessage: "网页暂时拒绝访问",
            },
          },
        });
      }
      return <BuddyShell />;
    }

    render(<BridgeProvider client={createBuddyClient()}><SeedTerminalRetry /></BridgeProvider>);

    expect(screen.getByTestId("buddy-failure-recovery")).toBeInTheDocument();
    expect(screen.queryByText("原消息和附件已保留")).not.toBeInTheDocument();
  });

  it("deduplicates rapid first submits while conversation creation is in flight", async () => {
    let releaseCreate: ((value: { conversationId: string }) => void) | undefined;
    const createPromise = new Promise<{ conversationId: string }>((resolve) => { releaseCreate = resolve; });
    const client = {
      invoke: vi.fn((channel: string) => {
        if (channel === "bridge:createConversation") return createPromise;
        return Promise.resolve(undefined);
      }),
      subscribe: () => () => {},
    } as unknown as MockedBridgeClient;
    renderBuddy(client);
    const input = screen.getByPlaceholderText("输入消息…");

    await userEvent.type(input, "第一次{Enter}");
    await userEvent.type(input, "第二次{Enter}");
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:createConversation")).toHaveLength(1);
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(0);
    releaseCreate?.({ conversationId: "conv-one" });
    await vi.waitFor(() =>
      expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(1)
    );
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toEqual([
      ["bridge:send", { conversationId: "conv-one", prompt: "第一次", sourceMessageId: "u0" }],
    ]);
  });

  it("clicking the history button opens the drawer", async () => {
    renderBuddy();
    await userEvent.click(screen.getByLabelText("历史对话"));
    expect(screen.getByRole("searchbox", { name: "搜索记录" })).toBeInTheDocument();
  });

  it("renders approval bar when there is a pending approval in the active run", async () => {
    const client = createBuddyClient();
    const { client: wrappedClient } = renderBuddy(client);

    // Create conversation and send
    const input = screen.getByPlaceholderText("输入消息…");
    await userEvent.type(input, "写文件{Enter}");

    // Wait for message to appear
    expect(await screen.findByText("写文件")).toBeInTheDocument();

    // Simulate approval request from Bridge
    const onApproval = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:approvalRequest")?.[1];

    // An approval with no toolUseId cannot be anchored (older host); it must
    // still reach the user via the turn-level fallback rather than vanish.
    if (onApproval) {
      onApproval({
        id: "approval-1",
        conversationId: "conv-1",
        toolName: "Write",
        inputSummary: "test.txt",
        risk: "safe",
      });
    }

    // ApprovalBar should render
    const approvalTexts = await screen.findAllByText(/momo 想写入文件/);
    expect(approvalTexts.length).toBeGreaterThan(0);
    const testTxtElements = screen.getAllByText("test.txt");
    expect(testTxtElements.length).toBeGreaterThan(0);
    expect(screen.getByTestId("approval-card-pending")).toHaveAttribute("data-tool-name", "Write");
    expect(screen.getByTestId("approval-card-pending")).toHaveAttribute("data-input-summary", "test.txt");
    expect(screen.getByTestId("approval-card-pending")).toHaveAttribute("data-conversation-id", "conv-1");
    expect(screen.getByTestId("approval-card-pending")).toHaveAttribute("data-approval-id", "approval-1");
    expect(screen.getByTestId("approval-card-pending")).toHaveAttribute("data-run-id", "run-1");
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "新话题" })).toBeDisabled();
  });

  it("offers conversation-scoped approval so repeated normal commands do not nag", async () => {
    const client = createBuddyClient();
    const { client: wrappedClient } = renderBuddy(client);
    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "运行测试{Enter}");
    expect(await screen.findByText("运行测试")).toBeInTheDocument();

    const onApproval = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:approvalRequest")?.[1];
    onApproval?.({
      id: "approval-session",
      conversationId: "conv-1",
      toolName: "Bash",
      inputSummary: "npm test",
      risk: "moderate",
    });

    expect(await screen.findByText("授权范围：仅这条命令；不会跨对话永久放行")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /始终允许/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "本次任务允许命令" }));
    await vi.waitFor(() => expect(wrappedClient.invoke).toHaveBeenCalledWith(
      "bridge:approvalDecision",
      { id: "approval-session", decision: "allow-conversation", message: undefined },
    ));
  });

  it("keeps third-party MCP internals out of the approval card and never offers a blanket grant", async () => {
    const client = createBuddyClient();
    const { client: wrappedClient } = renderBuddy(client);
    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "发布草稿{Enter}");
    expect(await screen.findByText("发布草稿")).toBeInTheDocument();

    const onApproval = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:approvalRequest")?.[1];
    onApproval?.({
      id: "approval-mcp",
      conversationId: "conv-1",
      toolName: "mcp__demo__publish",
      inputSummary: '{"target":"draft"}',
      risk: "moderate",
    });

    expect(await screen.findByText("momo 想通过第三方工具发布内容")).toBeInTheDocument();
    expect(screen.queryByText(/mcp__/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /始终允许/ })).not.toBeInTheDocument();
    expect(screen.getByText("授权范围：仅当前目标与参数；下个任务会重新确认")).toBeInTheDocument();
  });

  it("explains the real task-wide scope for routine computer control", async () => {
    const client = createBuddyClient();
    const { client: wrappedClient } = renderBuddy(client);
    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "整理桌面窗口{Enter}");
    expect(await screen.findByText("整理桌面窗口")).toBeInTheDocument();

    const onApproval = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:approvalRequest")?.[1];
    onApproval?.({
      id: "approval-computer",
      conversationId: "conv-1",
      toolName: "mcp__computer__window_management",
      inputSummary: '{"action":"list"}',
      risk: "moderate",
      taskScope: "computer-control",
    });

    expect(await screen.findByText("本次任务内，查看、切换、输入等普通电脑操作不再重复询问；启动程序和最终动作仍会单独确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本次任务允许电脑操作" })).toBeInTheDocument();
    expect(screen.queryByText("授权范围：仅当前目标与参数；下个任务会重新确认")).not.toBeInTheDocument();
  });

  it("shows a pending approval exactly once — never a second copy pinned above the input", async () => {
    // BuddyShell used to render its own <ApprovalBar> above the input box on
    // top of the one inside the turn. On screen the two cards overlapped, and
    // the pinned copy is exactly the "置底还很丑" the user reported.
    const client = createBuddyClient();
    const { client: wrappedClient } = renderBuddy(client);
    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "写文件{Enter}");
    expect(await screen.findByText("写文件")).toBeInTheDocument();

    const onApproval = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:approvalRequest")?.[1];
    onApproval?.({
      id: "approval-2",
      conversationId: "conv-1",
      toolName: "Write",
      inputSummary: "solo.txt",
      risk: "safe",
    });

    const cards = await screen.findAllByText(/momo 想写入文件/);
    expect(cards).toHaveLength(1);
  });

  it("shows a pending question exactly once — the old pinned-above-input block is gone entirely (卡 D)", async () => {
    // BuddyShell used to pin <AskUserCard runId={activeRunId} /> above the
    // input box on top of the copy TurnBlock now renders inline. That's
    // exactly the "same card twice" shape this round's self-check requires
    // catching — see turnblock.test.tsx's reverse-verified regression test.
    const client = createBuddyClient();
    const { client: wrappedClient } = renderBuddy(client);
    await userEvent.type(screen.getByPlaceholderText("输入消息…"), "整理笔记{Enter}");
    expect(await screen.findByText("整理笔记")).toBeInTheDocument();

    const onEvent = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:event")?.[1];
    onEvent?.({
      conversationId: "conv-1",
      event: {
        type: "tool.started",
        toolUseId: "ask-tool-1",
        name: LEEMO_ASK_USER_TOOL_NAME,
        input: {},
        subagent: false,
      },
    });

    const onAskUser = (wrappedClient.subscribe as ReturnType<typeof vi.fn>).mock.calls
      .find(([channel]) => channel === "bridge:askUser")?.[1];
    onAskUser?.({
      id: "ask-1",
      conversationId: "conv-1",
      questions: [{ question: "放进哪个章节？", options: [{ label: "遍历" }, { label: "平衡树" }] }],
    });

    const questionTexts = await screen.findAllByText("放进哪个章节？");
    expect(questionTexts).toHaveLength(1);
    expect(screen.queryByText("正在使用第三方工具…")).not.toBeInTheDocument();
    expect(screen.queryByText("正在向你确认…")).not.toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "新话题" })).toBeDisabled();
  });

  it("full lifecycle through the real store: pending → answered stays exactly one DOM node throughout", async () => {
    // End-to-end with the real FixtureBridgeClient (not the hand-rolled mock
    // above): create → send → emitAskUser → click an answer → resolved
    // round-trips through wiring.ts + approvals.ts for real. Counts the DOM
    // node for this question at every stage — never 0 (invisible pending =
    // stalled round) and never >1 (the duplicate-render bug this round fixed).
    const client = new FixtureBridgeClient();
    const user = userEvent.setup();
    render(<BridgeProvider client={client}><BuddyShell /></BridgeProvider>);

    await user.type(screen.getByPlaceholderText("输入消息…"), "整理笔记{Enter}");
    await screen.findByText("整理笔记");

    client.emitAskUser({
      id: "ask-1",
      conversationId: "conv-1",
      questions: [{ question: "放进哪个章节？", options: [{ label: "遍历" }, { label: "平衡树" }] }],
    });

    expect(await screen.findAllByText("放进哪个章节？")).toHaveLength(1);
    const chooseBtn = screen.getByRole("button", { name: /遍历/ });
    await user.click(chooseBtn);
    await user.click(screen.getByRole("button", { name: /提交/i }));

    // Answered: still exactly one node, now archived (no submit button left).
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /提交/i })).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("放进哪个章节 · 你选了：遍历")).toHaveLength(1);
  });
});

describe("BuddyShell — 拖文件进搭子态 (06 §2.2)", () => {
  const pdf = () => new File(["x"], "讲义.pdf", { type: "application/pdf" });

  it("拖到输入框只作为本轮附件，不触发工作区归类", async () => {
    const dropFiles = vi.fn(async () => []);
    const client = createBuddyClient();
    const { container } = render(
      <BridgeProvider client={client} workspace={fakeWorkspace({ dropFiles })}>
        <BuddyShell />
      </BridgeProvider>,
    );
    const composer = container.querySelector(".leemo-input-shadow") as HTMLElement;

    dropOn(composer, [pdf()]);
    expect(screen.getByText("讲义.pdf")).toBeInTheDocument();
    expect(dropFiles).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("输入消息"), "讲讲重点{Enter}");
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({
        prompt: "讲讲重点",
        attachments: [expect.objectContaining({
          name: "讲义.pdf",
          path: "C:\\Downloads\\讲义.pdf",
        })],
      }),
    ));
    expect(dropFiles).not.toHaveBeenCalled();
  });

  it("搭子态也能把剪贴板截图落成真实临时附件", async () => {
    const stageClipboardImage = vi.fn(async () => ({
      name: "粘贴图片.png",
      path: "C:\\Temp\\Leemo\\clipboard.png",
      size: 128,
      mimeType: "image/png" as const,
    }));
    render(
      <BridgeProvider client={createBuddyClient()} workspace={fakeWorkspace({
        pathForFile: () => "",
        stageClipboardImage,
      })}>
        <BuddyShell />
      </BridgeProvider>,
    );

    fireEvent.paste(screen.getByLabelText("输入消息"), {
      clipboardData: {
        files: [new File(["pixels"], "image.png", { type: "image/png" })],
        types: ["Files", "image/png"],
      },
    });

    expect(stageClipboardImage).toHaveBeenCalledOnce();
    expect(await screen.findByText("粘贴图片.png")).toBeInTheDocument();
  });

  it("拖进来 → momo 给建议 + 一句话确认条（没本子上下文时不许闷着归类）", async () => {
    const { container } = render(
      <BridgeProvider client={createBuddyClient()} workspace={fakeWorkspace({ suggestNotebook: async () => "高等数学" })}>
        <BuddyShell />
      </BridgeProvider>,
    );
    dropOn(container.firstElementChild!, [pdf()]);

    const bar = await screen.findByTestId("drop-classify-bar");
    expect(bar).toHaveTextContent("讲义.pdf");
    expect(bar).toHaveTextContent("高等数学");
  });

  it("点「好」才真落盘 —— 确认前一个文件都不复制", async () => {
    const dropFiles = vi.fn(async () => []);
    const { container } = render(
      <BridgeProvider client={createBuddyClient()} workspace={fakeWorkspace({ dropFiles, suggestNotebook: async () => "高等数学" })}>
        <BuddyShell />
      </BridgeProvider>,
    );
    dropOn(container.firstElementChild!, [pdf()]);
    await screen.findByTestId("drop-classify-bar");
    expect(dropFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("drop-confirm-suggestion"));
    await waitFor(() =>
      expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\讲义.pdf"], "高等数学", "leemo-home"),
    );
    await waitFor(() => expect(screen.queryByTestId("drop-classify-bar")).not.toBeInTheDocument());
  });

  it("认不出来时提供默认工作区兜底，不硬猜成某个本子", async () => {
    const dropFiles = vi.fn(async () => []);
    const { container } = render(
      <BridgeProvider client={createBuddyClient()} workspace={fakeWorkspace({ dropFiles })}>
        <BuddyShell />
      </BridgeProvider>,
    );
    dropOn(container.firstElementChild!, [new File(["x"], "扫描件_0413.jpg")]);
    await screen.findByTestId("drop-classify-bar");
    // No suggestion → no "好" button; the physical fallback stays explicit.
    expect(screen.queryByTestId("drop-confirm-suggestion")).not.toBeInTheDocument();
    expect(screen.getByText(/拿不准就先暂不归入本子/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂不归入本子" }));
    await waitFor(() => expect(dropFiles).toHaveBeenCalledWith(["C:\\Downloads\\扫描件_0413.jpg"], null, "leemo-home"));
  });

  it("浏览器 dev（没工作区）：拖了也不弹条，不装能存文件", () => {
    const { container } = render(
      <BridgeProvider client={createBuddyClient()}><BuddyShell /></BridgeProvider>,
    );
    dropOn(container.firstElementChild!, [pdf()]);
    expect(screen.queryByTestId("drop-classify-bar")).not.toBeInTheDocument();
  });
});
