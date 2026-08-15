import { useStore } from "zustand";
import { Box, CircleDollarSign, Database, Info, Keyboard, Link2, Settings2, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { IpcCaptureClient } from "../capture/client";
import { IpcWorkspaceClient } from "../workspace/ipc-workspace-client";
import { useCallback, useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import { BridgeContext, type BridgeStores } from "../bridge/context";
import ProviderConfigForm, { type PresetOffer } from "../components/ProviderConfigForm";
import { ProviderList, ProviderOfferGrid } from "../components/ProviderList";
import MemorySettingsSection from "../components/MemorySettingsSection";
import { SearchSourcesSection } from "../components/SearchSourcesSection";
import { McpServersSection } from "../components/McpServersSection";
import { BrowserAutomationSection } from "../components/BrowserAutomationSection";
import { ComputerUseSection } from "../components/ComputerUseSection";
import { permissionToolLabel } from "../components/tool-labels";
import LeemoMark from "../components/brand/LeemoMark";
import LeemoSwitch from "../components/LeemoSwitch";
import type { ConnectionTestResult, ProviderSpec, UsageSummary } from "../../bridge/contract";
import { orderConfiguredProviders } from "../components/model-picker";
import {
  PERSONA_PROMPT_TEXT_MAX_LENGTH,
  RELATIONSHIP_STYLE_OPTIONS,
} from "../stores/settings";
import "./SettingsPage.css";

type SettingsTabId = "general" | "models" | "usage" | "personalization" | "connectors" | "permissions" | "data" | "shortcuts" | "about";

const SETTINGS_TABS: { id: SettingsTabId; label: string; icon: LucideIcon; keywords: string }[] = [
  { id: "general", label: "通用", icon: Settings2, keywords: "通用 模式 搭子 工作台 启动 休眠 唤醒 长任务 后台任务 通知 提醒 桌面通知" },
  { id: "models", label: "模型", icon: Box, keywords: "模型 provider 供应商 api key base url 服务地址 协议 快速任务 后台任务 子任务模型 自动推荐 自动继承 模型发现地址 请求头 header 高级设置" },
  { id: "usage", label: "用量与费用", icon: CircleDollarSign, keywords: "用量 费用 token 余额 消耗 账单 今天 近7天" },
  { id: "personalization", label: "个性化", icon: Sparkles, keywords: "个性化 momo 人设 气质 MBTI ENTP INFJ ENFP ENTJ 朋友 搭档 学长 学姐 导师 关系 话风 记忆 自动记忆" },
  { id: "connectors", label: "连接器", icon: Link2, keywords: "连接器 mcp 浏览器 playwright 联网 搜索 websearch webfetch" },
  { id: "permissions", label: "权限", icon: ShieldCheck, keywords: "权限 审批 永久允许 危险 每次确认 风险确认 完全访问" },
  { id: "data", label: "数据与存储", icon: Database, keywords: "数据 存储 文件 文件夹 位置 副本 迁移" },
  { id: "shortcuts", label: "快捷键", icon: Keyboard, keywords: "快捷键 快速记录 便签 Alt N" },
  { id: "about", label: "关于", icon: Info, keywords: "关于 Leemo 版本 诊断 更新" },
];

const SETTINGS_SECTION_TO_TAB: Record<string, SettingsTabId> = {
  general: "general",
  models: "models",
  usage: "usage",
  momo: "personalization",
  web: "connectors",
  extensions: "connectors",
  permissions: "permissions",
  data: "data",
  shortcuts: "shortcuts",
  about: "about",
};

const PERSONA_PROMPT_LONG_DESCRIPTION_LENGTH = 160;

function usageCostLabel(summary: UsageSummary): string {
  const hasUsageRecords = summary.byProvider.length > 0 || (summary.byDay?.length ?? 0) > 0;
  if (!hasUsageRecords) return "US$0.000000";
  const hasUnpricedRecords = summary.byProvider.some((provider) => provider.costUsd === undefined)
    || summary.byDay?.some((day) => day.costUsd === undefined) === true;
  if (hasUnpricedRecords || summary.totalCostUsd === undefined) return "部分未定价";
  return `US$${summary.totalCostUsd}`;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function usageTotals(summary: UsageSummary): {
  callCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  return {
    callCount: summary.callCount ?? summary.byProvider.reduce((sum, row) => sum + (row.callCount ?? 0), 0),
    inputTokens: summary.inputTokens ?? summary.byProvider.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: summary.outputTokens ?? summary.byProvider.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheReadTokens: summary.cacheReadTokens ?? summary.byProvider.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0),
    cacheCreationTokens: summary.cacheCreationTokens ?? summary.byProvider.reduce((sum, row) => sum + (row.cacheCreationTokens ?? 0), 0),
  };
}

function defaultWorkspacePath(workspace: { displayPath: string; kind: "home" | "external" } | undefined): string {
  if (!workspace) return "正在读取位置…";
  if (workspace.kind === "external") return workspace.displayPath;
  if (!workspace.displayPath) return "Leemo 默认工作区";
  const separator = workspace.displayPath.includes("\\") ? "\\" : "/";
  return `${workspace.displayPath.replace(/[\\/]+$/u, "")}${separator}默认工作区`;
}

type ProviderEditorTestState = ConnectionTestResult | { pending: true };
type ProviderEditorNavigation =
  | { type: "select"; providerId: string }
  | { type: "catalog" }
  | { type: "configure"; preset: PresetOffer }
  | { type: "cancel" };

function ProviderWorkbenchSection({
  query,
  onDirtyChange,
  onBusyChange,
}: {
  query: string;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const stores = useContext(BridgeContext) as BridgeStores;
  const { list, configured, deleteProvider } = useStore(stores.providers);
  const {
    providerOrder,
    defaultProviderId,
    defaultModelId,
    setProviderOrder,
    setDefaultModel,
  } = useStore(stores.settings);
  const orderedConfigured = useMemo(
    () => orderConfiguredProviders(configured, providerOrder, { providerId: defaultProviderId, modelId: defaultModelId }),
    [configured, defaultModelId, defaultProviderId, providerOrder],
  );
  const addedProviders = useMemo(() => {
    const orderedIds = new Set(orderedConfigured.map((provider) => provider.id));
    const configuredWithoutModels = configured.filter((provider) => !orderedIds.has(provider.id));
    const savedWithoutKey = list.filter((provider) => provider.saved === true && provider.configured !== true);
    return [...orderedConfigured, ...configuredWithoutModels, ...savedWithoutKey];
  }, [configured, list, orderedConfigured]);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => addedProviders[0]?.id);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [creatingPreset, setCreatingPreset] = useState<PresetOffer | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<ProviderEditorNavigation | null>(null);
  const [connectionTests, setConnectionTests] = useState<Record<string, ProviderEditorTestState>>({});
  const selected = addedProviders.find((provider) => provider.id === selectedId);
  const revealAdvanced = /模型发现|请求头|header|快速任务|后台任务|子任务模型|自动推荐|自动继承|高级设置|协议|base url|服务地址/.test(query);

  const handleSavedProvider = (spec: ProviderSpec) => {
    const nextOrder = providerOrder.includes(spec.id)
      ? providerOrder
      : [...providerOrder, spec.id];
    if (nextOrder !== providerOrder) setProviderOrder(nextOrder);

    const refreshed = stores.providers.getState().configured;
    const nextConfigured = refreshed.some((provider) => provider.id === spec.id)
      ? refreshed.map((provider) => provider.id === spec.id ? spec : provider)
      : spec.configured === true
        ? [...refreshed, spec]
        : refreshed;
    const first = orderConfiguredProviders(nextConfigured, nextOrder, {
      providerId: defaultProviderId,
      modelId: defaultModelId,
    })[0];
    setDefaultModel(first?.id ?? null, first?.models[0] ?? null);
  };

  useEffect(() => {
    if (creatingPreset || catalogOpen) return;
    if (selectedId && addedProviders.some((provider) => provider.id === selectedId)) return;
    setSelectedId(addedProviders[0]?.id);
  }, [addedProviders, catalogOpen, creatingPreset, selectedId]);

  const updateDirty = useCallback((dirty: boolean) => {
    setEditorDirty(dirty);
    onDirtyChange(dirty);
  }, [onDirtyChange]);

  const updateBusy = useCallback((busy: boolean) => {
    setEditorBusy(busy);
    onBusyChange(busy);
  }, [onBusyChange]);

  const updateTestState = useCallback((providerId: string, state: ProviderEditorTestState | undefined) => {
    setConnectionTests((current) => {
      if (state === undefined) {
        if (!(providerId in current)) return current;
        const next = { ...current };
        delete next[providerId];
        return next;
      }
      return { ...current, [providerId]: state };
    });
  }, []);

  const applyNavigation = (navigation: ProviderEditorNavigation) => {
    setPendingNavigation(null);
    updateDirty(false);
    if (navigation.type === "select") {
      setCreatingPreset(null);
      setCatalogOpen(false);
      setSelectedId(navigation.providerId);
    } else if (navigation.type === "catalog") {
      setCreatingPreset(null);
      setCatalogOpen(true);
    } else if (navigation.type === "configure") {
      setCreatingPreset(navigation.preset);
      setCatalogOpen(false);
    } else if (creatingPreset || catalogOpen) {
      setCreatingPreset(null);
      setCatalogOpen(addedProviders.length === 0);
      setSelectedId(addedProviders[0]?.id);
    }
    setEditorRevision((revision) => revision + 1);
  };

  const requestNavigation = (navigation: ProviderEditorNavigation) => {
    if (editorBusy) return;
    if (editorDirty) setPendingNavigation(navigation);
    else applyNavigation(navigation);
  };

  const selectProvider = (providerId: string) => {
    requestNavigation({ type: "select", providerId });
  };

  const cancelEditing = () => {
    requestNavigation({ type: "cancel" });
  };

  const reorderProviders = (orderedIds: string[]) => {
    setProviderOrder(orderedIds);
    const first = orderedIds
      .map((providerId) => addedProviders.find((provider) => provider.id === providerId))
      .find((provider) => provider?.configured === true && provider.models[0]);
    setDefaultModel(first?.id ?? null, first?.models[0] ?? null);
  };

  const removeSelected = selected
    ? async () => {
        const deletedId = selected.id;
        await deleteProvider(deletedId);
        updateTestState(deletedId, undefined);
        updateDirty(false);
        setSelectedId((current) => current === deletedId ? undefined : current);
        setEditorRevision((revision) => revision + 1);
      }
    : undefined;

  return (
    <section className="settings-models flex h-full min-h-0 flex-col">
      <div className="settings-models-heading mb-3 flex shrink-0 items-end justify-between gap-4">
        <h2 className="text-xl font-medium text-[var(--leemo-ink)]">模型供应商</h2>
        <span className="text-[11px] tabular-nums text-[var(--leemo-ink-3)]">{configured.length} 个已配置</span>
      </div>
      <div data-testid="provider-workbench" className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--leemo-line)] bg-white lg:flex-row">
        {addedProviders.length > 0 && (
          <ProviderList
            providers={addedProviders}
            selectedId={creatingPreset || catalogOpen ? undefined : selectedId}
            tests={connectionTests}
            onSelect={selectProvider}
            onOpenCatalog={() => requestNavigation({ type: "catalog" })}
            onReorder={reorderProviders}
            disabled={editorBusy}
          />
        )}
        {creatingPreset ? (
          <ProviderConfigForm
            key={`preset-${creatingPreset.kind}-${creatingPreset.id ?? "new"}-${editorRevision}`}
            preset={creatingPreset}
            onSaved={(spec) => {
              handleSavedProvider(spec);
              updateDirty(false);
              setCreatingPreset(null);
              setCatalogOpen(false);
              setSelectedId(spec.id);
              setEditorRevision((revision) => revision + 1);
            }}
            onCancel={cancelEditing}
            revealAdvanced={revealAdvanced}
            onDirtyChange={updateDirty}
            onTestStateChange={updateTestState}
            onBusyChange={updateBusy}
          />
        ) : catalogOpen || !selected ? (
          <ProviderOfferGrid
            providers={list}
            onChoose={(preset) => requestNavigation({ type: "configure", preset })}
            disabled={editorBusy}
          />
        ) : (
          <ProviderConfigForm
            key={`${selected.id}-${editorRevision}`}
            providerId={selected.id}
            preferredModelId={orderedConfigured.find((provider) => provider.id === selected.id)?.models[0]}
            onSaved={(spec) => {
              handleSavedProvider(spec);
              updateDirty(false);
              setSelectedId(spec.id);
              setEditorRevision((revision) => revision + 1);
            }}
            onCancel={cancelEditing}
            onDelete={removeSelected}
            revealAdvanced={revealAdvanced}
            onDirtyChange={updateDirty}
            onTestStateChange={updateTestState}
            onBusyChange={updateBusy}
          />
        )}
        {pendingNavigation && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/25 p-4" role="alertdialog" aria-label="放弃模型设置修改">
            <div className="w-full max-w-sm rounded-md border border-[var(--leemo-line)] bg-white p-4 shadow-xl">
              <h3 className="text-sm font-medium text-[var(--leemo-ink)]">放弃未保存的修改？</h3>
              <p className="mt-1.5 text-xs leading-5 text-[var(--leemo-ink-2)]">连接信息、模型和高级配置的改动还没有保存。</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setPendingNavigation(null)} className="h-8 rounded-md border border-[var(--leemo-line)] px-3 text-xs text-[var(--leemo-ink-2)]">继续编辑</button>
                <button type="button" onClick={() => applyNavigation(pendingNavigation)} className="h-8 rounded-md bg-[var(--leemo-danger)] px-3 text-xs font-medium text-white">放弃修改</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function SettingsPage({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
} = {}): React.JSX.Element {
  const stores = useContext(BridgeContext) as BridgeStores;
  const { settings, providers, searchSources, mcpServers, approvals, usageSummary: usageStore, memory } = stores;
  const {
    mode,
    personaCardId,
    personaCards,
    relationshipStyle,
    talkStyle,
    permissionMode,
    dangerousCommandCaching,
    webEnabled,
    webSearchEnabled,
    webFetchEnabled,
    rememberMode,
    keepAwakeDuringTasks,
    desktopNotifications,
    taskModelParsingEnabled,
    launchAtLogin,
    continueInBackground,
    quickCaptureShortcut,
    captureStorageRoot,
    defaultWorkspaceId,
    captureFileDropMode,
    setMode,
    setPersonaCard,
    setRelationshipStyle,
    upsertPersonaCard,
    deletePersonaCard,
    setTalkStyle,
    setPermissionMode,
    setDangerousCommandCaching,
    setWebEnabled,
    setWebSearchEnabled,
    setWebFetchEnabled,
    setRememberMode,
    setKeepAwakeDuringTasks,
    setDesktopNotifications,
    setTaskModelParsingEnabled,
    setLaunchAtLogin,
    setContinueInBackground,
    setQuickCaptureShortcut,
    setCaptureStorageRoot,
    setDefaultWorkspaceId,
    setCaptureFileDropMode,
  } = useStore(settings);
  const {
    configured: configuredProviders,
    balances,
    fetchBalance,
  } = useStore(providers);
  const { contextHint, clearContextHint, closeSettings, setView } = useStore(stores.ui);
  const notebooks = useStore(stores.notebooks, (state) => state.list);
  const workspaceList = useStore(stores.workspaces!, (state) => state.list);
  const workspaceStatus = useStore(stores.workspaces!, (state) => state.status);
  const memoryWorkspaces = useMemo(
    () => workspaceList
      .filter((workspace) => workspace.kind === "external")
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        available: workspace.available,
      })),
    [workspaceList],
  );
  const conversationById = useStore(stores.conversations, (state) => state.byId);
  const switchActiveConversation = useStore(stores.conversations, (state) => state.switchActive);
  const openConversationTab = useStore(stores.conversations, (state) => state.openTab);
  const requestedSettingsSection = useStore(stores.ui, (state) => state.settingsSection);
  const { whitelist, refreshWhitelist, revokeWhitelistEntry } = useStore(approvals);
  const usage = useStore(usageStore);
  const [whitelistError, setWhitelistError] = useState<string | null>(null);
  const [revokingWhitelist, setRevokingWhitelist] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>(
    () => SETTINGS_SECTION_TO_TAB[requestedSettingsSection] ?? "general",
  );
  const [settingsQuery, setSettingsQuery] = useState("");
  const [providerDirty, setProviderDirty] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [pendingSettingsTab, setPendingSettingsTab] = useState<SettingsTabId | null>(null);
  const [personaDraft, setPersonaDraft] = useState<{
    id?: string;
    name: string;
    tagline: string;
    promptText: string;
  } | null>(null);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [confirmDeletePersona, setConfirmDeletePersona] = useState<string | null>(null);
  const [advancedRiskOpen, setAdvancedRiskOpen] = useState(false);
  const [riskConfirmation, setRiskConfirmation] = useState<"bypass" | "dangerous-cache" | null>(null);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [balancePendingId, setBalancePendingId] = useState<string | null>(null);
  const [desktopSettingError, setDesktopSettingError] = useState<string | null>(null);
  const [desktopSettingBusy, setDesktopSettingBusy] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<{
    version: string;
    platform: string;
    arch: string;
    packaged: boolean;
    diagnostics: string;
  } | null>(null);
  const [aboutLoading, setAboutLoading] = useState(false);
  const [aboutActionBusy, setAboutActionBusy] = useState(false);
  const [aboutMessage, setAboutMessage] = useState<string | null>(null);
  const [aboutError, setAboutError] = useState<string | null>(null);

  const normalizedQuery = settingsQuery.trim().toLocaleLowerCase();
  const visibleTabs = normalizedQuery
    ? SETTINGS_TABS.filter((tab) => tab.keywords.toLocaleLowerCase().includes(normalizedQuery))
    : SETTINGS_TABS;

  const updateProviderDirty = useCallback((dirty: boolean) => {
    setProviderDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  const updateProviderBusy = useCallback((busy: boolean) => {
    setProviderBusy(busy);
    onBusyChange?.(busy);
  }, [onBusyChange]);

  const applySettingsTab = (tab: SettingsTabId) => {
    setPendingSettingsTab(null);
    updateProviderDirty(false);
    setActiveTab(tab);
  };

  const requestSettingsTab = (tab: SettingsTabId) => {
    if (tab === activeTab) return;
    if (activeTab === "models" && providerBusy) return;
    if (activeTab === "models" && providerDirty) setPendingSettingsTab(tab);
    else applySettingsTab(tab);
  };

  const updateSettingsQuery = (value: string) => {
    setSettingsQuery(value);
    const query = value.trim().toLocaleLowerCase();
    if (!query) return;
    const firstMatch = SETTINGS_TABS.find((tab) => tab.keywords.toLocaleLowerCase().includes(query));
    if (firstMatch) requestSettingsTab(firstMatch.id);
  };

  useEffect(() => {
    requestSettingsTab(SETTINGS_SECTION_TO_TAB[requestedSettingsSection] ?? "general");
  // requestSettingsTab intentionally follows the current dirty editor state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSettingsSection]);

  useEffect(() => {
    if (dangerousCommandCaching) {
      setAdvancedRiskOpen(true);
    }
  }, [dangerousCommandCaching, permissionMode]);

  useEffect(() => {
    if (contextHint === null) return;
    const timer = window.setTimeout(() => clearContextHint(contextHint.at), 4_000);
    return () => window.clearTimeout(timer);
  }, [clearContextHint, contextHint]);

  useEffect(() => {
    let active = true;
    void refreshWhitelist().catch(() => {
      if (active) setWhitelistError("永久权限读取失败，请稍后重试");
    });
    return () => { active = false; };
  }, [refreshWhitelist]);

  useEffect(() => {
    if (activeTab === "usage" && usage.status === "idle") void usage.refresh();
  }, [activeTab, usage.refresh, usage.status]);

  useEffect(() => {
    if (activeTab !== "about" || aboutInfo) return;
    const api = window.leemoAbout;
    if (!api) {
      setAboutError("此环境暂时无法读取版本与诊断信息。");
      return;
    }
    let active = true;
    setAboutLoading(true);
    setAboutError(null);
    void api.getInfo()
      .then((result) => {
        if (!active) return;
        if (result.ok) setAboutInfo(result.response);
        else setAboutError(result.error);
      })
      .catch(() => {
        if (active) setAboutError("诊断信息读取失败，请稍后重试。");
      })
      .finally(() => {
        if (active) setAboutLoading(false);
      });
    return () => { active = false; };
  }, [aboutInfo, activeTab]);

  const revokeWhitelist = async (toolName: string, risk: "safe" | "moderate" | "dangerous") => {
    const key = `${toolName}:${risk}`;
    setRevokingWhitelist(key);
    setWhitelistError(null);
    try {
      await revokeWhitelistEntry({ toolName, risk });
    } catch {
      setWhitelistError("撤销失败，原权限已保留");
    } finally {
      setRevokingWhitelist(null);
    }
  };

  const savePersonaDraft = () => {
    if (!personaDraft) return;
    const id = upsertPersonaCard(personaDraft);
    if (id === null) {
      setPersonaError("请填写名称、介绍和人设描述");
      return;
    }
    setPersonaDraft(null);
    setPersonaError(null);
  };

  const requestRiskConfirmation = (kind: "bypass" | "dangerous-cache") => {
    setRiskConfirmation(kind);
    setRiskAcknowledged(false);
  };

  const cancelRiskConfirmation = () => {
    setRiskConfirmation(null);
    setRiskAcknowledged(false);
  };

  const confirmRiskSetting = () => {
    if (!riskConfirmation || !riskAcknowledged) return;
    if (riskConfirmation === "bypass") {
      setPermissionMode("bypassPermissions");
    } else {
      setDangerousCommandCaching(true);
    }
    cancelRiskConfirmation();
  };

  const balanceProviders = configuredProviders.filter((provider) => provider.capabilities.balanceApi);
  const queryBalance = async (providerId: string) => {
    if (balancePendingId) return;
    setBalancePendingId(providerId);
    try {
      await fetchBalance(providerId);
    } finally {
      setBalancePendingId(null);
    }
  };

  const openMemorySourceConversation = (conversationId: string) => {
    const conversation = conversationById[conversationId];
    if (!conversation) return;
    switchActiveConversation(conversationId);
    if (conversation.source === "workbench") openConversationTab(conversationId);
    setView("chat");
    closeSettings();
  };

  const settingsStyle = { accentColor: "var(--leemo-amber)" } as CSSProperties;

  const configureDesktop = async (
    payload: { continueInBackground?: boolean; quickCaptureShortcut?: string },
    apply: (value: { continueInBackground: boolean; quickCaptureShortcut: string }) => void,
  ): Promise<void> => {
    if (desktopSettingBusy) return;
    setDesktopSettingError(null);
    const api = (window as Window & {
      leemoDesktop?: {
        configure(value: typeof payload): Promise<
          | { ok: true; response: { continueInBackground: boolean; quickCaptureShortcut: string } }
          | { ok: false; error: string }
        >;
      };
    }).leemoDesktop;
    if (!api) {
      apply({
        continueInBackground: payload.continueInBackground ?? continueInBackground,
        quickCaptureShortcut: payload.quickCaptureShortcut ?? quickCaptureShortcut,
      });
      return;
    }
    setDesktopSettingBusy(true);
    try {
      const result = await api.configure(payload);
      if (!result.ok) {
        setDesktopSettingError(result.error);
        return;
      }
      apply(result.response);
    } catch {
      setDesktopSettingError("桌面设置没有保存，请稍后重试。");
    } finally {
      setDesktopSettingBusy(false);
    }
  };

  const recordQuickCaptureShortcut = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const parts = [
      event.ctrlKey ? "Ctrl" : null,
      event.altKey ? "Alt" : null,
      event.shiftKey ? "Shift" : null,
      event.metaKey ? "Meta" : null,
      key,
    ].filter((part): part is string => Boolean(part));
    if (parts.length < 2) return;
    const shortcut = parts.join("+");
    void configureDesktop({ quickCaptureShortcut: shortcut }, (value) => {
      setQuickCaptureShortcut(value.quickCaptureShortcut);
    });
  };

  const chooseCaptureStorageRoot = async (): Promise<void> => {
    if (desktopSettingBusy) return;
    const desktop = window.leemoDesktop;
    const capture = window.leemoCapture;
    if (!desktop || !capture) {
      setDesktopSettingError("此环境暂时无法更改文件存储位置。");
      return;
    }
    setDesktopSettingBusy(true);
    setDesktopSettingError(null);
    try {
      const choice = await desktop.chooseCaptureStorageRoot();
      if (!choice.ok) {
        setDesktopSettingError(choice.error);
        return;
      }
      if (!choice.response) return;
      const root = await new IpcCaptureClient(capture).migrateStorageRoot({ newRoot: choice.response });
      setCaptureStorageRoot(root);
    } catch (error) {
      setDesktopSettingError(error instanceof Error ? error.message : "文件存储位置没有更改。");
    } finally {
      setDesktopSettingBusy(false);
    }
  };

  const openCaptureStorageRoot = async (): Promise<void> => {
    if (desktopSettingBusy || !captureStorageRoot) return;
    const desktop = window.leemoDesktop;
    if (!desktop) {
      setDesktopSettingError("此环境暂时无法打开文件存储位置。");
      return;
    }
    setDesktopSettingBusy(true);
    setDesktopSettingError(null);
    try {
      const result = await desktop.openCaptureStorageRoot();
      if (!result.ok) setDesktopSettingError(result.error);
    } catch {
      setDesktopSettingError("文件存储位置没有打开，请稍后重试。");
    } finally {
      setDesktopSettingBusy(false);
    }
  };

  const chooseDefaultWorkspace = async (): Promise<void> => {
    if (desktopSettingBusy) return;
    setDesktopSettingBusy(true);
    setDesktopSettingError(null);
    try {
      const id = await stores.workspaces!.getState().openFolder();
      if (!id) return;
      setDefaultWorkspaceId(id);
      stores.notebooks.getState().setActive(null);
      stores.conversations.getState().activateScope(id, null);
      stores.ui.getState().activateWorkbenchScope(`workspace:${id}`);
      await stores.fileTree.getState().refresh();
    } catch (error) {
      setDesktopSettingError(error instanceof Error ? error.message : "默认工作区没有更改。");
    } finally {
      setDesktopSettingBusy(false);
    }
  };

  const openDefaultWorkspace = async (): Promise<void> => {
    if (!window.leemoWorkspace || desktopSettingBusy) return;
    setDesktopSettingBusy(true);
    setDesktopSettingError(null);
    try {
      await new IpcWorkspaceClient(window.leemoWorkspace).reveal(undefined, defaultWorkspaceId);
    } catch (error) {
      setDesktopSettingError(error instanceof Error ? error.message : "默认工作区没有打开。");
    } finally {
      setDesktopSettingBusy(false);
    }
  };

  const copyAboutDiagnostics = async (): Promise<void> => {
    if (!aboutInfo || aboutActionBusy) return;
    setAboutActionBusy(true);
    setAboutMessage(null);
    setAboutError(null);
    try {
      await navigator.clipboard.writeText(aboutInfo.diagnostics);
      setAboutMessage("诊断信息已复制");
    } catch {
      setAboutError("诊断信息没有复制，请稍后重试。");
    } finally {
      setAboutActionBusy(false);
    }
  };

  const openLogsDirectory = async (): Promise<void> => {
    if (aboutActionBusy) return;
    const api = window.leemoAbout;
    if (!api) {
      setAboutError("此环境暂时无法打开日志文件夹。");
      return;
    }
    setAboutActionBusy(true);
    setAboutMessage(null);
    setAboutError(null);
    try {
      const result = await api.openLogsDirectory();
      if (result.ok) setAboutMessage("已打开日志文件夹");
      else setAboutError(result.error);
    } catch {
      setAboutError("日志文件夹没有打开，请稍后重试。");
    } finally {
      setAboutActionBusy(false);
    }
  };

  const defaultWorkspace = workspaceList.find((workspace) => workspace.id === defaultWorkspaceId)
    ?? workspaceList.find((workspace) => workspace.kind === "home");

  return (
    <div className="settings-page relative flex h-full min-h-0 flex-col bg-[var(--leemo-bg)]" style={settingsStyle}>
      <header className="settings-header flex h-16 shrink-0 items-center border-b border-[var(--leemo-line)] bg-white px-6 pr-16">
        <h1 className="text-lg font-medium text-[var(--leemo-ink)]">设置</h1>
        {contextHint !== null && (
          <p data-testid="context-hint" className="ml-auto text-xs text-[var(--leemo-amber-ink)]">
            {contextHint.count > 0
              ? `已保存 · ${contextHint.count} 个对话下一轮起生效`
              : "已保存"}
          </p>
        )}
      </header>

      <div className="settings-body flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside data-testid="settings-sidebar" className="settings-sidebar w-full shrink-0 border-b border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-4 sm:border-b-0 sm:border-r">
          <input
            type="search"
            value={settingsQuery}
            onChange={(event) => updateSettingsQuery(event.target.value)}
            disabled={providerBusy}
            placeholder="搜索设置"
            aria-label="搜索设置"
            className="mb-4 w-full rounded-md border border-[var(--leemo-line)] bg-white px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)]"
          />
          <nav role="tablist" aria-label="设置分类" aria-orientation="vertical" className="settings-tabs flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  id={`settings-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-label={tab.label}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`settings-panel-${tab.id}`}
                  disabled={providerBusy && tab.id !== activeTab}
                  onClick={() => requestSettingsTab(tab.id)}
                  className={`settings-tab flex min-w-max items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-left text-sm transition-colors sm:w-full ${
                    activeTab === tab.id
                      ? "border-[var(--leemo-amber)] bg-white font-medium text-[var(--leemo-ink)]"
                      : "border-transparent text-[var(--leemo-ink-2)] hover:bg-white hover:text-[var(--leemo-ink)]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
          {visibleTabs.length === 0 && <p className="px-2 py-3 text-xs text-[var(--leemo-ink-3)]">没有匹配的设置</p>}
        </aside>

        <main
          id={`settings-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className={`settings-content min-h-0 min-w-0 flex-1 bg-white px-5 py-6 sm:px-8 sm:py-7 ${
            activeTab === "models" ? "overflow-hidden" : "overflow-y-auto"
          }`}
        >

          {activeTab === "models" && (
            <ProviderWorkbenchSection
              query={normalizedQuery}
              onDirtyChange={updateProviderDirty}
              onBusyChange={updateProviderBusy}
            />
          )}

          {activeTab === "connectors" && (
            <>
              <SearchSourcesSection
                store={searchSources}
                webEnabled={webEnabled}
                webSearchEnabled={webSearchEnabled}
                webFetchEnabled={webFetchEnabled}
                onToggleWeb={setWebEnabled}
                onToggleSearch={setWebSearchEnabled}
                onToggleFetch={setWebFetchEnabled}
              />
              <BrowserAutomationSection store={mcpServers} />
              <ComputerUseSection store={mcpServers} />
              <McpServersSection store={mcpServers} />
            </>
          )}

          {/* 基调模式 */}
          {activeTab === "general" && <section className="settings-section mb-8">
        <div className="mb-5">
          <h2 className="text-xl font-medium text-[var(--leemo-ink)]">通用</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">管理 Leemo 的启动、后台与通知方式</p>
        </div>
        <h3 className="settings-group-title mb-3 text-sm font-medium text-[var(--leemo-ink-2)]">启动与后台</h3>
        <label className="settings-row settings-row-select">
          <span>
            <span className="settings-row-title">启动后进入</span>
            <span className="settings-row-description">选择每次打开 Leemo 时首先看到的页面</span>
          </span>
          <select
            aria-label="启动后进入"
            value={mode}
            onChange={(event) => setMode(event.target.value as "buddy" | "workbench")}
          >
            <option value="buddy">搭子</option>
            <option value="workbench">工作台</option>
          </select>
        </label>
          </section>}

          {activeTab === "general" && <section className="settings-section settings-section-continuation mb-8">
            <div className="settings-row flex items-start justify-between gap-4 border-b border-[var(--leemo-line)] py-3">
              <span>
                <span className="settings-row-title block text-sm font-medium text-[var(--leemo-ink)]">关闭窗口后继续运行</span>
                <span className="settings-row-description mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">任务和定时任务可在后台继续</span>
              </span>
              <LeemoSwitch
                label="关闭窗口后在后台运行"
                checked={continueInBackground}
                disabled={desktopSettingBusy}
                onCheckedChange={(checked) => {
                  void configureDesktop({ continueInBackground: checked }, (value) => {
                    setContinueInBackground(value.continueInBackground);
                  });
                }}
                className="mt-0.5"
              />
            </div>
            <div className="settings-row flex items-start justify-between gap-4 py-2">
              <span>
                <span className="settings-row-title block text-sm font-medium text-[var(--leemo-ink)]">开机时自动启动 Leemo</span>
                <span className="settings-row-description mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">登录电脑后自动打开，默认关闭</span>
              </span>
              <LeemoSwitch
                label="开机自动启动 Leemo"
                checked={launchAtLogin}
                onCheckedChange={setLaunchAtLogin}
                className="mt-0.5"
              />
            </div>
          </section>}

          {activeTab === "shortcuts" && <section className="mb-8">
            <div className="mb-5">
              <h2 className="text-xl font-medium text-[var(--leemo-ink)]">快捷键</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">管理当前已接入系统的全局快捷操作。</p>
            </div>
            <label className="block border-y border-[var(--leemo-line)] py-4">
              <span className="block text-sm font-medium text-[var(--leemo-ink)]">快速记录快捷键</span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">在任何应用中打开一个新的快捷便签。</span>
              <input
                type="text"
                aria-label="快速记录快捷键"
                value={quickCaptureShortcut}
                readOnly
                disabled={desktopSettingBusy}
                onKeyDown={recordQuickCaptureShortcut}
                className="mt-3 w-full max-w-xs rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-surface)] px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                spellCheck={false}
                autoComplete="off"
              />
              {desktopSettingError ? (
                <p role="alert" className="mt-2 text-xs text-[var(--leemo-danger)]">{desktopSettingError}</p>
              ) : null}
            </label>
          </section>}

          {activeTab === "data" && <section className="settings-section settings-storage" aria-label="数据与存储设置">
            <div className="settings-section-heading">
              <h2>数据与存储</h2>
              <p>查看 Leemo 的文件放在哪里，并管理会持续增长的内容。</p>
            </div>

            <h3 className="settings-storage__group-title">保存位置</h3>
            <div className="settings-storage__locations">
              <article className="settings-storage__location-card">
                <div className="settings-storage__location-copy">
                  <h4>默认工作区</h4>
                  <p className="settings-storage__path">{defaultWorkspacePath(defaultWorkspace)}</p>
                  <p>未选择本子时，momo 创建的新文件和产物保存在这里。</p>
                  <small>它不是本子，不会新增一套记忆或人格。</small>
                </div>
                <div className="settings-storage__location-actions">
                  {window.leemoWorkspace ? (
                    <button type="button" disabled={desktopSettingBusy} onClick={() => void openDefaultWorkspace()}>打开文件夹</button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="更改默认工作区"
                    disabled={desktopSettingBusy || workspaceStatus === "loading"}
                    onClick={() => void chooseDefaultWorkspace()}
                  >
                    更改位置
                  </button>
                </div>
              </article>

              <article className="settings-storage__location-card">
                <div className="settings-storage__location-copy">
                  <h4>Leemo 文件<span className="sr-only">存储位置</span></h4>
                  <p className="settings-storage__path">{captureStorageRoot ?? "尚未选择；首次保存图片或文件副本时再选择位置。"}</p>
                  <p>便签图片、文件副本和可清理缓存保存在这里。</p>
                  <small>首次保存时再选择也可以，不会默认塞进系统盘。</small>
                </div>
                <div className="settings-storage__location-actions">
                  {captureStorageRoot ? <button type="button" disabled={desktopSettingBusy} onClick={() => void openCaptureStorageRoot()}>打开文件夹</button> : null}
                  <button type="button" disabled={desktopSettingBusy} onClick={() => void chooseCaptureStorageRoot()}>
                    {captureStorageRoot ? "更改位置" : "选择文件夹"}
                  </button>
                </div>
              </article>
            </div>

            <h3 className="settings-storage__group-title">文件进入 Leemo 时</h3>
            <div className="settings-storage__toggle-row">
              <span>
                <strong>拖入文件时保存副本</strong>
                <small>关闭时只记录原文件位置；粘贴的图片始终保存到 Leemo 文件。</small>
              </span>
              <LeemoSwitch
                label="拖入文件时保存副本"
                checked={captureFileDropMode === "copy"}
                onCheckedChange={(checked) => setCaptureFileDropMode(checked ? "copy" : "reference")}
              />
            </div>
            {desktopSettingError ? <p role="alert" className="settings-storage__error">{desktopSettingError}</p> : null}
          </section>}

          {activeTab === "general" && <section className="settings-section mb-8 border-t border-[var(--leemo-line)] pt-7">
            <h3 className="settings-group-title mb-3 text-sm font-medium text-[var(--leemo-ink-2)]">通知</h3>
            <div className="settings-row flex items-start justify-between gap-4 py-2">
              <span>
                <span className="block text-sm font-medium text-[var(--leemo-ink)]">任务运行期间阻止电脑自动休眠</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">长任务和定时任务运行时保持系统工作，屏幕仍可正常关闭。</span>
              </span>
              <LeemoSwitch
                label="任务运行期间阻止电脑自动休眠"
                checked={keepAwakeDuringTasks}
                onCheckedChange={setKeepAwakeDuringTasks}
                className="mt-0.5"
              />
            </div>
            <div className="settings-row flex items-start justify-between gap-4 py-2">
              <span>
                <span className="block text-sm font-medium text-[var(--leemo-ink)]">Leemo 不在前台时显示桌面通知</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">任务完成或需要你处理时提醒，不显示对话内容。</span>
              </span>
              <LeemoSwitch
                label="Leemo 不在前台时显示桌面通知"
                checked={desktopNotifications}
                onCheckedChange={setDesktopNotifications}
                className="mt-0.5"
              />
            </div>
            <div className="settings-row flex items-start justify-between gap-4 border-t border-[var(--leemo-line)] py-3">
              <span>
                <span className="block text-sm font-medium text-[var(--leemo-ink)]">使用模型理解复杂待办</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">只有本地无法分清计划、截止与提醒时才会使用当前模型，可能消耗少量额度。关闭后保留原文，由你手动填写。</span>
              </span>
              <LeemoSwitch
                label="使用模型理解复杂待办"
                checked={taskModelParsingEnabled}
                onCheckedChange={setTaskModelParsingEnabled}
                className="mt-0.5"
              />
            </div>
          </section>}

          {/* 人设卡片 */}
          {activeTab === "personalization" && <section className="mb-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-medium text-[var(--leemo-ink)]">momo 的相处气质</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">MBTI 只是相处风味，不是对你或 momo 的人格测评结论。</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPersonaDraft({ name: "", tagline: "", promptText: "" });
                  setPersonaError(null);
                }}
                className="rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs font-medium text-[var(--leemo-ink)] hover:border-[var(--leemo-amber)]"
              >
                新建人设
              </button>
            </div>

            <div className="divide-y divide-[var(--leemo-line-soft)] border-y border-[var(--leemo-line)]">
              {personaCards.map((card) => (
                <div key={card.id} className="flex min-h-14 items-center justify-between gap-3 py-2.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name="personaCard"
                      value={card.id}
                      checked={personaCardId === card.id}
                      onChange={() => setPersonaCard(card.id)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--leemo-ink)]">{card.name}</span>
                      <span className="block truncate text-xs text-[var(--leemo-ink-3)]">{card.tagline}</span>
                    </span>
                  </label>
                  {!card.builtin && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`编辑 ${card.name}`}
                        onClick={() => {
                          setPersonaDraft({ id: card.id, name: card.name, tagline: card.tagline, promptText: card.promptText });
                          setPersonaError(null);
                          setConfirmDeletePersona(null);
                        }}
                        className="rounded-md px-2 py-1 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-bg)]"
                      >
                        编辑
                      </button>
                      {confirmDeletePersona === card.id ? (
                        <>
                          <button
                            type="button"
                            aria-label={`确认删除 ${card.name}`}
                            onClick={() => {
                              deletePersonaCard(card.id);
                              setConfirmDeletePersona(null);
                              if (personaDraft?.id === card.id) setPersonaDraft(null);
                            }}
                            className="rounded-md bg-[var(--leemo-danger)] px-2 py-1 text-xs text-white"
                          >
                            确认
                          </button>
                          <button
                            type="button"
                            aria-label={`取消删除 ${card.name}`}
                            onClick={() => setConfirmDeletePersona(null)}
                            className="rounded-md px-2 py-1 text-xs text-[var(--leemo-ink-2)]"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          aria-label={`删除 ${card.name}`}
                          onClick={() => setConfirmDeletePersona(card.id)}
                          className="rounded-md px-2 py-1 text-xs text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger)]"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {personaDraft && (
              <div data-testid="persona-editor" className="mt-4 border-y border-[var(--leemo-line)] py-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-[var(--leemo-ink-2)]">
                    名称
                    <input
                      aria-label="人设名称"
                      maxLength={30}
                      value={personaDraft.name}
                      onChange={(event) => setPersonaDraft({ ...personaDraft, name: event.target.value })}
                      className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--leemo-ink-2)]">
                    一句话介绍
                    <input
                      aria-label="一句话介绍"
                      maxLength={80}
                      value={personaDraft.tagline}
                      onChange={(event) => setPersonaDraft({ ...personaDraft, tagline: event.target.value })}
                      className="mt-1 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                    />
                  </label>
                  <label className="text-xs text-[var(--leemo-ink-2)] sm:col-span-2">
                    <span className="flex items-center justify-between gap-3">
                      <span>人设描述</span>
                      <span className="tabular-nums text-[var(--leemo-ink-3)]">
                        {personaDraft.promptText.length} / {PERSONA_PROMPT_TEXT_MAX_LENGTH}
                      </span>
                    </span>
                    <textarea
                      aria-label="人设描述"
                      aria-describedby={personaDraft.promptText.length > PERSONA_PROMPT_LONG_DESCRIPTION_LENGTH
                        ? "persona-description-length-note"
                        : undefined}
                      maxLength={PERSONA_PROMPT_TEXT_MAX_LENGTH}
                      rows={4}
                      value={personaDraft.promptText}
                      onChange={(event) => setPersonaDraft({ ...personaDraft, promptText: event.target.value })}
                      className="mt-1 w-full resize-y rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2 text-sm leading-6 text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                    />
                    {personaDraft.promptText.length > PERSONA_PROMPT_LONG_DESCRIPTION_LENGTH && (
                      <span
                        id="persona-description-length-note"
                        role="status"
                        className="mt-1.5 block leading-5 text-[var(--leemo-amber-strong)]"
                      >
                        描述较长，靠后的内容可能不会进入每轮对话；请把最重要的约定放在前面。
                      </span>
                    )}
                  </label>
                </div>
                {personaError && <p role="alert" className="mt-2 text-xs text-[var(--leemo-danger)]">{personaError}</p>}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setPersonaDraft(null); setPersonaError(null); }}
                    className="rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs text-[var(--leemo-ink-2)]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={savePersonaDraft}
                    className="rounded-md bg-[var(--leemo-ink)] px-3 py-1.5 text-xs font-medium text-white"
                  >
                    保存人设
                  </button>
                </div>
              </div>
            )}
          </section>}

          {activeTab === "personalization" && <fieldset className="mb-8 border-t border-[var(--leemo-line)] pt-7">
            <legend className="text-xl font-medium text-[var(--leemo-ink)]">你希望 momo 更像谁</legend>
            <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">只改变相处方式，不限制 momo 能做的事；之后随时可以换。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="momo 的关系定位">
              {RELATIONSHIP_STYLE_OPTIONS.map((option) => {
                const selected = relationshipStyle === option.id;
                return (
                  <label
                    key={option.id}
                    className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-md border px-3 py-3 transition-colors ${
                      selected
                        ? "border-[var(--leemo-amber)] bg-[var(--leemo-amber-bg)]"
                        : "border-[var(--leemo-line)] bg-white hover:border-[var(--leemo-line-strong)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="relationshipStyle"
                      value={option.id}
                      checked={selected}
                      onChange={() => setRelationshipStyle(option.id)}
                      aria-label={`${option.label}：${option.description}`}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--leemo-ink)]">{option.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>}

          {/* 话风档位 */}
          {activeTab === "personalization" && <section className="mb-8">
        <h2 className="mb-4 text-xl font-medium text-[var(--leemo-ink)]">话风档位</h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[var(--leemo-ink-3)]">简洁</span>
          <input
            type="range"
            min="1"
            max="3"
            step="1"
            value={talkStyle}
            onChange={(e) => setTalkStyle(Number(e.target.value) as 1 | 2 | 3)}
            className="flex-1"
          />
          <span className="text-xs text-[var(--leemo-ink-3)]">话痨</span>
          <span className="ml-2 text-sm text-[var(--leemo-ink-2)]">{talkStyle}</span>
        </div>
          </section>}

          {activeTab === "usage" && <section id="settings-usage" className="settings-section settings-usage">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2>用量与费用</h2>
            <p>订阅模型也按本地费率表折算等价值；没有可靠费率时会明确标为未定价。</p>
          </div>
          <div className="settings-usage__range" aria-label="用量范围">
            {(["today", "last7d", "last30d"] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => void usage.refresh(range)}
                aria-pressed={usage.range === range}
              >
                {range === "today" ? "今天" : range === "last7d" ? "近 7 天" : "近 30 天"}
              </button>
            ))}
          </div>
        </div>
        {usage.status === "error" && usage.summary !== null && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--leemo-line)] py-3">
            <p role="alert" className="text-xs text-[var(--leemo-danger)]">{usage.error}，当前仍显示上次成功读取的数据。</p>
            <button type="button" aria-label="重新读取用量" onClick={() => void usage.refresh()} className="rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)]">重试</button>
          </div>
        )}
        {usage.status === "loading" && usage.summary === null ? (
          <p role="status" className="text-xs text-[var(--leemo-ink-3)]">正在读取用量…</p>
        ) : usage.status === "error" && usage.summary === null ? (
          <div className="border-y border-[var(--leemo-line)] py-4">
            <p role="alert" className="text-xs text-[var(--leemo-danger)]">{usage.error}</p>
            <button type="button" aria-label="重新读取用量" onClick={() => void usage.refresh()} className="mt-3 rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)]">重试</button>
          </div>
        ) : usage.summary ? (() => {
          const totals = usageTotals(usage.summary);
          const pricedRows = usage.summary.byModel ?? usage.summary.byProvider.map((row) => ({
            providerId: row.providerId,
            modelId: "全部模型",
            costUsd: row.costUsd,
            callCount: row.callCount ?? 0,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens ?? 0,
            cacheCreationTokens: row.cacheCreationTokens ?? 0,
          }));
          const cacheDenominator = totals.inputTokens + totals.cacheReadTokens;
          const cacheRate = cacheDenominator > 0 ? Math.round((totals.cacheReadTokens / cacheDenominator) * 100) : 0;
          const maxDayCost = Math.max(0, ...(usage.summary.byDay ?? []).map((day) => Number(day.costUsd ?? 0)));
          return <div>
            <div className="settings-usage__metrics">
              <article>
                <span>费用 / 等价值</span>
                <strong>{usageCostLabel(usage.summary)}</strong>
                <small>API 实际费用或订阅模型折算</small>
              </article>
              <article>
                <span>调用次数</span>
                <strong>{formatTokenCount(totals.callCount)} 次</strong>
                <small>当前时间范围内的模型请求</small>
              </article>
              <article>
                <span>输入 / 输出</span>
                <strong>{formatTokenCount(totals.inputTokens)} / {formatTokenCount(totals.outputTokens)}</strong>
                <small>token</small>
              </article>
              <article>
                <span>缓存读取</span>
                <strong>{formatTokenCount(totals.cacheReadTokens)}</strong>
                <small>{cacheRate}% 命中 · 新建 {formatTokenCount(totals.cacheCreationTokens)}</small>
              </article>
            </div>

            {(usage.summary.byDay?.length ?? 0) > 0 ? (
              <section className="settings-usage__trend" aria-label="每日费用趋势">
                <div className="settings-usage__subheading">
                  <h3>用量趋势</h3>
                  <span>按本地日期</span>
                </div>
                <div className="settings-usage__bars">
                  {usage.summary.byDay?.map((day) => {
                    const value = Number(day.costUsd ?? 0);
                    const height = maxDayCost > 0 ? Math.max(8, Math.round((value / maxDayCost) * 72)) : 8;
                    return <span key={day.date} title={`${day.date} · ${day.costUsd === undefined ? "未定价" : `US$${day.costUsd}`}`}>
                      <i style={{ height }} />
                      <small>{day.date.slice(5)}</small>
                    </span>;
                  })}
                </div>
              </section>
            ) : null}

            {usage.summary.byProvider.length === 0 ? (
              <p className="py-4 text-xs text-[var(--leemo-ink-3)]">这个时间段还没有用量</p>
            ) : (
              <div className="settings-usage__table-wrap">
                <div className="settings-usage__subheading">
                  <h3>模型明细</h3>
                  <span>缓存 token 不会混入普通输入</span>
                </div>
                <table aria-label="模型用量明细">
                  <thead><tr><th>模型</th><th>调用</th><th>输入</th><th>输出</th><th>缓存读取</th><th>费用 / 等价值</th></tr></thead>
                  <tbody>
                    {pricedRows.map((row) => (
                      <tr key={`${row.providerId}:${row.modelId}`}>
                        <td><strong>{row.modelId}</strong><small>{row.providerId}</small></td>
                        <td>{formatTokenCount(row.callCount)} 次</td>
                        <td>{formatTokenCount(row.inputTokens)}</td>
                        <td>{formatTokenCount(row.outputTokens)}</td>
                        <td>{formatTokenCount(row.cacheReadTokens)}</td>
                        <td>{row.costUsd === undefined ? "未定价" : `US$${row.costUsd}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        })() : null}

        <section aria-labelledby="provider-balance-heading" className="mt-8 border-t border-[var(--leemo-line)] pt-7">
          <div className="mb-3">
            <h2 id="provider-balance-heading" className="text-xl font-medium text-[var(--leemo-ink)]">账户余额</h2>
            <p className="mt-1 text-xs text-[var(--leemo-ink-3)]">只查询服务商提供的余额接口，不影响模型连接。</p>
          </div>
          {balanceProviders.length === 0 ? (
            <p className="border-y border-dashed border-[var(--leemo-line)] py-5 text-xs text-[var(--leemo-ink-3)]">当前已接入的服务商没有提供余额查询接口</p>
          ) : (
            <div className="divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">
              {balanceProviders.map((provider) => {
                const entry = balances[provider.id];
                const pending = balancePendingId === provider.id;
                const value = entry && "info" in entry
                  ? entry.info.totalCny !== undefined
                    ? `¥${entry.info.totalCny}`
                    : entry.info.totalUsd !== undefined
                      ? `US$${entry.info.totalUsd}`
                      : entry.info.supported
                        ? "余额未知"
                        : "暂不支持"
                  : entry && "error" in entry
                    ? "查询失败 · 重试"
                    : null;
                return (
                  <div key={provider.id} className="flex min-h-14 items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--leemo-ink)]">{provider.name}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--leemo-ink-3)]">{provider.models[0] ?? "未启用模型"}</p>
                    </div>
                    {value && !pending ? (
                      <button type="button" aria-label={`重新查询 ${provider.name} 余额`} onClick={() => void queryBalance(provider.id)} className={`shrink-0 text-sm tabular-nums ${entry && "error" in entry ? "text-[var(--leemo-danger)]" : "text-[var(--leemo-ink-2)]"}`}>{value}</button>
                    ) : (
                      <button type="button" aria-label={`查询 ${provider.name} 余额`} disabled={balancePendingId !== null} onClick={() => void queryBalance(provider.id)} className="shrink-0 rounded-md border border-[var(--leemo-line)] px-3 py-1.5 text-xs text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] disabled:opacity-50">{pending ? "查询中" : "查询余额"}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
          </section>}

          {activeTab === "about" && <section className="mb-8">
            <div className="mb-5">
              <h2 className="text-xl font-medium text-[var(--leemo-ink)]">关于</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">版本与诊断信息</p>
            </div>
            <div className="flex items-center gap-5 rounded-md border border-[var(--leemo-line)] bg-white p-5">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-[var(--leemo-bg)]">
                <LeemoMark size={54} label="Leemo 标志" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-medium text-[var(--leemo-ink)]">Leemo</h3>
                <p className="mt-1 text-sm leading-5 text-[var(--leemo-ink-2)]">一个懂你，也能帮你做事的本地 AI 工作台</p>
                <span
                  aria-label={`版本 ${aboutInfo?.version ?? "不可用"}`}
                  className="mt-3 inline-flex rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 py-1 text-xs tabular-nums text-[var(--leemo-ink-2)]"
                >
                  {aboutLoading ? "读取中" : aboutInfo?.version ?? "版本不可用"}
                </span>
              </div>
            </div>

            <section className="mt-8" aria-labelledby="about-diagnostics-heading">
              <h3 id="about-diagnostics-heading" className="mb-3 text-sm font-medium text-[var(--leemo-ink-2)]">诊断与日志</h3>
              <div className="rounded-md border border-[var(--leemo-line)] p-4">
                <p className="text-xs leading-5 text-[var(--leemo-ink-3)]">遇到问题时，可复制必要的版本与运行信息，或打开日志文件夹进一步查看。</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!aboutInfo || aboutActionBusy}
                    onClick={() => void copyAboutDiagnostics()}
                    className="rounded-md border border-[var(--leemo-line)] bg-white px-3 py-2 text-sm text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] hover:text-[var(--leemo-ink)] disabled:cursor-default disabled:opacity-50"
                  >
                    复制诊断信息
                  </button>
                  <button
                    type="button"
                    disabled={aboutActionBusy}
                    onClick={() => void openLogsDirectory()}
                    className="rounded-md border border-[var(--leemo-line)] bg-white px-3 py-2 text-sm text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] hover:text-[var(--leemo-ink)] disabled:cursor-default disabled:opacity-50"
                  >
                    打开日志文件夹
                  </button>
                </div>
                <p className="mt-4 text-xs leading-5 text-[var(--leemo-ink-3)]">诊断信息不包含 API Key、对话正文或文件内容。</p>
                {aboutMessage ? <p role="status" className="mt-2 text-xs text-[var(--leemo-ink-2)]">{aboutMessage}</p> : null}
                {aboutError ? <p role="alert" className="mt-2 text-xs text-[var(--leemo-danger)]">{aboutError}</p> : null}
              </div>
            </section>
          </section>}

          {/* 权限策略 */}
          {activeTab === "permissions" && <section className="settings-permissions mb-8">
        <div className="settings-permission-heading">
          <h2>权限</h2>
          <p>决定 momo 执行任务时，什么时候需要先问你</p>
        </div>
        <div className="settings-permission-note">
          <Info aria-hidden />
          <span>功能开关决定 momo 能不能使用；这里决定使用前是否询问。</span>
        </div>
        <div className="space-y-3">
          <div>
            <p className="settings-permission-group-title">任务中的确认方式</p>
            <div className="settings-permission-choices">
              <label data-active={permissionMode === "default"} className="settings-permission-choice">
                <input
                  type="radio"
                  name="permissionMode"
                  value="default"
                  checked={permissionMode === "default"}
                  onChange={() => setPermissionMode("default")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm text-[var(--leemo-ink)]">每次确认</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">编辑外部文件、联网或执行命令前都询问。</span>
                </span>
              </label>
              <label data-active={permissionMode === "acceptEdits"} className="settings-permission-choice">
                <input
                  type="radio"
                  name="permissionMode"
                  value="acceptEdits"
                  checked={permissionMode === "acceptEdits"}
                  onChange={() => setPermissionMode("acceptEdits")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium text-[var(--leemo-ink)]">风险确认 <span className="font-normal text-[var(--leemo-amber-strong)]">推荐</span></span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">常规改动直接做，只对检测到的风险操作询问。</span>
                </span>
              </label>
              <label data-active={permissionMode === "bypassPermissions"} className="settings-permission-choice">
                <input
                  type="radio"
                  name="permissionMode"
                  value="bypassPermissions"
                  checked={permissionMode === "bypassPermissions"}
                  onChange={() => {
                    if (permissionMode !== "bypassPermissions") requestRiskConfirmation("bypass");
                  }}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className={`block text-sm ${permissionMode === "bypassPermissions" ? "font-medium text-[var(--leemo-amber-strong)]" : "text-[var(--leemo-ink)]"}`}>完全访问</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">不再请求权限；仅在信任当前任务时使用。</span>
                </span>
              </label>
            </div>
          </div>
          <div className="mt-5 border-t border-[var(--leemo-line)] pt-4">
            <button
              type="button"
              aria-label="高级风险设置"
              aria-expanded={advancedRiskOpen}
              aria-controls="advanced-risk-settings"
              onClick={() => {
                setAdvancedRiskOpen((open) => !open);
                cancelRiskConfirmation();
              }}
              className="flex w-full items-center justify-between gap-4 py-1 text-left text-sm font-medium text-[var(--leemo-ink-2)] hover:text-[var(--leemo-danger)]"
            >
              <span className="flex items-center gap-2">
                高级风险设置
                {dangerousCommandCaching && (
                  <span className="text-xs font-normal text-[var(--leemo-danger)]">有高风险选项已开启</span>
                )}
              </span>
              <span aria-hidden className="w-4 text-center text-base">{advancedRiskOpen ? "-" : "+"}</span>
            </button>

            {advancedRiskOpen && (
              <div
                id="advanced-risk-settings"
                className="mt-3 border-l-2 border-[var(--leemo-danger-line)] pl-4"
              >
                <p className="max-w-2xl text-xs leading-5 text-[var(--leemo-ink-3)]">
                  这些选项会减少确认步骤，也会扩大误操作影响。仅在你理解风险时开启，关闭会立即生效。
                </p>

                <div className="mt-3 border-y border-[var(--leemo-line)]">
                  <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className={`block text-sm font-medium ${dangerousCommandCaching ? "text-[var(--leemo-danger)]" : "text-[var(--leemo-ink)]"}`}>
                        记住危险操作授权
                      </span>
                      <span className="mt-1 block max-w-xl text-xs leading-5 text-[var(--leemo-ink-3)]">
                        开启后，同一条高风险命令可在本次任务内不再询问；不会跨任务放行。
                      </span>
                    </span>
                    <LeemoSwitch
                      label="记住危险操作授权"
                      checked={dangerousCommandCaching}
                      onCheckedChange={(checked) => {
                        if (checked) requestRiskConfirmation("dangerous-cache");
                        else setDangerousCommandCaching(false);
                      }}
                    />
                  </div>
                </div>

              </div>
            )}
          </div>
          {riskConfirmation && (
            <div
              role="alertdialog"
              aria-labelledby="risk-confirmation-title"
              className="mt-3 border-y border-[var(--leemo-danger-line)] bg-[var(--leemo-danger-soft)] px-3 py-3"
            >
              <p id="risk-confirmation-title" className="text-sm font-medium text-[var(--leemo-danger)]">
                {riskConfirmation === "bypass" ? "确认开启完全访问" : "确认记住危险授权"}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-2)]">
                {riskConfirmation === "bypass"
                  ? "开启后，momo 可以在不询问的情况下执行所有工具。这个选择会跨任务和重启保留，直到你主动关闭。"
                  : "开启后，你批准的同一条危险操作可在本次任务内不再询问。"}
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-[var(--leemo-ink)]">
                <input
                  type="checkbox"
                  checked={riskAcknowledged}
                  onChange={(event) => setRiskAcknowledged(event.target.checked)}
                  aria-label={riskConfirmation === "bypass"
                    ? "我了解 momo 将不再逐项询问，包括删除文件等高风险操作"
                    : "我了解危险操作可能在本次任务内不再询问"}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  {riskConfirmation === "bypass"
                    ? "我了解 momo 将不再逐项询问，包括删除文件等高风险操作"
                    : "我了解危险操作可能在本次任务内不再询问"}
                </span>
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelRiskConfirmation}
                  className="rounded-md border border-[var(--leemo-line)] bg-white px-3 py-1.5 text-xs text-[var(--leemo-ink-2)]"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!riskAcknowledged}
                  onClick={confirmRiskSetting}
                  className="rounded-md bg-[var(--leemo-danger)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {riskConfirmation === "bypass" ? "确认开启完全访问" : "确认记住危险授权"}
                </button>
              </div>
            </div>
          )}
          <div className="mt-5 border-t border-[var(--leemo-line)] pt-4">
            <h3 className="text-sm font-medium text-[var(--leemo-ink)]">已永久允许</h3>
            {whitelistError && <p role="alert" className="mt-2 text-xs text-[var(--leemo-danger)]">{whitelistError}</p>}
            {whitelist.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--leemo-ink-3)]">暂无永久权限</p>
            ) : (
              <div className="mt-2 divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">
                {whitelist.map((entry) => {
                  const riskLabel = { safe: "安全", moderate: "中风险", dangerous: "高风险" }[entry.risk];
                  const key = `${entry.toolName}:${entry.risk}`;
                  const displayLabel = permissionToolLabel(entry.toolName);
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-[var(--leemo-ink)]">{displayLabel}</p>
                        <p className="text-xs text-[var(--leemo-ink-3)]">{riskLabel}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`撤销 ${displayLabel} ${riskLabel}`}
                        disabled={revokingWhitelist === key}
                        onClick={() => void revokeWhitelist(entry.toolName, entry.risk)}
                        className="rounded-md border border-[var(--leemo-line)] px-2.5 py-1 text-xs text-[var(--leemo-ink-2)] hover:border-[var(--leemo-danger)] hover:text-[var(--leemo-danger)] disabled:opacity-50"
                      >
                        {revokingWhitelist === key ? "撤销中…" : "撤销"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
          </section>}

          {activeTab === "personalization" && (
            <MemorySettingsSection
              store={memory}
              notebooks={notebooks}
              workspaces={memoryWorkspaces}
              conversations={conversationById}
              rememberMode={rememberMode}
              onRememberModeChange={setRememberMode}
              onOpenConversation={openMemorySourceConversation}
            />
          )}
        </main>
      </div>

      {pendingSettingsTab && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/25 p-4" role="alertdialog" aria-label="离开模型设置">
          <div className="w-full max-w-sm rounded-md border border-[var(--leemo-line)] bg-white p-4 shadow-xl">
            <h2 className="text-sm font-medium text-[var(--leemo-ink)]">放弃未保存的模型设置？</h2>
            <p className="mt-1.5 text-xs leading-5 text-[var(--leemo-ink-2)]">切换设置分类会丢失当前还没保存的修改。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => { setPendingSettingsTab(null); setSettingsQuery(""); }} className="h-8 rounded-md border border-[var(--leemo-line)] px-3 text-xs text-[var(--leemo-ink-2)]">继续编辑</button>
              <button type="button" onClick={() => applySettingsTab(pendingSettingsTab)} className="h-8 rounded-md bg-[var(--leemo-danger)] px-3 text-xs font-medium text-white">放弃修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
