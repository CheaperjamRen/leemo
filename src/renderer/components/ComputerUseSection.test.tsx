import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BridgeClient } from "../bridge/client";
import type { McpServerView } from "../../bridge/contract";
import { createMcpServersStore } from "../stores/mcp-servers";
import { ComputerUseSection } from "./ComputerUseSection";

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

describe("ComputerUseSection", () => {
  it("explains the privacy boundary without exposing MCP implementation jargon", () => {
    const store = createMcpServersStore(makeClient(() => undefined), [COMPUTER]);
    render(<ComputerUseSection store={store} />);
    expect(screen.getByRole("heading", { name: "操作电脑" })).toBeInTheDocument();
    expect(screen.getByText(/屏幕内容会发送给当前模型/)).toBeInTheDocument();
    expect(screen.getByText(/密码、验证码和登录由你接管/)).toBeInTheDocument();
    expect(screen.queryByText(/MCP|UI Automation|Computer Use/)).not.toBeInTheDocument();
  });

  it("persists the opt-in toggle and runs a real readiness check", async () => {
    const user = userEvent.setup();
    const client = makeClient((channel, request) => {
      if (channel === "bridge:saveMcpServer") return { ...COMPUTER, ...(request as object), saved: true };
      if (channel === "bridge:testMcpServer") {
        return { ok: true, state: "ready", latencyMs: 22, tools: [{ name: "window_management" }, { name: "ui_snapshot" }] };
      }
      throw new Error("unexpected");
    });
    const store = createMcpServersStore(client, [COMPUTER]);
    render(<ComputerUseSection store={store} />);

    await user.click(screen.getByRole("checkbox", { name: "操作电脑 启用" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:saveMcpServer", expect.objectContaining({
      id: "computer",
      enabled: true,
    })));
    await user.click(screen.getByRole("button", { name: "检查电脑操作" }));
    expect(await screen.findByText("电脑操作已就绪 · 2 项能力 · 22 ms")).toBeInTheDocument();
  });
});
