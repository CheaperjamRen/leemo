import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { describe, expect, it, vi } from "vitest";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import ArchivedContentSettings from "./ArchivedContentSettings";

function SeedArchives({ onReady }: { onReady?: (stores: BridgeStores) => void }): null {
  const stores = useContext(BridgeContext) as BridgeStores;
  if (!stores.conversations.getState().byId["archived-chat"]) {
    stores.conversations.setState({
      byId: {
        "archived-chat": {
          id: "archived-chat",
          title: "求职故事",
          titleManuallyUpdated: true,
          source: "workbench",
          providerId: "deepseek",
          modelId: "deepseek-v4-flash",
          createdAt: 1,
          lastActivityAt: 2,
          unread: false,
          workspaceId: HOME_WORKSPACE_ID,
          bookId: "career",
          pinned: false,
          archived: true,
        },
      },
      order: ["archived-chat"],
      activeId: null,
      timelines: { "archived-chat": [] },
      runIds: { "archived-chat": null },
      archiveConversation: async (id, archived) => {
        stores.conversations.setState((state) => ({
          byId: { ...state.byId, [id]: { ...state.byId[id], archived } },
        }));
      },
      deleteConversation: async (id) => {
        stores.conversations.setState((state) => {
          const byId = { ...state.byId };
          delete byId[id];
          return { byId, order: state.order.filter((candidate) => candidate !== id) };
        });
      },
    });
    stores.notebooks.setState({
      list: [{
        id: "career",
        title: "秋招与求职",
        dir: "C:/Leemo/秋招与求职",
        color: "green",
        hasMemory: false,
        archived: true,
      }],
      setNotebookArchived: async (id, archived) => {
        stores.notebooks.setState((state) => ({
          list: state.list.map((book) => book.id === id ? { ...book, archived } : book),
        }));
        return true;
      },
    });
    stores.workspaces?.setState((state) => ({
      list: [...state.list, {
        id: "workspace-old",
        name: "旧科研项目",
        displayPath: "D:/旧科研项目",
        kind: "external",
        available: true,
        lastOpenedAt: 1,
        archived: true,
      }],
      setArchived: async (id, archived) => {
        stores.workspaces?.setState((current) => ({
          list: current.list.map((workspace) => workspace.id === id ? { ...workspace, archived } : workspace),
        }));
        return true;
      },
    }));
  }
  onReady?.(stores);
  return null;
}

describe("ArchivedContentSettings", () => {
  it("searches archived content and restores each owner through the existing stores", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider>
        <SeedArchives />
        <ArchivedContentSettings />
      </BridgeProvider>,
    );

    const region = screen.getByRole("region", { name: "已归档内容" });
    expect(region).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复对话 求职故事" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复本子 秋招与求职" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复本子 旧科研项目" })).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "搜索已归档内容" });
    await user.type(search, "科研");
    expect(screen.queryByText("求职故事")).not.toBeInTheDocument();
    expect(screen.getByText("旧科研项目")).toBeInTheDocument();
    await user.clear(search);

    await user.click(screen.getByRole("button", { name: "恢复对话 求职故事" }));
    await waitFor(() => expect(screen.queryByText("求职故事")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "恢复本子 秋招与求职" }));
    await waitFor(() => expect(screen.queryByText("秋招与求职")).not.toBeInTheDocument());
  });

  it("requires an explicit confirmation before deleting an archived conversation", async () => {
    const user = userEvent.setup();
    let stores!: BridgeStores;
    render(
      <BridgeProvider>
        <SeedArchives onReady={(value) => { stores = value; }} />
        <ArchivedContentSettings />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "删除对话 求职故事" }));
    expect(screen.getByRole("alertdialog", { name: "删除已归档对话" })).toBeInTheDocument();
    expect(stores.conversations.getState().byId["archived-chat"]).toBeDefined();
    await user.click(screen.getByRole("button", { name: "确认删除对话 求职故事" }));
    await waitFor(() => expect(stores.conversations.getState().byId["archived-chat"]).toBeUndefined());
  });

  it("shows a calm empty state when nothing is archived", () => {
    render(
      <BridgeProvider>
        <ArchivedContentSettings />
      </BridgeProvider>,
    );
    expect(screen.getByText("目前没有已归档内容")).toBeInTheDocument();
  });
});
