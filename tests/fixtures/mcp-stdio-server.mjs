import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "leemo-test-server", version: "1.0.0" });
server.registerTool("echo", {
  description: "Echo a message",
  inputSchema: { text: z.string() },
}, async ({ text }) => ({ content: [{ type: "text", text }] }));

if (process.argv.includes("--browser-tabs-connected") || process.argv.includes("--browser-tabs-waiting")) {
  server.registerTool("browser_tabs", {
    description: "List browser tabs",
    inputSchema: { action: z.literal("list") },
  }, async () => process.argv.includes("--browser-tabs-waiting")
    ? {
        content: [{ type: "text", text: "Playwright Extension not found" }],
        isError: true,
      }
    : { content: [{ type: "text", text: "### Open tabs\n- 0: Example" }] });
}
if (process.argv.includes("--computer-ready")) {
  server.registerTool("window_management", {
    description: "Inspect windows",
    inputSchema: { action: z.literal("list") },
  }, async () => ({ content: [{ type: "text", text: "Foreground: Test Window" }] }));
}
await server.connect(new StdioServerTransport());
