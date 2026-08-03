import { useStore } from "zustand";
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
import type { ConnectionTestResult, ProviderSpec } from "../../bridge/contract";
import { orderConfiguredProviders } from "../components/model-picker";

type SettingsTabId = "general" | "models" | "usage" | "personalization" | "connectors" | "permissions";

const SETTINGS_TABS: { id: SettingsTabId; label: string; number: string; keywords: string }[] = [
  { id: "general", label: "通用", number: "01", keywords: "通用 模式 搭子 工作台 启动" },
  { id: "models", label: "模型", number: "02", keywords: "模型 provider 供应商 api key base url 服务地址 协议 快速任务 后台任务 子任务模型 自动推荐 自动继承 模型发现地址 请求头 header 高级设置" },
  { id: "usage", label: "用量", number: "03", keywords: "用量 费用 token 余额 消耗 账单 今天 近7天" },
  { id: "personalization", label: "个性化", number: "04", keywords: "个性化 momo 人设 话风 记忆 自动记忆" },
  { id: "connectors", label: "连接器", number: "05", keywords: "连接器 mcp 浏览器 playwright 联网 搜索 websearch webfetch" },
  { id: "permissions", label: "权限", number: "06", keywords: "权限 审批 永久允许 危险 计划 完全访问 少打扰" },
];

const SETTINGS_SECTION_TO_TAB: Record<string, SettingsTabId> = {
  general: "general",
  models: "models",
  usage: "usage",
  momo: "personalization",
  web: "connectors",
  extensions: "connectors",
  permissions: "permissions",
};

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
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
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
    talkStyle,
    permissionMode,
    dangerousCommandCaching,
    webEnabled,
    webSearchEnabled,
    webFetchEnabled,
    rememberMode,
    setMode,
    setPersonaCard,
    upsertPersonaCard,
    deletePersonaCard,
    setTalkStyle,
    setPermissionMode,
    setDangerousCommandCaching,
    setWebEnabled,
    setWebSearchEnabled,
    setWebFetchEnabled,
    setRememberMode,
  } = useStore(settings);
  const {
    configured: configuredProviders,
    balances,
    fetchBalance,
  } = useStore(providers);
  const { contextHint, clearContextHint, closeSettings, setView } = useStore(stores.ui);
  const notebooks = useStore(stores.notebooks, (state) => state.list);
  const workspaceList = useStore(stores.workspaces!, (state) => state.list);
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

  return (
    <div className="settings-page relative flex h-full min-h-0 flex-col bg-[var(--leemo-bg)]" style={settingsStyle}>
      <header className="flex h-16 shrink-0 items-center border-b border-[var(--leemo-line)] bg-white px-6 pr-16">
        <h1 className="text-lg font-medium text-[var(--leemo-ink)]">设置</h1>
        {contextHint !== null && (
          <p data-testid="context-hint" className="ml-auto text-xs text-[var(--leemo-amber-ink)]">
            {contextHint.count > 0
              ? `已保存 · ${contextHint.count} 个对话下一轮起生效`
              : "已保存"}
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside className="w-full shrink-0 border-b border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-4 sm:w-52 sm:border-b-0 sm:border-r">
          <input
            type="search"
            value={settingsQuery}
            onChange={(event) => updateSettingsQuery(event.target.value)}
            disabled={providerBusy}
            placeholder="搜索设置"
            aria-label="搜索设置"
            className="mb-4 w-full rounded-md border border-[var(--leemo-line)] bg-white px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)]"
          />
          <nav role="tablist" aria-label="设置分类" aria-orientation="vertical" className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
            {visibleTabs.map((tab) => (
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
                className={`flex min-w-max items-center gap-3 border-l-2 px-3 py-2.5 text-left text-sm transition-colors sm:w-full ${
                  activeTab === tab.id
                    ? "border-[var(--leemo-amber)] bg-white font-medium text-[var(--leemo-ink)]"
                    : "border-transparent text-[var(--leemo-ink-2)] hover:bg-white hover:text-[var(--leemo-ink)]"
                }`}
              >
                <span className="w-5 shrink-0 text-[10px] tabular-nums text-[var(--leemo-ink-3)]">{tab.number}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
          {visibleTabs.length === 0 && <p className="px-2 py-3 text-xs text-[var(--leemo-ink-3)]">没有匹配的设置</p>}
        </aside>

        <main
          id={`settings-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className={`min-h-0 min-w-0 flex-1 bg-white px-5 py-6 sm:px-8 sm:py-7 ${
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
          {activeTab === "general" && <section className="mb-8">
        <h2 className="mb-4 text-xl font-medium text-[var(--leemo-ink)]">基调模式</h2>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer hover:bg-[var(--leemo-work-hover)] p-2 rounded">
            <input
              type="radio"
              name="persona"
              value="buddy"
              checked={mode === "buddy"}
              onChange={() => setMode("buddy")}
              className="w-4 h-4"
            />
            <span className="text-sm text-[var(--leemo-ink)]">搭子态（momo 陪伴）</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer hover:bg-[var(--leemo-work-hover)] p-2 rounded">
            <input
              type="radio"
              name="persona"
              value="workbench"
              checked={mode === "workbench"}
              onChange={() => setMode("workbench")}
              className="w-4 h-4"
            />
            <span className="text-sm text-[var(--leemo-ink)]">工作台态（专业工具）</span>
          </label>
        </div>
          </section>}

          {/* 人设卡片 */}
          {activeTab === "personalization" && <section className="mb-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xl font-medium text-[var(--leemo-ink)]">人设卡片</h2>
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
                    人设描述
                    <textarea
                      aria-label="人设描述"
                      maxLength={2000}
                      rows={4}
                      value={personaDraft.promptText}
                      onChange={(event) => setPersonaDraft({ ...personaDraft, promptText: event.target.value })}
                      className="mt-1 w-full resize-y rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2 text-sm leading-6 text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                    />
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

          {activeTab === "usage" && <section id="settings-usage" className="mb-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-medium text-[var(--leemo-ink)]">用量与费用</h2>
          <div className="inline-flex overflow-hidden rounded-md border border-[var(--leemo-line)]" aria-label="用量范围">
            {(["today", "last7d"] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => void usage.refresh(range)}
                className={`px-3 py-1.5 text-xs ${usage.range === range ? "bg-[var(--leemo-ink)] text-white" : "bg-white text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-work-hover)]"}`}
              >
                {range === "today" ? "今天" : "近 7 天"}
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
        ) : usage.summary ? (
          <div>
            <div className="border-y border-[var(--leemo-line)] py-4">
              <p className="text-xs text-[var(--leemo-ink-3)]">可计价费用</p>
              <p className="mt-1 text-2xl font-medium tabular-nums text-[var(--leemo-ink)]">
                {usage.summary.totalCostUsd === undefined ? "未定价" : `US$${usage.summary.totalCostUsd}`}
              </p>
            </div>
            {usage.summary.byProvider.length === 0 ? (
              <p className="py-4 text-xs text-[var(--leemo-ink-3)]">这个时间段还没有用量</p>
            ) : (
              <div className="divide-y divide-[var(--leemo-line)]">
                {usage.summary.byProvider.map((provider) => (
                  <div key={provider.providerId} className="flex items-center justify-between gap-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-[var(--leemo-ink)]">{provider.providerId}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-[var(--leemo-ink-3)]">
                        {provider.inputTokens} 输入 · {provider.outputTokens} 输出
                      </p>
                    </div>
                    <span className="tabular-nums text-[var(--leemo-ink-2)]">
                      {provider.costUsd === undefined ? "未定价" : `US$${provider.costUsd}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

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

          {/* 权限策略 */}
          {activeTab === "permissions" && <section className="mb-8">
        <h2 className="mb-4 text-xl font-medium text-[var(--leemo-ink)]">权限策略</h2>
        <div className="space-y-3">
          <div>
            <p className="mb-2 block text-sm text-[var(--leemo-ink-2)]">任务执行方式</p>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-[var(--leemo-work-hover)]">
                <input
                  type="radio"
                  name="permissionMode"
                  value="default"
                  checked={permissionMode === "default"}
                  onChange={() => setPermissionMode("default")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm text-[var(--leemo-ink)]">每次操作都确认</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">除读取和已开启的内置能力外，执行前都先询问。</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-[var(--leemo-work-hover)]">
                <input
                  type="radio"
                  name="permissionMode"
                  value="acceptEdits"
                  checked={permissionMode === "acceptEdits"}
                  onChange={() => setPermissionMode("acceptEdits")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium text-[var(--leemo-ink)]">任务中少打扰 <span className="font-normal text-[var(--leemo-amber-strong)]">推荐</span></span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">直接读取和编辑本地文件；需要执行命令时可一次授权当前任务。</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-[var(--leemo-work-hover)]">
                <input
                  type="radio"
                  name="permissionMode"
                  value="plan"
                  checked={permissionMode === "plan"}
                  onChange={() => setPermissionMode("plan")}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block text-sm text-[var(--leemo-ink)]">只规划，不执行</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">momo 可以阅读和制定方案，但不会修改文件或执行操作。</span>
                </span>
              </label>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-3 border-y border-[var(--leemo-line)] py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className={`text-sm font-medium ${permissionMode === "bypassPermissions" ? "text-[var(--leemo-danger)]" : "text-[var(--leemo-ink)]"}`}>
                {permissionMode === "bypassPermissions" ? "完全访问已开启" : "完全访问"}
              </p>
              <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--leemo-ink-3)]">
                开启后跨任务和重启保留，momo 不再逐项询问；你可以随时在这里或输入框旁关闭。
              </p>
            </div>
            {permissionMode === "bypassPermissions" ? (
              <button
                type="button"
                onClick={() => setPermissionMode("acceptEdits")}
                className="shrink-0 rounded-md bg-[var(--leemo-ink)] px-3 py-1.5 text-xs font-medium text-white"
              >
                关闭完全访问
              </button>
            ) : (
              <button
                type="button"
                onClick={() => requestRiskConfirmation("bypass")}
                className="shrink-0 rounded-md border border-[var(--leemo-danger-line)] px-3 py-1.5 text-xs font-medium text-[var(--leemo-danger)] hover:bg-[var(--leemo-danger-soft)]"
              >
                开启完全访问
              </button>
            )}
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
                  <label className="flex cursor-pointer flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className={`block text-sm font-medium ${dangerousCommandCaching ? "text-[var(--leemo-danger)]" : "text-[var(--leemo-ink)]"}`}>
                        记住危险操作授权
                      </span>
                      <span className="mt-1 block max-w-xl text-xs leading-5 text-[var(--leemo-ink-3)]">
                        开启后，同一条高风险命令可在本次任务内不再询问；不会跨任务放行。
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      aria-label="记住危险操作授权"
                      checked={dangerousCommandCaching}
                      onChange={(event) => {
                        if (event.target.checked) requestRiskConfirmation("dangerous-cache");
                        else setDangerousCommandCaching(false);
                      }}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
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
