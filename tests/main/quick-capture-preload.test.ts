import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => electron.exposed.set(name, value),
  },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: electron.on,
    removeListener: electron.removeListener,
  },
  webUtils: { getPathForFile: vi.fn() },
}));

beforeEach(() => {
  electron.exposed.clear();
  electron.invoke.mockReset();
  electron.send.mockReset();
  electron.on.mockReset();
  electron.removeListener.mockReset();
  vi.resetModules();
});

describe("快捷便签 preload 权限边界", () => {
  it("快捷窗只得到草稿、待办创建、提交和最小附件挂载能力", async () => {
    await import("../../src/main/quick-capture-preload");

    expect([...electron.exposed.keys()]).toEqual(["leemoQuickCapture"]);
    const api = electron.exposed.get("leemoQuickCapture") as Record<string, unknown>;
    expect(Object.keys(api).sort()).toEqual([
      "attachDroppedFile",
      "attachImageBytes",
      "commitQuickDraft",
      "createTask",
      "getQuickDraft",
      "hide",
      "onChanged",
      "pathForFile",
      "saveQuickDraft",
    ]);
  });

  it("主窗口得到完整便签接口和需确认成功的桌面设置接口", async () => {
    await import("../../src/main/preload");

    const capture = electron.exposed.get("leemoCapture") as Record<string, unknown>;
    const desktop = electron.exposed.get("leemoDesktop") as Record<string, unknown>;
    const windowControls = electron.exposed.get("leemoWindow") as Record<string, unknown>;
    const about = electron.exposed.get("leemoAbout") as Record<string, unknown>;
    expect(Object.keys(capture).sort()).toEqual(["invoke", "onChanged"]);
    expect(Object.keys(desktop).sort()).toEqual([
      "chooseCaptureStorageRoot",
      "configure",
      "onNavigate",
      "openCaptureStorageRoot",
    ]);
    expect(Object.keys(about).sort()).toEqual(["getInfo", "openLogsDirectory"]);
    expect(Object.keys(windowControls).sort()).toEqual([
      "close",
      "getState",
      "minimize",
      "onMaximizedChanged",
      "toggleMaximize",
    ]);

    electron.invoke.mockResolvedValueOnce({ ok: true });
    await (desktop.openCaptureStorageRoot as () => Promise<unknown>)();
    expect(electron.invoke).toHaveBeenCalledWith("leemo:open-capture-storage-root");

    electron.invoke.mockResolvedValueOnce({ ok: true });
    await (about.openLogsDirectory as () => Promise<unknown>)();
    expect(electron.invoke).toHaveBeenLastCalledWith("leemo:about", { op: "openLogsDirectory" });
  });
});
