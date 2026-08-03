import { createStore, type StoreApi } from "zustand/vanilla";

export interface NotificationItem {
  id: string;
  text: string;
  read: boolean;
  createdAt: number;
  kind: "task-done" | "approval-needed" | "compact" | "generic";
  conversationId?: string;
}

export interface NotificationsState {
  items: NotificationItem[];
  unreadCount: number;
  toasts: NotificationItem[];
  push(n: Omit<NotificationItem, "id" | "read" | "createdAt">): void;
  markRead(id: string): void;
  markAllRead(): void;
  dismissToast(id: string): void;
}

type LegacyNotification = Partial<NotificationItem> & Pick<NotificationItem, "id" | "text" | "read">;

function normalize(item: LegacyNotification): NotificationItem {
  return {
    id: item.id,
    text: item.text,
    read: item.read,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
    kind: item.kind ?? "generic",
    ...(item.conversationId ? { conversationId: item.conversationId } : {}),
  };
}

function allocateId(usedIds: Set<string>, nextId: { value: number }): string {
  let id: string;
  do {
    id = `notification-${nextId.value++}`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

export function createNotificationsStore(items: LegacyNotification[] = []): StoreApi<NotificationsState> {
  const nextId = { value: 1 };
  const normalized = items.map(normalize);
  const usedIds = new Set(normalized.map((item) => item.id));

  return createStore<NotificationsState>((set) => ({
    items: normalized,
    unreadCount: normalized.filter((item) => !item.read).length,
    toasts: [],
    push: (notification) => {
      const item: NotificationItem = {
        ...notification,
        id: allocateId(usedIds, nextId),
        read: false,
        createdAt: Date.now(),
      };
      set((state) => ({
        items: [item, ...state.items],
        toasts: [item, ...state.toasts],
        unreadCount: state.unreadCount + 1,
      }));
    },
    markRead: (id) => set((state) => {
      const target = state.items.find((item) => item.id === id);
      if (!target || target.read) return state;
      return {
        items: state.items.map((item) => item.id === id ? { ...item, read: true } : item),
        unreadCount: Math.max(0, state.unreadCount - 1),
        toasts: state.toasts.filter((item) => item.id !== id),
      };
    }),
    markAllRead: () => set((state) => ({
      items: state.items.map((item) => ({ ...item, read: true })),
      unreadCount: 0,
      toasts: [],
    })),
    dismissToast: (id) => set((state) => {
      if (!state.toasts.some((item) => item.id === id)) return state;
      return { toasts: state.toasts.filter((item) => item.id !== id) };
    }),
  }));
}
