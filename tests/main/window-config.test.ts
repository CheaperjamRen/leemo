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
  it("首次创建保持紧凑但仍可容纳微型编辑器", () => {
    expect(QUICK_CAPTURE_WINDOW_OPTIONS).toMatchObject({
      width: 520,
      height: 420,
      minWidth: 400,
      minHeight: 300,
      show: false,
      autoHideMenuBar: true,
      frame: false,
    });
  });
});
