import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../bridge/client";
import type { MemoryView } from "../../bridge/contract";
import { createMemoryStore } from "../stores/memory";
import MemorySettingsSection from "./MemorySettingsSection";

const globalMemory: MemoryView = {
  id: "memory-global",
  scope: { type: "global" },
  kind: "preference",
  topic: "回答方式",
  statement: "用户喜欢先看结论",
  learnedAt: new Date("2026-07-30T08:00:00Z").getTime(),
  lastConfirmedAt: new Date("2026-07-30T08:00:00Z").getTime(),
  sourceType: "explicit-user",
  sourceConversationId: "conversation-live",
  status: "current",
  pinned: false,
};

const notebookMemory: MemoryView = {
  id: "memory-notebook",
  scope: { type: "notebook", notebookId: "秋招" },
  kind: "goal",
  topic: "本子目标",
  statement: "本周完成两次模拟面试",
  learnedAt: new Date("2026-07-31T08:00:00Z").getTime(),
  sourceType: "native-auto",
  sourceConversationId: "conversation-missing",
  status: "current",
  pinned: true,
};

const projectMemory: MemoryView = {
  id: "memory-project",
  scope: { type: "workspace", workspaceId: "workspace-project" },
  kind: "state",
  topic: "项目约定",
  statement: "毕业设计项目使用 pnpm",
  learnedAt: new Date("2026-07-31T09:00:00Z").getTime(),
  sourceType: "explicit-user",
  status: "current",
  pinned: false,
};

function memoryClient(
  initial: MemoryView[] = [globalMemory, notebookMemory],
  history: MemoryView[] = [],
): BridgeClient & { invoke: ReturnType<typeof vi.fn> } {
  let records = initial.map((record) => ({ ...record, scope: { ...record.scope } }));
  let sequence = 0;
  const invoke = vi.fn(async (channel: string, request: unknown) => {
    if (channel === "bridge:listMemory") return records;
    if (channel === "bridge:updateMemory") {
      const input = request as { id: string; statement?: string };
      const before = records.find((record) => record.id === input.id)!;
      const memory = { ...before, statement: input.statement ?? before.statement };
      records = records.map((record) => record.id === input.id ? memory : record);
      return { changeId: `change-${++sequence}`, action: "updated", label: memory.statement, memory };
    }
    if (channel === "bridge:pinMemory") {
      const input = request as { id: string; pinned: boolean };
      const before = records.find((record) => record.id === input.id)!;
      const memory = { ...before, pinned: input.pinned };
      records = records.map((record) => record.id === input.id ? memory : record);
      return { changeId: `change-${++sequence}`, action: input.pinned ? "pinned" : "unpinned", label: memory.statement, memory };
    }
    if (channel === "bridge:deleteMemory") {
      const input = request as { id: string };
      const before = records.find((record) => record.id === input.id)!;
      const memory = { ...before, status: "deleted" as const };
      records = records.filter((record) => record.id !== input.id);
      return { changeId: `change-${++sequence}`, action: "removed", label: memory.statement, memory };
    }
    if (channel === "bridge:memoryHistory") return history;
    if (channel === "bridge:openMemoryDir") return undefined;
    throw new Error(`Unexpected channel: ${channel}`);
  });
  return {
    invoke: invoke as BridgeClient["invoke"] & ReturnType<typeof vi.fn>,
    subscribe: vi.fn(() => () => undefined) as BridgeClient["subscribe"],
  } as BridgeClient & { invoke: ReturnType<typeof vi.fn> };
}

function renderSection({
  client = memoryClient(),
  rememberMode = true,
  onRememberModeChange = vi.fn(),
  onOpenConversation = vi.fn(),
}: {
  client?: BridgeClient & { invoke: ReturnType<typeof vi.fn> };
  rememberMode?: boolean;
  onRememberModeChange?: (enabled: boolean) => void;
  onOpenConversation?: (conversationId: string) => void;
} = {}) {
  const store = createMemoryStore(client);
  const view = render(
    <MemorySettingsSection
      store={store}
      notebooks={[{ id: "秋招", title: "秋招" }]}
      workspaces={[{ id: "workspace-project", name: "毕业设计", available: true }]}
      conversations={{ "conversation-live": { id: "conversation-live", title: "简历复盘" } }}
      rememberMode={rememberMode}
      onRememberModeChange={onRememberModeChange}
      onOpenConversation={onOpenConversation}
    />,
  );
  return { ...view, store, client };
}

describe("MemorySettingsSection", () => {
  it("loads global and both kinds of book memory without exposing the workspace distinction", async () => {
    const user = userEvent.setup();
    const onRememberModeChange = vi.fn();
    const { client } = renderSection({
      client: memoryClient([globalMemory, notebookMemory, projectMemory]),
      onRememberModeChange,
    });

    expect(await screen.findByText("用户喜欢先看结论")).toBeInTheDocument();
    expect(screen.getByText("本周完成两次模拟面试")).toBeInTheDocument();
    expect(screen.getByText("偏好")).toBeInTheDocument();
    expect(screen.getAllByText("秋招").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "只看项目记忆" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "关于我",
      "本子：秋招",
      "本子：毕业设计",
    ]);
    expect(client.invoke).toHaveBeenCalledWith("bridge:listMemory", {
      scopes: [
        { type: "global" },
        { type: "notebook", notebookId: "秋招" },
        { type: "workspace", workspaceId: "workspace-project" },
      ],
    });

    expect(screen.getByText(/关闭后不会新增，也不会删除已有记忆/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "启用自动记忆" }));
    expect(onRememberModeChange).toHaveBeenCalledWith(false);

    await user.selectOptions(screen.getByRole("combobox", { name: "要打开的记忆目录" }), "notebook:秋招");
    await user.click(screen.getByRole("button", { name: "打开本地记忆目录" }));
    expect(client.invoke).toHaveBeenLastCalledWith("bridge:openMemoryDir", {
      scope: { type: "notebook", notebookId: "秋招" },
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "要打开的记忆目录" }), "workspace:workspace-project");
    await user.click(screen.getByRole("button", { name: "打开本地记忆目录" }));
    expect(client.invoke).toHaveBeenLastCalledWith("bridge:openMemoryDir", {
      scope: { type: "workspace", workspaceId: "workspace-project" },
    });
  });

  it("filters global memory from all book memory and distinguishes an empty search", async () => {
    const user = userEvent.setup();
    renderSection({ client: memoryClient([globalMemory, notebookMemory, projectMemory]) });
    await screen.findByText("用户喜欢先看结论");

    await user.click(screen.getByRole("button", { name: "只看关于我的记忆" }));
    expect(screen.getByText("用户喜欢先看结论")).toBeInTheDocument();
    expect(screen.queryByText("本周完成两次模拟面试")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "要打开的记忆目录" })).toHaveValue("global");

    await user.click(screen.getByRole("button", { name: "只看本子记忆" }));
    expect(screen.queryByText("用户喜欢先看结论")).not.toBeInTheDocument();
    expect(screen.getByText("本周完成两次模拟面试")).toBeInTheDocument();
    expect(screen.getByText("毕业设计项目使用 pnpm")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "要打开的记忆目录" })).toHaveValue("notebook:秋招");

    await user.type(screen.getByRole("searchbox", { name: "搜索记忆" }), "完全不存在的内容");
    expect(screen.getByText("没有匹配的记忆")).toBeInTheDocument();
  });

  it("edits and pins in place, then requires confirmation before forgetting", async () => {
    const user = userEvent.setup();
    const { client } = renderSection();
    await screen.findByText("用户喜欢先看结论");

    await user.click(screen.getByRole("button", { name: "编辑记忆：用户喜欢先看结论" }));
    const editor = screen.getByRole("textbox", { name: "编辑记忆内容" });
    expect(editor).toHaveFocus();
    await user.clear(editor);
    await user.type(editor, "用户喜欢先给结论，再给必要依据");
    await user.click(screen.getByRole("button", { name: "保存记忆修改" }));
    expect(await screen.findByText("用户喜欢先给结论，再给必要依据")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "置顶记忆：用户喜欢先给结论，再给必要依据" }));
    expect(client.invoke).toHaveBeenCalledWith("bridge:pinMemory", expect.objectContaining({
      id: "memory-global",
      pinned: true,
    }));

    await user.click(screen.getByRole("button", { name: "删除记忆：用户喜欢先给结论，再给必要依据" }));
    expect(screen.getByRole("alertdialog", { name: "确认删除记忆" })).toBeInTheDocument();
    expect(screen.getByText("用户喜欢先给结论，再给必要依据")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除这条记忆" }));
    await waitFor(() => expect(screen.queryByText("用户喜欢先给结论，再给必要依据")).not.toBeInTheDocument());
  });

  it("shows human-readable history and only links to a source conversation that still exists", async () => {
    const user = userEvent.setup();
    const old = {
      ...globalMemory,
      id: "memory-old",
      statement: "用户喜欢简洁回答",
      status: "superseded" as const,
      sourceConversationId: "conversation-missing",
      validTo: new Date("2026-07-30T08:00:00Z").getTime(),
    };
    const client = memoryClient([globalMemory], [globalMemory, old]);
    const onOpenConversation = vi.fn();
    renderSection({ client, onOpenConversation });
    await screen.findByText("用户喜欢先看结论");

    await user.click(screen.getByRole("button", { name: "查看记忆历史：用户喜欢先看结论" }));
    expect(await screen.findByText("用户喜欢简洁回答")).toBeInTheDocument();
    expect(screen.getAllByText("用户明确说")).toHaveLength(2);
    expect(screen.getByText("来源对话已不存在")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看来源对话：简历复盘" }));
    expect(onOpenConversation).toHaveBeenCalledWith("conversation-live");
  });

  it("has honest loading, empty, and failed states with a retry", async () => {
    let resolveLoading!: (records: MemoryView[]) => void;
    const loadingClient = memoryClient([]);
    loadingClient.invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveLoading = resolve; }));
    const loadingView = renderSection({ client: loadingClient });
    expect(screen.getByRole("status")).toHaveTextContent("正在读取 momo 的记忆");
    resolveLoading([]);
    expect(await screen.findByText("momo 还没有需要长期记住的内容")).toBeInTheDocument();
    loadingView.unmount();

    const failedClient = memoryClient([]);
    failedClient.invoke.mockRejectedValueOnce(new Error("记忆账本暂时无法读取"));
    renderSection({ client: failedClient });
    expect(await screen.findByRole("alert")).toHaveTextContent("记忆账本暂时无法读取");
    expect(screen.getByRole("button", { name: "重新读取记忆" })).toBeInTheDocument();
    expect(screen.queryByText("这个范围里还没有记忆")).not.toBeInTheDocument();
    expect(screen.queryByText("momo 还没有需要长期记住的内容")).not.toBeInTheDocument();
  });

  it("keeps a history failure separate and retries the original history request", async () => {
    const user = userEvent.setup();
    const old = { ...globalMemory, id: "memory-old", statement: "用户喜欢简洁回答" };
    const client = memoryClient([globalMemory], [old]);
    const fallback = client.invoke.getMockImplementation() as (
      channel: string,
      request: unknown,
    ) => Promise<unknown>;
    let attempts = 0;
    client.invoke.mockImplementation(async (channel: string, request: unknown) => {
      if (channel === "bridge:memoryHistory" && ++attempts === 1) {
        throw new Error("历史读取失败");
      }
      return fallback(channel, request);
    });
    renderSection({ client });
    await screen.findByText("用户喜欢先看结论");

    await user.click(screen.getByRole("button", { name: "查看记忆历史：用户喜欢先看结论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("历史读取失败");
    expect(screen.queryByText("还没有更早的版本")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新读取这条记忆的历史" }));
    expect(await screen.findByText("用户喜欢简洁回答")).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("keeps each record busy until its own concurrent mutation settles", async () => {
    const user = userEvent.setup();
    const client = memoryClient();
    const fallback = client.invoke.getMockImplementation() as (
      channel: string,
      request: unknown,
    ) => Promise<unknown>;
    const releases = new Map<string, (value: unknown) => void>();
    client.invoke.mockImplementation(async (channel: string, request: unknown) => {
      if (channel !== "bridge:pinMemory") return fallback(channel, request);
      const input = request as { id: string; pinned: boolean };
      return new Promise((resolve) => releases.set(input.id, resolve));
    });
    renderSection({ client });
    await screen.findByText("用户喜欢先看结论");

    const globalPin = screen.getByRole("button", { name: "置顶记忆：用户喜欢先看结论" });
    const notebookPin = screen.getByRole("button", { name: "取消置顶记忆：本周完成两次模拟面试" });
    await user.click(globalPin);
    await user.click(notebookPin);
    expect(notebookPin).toBeDisabled();

    await act(async () => {
      releases.get(globalMemory.id)?.({
        changeId: "pin-global",
        action: "pinned",
        label: globalMemory.statement,
        memory: { ...globalMemory, pinned: true },
      });
      await Promise.resolve();
    });
    expect(notebookPin).toBeDisabled();

    await act(async () => {
      releases.get(notebookMemory.id)?.({
        changeId: "unpin-notebook",
        action: "unpinned",
        label: notebookMemory.statement,
        memory: { ...notebookMemory, pinned: false },
      });
      await Promise.resolve();
    });
  });

  it("returns keyboard focus after cancelling edit and delete confirmation", async () => {
    const user = userEvent.setup();
    renderSection({ client: memoryClient([globalMemory]) });
    await screen.findByText("用户喜欢先看结论");

    const editButton = screen.getByRole("button", { name: "编辑记忆：用户喜欢先看结论" });
    await user.click(editButton);
    expect(screen.getByRole("textbox", { name: "编辑记忆内容" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "取消记忆修改" }));
    expect(screen.getByRole("button", { name: "编辑记忆：用户喜欢先看结论" })).toHaveFocus();

    const deleteButton = screen.getByRole("button", { name: "删除记忆：用户喜欢先看结论" });
    await user.click(deleteButton);
    const keepButton = screen.getByRole("button", { name: "保留这条记忆" });
    expect(keepButton).toHaveFocus();
    await user.click(keepButton);
    expect(screen.getByRole("button", { name: "删除记忆：用户喜欢先看结论" })).toHaveFocus();
  });

  it("returns focus after saving an edit and after deleting a record", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText("用户喜欢先看结论");

    await user.click(screen.getByRole("button", { name: "编辑记忆：用户喜欢先看结论" }));
    const editor = screen.getByRole("textbox", { name: "编辑记忆内容" });
    await user.clear(editor);
    await user.type(editor, "用户喜欢先给结论");
    await user.click(screen.getByRole("button", { name: "保存记忆修改" }));
    expect(await screen.findByRole("button", { name: "编辑记忆：用户喜欢先给结论" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "删除记忆：用户喜欢先给结论" }));
    await user.click(screen.getByRole("button", { name: "确认删除这条记忆" }));
    await waitFor(() => expect(screen.queryByText("用户喜欢先给结论")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "编辑记忆：本周完成两次模拟面试" })).toHaveFocus();
  });

  it("bounds action labels while leaving the complete memory visible", async () => {
    const statement = `一段很长的记忆${"非常具体".repeat(80)}`;
    renderSection({ client: memoryClient([{ ...globalMemory, statement }]) });
    expect(await screen.findByText(statement)).toBeInTheDocument();

    const edit = screen.getByTitle("编辑");
    expect(edit.getAttribute("aria-label")?.length).toBeLessThan(100);
    expect(edit).not.toHaveAttribute("aria-label", expect.stringContaining(statement));
  });

  it("keeps long memory and error text breakable in destructive states", async () => {
    const user = userEvent.setup();
    const statement = `https://local.test/${"unbroken".repeat(100)}`;
    const error = `无法打开 C:\\${"very-long-path".repeat(80)}`;
    const client = memoryClient([{ ...globalMemory, statement }]);
    const fallback = client.invoke.getMockImplementation() as (
      channel: string,
      request: unknown,
    ) => Promise<unknown>;
    client.invoke.mockImplementation(async (channel: string, request: unknown) => {
      if (channel === "bridge:openMemoryDir") throw new Error(error);
      return fallback(channel, request);
    });
    renderSection({ client });
    await screen.findByText(statement);

    await user.click(screen.getByTitle("删除"));
    expect(screen.getByText(statement)).toHaveClass("break-words");
    await user.click(screen.getByRole("button", { name: "打开本地记忆目录" }));
    expect(await screen.findByText(error)).toHaveClass("min-w-0", "flex-1", "break-words");
  });

  it("moves focus to a visibly focusable heading after deleting the only memory", async () => {
    const user = userEvent.setup();
    renderSection({ client: memoryClient([globalMemory]) });
    await screen.findByText(globalMemory.statement);

    await user.click(screen.getByRole("button", { name: "删除记忆：用户喜欢先看结论" }));
    await user.click(screen.getByRole("button", { name: "确认删除这条记忆" }));
    const heading = await screen.findByRole("heading", { name: "momo 记得的" });
    expect(heading).toHaveFocus();
    expect(heading.className).toContain("focus-visible:outline");
  });

  it("retries the directory action itself when the OS cannot open it", async () => {
    const user = userEvent.setup();
    const client = memoryClient([globalMemory]);
    const fallback = client.invoke.getMockImplementation() as (
      channel: string,
      request: unknown,
    ) => Promise<unknown>;
    let openAttempts = 0;
    client.invoke.mockImplementation(async (channel: string, request: unknown) => {
      if (channel === "bridge:openMemoryDir" && ++openAttempts === 1) {
        throw new Error("系统打开目录失败");
      }
      return fallback(channel, request);
    });
    renderSection({ client });
    await screen.findByText("用户喜欢先看结论");

    await user.click(screen.getByRole("button", { name: "打开本地记忆目录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("系统打开目录失败");
    await user.click(screen.getByRole("button", { name: "重新打开记忆目录" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(openAttempts).toBe(2);
  });
});
