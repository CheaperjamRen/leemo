import { randomBytes } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { McpServer as AcpMcpServer } from "@agentclientprotocol/sdk";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  CodexDynamicToolCall,
  CodexDynamicToolContent,
  CodexDynamicToolRegistry,
} from "./codex-dynamic-tools";

export interface GeminiMcpGateway {
  mcpServer: AcpMcpServer;
  dispose(): Promise<void>;
}

export interface CreateGeminiMcpGatewayOptions {
  registry: CodexDynamicToolRegistry;
  instructions?: string;
  conversationId: string;
}

interface Binding {
  namespace: string;
  tool: string;
}

function flattenName(namespace: string, tool: string, used: Set<string>): string {
  const base = `leemo_${namespace}_${tool}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 112);
  let candidate = base || "leemo_tool";
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 106)}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function decodeDataUrl(url: string): { data: string; mimeType: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
  return match ? { mimeType: match[1], data: match[2] } : undefined;
}

function toMcpContent(item: CodexDynamicToolContent): Record<string, unknown> {
  if (item.type === "inputText") return { type: "text", text: item.text };
  const decoded = decodeDataUrl(item.type === "inputImage" ? item.imageUrl : item.audioUrl);
  if (!decoded) return { type: "text", text: "工具返回了无法读取的媒体内容。" };
  return {
    type: item.type === "inputImage" ? "image" : "audio",
    data: decoded.data,
    mimeType: decoded.mimeType,
  };
}

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeHttp(server: HttpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Exposes Leemo's already-connected, already-governed tool registry as one
 * authenticated loopback MCP endpoint for an external ACP agent. */
export async function createGeminiMcpGateway(
  options: CreateGeminiMcpGatewayOptions,
): Promise<GeminiMcpGateway> {
  const token = randomBytes(24).toString("hex");
  const route = `/mcp/${randomBytes(12).toString("hex")}`;
  const bindings = new Map<string, Binding>();
  const used = new Set<string>();
  const tools = options.registry.specs.flatMap((namespace) => namespace.tools.map((tool) => {
    const name = flattenName(namespace.name, tool.name, used);
    bindings.set(name, { namespace: namespace.name, tool: tool.name });
    return {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }));

  const mcp = new Server(
    { name: "leemo", version: "0.1.1" },
    { capabilities: { tools: {} }, ...(options.instructions ? { instructions: options.instructions } : {}) },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  mcp.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const binding = bindings.get(request.params.name);
    if (!binding) {
      return { isError: true, content: [{ type: "text", text: "这个工具当前不可用。" }] };
    }
    const call: CodexDynamicToolCall = {
      threadId: options.conversationId,
      turnId: options.conversationId,
      callId: String(extra.requestId),
      namespace: binding.namespace,
      tool: binding.tool,
      arguments: request.params.arguments ?? {},
    };
    const result = await options.registry.call(call);
    return {
      isError: !result.success,
      content: result.contentItems.map(toMcpContent),
    };
  });

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  const http = createServer((request, response) => {
    if (request.url !== route || request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 404;
      response.end();
      return;
    }
    void transport.handleRequest(request, response).catch(() => {
      if (!response.headersSent) response.statusCode = 500;
      response.end();
    });
  });
  const port = await listen(http);
  let disposed = false;
  return {
    mcpServer: {
      type: "http",
      name: "leemo",
      url: `http://127.0.0.1:${port}${route}`,
      headers: [{ name: "Authorization", value: `Bearer ${token}` }],
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await closeHttp(http).catch(() => {});
      await mcp.close().catch(() => {});
    },
  };
}
