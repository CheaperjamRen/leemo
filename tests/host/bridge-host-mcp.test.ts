import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBridgeHost, type HostDeps, type ProviderConfigStore } from "../../src/host/bridge-host";
import { buildCatalog } from "../../src/host/provider-catalog";
import { emptyConfig, type ProviderConfigFile } from "../../src/host/provider-config";

function makeHarness(over: Partial<HostDeps> = {}) {
  const env = { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_MODEL: "deepseek-chat" };
  let config: ProviderConfigFile = emptyConfig();
  let catalog = buildCatalog(env, config);
  const store: ProviderConfigStore = {
    read: () => config,
    write: (next) => {
      config = next;
      catalog = buildCatalog(env, config);
    },
  };
  const host = createBridgeHost({
    catalog: () => catalog,
    providerStore: store,
    dataDir: "C:\\data",
    workspaceRoot: "C:\\workspace",
    push: () => {},
    builtinMcpRuntime: {
      playwright: {
        type: "stdio",
        command: "C:\\app\\Leemo.exe",
        args: ["C:\\app\\node_modules\\@playwright\\mcp\\cli.js", "--browser", "chrome"],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      },
      computer: {
        type: "stdio",
        command: "C:\\app\\resources\\windows-mcp\\Sbroenne.WindowsMcp.exe",
        args: [],
      },
    },
    ...over,
  });
  return { host, current: () => config };
}

describe("bridge-host MCP channels", () => {
  it("offers relationship-history recall only to the global Buddy relationship", async () => {
    const searchBuddyHistory = vi.fn(async () => []);
    const { host } = makeHarness({ searchBuddyHistory });
    const buddy = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      mode: "buddy",
    });
    const workbench = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
      mode: "workbench",
    });

    expect(host.inspect(buddy.conversationId)?.mcpServerNames).toContain("leemo-relationship-history");
    expect(host.inspect(workbench.conversationId)?.mcpServerNames).not.toContain("leemo-relationship-history");
    expect(host.inspect(buddy.conversationId)?.systemPromptAppend).toContain("Relationship history search is on demand");
  });

  it("lists and enables the built-in browser by default without persisting a synthetic choice", async () => {
    const { host, current } = makeHarness();
    const list = await host.handleInvoke("bridge:listMcpServers", undefined);
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "playwright",
      builtin: "playwright",
      enabled: true,
      available: true,
    }), expect.objectContaining({
      id: "computer",
      builtin: "computer",
      enabled: false,
      available: true,
    })]));
    expect(current().mcpServers).toBeUndefined();
  });

  it("saves secrets encrypted-side and returns only key names", async () => {
    const { host, current } = makeHarness();
    const view = await host.handleInvoke("bridge:saveMcpServer", {
      name: "Context Docs",
      transport: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer top-secret" },
      env: { DOCS_TOKEN: "env-secret" },
      enabled: true,
    });
    expect(view.id).toBe("context-docs");
    expect(view.headerKeys).toEqual(["Authorization"]);
    expect(view.envKeys).toEqual(["DOCS_TOKEN"]);
    expect(JSON.stringify(view)).not.toContain("top-secret");
    expect(JSON.stringify(view)).not.toContain("env-secret");
    expect(current().mcpServers?.[view.id]?.headers?.Authorization).toBe("Bearer top-secret");
  });

  it("hot-adds and removes a server from an already open conversation", async () => {
    const { host } = makeHarness();
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    expect(host.inspect(conversationId)?.mcpServerNames).toEqual([
      "leemo-ask-user",
      "playwright",
      "leemo-documents",
      "leemo-visualization",
      "leemo-work-overview",
    ]);

    const saved = await host.handleInvoke("bridge:saveMcpServer", {
      name: "Local Tools",
      transport: "stdio",
      command: "local-mcp",
      args: ["--stdio"],
      enabled: true,
    });
    expect(host.inspect(conversationId)?.mcpServerNames).toContain(saved.id);
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-ask-user");
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("playwright");
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-documents");
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-visualization");

    await host.handleInvoke("bridge:deleteMcpServer", { id: saved.id });
    expect(host.inspect(conversationId)?.mcpServerNames).not.toContain(saved.id);
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-ask-user");
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-documents");
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("leemo-visualization");
  });

  it("tests a disabled server through real-probe seam without changing enabled state", async () => {
    const probe = vi.fn(async () => ({
      ok: true as const,
      latencyMs: 12,
      tools: [{ name: "lookup", description: "Look up docs" }],
    }));
    const { host, current } = makeHarness({ mcpProbe: probe });
    const saved = await host.handleInvoke("bridge:saveMcpServer", {
      name: "Docs",
      transport: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: false,
    });
    const result = await host.handleInvoke("bridge:testMcpServer", { id: saved.id });
    expect(result).toEqual({ ok: true, latencyMs: 12, tools: [{ name: "lookup", description: "Look up docs" }] });
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ type: "http", headers: { Authorization: "Bearer secret" } }),
      "C:\\workspace",
      10_000,
    );
    expect(current().mcpServers?.[saved.id]?.enabled).toBe(false);
  });

  it("can probe the built-in Playwright offer without an explicit saved config", async () => {
    const probe = vi.fn(async () => ({ ok: true as const, tools: [{ name: "browser_navigate" }] }));
    const { host } = makeHarness({ mcpProbe: probe });
    const result = await host.handleInvoke("bridge:testMcpServer", { id: "playwright" });
    expect(result.ok).toBe(true);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ command: "C:\\app\\Leemo.exe" }),
      "C:\\workspace",
      10_000,
      { verifyBrowserTabs: false },
    );
  });

  it("hot-updates both the desktop tool and momo's capability truth when the switch changes", async () => {
    const { host } = makeHarness();
    const { conversationId } = await host.handleInvoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    expect(host.inspect(conversationId)?.mcpServerNames).not.toContain("computer");
    expect(host.inspect(conversationId)?.systemPromptAppend).toContain("Desktop operation is disabled");

    await host.handleInvoke("bridge:saveMcpServer", {
      id: "computer",
      name: "操作电脑",
      transport: "stdio",
      enabled: true,
    });
    expect(host.inspect(conversationId)?.mcpServerNames).toContain("computer");
    expect(host.inspect(conversationId)?.systemPromptAppend).toContain("Desktop operation is enabled");

    await host.handleInvoke("bridge:saveMcpServer", {
      id: "computer",
      name: "操作电脑",
      transport: "stdio",
      enabled: false,
    });
    expect(host.inspect(conversationId)?.mcpServerNames).not.toContain("computer");
    expect(host.inspect(conversationId)?.systemPromptAppend).toContain("Desktop operation is disabled");
  });

  it("actively reads desktop windows when probing built-in computer control", async () => {
    const probe = vi.fn(async () => ({ ok: true as const, state: "ready" as const, tools: [{ name: "window_management" }] }));
    const { host } = makeHarness({ mcpProbe: probe });
    const result = await host.handleInvoke("bridge:testMcpServer", { id: "computer" });
    expect(result).toMatchObject({ ok: true, state: "ready" });
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ command: expect.stringContaining("Sbroenne.WindowsMcp.exe") }),
      "C:\\workspace",
      10_000,
      { verifyComputerDesktop: true },
    );
  });

  it("actively checks current Chrome instead of accepting tools/list as a connected browser", async () => {
    const probe = vi.fn(async () => ({ ok: false as const, state: "waiting-for-browser" as const, tools: [], error: "waiting" }));
    const { host } = makeHarness({ mcpProbe: probe });
    await host.handleInvoke("bridge:saveMcpServer", {
      id: "playwright",
      name: "浏览器自动化",
      transport: "stdio",
      enabled: true,
      browserMode: "extension",
    });

    await host.handleInvoke("bridge:testMcpServer", { id: "playwright" });
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(["--extension"]) }),
      "C:\\workspace",
      10_000,
      { verifyBrowserTabs: true },
    );
  });

  it("reads only bounded browser captures and never exposes their filesystem path", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-browser-capture-"));
    const outputDir = path.join(dataDir, "mcp", "playwright", "browser-output");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "page-proof.png"), Buffer.from("png-proof"));
    const { host } = makeHarness({ dataDir });

    await expect(host.handleInvoke("bridge:readBrowserCapture", { id: "page-proof.png" })).resolves.toEqual({
      mimeType: "image/png",
      dataBase64: Buffer.from("png-proof").toString("base64"),
    });
    await expect(host.handleInvoke("bridge:readBrowserCapture", { id: "../leemo-secrets.enc" })).resolves.toBeNull();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
