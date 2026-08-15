import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { sanitizeHostEnv } from "../bridge/providers";
import type { ProviderLoginStatus } from "../bridge/contract";

export interface AuthCommandRequest {
  executablePath: string;
  args: string[];
  env: Record<string, string | undefined>;
  timeoutMs: number;
}

export interface AuthCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AuthCommandRunner = (request: AuthCommandRequest) => Promise<AuthCommandResult>;

export interface ProviderSubscriptionAuth {
  getStatus(providerId: string): Promise<ProviderLoginStatus>;
  login(providerId: string): Promise<ProviderLoginStatus>;
  logout(providerId: string): Promise<ProviderLoginStatus>;
}

/** Keep a subscription offer visible and actionable even when its user-owned
 * local runtime is absent. The renderer can disable login and show one precise
 * recovery step instead of pretending the provider is merely signed out. */
export function createUnavailableProviderSubscriptionAuth(
  message: string,
): ProviderSubscriptionAuth {
  const status = (): ProviderLoginStatus => ({ state: "unavailable", message });
  return {
    getStatus: async () => status(),
    login: async () => status(),
    logout: async () => status(),
  };
}

/** Route login-based providers without teaching the bridge about individual
 * vendors. Each service owns its own credential directory and runtime. */
export function createProviderSubscriptionAuthRouter(
  routes: Readonly<Record<string, ProviderSubscriptionAuth>>,
): ProviderSubscriptionAuth {
  const missing = (): ProviderLoginStatus => ({
    state: "unavailable",
    message: "这个订阅的登录组件暂不可用，请重启 Leemo 后再试。",
  });
  return {
    getStatus: (providerId) => routes[providerId]?.getStatus(providerId) ?? Promise.resolve(missing()),
    login: (providerId) => routes[providerId]?.login(providerId) ?? Promise.resolve(missing()),
    logout: (providerId) => routes[providerId]?.logout(providerId) ?? Promise.resolve(missing()),
  };
}

export interface SharedLocalSubscriptionAuthOptions {
  productName: string;
  isLoggedIn(): boolean | Promise<boolean>;
  openLogin(): void | Promise<void>;
}

/** A login owned by a user-installed desktop/CLI client. Leemo observes only
 * the minimum non-secret marker and never copies or clears the shared token. */
export function createSharedLocalSubscriptionAuth(
  options: SharedLocalSubscriptionAuthOptions,
): ProviderSubscriptionAuth {
  async function connected(): Promise<boolean> {
    try {
      return await options.isLoggedIn();
    } catch {
      return false;
    }
  }

  async function getStatus(): Promise<ProviderLoginStatus> {
    return await connected()
      ? { state: "connected" }
      : { state: "disconnected", message: `请先在本机完成 ${options.productName} 登录。` };
  }

  async function login(): Promise<ProviderLoginStatus> {
    if (await connected()) return { state: "connected" };
    try {
      await options.openLogin();
      return {
        state: "disconnected",
        message: `已打开 ${options.productName} 登录窗口；完成后回到 Leemo 刷新状态。`,
      };
    } catch {
      return {
        state: "unavailable",
        message: `无法打开 ${options.productName} 登录窗口，请确认本机客户端仍可用。`,
      };
    }
  }

  async function logout(): Promise<ProviderLoginStatus> {
    return await connected()
      ? {
          state: "connected",
          message: `这是本机共享登录，请在 ${options.productName} 客户端中切换或退出账号。`,
        }
      : getStatus();
  }

  return { getStatus, login, logout };
}

export interface ClaudeSubscriptionAuthOptions {
  executablePath: string;
  configRoot: string;
  hostEnv?: Record<string, string | undefined>;
  runCommand?: AuthCommandRunner;
}

function defaultRunCommand(request: AuthCommandRequest): Promise<AuthCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      request.executablePath,
      request.args,
      {
        env: request.env,
        encoding: "utf8",
        timeout: request.timeoutMs,
        windowsHide: true,
        maxBuffer: 512 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode: error && typeof error.code === "number" ? error.code : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function parseLoggedIn(stdout: string): boolean | undefined {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    const value = JSON.parse(stdout.slice(start, end + 1)) as { loggedIn?: unknown };
    return typeof value.loggedIn === "boolean" ? value.loggedIn : undefined;
  } catch {
    return undefined;
  }
}

function safeProviderSegment(providerId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(providerId)) throw new Error("invalid provider id");
  return providerId;
}

const unavailable = (): ProviderLoginStatus => ({
  state: "unavailable",
  message: "订阅登录组件暂不可用，请重启 Leemo 后再试。",
});

/** Native Claude subscription authentication, isolated from any global Claude
 * installation. The same providers/<id> directory is later assigned to the
 * SDK child by the conversation pool, so login status and runtime cannot drift. */
export function createClaudeSubscriptionAuth(
  options: ClaudeSubscriptionAuthOptions,
): ProviderSubscriptionAuth {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const hostEnv = options.hostEnv ?? process.env;

  async function run(providerId: string, args: string[], timeoutMs: number): Promise<AuthCommandResult> {
    const configDir = path.join(options.configRoot, "providers", safeProviderSegment(providerId));
    await mkdir(configDir, { recursive: true });
    return runCommand({
      executablePath: options.executablePath,
      args,
      timeoutMs,
      env: {
        ...sanitizeHostEnv(hostEnv),
        CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    });
  }

  async function getStatus(providerId: string): Promise<ProviderLoginStatus> {
    try {
      const result = await run(providerId, ["auth", "status", "--json"], 20_000);
      const loggedIn = parseLoggedIn(result.stdout);
      if (loggedIn === true) return { state: "connected" };
      if (loggedIn === false || result.exitCode !== 0) return { state: "disconnected" };
      return unavailable();
    } catch {
      return unavailable();
    }
  }

  async function login(providerId: string): Promise<ProviderLoginStatus> {
    try {
      const result = await run(providerId, ["auth", "login", "--claudeai"], 5 * 60_000);
      if (result.exitCode !== 0) {
        return { state: "disconnected", message: "登录没有完成，可以重新尝试。" };
      }
      return getStatus(providerId);
    } catch {
      return unavailable();
    }
  }

  async function logout(providerId: string): Promise<ProviderLoginStatus> {
    try {
      const result = await run(providerId, ["auth", "logout"], 20_000);
      if (result.exitCode !== 0) return unavailable();
      return getStatus(providerId);
    } catch {
      return unavailable();
    }
  }

  return { getStatus, login, logout };
}
