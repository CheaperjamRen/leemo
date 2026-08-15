import { describe, expect, it, vi } from "vitest";
import { createAboutIpcHandler } from "../../src/main/about-ipc";

function dependencies() {
  return {
    isAuthorized: vi.fn((sender: unknown) => sender === "trusted"),
    getInfo: vi.fn(() => ({
      version: "0.9.7",
      platform: "win32",
      arch: "x64",
      packaged: true,
    })),
    getLogsDirectory: vi.fn(() => "E:\\private-user\\logs"),
    ensureDirectory: vi.fn(async (_directory: string) => undefined),
    writeTextFile: vi.fn(async (_filePath: string, _content: string) => undefined),
    openPath: vi.fn(async (_target: string) => ""),
  };
}

describe("about IPC", () => {
  it("returns only real runtime metadata and a fixed safe diagnostic summary", async () => {
    const deps = dependencies();
    const handle = createAboutIpcHandler(deps);

    const result = await handle("trusted", { op: "getInfo" });

    expect(result).toEqual({
      ok: true,
      response: {
        version: "0.9.7",
        platform: "win32",
        arch: "x64",
        packaged: true,
        diagnostics: "Leemo 0.9.7\n平台: win32\n架构: x64\n运行方式: 已打包",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-user|API[_ ]?Key|conversation/i);
  });

  it("creates a safe diagnostic file before opening Electron's logs directory", async () => {
    const deps = dependencies();
    const handle = createAboutIpcHandler(deps);

    const result = await handle("trusted", { op: "openLogsDirectory" });

    expect(result).toEqual({ ok: true });
    expect(deps.ensureDirectory).toHaveBeenCalledWith("E:\\private-user\\logs");
    expect(deps.writeTextFile).toHaveBeenCalledWith(
      "E:\\private-user\\logs\\Leemo-diagnostics.txt",
      "Leemo 0.9.7\n平台: win32\n架构: x64\n运行方式: 已打包\n",
    );
    expect(deps.openPath).toHaveBeenCalledWith("E:\\private-user\\logs");
    expect(deps.writeTextFile.mock.calls[0]?.[1]).not.toMatch(/private-user|API[_ ]?Key|conversation/i);
  });

  it("rejects requests that do not come from the main renderer", async () => {
    const deps = dependencies();
    const handle = createAboutIpcHandler(deps);

    await expect(handle("other-window", { op: "getInfo" })).resolves.toEqual({
      ok: false,
      error: "无法确认设置窗口身份。",
    });
    expect(deps.getInfo).not.toHaveBeenCalled();
  });
});
