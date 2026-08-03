import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";
import { BridgeProvider, useConversations, useSettings, useUi } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import type { ProviderSpec, BalanceInfo } from "../../bridge/contract";

const mockClient: BridgeClient = {
  invoke: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
};

function ContextHintSeeder(): null {
  const noteContextApplied = useUi((s) => s.noteContextApplied);
  useEffect(() => noteContextApplied(2, 1234), [noteContextApplied]);
  return null;
}

function DefaultModelProbe(): React.JSX.Element {
  const providerId = useSettings((s) => s.defaultProviderId);
  const modelId = useSettings((s) => s.defaultModelId);
  return <span data-testid="default-model-probe">{providerId ?? "none"}:{modelId ?? "none"}</span>;
}

function DefaultModelSeeder({ providerId, modelId }: { providerId: string; modelId: string }): null {
  const setDefaultModel = useSettings((state) => state.setDefaultModel);
  useEffect(() => setDefaultModel(providerId, modelId), [modelId, providerId, setDefaultModel]);
  return null;
}

function PermissionSettingsSeeder(): null {
  const openSettings = useUi((state) => state.openSettings);
  useEffect(() => openSettings("permissions"), [openSettings]);
  return null;
}

function MemorySourceSeeder(): React.JSX.Element {
  const hydrate = useConversations((state) => state.hydrate);
  const activeId = useConversations((state) => state.activeId);
  const openTabs = useConversations((state) => state.openTabs);
  const openSettings = useUi((state) => state.openSettings);
  const settingsOpen = useUi((state) => state.settingsOpen);
  useEffect(() => {
    hydrate([{
      meta: {
        id: "conversation-source",
        title: "简历复盘",
        titleManuallyUpdated: false,
        bookId: null,
        source: "workbench",
        providerId: "fixture-provider",
        modelId: "fixture-model",
        createdAt: 1,
        lastActivityAt: 2,
        unread: false,
      },
      timeline: [],
    }]);
    openSettings("momo");
  }, [hydrate, openSettings]);
  return <span data-testid="memory-navigation-probe">{activeId ?? "none"}|{openTabs.join(",")}|{settingsOpen ? "open" : "closed"}</span>;
}

describe("SettingsPage", () => {
  it("uses a left tab navigation and renders one settings page at a time", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    expect(screen.getByRole("tablist", { name: "设置分类" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("基调模式")).toBeInTheDocument();
    expect(screen.queryByText("模型供应商")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "模型" }));
    expect(screen.getByText("模型供应商")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("provider-workbench")).toHaveClass("min-h-0", "flex-1");
    expect(screen.queryByRole("heading", { name: "默认模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "用量与费用" })).not.toBeInTheDocument();
    expect(screen.queryByText("基调模式")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "用量" }));
    expect(screen.getByRole("heading", { name: "用量与费用" })).toBeInTheDocument();
    expect(screen.queryByText("模型供应商")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    expect(screen.getByText("人设卡片")).toBeInTheDocument();
    expect(screen.getByText("话风档位")).toBeInTheDocument();
    expect(screen.getByText("momo 记得的")).toBeInTheDocument();
  });

  it("searches settings categories and opens the matching page", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.type(screen.getByPlaceholderText("搜索设置"), "浏览器");
    expect(screen.getByRole("tab", { name: "连接器" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "浏览器自动化" })).toBeInTheDocument();
  });

  it("puts the common web journey before advanced MCP extensions", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "连接器" }));
    const webHeading = screen.getByRole("heading", { name: "联网与浏览" });
    const browserHeading = screen.getByRole("heading", { name: "浏览器自动化" });
    const mcpHeading = screen.getByRole("heading", { name: "其他连接器（MCP）" });
    expect(webHeading.compareDocumentPosition(browserHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(browserHeading.compareDocumentPosition(mcpHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps setup and usage search terms in separate settings pages", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const search = screen.getByPlaceholderText("搜索设置");
    await user.type(search, "费用");
    expect(screen.getByRole("tab", { name: "用量" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "用量与费用" })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "API Key");
    expect(screen.getByRole("tab", { name: "模型" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("模型供应商")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "用量与费用" })).not.toBeInTheDocument();
  });

  it("searches model settings and reveals the relevant part of the continuous editor", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const search = screen.getByPlaceholderText("搜索设置");
    await user.type(search, "子任务模型");
    expect(screen.getByRole("tab", { name: "模型" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("子任务使用方式")).toHaveValue("auto");
    expect(screen.queryByText(/Fable|Sonnet|Opus|Haiku|Claude Code/)).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "请求头");
    expect(await screen.findByText("自定义请求头")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "Base URL");
    expect(screen.getByRole("tab", { name: "模型" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Base URL")).toBeInTheDocument();

  });

  it("opens the section requested by the calling user journey", async () => {
    render(
      <BridgeProvider client={mockClient}>
        <PermissionSettingsSeeder />
        <SettingsPage />
      </BridgeProvider>,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "权限" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText("权限策略")).toBeInTheDocument();
  });

  it("calls setMode when buddy mode is selected", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    const buddyRadio = screen.getByLabelText(/搭子态/);
    await user.click(buddyRadio);

    expect(buddyRadio).toBeChecked();
  });

  it("calls setMode when workbench mode is selected", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    const workbenchRadio = screen.getByLabelText(/工作台态/);
    await user.click(workbenchRadio);

    expect(workbenchRadio).toBeChecked();
  });

  it("calls setPersonaCard when persona card is selected", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    // Find by the full text including tagline to avoid ambiguity
    const momoCard = screen.getByText("温柔而靠谱");
    expect(momoCard).toBeInTheDocument();
  });

  it("creates and deletes a custom persona card from the personalization page", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    await user.click(screen.getByRole("button", { name: "新建人设" }));
    await user.type(screen.getByLabelText("人设名称"), "理性搭档");
    await user.type(screen.getByLabelText("一句话介绍"), "先核实，再行动");
    await user.type(screen.getByLabelText("人设描述"), "给出有依据的判断，然后完整执行任务。");
    await user.click(screen.getByRole("button", { name: "保存人设" }));

    expect(screen.getByRole("radio", { name: /理性搭档/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "删除 理性搭档" }));
    await user.click(screen.getByRole("button", { name: "确认删除 理性搭档" }));
    expect(screen.queryByText("理性搭档")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /momo/ })).toBeChecked();
  });

  it("calls setTalkStyle when slider is moved", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    const slider = screen.getByRole("slider");
    await user.click(slider);

    expect(slider).toBeInTheDocument();
  });

  it("uses provider order as the only default control on the model page", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    const firstProvider = (await screen.findAllByTestId("provider-list-row"))[0];
    expect(firstProvider).toHaveTextContent("默认");
    expect(screen.queryByLabelText("默认模型")).not.toBeInTheDocument();
  });

  it("calls setPermissionMode when permission mode is changed", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    const acceptEditsRadio = screen.getByLabelText(/任务中少打扰/);
    expect(acceptEditsRadio).toBeChecked();
  });

  it("offers the SDK-native read-only plan mode", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    const planRadio = screen.getByLabelText(/只规划，不执行/);
    await user.click(planRadio);
    expect(planRadio).toBeChecked();
  });

  it("keeps dangerous permission controls out of the default path", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    expect(screen.getByRole("button", { name: "高级风险设置" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "开启完全访问" })).toBeInTheDocument();
    expect(screen.queryByLabelText("记住危险操作授权")).not.toBeInTheDocument();
  });

  it("keeps full access visible, requires confirmation to enable it, and disables it in one click", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    await user.click(screen.getByRole("button", { name: "开启完全访问" }));

    const confirm = screen.getByRole("button", { name: "确认开启完全访问" });
    expect(confirm).toBeDisabled();
    expect(screen.queryByText("完全访问已开启")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("我了解 momo 将不再逐项询问，包括删除文件等高风险操作"));
    await user.click(confirm);

    expect(screen.getByText("完全访问已开启")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭完全访问" }));
    expect(screen.getByLabelText(/任务中少打扰/)).toBeChecked();
  });

  it("confirms dangerous approval caching separately and lets the user disable it immediately", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    await user.click(screen.getByRole("button", { name: "高级风险设置" }));
    const checkbox = screen.getByLabelText("记住危险操作授权");
    await user.click(checkbox);

    expect(checkbox).not.toBeChecked();
    const confirm = screen.getByRole("button", { name: "确认记住危险授权" });
    expect(confirm).toBeDisabled();
    await user.click(screen.getByLabelText("我了解危险操作可能在本次任务内不再询问"));
    await user.click(confirm);
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  // 轮 4「三层开关」: 单个「让 momo 联网搜索」换成统筹 + 两个二级。二级默认已开，
  // 所以打开统筹那一下就是"两样都能用"，用户不用再点两次。
  it("the 统筹 switch turns both capabilities on, and each sub-switch works on its own", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "连接器" }));
    const web = screen.getByLabelText("允许联网");
    const search = screen.getByLabelText("联网搜索");
    const fetch = screen.getByLabelText("读取网页");

    expect(web).not.toBeChecked();
    expect(search).toBeDisabled();

    await user.click(web);
    expect(web).toBeChecked();
    expect(search).toBeChecked();
    expect(fetch).toBeChecked();

    // 关掉抓取不该动搜索。
    await user.click(fetch);
    expect(fetch).not.toBeChecked();
    expect(search).toBeChecked();
  });

  it("calls setRememberMode when remember checkbox is toggled", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    const checkbox = screen.getByLabelText(/启用自动记忆/);
    await user.click(checkbox);

    expect(checkbox).not.toBeChecked();
  });

  it("reflects current state correctly across settings pages", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    expect(screen.getByLabelText(/搭子态/)).toBeChecked();

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    expect(screen.getByRole("slider")).toHaveValue("3");
    expect(screen.getByLabelText(/启用自动记忆/)).toBeChecked();

    await user.click(screen.getByRole("tab", { name: "权限" }));
    expect(screen.getByLabelText(/任务中少打扰/)).toBeChecked();
    await user.click(screen.getByRole("button", { name: "高级风险设置" }));
    expect(screen.getByLabelText("记住危险操作授权")).not.toBeChecked();

    await user.click(screen.getByRole("tab", { name: "连接器" }));
    expect(screen.getByLabelText("允许联网")).not.toBeChecked();
  });

  it("shows persisted permanent permissions and revokes one from settings", async () => {
    let whitelist = [{ toolName: "Read", risk: "safe" as const }];
    const client = {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        if (channel === "bridge:listWhitelist") return whitelist.map((entry) => ({ ...entry }));
        if (channel === "bridge:revokeWhitelist") {
          const target = request as (typeof whitelist)[number];
          whitelist = whitelist.filter((entry) => entry.toolName !== target.toolName || entry.risk !== target.risk);
          return undefined;
        }
        if (channel === "bridge:usageSummary") return { byProvider: [] };
        if (channel === "bridge:listMcpServers") return [];
        return undefined;
      }),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as BridgeClient;
    const user = userEvent.setup();

    render(
      <BridgeProvider client={client}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    expect(await screen.findByText("读取文件")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤销 读取文件 安全" }));
    await waitFor(() => expect(screen.queryByText("读取文件")).not.toBeInTheDocument());
  });

  it("loads real usage and switches between today and the last seven days", async () => {
    const client = {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        if (channel === "bridge:listWhitelist") return [];
        if (channel === "bridge:listMcpServers") return [];
        if (channel === "bridge:usageSummary") {
          const range = (request as { range: "today" | "last7d" }).range;
          return range === "today"
            ? {
                totalCostUsd: "0.010000",
                byProvider: [{ providerId: "alpha", costUsd: "0.010000", inputTokens: 12, outputTokens: 3 }],
              }
            : {
                totalCostUsd: "0.120000",
                byProvider: [{ providerId: "alpha", costUsd: "0.120000", inputTokens: 120, outputTokens: 30 }],
                byDay: [{ date: "2026-07-29", costUsd: "0.120000" }],
              };
        }
        return undefined;
      }),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as BridgeClient;
    const user = userEvent.setup();

    render(
      <BridgeProvider client={client}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "用量" }));
    expect((await screen.findAllByText("US$0.010000")).length).toBeGreaterThan(0);
    expect(screen.getByText("12 输入 · 3 输出")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "近 7 天" }));
    expect((await screen.findAllByText("US$0.120000")).length).toBeGreaterThan(0);
    expect(screen.getByText("120 输入 · 30 输出")).toBeInTheDocument();
  });

  it("keeps a retry action when usage loading fails", async () => {
    let attempts = 0;
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listWhitelist" || channel === "bridge:listMcpServers") return [];
        if (channel === "bridge:usageSummary") {
          attempts += 1;
          if (attempts === 1) throw new Error("offline");
          return { totalCostUsd: "0.000000", byProvider: [] };
        }
        return undefined;
      }),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as BridgeClient;
    const user = userEvent.setup();

    render(
      <BridgeProvider client={client}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "用量" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("用量读取失败，请稍后重试");
    await user.click(screen.getByRole("button", { name: "重新读取用量" }));
    expect(await screen.findByText("US$0.000000")).toBeInTheDocument();
  });

  it("opens the governed global memory directory instead of the workspace root", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listWhitelist" || channel === "bridge:listMcpServers" || channel === "bridge:listMemory") return [];
        return undefined;
      }),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as BridgeClient;
    const user = userEvent.setup();
    render(
      <BridgeProvider client={client}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    await user.click(screen.getByRole("button", { name: "打开本地记忆目录" }));
    expect(client.invoke).toHaveBeenCalledWith("bridge:openMemoryDir", { scope: { type: "global" } });
  });

  it("opens an existing source conversation and closes settings", async () => {
    const record = {
      id: "memory-source",
      scope: { type: "global" as const },
      kind: "preference" as const,
      topic: "回答方式",
      statement: "用户喜欢先看结论",
      learnedAt: 100,
      sourceType: "explicit-user" as const,
      sourceConversationId: "conversation-source",
      status: "current" as const,
      pinned: false,
    };
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listWhitelist" || channel === "bridge:listMcpServers") return [];
        if (channel === "bridge:listMemory" || channel === "bridge:memoryHistory") return [record];
        return undefined;
      }),
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as BridgeClient;
    const user = userEvent.setup();
    render(
      <BridgeProvider client={client}>
        <MemorySourceSeeder />
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "查看记忆历史：用户喜欢先看结论" }));
    await user.click(await screen.findByRole("button", { name: "查看来源对话：简历复盘" }));

    expect(screen.getByTestId("memory-navigation-probe")).toHaveTextContent(
      "conversation-source|conversation-source|closed",
    );
  });

  it("dismisses the saved-context hint after four seconds", () => {
    vi.useFakeTimers();
    try {
      render(
        <BridgeProvider client={mockClient}>
          <ContextHintSeeder />
          <SettingsPage />
        </BridgeProvider>,
      );

      expect(screen.getByTestId("context-hint")).toHaveTextContent("2 个对话下一轮起生效");
      act(() => vi.advanceTimersByTime(3_999));
      expect(screen.getByTestId("context-hint")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId("context-hint")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SettingsPage — Provider section (轮 3 卡 F3)", () => {
  const configuredSpec: ProviderSpec = {
    id: "deepseek", name: "DeepSeek", kind: "deepseek", category: "cn_official",
    apiFormat: "anthropic", authMode: "api-key", baseUrl: "https://api.deepseek.com/anthropic",
    models: ["deepseek-v4-flash"], modelCapabilities: { "deepseek-v4-flash": { thinking: true, vision: false } },
    capabilities: { balanceApi: true, modelDiscovery: true, subscriptionPlan: false }, configured: true,
  };
  const unconfiguredSpec: ProviderSpec = {
    id: "glm", name: "GLM（智谱）", kind: "glm", category: "cn_official",
    apiFormat: "anthropic", authMode: "api-key", baseUrl: "https://open.bigmodel.cn/api/anthropic",
    models: ["glm-5.2"], capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false },
    configured: false,
  };

  function liveClient(overrides: Partial<Record<string, (req: unknown) => unknown>> = {}): BridgeClient {
    const invoke = vi.fn(async (channel: string, req: unknown) => {
      if (channel in overrides) return overrides[channel]!(req);
      if (channel === "bridge:listProviders") return [configuredSpec, unconfiguredSpec];
      if (channel === "bridge:getProviderConfig") {
        const providerId = (req as { providerId: string }).providerId;
        const spec = [configuredSpec, unconfiguredSpec].find((candidate) => candidate.id === providerId);
        if (!spec) return null;
        return {
          id: spec.id,
          kind: spec.kind,
          name: spec.name,
          baseUrl: spec.baseUrl,
          apiFormat: spec.apiFormat,
          category: spec.category,
          models: spec.models,
          modelCapabilities: spec.modelCapabilities,
          capabilities: spec.capabilities,
          hasApiKey: spec.configured === true,
          apiKeyMasked: spec.configured ? "····test" : undefined,
          saved: spec.configured === true,
        };
      }
      if (channel === "bridge:listSkills") return [];
      if (channel === "bridge:listWhitelist") return [];
      return undefined;
    });
    return { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient;
  }

  it("keeps only added providers in the ordered list and moves preset offers into the catalog", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={liveClient()} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    expect(await screen.findByRole("button", { name: "选择 DeepSeek" })).toBeInTheDocument();
    expect(screen.getByText("1 个已配置")).toBeInTheDocument();
    expect(screen.getAllByTestId("provider-list-row")).toHaveLength(1);
    expect(screen.queryByText("GLM（智谱）")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));
    expect(await screen.findByRole("button", { name: "配置 GLM（智谱）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 DeepSeek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 自定义服务" })).toBeInTheDocument();
  });

  it("opens a blank custom service form from the same provider catalog", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={liveClient()} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));
    await user.click(screen.getByRole("button", { name: "配置 自定义服务" }));
    expect(await screen.findByTestId("provider-config-form")).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue("自定义服务");
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
  });

  it("shows the preset catalog immediately when no provider is configured", async () => {
    const user = userEvent.setup();
    const client = liveClient({ "bridge:listProviders": () => [{ ...configuredSpec, configured: false }, unconfiguredSpec] });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    expect(await screen.findByTestId("provider-offer-grid")).toBeInTheDocument();
    expect(screen.queryByText("已接入")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 DeepSeek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "配置 GLM（智谱）" })).toBeInTheDocument();
  });

  it("uses the stable preset id on first setup and omits it when adding another account", async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const client = liveClient({
      "bridge:saveProvider": (request) => {
        saved.push(request);
        return configuredSpec;
      },
    });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));
    await user.click(screen.getByRole("button", { name: "配置 GLM（智谱）" }));
    await screen.findByLabelText("名称");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ id: "glm", kind: "glm" });

    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));
    await user.click(screen.getByRole("button", { name: "配置 DeepSeek" }));
    await screen.findByLabelText("名称");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toMatchObject({ kind: "deepseek" });
    expect(saved[1]).not.toHaveProperty("id");
  });

  it("persists provider priority and keeps the compatibility default pair in sync", async () => {
    const user = userEvent.setup();
    const glmConfigured = { ...unconfiguredSpec, configured: true };
    const client = liveClient({ "bridge:listProviders": () => [configuredSpec, glmConfigured] });
    render(
      <BridgeProvider client={client} live>
        <DefaultModelProbe />
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 GLM（智谱）" });
    await user.click(screen.getByRole("button", { name: "设为默认 GLM（智谱）" }));

    await waitFor(() => expect(screen.getByTestId("default-model-probe")).toHaveTextContent("glm:glm-5.2"));
    const rows = screen.getAllByTestId("provider-list-row");
    expect(rows[0]).toHaveTextContent("GLM（智谱）");
    expect(rows[0]).toHaveTextContent("默认");
  });

  it("guards dirty drafts when switching providers or leaving the model section", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={liveClient()} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    const nameInput = await screen.findByLabelText("名称");
    await user.clear(nameInput);
    await user.type(nameInput, "还没保存的 DeepSeek");
    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));

    expect(screen.getByRole("alertdialog", { name: "放弃模型设置修改" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("名称")).toHaveValue("还没保存的 DeepSeek");

    await user.click(screen.getByRole("button", { name: "添加模型服务商" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await user.click(await screen.findByRole("button", { name: "配置 GLM（智谱）" }));
    await waitFor(() => expect(screen.getByLabelText("名称")).toHaveValue("GLM（智谱）"));

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "还没保存的 GLM");
    await user.click(screen.getByRole("tab", { name: "通用" }));
    expect(screen.getByRole("alertdialog", { name: "离开模型设置" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("tab", { name: "模型" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("名称")).toHaveValue("还没保存的 GLM");
  });

  it("locks provider navigation while a save owns the editor", async () => {
    const user = userEvent.setup();
    let resolveSave!: (spec: ProviderSpec) => void;
    const deferred = new Promise<ProviderSpec>((resolve) => { resolveSave = resolve; });
    const client = liveClient({ "bridge:saveProvider": () => deferred });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByLabelText("名称");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(client.invoke).toHaveBeenCalledWith("bridge:saveProvider", expect.anything()));
    expect(screen.getByRole("button", { name: "添加模型服务商" })).toBeDisabled();
    expect(screen.getByLabelText("名称")).toBeDisabled();

    await act(async () => {
      resolveSave(configuredSpec);
      await deferred;
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByLabelText("名称")).toHaveValue("DeepSeek"));
    expect(screen.getByRole("button", { name: "添加模型服务商" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "选择 DeepSeek" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opening 编辑 on a configured row shows the config form pre-filled", async () => {
    const user = userEvent.setup();
    const client = liveClient({
      "bridge:getProviderConfig": () => ({
        id: "deepseek", kind: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic",
        apiFormat: "anthropic", category: "cn_official", models: ["deepseek-v4-flash"],
        capabilities: { balanceApi: true, modelDiscovery: true, subscriptionPlan: false },
        hasApiKey: true, apiKeyMasked: "····a1b2", saved: true,
      }),
    });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    expect(await screen.findByTestId("provider-config-form")).toBeInTheDocument();
    expect(screen.getByText(/····a1b2/)).toBeInTheDocument();
  });

  it("delete requires a second confirming click before calling the bridge", async () => {
    const user = userEvent.setup();
    const client = liveClient({
      "bridge:deleteProvider": () => undefined,
    });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    await user.click(screen.getByRole("button", { name: "删除服务商" }));
    expect(screen.getByText("确定删除？")).toBeInTheDocument();
    // the bridge must NOT have been called yet from the first click
    expect(client.invoke).not.toHaveBeenCalledWith("bridge:deleteProvider", expect.anything());

    await user.click(screen.getByRole("button", { name: "确认删除服务商" }));
    await waitFor(() =>
      expect(client.invoke).toHaveBeenCalledWith("bridge:deleteProvider", { providerId: "deepseek" }),
    );
  });

  it("allows deleting a saved custom provider even when it has no API key", async () => {
    const user = userEvent.setup();
    const savedWithoutKey: ProviderSpec = {
      id: "saved-no-key", name: "待补凭据的中转站", kind: "custom", category: "custom",
      apiFormat: "openai", authMode: "api-key", baseUrl: "https://relay.test",
      models: [], capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false },
      configured: false, saved: true,
    };
    const client = liveClient({
      "bridge:listProviders": () => [savedWithoutKey],
      "bridge:getProviderConfig": () => ({
        ...savedWithoutKey,
        hasApiKey: false,
        saved: true,
      }),
    });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByLabelText("名称");
    expect(screen.getByRole("button", { name: "删除服务商" })).toBeInTheDocument();
  });

  it("reloads after save so secrets are masked and a newly saved header can be removed", async () => {
    const user = userEvent.setup();
    let saveCount = 0;
    let configReads = 0;
    const payloads: unknown[] = [];
    const client = liveClient({
      "bridge:getProviderConfig": () => {
        configReads += 1;
        return {
          id: "deepseek", kind: "deepseek", name: "DeepSeek",
          baseUrl: "https://api.deepseek.com/anthropic", apiFormat: "anthropic",
          category: "cn_official", models: ["deepseek-v4-flash"],
          capabilities: configuredSpec.capabilities,
          hasApiKey: saveCount > 0,
          apiKeyMasked: saveCount > 0 ? "····new1" : undefined,
          secretHeaderKeys: saveCount > 0 ? ["X-New-Secret"] : [],
          saved: true,
        };
      },
      "bridge:saveProvider": (req) => {
        payloads.push(req);
        saveCount += 1;
        return configuredSpec;
      },
    });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByLabelText("名称");
    await user.type(screen.getByLabelText("API Key"), "sk-new-secret");
    await user.click(screen.getByText("高级设置"));
    await user.click(screen.getByRole("button", { name: "添加请求头" }));
    await user.type(screen.getByLabelText("header key 1"), "X-New-Secret");
    await user.type(screen.getByLabelText("header value X-New-Secret"), "header-secret");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(configReads).toBeGreaterThanOrEqual(2));
    const keyInput = await screen.findByLabelText("API Key");
    expect(keyInput).toHaveValue("");
    expect(keyInput).toHaveAttribute("placeholder", expect.stringContaining("····new1"));
    await user.click(screen.getByText("高级设置"));
    expect(screen.getByLabelText("header value X-New-Secret")).toHaveValue("");
    expect(screen.getByLabelText("header value X-New-Secret")).toHaveAttribute("placeholder", "已保存，留空不改");
    await user.click(screen.getByRole("button", { name: "删除 header X-New-Secret" }));
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(payloads).toHaveLength(2));
    expect(payloads[1]).toMatchObject({ removeHeaderKeys: ["X-New-Secret"] });
    expect(JSON.stringify(payloads[1])).not.toContain("header-secret");
  });

  it("cancelling the delete confirmation leaves the provider untouched", async () => {
    const user = userEvent.setup();
    const client = liveClient();
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    await user.click(screen.getByRole("button", { name: "删除服务商" }));
    await user.click(screen.getByRole("button", { name: "取消删除服务商" }));

    expect(screen.queryByText("确定删除？")).not.toBeInTheDocument();
    expect(client.invoke).not.toHaveBeenCalledWith("bridge:deleteProvider", expect.anything());
  });

  it("shows the balance for a configured provider that declares balanceApi", async () => {
    const user = userEvent.setup();
    const info: BalanceInfo = { supported: true, totalCny: 42.5 };
    const client = liveClient({ "bridge:fetchBalance": () => info });
    render(
      <BridgeProvider client={client} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "用量" }));
    await user.click(await screen.findByRole("button", { name: "查询 DeepSeek 余额" }));
    expect(await screen.findByText("¥42.5")).toBeInTheDocument();
  });

  it("does not save a provider after its last usable model is removed", async () => {
    const user = userEvent.setup();
    let savedPayload: unknown;
    const glmConfigured = { ...unconfiguredSpec, configured: true };
    const client = liveClient({
      "bridge:listProviders": () => [configuredSpec, glmConfigured],
      "bridge:saveProvider": (req) => {
        savedPayload = req;
        return configuredSpec;
      },
    });
    render(
      <BridgeProvider client={client} live>
        <DefaultModelSeeder providerId="deepseek" modelId="deepseek-v4-flash" />
        <DefaultModelProbe />
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    await screen.findByLabelText("名称");
    await user.click(screen.getByRole("button", { name: "移除模型 deepseek-v4-flash" }));
    const saveButton = screen.getByRole("button", { name: "保存设置" });
    expect(saveButton).toBeDisabled();
    await user.click(saveButton);
    expect(savedPayload).toBeUndefined();
    expect(screen.getByTestId("default-model-probe")).toHaveTextContent("deepseek:deepseek-v4-flash");
  });

  it("keeps balance actions and the duplicate default picker out of model setup", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={liveClient()} live>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "模型" }));
    await screen.findByRole("button", { name: "选择 DeepSeek" });
    expect(screen.queryByLabelText("默认模型")).not.toBeInTheDocument();
    expect(screen.queryByText("查询余额")).not.toBeInTheDocument();
  });
});
