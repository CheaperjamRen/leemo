import { useEffect, useState } from "react";
import { Bell, CalendarCheck2, Copy, Minus, PanelLeft, PanelLeftClose, PanelLeftOpen, Settings, Square, UserRound, X } from "lucide-react";
import { useNotifications, useUi } from "../bridge/context";
import LeemoMark from "./brand/LeemoMark";
import ModeSwitcher from "./ModeSwitcher";
import "./TopBar.css";

export default function TopBar({
  onOpenHistory,
  onDailyReview,
  dailyReviewBusy = false,
  onStartRelationship,
  relationshipBusy = false,
  navigationControl = "history",
}: {
  onOpenHistory: () => void;
  onDailyReview?: () => void;
  dailyReviewBusy?: boolean;
  onStartRelationship?: () => void;
  relationshipBusy?: boolean;
  navigationControl?: "history" | "sidebar-expanded" | "sidebar-collapsed";
}) {
  const unread = useNotifications((s) => s.unreadCount);
  const openSettings = useUi((s) => s.openSettings);
  const toggleNotifPanel = useUi((s) => s.toggleNotifPanel);
  const windowControls = typeof window === "undefined" ? undefined : window.leemoWindow;
  const [maximized, setMaximized] = useState(false);
  const navigationLabel = navigationControl === "sidebar-expanded"
    ? "收起侧栏"
    : navigationControl === "sidebar-collapsed"
      ? "展开侧栏"
      : "历史对话";
  const NavigationIcon = navigationControl === "sidebar-expanded"
    ? PanelLeftClose
    : navigationControl === "sidebar-collapsed"
      ? PanelLeftOpen
      : PanelLeft;

  useEffect(() => {
    if (!windowControls) return undefined;
    let active = true;
    void windowControls.getState().then((state) => {
      if (active) setMaximized(state.maximized);
    }).catch(() => undefined);
    const unsubscribe = windowControls.onMaximizedChanged(setMaximized);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [windowControls]);

  const toggleWindowMaximized = async (): Promise<void> => {
    if (!windowControls) return;
    try {
      const state = await windowControls.toggleMaximize();
      setMaximized(state.maximized);
    } catch {
      // Losing a window-control race is non-fatal; the native state event will
      // reconcile the icon after the next successful action.
    }
  };
  return (
    <header
      className="leemo-app-topbar leemo-topbar-window-frame fixed inset-x-0 top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--leemo-line-soft)] bg-[var(--leemo-bg)]/90 px-5 backdrop-blur-md"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button, nav")) return;
        void toggleWindowMaximized();
      }}
    >
      <div className="leemo-topbar-start flex items-center gap-4">
        <div className="flex items-center gap-2.5" data-testid="topbar-product-identity">
          <LeemoMark size={24} />
          <span className="text-[18px] font-semibold tracking-[-0.025em] text-[var(--leemo-text-primary)]">Leemo</span>
        </div>
        <div className="leemo-topbar-brand-divider h-6 w-px bg-[var(--leemo-border-soft)]" aria-hidden />
        <button aria-label={navigationLabel} title={navigationLabel} onClick={onOpenHistory} className="leemo-icon-btn leemo-topbar-history">
          <NavigationIcon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
        </button>
      </div>
      <div className="leemo-topbar-actions">
        {(onStartRelationship || onDailyReview) && (
          <div className="leemo-topbar-auxiliary-controls" data-testid="topbar-auxiliary-controls">
            {onStartRelationship && (
              <button
                type="button"
                aria-label="让 momo 认识我"
                title="让 momo 认识我"
                disabled={relationshipBusy}
                onClick={onStartRelationship}
                className="leemo-topbar-relationship-action"
              >
                <UserRound
                  className={`h-[16px] w-[16px] ${relationshipBusy ? "animate-pulse" : ""}`}
                  strokeWidth={1.7}
                  aria-hidden
                />
                <span className="hidden lg:inline">认识我</span>
              </button>
            )}
            {onDailyReview && (
              <button
                aria-label="回顾今天"
                title="回顾今天"
                className="leemo-icon-btn"
                disabled={dailyReviewBusy}
                onClick={onDailyReview}
              >
                <CalendarCheck2
                  className={`h-[18px] w-[18px] ${dailyReviewBusy ? "animate-pulse" : ""}`}
                  strokeWidth={1.7}
                  aria-hidden
                />
              </button>
            )}
          </div>
        )}
        <div className="leemo-topbar-primary-controls" data-testid="topbar-primary-controls">
          <ModeSwitcher className="leemo-mode-switcher-topbar" />
          <span className="leemo-topbar-primary-divider" aria-hidden />
          <button aria-label="设置" title="设置" className="leemo-icon-btn" onClick={() => openSettings()}>
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
          </button>
          <button data-layer-anchor="notifications" aria-label={`通知，${unread} 条未读`} title="通知" className="leemo-icon-btn relative" onClick={toggleNotifPanel}>
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
            {unread > 0 && (
              <span className="absolute right-[7px] top-[7px] h-2 w-2 rounded-full bg-[var(--leemo-danger)] ring-2 ring-[var(--leemo-bg)]" />
            )}
          </button>
        </div>
        {windowControls && (
          <>
            <span className="leemo-topbar-primary-divider" aria-hidden />
            <div className="leemo-topbar-window-controls" role="group" aria-label="窗口控制">
              <button
                type="button"
                className="leemo-window-control"
                aria-label="最小化"
                title="最小化"
                onClick={() => void windowControls.minimize()}
              >
                <Minus aria-hidden />
              </button>
              <button
                type="button"
                className="leemo-window-control"
                aria-label={maximized ? "还原窗口" : "最大化"}
                title={maximized ? "还原窗口" : "最大化"}
                onClick={() => void toggleWindowMaximized()}
              >
                {maximized ? <Copy aria-hidden /> : <Square aria-hidden />}
              </button>
              <button
                type="button"
                className="leemo-window-control leemo-window-control-close"
                aria-label="关闭窗口"
                title="关闭"
                onClick={() => void windowControls.close()}
              >
                <X aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
