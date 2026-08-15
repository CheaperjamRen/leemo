export type DesktopNotificationKind = "task-done" | "task-failed" | "approval" | "question";
export type DesktopNotificationTarget =
  | { kind: "conversation"; conversationId: string }
  | { kind: "task"; taskId: string };

export interface DesktopNotificationOptions {
  title: string;
  body: string;
  onClick: () => void;
}

export interface DesktopNotificationPresenter {
  show(options: DesktopNotificationOptions): boolean;
}

export interface DesktopNotifications {
  setEnabled(enabled: boolean): void;
  notify(kind: DesktopNotificationKind, target?: DesktopNotificationTarget): boolean;
}

interface DesktopNotificationDeps {
  presenter: DesktopNotificationPresenter;
  isWindowFocused(): boolean;
  focusWindow(): void;
  openTarget?(target: DesktopNotificationTarget): void;
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

const COPY: Record<DesktopNotificationKind, Pick<DesktopNotificationOptions, "title" | "body">> = {
  "task-done": {
    title: "momo 完成了一项任务",
    body: "回到 Leemo 查看结果",
  },
  "task-failed": {
    title: "任务没有完成",
    body: "回到 Leemo 查看原因或重试",
  },
  approval: {
    title: "momo 需要你确认",
    body: "有一步操作正在等你处理",
  },
  question: {
    title: "momo 在等你回答",
    body: "回答后任务会继续进行",
  },
};

/** Persisted settings come from releases with different schemas. Invalid or
 * absent values keep the product default instead of silently disabling a
 * reliability feature after an upgrade. */
export function desktopNotificationsSetting(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return true;
  const value = (settings as Record<string, unknown>).desktopNotifications;
  return typeof value === "boolean" ? value : true;
}

/**
 * Main-process policy for native desktop notifications. The service accepts
 * semantic events rather than arbitrary text so conversation content and local
 * filenames can never leak onto the lock screen by accident.
 */
export function createDesktopNotifications(deps: DesktopNotificationDeps): DesktopNotifications {
  let enabled = deps.enabled ?? true;

  return {
    setEnabled(value) {
      enabled = Boolean(value);
    },

    notify(kind, target) {
      if (!enabled || deps.isWindowFocused()) return false;
      try {
        const copy = COPY[kind];
        return deps.presenter.show({
          ...copy,
          onClick: () => {
            deps.focusWindow();
            if (target) deps.openTarget?.(target);
          },
        });
      } catch (error: unknown) {
        deps.onError?.(error);
        return false;
      }
    },
  };
}
