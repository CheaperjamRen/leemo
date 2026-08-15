import { createHash } from "node:crypto";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createMcpClientTransport } from "./mcp-probe";

export interface CodexDynamicToolFunctionSpec {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
}

export interface CodexDynamicToolNamespaceSpec {
  type: "namespace";
  name: string;
  description: string;
  tools: CodexDynamicToolFunctionSpec[];
}

export type CodexDynamicToolSpec = CodexDynamicToolNamespaceSpec;

export interface CodexDynamicToolCall {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
}

export type CodexDynamicToolContent =
  | { type: "inputText"; text: string }
  | { type: "inputImage"; imageUrl: string }
  | { type: "inputAudio"; audioUrl: string };

export interface CodexDynamicToolResponse {
  contentItems: CodexDynamicToolContent[];
  success: boolean;
}

export interface CodexDynamicToolAuthorization {
  allowed: boolean;
  input?: Record<string, unknown>;
  message?: string;
}

export interface CodexDynamicToolRegistry {
  specs: CodexDynamicToolSpec[];
  unavailableServers: string[];
  canonicalName(call: Pick<CodexDynamicToolCall, "namespace" | "tool">): string | undefined;
  call(call: CodexDynamicToolCall): Promise<CodexDynamicToolResponse>;
  dispose(): Promise<void>;
}

export interface CreateCodexDynamicToolRegistryOptions {
  servers: Record<string, McpServerConfig>;
  cwd: string;
  authorize?: (
    toolName: string,
    input: Record<string, unknown>,
    callId: string,
  ) => Promise<CodexDynamicToolAuthorization>;
  connectTimeoutMs?: number;
}

interface ToolBinding {
  client: Client;
  canonicalName: string;
  originalName: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeName(value: string, used: Set<string>): string {
  let name = value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_");
  if (!/^[a-zA-Z_]/.test(name)) name = `tool_${name}`;
  name = name.slice(0, 64) || "tool";
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 8);
  const unique = `${name.slice(0, 55)}_${suffix}`;
  used.add(unique);
  return unique;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("MCP connection timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

function textItem(value: unknown): CodexDynamicToolContent {
  let text = "工具已完成。";
  if (typeof value === "string") text = value;
  else if (value !== undefined) {
    try {
      text = JSON.stringify(value);
    } catch {
      text = "工具已完成，但结果无法转换为文本。";
    }
  }
  return { type: "inputText", text };
}

function convertContent(value: unknown): CodexDynamicToolContent | undefined {
  const item = record(value);
  if (!item || typeof item.type !== "string") return undefined;
  if (item.type === "text" && typeof item.text === "string") {
    return { type: "inputText", text: item.text };
  }
  if (item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") {
    return { type: "inputImage", imageUrl: dataUrl(item.mimeType, item.data) };
  }
  if (item.type === "audio" && typeof item.data === "string" && typeof item.mimeType === "string") {
    return { type: "inputAudio", audioUrl: dataUrl(item.mimeType, item.data) };
  }
  if (item.type === "resource") {
    const resource = record(item.resource);
    if (typeof resource?.text === "string") return { type: "inputText", text: resource.text };
    if (
      typeof resource?.blob === "string"
      && typeof resource.mimeType === "string"
      && resource.mimeType.startsWith("image/")
    ) {
      return { type: "inputImage", imageUrl: dataUrl(resource.mimeType, resource.blob) };
    }
    if (
      typeof resource?.blob === "string"
      && typeof resource.mimeType === "string"
      && resource.mimeType.startsWith("audio/")
    ) {
      return { type: "inputAudio", audioUrl: dataUrl(resource.mimeType, resource.blob) };
    }
    return textItem(resource?.uri ?? item);
  }
  if (item.type === "resource_link") {
    const label = typeof item.name === "string" ? item.name : "资源";
    return textItem(`${label}: ${typeof item.uri === "string" ? item.uri : ""}`);
  }
  return undefined;
}

function toolKey(namespace: string | null, tool: string): string {
  return `${namespace ?? ""}\u0000${tool}`;
}

async function connectServer(
  serverId: string,
  config: McpServerConfig,
  cwd: string,
  namespace: string,
  connectTimeoutMs: number,
): Promise<{
  spec: CodexDynamicToolSpec;
  bindings: Array<[string, ToolBinding]>;
  close: () => Promise<void>;
}> {
  const client = new Client({ name: "leemo", version: "0.1.1" });
  let transport: Transport | undefined;
  let closeServer: (() => Promise<void>) | undefined;
  const close = async (): Promise<void> => {
    await client.close().catch(() => {});
    await transport?.close().catch(() => {});
    await closeServer?.();
  };

  try {
    if (config.type === "sdk") {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      transport = clientTransport;
      closeServer = async () => {
        await config.instance.close().catch(() => {});
      };
      await withTimeout(Promise.all([
        config.instance.connect(serverTransport),
        client.connect(clientTransport),
      ]).then(() => undefined), connectTimeoutMs);
    } else {
      transport = createMcpClientTransport(config, cwd).transport;
      await withTimeout(client.connect(transport, { timeout: connectTimeoutMs }), connectTimeoutMs);
    }

    const listed = await withTimeout(client.listTools(undefined, { timeout: connectTimeoutMs }), connectTimeoutMs);
    const usedToolNames = new Set<string>();
    const bindings: Array<[string, ToolBinding]> = [];
    const tools = listed.tools.map((listedTool) => {
      const exposedName = safeName(listedTool.name, usedToolNames);
      bindings.push([
        toolKey(namespace, exposedName),
        {
          client,
          canonicalName: `mcp__${serverId}__${listedTool.name}`,
          originalName: listedTool.name,
        },
      ]);
      return {
        type: "function" as const,
        name: exposedName,
        description: listedTool.description?.trim() || `Use ${listedTool.name}.`,
        inputSchema: listedTool.inputSchema as Record<string, unknown>,
      };
    });
    return {
      spec: {
        type: "namespace",
        name: namespace,
        description: config.type === "sdk" ? config.name : serverId,
        tools,
      },
      bindings,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function createCodexDynamicToolRegistry(
  options: CreateCodexDynamicToolRegistryOptions,
): Promise<CodexDynamicToolRegistry> {
  const namespaceNames = new Set<string>();
  const prepared = Object.entries(options.servers).map(([serverId, config]) => ({
    serverId,
    config,
    namespace: safeName(serverId, namespaceNames),
  }));
  const connected = await Promise.all(prepared.map(async (server) => {
    try {
      return await connectServer(
        server.serverId,
        server.config,
        options.cwd,
        server.namespace,
        options.connectTimeoutMs ?? 10_000,
      );
    } catch {
      return undefined;
    }
  }));
  const specs: CodexDynamicToolSpec[] = [];
  const unavailableServers: string[] = [];
  const bindings = new Map<string, ToolBinding>();
  const closers: Array<() => Promise<void>> = [];
  for (let index = 0; index < prepared.length; index += 1) {
    const result = connected[index];
    if (!result) {
      unavailableServers.push(prepared[index].serverId);
      continue;
    }
    if (result.spec.tools.length > 0) specs.push(result.spec);
    for (const [key, binding] of result.bindings) bindings.set(key, binding);
    closers.push(result.close);
  }
  let disposed = false;

  const canonicalName = (
    call: Pick<CodexDynamicToolCall, "namespace" | "tool">,
  ): string | undefined => bindings.get(toolKey(call.namespace, call.tool))?.canonicalName;

  return {
    specs,
    unavailableServers,
    canonicalName,
    async call(call): Promise<CodexDynamicToolResponse> {
      const binding = bindings.get(toolKey(call.namespace, call.tool));
      if (!binding || disposed) {
        return {
          success: false,
          contentItems: [{ type: "inputText", text: "这个工具当前不可用。" }],
        };
      }
      const input = record(call.arguments);
      if (!input) {
        return {
          success: false,
          contentItems: [{ type: "inputText", text: "工具参数格式不正确。" }],
        };
      }
      let effectiveInput = input;
      if (options.authorize) {
        let authorization: CodexDynamicToolAuthorization;
        try {
          authorization = await options.authorize(binding.canonicalName, input, call.callId);
        } catch {
          authorization = { allowed: false };
        }
        if (!authorization.allowed) {
          return {
            success: false,
            contentItems: [{
              type: "inputText",
              text: authorization.message || "这次操作没有获得允许。",
            }],
          };
        }
        effectiveInput = authorization.input ?? input;
      }
      try {
        const result = await binding.client.callTool({
          name: binding.originalName,
          arguments: effectiveInput,
        });
        const body = record(result);
        const content = Array.isArray(body?.content)
          ? body.content.map(convertContent).filter((item): item is CodexDynamicToolContent => item !== undefined)
          : [];
        if (content.length === 0) {
          content.push(textItem(body?.structuredContent ?? body?.toolResult));
        }
        return { success: body?.isError !== true, contentItems: content };
      } catch {
        return {
          success: false,
          contentItems: [{ type: "inputText", text: "工具调用失败，请稍后重试。" }],
        };
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await Promise.all(closers.map((close) => close()));
      bindings.clear();
    },
  };
}
