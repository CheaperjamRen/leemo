/**
 * User-configured MCP servers.
 *
 * The persisted record lives inside the same OS-encrypted document as provider
 * and search credentials. Renderer projections expose only secret KEY NAMES;
 * values never travel main -> renderer.
 */

import type { McpServerConfig, McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type {
  BrowserConnectionMode,
  McpServerDraft,
  McpServerView,
  McpTransport,
} from "../bridge/contract";

export const PLAYWRIGHT_MCP_ID = "playwright";
export const COMPUTER_MCP_ID = "computer";
export const PLAYWRIGHT_MCP_VERSION = "0.0.78";
export const PLAYWRIGHT_EXTENSION_TOKEN_KEY = "PLAYWRIGHT_MCP_EXTENSION_TOKEN";

export interface StoredMcpServer {
  name: string;
  description?: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Values are safe on disk only because the parent document is encrypted. */
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled: boolean;
  timeoutMs?: number;
  alwaysLoad?: boolean;
  builtin?: "playwright" | "computer";
  browserMode?: BrowserConnectionMode;
}

export type StoredMcpServers = Record<string, StoredMcpServer>;

/** Runtime-only executable details, resolved by Electron main. */
export interface BuiltinMcpRuntime {
  playwright?: McpStdioServerConfig;
  computer?: McpStdioServerConfig;
}

const PLAYWRIGHT_DESCRIPTION =
  "浏览器操作、网页测试与页面调试；使用 Leemo 专用的持久登录状态。";
const COMPUTER_DESCRIPTION =
  "查看并操作 Windows 应用；屏幕内容只在用户明确开启后交给当前模型处理。";

const SAFE_ENV_KEYS = new Set([
  "APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH",
  "PROCESSOR_ARCHITECTURE", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERNAME", "USERPROFILE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && key.trim()) out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanTimeout(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded >= 1_000 && rounded <= 300_000 ? rounded : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isSafeMcpId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(id) && !id.startsWith("leemo-");
}

function sanitizeStoredMcpServer(value: unknown): StoredMcpServer | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return undefined;
  const transport = value.transport;
  if (transport !== "stdio" && transport !== "http" && transport !== "sse") return undefined;

  const builtin = value.builtin === "playwright" || value.builtin === "computer"
    ? value.builtin
    : undefined;
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!builtin && transport === "stdio" && !command) return undefined;
  if ((transport === "http" || transport === "sse") && !isHttpUrl(url)) return undefined;

  const out: StoredMcpServer = { name, transport, enabled: value.enabled === true };
  if (typeof value.description === "string" && value.description.trim()) out.description = value.description.trim();
  if (command) out.command = command;
  if (Array.isArray(value.args)) out.args = value.args.filter((item): item is string => typeof item === "string");
  if (url) out.url = url;
  const env = cleanStringMap(value.env);
  if (env) out.env = env;
  const headers = cleanStringMap(value.headers);
  if (headers) out.headers = headers;
  const timeoutMs = cleanTimeout(value.timeoutMs);
  if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
  if (value.alwaysLoad === true) out.alwaysLoad = true;
  if (builtin) {
    out.builtin = builtin;
    if (builtin === "playwright") {
      out.browserMode = value.browserMode === "extension" ? "extension" : "managed";
      const browserEnv = browserEnvironment(out.env);
      if (browserEnv) out.env = browserEnv;
      else delete out.env;
    } else {
      delete out.env;
      delete out.headers;
      delete out.browserMode;
    }
  }
  return out;
}

export function sanitizeStoredMcpServers(value: unknown): StoredMcpServers | undefined {
  if (!isRecord(value)) return undefined;
  const out: StoredMcpServers = {};
  for (const [id, item] of Object.entries(value)) {
    if (!isSafeMcpId(id)) continue;
    const server = sanitizeStoredMcpServer(item);
    if (id === PLAYWRIGHT_MCP_ID && server?.builtin !== "playwright") continue;
    if (id === COMPUTER_MCP_ID && server?.builtin !== "computer") continue;
    if (server) out[id] = server;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function cloneStoredMcpServers(value: StoredMcpServers | undefined): StoredMcpServers | undefined {
  if (!value) return undefined;
  return Object.fromEntries(Object.entries(value).map(([id, server]) => [id, {
    ...server,
    ...(server.args ? { args: [...server.args] } : {}),
    ...(server.env ? { env: { ...server.env } } : {}),
    ...(server.headers ? { headers: { ...server.headers } } : {}),
  }]));
}

export function mcpIdBase(name: string): string {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "mcp";
}

function validateDraft(draft: McpServerDraft): void {
  if (!draft.name.trim()) throw new Error("MCP 名称不能为空。");
  if (draft.name.trim().length > 80) throw new Error("MCP 名称不能超过 80 个字符。");
  if (draft.id !== undefined && !isSafeMcpId(draft.id)) throw new Error("MCP 标识不合法。");
  if (draft.id === PLAYWRIGHT_MCP_ID || draft.id === COMPUTER_MCP_ID) return;
  if (draft.transport === "stdio" && !draft.command?.trim()) throw new Error("本地 MCP 需要启动命令。");
  if ((draft.transport === "http" || draft.transport === "sse") && !isHttpUrl(draft.url?.trim() ?? "")) {
    throw new Error("远程 MCP 需要有效的 http/https 地址。");
  }
  if (draft.timeoutMs !== undefined && cleanTimeout(draft.timeoutMs) === undefined) {
    throw new Error("MCP 超时需在 1 到 300 秒之间。");
  }
}

function compactMap(value: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const cleanKey = key.trim();
    if (cleanKey) out[cleanKey] = item;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function browserEnvironment(value: Record<string, string> | undefined): Record<string, string> | undefined {
  const token = value?.[PLAYWRIGHT_EXTENSION_TOKEN_KEY]?.trim();
  return token ? { [PLAYWRIGHT_EXTENSION_TOKEN_KEY]: token } : undefined;
}

export function upsertStoredMcpServer(
  current: StoredMcpServers | undefined,
  draft: McpServerDraft,
  mintId: () => string,
): { servers: StoredMcpServers; id: string } {
  validateDraft(draft);
  const servers = cloneStoredMcpServers(current) ?? {};
  const id = draft.id ?? mintId();
  if (!isSafeMcpId(id)) throw new Error("MCP 标识不合法。");

  if (id === PLAYWRIGHT_MCP_ID) {
    const prev = servers[id];
    const timeoutMs = cleanTimeout(draft.timeoutMs);
    const browserMode: BrowserConnectionMode = draft.browserMode === "extension"
      ? "extension"
      : draft.browserMode === "managed"
        ? "managed"
        : prev?.browserMode ?? "managed";
    const env = draft.env === undefined ? prev?.env : browserEnvironment(draft.env);
    servers[id] = {
      name: "浏览器自动化",
      description: PLAYWRIGHT_DESCRIPTION,
      transport: "stdio",
      enabled: draft.enabled === true,
      builtin: "playwright",
      browserMode,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(draft.alwaysLoad === true ? { alwaysLoad: true } : {}),
      ...(env ? { env: { ...env } } : {}),
    };
    return { servers, id };
  }

  if (id === COMPUTER_MCP_ID) {
    const prev = servers[id];
    const timeoutMs = cleanTimeout(draft.timeoutMs);
    servers[id] = {
      name: "操作电脑",
      description: COMPUTER_DESCRIPTION,
      transport: "stdio",
      enabled: draft.enabled === true,
      builtin: "computer",
      ...(timeoutMs !== undefined ? { timeoutMs } : prev?.timeoutMs !== undefined ? { timeoutMs: prev.timeoutMs } : {}),
      ...(draft.alwaysLoad === true ? { alwaysLoad: true } : prev?.alwaysLoad === true ? { alwaysLoad: true } : {}),
    };
    return { servers, id };
  }

  const prev = servers[id];
  const server: StoredMcpServer = {
    name: draft.name.trim(),
    transport: draft.transport,
    enabled: draft.enabled ?? prev?.enabled ?? true,
  };
  const description = draft.description?.trim();
  if (description) server.description = description;
  if (draft.transport === "stdio") {
    server.command = draft.command?.trim();
    server.args = [...(draft.args ?? [])];
  } else {
    server.url = draft.url?.trim();
  }
  const env = draft.env === undefined ? prev?.env : compactMap(draft.env);
  if (env) server.env = { ...env };
  const headers = draft.headers === undefined ? prev?.headers : compactMap(draft.headers);
  if (headers) server.headers = { ...headers };
  const timeoutMs = draft.timeoutMs ?? prev?.timeoutMs;
  if (timeoutMs !== undefined) server.timeoutMs = timeoutMs;
  const alwaysLoad = draft.alwaysLoad ?? prev?.alwaysLoad;
  if (alwaysLoad === true) server.alwaysLoad = true;
  servers[id] = server;
  return { servers, id };
}

export function removeStoredMcpServer(current: StoredMcpServers | undefined, id: string): StoredMcpServers | undefined {
  const next = cloneStoredMcpServers(current);
  if (!next) return undefined;
  delete next[id];
  return Object.keys(next).length > 0 ? next : undefined;
}

function builtinPlaywrightRecord(stored?: StoredMcpServer): StoredMcpServer {
  return {
    name: "浏览器自动化",
    description: PLAYWRIGHT_DESCRIPTION,
    transport: "stdio",
    // Browser control is a first-class Claude Code capability in Leemo. A
    // fresh install gets it without a setup scavenger hunt; once the user has
    // saved an explicit false, that choice remains authoritative.
    enabled: stored ? stored.enabled : true,
    builtin: "playwright",
    browserMode: stored?.browserMode === "extension" ? "extension" : "managed",
    ...(stored?.env ? { env: browserEnvironment(stored.env) } : {}),
    ...(stored?.timeoutMs !== undefined ? { timeoutMs: stored.timeoutMs } : {}),
    ...(stored?.alwaysLoad === true ? { alwaysLoad: true } : {}),
  };
}

function builtinComputerRecord(stored?: StoredMcpServer): StoredMcpServer {
  return {
    name: "操作电脑",
    description: COMPUTER_DESCRIPTION,
    transport: "stdio",
    // Seeing the screen is a new privacy boundary. Shipping the runtime must
    // not silently expand an existing user's prior "full access" choice.
    enabled: stored ? stored.enabled : false,
    builtin: "computer",
    ...(stored?.timeoutMs !== undefined ? { timeoutMs: stored.timeoutMs } : {}),
    ...(stored?.alwaysLoad === true ? { alwaysLoad: true } : {}),
  };
}

function viewOf(id: string, server: StoredMcpServer, saved: boolean, runtime?: BuiltinMcpRuntime): McpServerView {
  return {
    id,
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.builtin ? undefined : server.command,
    args: server.args ? [...server.args] : undefined,
    url: server.url,
    envKeys: Object.keys(server.env ?? {}).sort(),
    headerKeys: Object.keys(server.headers ?? {}).sort(),
    enabled: server.enabled,
    timeoutMs: server.timeoutMs,
    alwaysLoad: server.alwaysLoad,
    builtin: server.builtin,
    browserMode: server.browserMode,
    saved,
    available: server.builtin === "playwright"
      ? runtime?.playwright !== undefined
      : server.builtin === "computer"
        ? runtime?.computer !== undefined
        : true,
  };
}

function withoutArgumentPair(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      index += 1;
      continue;
    }
    out.push(args[index]);
  }
  return out;
}

function configuredPlaywrightRuntime(
  server: StoredMcpServer,
  runtime: McpStdioServerConfig,
  envSource: NodeJS.ProcessEnv,
): McpStdioServerConfig {
  const extensionMode = server.browserMode === "extension";
  let args = [...(runtime.args ?? [])];
  if (extensionMode) {
    args = withoutArgumentPair(withoutArgumentPair(args, "--browser"), "--user-data-dir");
    if (!args.includes("--extension")) args.push("--extension");
  }
  return {
    ...runtime,
    args,
    env: {
      ...safeInheritedEnvironment(envSource),
      ...(runtime.env ?? {}),
      ...(extensionMode ? browserEnvironment(server.env) : {}),
    },
    ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
    ...(server.alwaysLoad === true ? { alwaysLoad: true } : {}),
  };
}

export function listMcpServerViews(stored: StoredMcpServers | undefined, runtime?: BuiltinMcpRuntime): McpServerView[] {
  const builtinStored = stored?.[PLAYWRIGHT_MCP_ID];
  const computerStored = stored?.[COMPUTER_MCP_ID];
  const views = [
    viewOf(PLAYWRIGHT_MCP_ID, builtinPlaywrightRecord(builtinStored), builtinStored !== undefined, runtime),
    viewOf(COMPUTER_MCP_ID, builtinComputerRecord(computerStored), computerStored !== undefined, runtime),
  ];
  for (const [id, server] of Object.entries(stored ?? {})) {
    if (id === PLAYWRIGHT_MCP_ID || id === COMPUTER_MCP_ID || server.builtin || !isSafeMcpId(id)) continue;
    views.push(viewOf(id, server, true, runtime));
  }
  return views;
}

function safeInheritedEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && SAFE_ENV_KEYS.has(key.toUpperCase())) out[key] = value;
  }
  return out;
}

export function configuredSdkMcpServers(
  stored: StoredMcpServers | undefined,
  runtime?: BuiltinMcpRuntime,
  envSource: NodeJS.ProcessEnv = process.env,
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const servers: StoredMcpServers = {
    ...(stored ?? {}),
    [PLAYWRIGHT_MCP_ID]: builtinPlaywrightRecord(stored?.[PLAYWRIGHT_MCP_ID]),
    [COMPUTER_MCP_ID]: builtinComputerRecord(stored?.[COMPUTER_MCP_ID]),
  };
  for (const [id, server] of Object.entries(servers)) {
    if (id !== PLAYWRIGHT_MCP_ID && id !== COMPUTER_MCP_ID && !isSafeMcpId(id)) continue;
    if (!server.enabled) continue;
    if (server.builtin === "playwright") {
      const config = runtime?.playwright;
      if (config) {
        out[id] = configuredPlaywrightRuntime(server, config, envSource);
      }
      continue;
    }
    if (server.builtin === "computer") {
      const config = runtime?.computer;
      if (config) {
        out[id] = {
          ...config,
          env: { ...safeInheritedEnvironment(envSource), ...(config.env ?? {}) },
          ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
          ...(server.alwaysLoad === true ? { alwaysLoad: true } : {}),
        };
      }
      continue;
    }
    if (server.transport === "stdio" && server.command) {
      out[id] = {
        type: "stdio",
        command: server.command,
        args: [...(server.args ?? [])],
        env: { ...safeInheritedEnvironment(envSource), ...(server.env ?? {}) },
        ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
        ...(server.alwaysLoad === true ? { alwaysLoad: true } : {}),
      };
    } else if ((server.transport === "http" || server.transport === "sse") && server.url) {
      out[id] = {
        type: server.transport,
        url: server.url,
        ...(server.headers ? { headers: { ...server.headers } } : {}),
        ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
        ...(server.alwaysLoad === true ? { alwaysLoad: true } : {}),
      };
    }
  }
  return out;
}
