import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BridgeProvider } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import BuddyShell from "./BuddyShell";
import type { BridgeEventEnvelope } from "../../bridge/contract";
import type { PersistenceClient } from "../persistence/client";
import type { WorkspaceClient } from "../workspace/client";

type MockedBridgeClient = BridgeClient & { invoke: ReturnType<typeof vi.fn> };

/** A client whose sends resolve immediately, so a test can build up several
 *  real conversations (titles are derived from the first message). */
function createClient(): MockedBridgeClient {
  let onEvent: ((payload: BridgeEventEnvelope) => void) | undefined;
  let createCount = 0;
  return {
    invoke: vi.fn(async (channel: string, request: unknown) => {
      if (channel === "bridge:createConversation") return { conversationId: `conv-${++createCount}` };
      if (channel === "bridge:send") {
        const conversationId = (request as { conversationId: string }).conversationId;
        queueMicrotask(() =>
          onEvent?.({ conversationId, event: { type: "text.final", text: "好" } }),
        );
      }
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    }),
    subscribe: vi.fn((channel: string, callback: (payload: unknown) => void) => {
      if (channel === "bridge:event") onEvent = callback as (payload: BridgeEventEnvelope) => void;
      return () => {};
    }),
  } as unknown as MockedBridgeClient;
}

function openDrawer(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  return user.click(screen.getByLabelText("历史对话"));
}

function storedConversation(
  id: string,
  title: string,
  options: { bookId?: string | null; archived?: boolean; lastOpenedAt?: number; pinned?: boolean } = {},
) {
  const timestamp = options.lastOpenedAt ?? 1;
  return {
    meta: {
      id,
      title,
      titleManuallyUpdated: false,
      workspaceId: "leemo-home",
      bookId: options.bookId ?? null,
      source: "buddy" as const,
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      createdAt: timestamp,
      lastActivityAt: timestamp,
      lastOpenedAt: timestamp,
      unread: false,
      pinned: options.pinned ?? false,
      archived: options.archived ?? false,
    },
    timeline: [
      { kind: "text" as const, id: `turn-${id}`, runId: `run-${id}`, role: "user" as const, text: title, streaming: false },
    ],
  };
}

function persistenceWith(...conversations: ReturnType<typeof storedConversation>[]): PersistenceClient & {
  saveConversation: ReturnType<typeof vi.fn>;
  moveConversation: ReturnType<typeof vi.fn>;
  deleteConversation: ReturnType<typeof vi.fn>;
} {
  return {
    loadAll: vi.fn(async () => ({ conversations, wikiEntries: [] })),
    saveConversation: vi.fn(async () => {}),
    moveConversation: vi.fn(async () => {}),
    deleteConversation: vi.fn(async () => {}),
    saveWikiEntry: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    saveGlobalPendingOverview: vi.fn(async () => {}),
  };
}

describe("HistoryDrawer — real conversations, not fixtures", () => {
  it("uses the approved buddy drawer hierarchy without duplicating settings", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(storedConversation("current", "今天该先做什么", { lastOpenedAt: Date.now() }));
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("今天该先做什么");

    await openDrawer(user);

    const dialog = screen.getByRole("dialog", { name: "momo 的记录" });
    expect(dialog).toHaveAttribute("data-history-drawer", "buddy");
    expect(within(dialog).getByRole("heading", { name: "momo 的记录" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "关闭记录" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "开始新对话" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("searchbox", { name: "搜索记录" })).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("搜索记录")).not.toHaveFocus();
    expect(within(dialog).queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
    expect(screen.getByTestId("buddy-history-scrim")).toBeInTheDocument();
  });

  it("groups only real conversations into pinned, today, recent and earlier sections", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1_000;
    const persist = persistenceWith(
      storedConversation("today", "今天的安排", { lastOpenedAt: now - 60_000 }),
      storedConversation("recent", "前几天的想法", { lastOpenedAt: now - (3 * day) }),
      storedConversation("earlier", "上个月的复盘", { lastOpenedAt: now - (30 * day) }),
      storedConversation("pinned", "长期关注", { lastOpenedAt: now - (60 * day), pinned: true }),
    );
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("今天的安排");

    await openDrawer(user);

    const dialog = screen.getByRole("dialog", { name: "momo 的记录" });
    const groups = within(dialog).getAllByTestId("buddy-history-group");
    expect(groups.map((group) => group.getAttribute("data-group"))).toEqual([
      "pinned",
      "today",
      "recent",
      "earlier",
    ]);
    expect(within(groups[0]).getByRole("button", { name: "长期关注" })).toBeInTheDocument();
    expect(within(groups[1]).getByRole("button", { name: "今天的安排" })).toBeInTheDocument();
    expect(within(groups[2]).getByRole("button", { name: "前几天的想法" })).toBeInTheDocument();
    expect(within(groups[3]).getByRole("button", { name: "上个月的复盘" })).toBeInTheDocument();
  });

  it("lists nothing but an empty state before any conversation exists", async () => {
    const user = userEvent.setup();
    render(<BridgeProvider client={createClient()}><BuddyShell /></BridgeProvider>);
    await openDrawer(user);

    expect(screen.getByText("还没有记录")).toBeInTheDocument();
    // The fixture strings that used to be hardcoded here must be gone for good.
    expect(screen.queryByText("第五章复习笔记整理")).not.toBeInTheDocument();
    expect(screen.queryByText("社团招新的推文文案")).not.toBeInTheDocument();
    expect(screen.queryByText("周五晚上看什么电影")).not.toBeInTheDocument();
  });

  it("lists the real legacy chapter titles newest first", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(
      storedConversation("older", "买菜清单", { lastOpenedAt: 1 }),
      storedConversation("newer", "周报怎么写", { lastOpenedAt: 2 }),
    );
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("周报怎么写");
    await openDrawer(user);

    const items = screen.getAllByRole("button", { name: /买菜清单|周报怎么写/ })
      .filter((button) => !button.getAttribute("aria-label")?.startsWith("更多操作："));
    // `order` is most-recently-active first, so the latest conversation leads.
    expect(items.map((el) => el.textContent)).toEqual(["周报怎么写", "买菜清单"]);
  });

  it("closes after a chapter is picked without starting a model request", async () => {
    const user = userEvent.setup();
    const client = createClient();
    const persist = persistenceWith(
      storedConversation("older", "买菜清单", { lastOpenedAt: 1 }),
      storedConversation("newer", "周报怎么写", { lastOpenedAt: 2 }),
    );
    render(<BridgeProvider client={client} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("周报怎么写");
    await openDrawer(user);

    await user.click(screen.getByRole("button", { name: "买菜清单" }));

    // Drawer dismissed, and the picked conversation's message is on screen.
    await waitFor(() => expect(screen.queryByLabelText("搜索记录")).not.toBeInTheDocument());
    expect(screen.getByText("买菜清单")).toBeInTheDocument();
    expect(client.invoke.mock.calls.filter(([channel]) => channel === "bridge:send")).toHaveLength(0);
  });

  it("filters by title as the user searches", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(
      storedConversation("older", "买菜清单", { lastOpenedAt: 1 }),
      storedConversation("newer", "周报怎么写", { lastOpenedAt: 2 }),
    );
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("周报怎么写");
    await openDrawer(user);

    await user.type(screen.getByLabelText("搜索记录"), "周报");

    expect(screen.getByRole("button", { name: "周报怎么写" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "买菜清单" })).not.toBeInTheDocument();
  });

  it("renames a conversation inline and keeps the new title in history", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(storedConversation("resume", "请帮我分析秋招简历"));
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("请帮我分析秋招简历");
    await openDrawer(user);

    await user.click(screen.getByRole("button", { name: "更多操作：分析秋招简历" }));
    await user.click(screen.getByRole("button", { name: "重命名" }));
    const input = screen.getByLabelText("对话标题");
    await user.clear(input);
    await user.type(input, "秋招简历修改");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "秋招简历修改" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析秋招简历" })).not.toBeInTheDocument();
  });

  it("tells the user when a search matches nothing (rather than looking broken)", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(storedConversation("shopping", "买菜清单"));
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("买菜清单");
    await openDrawer(user);

    await user.type(screen.getByLabelText("搜索记录"), "zzz没有这个");

    expect(screen.getByText("没有匹配的记录")).toBeInTheDocument();
  });

  it("lists a RESTORED conversation and can send to it (the reported bug, end to end)", async () => {
    // The exact user-visible failure: restart → open history in buddy mode →
    // pick an old conversation → send. It needed BOTH halves to work — 卡 C so
    // the host re-claims a hydrated cid, and this card so the drawer lists the
    // real conversation instead of a fixture string.
    const user = userEvent.setup();
    const client = createClient();
    const persist = {
      loadAll: vi.fn(async () => ({
        conversations: [
          {
            meta: {
              id: "conv-restored", title: "上次没聊完的事", titleManuallyUpdated: false,
              bookId: null, source: "buddy" as const, providerId: "deepseek",
              modelId: "deepseek-v4pro", createdAt: 1, lastActivityAt: 2, unread: false,
              sessionId: "sess-abc",
            },
            timeline: [
              { kind: "text" as const, id: "u0", runId: "run-1", role: "user" as const, text: "上次没聊完的事", streaming: false },
            ],
          },
        ],
        wikiEntries: [],
      })),
      saveConversation: vi.fn(async () => {}),
      moveConversation: vi.fn(async () => {}),
      deleteConversation: vi.fn(async () => {}),
      saveWikiEntry: vi.fn(async () => {}),
      saveSettings: vi.fn(async () => {}),
      saveGlobalPendingOverview: vi.fn(async () => {}),
    };
    render(<BridgeProvider client={client} persist={persist}><BuddyShell /></BridgeProvider>);
    await waitFor(() => expect(persist.loadAll).toHaveBeenCalled());

    await openDrawer(user);
    expect(await screen.findByRole("button", { name: "上次没聊完的事" })).toBeInTheDocument();
    expect(screen.queryByText("等待继续")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "上次没聊完的事" }));

    // Opening a recovery point is navigation, not consent to spend quota or
    // guess what the user wanted next. The user explicitly sends the next turn.
    expect(client.invoke).not.toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({ conversationId: "conv-restored" }),
    );

    await user.type(screen.getByPlaceholderText("输入消息…"), "接着说");
    await user.keyboard("{Enter}");

    // The send must reach the host under the SAME id SQLite stored, having been
    // re-claimed with the persisted session first (卡 C), not silently dropped.
    await waitFor(() => {
      expect(client.invoke).toHaveBeenCalledWith(
        "bridge:createConversation",
        expect.objectContaining({ conversationId: "conv-restored", resumeSessionId: "sess-abc" }),
      );
      expect(client.invoke).toHaveBeenCalledWith(
        "bridge:send",
        expect.objectContaining({ conversationId: "conv-restored", prompt: "接着说" }),
      );
    });
  });

  it("keeps buddy history global and puts archived conversations in a separate section", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(
      storedConversation("global", "今晚聊聊", { lastOpenedAt: 2 }),
      storedConversation("archived", "旧想法", { archived: true }),
      storedConversation("book", "高数第三章", { bookId: "高等数学", lastOpenedAt: 9 }),
    );
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);

    expect(await screen.findByText("今晚聊聊")).toBeInTheDocument();
    expect(screen.queryByText("高数第三章")).not.toBeInTheDocument();
    await openDrawer(user);

    expect(screen.getByRole("button", { name: "今晚聊聊" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "高数第三章" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "旧想法" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "已归档 1" }));
    expect(screen.getByRole("button", { name: "旧想法" })).toBeInTheDocument();
  });

  it("persists pin, archive and delete actions from buddy history", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(
      storedConversation("active", "当前对话", { lastOpenedAt: 5 }),
      storedConversation("older", "稍后整理", { lastOpenedAt: 1 }),
    );
    render(<BridgeProvider client={createClient()} persist={persist}><BuddyShell /></BridgeProvider>);
    await screen.findByText("当前对话");
    await openDrawer(user);

    await user.click(screen.getByRole("button", { name: "更多操作：稍后整理" }));
    await user.click(screen.getByRole("button", { name: "置顶" }));
    await waitFor(() => expect(persist.saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "older", pinned: true }),
      expect.any(Array),
    ));

    await user.click(screen.getByRole("button", { name: "更多操作：稍后整理" }));
    await user.click(screen.getByRole("button", { name: "归档" }));
    await user.click(await screen.findByRole("button", { name: "已归档 1" }));
    await user.click(screen.getByRole("button", { name: "更多操作：稍后整理" }));
    await user.click(screen.getByRole("button", { name: "删除对话" }));
    await user.click(screen.getByRole("button", { name: "确认删除对话" }));

    await waitFor(() => expect(persist.deleteConversation).toHaveBeenCalledWith("older"));
    expect(screen.queryByRole("button", { name: "稍后整理" })).not.toBeInTheDocument();
  });

  it("moves a global buddy conversation into a chosen book", async () => {
    const user = userEvent.setup();
    const persist = persistenceWith(
      storedConversation("active", "当前对话", { lastOpenedAt: 5 }),
      storedConversation("move-me", "归入课程", { lastOpenedAt: 1 }),
    );
    const workspace = {
      listWorkspaces: vi.fn(async () => [{
        id: "leemo-home", name: "Leemo", displayPath: "C:\\Users\\Rengar\\Leemo",
        kind: "home" as const, available: true, lastOpenedAt: 1,
      }]),
      listNotebooks: vi.fn(async () => ({
        root: "C:\\Users\\Rengar\\Leemo",
        notebooks: [{ id: "高等数学", title: "高等数学", dir: "C:\\Users\\Rengar\\Leemo\\高等数学", color: "blue" as const, hasMemory: true }],
      })),
      readTree: vi.fn(async () => []),
    } as unknown as WorkspaceClient;
    render(<BridgeProvider client={createClient()} persist={persist} workspace={workspace}><BuddyShell /></BridgeProvider>);
    await waitFor(() => expect(workspace.listNotebooks).toHaveBeenCalled());
    await screen.findByText("当前对话");
    await openDrawer(user);

    await user.click(screen.getByRole("button", { name: "更多操作：归入课程" }));
    await user.click(screen.getByRole("button", { name: "移动到其他本子" }));
    await user.click(screen.getByRole("button", { name: "移动到高等数学" }));

    await waitFor(() => expect(persist.moveConversation).toHaveBeenCalledWith(
      "leemo-home",
      expect.objectContaining({ id: "move-me", workspaceId: "leemo-home", bookId: "高等数学" }),
      expect.any(Array),
    ));
    expect(screen.queryByRole("button", { name: "归入课程" })).not.toBeInTheDocument();
  });
});
