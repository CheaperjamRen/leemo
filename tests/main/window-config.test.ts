import { describe, expect, it } from "vitest";
import { MAIN_WINDOW_OPTIONS, QUICK_CAPTURE_WINDOW_OPTIONS } from "../../src/main/window-config";

describe("主窗口尺寸配置", () => {
  it("保持足够宽高，避免工作台布局在窄窗口中互相遮挡", () => {
    expect(MAIN_WINDOW_OPTIONS).toMatchObject({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 680,
      autoHideMenuBar: true,
      frame: false,
    });
  });
});

describe("快捷便签窗口尺寸配置", () => {
  it("保留一半以上的正文空间，同时维持快捷记录的紧凑感", () => {
    expect(QUICK_CAPTURE_WINDOW_OPTIONS).toMatchObject({
      width: 600,
      height: 500,
      minWidth: 440,
      minHeight: 360,
      show: false,
      autoHideMenuBar: true,
      frame: false,
    });
  });
});
