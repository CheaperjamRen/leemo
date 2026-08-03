import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildComputerMcpRuntime,
  buildPlaywrightMcpRuntime,
  detectBrowserChannel,
  resolveComputerMcpExecutable,
} from "../../src/main/mcp-runtime";

describe("Playwright MCP runtime", () => {
  it("runs the packaged CLI through Electron-as-Node with a persistent profile", () => {
    const runtime = buildPlaywrightMcpRuntime({
      packageJsonPath: path.join("C:\\app", "node_modules", "@playwright", "mcp", "package.json"),
      executablePath: "C:\\app\\Leemo.exe",
      dataDir: "C:\\data",
      browser: "chrome",
    }).playwright;
    expect(runtime?.command).toBe("C:\\app\\Leemo.exe");
    expect(runtime?.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(runtime?.args).toContain("--user-data-dir");
    expect(runtime?.args).toContain("chrome");
    expect(runtime?.args?.[0]).toMatch(/@playwright[\\/]mcp[\\/]cli\.js$/);
  });

  it("prefers Chrome when installed and otherwise uses bundled-Windows Edge", () => {
    const env = { PROGRAMFILES: "C:\\Program Files" };
    expect(detectBrowserChannel(env, (p) => p.includes("Google"))).toBe("chrome");
    expect(detectBrowserChannel(env, () => false)).toBe("msedge");
  });
});

describe("Windows computer runtime", () => {
  it("runs the verified standalone executable directly with no Python or Node dependency", () => {
    const runtime = buildComputerMcpRuntime({ executablePath: "C:\\app\\resources\\windows-mcp\\Sbroenne.WindowsMcp.exe" }).computer;
    expect(runtime).toEqual({
      type: "stdio",
      command: "C:\\app\\resources\\windows-mcp\\Sbroenne.WindowsMcp.exe",
      args: [],
      timeout: 30_000,
    });
  });

  it("resolves the checked-in runtime in dev and extraResources runtime after packaging", () => {
    expect(resolveComputerMcpExecutable({
      isPackaged: false,
      resourcesPath: "C:\\ignored",
      moduleDir: "C:\\repo\\dist-electron",
    })).toBe(path.join("C:\\repo", "bundled-runtime", "windows-mcp", "release", "Sbroenne.WindowsMcp.exe"));
    expect(resolveComputerMcpExecutable({
      isPackaged: true,
      resourcesPath: "C:\\app\\resources",
      moduleDir: "C:\\ignored",
    })).toBe(path.join("C:\\app\\resources", "windows-mcp", "Sbroenne.WindowsMcp.exe"));
  });
});
