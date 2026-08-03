import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { NotificationPanel } from "./NotificationPanel";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import type { NotificationItem } from "../stores/notifications";

const ITEMS: NotificationItem[] = [
  { id: "n1", text: "第一项任务完成", read: false, createdAt: 1, kind: "task-done" },
  { id: "n2", text: "需要确认操作", read: false, createdAt: 2, kind: "approval-needed" },
];

function renderPanel(items: NotificationItem[] = ITEMS) {
  let stores!: BridgeStores;
  const onClose = vi.fn();
  function Seed() {
    stores = useContext(BridgeContext)!;
    stores.notifications.setState({
      items,
      unreadCount: items.filter((item) => !item.read).length,
      toasts: [],
    });
    return <NotificationPanel onClose={onClose} />;
  }
  const view = render(
    <BridgeProvider>
      <Seed />
    </BridgeProvider>,
  );
  return { ...view, stores, onClose };
}

describe("NotificationPanel", () => {
  it("renders notification list header", () => {
    renderPanel();

    expect(screen.getByText("通知")).toBeInTheDocument();
  });

  it("renders mark all read button", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: /全部已读/i })).toBeInTheDocument();
  });

  it("renders notification items as accessible actions", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /第一项任务完成/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /需要确认操作/ })).toBeInTheDocument();
  });

  it("clicking one item marks only that item read", async () => {
    const user = userEvent.setup();
    const { stores, onClose } = renderPanel();

    await user.click(screen.getByRole("button", { name: /第一项任务完成/ }));

    expect(stores.notifications.getState().items.find((item) => item.id === "n1")?.read).toBe(true);
    expect(stores.notifications.getState().items.find((item) => item.id === "n2")?.read).toBe(false);
    expect(stores.notifications.getState().unreadCount).toBe(1);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("marks all notifications read without relying on an item click", async () => {
    const user = userEvent.setup();
    const { stores } = renderPanel();
    await user.click(screen.getByRole("button", { name: /全部已读/ }));
    expect(stores.notifications.getState().unreadCount).toBe(0);
    expect(stores.notifications.getState().items.every((item) => item.read)).toBe(true);
  });

  it("opens the source conversation when a notification points to one", async () => {
    const user = userEvent.setup();
    const item: NotificationItem = {
      ...ITEMS[0],
      conversationId: "conv-notification",
    };
    const { stores } = renderPanel([item]);
    act(() => {
      stores.conversations.setState({
        byId: {
          "conv-notification": {
            id: "conv-notification",
            title: "通知来源",
            titleManuallyUpdated: true,
            bookId: null,
            source: "workbench",
            providerId: "deepseek",
            modelId: "deepseek-chat",
            createdAt: 1,
            lastActivityAt: 1,
            unread: true,
          },
        },
        order: ["conv-notification"],
      });
      stores.ui.getState().setView("skills");
    });

    await user.click(screen.getByRole("button", { name: /第一项任务完成/ }));
    expect(stores.conversations.getState().activeId).toBe("conv-notification");
    expect(stores.ui.getState().view).toBe("chat");
  });

  it("shows a deliberate empty state", () => {
    renderPanel([]);
    expect(screen.getByText("暂时没有通知")).toBeInTheDocument();
    expect(screen.queryAllByTestId("notification-item")).toHaveLength(0);
  });

  it("the close button closes the panel", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
