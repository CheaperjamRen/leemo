export interface QuickCapturePreventableEvent {
  preventDefault(): void;
}

export interface QuickCaptureWindowLike {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
  hide(): void;
  destroy(): void;
  on(
    event: "close" | "closed",
    listener: ((event: QuickCapturePreventableEvent) => void) | (() => void),
  ): unknown;
  webContents: {
    on(
      event: "before-input-event",
      listener: (event: QuickCapturePreventableEvent, input: { key: string }) => void,
    ): unknown;
  };
}

export interface QuickCaptureMainWindowLike {
  isDestroyed(): boolean;
  hide(): void;
  on(event: "close", listener: (event: QuickCapturePreventableEvent) => void): unknown;
}

export interface QuickCaptureTrayLike {
  setToolTip(label: string): void;
  setContextMenu(menu: unknown): void;
  destroy(): void;
}

export interface QuickCaptureMenuItem {
  label: string;
  click(): void;
}

export interface QuickCaptureControllerDeps {
  createCaptureWindow(): QuickCaptureWindowLike;
  createTray(): QuickCaptureTrayLike;
  buildMenu(items: readonly QuickCaptureMenuItem[]): unknown;
  registerShortcut(accelerator: string, callback: () => void): boolean;
  unregisterShortcut(accelerator: string): void;
  backgroundEnabled(): boolean;
  shortcut(): string;
  focusMainWindow(): void;
  quitApp(): void;
}

export type QuickCaptureStartResult =
  | { ok: true }
  | { ok: false; error: string };

export interface QuickCaptureController {
  start(): QuickCaptureStartResult;
  showCapture(): void;
  bindMainWindow(window: QuickCaptureMainWindowLike): void;
  updateShortcut(shortcut: string): QuickCaptureStartResult;
  dispose(): void;
  requestQuit(): void;
}

/**
 * Owns only desktop lifecycle policy. Electron construction stays injected so
 * a failed shortcut registration or Windows close event can be tested without
 * starting Chromium.
 */
export function createQuickCaptureController(
  deps: QuickCaptureControllerDeps,
): QuickCaptureController {
  let captureWindow: QuickCaptureWindowLike | null = null;
  let tray: QuickCaptureTrayLike | null = null;
  let registeredShortcut: string | null = null;
  let startResult: QuickCaptureStartResult | null = null;
  let quitting = false;

  const ensureCaptureWindow = (): QuickCaptureWindowLike => {
    if (captureWindow && !captureWindow.isDestroyed()) return captureWindow;
    const next = deps.createCaptureWindow();
    captureWindow = next;
    next.on("close", (event: QuickCapturePreventableEvent) => {
      if (quitting) return;
      event.preventDefault();
      next.hide();
    });
    next.on("closed", () => {
      if (captureWindow === next) captureWindow = null;
    });
    next.webContents.on("before-input-event", (event, input) => {
      if (input.key !== "Escape" || quitting) return;
      event.preventDefault();
      next.hide();
    });
    return next;
  };

  const showCapture = (): void => {
    if (quitting) return;
    const window = ensureCaptureWindow();
    window.show();
    window.focus();
  };

  const dispose = (): void => {
    if (quitting) return;
    quitting = true;
    if (registeredShortcut) {
      deps.unregisterShortcut(registeredShortcut);
      registeredShortcut = null;
    }
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
    captureWindow = null;
    tray?.destroy();
    tray = null;
  };

  const requestQuit = (): void => {
    if (quitting) return;
    dispose();
    deps.quitApp();
  };

  const updateShortcut = (shortcut: string): QuickCaptureStartResult => {
    if (shortcut === registeredShortcut) return { ok: true };
    if (!deps.registerShortcut(shortcut, showCapture)) {
      return registeredShortcut
        ? {
            ok: false,
            error: `${shortcut} 已被其他应用占用，${registeredShortcut} 仍可继续使用。`,
          }
        : {
            ok: false,
            error: `${shortcut} 已被其他应用占用，请从托盘打开快捷便签。`,
          };
    }
    const previous = registeredShortcut;
    registeredShortcut = shortcut;
    if (previous) deps.unregisterShortcut(previous);
    return { ok: true };
  };

  return {
    start() {
      if (startResult) return startResult;
      tray = deps.createTray();
      tray.setToolTip("Leemo");
      tray.setContextMenu(deps.buildMenu([
        { label: "快速记一条", click: showCapture },
        { label: "打开 Leemo", click: deps.focusMainWindow },
        { label: "退出 Leemo", click: requestQuit },
      ]));

      startResult = updateShortcut(deps.shortcut());
      return startResult;
    },
    showCapture,
    bindMainWindow(window) {
      window.on("close", (event) => {
        if (quitting || !deps.backgroundEnabled() || window.isDestroyed()) return;
        event.preventDefault();
        window.hide();
      });
    },
    updateShortcut,
    dispose,
    requestQuit,
  };
}
