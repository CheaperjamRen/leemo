import { useNotifications, useConversations, useUi } from "../bridge/context";
import {
  Archive,
  BellOff,
  CheckCheck,
  CircleCheck,
  Info,
  ShieldAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import type { NotificationItem } from "../stores/notifications";

interface NotificationPanelProps {
  onClose: () => void;
}

function notificationVisual(kind: NotificationItem["kind"]): { Icon: LucideIcon; className: string } {
  switch (kind) {
    case "approval-needed":
      return { Icon: ShieldAlert, className: "bg-[var(--leemo-amber-bg)] text-[var(--leemo-amber)]" };
    case "task-done":
      return { Icon: CircleCheck, className: "bg-[color-mix(in_srgb,var(--leemo-ok)_12%,white)] text-[var(--leemo-ok)]" };
    case "compact":
      return { Icon: Archive, className: "bg-[var(--leemo-bg-deep)] text-[var(--leemo-ink-3)]" };
    case "generic":
      return { Icon: Info, className: "bg-[var(--leemo-bg-deep)] text-[var(--leemo-ink-2)]" };
  }
}

function formatTime(createdAt: number): string {
  if (createdAt <= 0) return "较早";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(createdAt));
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const items = useNotifications((s) => s.items);
  const unreadCount = useNotifications((s) => s.unreadCount);
  const markRead = useNotifications((s) => s.markRead);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const switchActive = useConversations((s) => s.switchActive);
  const setView = useUi((s) => s.setView);

  const handleItemClick = (item: NotificationItem) => {
    markRead(item.id);
    if (item.conversationId) {
      switchActive(item.conversationId);
      setView("chat");
    }
    onClose();
  };

  return (
    <div
      aria-label="通知"
      className="w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-card)] shadow-[0_16px_42px_rgba(40,32,20,0.14)]"
    >
      <div className="flex h-11 items-center gap-2 border-b border-[var(--leemo-line)] px-3.5">
        <h3 className="text-[13px] font-semibold text-[var(--leemo-ink)]">通知</h3>
        {unreadCount > 0 && (
          <span className="rounded-full bg-[var(--leemo-amber-bg)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--leemo-amber-ink)]">
            {unreadCount}
          </span>
        )}
        <button
          type="button"
          onClick={markAllRead}
          disabled={unreadCount === 0}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)] disabled:cursor-default disabled:opacity-40"
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          全部已读
        </button>
        <button
          type="button"
          aria-label="关闭通知"
          title="关闭通知"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="max-h-[420px] overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center">
            <BellOff className="h-5 w-5 text-[var(--leemo-ink-3)]" aria-hidden />
            <p className="text-[12px] text-[var(--leemo-ink-3)]">暂时没有通知</p>
          </div>
        ) : items.map((item) => {
          const { Icon, className } = notificationVisual(item.kind);
          return (
            <button
              key={item.id}
              type="button"
              data-testid="notification-item"
              onClick={() => handleItemClick(item)}
              className={`group flex w-full items-start gap-2.5 rounded-[6px] px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--leemo-side-hover)] ${item.read ? "opacity-70" : ""}`}
            >
              <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[6px] ${className}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] leading-[1.55] text-[var(--leemo-ink-2)]">{item.text}</span>
                <span className="mt-0.5 block text-[10.5px] tabular-nums text-[var(--leemo-ink-3)]">{formatTime(item.createdAt)}</span>
              </span>
              {!item.read && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--leemo-amber)]" aria-label="未读" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
