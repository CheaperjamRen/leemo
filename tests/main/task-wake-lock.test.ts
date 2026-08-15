import { describe, expect, it, vi } from "vitest";
import { createTaskWakeLock, keepAwakeSetting } from "../../src/main/task-wake-lock";

function setup(enabled = true) {
  const blocker = {
    start: vi.fn(() => 17),
    stop: vi.fn(),
  };
  const wakeLock = createTaskWakeLock({ blocker, enabled });
  return { blocker, wakeLock };
}

describe("任务运行时系统唤醒锁", () => {
  it("旧版或损坏的设置沿用可靠的默认值", () => {
    expect(keepAwakeSetting(undefined)).toBe(true);
    expect(keepAwakeSetting({})).toBe(true);
    expect(keepAwakeSetting({ keepAwakeDuringTasks: "false" })).toBe(true);
    expect(keepAwakeSetting({ keepAwakeDuringTasks: false })).toBe(false);
  });

  it("第一个任务开始时申请一次阻止系统休眠的锁，最后一个结束时释放", () => {
    const { blocker, wakeLock } = setup();

    expect(wakeLock.begin("conversation:a")).toBe(true);
    expect(wakeLock.begin("conversation:b")).toBe(true);
    expect(blocker.start).toHaveBeenCalledOnce();
    expect(blocker.start).toHaveBeenCalledWith("prevent-app-suspension");

    wakeLock.end("conversation:a");
    expect(blocker.stop).not.toHaveBeenCalled();
    wakeLock.end("conversation:b");
    expect(blocker.stop).toHaveBeenCalledOnce();
    expect(blocker.stop).toHaveBeenCalledWith(17);
  });

  it("同一任务重复开始不会重复计数或错误释放", () => {
    const { blocker, wakeLock } = setup();

    expect(wakeLock.begin("conversation:a")).toBe(true);
    expect(wakeLock.begin("conversation:a")).toBe(false);
    wakeLock.end("conversation:missing");
    expect(blocker.start).toHaveBeenCalledOnce();
    expect(blocker.stop).not.toHaveBeenCalled();

    wakeLock.end("conversation:a");
    expect(blocker.stop).toHaveBeenCalledOnce();
  });

  it("设置热切换会立即释放，并在仍有任务时重新申请", () => {
    const { blocker, wakeLock } = setup();
    wakeLock.begin("conversation:a");

    wakeLock.setEnabled(false);
    expect(blocker.stop).toHaveBeenCalledWith(17);

    blocker.start.mockReturnValue(29);
    wakeLock.setEnabled(true);
    expect(blocker.start).toHaveBeenCalledTimes(2);
    wakeLock.end("conversation:a");
    expect(blocker.stop).toHaveBeenLastCalledWith(29);
  });

  it("默认关闭时记录任务但不申请锁，退出时始终清理", () => {
    const { blocker, wakeLock } = setup(false);
    wakeLock.begin("conversation:a");
    expect(blocker.start).not.toHaveBeenCalled();

    wakeLock.setEnabled(true);
    expect(blocker.start).toHaveBeenCalledOnce();
    wakeLock.dispose();
    expect(blocker.stop).toHaveBeenCalledOnce();
    expect(wakeLock.activeCount()).toBe(0);
  });
});
