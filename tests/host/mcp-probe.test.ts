import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../../src/host/mcp-probe";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../fixtures/mcp-stdio-server.mjs");

describe("probeMcpServer", () => {
  it("performs a real MCP initialize + tools/list without a model", async () => {
    const result = await probeMcpServer({
      type: "stdio",
      command: process.execPath,
      args: [FIXTURE],
    }, process.cwd(), 5_000);
    expect(result.ok).toBe(true);
    expect(result.tools).toEqual([expect.objectContaining({ name: "echo" })]);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails boundedly and never echoes env secrets", async () => {
    const result = await probeMcpServer({
      type: "stdio",
      command: "definitely-not-a-real-mcp-command",
      env: { MCP_TOKEN: "secret-should-never-return" },
    }, process.cwd(), 1_000);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/启动失败|立即退出/);
    expect(JSON.stringify(result)).not.toContain("secret-should-never-return");
  });

  it("distinguishes an installed MCP component from a Chrome extension that is not connected", async () => {
    const result = await probeMcpServer({
      type: "stdio",
      command: process.execPath,
      args: [FIXTURE, "--browser-tabs-waiting"],
    }, process.cwd(), 5_000, { verifyBrowserTabs: true });

    expect(result).toMatchObject({
      ok: false,
      state: "waiting-for-browser",
      error: "Chrome 还没有连接。请安装或打开浏览器连接扩展，然后再试。",
    });
    expect(result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "browser_tabs" })]));
  });

  it("reports the current Chrome path ready only after a real tab call succeeds", async () => {
    const result = await probeMcpServer({
      type: "stdio",
      command: process.execPath,
      args: [FIXTURE, "--browser-tabs-connected"],
    }, process.cwd(), 5_000, { verifyBrowserTabs: true });

    expect(result).toMatchObject({ ok: true, state: "ready" });
  });

  it("marks desktop control ready only after a real desktop-window read succeeds", async () => {
    const result = await probeMcpServer({
      type: "stdio",
      command: process.execPath,
      args: [FIXTURE, "--computer-ready"],
    }, process.cwd(), 5_000, { verifyComputerDesktop: true });

    expect(result).toMatchObject({ ok: true, state: "ready" });
    expect(result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "window_management" })]));
  });
});
