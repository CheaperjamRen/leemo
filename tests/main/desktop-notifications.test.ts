import { describe, expect, it, vi } from "vitest";
import {
  createDesktopNotifications,
  desktopNotificationsSetting,
} from "../../src/main/desktop-notifications";

function setup(options: { enabled?: boolean; focused?: boolean } = {}) {
  let focused = options.focused ?? false;
  const onClick = vi.fn();
  const presenter = {
    show: vi.fn((notification: { onClick: () => void }) => {
      onClick.mockImplementation(notification.onClick);
      return true;
    }),
  };
  const focusWindow = vi.fn();
  const openTarget = vi.fn();
  const notifications = createDesktopNotifications({
    presenter,
    enabled: options.enabled,
    isWindowFocused: () => focused,
    focusWindow,
    openTarget,
  });
  return {
    notifications,
    presenter,
    focusWindow,
    openTarget,
    click: () => onClick(),
    setFocused: (value: boolean) => { focused = value; },
  };
}

describe("桌面通知", () => {
  it("旧版或损坏的设置沿用开启默认值", () => {
    expect(desktopNotificationsSetting(undefined)).toBe(true);
    expect(desktopNotificationsSetting({})).toBe(true);
    expect(desktopNotificationsSetting({ desktopNotifications: "false" })).toBe(true);
    expect(desktopNotificationsSetting({ desktopNotifications: false })).toBe(false);
  });

  it("窗口在前台或用户关闭设置时不打扰", () => {
    const foreground = setup({ focused: true });
    expect(foreground.notifications.notify("task-done")).toBe(false);
    expect(foreground.presenter.show).not.toHaveBeenCalled();

    const disabled = setup({ enabled: false });
    expect(disabled.notifications.notify("approval")).toBe(false);
    expect(disabled.presenter.show).not.toHaveBeenCalled();
  });

  it("后台任务完成和失败只显示隐私安全的固定文案", () => {
    const { notifications, presenter } = setup();

    expect(notifications.notify("task-done")).toBe(true);
    expect(notifications.notify("task-failed")).toBe(true);
    expect(presenter.show).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "momo 完成了一项任务",
      body: "回到 Leemo 查看结果",
    }));
    expect(presenter.show).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "任务没有完成",
      body: "回到 Leemo 查看原因或重试",
    }));
  });

  it("待确认和待回答使用明确但克制的文案", () => {
    const { notifications, presenter } = setup();

    notifications.notify("approval");
    notifications.notify("question");
    expect(presenter.show).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "momo 需要你确认",
      body: "有一步操作正在等你处理",
    }));
    expect(presenter.show).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "momo 在等你回答",
      body: "回答后任务会继续进行",
    }));
  });

  it("点击系统通知只唤回 Leemo，不泄露或改写用户工作状态", () => {
    const { notifications, focusWindow, click } = setup();
    notifications.notify("task-done");

    click();
    expect(focusWindow).toHaveBeenCalledOnce();
  });

  it("点击带来源的通知会回到对应对话或待办区", () => {
    const { notifications, focusWindow, openTarget, click } = setup();
    notifications.notify("approval", { kind: "conversation", conversationId: "conv-1" });

    click();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(openTarget).toHaveBeenCalledWith({ kind: "conversation", conversationId: "conv-1" });
  });

  it("热关闭立即生效，通知服务异常不会影响任务", () => {
    const onError = vi.fn();
    const notifications = createDesktopNotifications({
      presenter: { show: vi.fn(() => { throw new Error("system unavailable"); }) },
      isWindowFocused: () => false,
      focusWindow: vi.fn(),
      onError,
    });

    expect(notifications.notify("task-done")).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    notifications.setEnabled(false);
    expect(notifications.notify("approval")).toBe(false);
  });
});
