import { spawn } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { sanitizeHostEnv } from "../bridge/providers";
import type { ProviderLoginStatus } from "../bridge/contract";
import type { ProviderSubscriptionAuth } from "./provider-subscription-auth";

export interface CodexAppServerSpawnRequest {
  executablePath: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export interface CodexAppServerProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type CodexAppServerSpawner = (
  request: CodexAppServerSpawnRequest,
) => CodexAppServerProcess;

export interface CodexAppServerClientOptions {
  executablePath: string;
  hostEnv?: Record<string, string | undefined>;
  spawnProcess?: CodexAppServerSpawner;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type NotificationHandler = (params: unknown) => void;
type ServerRequestHandler = (params: unknown) => Promise<unknown> | unknown;

interface RpcEnvelope {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

function defaultSpawnProcess(request: CodexAppServerSpawnRequest): CodexAppServerProcess {
  return spawn(request.executablePath, request.args, {
    env: request.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as unknown as CodexAppServerProcess;
}

const processUnavailable = (): Error => new Error(
  "本机 Codex 当前不可用。请确认已安装最新版 Codex 并完成 ChatGPT 登录，然后重启 Leemo。",
);

/**
 * Minimal JSONL client for the official Codex app-server protocol.
 *
 * Leemo intentionally keeps only the small protocol surface it uses instead of
 * checking hundreds of generated declaration files into the product. The
 * The child intentionally inherits the user's normal Codex home so Leemo can
 * reuse an existing subscription login. Secret-shaped ambient environment
 * variables are still stripped before spawn and account details never cross
 * the process boundary.
 */
export class CodexAppServerClient {
  private readonly options: CodexAppServerClientOptions;
  private readonly spawnProcess: CodexAppServerSpawner;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>();
  private readonly serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private child: CodexAppServerProcess | undefined;
  private lines: ReadlineInterface | undefined;
  private startPromise: Promise<void> | undefined;
  private nextRequestId = 1;
  private disposed = false;

  constructor(options: CodexAppServerClientOptions) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  }

  async start(): Promise<void> {
    if (this.child) return;
    if (this.disposed) throw processUnavailable();
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startProcess(): Promise<void> {
    let child: CodexAppServerProcess;
    try {
      child = this.spawnProcess({
        executablePath: this.options.executablePath,
        args: ["app-server", "--stdio"],
        env: sanitizeHostEnv(this.options.hostEnv ?? process.env),
      });
    } catch {
      throw processUnavailable();
    }

    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));
    // Always drain stderr so a verbose child cannot block. It is deliberately
    // not copied into Leemo logs because upstream diagnostics may contain paths.
    child.stderr.resume();
    child.once("error", () => this.handleProcessFailure(child));
    child.on("exit", () => this.handleProcessFailure(child));

    try {
      await this.requestRaw("initialize", {
        clientInfo: { name: "leemo", title: "Leemo", version: "0.1.1" },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      });
      this.notifyRaw("initialized", {});
    } catch {
      this.handleProcessFailure(child, true);
      throw processUnavailable();
    }
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    await this.start();
    return this.requestRaw(method, params) as Promise<TResult>;
  }

  notify(method: string, params?: unknown): void {
    if (!this.child) throw processUnavailable();
    this.notifyRaw(method, params);
  }

  onNotification(method: string, handler: NotificationHandler): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set<NotificationHandler>();
    handlers.add(handler);
    this.notificationHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.notificationHandlers.delete(method);
    };
  }

  onServerRequest(method: string, handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.set(method, handler);
    return () => {
      if (this.serverRequestHandlers.get(method) === handler) {
        this.serverRequestHandlers.delete(method);
      }
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    this.child = undefined;
    this.lines?.close();
    this.lines = undefined;
    this.rejectPending(processUnavailable());
    try {
      child?.kill();
    } catch {
      // The process is already gone.
    }
  }

  private requestRaw(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        const child = this.child;
        if (child) {
          this.handleProcessFailure(child, true);
          return;
        }
        const request = this.pending.get(id);
        this.pending.delete(id);
        request?.reject(processUnavailable());
      }, this.options.requestTimeoutMs ?? 20_000);
      timer.unref?.();
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ id, method, ...(params === undefined ? {} : { params }) });
      } catch {
        const request = this.pending.get(id);
        this.pending.delete(id);
        if (request) clearTimeout(request.timer);
        reject(processUnavailable());
      }
    });
  }

  private notifyRaw(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  private write(message: RpcEnvelope): void {
    const child = this.child;
    if (!child || child.stdin.destroyed) throw processUnavailable();
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: RpcEnvelope;
    try {
      message = JSON.parse(line) as RpcEnvelope;
    } catch {
      return;
    }

    if (typeof message.id === "number" && ("result" in message || "error" in message)) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if ("error" in message) {
        request.reject(new Error(`本地执行组件未能完成 ${request.method}。`));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    if (typeof message.id === "number" && typeof message.method === "string") {
      const handler = this.serverRequestHandlers.get(message.method);
      if (!handler) {
        this.write({
          id: message.id,
          error: { code: -32601, message: "This request is not available in Leemo." },
        });
        return;
      }
      void Promise.resolve(handler(message.params)).then(
        (result) => this.write({ id: message.id, result }),
        () => this.write({
          id: message.id,
          error: { code: -32000, message: "Leemo could not complete this request." },
        }),
      ).catch(() => {
        // The transport closed while the response was being written.
      });
      return;
    }

    if (typeof message.method !== "string") return;
    for (const handler of this.notificationHandlers.get(message.method) ?? []) {
      try {
        handler(message.params);
      } catch {
        // One view listener must not break the transport or sibling listeners.
      }
    }
  }

  private handleProcessFailure(child: CodexAppServerProcess, terminate = false): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.lines?.close();
    this.lines = undefined;
    this.rejectPending(processUnavailable());
    if (terminate) {
      try {
        child.kill();
      } catch {
        // The process is already gone.
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

interface AccountReadResponse {
  account: { type?: unknown } | null;
  requiresOpenaiAuth: boolean;
}

interface LoginStartResponse {
  type?: unknown;
  loginId?: unknown;
  authUrl?: unknown;
}

interface LoginCompletedNotification {
  loginId?: unknown;
  success?: unknown;
  error?: unknown;
}

export interface CodexSubscriptionAuthOptions {
  providerId: string;
  client: CodexAppServerClient;
  openExternal: (url: string) => Promise<void> | void;
  loginTimeoutMs?: number;
}

const authUnavailable = (): ProviderLoginStatus => ({
  state: "unavailable",
  message: "请先安装或更新 Codex 并完成 ChatGPT 登录，然后重启 Leemo。",
});

async function awaitLoginCompletion(
  client: CodexAppServerClient,
  loginId: string,
  authUrl: string,
  openExternal: CodexSubscriptionAuthOptions["openExternal"],
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: boolean, error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve(result);
    };
    const unsubscribe = client.onNotification("account/login/completed", (params) => {
      const event = params as LoginCompletedNotification;
      if (event.loginId !== loginId) return;
      finish(event.success === true);
    });
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    Promise.resolve(openExternal(authUrl)).catch(() => finish(false));
  });
}

/** ChatGPT subscription login backed by the user's existing Codex install.
 * Only a coarse state crosses IPC; email and tokens remain process-in. */
export function createCodexSubscriptionAuth(
  options: CodexSubscriptionAuthOptions,
): ProviderSubscriptionAuth {
  const providerMatches = (providerId: string): boolean => providerId === options.providerId;

  async function getStatus(providerId: string): Promise<ProviderLoginStatus> {
    if (!providerMatches(providerId)) return authUnavailable();
    try {
      const result = await options.client.request<AccountReadResponse>("account/read", {
        refreshToken: false,
      });
      return result.account?.type === "chatgpt"
        ? { state: "connected" }
        : { state: "disconnected" };
    } catch {
      return authUnavailable();
    }
  }

  async function login(providerId: string): Promise<ProviderLoginStatus> {
    if (!providerMatches(providerId)) return authUnavailable();
    try {
      const response = await options.client.request<LoginStartResponse>("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      });
      if (
        response.type !== "chatgpt"
        || typeof response.loginId !== "string"
        || typeof response.authUrl !== "string"
      ) {
        return authUnavailable();
      }
      const completed = await awaitLoginCompletion(
        options.client,
        response.loginId,
        response.authUrl,
        options.openExternal,
        options.loginTimeoutMs ?? 5 * 60_000,
      );
      if (!completed) {
        return { state: "disconnected", message: "登录没有完成，可以重新尝试。" };
      }
      return getStatus(providerId);
    } catch {
      return authUnavailable();
    }
  }

  async function logout(providerId: string): Promise<ProviderLoginStatus> {
    if (!providerMatches(providerId)) return authUnavailable();
    try {
      await options.client.request("account/logout", {});
      return getStatus(providerId);
    } catch {
      return authUnavailable();
    }
  }

  return { getStatus, login, logout };
}
