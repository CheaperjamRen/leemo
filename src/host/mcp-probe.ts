import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { McpConnectionTestResult } from "../bridge/contract";

export interface McpProbeOptions {
  /** `tools/list` proves only that the Playwright process started. Extension
   * mode additionally calls browser_tabs so the UI cannot claim Chrome is
   * ready while the extension is absent or disconnected. */
  verifyBrowserTabs?: boolean;
  /** `tools/list` can succeed even if Windows UI Automation cannot read the
   * interactive desktop. A read-only window enumeration proves the boundary.
   * `get_foreground` is intentionally avoided: a background host may have no
   * foreground window even while it can enumerate and operate the desktop. */
  verifyComputerDesktop?: boolean;
}

const CURRENT_CHROME_WAITING_MESSAGE = "Chrome 还没有连接。请安装或打开浏览器连接扩展，然后再试。";

function mergedHeaders(base: RequestInit["headers"] | undefined, extra: Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

export function createMcpClientTransport(
  config: Exclude<McpServerConfig, { type: "sdk" }>,
  cwd: string,
): { transport: Transport; stderr?: { on(event: "data", listener: (chunk: Buffer | string) => void): unknown } } {
  if (config.type === "http") {
    return {
      transport: new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      }),
    };
  }
  if (config.type === "sse") {
    const headers = config.headers ?? {};
    const fetchWithHeaders: typeof fetch = (input, init) => fetch(input, {
      ...init,
      headers: mergedHeaders(init?.headers, headers),
    });
    return {
      transport: new SSEClientTransport(new URL(config.url), {
        requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
        eventSourceInit: Object.keys(headers).length > 0 ? { fetch: fetchWithHeaders } : undefined,
      }),
    };
  }
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...getDefaultEnvironment(), ...(config.env ?? {}) },
    cwd,
    stderr: "pipe",
  });
  return { transport, stderr: transport.stderr ?? undefined };
}

async function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`连接超时（${Math.round(timeoutMs / 1_000)} 秒）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function secretValues(config: Exclude<McpServerConfig, { type: "sdk" }>): string[] {
  const values = config.type === "http" || config.type === "sse"
    ? Object.values(config.headers ?? {})
    : Object.values(config.env ?? {});
  return values.filter((value) => value.length >= 4);
}

function safeError(error: unknown, stderr: string, secrets: string[]): string {
  let text = error instanceof Error ? error.message : String(error);
  if (stderr.trim()) text = `${text}\n${stderr.trim()}`;
  for (const secret of secrets) text = text.split(secret).join("[已隐藏]");
  text = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (/ENOENT|not found|cannot find/i.test(text)) return "找不到 MCP 启动命令或依赖。";
  if (/connection closed/i.test(text)) return "MCP 进程启动失败或启动后立即退出。";
  if (/401|unauthorized/i.test(text)) return "MCP 需要认证，检查凭据或先完成授权。";
  return text.slice(0, 400) || "MCP 连接失败。";
}

/** Real protocol probe: initialize + tools/list, with no model request. */
export async function probeMcpServer(
  config: Exclude<McpServerConfig, { type: "sdk" }>,
  cwd: string,
  timeoutMs = 10_000,
  options: McpProbeOptions = {},
): Promise<McpConnectionTestResult> {
  const client = new Client({ name: "leemo-mcp-check", version: "1.0.0" });
  const { transport, stderr } = createMcpClientTransport(config, cwd);
  let stderrText = "";
  stderr?.on("data", (chunk: Buffer | string) => {
    if (stderrText.length < 4_000) stderrText += String(chunk);
  });
  const startedAt = Date.now();
  try {
    await deadline(client.connect(transport, { timeout: timeoutMs }), timeoutMs);
    const response = await deadline(client.listTools(undefined, { timeout: timeoutMs }), timeoutMs);
    const tools = response.tools.slice(0, 100).map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description.slice(0, 240) } : {}),
    }));
    if (options.verifyBrowserTabs) {
      if (!response.tools.some((tool) => tool.name === "browser_tabs")) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          tools,
          error: "浏览器组件已启动，但无法检查 Chrome 标签页。",
        };
      }
      let tabs: Awaited<ReturnType<Client["callTool"]>>;
      try {
        tabs = await deadline(client.callTool({
          name: "browser_tabs",
          arguments: { action: "list" },
        }, undefined, { timeout: timeoutMs }), timeoutMs);
      } catch (error: unknown) {
        const detail = safeError(error, stderrText, secretValues(config));
        const waiting = /timeout|超时|extension|connect/i.test(detail);
        return {
          ok: false,
          ...(waiting ? { state: "waiting-for-browser" as const } : {}),
          latencyMs: Date.now() - startedAt,
          tools,
          error: waiting
            ? CURRENT_CHROME_WAITING_MESSAGE
            : detail,
        };
      }
      if (tabs.isError) {
        const rawContent = (tabs as { content?: unknown }).content;
        const detail = (Array.isArray(rawContent) ? rawContent : [])
          .filter((item): item is { type: "text"; text: string } => (
            typeof item === "object" && item !== null
            && (item as { type?: unknown }).type === "text"
            && typeof (item as { text?: unknown }).text === "string"
          ))
          .map((item) => item.text)
          .join(" ");
        const waiting = /extension|connect|not found/i.test(detail);
        return {
          ok: false,
          ...(waiting ? { state: "waiting-for-browser" as const } : {}),
          latencyMs: Date.now() - startedAt,
          tools,
          error: waiting
            ? CURRENT_CHROME_WAITING_MESSAGE
            : safeError(detail || "Chrome 标签页检查失败。", stderrText, secretValues(config)),
        };
      }
      return {
        ok: true,
        state: "ready",
        latencyMs: Date.now() - startedAt,
        tools,
      };
    }
    if (options.verifyComputerDesktop) {
      if (!response.tools.some((tool) => tool.name === "window_management")) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          tools,
          error: "电脑操作组件已启动，但无法读取当前窗口。",
        };
      }
      const desktop = await deadline(client.callTool({
        name: "window_management",
        arguments: { action: "list" },
      }, undefined, { timeout: timeoutMs }), timeoutMs);
      if (desktop.isError) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          tools,
          error: "电脑操作组件无法读取当前桌面，请解锁屏幕后重试。",
        };
      }
      return {
        ok: true,
        state: "ready",
        latencyMs: Date.now() - startedAt,
        tools,
      };
    }
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      tools,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      tools: [],
      error: safeError(error, stderrText, secretValues(config)),
    };
  } finally {
    await client.close().catch(() => transport.close().catch(() => {}));
  }
}
