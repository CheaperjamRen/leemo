import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../bridge/client";
import type { McpServerView } from "../../bridge/contract";
import { createMcpServersStore } from "../stores/mcp-servers";
import { BrowserAutomationSection } from "./BrowserAutomationSection";

const BROWSER: McpServerView = {
  id: "playwright",
  name: "浏览器自动化",
  description: "浏览网页并完成操作",
  transport: "stdio",
  envKeys: [],
  headerKeys: [],
  enabled: true,
  browserMode: "managed",
  builtin: "playwright",
  saved: false,
  available: true,
};

function makeClient(handler: (channel: string, request: unknown) => unknown): BridgeClient {
  return {
    invoke: vi.fn(async (channel, request) => handler(channel, request)) as BridgeClient["invoke"],
    subscribe: vi.fn(() => () => {}),
  };
}

describe("BrowserAutomationSection", () => {
  it("presents browser automation as a product capability rather than an MCP implementation detail", () => {
    const store = createMcpServersStore(makeClient(() => undefined), [BROWSER]);
    render(<BrowserAutomationSection store={store} />);

    expect(screen.getByRole("heading", { name: "浏览器自动化" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leemo 浏览器" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/登录状态只保存在本机/)).toBeInTheDocument();
    expect(screen.queryByText(/MCP/)).not.toBeInTheDocument();
  });

  it("keeps the working browser active until current Chrome is saved, then checks the real connection", async () => {
    const user = userEvent.setup();
    const client = makeClient((channel, request) => {
      if (channel === "bridge:saveMcpServer") {
        return { ...BROWSER, ...(request as object), browserMode: "extension", saved: true, envKeys: ["PLAYWRIGHT_MCP_EXTENSION_TOKEN"] };
      }
      if (channel === "bridge:testMcpServer") {
        return { ok: true, state: "ready", latencyMs: 17, tools: [{ name: "browser_tabs" }] };
      }
      throw new Error("unexpected");
    });
    const store = createMcpServersStore(client, [BROWSER]);
    render(<BrowserAutomationSection store={store} />);

    await user.click(screen.getByRole("button", { name: "当前 Chrome" }));
    expect(client.invoke).not.toHaveBeenCalledWith("bridge:saveMcpServer", expect.anything());
    expect(screen.queryByText(/Playwright/)).not.toBeInTheDocument();
    expect(screen.getByText("保存后会自动检查连接")).toBeInTheDocument();
    await user.type(screen.getByLabelText("浏览器连接令牌"), "local-token");
    await user.click(screen.getByRole("button", { name: "保存并检查连接" }));

    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:saveMcpServer", expect.objectContaining({
      id: "playwright",
      browserMode: "extension",
      env: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: "local-token" },
    })));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:testMcpServer", { id: "playwright" }));
    expect(await screen.findByText("浏览器已就绪 · 1 项能力 · 17 ms")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("local-token")).not.toBeInTheDocument();
  });

  it("shows a human-readable real connection result", async () => {
    const user = userEvent.setup();
    const client = makeClient((channel) => {
      if (channel === "bridge:testMcpServer") {
        return { ok: true, latencyMs: 17, tools: Array.from({ length: 42 }, (_, i) => ({ name: `browser_${i}` })) };
      }
      throw new Error("unexpected");
    });
    const store = createMcpServersStore(client, [BROWSER]);
    render(<BrowserAutomationSection store={store} />);

    await user.click(screen.getByRole("button", { name: "检查浏览器" }));
    expect(await screen.findByText("浏览器已就绪 · 42 项能力 · 17 ms")).toBeInTheDocument();
  });

  it("shows a waiting state instead of claiming current Chrome is ready", async () => {
    const user = userEvent.setup();
    const currentChrome = { ...BROWSER, browserMode: "extension" as const };
    const client = makeClient((channel) => {
      if (channel === "bridge:testMcpServer") {
        return {
          ok: false,
          state: "waiting-for-browser",
          tools: [{ name: "browser_tabs" }],
          error: "Chrome 还没有连接。请安装或打开浏览器连接扩展，然后再试。",
        };
      }
      throw new Error("unexpected");
    });
    const store = createMcpServersStore(client, [currentChrome]);
    render(<BrowserAutomationSection store={store} />);

    await user.click(screen.getByRole("button", { name: "检查浏览器" }));
    expect(await screen.findByText("Chrome 还没有连接。请安装或打开浏览器连接扩展，然后再试。")).toBeInTheDocument();
    expect(screen.queryByText(/浏览器已就绪/)).not.toBeInTheDocument();
  });
});
