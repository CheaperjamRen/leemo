import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createClaudeSubscriptionAuth,
  createSharedLocalSubscriptionAuth,
  createProviderSubscriptionAuthRouter,
  type AuthCommandRequest,
  type AuthCommandResult,
} from "../../src/host/provider-subscription-auth";

const cleanup: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "leemo-subscription-auth-"));
  cleanup.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Claude subscription login", () => {
  it("checks status in a provider-isolated config directory without inheriting host credentials", async () => {
    const requests: AuthCommandRequest[] = [];
    const runCommand = vi.fn(async (request: AuthCommandRequest): Promise<AuthCommandResult> => {
      requests.push(request);
      return { exitCode: 0, stdout: '{"loggedIn":true,"authMethod":"oauth_token"}', stderr: "" };
    });
    const configRoot = await tempRoot();
    const auth = createClaudeSubscriptionAuth({
      executablePath: "C:\\Leemo\\claude.exe",
      configRoot,
      hostEnv: {
        PATH: "C:\\Windows\\System32",
        ANTHROPIC_API_KEY: "must-not-cross",
        OPENAI_API_KEY: "must-not-cross-either",
        CLAUDE_CODE_OAUTH_TOKEN: "must-stay-global",
      },
      runCommand,
    });

    await expect(auth.getStatus("claude-subscription")).resolves.toEqual({ state: "connected" });
    expect(requests).toHaveLength(1);
    expect(requests[0].args).toEqual(["auth", "status", "--json"]);
    expect(requests[0].env.CLAUDE_CONFIG_DIR).toBe(path.join(configRoot, "providers", "claude-subscription"));
    expect(requests[0].env.PATH).toBe("C:\\Windows\\System32");
    expect(requests[0].env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(requests[0].env.OPENAI_API_KEY).toBeUndefined();
    expect(requests[0].env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("opens the subscription login flow and confirms the resulting status", async () => {
    const seenArgs: string[][] = [];
    const runCommand = vi.fn(async (request: AuthCommandRequest): Promise<AuthCommandResult> => {
      seenArgs.push(request.args);
      if (request.args[1] === "login") return { exitCode: 0, stdout: "Login successful", stderr: "" };
      return { exitCode: 0, stdout: '{"loggedIn":true}', stderr: "" };
    });
    const auth = createClaudeSubscriptionAuth({
      executablePath: "C:\\Leemo\\claude.exe",
      configRoot: await tempRoot(),
      hostEnv: {},
      runCommand,
    });

    await expect(auth.login("claude-subscription")).resolves.toEqual({ state: "connected" });
    expect(seenArgs).toEqual([
      ["auth", "login", "--claudeai"],
      ["auth", "status", "--json"],
    ]);
  });

  it("logs out of only the selected subscription account", async () => {
    const seenArgs: string[][] = [];
    const runCommand = vi.fn(async (request: AuthCommandRequest): Promise<AuthCommandResult> => {
      seenArgs.push(request.args);
      if (request.args[1] === "logout") return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: 1, stdout: '{"loggedIn":false}', stderr: "" };
    });
    const auth = createClaudeSubscriptionAuth({
      executablePath: "C:\\Leemo\\claude.exe",
      configRoot: await tempRoot(),
      hostEnv: {},
      runCommand,
    });

    await expect(auth.logout("claude-subscription")).resolves.toEqual({ state: "disconnected" });
    expect(seenArgs).toEqual([
      ["auth", "logout"],
      ["auth", "status", "--json"],
    ]);
  });

  it("returns a safe unavailable state when the local login component cannot start", async () => {
    const auth = createClaudeSubscriptionAuth({
      executablePath: "C:\\missing\\claude.exe",
      configRoot: await tempRoot(),
      hostEnv: {},
      runCommand: async () => { throw new Error("spawn C:\\private\\user\\secret ENOENT"); },
    });

    const status = await auth.getStatus("claude-subscription");
    expect(status.state).toBe("unavailable");
    expect(status.message).toMatch(/登录组件/);
    expect(JSON.stringify(status)).not.toContain("private");
  });
});

describe("subscription auth router", () => {
  it("routes each subscription family to its own isolated login service", async () => {
    const claude = {
      getStatus: vi.fn(async () => ({ state: "connected" as const })),
      login: vi.fn(async () => ({ state: "connected" as const })),
      logout: vi.fn(async () => ({ state: "disconnected" as const })),
    };
    const chatgpt = {
      getStatus: vi.fn(async () => ({ state: "disconnected" as const })),
      login: vi.fn(async () => ({ state: "connected" as const })),
      logout: vi.fn(async () => ({ state: "disconnected" as const })),
    };
    const auth = createProviderSubscriptionAuthRouter({
      "claude-subscription": claude,
      "chatgpt-subscription": chatgpt,
    });

    await expect(auth.getStatus("chatgpt-subscription")).resolves.toEqual({ state: "disconnected" });
    await expect(auth.login("claude-subscription")).resolves.toEqual({ state: "connected" });
    expect(chatgpt.getStatus).toHaveBeenCalledWith("chatgpt-subscription");
    expect(claude.login).toHaveBeenCalledWith("claude-subscription");
    expect(claude.getStatus).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown subscription without leaking implementation details", async () => {
    const auth = createProviderSubscriptionAuthRouter({});
    const status = await auth.login("unknown-subscription");
    expect(status.state).toBe("unavailable");
    expect(status.message).toMatch(/登录组件/);
    expect(JSON.stringify(status)).not.toMatch(/claude|codex|app-server/i);
  });
});

describe("shared local subscription login", () => {
  it("checks a non-secret local marker and opens the user's own login client", async () => {
    let connected = false;
    const openLogin = vi.fn(async () => {});
    const auth = createSharedLocalSubscriptionAuth({
      productName: "Gemini",
      isLoggedIn: () => connected,
      openLogin,
    });

    await expect(auth.getStatus("gemini-subscription")).resolves.toEqual({
      state: "disconnected",
      message: "请先在本机完成 Gemini 登录。",
    });
    await expect(auth.login("gemini-subscription")).resolves.toEqual({
      state: "disconnected",
      message: "已打开 Gemini 登录窗口；完成后回到 Leemo 刷新状态。",
    });
    expect(openLogin).toHaveBeenCalledTimes(1);

    connected = true;
    await expect(auth.getStatus("gemini-subscription")).resolves.toEqual({ state: "connected" });
    await expect(auth.logout("gemini-subscription")).resolves.toEqual({
      state: "connected",
      message: "这是本机共享登录，请在 Gemini 客户端中切换或退出账号。",
    });
  });

  it("does not leak a failed launch error into the renderer", async () => {
    const auth = createSharedLocalSubscriptionAuth({
      productName: "Gemini",
      isLoggedIn: () => false,
      openLogin: async () => { throw new Error("C:\\Users\\private\\token"); },
    });
    const status = await auth.login("gemini-subscription");
    expect(status).toEqual({
      state: "unavailable",
      message: "无法打开 Gemini 登录窗口，请确认本机客户端仍可用。",
    });
    expect(JSON.stringify(status)).not.toContain("private");
  });
});
