import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useMemo } from "react";
import ProviderConfigForm from "./ProviderConfigForm";
import { BridgeContext, type BridgeStores } from "../bridge/context";
import { createProvidersStore } from "../stores/providers";
import { createConversationsStore } from "../stores/conversations";
import { createSettingsStore } from "../stores/settings";
import { createNotificationsStore } from "../stores/notifications";
import { createApprovalsStore } from "../stores/approvals";
import { createArtifactsStore } from "../stores/artifacts";
import { createWikiEntriesStore } from "../stores/wiki-entries";
import { createUiStore } from "../stores/ui";
import { createNotebooksStore } from "../stores/notebooks";
import { createFileTreeStore } from "../stores/file-tree";
import { createSkillsStore } from "../stores/skills";
import { createSearchSourcesStore } from "../stores/search-sources";
import { createPreviewContentStore } from "../stores/preview-content";
import { createMcpServersStore } from "../stores/mcp-servers";
import { createUsageSummaryStore } from "../stores/usage-summary";
import { createMemoryStore } from "../stores/memory";
import type { BridgeClient } from "../bridge/client";
import type {
  ProviderConfigView,
  ProviderDraft,
  ProviderSpec,
  ConnectionTestResult,
  ListRemoteModelsResult,
} from "../../bridge/contract";

function stubClient(overrides: Partial<Record<string, (req: unknown) => unknown>> = {}): BridgeClient {
  const invoke = vi.fn(async (channel: string, req: unknown) => {
    if (channel in overrides) return overrides[channel]!(req);
    if (channel === "bridge:listProviders") return [];
    return undefined;
  });
  return { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient;
}

function Harness({ client, children }: { client: BridgeClient; children: React.ReactNode }) {
  const stores = useMemo<BridgeStores>(() => {
    const resolveDefaults = () => ({ providerId: "x", modelId: "y" });
    return {
      conversations: createConversationsStore(client, { resolveConversationDefaults: resolveDefaults }),
      settings: createSettingsStore(),
      notifications: createNotificationsStore([]),
      approvals: createApprovalsStore(client, {}),
      artifacts: createArtifactsStore(),
      wikiEntries: createWikiEntriesStore(client, { resolveConversationDefaults: resolveDefaults }),
      providers: createProvidersStore(client),
      ui: createUiStore(),
      notebooks: createNotebooksStore(undefined, []),
      fileTree: createFileTreeStore(undefined, []),
      skills: createSkillsStore(client),
      searchSources: createSearchSourcesStore(client),
      previewContent: createPreviewContentStore(),
      mcpServers: createMcpServersStore(client),
      usageSummary: createUsageSummaryStore(client),
      memory: createMemoryStore(client),
    };
  }, [client]);
  return <BridgeContext.Provider value={stores}>{children}</BridgeContext.Provider>;
}

function renderForm(client: BridgeClient, props: Partial<React.ComponentProps<typeof ProviderConfigForm>> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <Harness client={client}>
      <ProviderConfigForm onSaved={onSaved} onCancel={onCancel} {...props} />
    </Harness>,
  );
  return { ...utils, onSaved, onCancel };
}

describe("ProviderConfigForm — new instance", () => {
  it("prefills from a preset offer", async () => {
    const client = stubClient();
    renderForm(client, {
      preset: { kind: "glm", name: "GLM（智谱）", baseUrl: "https://open.bigmodel.cn/api/anthropic", apiFormat: "anthropic" },
    });
    expect(await screen.findByLabelText("名称")).toHaveValue("GLM（智谱）");
    await userEvent.setup().click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://open.bigmodel.cn/api/anthropic");
  });

  it("keeps a preset family's stable id when saving it", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const savedSpec: ProviderSpec = {
      id: "deepseek", name: "DeepSeek", kind: "deepseek", category: "cn_official",
      apiFormat: "anthropic", authMode: "api-key", baseUrl: "https://api.deepseek.com/anthropic",
      models: ["deepseek-v4-flash"], capabilities: { balanceApi: true, modelDiscovery: true, subscriptionPlan: false },
      configured: true,
    };
    const client = stubClient({
      "bridge:saveProvider": (req) => { savedPayload = req; return savedSpec; },
      "bridge:listProviders": () => [savedSpec],
    });
    renderForm(client, {
      preset: {
        id: "deepseek", kind: "deepseek", name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic",
        authMode: "api-key", models: ["deepseek-v4-flash"],
      },
    });
    await user.click(await screen.findByText("保存设置"));
    await waitFor(() => expect(savedPayload).toBeDefined());
    expect(savedPayload).toMatchObject({ id: "deepseek", kind: "deepseek" });
  });

  it("does not mark a stable preset dirty while its catalog defaults are loading", async () => {
    const onDirtyChange = vi.fn();
    const presetView: ProviderConfigView = {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiFormat: "anthropic",
      authMode: "api-key",
      category: "cn_official",
      models: ["deepseek-v4-flash"],
      capabilities: { balanceApi: true, modelDiscovery: true, subscriptionPlan: false },
      hasApiKey: false,
      saved: false,
    };
    const client = stubClient({ "bridge:getProviderConfig": () => presetView });

    renderForm(client, {
      preset: {
        id: "deepseek",
        kind: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiFormat: "anthropic",
      },
      onDirtyChange,
    });

    await screen.findByText("已启用模型");
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalled());
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it("hand-typed model name always works, even with no key / no fetch attempted", async () => {
    const user = userEvent.setup();
    const client = stubClient();
    renderForm(client, {
      preset: {
        kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai",
        modelsUrl: "https://x.test/models",
      },
    });

    const input = screen.getByLabelText("手敲模型名");
    await user.type(input, "my-custom-model{Enter}");

    expect(screen.getAllByText("my-custom-model").length).toBeGreaterThan(0);
  });

  it("does not block the hand-typed path when model discovery fails", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      "bridge:listRemoteModels": () =>
        ({ models: [], error: { kind: "auth", message: "API key 无效或已过期，请检查设置里填的 key 是否正确。" } }) as ListRemoteModelsResult,
    });
    renderForm(client, {
      preset: {
        kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai",
        modelsUrl: "https://x.test/models",
      },
    });

    await user.click(screen.getByText("拉取模型列表"));
    await screen.findByText("API key 无效或已过期，请检查设置里填的 key 是否正确。");

    // the hand-typed input must still be usable after a failed fetch
    const input = screen.getByLabelText("手敲模型名");
    await user.type(input, "manual-model{Enter}");
    expect(screen.getAllByText("manual-model").length).toBeGreaterThan(0);
  });

  it("folds a dated snapshot under its base model, collapsed by default", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      "bridge:listRemoteModels": () =>
        ({
          models: [
            { id: "qwen3.7-flash" },
            { id: "qwen3.7-flash-2026-07-15", snapshotOf: "qwen3.7-flash" },
          ],
        }) as ListRemoteModelsResult,
    });
    renderForm(client, {
      preset: {
        kind: "qwen", name: "通义千问", baseUrl: "https://x.test", apiFormat: "anthropic",
        modelsUrl: "https://x.test/models",
      },
    });

    await user.click(screen.getByText("拉取模型列表"));
    await screen.findByText("qwen3.7-flash");

    expect(screen.queryByText("qwen3.7-flash-2026-07-15")).not.toBeInTheDocument();
    expect(screen.getByText("1 个快照")).toBeInTheDocument();

    await user.click(screen.getByText("1 个快照"));
    expect(screen.getByText("qwen3.7-flash-2026-07-15")).toBeInTheDocument();
  });

  it("saves a fresh draft via bridge:saveProvider and reports the result up", async () => {
    const user = userEvent.setup();
    const savedSpec: ProviderSpec = {
      id: "minted-1", name: "新", kind: "custom", category: "custom", apiFormat: "openai",
      authMode: "api-key", baseUrl: "https://x.test", models: ["m-1"],
      capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false }, configured: true,
    };
    const client = stubClient({
      "bridge:saveProvider": () => savedSpec,
      "bridge:listProviders": () => [savedSpec],
    });
    const { onSaved } = renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] },
    });

    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedSpec));
  });
});

describe("ProviderConfigForm — editing an existing instance (留空即不改)", () => {
  const view: ProviderConfigView = {
    id: "alpha", kind: "custom", name: "中转站甲", baseUrl: "https://relay.test",
    apiFormat: "openai", authMode: "api-key", category: "custom", models: ["m-1"],
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false },
    hasApiKey: true, apiKeyMasked: "····a1b2", saved: true,
  };

  it("loads the existing config and shows the masked key hint, not the real key", async () => {
    const client = stubClient({ "bridge:getProviderConfig": () => view });
    renderForm(client, { providerId: "alpha" });

    expect(await screen.findByLabelText("名称")).toHaveValue("中转站甲");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByText(/····a1b2/)).toBeInTheDocument();
  });

  it("keeps balance queries out of the model setup journey", async () => {
    const balanceView: ProviderConfigView = {
      ...view,
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      capabilities: { ...view.capabilities, balanceApi: true },
    };
    const client = stubClient({ "bridge:getProviderConfig": () => balanceView });
    renderForm(client, { providerId: "deepseek" });

    await screen.findByLabelText("名称");
    expect(screen.queryByText("查询余额")).not.toBeInTheDocument();
  });

  it("omits apiKey from the save payload when the field is left blank", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const client = stubClient({
      "bridge:getProviderConfig": () => view,
      "bridge:saveProvider": (req) => {
        savedPayload = req as ProviderDraft;
        return { ...view, configured: true } as unknown as ProviderSpec;
      },
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect((savedPayload as { apiKey?: string }).apiKey).toBeUndefined();
  });

  it("includes apiKey in the save payload when the user types a new one", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const client = stubClient({
      "bridge:getProviderConfig": () => view,
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return { ...view, configured: true } as unknown as ProviderSpec;
      },
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.type(screen.getByLabelText("API Key"), "sk-new-key");
    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect((savedPayload as { apiKey?: string }).apiKey).toBe("sk-new-key");
  });

  it("hoists a migrated preferred model so the old default is visible and persists on save", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const twoModelView: ProviderConfigView = { ...view, models: ["m-1", "m-2"] };
    const client = stubClient({
      "bridge:getProviderConfig": () => twoModelView,
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return { ...twoModelView, configured: true } as unknown as ProviderSpec;
      },
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha", preferredModelId: "m-2" });

    await screen.findByLabelText("名称");
    expect(screen.getByText("m-2").closest("li")).toHaveAttribute("data-preferred", "true");
    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect((savedPayload as { models?: string[] }).models).toEqual(["m-2", "m-1"]);
  });

  it("loads and saves task routing in human product language", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const roleView: ProviderConfigView = {
      ...view,
      apiFormat: "anthropic",
      models: ["m-1", "m-2"],
      taskModelRouting: { fastModelId: "m-2", subagentModelId: "m-2" },
    };
    const client = stubClient({
      "bridge:getProviderConfig": () => roleView,
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return { ...roleView, configured: true } as unknown as ProviderSpec;
      },
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    expect(screen.getByText("m-1").closest("li")).toHaveAttribute("data-preferred", "true");
    await user.click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("快速与后台任务模型")).toHaveValue("m-2");
    expect(screen.getByLabelText("子任务使用模型")).toHaveValue("m-2");
    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect((savedPayload as { models?: string[] }).models).toEqual(["m-1", "m-2"]);
    expect((savedPayload as { taskModelRouting?: object }).taskModelRouting).toEqual({
      fastModelId: "m-2",
      subagentModelId: "m-2",
    });
    expect(savedPayload).not.toHaveProperty("envTemplate");
  });

  it("lets an explicitly automatic routing choice override stale internal aliases", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const openAiView: ProviderConfigView = {
      ...view,
      apiFormat: "openai",
      models: ["m-1", "m-2"],
      taskModelRouting: {},
      envTemplate: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "m-2" },
    };
    const client = stubClient({
      "bridge:getProviderConfig": () => openAiView,
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return { ...openAiView, configured: true } as unknown as ProviderSpec;
      },
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("快速与后台任务方式")).toHaveValue("auto");
    expect(screen.getByLabelText("子任务使用方式")).toHaveValue("auto");
    expect(screen.queryByText(/Fable|Sonnet|Opus|Haiku|Claude Code/)).not.toBeInTheDocument();
    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect((savedPayload as { taskModelRouting?: object }).taskModelRouting).toEqual({});
    expect(savedPayload).not.toHaveProperty("envTemplate");
  });

  it("locks editable controls while a save is pending", async () => {
    const user = userEvent.setup();
    let resolveSave!: (spec: ProviderSpec) => void;
    const deferred = new Promise<ProviderSpec>((resolve) => { resolveSave = resolve; });
    const client = stubClient({
      "bridge:getProviderConfig": () => view,
      "bridge:saveProvider": () => deferred,
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.click(screen.getByText("保存设置"));
    expect(screen.getByLabelText("名称")).toBeDisabled();
    expect(screen.getByLabelText("Base URL")).toBeDisabled();
    expect(screen.getByLabelText("手敲模型名")).toBeDisabled();

    await act(async () => {
      resolveSave({
        id: "alpha", name: "中转站甲", kind: "custom", category: "custom",
        apiFormat: "openai", authMode: "api-key", baseUrl: "https://relay.test",
        models: ["m-1"], capabilities: view.capabilities, configured: true,
      });
      await deferred;
      await Promise.resolve();
    });
  });

  it("keeps delete confirmation open and shows a retryable error when deletion fails", async () => {
    const user = userEvent.setup();
    const client = stubClient({ "bridge:getProviderConfig": () => view });
    renderForm(client, { providerId: "alpha", onDelete: vi.fn().mockRejectedValue(new Error("boom")) });

    await screen.findByLabelText("名称");
    await user.click(screen.getByRole("button", { name: "删除服务商" }));
    await user.click(screen.getByRole("button", { name: "确认删除服务商" }));

    expect(await screen.findByText("删除失败，请重试")).toBeInTheDocument();
    expect(screen.getByText("确定删除？")).toBeInTheDocument();
  });

  it("keeps secret header values write-only while allowing replacement and explicit removal", async () => {
    const user = userEvent.setup();
    const payloads: unknown[] = [];
    const headerView: ProviderConfigView = {
      ...view,
      headers: { "User-Agent": "Leemo/1" },
      secretHeaderKeys: ["Authorization", "X-Relay-Token"],
    };
    const client = stubClient({
      "bridge:getProviderConfig": () => headerView,
      "bridge:saveProvider": (req) => {
        payloads.push(req);
        return { ...headerView, configured: true } as unknown as ProviderSpec;
      },
      "bridge:listProviders": () => [],
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("header value Authorization")).toHaveValue("");
    expect(screen.getByLabelText("header value Authorization")).toHaveAttribute("placeholder", "已保存，留空不改");
    expect(screen.getAllByText("已安全保存")).toHaveLength(2);

    await user.type(screen.getByLabelText("header value Authorization"), "Bearer replacement");
    await user.click(screen.getByRole("button", { name: "删除 header X-Relay-Token" }));
    await user.click(screen.getByText("保存设置"));

    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toMatchObject({
      headers: { Authorization: "Bearer replacement", "User-Agent": "Leemo/1" },
      removeHeaderKeys: ["X-Relay-Token"],
    });
    expect(JSON.stringify(payloads[0])).not.toContain("relay-secret");
  });

  it("loads advanced discovery settings and tests the current unsaved draft", async () => {
    const user = userEvent.setup();
    let testRequest: unknown;
    const advancedView: ProviderConfigView = {
      ...view,
      modelsUrl: "https://relay.test/models",
      apiKeyUrl: "https://relay.test/keys",
    };
    const client = stubClient({
      "bridge:getProviderConfig": () => advancedView,
      "bridge:testConnection": (req) => {
        testRequest = req;
        return { ok: true, latencyMs: 22, modelEcho: "m-1" } as ConnectionTestResult;
      },
    });
    renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "https://changed.test");
    await user.click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("模型发现地址")).toHaveValue("https://relay.test/models");
    expect(screen.getByLabelText("获取 API Key 地址")).toHaveValue("https://relay.test/keys");
    await user.click(screen.getByText("测试连接"));

    await waitFor(() => expect(testRequest).toBeDefined());
    expect(testRequest).toMatchObject({ providerId: "alpha", draft: { baseUrl: "https://changed.test" } });
  });

  it("drops a late connection result after the tested configuration changes", async () => {
    const user = userEvent.setup();
    let resolveTest!: (result: ConnectionTestResult) => void;
    const deferred = new Promise<ConnectionTestResult>((resolve) => { resolveTest = resolve; });
    const onTestStateChange = vi.fn();
    const client = stubClient({
      "bridge:getProviderConfig": () => view,
      "bridge:testConnection": () => deferred,
    });
    renderForm(client, { providerId: "alpha", onTestStateChange });

    await screen.findByLabelText("名称");
    await user.click(screen.getByText("测试连接"));
    expect(screen.getByText(/正在测试连接、图片和深度思考/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Base URL"));
    await user.type(screen.getByLabelText("Base URL"), "https://new-relay.test");
    expect(screen.queryByTestId("connection-test-result")).not.toBeInTheDocument();

    await act(async () => {
      resolveTest({ ok: true, latencyMs: 10, modelEcho: "m-1" });
      await deferred;
    });

    expect(screen.queryByText("连接成功")).not.toBeInTheDocument();
    expect(onTestStateChange).not.toHaveBeenCalledWith("alpha", expect.objectContaining({ ok: true }));
  });

  it("does not report a late save after the editor has unmounted", async () => {
    const user = userEvent.setup();
    let resolveSave!: (spec: ProviderSpec) => void;
    const deferred = new Promise<ProviderSpec>((resolve) => { resolveSave = resolve; });
    const client = stubClient({
      "bridge:getProviderConfig": () => view,
      "bridge:saveProvider": () => deferred,
      "bridge:listProviders": () => [],
    });
    const { onSaved, unmount } = renderForm(client, { providerId: "alpha" });

    await screen.findByLabelText("名称");
    await user.click(screen.getByText("保存设置"));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:saveProvider", expect.anything()));
    unmount();

    await act(async () => {
      resolveSave({
        id: "alpha", name: "中转站甲", kind: "custom", category: "custom",
        apiFormat: "openai", authMode: "api-key", baseUrl: "https://relay.test",
        models: ["m-1"], capabilities: view.capabilities, configured: true,
      });
      await deferred;
      await Promise.resolve();
    });

    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("ProviderConfigForm — progressive disclosure", () => {
  it("keeps the setup journey continuous and reveals technical fields only on demand", async () => {
    const user = userEvent.setup();
    const client = stubClient();
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] },
    });

    expect(screen.getByLabelText("名称")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByText("已启用模型")).toBeInTheDocument();
    expect(screen.queryByLabelText("模型发现地址")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("子任务使用方式")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "连接与模型" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "高级设置" })).toHaveAttribute("aria-selected", "false");

    await user.click(screen.getByRole("tab", { name: "高级设置" }));
    expect(screen.getByLabelText("快速与后台任务方式")).toHaveValue("auto");
    expect(screen.getByLabelText("子任务使用方式")).toHaveValue("auto");
    expect(screen.getByLabelText("模型发现地址")).toBeInTheDocument();
    expect(screen.getByText("自定义请求头")).toBeInTheDocument();
    expect(screen.queryByText(/Fable|Sonnet|Opus|Haiku|Claude Code/)).not.toBeInTheDocument();
  });

  it("keeps a local-model setup key-free and saves the declared auth mode", async () => {
    const user = userEvent.setup();
    let savedPayload: ProviderDraft | undefined;
    const client = stubClient({
      "bridge:saveProvider": (req) => {
        savedPayload = req as ProviderDraft;
        return {
          id: "ollama",
          kind: "ollama",
          name: "Ollama",
          category: "official",
          apiFormat: "openai",
          authMode: "none",
          baseUrl: "http://127.0.0.1:11434/v1",
          models: ["qwen-local"],
          capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, local: true },
          configured: true,
        } as ProviderSpec;
      },
    });
    renderForm(client, {
      preset: {
        kind: "ollama",
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiFormat: "openai",
        authMode: "none",
        modelsUrl: "http://127.0.0.1:11434/v1/models",
        models: ["qwen-local"],
      },
    });

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByText("本地连接，无需 API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("本地服务地址")).toHaveValue("http://127.0.0.1:11434/v1");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect(savedPayload).toMatchObject({ authMode: "none", models: ["qwen-local"] });
    expect(savedPayload).not.toHaveProperty("apiKey");
  });

  it("connects a subscription through login without asking for an API key or endpoint", async () => {
    const user = userEvent.setup();
    let savedPayload: ProviderDraft | undefined;
    const savedSpec: ProviderSpec = {
      id: "claude-subscription",
      kind: "claude-subscription",
      name: "Claude 订阅",
      category: "official",
      apiFormat: "anthropic",
      authMode: "oauth-subscription",
      productKind: "consumer-subscription",
      baseUrl: "",
      models: ["claude-sonnet-4-6"],
      capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true },
      configured: true,
      saved: true,
    };
    const client = stubClient({
      "bridge:getProviderConfig": () => null,
      "bridge:getProviderLoginStatus": () => ({ state: "disconnected" }),
      "bridge:loginProvider": () => ({ state: "connected" }),
      "bridge:saveProvider": (request) => {
        savedPayload = request as ProviderDraft;
        return savedSpec;
      },
      "bridge:listProviders": () => [savedSpec],
    });
    renderForm(client, {
      preset: {
        id: "claude-subscription",
        kind: "claude-subscription",
        name: "Claude 订阅",
        baseUrl: "",
        apiFormat: "anthropic",
        authMode: "oauth-subscription",
        productKind: "consumer-subscription",
        models: ["claude-sonnet-4-6"],
      },
    });

    expect(await screen.findByText("尚未登录")).toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "登录 Claude 订阅" }));
    expect((await screen.findAllByText("订阅已连接")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "保存设置" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect(savedPayload).toMatchObject({
      id: "claude-subscription",
      authMode: "oauth-subscription",
      baseUrl: "",
      models: ["claude-sonnet-4-6"],
    });
    expect(savedPayload).not.toHaveProperty("apiKey");
  });

  it("disables subscription login when the required local app is missing", async () => {
    const client = stubClient({
      "bridge:getProviderConfig": () => null,
      "bridge:getProviderLoginStatus": () => ({
        state: "unavailable",
        message: "请先安装 Codex 并完成 ChatGPT 登录，然后重启 Leemo。",
      }),
    });
    renderForm(client, {
      preset: {
        id: "chatgpt-subscription",
        kind: "chatgpt-subscription",
        name: "ChatGPT 订阅",
        baseUrl: "",
        apiFormat: "openai-responses",
        authMode: "oauth-subscription",
        productKind: "consumer-subscription",
        models: ["gpt-5.6-sol"],
      },
    });

    expect(await screen.findByText(/请先安装 Codex/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录 ChatGPT 订阅" })).toBeDisabled();
  });
});

describe("ProviderConfigForm — connection test tri-state rendering", () => {
  it("accepts async results after React StrictMode's setup-cleanup-setup cycle", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      "bridge:testConnection": () => ({ ok: true, latencyMs: 12, modelEcho: "m-1" }) as ConnectionTestResult,
    });
    render(
      <StrictMode>
        <Harness client={client}>
          <ProviderConfigForm
            preset={{ kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] }}
            onSaved={vi.fn()}
            onCancel={vi.fn()}
          />
        </Harness>
      </StrictMode>,
    );

    await user.click(screen.getByText("测试连接"));
    expect(await screen.findByText("连接成功")).toBeInTheDocument();
  });

  it("keeps image capability unconfirmed when the service returns no probe evidence", async () => {
    const user = userEvent.setup();
    const notProbed: ConnectionTestResult = { ok: true, latencyMs: 42, thinking: true };
    const client = stubClient({ "bridge:testConnection": () => notProbed });
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] },
    });

    await user.click(screen.getByText("测试连接"));
    expect(await screen.findByText("连接成功")).toBeInTheDocument();
    expect(screen.getAllByText("图片：未确认").length).toBeGreaterThan(0);
  });

  it("treats an automatic image failure as advisory rather than unsupported", async () => {
    const user = userEvent.setup();
    const probedNo: ConnectionTestResult = {
      ok: true,
      latencyMs: 42,
      capabilityProbes: {
        image: { status: "failed", checkedAt: 42, detail: "模型没有接受这次图片测试" },
        reasoning: { status: "verified", checkedAt: 42 },
      },
    };
    const client = stubClient({ "bridge:testConnection": () => probedNo });
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] },
    });

    await user.click(screen.getByText("测试连接"));

    expect((await screen.findAllByText(/本次检测未通过 · 自动探测/).then((items) => items.length))).toBeGreaterThan(0);
    expect(screen.getByText("图片探测未通过，仍可尝试发送图片。")).toBeInTheDocument();
    expect(screen.getByText("我确认这个模型支持图片")).toBeInTheDocument();
    expect(screen.queryByText(/不支持/)).not.toBeInTheDocument();
  });

  it("shows the failed image probe detail without converting it into a capability verdict", async () => {
    const user = userEvent.setup();
    // Measured case: qwen rejects an image under 10px. That is a probe-request
    // failure, not a capability verdict — calling it 不支持 would strip the
    // attachment affordance from a model that really does see images.
    const probeFailed: ConnectionTestResult = {
      ok: true,
      latencyMs: 42,
      capabilityProbes: {
        image: { status: "failed", checkedAt: 42, detail: "图片不符合该模型的尺寸要求" },
        reasoning: { status: "verified", checkedAt: 42 },
      },
    };
    const client = stubClient({ "bridge:testConnection": () => probeFailed });
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] },
    });

    await user.click(screen.getByText("测试连接"));

    expect(await screen.findByText(/图片探测详情：图片不符合该模型的尺寸要求/)).toBeInTheDocument();
    expect(screen.queryByText(/不支持/)).not.toBeInTheDocument();
    expect(screen.getByText("我确认这个模型支持图片")).toBeInTheDocument();
  });

  it("renders a human-readable error on failure", async () => {
    const user = userEvent.setup();
    const failure: ConnectionTestResult = {
      ok: false,
      error: { kind: "auth", message: "API key 无效或已过期，请检查设置里填的 key 是否正确。" },
    };
    const client = stubClient({ "bridge:testConnection": () => failure });
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["m-1"] },
    });

    await user.click(screen.getByText("测试连接"));
    expect(await screen.findByText("API key 无效或已过期，请检查设置里填的 key 是否正确。")).toBeInTheDocument();
  });
});

describe("ProviderConfigForm — continuous human setup journey", () => {
  it("keeps preset setup in one scroll and hides wire details behind human advanced settings", async () => {
    const user = userEvent.setup();
    const client = stubClient();
    renderForm(client, {
      preset: {
        kind: "glm",
        name: "GLM（智谱）",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        apiFormat: "anthropic",
        models: ["glm-5.2", "glm-5.2-pro"],
        modelsUrl: "https://open.bigmodel.cn/api/paas/v4/models",
      },
    });

    expect(screen.queryByRole("tab", { name: "连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "模型与角色" })).not.toBeInTheDocument();
    expect(screen.getByText("已启用模型")).toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(screen.queryByText(/Fable|Sonnet|Opus|Haiku|Claude Code|环境变量/)).not.toBeInTheDocument();

    await user.click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://open.bigmodel.cn/api/anthropic");
    expect(screen.getByLabelText("模型发现地址")).toHaveValue("https://open.bigmodel.cn/api/paas/v4/models");
  });

  it("uses model order as the default and keeps task routing behind an explicit advanced choice", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const client = stubClient({
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return { id: "alpha", name: "中转站甲", kind: "custom", category: "custom", apiFormat: "openai", authMode: "api-key", baseUrl: "https://relay.test", models: ["m-2", "m-1"], configured: true } as ProviderSpec;
      },
    });
    renderForm(client, {
      preset: { kind: "custom", name: "中转站甲", baseUrl: "https://relay.test", apiFormat: "openai", models: ["m-1", "m-2"] },
    });

    expect(screen.getByText("首选")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上移模型 m-2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设为首选模型 m-2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设为首选模型 m-2" }));
    expect(screen.getByText("m-2").closest("li")).toHaveAttribute("data-preferred", "true");

    expect(screen.queryByLabelText("快速与后台任务模型")).not.toBeInTheDocument();
    await user.click(screen.getByText("高级设置"));
    await user.selectOptions(screen.getByLabelText("快速与后台任务方式"), "specific");
    expect(screen.getByLabelText("快速与后台任务模型")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("快速与后台任务模型"), "m-1");
    await user.selectOptions(screen.getByLabelText("子任务使用方式"), "specific");
    await user.selectOptions(screen.getByLabelText("子任务使用模型"), "m-2");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect(savedPayload).toMatchObject({
      models: ["m-2", "m-1"],
      taskModelRouting: { fastModelId: "m-1", subagentModelId: "m-2" },
    });
  });

  it("tests the first model automatically, submits no legacy probe flag, and saves structured evidence", async () => {
    const user = userEvent.setup();
    let testRequest: unknown;
    let savedPayload: unknown;
    const client = stubClient({
      "bridge:testConnection": (req) => {
        testRequest = req;
        return {
          ok: true,
          latencyMs: 18,
          modelEcho: "m-1",
          capabilityProbes: {
            image: { status: "failed", checkedAt: 11, detail: "图片探测未通过" },
            reasoning: { status: "verified", checkedAt: 11 },
          },
        } as ConnectionTestResult;
      },
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return { id: "alpha", name: "中转站甲", kind: "custom", category: "custom", apiFormat: "openai", authMode: "api-key", baseUrl: "https://relay.test", models: ["m-1"], configured: true } as ProviderSpec;
      },
    });
    renderForm(client, {
      preset: { kind: "custom", name: "中转站甲", baseUrl: "https://relay.test", apiFormat: "openai", models: ["m-1"] },
    });

    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect((await screen.findAllByText(/图片：本次检测未通过 · 自动探测/)).length).toBeGreaterThan(0);
    expect(testRequest).toMatchObject({ modelId: "m-1", draft: { models: ["m-1"] } });
    expect(testRequest).not.toHaveProperty("probeVision");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(savedPayload).toBeDefined());
    expect(savedPayload).toMatchObject({
      modelCapabilityEvidence: {
        "m-1": {
          image: { probe: { status: "failed", checkedAt: 11, detail: "图片探测未通过" } },
          reasoning: { probe: { status: "verified", checkedAt: 11 } },
        },
      },
    });
  });

  it("keeps an image probe failure advisory and supports an explicit user correction", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      "bridge:testConnection": () => ({
        ok: true,
        capabilityProbes: {
          image: { status: "failed", checkedAt: 12, detail: "探测请求被拒绝" },
          reasoning: { status: "unknown", checkedAt: 12 },
        },
      }) as ConnectionTestResult,
    });
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["vision-model"] },
    });

    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText(/探测请求被拒绝/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我确认这个模型支持图片" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检测" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "我确认这个模型支持图片" }));
    expect(screen.getAllByText(/图片：用户已确认支持/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "恢复自动判断" }));
    expect(screen.getAllByText(/图片：本次检测未通过 · 自动探测/).length).toBeGreaterThan(0);
  });

  it("renders a failed reasoning probe as failed evidence rather than unconfirmed", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      "bridge:testConnection": () => ({
        ok: true,
        capabilityProbes: {
          image: { status: "unknown", checkedAt: 12 },
          reasoning: { status: "failed", checkedAt: 12, detail: "没有返回可验证的思考信号" },
        },
      }) as ConnectionTestResult,
    });
    renderForm(client, {
      preset: { kind: "custom", name: "新", baseUrl: "https://x.test", apiFormat: "openai", models: ["reasoning-model"] },
    });

    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const result = await screen.findByTestId("connection-test-result");
    expect(within(result).getByText("深度思考：本次检测未通过 · 自动探测")).toBeInTheDocument();
  });
});
