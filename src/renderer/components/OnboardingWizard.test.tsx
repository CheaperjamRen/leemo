import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext } from "react";
import { OnboardingWizard } from "./OnboardingWizard";
import { BridgeContext, BridgeProvider, type BridgeStores } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import type { ProviderSpec } from "../../bridge/contract";
import type { WorkspaceClient, WorkspaceNotebook } from "../workspace/client";

const DEEPSEEK: ProviderSpec = {
  id: "deepseek",
  kind: "deepseek",
  name: "DeepSeek",
  category: "cn_official",
  apiFormat: "anthropic",
  authMode: "api-key",
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKeyUrl: "https://platform.deepseek.com/api_keys",
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  modelCapabilities: {
    "deepseek-v4-flash": { thinking: true, vision: false },
    "deepseek-v4-pro": { thinking: true, vision: false },
  },
  capabilities: { balanceApi: true, modelDiscovery: true, subscriptionPlan: false },
  configured: false,
};

const GLM: ProviderSpec = {
  ...DEEPSEEK,
  id: "glm",
  kind: "glm",
  name: "GLM（智谱）",
  baseUrl: "https://open.bigmodel.cn/api/anthropic",
  apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  models: ["glm-5.2"],
};

function makeClient(options: { configured?: boolean; connectionOk?: boolean } = {}) {
  let configured = options.configured ?? false;
  const invoke = vi.fn(async (channel: string, request: unknown) => {
    switch (channel) {
      case "bridge:listProviders":
        return [{ ...DEEPSEEK, configured }, GLM];
      case "bridge:listSkills":
      case "bridge:listMcpServers":
        return [];
      case "bridge:testConnection":
        return options.connectionOk === false
          ? { ok: false, error: { kind: "auth", message: "API Key 不对，请检查后重试。" } }
          : { ok: true, latencyMs: 86, thinking: true };
      case "bridge:saveProvider":
        configured = true;
        return { ...DEEPSEEK, configured: true };
      default:
        return undefined;
    }
  });
  return {
    client: { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient,
    invoke,
  };
}

function makeWorkspace() {
  const starter: WorkspaceNotebook = {
    id: "例：高等数学", title: "例：高等数学", dir: "C:\\Users\\Test\\Leemo\\例：高等数学",
    color: "blue", hasMemory: true,
  };
  const workspace = {
    ensureStarterNotebook: vi.fn(async () => starter),
    listNotebooks: vi.fn(async () => ({ root: "C:\\Users\\Test\\Leemo", notebooks: [starter] })),
    readTree: vi.fn(async () => []),
    createNotebook: vi.fn(), dropFiles: vi.fn(), moveFile: vi.fn(), suggestNotebook: vi.fn(),
    readTextFile: vi.fn(), readPreview: vi.fn(), reveal: vi.fn(), pathForFile: vi.fn(),
  } as unknown as WorkspaceClient;
  return workspace;
}

function renderFirstRun(options: { configured?: boolean; connectionOk?: boolean } = {}) {
  const { client, invoke } = makeClient(options);
  const workspace = makeWorkspace();
  let stores: BridgeStores | null = null;
  function Probe() {
    stores = useContext(BridgeContext);
    return <OnboardingWizard />;
  }
  render(
    <BridgeProvider client={client} live workspace={workspace}>
      <Probe />
    </BridgeProvider>,
  );
  return { invoke, workspace, getStores: () => stores! };
}

describe("OnboardingWizard", () => {
  it("opens automatically only when the live catalog has no configured provider", async () => {
    renderFirstRun();
    expect(await screen.findByRole("dialog", { name: "首次设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DeepSeek/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("provider-brand-deepseek").querySelector("img")).not.toBeNull();
    expect(screen.getByTestId("provider-brand-glm").querySelector("img")).not.toBeNull();
    expect(screen.getByText("推荐")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /获取 API Key/ })).toHaveAttribute("target", "_blank");
  });

  it("does not interrupt an existing user who already has a configured provider", async () => {
    renderFirstRun({ configured: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "首次设置" })).not.toBeInTheDocument());
  });

  it("tests before saving, prepares the sample notebook, and chooses the working default model", async () => {
    const user = userEvent.setup();
    const { invoke, workspace, getStores } = renderFirstRun();
    await screen.findByRole("dialog", { name: "首次设置" });
    await user.type(screen.getByLabelText("API Key"), "test-key-123");
    await user.click(screen.getByRole("button", { name: "测试并继续" }));

    expect(await screen.findByText("momo 已经准备好了")).toBeInTheDocument();
    const channels = invoke.mock.calls.map(([channel]) => channel);
    expect(channels.indexOf("bridge:testConnection")).toBeLessThan(channels.indexOf("bridge:saveProvider"));
    const testRequest = invoke.mock.calls.find(([channel]) => channel === "bridge:testConnection")?.[1] as {
      draft: { id?: string; apiKey?: string };
    };
    expect(testRequest.draft).toMatchObject({ id: "deepseek", apiKey: "test-key-123" });
    expect(workspace.ensureStarterNotebook).toHaveBeenCalledTimes(1);
    expect(getStores().settings.getState()).toMatchObject({
      mode: "buddy", defaultProviderId: "deepseek", defaultModelId: "deepseek-v4-flash",
      onboardingCompleted: false,
    });

    await user.click(screen.getByRole("button", { name: "和 momo 说第一句" }));
    expect(screen.queryByRole("dialog", { name: "首次设置" })).not.toBeInTheDocument();
    expect(getStores().settings.getState().onboardingCompleted).toBe(true);
  });

  it("shows the classified connection error and never saves a failed key", async () => {
    const user = userEvent.setup();
    const { invoke } = renderFirstRun({ connectionOk: false });
    await screen.findByRole("dialog", { name: "首次设置" });
    await user.type(screen.getByLabelText("API Key"), "bad-test-key");
    await user.click(screen.getByRole("button", { name: "测试并继续" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("API Key 不对，请检查后重试。");
    expect(invoke.mock.calls.some(([channel]) => channel === "bridge:saveProvider")).toBe(false);
  });

  it("lets the user look around without falsely marking setup complete", async () => {
    const user = userEvent.setup();
    const { getStores } = renderFirstRun();
    await screen.findByRole("dialog", { name: "首次设置" });
    await user.click(screen.getByRole("button", { name: "稍后配置" }));
    expect(screen.queryByRole("dialog", { name: "首次设置" })).not.toBeInTheDocument();
    expect(getStores().settings.getState().onboardingCompleted).toBe(false);
  });
});
