import { describe, expect, it, vi } from "vitest";
import {
  createQuickCaptureController,
  type QuickCaptureMenuItem,
} from "../../src/main/quick-capture-window";

type PreventableEvent = { preventDefault(): void };

function setup(options: {
  shortcutAvailable?: boolean;
  unavailableShortcuts?: readonly string[];
  backgroundEnabled?: boolean;
  shortcut?: string;
} = {}) {
  let shortcutCallback: (() => void) | undefined;
  let captureClose: ((event: PreventableEvent) => void) | undefined;
  let captureClosed: (() => void) | undefined;
  let captureInput: ((event: PreventableEvent, input: { key: string }) => void) | undefined;
  let mainClose: ((event: PreventableEvent) => void) | undefined;
  let menuItems: readonly QuickCaptureMenuItem[] = [];
  let backgroundEnabled = options.backgroundEnabled ?? true;
  let shortcut = options.shortcut ?? "Alt+N";
  let captureDestroyed = false;

  const captureWindow = {
    isDestroyed: vi.fn(() => captureDestroyed),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(() => { captureDestroyed = true; }),
    on: vi.fn((event: "close" | "closed", listener: ((event: PreventableEvent) => void) | (() => void)) => {
      if (event === "close") captureClose = listener as (event: PreventableEvent) => void;
      else captureClosed = listener as () => void;
    }),
    webContents: {
      on: vi.fn((_event: "before-input-event", listener: (event: PreventableEvent, input: { key: string }) => void) => {
        captureInput = listener;
      }),
    },
  };
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    hide: vi.fn(),
    on: vi.fn((_event: "close", listener: (event: PreventableEvent) => void) => { mainClose = listener; }),
  };
  const tray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    destroy: vi.fn(),
  };
  const menu = { kind: "menu" };
  const deps = {
    createCaptureWindow: vi.fn(() => captureWindow),
    createTray: vi.fn(() => tray),
    buildMenu: vi.fn((items: readonly QuickCaptureMenuItem[]) => {
      menuItems = items;
      return menu;
    }),
    registerShortcut: vi.fn((_accelerator: string, callback: () => void) => {
      shortcutCallback = callback;
      return (options.shortcutAvailable ?? true)
        && !(options.unavailableShortcuts ?? []).includes(_accelerator);
    }),
    unregisterShortcut: vi.fn(),
    backgroundEnabled: vi.fn(() => backgroundEnabled),
    shortcut: vi.fn(() => shortcut),
    focusMainWindow: vi.fn(),
    quitApp: vi.fn(),
  };
  const controller = createQuickCaptureController(deps);

  return {
    controller,
    deps,
    tray,
    captureWindow,
    mainWindow,
    menu,
    getMenuItems: () => menuItems,
    triggerShortcut: () => shortcutCallback?.(),
    emitCaptureClose: (event: PreventableEvent) => captureClose?.(event),
    emitCaptureClosed: () => captureClosed?.(),
    emitCaptureInput: (event: PreventableEvent, key: string) => captureInput?.(event, { key }),
    emitMainClose: (event: PreventableEvent) => mainClose?.(event),
    setBackgroundEnabled: (value: boolean) => { backgroundEnabled = value; },
    setShortcut: (value: string) => { shortcut = value; },
  };
}

describe("快捷便签桌面生命周期", () => {
  it("重复唤起只复用一个快捷窗并把它显示到前台", () => {
    const f = setup();
    expect(f.controller.start()).toEqual({ ok: true });

    f.triggerShortcut();
    f.triggerShortcut();

    expect(f.deps.createCaptureWindow).toHaveBeenCalledOnce();
    expect(f.captureWindow.show).toHaveBeenCalledTimes(2);
    expect(f.captureWindow.focus).toHaveBeenCalledTimes(2);
  });

  it("快捷窗的关闭按钮和 Escape 都只隐藏窗口", () => {
    const f = setup();
    f.controller.start();
    f.triggerShortcut();
    const closeEvent = { preventDefault: vi.fn() };
    const escapeEvent = { preventDefault: vi.fn() };

    f.emitCaptureClose(closeEvent);
    f.emitCaptureInput(escapeEvent, "Escape");

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(escapeEvent.preventDefault).toHaveBeenCalledOnce();
    expect(f.captureWindow.hide).toHaveBeenCalledTimes(2);
    expect(f.captureWindow.destroy).not.toHaveBeenCalled();
  });

  it("后台运行开启时主窗口关闭只隐藏，关闭后台运行后恢复正常退出语义", () => {
    const f = setup({ backgroundEnabled: true });
    f.controller.bindMainWindow(f.mainWindow);
    const backgroundClose = { preventDefault: vi.fn() };

    f.emitMainClose(backgroundClose);
    expect(backgroundClose.preventDefault).toHaveBeenCalledOnce();
    expect(f.mainWindow.hide).toHaveBeenCalledOnce();

    f.setBackgroundEnabled(false);
    const normalClose = { preventDefault: vi.fn() };
    f.emitMainClose(normalClose);
    expect(normalClose.preventDefault).not.toHaveBeenCalled();
  });

  it("明确退出会销毁桌面资源、注销快捷键，再请求应用退出", () => {
    const f = setup();
    f.controller.start();
    f.triggerShortcut();

    f.controller.requestQuit();

    expect(f.deps.unregisterShortcut).toHaveBeenCalledWith("Alt+N");
    expect(f.captureWindow.destroy).toHaveBeenCalledOnce();
    expect(f.tray.destroy).toHaveBeenCalledOnce();
    expect(f.deps.quitApp).toHaveBeenCalledOnce();
  });

  it("托盘只提供快速记一条、打开 Leemo、退出 Leemo 三项", () => {
    const f = setup();
    f.controller.start();

    expect(f.getMenuItems().map((item) => item.label)).toEqual([
      "快速记一条",
      "打开 Leemo",
      "退出 Leemo",
    ]);
    f.getMenuItems()[0]?.click();
    f.getMenuItems()[1]?.click();
    expect(f.captureWindow.show).toHaveBeenCalledOnce();
    expect(f.deps.focusMainWindow).toHaveBeenCalledOnce();
    f.getMenuItems()[2]?.click();
    expect(f.deps.quitApp).toHaveBeenCalledOnce();
  });

  it("Alt+N 注册冲突返回用户能看懂的失败，托盘入口仍可用", () => {
    const f = setup({ shortcutAvailable: false });

    expect(f.controller.start()).toEqual({
      ok: false,
      error: "Alt+N 已被其他应用占用，请从托盘打开快捷便签。",
    });
    expect(f.tray.setContextMenu).toHaveBeenCalledWith(f.menu);
    f.getMenuItems()[0]?.click();
    expect(f.captureWindow.show).toHaveBeenCalledOnce();
  });

  it("设置中更换快捷键会先注册新组合，再注销旧组合", () => {
    const f = setup();
    expect(f.controller.start()).toEqual({ ok: true });

    expect(f.controller.updateShortcut("Ctrl+Shift+N")).toEqual({ ok: true });
    expect(f.deps.registerShortcut).toHaveBeenLastCalledWith(
      "Ctrl+Shift+N",
      expect.any(Function),
    );
    expect(f.deps.unregisterShortcut).toHaveBeenCalledWith("Alt+N");
  });

  it("新快捷键冲突时保留原快捷键并给出可读错误", () => {
    const f = setup({ unavailableShortcuts: ["Ctrl+Shift+N"] });
    expect(f.controller.start()).toEqual({ ok: true });

    expect(f.controller.updateShortcut("Ctrl+Shift+N")).toEqual({
      ok: false,
      error: "Ctrl+Shift+N 已被其他应用占用，Alt+N 仍可继续使用。",
    });
    expect(f.deps.unregisterShortcut).not.toHaveBeenCalled();
  });
});
