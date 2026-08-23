import { afterEach, describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./SettingsPage";
import { BridgeProvider, useConversations, useSettings, useUi } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import type { ProviderSpec, BalanceInfo } from "../../bridge/contract";
import type { WorkspaceClient } from "../workspace/client";

const mockClient: BridgeClient = {
  invoke: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
};

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  delete window.leemoAbout;
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

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

function DefaultWorkspaceProbe(): React.JSX.Element {
  const workspaceId = useSettings((state) => state.defaultWorkspaceId);
  return <span data-testid="default-workspace-probe">{workspaceId}</span>;
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
  it("keeps daily overview automation opt-in, local-time based, and free of eager model calls", async () => {
    const user = userEvent.setup();
    vi.mocked(mockClient.invoke).mockClear();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const toggle = screen.getByRole("switch", { name: "每天自动整理待完成事项" });
    const time = screen.getByLabelText("每天自动整理时间");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(time).toBeDisabled();
    expect(screen.getByText("在设定时间之后，当天首次回到 Leemo 时整理一次。会使用默认模型并计入用量。")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(time).toBeEnabled();
    fireEvent.change(time, { target: { value: "09:30" } });
    expect(time).toHaveValue("09:30");
    fireEvent.change(time, { target: { value: "invalid" } });
    expect(time).toHaveValue("09:30");
    expect(vi.mocked(mockClient.invoke).mock.calls.some(([channel]) => channel === "bridge:generateGlobalPendingOverview")).toBe(false);
  });

  it("exposes theme choices as a compact personalization control", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    expect(screen.getByRole("radiogroup", { name: "界面主题" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "白底铜橙" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "暖纸铜橙" }));
    expect(screen.getByRole("radio", { name: "暖纸铜橙" })).toBeChecked();
  });

  it("keeps the fixed nine user-facing categories and moves real storage and shortcut controls to their own pages", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "通用",
      "模型",
      "用量与费用",
      "个性化",
      "连接器",
      "权限",
      "数据与存储",
      "快捷键",
      "关于",
    ]);
    expect(screen.queryByText(/^0[1-9]$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("快速记录快捷键")).not.toBeInTheDocument();
    expect(screen.queryByText("Leemo 文件")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "数据与存储" }));
    expect(screen.getByText("Leemo 文件")).toBeInTheDocument();
    expect(screen.getByLabelText("拖入文件时保存副本")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "快捷键" }));
    expect(screen.getByLabelText("快速记录快捷键")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "关于" }));
    expect(screen.getByRole("heading", { name: "关于" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制诊断信息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开日志文件夹" })).toBeInTheDocument();
  });

  it("shows real application metadata and makes only the approved diagnostic actions available", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    window.leemoAbout = {
      getInfo: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          version: "0.9.7",
          platform: "win32",
          arch: "x64",
          packaged: true,
          diagnostics: "Leemo 0.9.7\n平台: win32\n架构: x64\n运行方式: 已打包",
        },
      }),
      openLogsDirectory: vi.fn().mockResolvedValue({ ok: true }),
    };

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "关于" }));
    expect(await screen.findByText("0.9.7")).toBeInTheDocument();
    expect(screen.getByText("一个懂你，也能帮你做事的本地 AI 工作台")).toBeInTheDocument();
    expect(screen.queryByText(/项目主页|更新记录|开源许可/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制诊断信息" }));
    expect(writeText).toHaveBeenCalledWith(
      "Leemo 0.9.7\n平台: win32\n架构: x64\n运行方式: 已打包",
    );
    expect(await screen.findByRole("status")).toHaveTextContent("诊断信息已复制");

    await user.click(screen.getByRole("button", { name: "打开日志文件夹" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已打开日志文件夹");
  });

  it("uses a left tab navigation and renders one settings page at a time", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    expect(screen.getByRole("tablist", { name: "设置分类" })).toBeInTheDocument();
    expect(screen.getByTestId("settings-sidebar")).toHaveClass("settings-sidebar");
    expect(screen.getByRole("tabpanel")).toHaveClass("settings-content");
    expect(screen.getByRole("tab", { name: "通用" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "通用" })).toBeInTheDocument();
    expect(screen.queryByText("模型供应商")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "模型" }));
    expect(screen.getByText("模型供应商")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("provider-workbench")).toHaveClass("settings-provider-workbench", "min-h-0", "flex-1");
    expect(screen.getByTestId("provider-workbench")).toHaveAttribute("data-layout", "list-detail");
    expect(screen.getByTestId("provider-workbench")).toHaveAttribute("data-layout-density", "compact");
    expect(screen.getByTestId("provider-workbench")).toHaveAttribute("data-detail-priority", "dominant");
    expect(screen.getByTestId("provider-workbench")).toHaveAttribute("data-provider-rail-width", "216");
    expect(screen.queryByRole("heading", { name: "默认模型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "用量与费用" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "通用" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
    expect(screen.getByRole("heading", { name: "用量与费用" })).toBeInTheDocument();
    expect(screen.queryByText("模型供应商")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    expect(screen.getByText("momo 的相处气质")).toBeInTheDocument();
    expect(screen.getByText("你希望 momo 更像谁")).toBeInTheDocument();
    expect(screen.getByText("话风档位")).toBeInTheDocument();
    expect(screen.getByText("momo 记得的")).toBeInTheDocument();
  });

  it("uses the approved compact row control for the startup surface", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const entry = screen.getByRole("combobox", { name: "启动后进入" });
    await user.selectOptions(entry, "buddy");
    expect(entry).toHaveValue("buddy");
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
    expect(screen.getByRole("tab", { name: "用量与费用" })).toHaveAttribute("aria-selected", "true");
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
    expect(await screen.findByRole("tab", { name: "高级设置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("高级连接参数")).toBeInTheDocument();

  });

  it("opens the section requested by the calling user journey", async () => {
    render(
      <BridgeProvider client={mockClient}>
        <PermissionSettingsSeeder />
        <SettingsPage />
      </BridgeProvider>,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "权限" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText("任务中的确认方式")).toBeInTheDocument();
  });

  it("calls setMode when buddy mode is selected", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    const entry = screen.getByRole("combobox", { name: "启动后进入" });
    await user.selectOptions(entry, "buddy");

    expect(entry).toHaveValue("buddy");
  });

  it("calls setMode when workbench mode is selected", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    const entry = screen.getByRole("combobox", { name: "启动后进入" });
    await user.selectOptions(entry, "workbench");

    expect(entry).toHaveValue("workbench");
  });

  it("keeps long-running tasks awake by default and lets the user turn it off", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const checkbox = screen.getByLabelText("任务运行期间阻止电脑自动休眠");
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("enables background desktop notifications by default and lets the user turn them off", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const checkbox = screen.getByLabelText("Leemo 不在前台时显示桌面通知");
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("keeps launch at login opt-in and lets the user enable it", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const checkbox = screen.getByLabelText("开机自动启动 Leemo");
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("keeps Leemo available in the tray by default and lets the user turn it off", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const checkbox = screen.getByLabelText("关闭窗口后在后台运行");
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("shows the configurable quick-capture shortcut without developer terminology", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "快捷键" }));
    const shortcut = screen.getByLabelText("快速记录快捷键");
    expect(shortcut).toHaveValue("Alt+N");
    await user.click(shortcut);
    await user.keyboard("{Control>}{Shift>}n{/Shift}{/Control}");
    expect(shortcut).toHaveValue("Ctrl+Shift+N");
    expect(screen.getByText("在任何应用中打开一个新的快捷便签。"))
      .toBeInTheDocument();
  });

  it("shows no open action until a selected storage folder migrates successfully", async () => {
    const user = userEvent.setup();
    const chooseCaptureStorageRoot = vi.fn(async () => ({ ok: true as const, response: "E:/Leemo-files" }));
    const openCaptureStorageRoot = vi.fn(async () => ({ ok: true as const }));
    const invoke = vi.fn(async () => ({ ok: true, response: "E:/Leemo-files" }));
    Object.defineProperty(window, "leemoDesktop", {
      configurable: true,
      value: { configure: vi.fn(), chooseCaptureStorageRoot, openCaptureStorageRoot },
    });
    Object.defineProperty(window, "leemoCapture", {
      configurable: true,
      value: { invoke, onChanged: vi.fn(() => vi.fn()) },
    });
    try {
      render(
        <BridgeProvider client={mockClient}>
          <SettingsPage />
        </BridgeProvider>,
      );

      await user.click(screen.getByRole("tab", { name: "数据与存储" }));
      expect(screen.getByText(/尚未选择；首次保存图片或文件副本时再选择位置/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "打开文件夹" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "选择文件夹" }));
      expect(await screen.findByText("E:/Leemo-files")).toBeInTheDocument();
      expect(chooseCaptureStorageRoot).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenCalledWith("migrateStorageRoot", { newRoot: "E:/Leemo-files" });
      await user.click(screen.getByRole("button", { name: "打开文件夹" }));
      expect(openCaptureStorageRoot).toHaveBeenCalledOnce();
      expect(screen.getByLabelText("拖入文件时保存副本")).not.toBeChecked();
    } finally {
      delete (window as Window & { leemoDesktop?: unknown }).leemoDesktop;
      delete (window as Window & { leemoCapture?: unknown }).leemoCapture;
    }
  });

  it("shows and changes the real default workspace separately from managed Leemo files", async () => {
    const user = userEvent.setup();
    const external = {
      id: "workspace-0123456789abcdef0123",
      name: "E 盘工作区",
      displayPath: "E:\\Leemo 工作区",
      kind: "external" as const,
      available: true,
      lastOpenedAt: 2,
    };
    const workspace = {
      listWorkspaces: vi.fn(async () => [{
        id: "leemo-home",
        name: "Leemo",
        displayPath: "C:\\Users\\Rengar\\Leemo",
        kind: "home" as const,
        available: true,
        lastOpenedAt: 1,
      }]),
      pickWorkspace: vi.fn(async () => external),
      listNotebooks: vi.fn(async () => ({ root: "C:\\Users\\Rengar\\Leemo", notebooks: [] })),
      readTree: vi.fn(async () => []),
    } as unknown as WorkspaceClient;

    render(
      <BridgeProvider client={mockClient} workspace={workspace}>
        <DefaultWorkspaceProbe />
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "数据与存储" }));
    expect(await screen.findByText("默认工作区")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\Rengar\\Leemo\\默认工作区")).toBeInTheDocument();
    expect(screen.getByText("Leemo 文件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "更改默认工作区" }));
    expect(await screen.findByText("E:\\Leemo 工作区")).toBeInTheDocument();
    expect(screen.getByTestId("default-workspace-probe")).toHaveTextContent(external.id);
    expect(workspace.pickWorkspace).toHaveBeenCalledOnce();
  });

  it("keeps the old shortcut visible when Windows rejects a conflicting combination", async () => {
    const user = userEvent.setup();
    const configure = vi.fn(async () => ({
      ok: false as const,
      error: "Ctrl+Shift+N 已被其他应用占用，Alt+N 仍可继续使用。",
    }));
    Object.defineProperty(window, "leemoDesktop", {
      configurable: true,
      value: { configure },
    });
    try {
      render(
        <BridgeProvider client={mockClient}>
          <SettingsPage />
        </BridgeProvider>,
      );

      await user.click(screen.getByRole("tab", { name: "快捷键" }));
      const shortcut = screen.getByLabelText("快速记录快捷键");
      await user.click(shortcut);
      await user.keyboard("{Control>}{Shift>}n{/Shift}{/Control}");

      expect(await screen.findByRole("alert")).toHaveTextContent("已被其他应用占用");
      expect(shortcut).toHaveValue("Alt+N");
      expect(configure).toHaveBeenCalledWith({ quickCaptureShortcut: "Ctrl+Shift+N" });
    } finally {
      delete (window as Window & { leemoDesktop?: unknown }).leemoDesktop;
    }
  });

  it("lets the user disable small model calls for ambiguous task times", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    const toggle = screen.getByLabelText("使用模型理解复杂待办");
    expect(toggle).toBeChecked();
    expect(screen.getByText(/只有本地无法分清计划、截止与提醒时才会使用当前模型/)).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
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

  it("offers understandable personality flavors and relationship roles", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    const entp = screen.getByRole("radio", { name: /ENTP/ });
    const mentor = screen.getByRole("radio", { name: /导师/ });
    expect(entp).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /搭档/ })).toBeChecked();

    await user.click(entp);
    await user.click(mentor);
    expect(entp).toBeChecked();
    expect(mentor).toBeChecked();
    expect(screen.getByText(/只是相处风味/)).toBeInTheDocument();
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

  it("warns before a long persona description can be silently shortened at runtime", async () => {
    const user = userEvent.setup();
    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    await user.click(screen.getByRole("button", { name: "新建人设" }));
    fireEvent.change(screen.getByLabelText("人设描述"), {
      target: { value: "重要约定".repeat(41) },
    });

    expect(screen.getByText("164 / 2000")).toBeInTheDocument();
    expect(screen.getByText(/靠后的内容可能不会进入每轮对话/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存人设" })).toBeEnabled();
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
    expect(firstProvider).not.toHaveTextContent("默认");
    expect(screen.getByRole("button", { name: /^当前默认 / })).toBeInTheDocument();
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
    const acceptEditsRadio = screen.getByLabelText(/风险确认/);
    expect(acceptEditsRadio).toBeChecked();
    expect(acceptEditsRadio.closest("label")).toHaveAttribute("data-active", "true");
    expect(screen.getByText("决定 momo 执行任务时，什么时候需要先问你")).toBeInTheDocument();
    expect(screen.getByText(/功能开关决定 momo 能不能使用/)).toBeInTheDocument();
  });

  it("keeps planning out of permission levels", async () => {
    const user = userEvent.setup();

    render(
      <BridgeProvider client={mockClient}>
        <SettingsPage />
      </BridgeProvider>
    );

    await user.click(screen.getByRole("tab", { name: "权限" }));
    expect(screen.queryByLabelText(/只规划，不执行/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/完全访问/)).toBeInTheDocument();
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
    expect(screen.getByLabelText(/完全访问/)).toBeInTheDocument();
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
    const fullAccessRadio = screen.getByLabelText(/完全访问/);
    await user.click(fullAccessRadio);

    const confirm = screen.getByRole("button", { name: "确认开启完全访问" });
    expect(confirm).toBeDisabled();
    expect(fullAccessRadio).not.toBeChecked();

    await user.click(screen.getByLabelText("我了解 momo 将不再逐项询问，包括删除文件等高风险操作"));
    await user.click(confirm);

    expect(fullAccessRadio).toBeChecked();
    await user.click(screen.getByLabelText(/风险确认/));
    expect(screen.getByLabelText(/风险确认/)).toBeChecked();
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

    expect(screen.getByRole("combobox", { name: "启动后进入" })).toHaveValue("start");

    await user.click(screen.getByRole("tab", { name: "个性化" }));
    expect(screen.getByRole("slider")).toHaveValue("3");
    expect(screen.getByLabelText(/启用自动记忆/)).toBeChecked();

    await user.click(screen.getByRole("tab", { name: "权限" }));
    expect(screen.getByLabelText(/风险确认/)).toBeChecked();
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
          const range = (request as { range: "today" | "last7d" | "last30d" }).range;
          return range === "today"
            ? {
                totalCostUsd: "0.010000",
                callCount: 2,
                inputTokens: 12,
                outputTokens: 3,
                cacheReadTokens: 6,
                cacheCreationTokens: 1,
                byProvider: [{ providerId: "alpha", costUsd: "0.010000", callCount: 2, inputTokens: 12, outputTokens: 3, cacheReadTokens: 6, cacheCreationTokens: 1 }],
                byModel: [{ providerId: "alpha", modelId: "alpha-pro", costUsd: "0.010000", callCount: 2, inputTokens: 12, outputTokens: 3, cacheReadTokens: 6, cacheCreationTokens: 1 }],
              }
            : range === "last7d" ? {
                totalCostUsd: "0.120000",
                callCount: 5,
                inputTokens: 120,
                outputTokens: 30,
                cacheReadTokens: 20,
                cacheCreationTokens: 4,
                byProvider: [{ providerId: "alpha", costUsd: "0.120000", callCount: 5, inputTokens: 120, outputTokens: 30, cacheReadTokens: 20, cacheCreationTokens: 4 }],
                byModel: [{ providerId: "alpha", modelId: "alpha-pro", costUsd: "0.120000", callCount: 5, inputTokens: 120, outputTokens: 30, cacheReadTokens: 20, cacheCreationTokens: 4 }],
                byDay: [{ date: "2026-07-29", costUsd: "0.120000" }],
              } : {
                totalCostUsd: "0.360000",
                callCount: 12,
                inputTokens: 360,
                outputTokens: 90,
                cacheReadTokens: 80,
                cacheCreationTokens: 12,
                byProvider: [{ providerId: "alpha", costUsd: "0.360000", callCount: 12, inputTokens: 360, outputTokens: 90, cacheReadTokens: 80, cacheCreationTokens: 12 }],
                byModel: [{ providerId: "alpha", modelId: "alpha-pro", costUsd: "0.360000", callCount: 12, inputTokens: 360, outputTokens: 90, cacheReadTokens: 80, cacheCreationTokens: 12 }],
                byDay: [{ date: "2026-07-01", costUsd: "0.360000" }],
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

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
    expect((await screen.findAllByText("US$0.010000")).length).toBeGreaterThan(0);
    expect(screen.getByText("alpha-pro")).toBeInTheDocument();
    expect(screen.getAllByText("6").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 次").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "近 7 天" }));
    expect((await screen.findAllByText("US$0.120000")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "近 30 天" }));
    expect((await screen.findAllByText("US$0.360000")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("12 次").length).toBeGreaterThan(0);
  });

  it("shows zero cost when the selected range has no usage records", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listWhitelist" || channel === "bridge:listMcpServers") return [];
        if (channel === "bridge:usageSummary") return { byProvider: [], byDay: [] };
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

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
    expect(await screen.findByText("US$0.000000")).toBeInTheDocument();
    expect(screen.queryByText("未定价")).not.toBeInTheDocument();
  });

  it("labels usage with missing prices as partially unpriced", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listWhitelist" || channel === "bridge:listMcpServers") return [];
        if (channel === "bridge:usageSummary") {
          return { byProvider: [{ providerId: "custom-relay", inputTokens: 8, outputTokens: 2 }] };
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

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
    expect(await screen.findByText("部分未定价")).toBeInTheDocument();
    expect(screen.getAllByText("未定价")).toHaveLength(1);
  });

  it("does not present a priced subtotal as the full cost when another provider is unpriced", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:listWhitelist" || channel === "bridge:listMcpServers") return [];
        if (channel === "bridge:usageSummary") {
          return {
            totalCostUsd: "0.010000",
            byProvider: [
              { providerId: "priced", costUsd: "0.010000", inputTokens: 8, outputTokens: 2 },
              { providerId: "custom-relay", inputTokens: 5, outputTokens: 1 },
            ],
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

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
    expect(await screen.findByText("部分未定价")).toBeInTheDocument();
    expect(screen.getByText("US$0.010000")).toBeInTheDocument();
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

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
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
    expect(screen.queryByText(/个已配置$/)).not.toBeInTheDocument();
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
    expect(rows[0]).not.toHaveTextContent("默认");
    expect(screen.getByRole("button", { name: "当前默认 GLM（智谱）" })).toBeInTheDocument();
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
    await user.type(await screen.findByLabelText("名称"), " 2");
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

    await user.click(screen.getByRole("tab", { name: "用量与费用" }));
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
