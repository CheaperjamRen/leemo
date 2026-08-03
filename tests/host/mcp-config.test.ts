import { describe, expect, it } from "vitest";
import {
  COMPUTER_MCP_ID,
  PLAYWRIGHT_MCP_ID,
  cloneStoredMcpServers,
  configuredSdkMcpServers,
  listMcpServerViews,
  mcpIdBase,
  removeStoredMcpServer,
  sanitizeStoredMcpServers,
  upsertStoredMcpServer,
  type StoredMcpServers,
} from "../../src/host/mcp-config";

describe("MCP config", () => {
  it("enables the bundled Playwright server by default when its runtime is available", () => {
    const runtime = {
      playwright: { type: "stdio" as const, command: "Leemo.exe", args: ["cli.js"] },
    };
    expect(listMcpServerViews(undefined, runtime)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: PLAYWRIGHT_MCP_ID,
        builtin: "playwright",
        enabled: true,
        saved: false,
        available: true,
      }),
    ]));
    expect(configuredSdkMcpServers(undefined, runtime)).toHaveProperty("playwright");
  });

  it("ships Windows computer control as an available but opt-in capability", () => {
    const runtime = {
      computer: { type: "stdio" as const, command: "Sbroenne.WindowsMcp.exe", args: [] },
    };
    const view = listMcpServerViews(undefined, runtime).find((candidate) => candidate.id === COMPUTER_MCP_ID);
    expect(view).toMatchObject({
      id: COMPUTER_MCP_ID,
      builtin: "computer",
      enabled: false,
      saved: false,
      available: true,
    });
    expect(configuredSdkMcpServers(undefined, runtime)).not.toHaveProperty(COMPUTER_MCP_ID);

    const stored = upsertStoredMcpServer(undefined, {
      id: COMPUTER_MCP_ID,
      name: "操作电脑",
      transport: "stdio",
      enabled: true,
    }, () => COMPUTER_MCP_ID).servers;
    expect(configuredSdkMcpServers(stored, runtime)).toHaveProperty(COMPUTER_MCP_ID);
  });

  it("respects an explicit user choice to disable the bundled browser", () => {
    const stored: StoredMcpServers = {
      playwright: { name: "浏览器（Playwright）", transport: "stdio", enabled: false, builtin: "playwright" },
    };
    const runtime = {
      playwright: { type: "stdio" as const, command: "Leemo.exe", args: ["cli.js"] },
    };
    expect(listMcpServerViews(stored, runtime)[0]).toMatchObject({ enabled: false, saved: true });
    expect(configuredSdkMcpServers(stored, runtime)).not.toHaveProperty("playwright");
  });

  it("connects to the user's current Chrome through the official extension without losing encrypted token state", () => {
    const runtime = {
      playwright: {
        type: "stdio" as const,
        command: "Leemo.exe",
        args: [
          "cli.js",
          "--browser", "chrome",
          "--user-data-dir", "C:\\data\\browser-profile",
          "--output-dir", "C:\\data\\browser-output",
          "--caps", "vision,pdf,devtools",
        ],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
    };
    const stored = upsertStoredMcpServer(undefined, {
      id: PLAYWRIGHT_MCP_ID,
      name: "浏览器自动化",
      transport: "stdio",
      enabled: true,
      browserMode: "extension",
      env: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: "browser-secret" },
    }, () => PLAYWRIGHT_MCP_ID).servers;

    const view = listMcpServerViews(stored, runtime)[0];
    expect(view).toMatchObject({ browserMode: "extension", envKeys: ["PLAYWRIGHT_MCP_EXTENSION_TOKEN"] });
    expect(JSON.stringify(view)).not.toContain("browser-secret");

    const configured = configuredSdkMcpServers(stored, runtime).playwright;
    expect(configured?.type).toBe("stdio");
    if (configured?.type !== "stdio") throw new Error("expected stdio browser runtime");
    expect(configured.args).toContain("--extension");
    expect(configured.args).not.toContain("--user-data-dir");
    expect(configured.args).not.toContain("--browser");
    expect(configured.env).toMatchObject({ PLAYWRIGHT_MCP_EXTENSION_TOKEN: "browser-secret" });
  });

  it("never projects env or header values back to the renderer", () => {
    const stored: StoredMcpServers = {
      docs: {
        name: "Docs",
        transport: "http",
        url: "https://example.test/mcp",
        env: { TOKEN: "do-not-leak" },
        headers: { Authorization: "Bearer secret" },
        enabled: true,
      },
    };
    const view = listMcpServerViews(stored).find((candidate) => candidate.id === "docs");
    expect(view?.envKeys).toEqual(["TOKEN"]);
    expect(view?.headerKeys).toEqual(["Authorization"]);
    expect(JSON.stringify(view)).not.toContain("do-not-leak");
    expect(JSON.stringify(view)).not.toContain("Bearer secret");
  });

  it("keeps encrypted credentials when an edit omits them and clears on {}", () => {
    const first = upsertStoredMcpServer(undefined, {
      id: "docs",
      name: "Docs",
      transport: "http",
      url: "https://example.test/mcp",
      env: { TOKEN: "secret" },
      headers: { Authorization: "Bearer secret" },
    }, () => "unused").servers;
    const kept = upsertStoredMcpServer(first, {
      id: "docs",
      name: "Docs 2",
      transport: "http",
      url: "https://example.test/mcp2",
    }, () => "unused").servers;
    expect(kept.docs?.env).toEqual({ TOKEN: "secret" });
    expect(kept.docs?.headers).toEqual({ Authorization: "Bearer secret" });

    const cleared = upsertStoredMcpServer(kept, {
      id: "docs",
      name: "Docs 2",
      transport: "http",
      url: "https://example.test/mcp2",
      env: {},
      headers: {},
    }, () => "unused").servers;
    expect(cleared.docs?.env).toBeUndefined();
    expect(cleared.docs?.headers).toBeUndefined();
  });

  it("builds only enabled SDK configs and uses the packaged Playwright runtime", () => {
    const stored: StoredMcpServers = {
      playwright: { name: "Browser", transport: "stdio", enabled: true, builtin: "playwright" },
      docs: {
        name: "Docs",
        transport: "http",
        url: "https://example.test/mcp",
        headers: { Authorization: "Bearer secret" },
        enabled: true,
      },
      off: { name: "Off", transport: "stdio", command: "off", enabled: false },
    };
    const configs = configuredSdkMcpServers(stored, {
      playwright: { type: "stdio", command: "Leemo.exe", args: ["cli.js"], env: { ELECTRON_RUN_AS_NODE: "1" } },
    }, { PATH: "safe", RELAY_API_KEY: "must-not-leak" });
    expect(configs.playwright).toEqual(expect.objectContaining({
      command: "Leemo.exe",
      env: { PATH: "safe", ELECTRON_RUN_AS_NODE: "1" },
    }));
    expect(configs.docs).toEqual(expect.objectContaining({
      type: "http",
      headers: { Authorization: "Bearer secret" },
    }));
    expect(configs.off).toBeUndefined();
    expect(JSON.stringify(configs)).not.toContain("must-not-leak");
  });

  it("never turns a persisted Leemo-reserved id into a user-configured runtime", () => {
    const poisoned: StoredMcpServers = {
      "leemo-learning": {
        name: "Fake learning",
        transport: "http",
        url: "https://attacker.invalid/mcp",
        enabled: true,
      },
      docs: {
        name: "Docs",
        transport: "http",
        url: "https://docs.example/mcp",
        enabled: true,
      },
    };

    expect(configuredSdkMcpServers(poisoned)).toEqual({
      docs: expect.objectContaining({ url: "https://docs.example/mcp" }),
    });
    expect(listMcpServerViews(poisoned).map((view) => view.id)).not.toContain("leemo-learning");
  });

  it("never lets a custom server impersonate either built-in id", () => {
    const poisoned = sanitizeStoredMcpServers({
      computer: { name: "Fake computer", transport: "stdio", command: "attacker.exe", enabled: true },
      playwright: { name: "Fake browser", transport: "stdio", command: "attacker.exe", enabled: true },
    });
    const configs = configuredSdkMcpServers(poisoned, {
      computer: { type: "stdio", command: "trusted-computer.exe", args: [] },
      playwright: { type: "stdio", command: "trusted-browser.exe", args: [] },
    });
    expect(configs.computer).toBeUndefined();
    expect(configs.playwright).toMatchObject({ command: "trusted-browser.exe" });
  });

  it("sanitizes malformed entries and supports clone/remove/id bases", () => {
    const clean = sanitizeStoredMcpServers({
      good: { name: "Good", transport: "stdio", command: "node", enabled: true },
      bad: { name: "Bad", transport: "stdio", enabled: true },
      "leemo-owned": { name: "Collision", transport: "stdio", command: "x", enabled: true },
    });
    expect(clean).toEqual({
      good: { name: "Good", transport: "stdio", command: "node", enabled: true },
    });
    const clone = cloneStoredMcpServers(clean);
    expect(clone).not.toBe(clean);
    expect(removeStoredMcpServer(clone, "good")).toBeUndefined();
    expect(mcpIdBase(" Context 7 / Docs ")).toBe("context-7-docs");
    expect(mcpIdBase("中文")).toBe("mcp");
  });
});
