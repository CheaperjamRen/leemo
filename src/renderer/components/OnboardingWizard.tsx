import { useContext, useEffect, useMemo, useState } from "react";
import { Check, Circle } from "lucide-react";
import { useStore } from "zustand";
import type { ProviderDraft } from "../../bridge/contract";
import { mergeCapabilityProbeResults } from "../../bridge/model-capabilities";
import { BridgeContext, useWorkspace, type BridgeStores } from "../bridge/context";
import MomoAvatar from "./momo/MomoAvatar";

type SetupStage = "connect" | "ready";

export function OnboardingWizard(): React.JSX.Element | null {
  const stores = useContext(BridgeContext) as BridgeStores;
  const workspace = useWorkspace();
  const { settings, providers, ui, notebooks, fileTree } = stores;
  const wizardOpen = useStore(ui, (state) => state.wizardOpen);
  const closeWizard = useStore(ui, (state) => state.closeWizard);
  const openWizard = useStore(ui, (state) => state.openWizard);
  const onboardingCompleted = useStore(settings, (state) => state.onboardingCompleted);
  const completeOnboarding = useStore(settings, (state) => state.completeOnboarding);
  const setMode = useStore(settings, (state) => state.setMode);
  const setDefaultModel = useStore(settings, (state) => state.setDefaultModel);
  const providerStatus = useStore(providers, (state) => state.status);
  const providerList = useStore(providers, (state) => state.list);
  const configuredProviders = useStore(providers, (state) => state.configured);
  const refreshProviders = useStore(providers, (state) => state.refresh);
  const testConnection = useStore(providers, (state) => state.testConnection);
  const saveProvider = useStore(providers, (state) => state.saveProvider);

  const [stage, setStage] = useState<SetupStage>("connect");
  const [selectedProviderId, setSelectedProviderId] = useState("deepseek");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starterReady, setStarterReady] = useState(false);
  const [savedProviderName, setSavedProviderName] = useState("");

  // First run stays intentionally short: show curated domestic providers that
  // already have a usable default model. Aggregators and local servers need
  // model discovery, so their complete journey lives in Settings.
  const setupProviders = useMemo(
    () => providerList.filter((provider) =>
      provider.category === "cn_official"
      && provider.authMode === "api-key"
      && provider.models.length > 0),
    [providerList],
  );

  useEffect(() => {
    if (onboardingCompleted) return;
    if (providerStatus === "error" || (providerStatus === "ready" && configuredProviders.length === 0)) {
      openWizard();
    }
  }, [configuredProviders.length, onboardingCompleted, openWizard, providerStatus]);

  const selectedProvider = useMemo(
    () => setupProviders.find((provider) => provider.id === selectedProviderId)
      ?? setupProviders.find((provider) => provider.kind === "deepseek")
      ?? setupProviders[0],
    [selectedProviderId, setupProviders],
  );

  const selectedModel = selectedProvider?.models.includes(selectedModelId)
    ? selectedModelId
    : selectedProvider?.models[0] ?? "";

  const draft = useMemo<ProviderDraft | null>(() => {
    if (!selectedProvider) return null;
    return {
      id: selectedProvider.id,
      kind: selectedProvider.kind,
      name: selectedProvider.name,
      baseUrl: selectedProvider.baseUrl,
      apiFormat: selectedProvider.apiFormat,
      authMode: selectedProvider.authMode,
      category: selectedProvider.category,
      apiKey: apiKey.trim(),
      models: [...selectedProvider.models],
      modelCapabilities: selectedProvider.modelCapabilities
        ? { ...selectedProvider.modelCapabilities }
        : undefined,
      capabilities: { ...selectedProvider.capabilities },
      apiKeyUrl: selectedProvider.apiKeyUrl,
    };
  }, [apiKey, selectedProvider]);

  if (!wizardOpen) return null;

  const chooseProvider = (providerId: string) => {
    const provider = providerList.find((candidate) => candidate.id === providerId);
    setSelectedProviderId(providerId);
    setSelectedModelId(provider?.models[0] ?? "");
    setApiKey("");
    setError(null);
  };

  const handleConnect = async () => {
    if (!draft || !selectedModel || !apiKey.trim() || working) return;
    setWorking(true);
    setError(null);
    try {
      const testResult = await testConnection({ draft, modelId: selectedModel });
      if (!testResult.ok) {
        setError(
          testResult.error?.message ?? "连接测试没通过，请检查后重试。",
        );
        return;
      }

      const testedDraft = testResult.capabilityProbes
        ? {
            ...draft,
            modelCapabilityEvidence: mergeCapabilityProbeResults(
              draft.modelCapabilityEvidence,
              selectedModel,
              testResult.capabilityProbes,
            ),
          }
        : draft;
      const saved = await saveProvider(testedDraft);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setMode("buddy");
      setDefaultModel(saved.spec.id, selectedModel);
      setSavedProviderName(saved.spec.name);

      if (workspace) {
        try {
          await workspace.ensureStarterNotebook();
          await Promise.all([
            notebooks.getState().refresh(),
            fileTree.getState().refresh(),
          ]);
          setStarterReady(true);
        } catch {
          setStarterReady(false);
        }
      }
      setStage("ready");
    } finally {
      setWorking(false);
    }
  };

  const leaveForLater = () => {
    setStage("connect");
    setError(null);
    closeWizard();
  };

  const enterChat = () => {
    completeOnboarding();
    closeWizard();
    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入消息"]')?.focus();
    }, 0);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#ECEDEF] p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="首次设置"
    >
      <div className="flex h-[min(680px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] overflow-hidden rounded-lg border border-black/10 bg-white shadow-2xl sm:h-[min(680px,calc(100vh-48px))] sm:w-[min(980px,calc(100vw-48px))]">
        <aside className="hidden w-[320px] shrink-0 flex-col justify-between border-r border-[#E7E2DC] bg-[#FFF9F4] p-9 md:flex">
          <div>
            <p className="text-[15px] font-semibold text-[#1D1D1F]">Leemo</p>
            <p className="mt-1 text-xs text-[#8A817A]">你的 AI 搭子与本地工作台</p>
          </div>
          <div>
            <MomoAvatar size={104} />
            <p className="mt-7 text-[18px] font-medium leading-8 text-[#262321]">
              先把模型接好，<br />剩下的交给我。
            </p>
            <p className="mt-3 text-[13px] leading-6 text-[#756D67]">
              Key 只会保存在这台电脑的系统加密存储中。
            </p>
          </div>
          <p className="text-[11px] leading-5 text-[#A09891]">默认从搭子态开始，随时可以切到工作台。</p>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-7 sm:px-10 sm:py-9">
          {stage === "connect" ? (
            <div className="mx-auto flex min-h-full max-w-[560px] flex-col">
              <header className="mb-7 flex items-start justify-between gap-5">
                <div>
                  <p className="text-[11px] font-medium text-[var(--leemo-amber)]">第 1 步，共 2 步</p>
                  <h1 className="mt-2 text-[24px] font-semibold text-[#18181A]">让 momo 跑起来</h1>
                  <p className="mt-2 text-[13px] leading-6 text-[#6B6F76]">选择一家模型供应商，贴入 API Key，测通后就能开始。</p>
                </div>
                <button
                  type="button"
                  onClick={leaveForLater}
                  className="shrink-0 text-xs text-[#8B8F95] hover:text-[#33363A]"
                >
                  稍后配置
                </button>
              </header>

              {providerStatus === "loading" ? (
                <div role="status" className="py-16 text-center text-sm text-[#777B82]">正在读取可用模型…</div>
              ) : providerStatus === "error" ? (
                <div className="border-y border-[#E2E4E7] py-8 text-center">
                  <p role="alert" className="text-sm text-[#B42318]">模型列表没有读出来。</p>
                  <button
                    type="button"
                    onClick={() => void refreshProviders()}
                    className="mt-4 rounded-md bg-[#1D1D1F] px-4 py-2 text-sm font-medium text-white"
                  >
                    重试
                  </button>
                </div>
              ) : (
                <>
                  <section aria-label="模型供应商">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {setupProviders.map((provider) => {
                        const chosen = provider.id === selectedProvider?.id;
                        const recommended = provider.kind === "deepseek";
                        return (
                          <button
                            key={provider.id}
                            type="button"
                            aria-pressed={chosen}
                            onClick={() => chooseProvider(provider.id)}
                            className={`relative min-h-[76px] rounded-md border px-3 py-3 text-left transition-colors ${
                              chosen
                                ? "border-[var(--leemo-amber)] bg-[var(--leemo-amber-bg)]"
                                : "border-[#DEDFE1] bg-white hover:border-[#B8BBC0]"
                            }`}
                          >
                            <span className="block truncate text-[13px] font-medium text-[#242426]">{provider.name}</span>
                            <span className="mt-1 block text-[10.5px] text-[#8B8F95]">{provider.models.length} 个预置模型</span>
                            {recommended && (
                              <span className="absolute right-2 top-2 text-[9.5px] font-medium text-[var(--leemo-amber)]">推荐</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="mt-7 space-y-5 border-t border-[#ECEDEF] pt-6">
                    <label className="block">
                      <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-medium text-[#3B3D42]">
                        API Key
                        {selectedProvider?.apiKeyUrl && (
                          <a
                            href={selectedProvider.apiKeyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-normal text-[var(--leemo-amber-strong)] underline decoration-[var(--leemo-amber-line)] underline-offset-2"
                          >
                            去 {selectedProvider.name} 获取 API Key ↗
                          </a>
                        )}
                      </span>
                      <input
                        type="password"
                        aria-label="API Key"
                        autoComplete="off"
                        spellCheck={false}
                        value={apiKey}
                        disabled={working}
                        onChange={(event) => { setApiKey(event.target.value); setError(null); }}
                        placeholder="粘贴你的 API Key"
                        className="h-11 w-full rounded-md border border-[#D9DBDE] bg-white px-3 text-sm text-[#202124] outline-none placeholder:text-[#A2A6AC] focus:border-[var(--leemo-amber)] focus:ring-2 focus:ring-[var(--leemo-focus)] disabled:bg-[#F5F6F7]"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-[#3B3D42]">用于对话的模型</span>
                      <select
                        aria-label="用于对话的模型"
                        value={selectedModel}
                        disabled={working || !selectedProvider}
                        onChange={(event) => { setSelectedModelId(event.target.value); setError(null); }}
                        className="h-11 w-full rounded-md border border-[#D9DBDE] bg-white px-3 text-sm text-[#202124] outline-none focus:border-[var(--leemo-amber)]"
                      >
                        {(selectedProvider?.models ?? []).map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    </label>

                    {error && (
                      <p role="alert" className="rounded-md border border-[#F5C2BE] bg-[#FFF5F4] px-3 py-2.5 text-xs leading-5 text-[#B42318]">
                        {error}
                      </p>
                    )}
                  </section>

                  <div className="mt-auto pt-7">
                    <button
                      type="button"
                      onClick={() => void handleConnect()}
                      disabled={working || !draft || !selectedModel || !apiKey.trim()}
                      className="h-11 w-full rounded-md bg-[#1D1D1F] text-sm font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {working ? "正在测试连接…" : "测试并继续"}
                    </button>
                    <p className="mt-2 text-center text-[10.5px] text-[#969AA1]">会发送一次最小测试请求，可能产生极少量模型费用。</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center text-center">
              <p className="text-[11px] font-medium text-[#248A52]">第 2 步，共 2 步</p>
              <div className="mt-6"><MomoAvatar size={112} /></div>
              <h1 className="mt-7 text-[26px] font-semibold text-[#18181A]">momo 已经准备好了</h1>
              <p className="mt-3 text-sm text-[#666A70]">{savedProviderName} · {selectedModel}</p>
              <div className="mt-7 w-full max-w-[390px] border-y border-[#E5E6E8] py-4 text-left text-[12.5px] leading-6 text-[#5F6368]">
                <p className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-[#248A52]" aria-hidden /> 模型连接已验证</p>
                <p className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-[#248A52]" aria-hidden /> 默认从搭子态开始</p>
                <p className="flex items-center gap-2">
                  {starterReady
                    ? <Check className="h-4 w-4 shrink-0 text-[#248A52]" aria-hidden />
                    : <Circle className="h-3.5 w-3.5 shrink-0 text-[#969AA1]" aria-hidden />}
                  {starterReady ? "示例本子「例：高等数学」已放进工作台" : "示例本子稍后可在工作台创建"}
                </p>
              </div>
              <button
                type="button"
                onClick={enterChat}
                className="mt-8 h-11 w-full max-w-[390px] rounded-md bg-[var(--leemo-amber)] text-sm font-medium text-white hover:bg-[var(--leemo-amber-strong)]"
              >
                和 momo 说第一句
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
