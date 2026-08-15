import { describe, expect, it, vi } from "vitest";
import { createLaunchAtLogin, launchAtLoginSetting } from "../../src/main/launch-at-login";

describe("开机自动启动", () => {
  it("旧版或损坏的设置默认不修改用户的开机启动项", () => {
    expect(launchAtLoginSetting(undefined)).toBe(false);
    expect(launchAtLoginSetting({})).toBe(false);
    expect(launchAtLoginSetting({ launchAtLogin: "true" })).toBe(false);
    expect(launchAtLoginSetting({ launchAtLogin: true })).toBe(true);
  });

  it("把首次读取和后续热切换同步到系统", () => {
    const apply = vi.fn();
    const launch = createLaunchAtLogin({ apply });

    expect(launch.setEnabled(false)).toBe(true);
    expect(launch.setEnabled(false)).toBe(false);
    expect(launch.setEnabled(true)).toBe(true);
    expect(apply.mock.calls).toEqual([[false], [true]]);
  });

  it("系统接口失败时不崩溃，并允许下次重试同一个值", () => {
    const onError = vi.fn();
    const apply = vi.fn()
      .mockImplementationOnce(() => { throw new Error("registry unavailable"); })
      .mockImplementationOnce(() => undefined);
    const launch = createLaunchAtLogin({ apply, onError });

    expect(launch.setEnabled(true)).toBe(false);
    expect(launch.setEnabled(true)).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
  });
});
