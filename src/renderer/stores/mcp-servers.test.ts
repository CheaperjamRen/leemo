import { describe, expect, it, vi } from "vitest";
import { createMcpServersStore } from "./mcp-servers";
import type { BridgeClient } from "../bridge/client";
import type { McpServerView } from "../../bridge/contract";

const PLAYWRIGHT: McpServerView = {
  id: "playwright",
  name: "浏览器（Playwright）",
  transport: "stdio",
  envKeys: [],
  headerKeys: [],
  enabled: false,
  builtin: "playwright",
  saved: false,
  available: true,
};

function clientWith(invoke: BridgeClient["invoke"]): BridgeClient {
  return { invoke, subscribe: vi.fn(() => () => {}) };
}

describe("mcp servers store", () => {
  it("waits for host confirmation before reflecting a toggle", async () => {
    let resolve!: (value: McpServerView) => void;
    const invoke = vi.fn(() => new Promise<McpServerView>((r) => { resolve = r; })) as BridgeClient["invoke"];
    const store = createMcpServersStore(clientWith(invoke), [PLAYWRIGHT]);
    const pending = store.getState().setEnabled(PLAYWRIGHT, true);
    expect(store.getState().list[0]?.enabled).toBe(false);
    resolve({ ...PLAYWRIGHT, enabled: true, saved: true });
    await pending;
    expect(store.getState().list[0]?.enabled).toBe(true);
  });

  it("omits secret fields when toggling an existing server", async () => {
    const invoke = vi.fn(async (_channel, request) => ({ ...PLAYWRIGHT, enabled: true, saved: true, ...(request as object) })) as BridgeClient["invoke"];
    const store = createMcpServersStore(clientWith(invoke), [{
      ...PLAYWRIGHT,
      id: "docs",
      builtin: undefined,
      envKeys: ["TOKEN"],
      headerKeys: ["Authorization"],
    }]);
    await store.getState().setEnabled(store.getState().list[0]!, true);
    expect(invoke).toHaveBeenCalledWith("bridge:saveMcpServer", expect.not.objectContaining({ env: expect.anything() }));
    expect(invoke).toHaveBeenCalledWith("bridge:saveMcpServer", expect.not.objectContaining({ headers: expect.anything() }));
  });

  it("stores the real tools/list result", async () => {
    const invoke = vi.fn(async () => ({ ok: true, latencyMs: 9, tools: [{ name: "browser_navigate" }] })) as BridgeClient["invoke"];
    const store = createMcpServersStore(clientWith(invoke), [PLAYWRIGHT]);
    await store.getState().test("playwright");
    expect(store.getState().tests.playwright).toEqual({
      ok: true,
      latencyMs: 9,
      tools: [{ name: "browser_navigate" }],
    });
  });

  it("drops a stale connection result when the server configuration changes", async () => {
    const invoke = vi.fn(async () => ({ ...PLAYWRIGHT, enabled: true, saved: true })) as BridgeClient["invoke"];
    const store = createMcpServersStore(clientWith(invoke), [PLAYWRIGHT]);
    store.setState({
      tests: {
        playwright: { ok: true, state: "ready", latencyMs: 9, tools: [{ name: "browser_tabs" }] },
      },
    });

    await store.getState().save({
      id: "playwright",
      name: "浏览器自动化",
      transport: "stdio",
      enabled: true,
      browserMode: "extension",
    });

    expect(store.getState().tests.playwright).toBeUndefined();
  });
});
