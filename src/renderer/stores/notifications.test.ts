import { describe, expect, it } from "vitest";
import { createNotificationsStore, type NotificationItem } from "./notifications";

describe("notifications store", () => {
  it("normalizes legacy items and keeps unreadCount semantics", () => {
    const source = [
      { id: "n1", text: "a", read: false },
      { id: "n2", text: "b", read: true },
    ];
    const store = createNotificationsStore(source);

    expect(store.getState().unreadCount).toBe(1);
    expect(store.getState().items).toEqual([
      { id: "n1", text: "a", read: false, createdAt: 0, kind: "generic" },
      { id: "n2", text: "b", read: true, createdAt: 0, kind: "generic" },
    ]);
    expect(source).toEqual([{ id: "n1", text: "a", read: false }, { id: "n2", text: "b", read: true }]);
    expect(store.getState().toasts).toEqual([]);
  });

  it("pushes a fresh unread item to history and toast without mutating input", () => {
    const store = createNotificationsStore([]);
    const payload: Omit<NotificationItem, "id" | "read" | "createdAt"> = {
      text: "任务完成", kind: "task-done", conversationId: "c1",
    };
    store.getState().push(payload);

    expect(store.getState().items[0]).toMatchObject({ ...payload, id: "notification-1", read: false });
    expect(store.getState().toasts).toEqual([store.getState().items[0]]);
    expect(store.getState().unreadCount).toBe(1);
    expect(payload).toEqual({ text: "任务完成", kind: "task-done", conversationId: "c1" });
  });

  it("skips imported renderer-like ids when allocating a pushed id", () => {
    const store = createNotificationsStore([
      { id: "notification-1", text: "imported", read: true },
    ]);

    store.getState().push({ text: "fresh", kind: "generic" });

    expect(store.getState().items.map((item) => item.id)).toEqual([
      "notification-2",
      "notification-1",
    ]);
  });

  it("marks all history read and clears toasts", () => {
    const store = createNotificationsStore([{ id: "old", text: "old", read: false, kind: "compact", createdAt: 5 }]);
    store.getState().push({ text: "new", kind: "generic" });
    store.getState().markAllRead();

    expect(store.getState().items.every((item) => item.read)).toBe(true);
    expect(store.getState().unreadCount).toBe(0);
    expect(store.getState().toasts).toEqual([]);
  });

  it("marks only the selected notification read", () => {
    const store = createNotificationsStore([
      { id: "n1", text: "one", read: false },
      { id: "n2", text: "two", read: false },
    ]);

    store.getState().markRead("n1");

    expect(store.getState().items.map(({ id, read }) => ({ id, read }))).toEqual([
      { id: "n1", read: true },
      { id: "n2", read: false },
    ]);
    expect(store.getState().unreadCount).toBe(1);
  });

  it("dismisses only matching toasts and makes unknown ids a no-op", () => {
    const store = createNotificationsStore([]);
    store.getState().push({ text: "one", kind: "approval-needed" });
    store.getState().push({ text: "two", kind: "generic" });
    const beforeItems = store.getState().items;
    store.getState().dismissToast("notification-1");

    expect(store.getState().toasts.map((item) => item.text)).toEqual(["two"]);
    expect(store.getState().items).toBe(beforeItems);
    expect(store.getState().unreadCount).toBe(2);
    const toasts = store.getState().toasts;
    store.getState().dismissToast("missing");
    expect(store.getState().toasts).toBe(toasts);
  });
});
