import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../bridge/client";
import type { McpServerView } from "../../bridge/contract";
import { createMcpServersStore } from "../stores/mcp-servers";
import { McpServersSection } from "./McpServersSection";

const PLAYWRIGHT: McpServerView = {
  id: "playwright",
  name: "浏览器（Playwright）",
  description: "浏览器操作与页面调试",
  transport: "stdio",
  envKeys: [],
  headerKeys: [],
  enabled: false,
  builtin: "playwright",
  saved: false,
  available: true,
};

const CUSTOM: McpServerView = {
  id: "context7",
  name: "Context7",
  description: "开发文档",
  transport: "http",
  url: "https://example.test/mcp",
  envKeys: [],
  headerKeys: [],
  enabled: true,
  saved: true,
  available: true,
};

const COMPUTER: McpServerView = {
  id: "computer",
  name: "操作电脑",
  description: "查看并操作 Windows 应用",
  transport: "stdio",
  envKeys: [],
  headerKeys: [],
  enabled: false,
  builtin: "computer",
  saved: false,
  available: true,
};

function makeClient(handler: (channel: string, request: unknown) => unknown): BridgeClient {
  return {
    invoke: vi.fn(async (channel, request) => handler(channel, request)) as BridgeClient["invoke"],
    subscribe: vi.fn(() => () => {}),
  };
}

describe("McpServersSection", () => {
  it("keeps the built-in browser out of the advanced MCP list", () => {
    const store = createMcpServersStore(makeClient(() => undefined), [PLAYWRIGHT, COMPUTER, CUSTOM]);
    render(<McpServersSection store={store} />);
    expect(screen.getByText("Context7")).toBeInTheDocument();
    expect(screen.queryByText("浏览器（Playwright）")).not.toBeInTheDocument();
    expect(screen.queryByText("操作电脑")).not.toBeInTheDocument();
  });

  it("runs a real-test channel and displays the returned tool count", async () => {
    const user = userEvent.setup();
    const client = makeClient((channel) => {
      if (channel === "bridge:testMcpServer") {
        return { ok: true, latencyMs: 17, tools: [{ name: "browser_navigate" }, { name: "browser_click" }] };
      }
      throw new Error("unexpected");
    });
    const store = createMcpServersStore(client, [CUSTOM]);
    render(<McpServersSection store={store} />);
    await user.click(screen.getByRole("button", { name: "测试" }));
    expect(await screen.findByText(/已连接 · 2 个工具 · 17 ms/)).toBeInTheDocument();
    expect(screen.getByText(/browser_navigate/)).toBeInTheDocument();
  });

  it("adds a stdio server and sends parsed credentials only toward main", async () => {
    const user = userEvent.setup();
    const client = makeClient((channel, request) => {
      if (channel === "bridge:saveMcpServer") {
        const draft = request as { name: string; command: string; env?: Record<string, string> };
        return {
          id: "context7",
          name: draft.name,
          transport: "stdio",
          command: draft.command,
          envKeys: Object.keys(draft.env ?? {}),
          headerKeys: [],
          enabled: true,
          saved: true,
          available: true,
        };
      }
      throw new Error("unexpected");
    });
    const store = createMcpServersStore(client, [PLAYWRIGHT]);
    render(<McpServersSection store={store} />);
    await user.click(screen.getByRole("button", { name: "添加 MCP" }));
    await user.type(screen.getByLabelText("MCP 名称"), "Context7");
    await user.type(screen.getByLabelText("MCP 启动命令"), "npx");
    await user.type(screen.getByLabelText("MCP 参数"), "-y\n@upstash/context7-mcp");
    await user.click(screen.getByText("凭据与高级选项"));
    await user.type(screen.getByLabelText("MCP 环境变量"), "DOCS_TOKEN=secret");
    await user.click(screen.getByRole("button", { name: "保存 MCP" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:saveMcpServer", expect.objectContaining({
      name: "Context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: { DOCS_TOKEN: "secret" },
    })));
    expect(await screen.findByText("Context7")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
