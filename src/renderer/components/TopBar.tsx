import { Bell, PanelLeft, Settings } from "lucide-react";
import { useNotifications, useUi } from "../bridge/context";
import ModeSwitcher from "./ModeSwitcher";

export default function TopBar({ onOpenHistory }: { onOpenHistory: () => void }) {
  const unread = useNotifications((s) => s.unreadCount);
  const openSettings = useUi((s) => s.openSettings);
  const toggleNotifPanel = useUi((s) => s.toggleNotifPanel);
  return (
    <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between border-b border-[var(--leemo-line-soft)] bg-[var(--leemo-bg)]/90 px-5 backdrop-blur-md">
      <button aria-label="历史对话" title="历史对话" onClick={onOpenHistory} className="leemo-icon-btn">
        <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
      </button>
      <div className="flex items-center gap-2">
        <ModeSwitcher />
        <div className="mx-0.5 h-5 w-px bg-[var(--leemo-line)]" aria-hidden />
        <button aria-label="设置" title="设置" className="leemo-icon-btn" onClick={() => openSettings()}>
          <Settings className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
        </button>
        <button aria-label={`通知，${unread} 条未读`} title="通知" className="leemo-icon-btn relative" onClick={toggleNotifPanel}>
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
          {unread > 0 && (
            <span className="absolute right-[7px] top-[7px] h-2 w-2 rounded-full bg-[var(--leemo-danger)] ring-2 ring-[var(--leemo-bg)]" />
          )}
        </button>
      </div>
    </header>
  );
}
