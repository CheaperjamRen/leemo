import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createCodexDynamicToolRegistry } from "../../src/host/codex-dynamic-tools";

describe("Codex dynamic tool registry", () => {
  it("reuses an in-process Leemo MCP definition and its permission decision", async () => {
    const handler = vi.fn(async (input: { value?: string }) => ({
      content: [
        { type: "text", text: `echo:${input.value ?? ""}` },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
      ],
    } as never));
    const server = createSdkMcpServer({
      name: "Leemo Demo",
      version: "1.0.0",
      tools: [tool(
        "echo-value",
        "Echo one value.",
        { value: z.string() },
        handler,
      )],
    });
    const authorize = vi.fn(async () => ({
      allowed: true,
      input: { value: "approved" },
    }));

    const registry = await createCodexDynamicToolRegistry({
      servers: { "leemo-demo": server },
      cwd: "C:\\work",
      authorize,
    });

    expect(registry.specs).toEqual([{
      type: "namespace",
      name: "leemo_demo",
      description: "Leemo Demo",
      tools: [{
        type: "function",
        name: "echo_value",
        description: "Echo one value.",
        inputSchema: expect.objectContaining({ type: "object" }),
      }],
    }]);
    expect(registry.canonicalName({ namespace: "leemo_demo", tool: "echo_value" }))
      .toBe("mcp__leemo-demo__echo-value");

    await expect(registry.call({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      namespace: "leemo_demo",
      tool: "echo_value",
      arguments: { value: "raw" },
    })).resolves.toEqual({
      success: true,
      contentItems: [
        { type: "inputText", text: "echo:approved" },
        { type: "inputImage", imageUrl: "data:image/png;base64,aGVsbG8=" },
      ],
    });
    expect(authorize).toHaveBeenCalledWith(
      "mcp__leemo-demo__echo-value",
      { value: "raw" },
      "call-1",
    );
    expect(handler).toHaveBeenCalledWith(
      { value: "approved" },
      expect.anything(),
    );
    await registry.dispose();
  });

  it("returns a clear failure without invoking a denied or unknown tool", async () => {
    const handler = vi.fn(async () => ({ content: [{ type: "text", text: "ran" }] } as never));
    const server = createSdkMcpServer({
      name: "Protected",
      version: "1.0.0",
      tools: [tool("mutate", "Change something.", {}, handler)],
    });
    const registry = await createCodexDynamicToolRegistry({
      servers: { protected: server },
      cwd: "C:\\work",
      authorize: async () => ({ allowed: false, message: "用户没有允许这次操作。" }),
    });

    await expect(registry.call({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-2",
      namespace: "protected",
      tool: "mutate",
      arguments: {},
    })).resolves.toEqual({
      success: false,
      contentItems: [{ type: "inputText", text: "用户没有允许这次操作。" }],
    });
    await expect(registry.call({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-3",
      namespace: "missing",
      tool: "tool",
      arguments: {},
    })).resolves.toEqual({
      success: false,
      contentItems: [{ type: "inputText", text: "这个工具当前不可用。" }],
    });
    expect(handler).not.toHaveBeenCalled();
    await registry.dispose();
  });

  it("closes an MCP server when its connection times out", async () => {
    const close = vi.fn(async () => {});
    const hangingServer = {
      type: "sdk",
      name: "Hanging",
      instance: {
        connect: () => new Promise<void>(() => {}),
        close,
      },
    } as unknown as McpServerConfig;

    const registry = await createCodexDynamicToolRegistry({
      servers: { hanging: hangingServer },
      cwd: "C:\\work",
      connectTimeoutMs: 1,
    });

    expect(registry.unavailableServers).toEqual(["hanging"]);
    expect(close).toHaveBeenCalledOnce();
    await registry.dispose();
  });
});
