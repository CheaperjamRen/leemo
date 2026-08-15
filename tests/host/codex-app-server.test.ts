import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  CodexAppServerClient,
  createCodexSubscriptionAuth,
  type CodexAppServerProcess,
  type CodexAppServerSpawnRequest,
} from "../../src/host/codex-app-server";

class FakeAppServerProcess extends EventEmitter implements CodexAppServerProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
}

function observeRequests(
  child: FakeAppServerProcess,
  onMessage: (message: RpcMessage) => void,
): RpcMessage[] {
  const messages: RpcMessage[] = [];
  let buffered = "";
  child.stdin.on("data", (chunk: Buffer | string) => {
    buffered += chunk.toString();
    while (buffered.includes("\n")) {
      const newline = buffered.indexOf("\n");
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as RpcMessage;
      messages.push(message);
      onMessage(message);
    }
  });
  return messages;
}

function answerInitialize(child: FakeAppServerProcess, message: RpcMessage): boolean {
  if (message.method !== "initialize" || message.id === undefined) return false;
  child.send({ method: "server/ready", params: { phase: "starting" } });
  child.send({
    id: message.id,
    result: {
      userAgent: "codex-test",
      codexHome: "C:\\isolated",
      platformFamily: "windows",
      platformOs: "windows",
    },
  });
  return true;
}

describe("Codex app-server transport", () => {
  it("initializes once and matches responses while notifications are interleaved", async () => {
    const child = new FakeAppServerProcess();
    const spawnRequests: CodexAppServerSpawnRequest[] = [];
    const messages = observeRequests(child, (message) => {
      if (answerInitialize(child, message)) return;
      if (message.method === "account/read" && message.id !== undefined) {
        child.send({ id: message.id, result: { account: null, requiresOpenaiAuth: true } });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: "C:\\Leemo\\codex.exe",
      hostEnv: {},
      spawnProcess: (request) => {
        spawnRequests.push(request);
        return child;
      },
    });
    const ready = vi.fn();
    client.onNotification("server/ready", ready);

    const account = await client.request<{ account: null; requiresOpenaiAuth: boolean }>(
      "account/read",
      { refreshToken: false },
    );

    expect(account).toEqual({ account: null, requiresOpenaiAuth: true });
    expect(ready).toHaveBeenCalledWith({ phase: "starting" });
    expect(spawnRequests).toHaveLength(1);
    expect(messages.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
    ]);
    expect(messages[0].params).toEqual({
      clientInfo: { name: "leemo", title: "Leemo", version: "0.1.1" },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    client.dispose();
  });

  it("reuses the user's Codex home while still stripping ambient API secrets", async () => {
    const child = new FakeAppServerProcess();
    observeRequests(child, (message) => {
      answerInitialize(child, message);
    });
    const requests: CodexAppServerSpawnRequest[] = [];
    const client = new CodexAppServerClient({
      executablePath: "C:\\Leemo\\codex.exe",
      hostEnv: {
        PATH: "C:\\Windows\\System32",
        CODEX_HOME: "C:\\Users\\me\\.codex",
        OPENAI_API_KEY: "must-not-cross",
        ANTHROPIC_API_KEY: "must-not-cross-either",
        SOME_ACCESS_TOKEN: "must-stay-global",
      },
      spawnProcess: (request) => {
        requests.push(request);
        return child;
      },
    });

    await client.start();

    expect(requests).toHaveLength(1);
    expect(requests[0].args).toEqual([
      "app-server",
      "--stdio",
    ]);
    expect(requests[0].env.CODEX_HOME).toBe("C:\\Users\\me\\.codex");
    expect(requests[0].env.PATH).toBe("C:\\Windows\\System32");
    expect(requests[0].env.OPENAI_API_KEY).toBeUndefined();
    expect(requests[0].env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(requests[0].env.SOME_ACCESS_TOKEN).toBeUndefined();
    client.dispose();
  });

  it("rejects pending work with a safe error when the local process exits", async () => {
    const child = new FakeAppServerProcess();
    observeRequests(child, (message) => {
      answerInitialize(child, message);
    });
    const client = new CodexAppServerClient({
      executablePath: "C:\\Users\\private\\secret\\codex.exe",
      hostEnv: {},
      spawnProcess: () => child,
    });
    await client.start();

    const pending = client.request("account/read", {});
    child.emit("exit", 1, null);

    await expect(pending).rejects.toThrow(/Codex 当前不可用/);
    await expect(pending).rejects.not.toThrow(/private|secret/);
    client.dispose();
  });

  it("times out and terminates an unresponsive local process", async () => {
    const child = new FakeAppServerProcess();
    observeRequests(child, () => {
      // Intentionally never answer initialize.
    });
    const client = new CodexAppServerClient({
      executablePath: "C:\\Leemo\\codex.exe",
      hostEnv: {},
      requestTimeoutMs: 5,
      spawnProcess: () => child,
    });

    await expect(client.start()).rejects.toThrow(/Codex 当前不可用/);
    expect(child.killed).toBe(true);
    client.dispose();
  });

  it("routes app-server requests back through a registered Leemo handler", async () => {
    const child = new FakeAppServerProcess();
    let resolveReply!: (value: RpcMessage) => void;
    const reply = new Promise<RpcMessage>((resolve) => { resolveReply = resolve; });
    observeRequests(child, (message) => {
      if (answerInitialize(child, message)) return;
      if (message.id === 900 && message.method === undefined) resolveReply(message);
    });
    const client = new CodexAppServerClient({
      executablePath: "C:\\Leemo\\codex.exe",
      hostEnv: {},
      spawnProcess: () => child,
    });
    const approve = vi.fn(async () => ({ decision: "accept" }));
    client.onServerRequest("item/commandExecution/requestApproval", approve);
    await client.start();

    child.send({
      id: 900,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" },
    });

    await expect(reply).resolves.toEqual({ id: 900, result: { decision: "accept" } });
    expect(approve).toHaveBeenCalledWith({
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
    });
    client.dispose();
  });
});

describe("ChatGPT subscription authentication", () => {
  it("opens the returned login page and connects only after the matching completion event", async () => {
    const child = new FakeAppServerProcess();
    let loggedIn = false;
    const messages = observeRequests(child, (message) => {
      if (answerInitialize(child, message)) return;
      if (message.method === "account/login/start" && message.id !== undefined) {
        child.send({
          id: message.id,
          result: { type: "chatgpt", loginId: "login-42", authUrl: "https://auth.example/start" },
        });
      }
      if (message.method === "account/read" && message.id !== undefined) {
        child.send({
          id: message.id,
          result: {
            account: loggedIn
              ? { type: "chatgpt", email: "private@example.com", planType: "plus" }
              : null,
            requiresOpenaiAuth: true,
          },
        });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: "C:\\Leemo\\codex.exe",
      hostEnv: {},
      spawnProcess: () => child,
    });
    const openExternal = vi.fn(async (url: string) => {
      expect(url).toBe("https://auth.example/start");
      loggedIn = true;
      child.send({
        method: "account/login/completed",
        params: { loginId: "login-42", success: true, error: null },
      });
    });
    const auth = createCodexSubscriptionAuth({
      providerId: "chatgpt-subscription",
      client,
      openExternal,
      loginTimeoutMs: 1_000,
    });

    const status = await auth.login("chatgpt-subscription");

    expect(status).toEqual({ state: "connected" });
    expect(JSON.stringify(status)).not.toContain("private@example.com");
    expect(openExternal).toHaveBeenCalledOnce();
    expect(messages.find((message) => message.method === "account/login/start")?.params).toEqual({
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt",
    });
    client.dispose();
  });

  it("logs out through the user's Codex account and reports a disconnected state", async () => {
    const child = new FakeAppServerProcess();
    let loggedIn = true;
    observeRequests(child, (message) => {
      if (answerInitialize(child, message)) return;
      if (message.method === "account/logout" && message.id !== undefined) {
        loggedIn = false;
        child.send({ id: message.id, result: {} });
      }
      if (message.method === "account/read" && message.id !== undefined) {
        child.send({
          id: message.id,
          result: {
            account: loggedIn ? { type: "chatgpt", email: null, planType: "plus" } : null,
            requiresOpenaiAuth: true,
          },
        });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: "C:\\Leemo\\codex.exe",
      hostEnv: {},
      spawnProcess: () => child,
    });
    const auth = createCodexSubscriptionAuth({
      providerId: "chatgpt-subscription",
      client,
      openExternal: vi.fn(),
    });

    await expect(auth.getStatus("chatgpt-subscription")).resolves.toEqual({ state: "connected" });
    await expect(auth.logout("chatgpt-subscription")).resolves.toEqual({ state: "disconnected" });
    client.dispose();
  });
});
