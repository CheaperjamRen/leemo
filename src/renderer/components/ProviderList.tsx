import { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  CircleCheck,
  GripVertical,
  LoaderCircle,
  Plus,
  Search,
  Server,
  Star,
} from "lucide-react";
import type { ConnectionTestResult, ProviderSpec } from "../../bridge/contract";
import type { PresetOffer } from "./ProviderConfigForm";
import { ProviderBrandIcon } from "./ProviderBrandIcon";
import "./ProviderList.css";

type TestState = ConnectionTestResult | { pending: true };

export interface ProviderListProps {
  providers: ProviderSpec[];
  selectedId?: string;
  tests: Record<string, TestState>;
  onSelect: (providerId: string) => void;
  onOpenCatalog: () => void;
  onReorder: (orderedProviderIds: string[]) => void;
  disabled?: boolean;
}

function statusFor(provider: ProviderSpec, test: TestState | undefined): {
  label: string;
  detail?: string;
  tone: "idle" | "ok" | "error" | "pending";
} {
  if (test && "pending" in test) return { label: "测试中", tone: "pending" };
  if (test?.ok === true) {
    return {
      label: "已连接",
      detail: test.latencyMs === undefined ? undefined : `${test.latencyMs} ms`,
      tone: "ok",
    };
  }
  if (test?.ok === false) return { label: "需修复", tone: "error" };
  return provider.configured === true
    ? { label: "已配置", tone: "idle" }
    : provider.authMode === "oauth-subscription"
      ? { label: "待登录", tone: "error" }
    : provider.authMode === "none"
      ? { label: "待选模型", tone: "error" }
      : { label: "待补 Key", tone: "error" };
}

function StatusIcon({ tone }: { tone: ReturnType<typeof statusFor>["tone"] }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (tone === "pending") return <LoaderCircle className={`${className} leemo-spin text-[var(--leemo-amber)]`} aria-hidden />;
  if (tone === "error") return <CircleAlert className={`${className} text-[var(--leemo-danger)]`} aria-hidden />;
  if (tone === "ok") return <CircleCheck className={`${className} text-[var(--leemo-ok)]`} aria-hidden />;
  return <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--leemo-ink-3)]" aria-hidden />;
}

function moveProvider(ids: string[], sourceId: string, targetIndex: number): string[] {
  const sourceIndex = ids.indexOf(sourceId);
  if (sourceIndex < 0) return ids;
  const withoutSource = ids.filter((id) => id !== sourceId);
  const adjustedIndex = Math.max(0, Math.min(targetIndex, withoutSource.length));
  withoutSource.splice(adjustedIndex, 0, sourceId);
  return withoutSource;
}

const iconButtonClass = "grid h-6 w-6 place-items-center rounded text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-bg-deep)] hover:text-[var(--leemo-ink)] disabled:cursor-not-allowed disabled:opacity-25";

export function ProviderList({
  providers,
  selectedId,
  tests,
  onSelect,
  onOpenCatalog,
  onReorder,
  disabled = false,
}: ProviderListProps) {
  const dragProviderId = useRef<string | null>(null);
  const addedProviders = providers.filter((provider) => provider.configured === true || provider.saved === true);
  const ids = addedProviders
    .filter((provider) => provider.configured === true && provider.models.length > 0)
    .map((provider) => provider.id);

  const reorderBy = (providerId: string, delta: number) => {
    const index = ids.indexOf(providerId);
    if (index < 0) return;
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  return (
    <div className="provider-list flex h-[142px] min-h-0 w-full shrink-0 flex-col border-b border-[var(--leemo-line)] bg-[var(--leemo-bg)] lg:h-full lg:w-[244px] lg:border-b-0 lg:border-r">
      <div className="provider-list-header flex h-10 shrink-0 items-center justify-between border-b border-[var(--leemo-line)] px-3 lg:h-12">
        <span className="text-xs font-medium text-[var(--leemo-ink-2)]">已接入</span>
        {addedProviders.length > 0 ? (
          <button
            type="button"
            onClick={onOpenCatalog}
            disabled={disabled}
            aria-label="添加模型服务商"
            title="添加模型服务商"
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--leemo-ink-3)] hover:bg-white hover:text-[var(--leemo-ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        ) : <span className="h-7 w-7" aria-hidden />}
      </div>

      <div className="flex min-h-0 flex-1 overflow-x-auto py-1.5 lg:block lg:overflow-x-hidden lg:overflow-y-auto">
        {addedProviders.length === 0 ? (
          <div className="flex h-full min-w-[220px] flex-col items-center justify-center px-3 py-4 text-center lg:min-w-0">
            <Server className="h-5 w-5 text-[var(--leemo-ink-3)]" aria-hidden />
            <p className="mt-2 text-xs text-[var(--leemo-ink-3)]">还没有已接入的服务商</p>
            <button
              type="button"
              onClick={onOpenCatalog}
              disabled={disabled}
              className="mt-2 h-7 rounded-md border border-[var(--leemo-line)] bg-white px-2.5 text-[11px] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-ink-3)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              添加模型服务商
            </button>
          </div>
        ) : addedProviders.map((provider) => {
          const status = statusFor(provider, tests[provider.id]);
          const selected = provider.id === selectedId;
          const priorityIndex = ids.indexOf(provider.id);
          const canPrioritize = priorityIndex >= 0;
          const isDefault = priorityIndex === 0;
          return (
            <div
              key={provider.id}
              data-testid="provider-list-row"
              draggable={!disabled && canPrioritize}
              onDragStart={(event) => {
                if (disabled || !canPrioritize) return;
                dragProviderId.current = provider.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", provider.id);
              }}
              onDragEnd={() => { dragProviderId.current = null; }}
              onDragOver={(event) => {
                if (!disabled && canPrioritize) event.preventDefault();
              }}
              onDrop={(event) => {
                if (disabled || !canPrioritize) return;
                event.preventDefault();
                const sourceId = dragProviderId.current || event.dataTransfer.getData("text/plain");
                dragProviderId.current = null;
                if (!sourceId || sourceId === provider.id) return;
                const targetIndex = ids.filter((id) => id !== sourceId).indexOf(provider.id);
                onReorder(moveProvider(ids, sourceId, targetIndex));
              }}
              className={`relative flex h-[82px] w-[232px] shrink-0 border-r border-[var(--leemo-line-soft)] transition-colors lg:w-full lg:border-b lg:border-r-0 ${
                selected ? "bg-white" : "hover:bg-white/70"
              }`}
            >
              {selected && <span className="absolute inset-y-2 left-0 w-0.5 bg-[var(--leemo-amber)]" aria-hidden />}
              <button
                type="button"
                aria-label={`选择 ${provider.name}`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSelect(provider.id)}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 pr-1 text-left disabled:cursor-not-allowed disabled:opacity-55"
              >
                <ProviderBrandIcon kind={provider.kind} name={provider.name} compact />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[12.5px] font-medium text-[var(--leemo-ink)]">{provider.name}</span>
                    {isDefault && (
                      <span className="shrink-0 rounded border border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-bg)] px-1 py-px text-[9px] text-[var(--leemo-amber-ink)]">
                        默认
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex min-w-0 items-center gap-1 text-[10.5px] text-[var(--leemo-ink-3)]">
                    <StatusIcon tone={status.tone} />
                    <span className="shrink-0">{status.label}</span>
                    {status.detail && <span className="tabular-nums">{status.detail}</span>}
                  </span>
                  {provider.models[0] && (
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--leemo-ink-3)]" title={provider.models[0]}>
                      {provider.models[0]}
                    </span>
                  )}
                </span>
              </button>

              <div className="grid w-[52px] shrink-0 grid-cols-2 content-center gap-0.5 pr-1">
                <button type="button" disabled={disabled || !canPrioritize} aria-label={`拖动排序 ${provider.name}`} title="拖动排序" className={`${iconButtonClass} cursor-grab active:cursor-grabbing`}>
                  <GripVertical className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" disabled={disabled || !canPrioritize || isDefault} onClick={() => onReorder([provider.id, ...ids.filter((id) => id !== provider.id)])} aria-label={`设为默认 ${provider.name}`} title="设为默认" className={iconButtonClass}>
                  <Star className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" disabled={disabled || !canPrioritize || priorityIndex === 0} onClick={() => reorderBy(provider.id, -1)} aria-label={`上移 ${provider.name}`} title="上移" className={iconButtonClass}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button type="button" disabled={disabled || !canPrioritize || priorityIndex === ids.length - 1} onClick={() => reorderBy(provider.id, 1)} aria-label={`下移 ${provider.name}`} title="下移" className={iconButtonClass}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface ProviderOfferGridProps {
  providers: ProviderSpec[];
  onChoose: (offer: PresetOffer) => void;
  disabled?: boolean;
}

function presetProviders(providers: ProviderSpec[]): ProviderSpec[] {
  const byKind = new Map<string, ProviderSpec>();
  for (const provider of providers) {
    if (provider.category === "custom") continue;
    const current = byKind.get(provider.kind);
    if (!current || provider.id === provider.kind) byKind.set(provider.kind, provider);
  }
  return [...byKind.values()];
}

function offerFromProvider(provider: ProviderSpec): PresetOffer {
  return {
    ...(provider.configured === true ? {} : { id: provider.id }),
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    authMode: provider.authMode,
    ...(provider.productKind ? { productKind: provider.productKind } : {}),
    ...(provider.apiKeyUrl ? { apiKeyUrl: provider.apiKeyUrl } : {}),
    ...(provider.modelsUrl ? { modelsUrl: provider.modelsUrl } : {}),
    models: [...provider.models],
    ...(provider.modelCapabilities
      ? {
          modelCapabilities: Object.fromEntries(
            Object.entries(provider.modelCapabilities).map(([modelId, capabilities]) => [modelId, { ...capabilities }]),
          ),
        }
      : {}),
  };
}

function providerOfferSummary(provider: ProviderSpec): string {
  if (provider.authMode === "oauth-subscription") return "订阅登录 · 无需 API Key";
  if (provider.authMode === "none") return "本机运行 · 无需 API Key";
  if (provider.productKind === "coding-plan") return "已有套餐 · 使用套餐 Key";
  if (provider.productKind === "aggregator") return "聚合服务 · API Key 接入";
  if (provider.productKind === "self-hosted") return provider.summary ?? "部署服务 · 填写专属地址";
  if (provider.capabilities.requiresProxy) return "官方 API · 可能需要代理";
  return provider.category === "cn_official"
    ? "官方 API · 国内可直连"
    : "官方 API · API Key 接入";
}

export function ProviderOfferGrid({ providers, onChoose, disabled = false }: ProviderOfferGridProps) {
  const [query, setQuery] = useState("");
  const presets = presetProviders(providers);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return presets;
    return presets.filter((provider) => [
      provider.name,
      provider.kind,
      provider.summary ?? "",
      ...(provider.searchAliases ?? []),
      ...provider.models,
    ].join(" ").toLocaleLowerCase().includes(needle));
  }, [presets, query]);
  const groups = [
    { title: "已有订阅", providers: filtered.filter((provider) => provider.productKind === "consumer-subscription") },
    { title: "套餐与 Coding Plan", providers: filtered.filter((provider) => provider.productKind === "coding-plan") },
    { title: "国内官方", providers: filtered.filter((provider) => provider.category === "cn_official" && !provider.capabilities.local && (provider.productKind ?? "metered-api") === "metered-api") },
    { title: "国际官方", providers: filtered.filter((provider) => provider.category === "official" && !provider.capabilities.local && (provider.productKind ?? "metered-api") === "metered-api") },
    { title: "聚合与中转", providers: filtered.filter((provider) => provider.productKind === "aggregator") },
    { title: "本地与自部署", providers: filtered.filter((provider) => provider.productKind === "local" || provider.productKind === "self-hosted" || provider.capabilities.local) },
  ].filter((group) => group.providers.length > 0);
  return (
    <div className="leemo-provider-catalog h-full min-w-0 flex-1 overflow-y-auto p-5 sm:p-7" data-testid="provider-offer-grid">
      <div className="mx-auto max-w-5xl">
        <div className="leemo-provider-catalog__header mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="leemo-provider-catalog__eyebrow">添加模型服务商</p>
            <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.02em] text-[var(--leemo-ink)]">选择接入方式</h3>
          </div>
          <label className="leemo-provider-catalog__search">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input type="search" aria-label="搜索模型服务" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索服务商、套餐或模型" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--leemo-ink)] outline-none" />
          </label>
        </div>
        <div className="space-y-6">
          {groups.map((group) => (
            <section className="leemo-provider-group" key={group.title} aria-labelledby={`provider-group-${group.title}`}>
              <h4 id={`provider-group-${group.title}`} className="leemo-provider-group__title">{group.title}</h4>
              <div className="leemo-provider-offer-grid" data-layout="three-column">
                {group.providers.map((provider) => (
                  <button
                    key={provider.kind}
                    type="button"
                    data-testid="provider-offer-card"
                    data-density="compact"
                    aria-label={`配置 ${provider.name}`}
                    disabled={disabled}
                    onClick={() => onChoose(offerFromProvider(provider))}
                    className="leemo-provider-offer-card group"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <ProviderBrandIcon kind={provider.kind} name={provider.name} />
                      <span className="leemo-provider-offer-card__arrow">
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </span>
                    <span>
                      <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--leemo-ink)]">{provider.name}</span>
                      <span className="mt-1 block text-[10.5px] leading-[1.55] text-[var(--leemo-ink-3)]">
                        {providerOfferSummary(provider)}{provider.configured ? " · 可添加另一账号" : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}

          <section className="leemo-provider-group" aria-labelledby="provider-group-custom">
            <h4 id="provider-group-custom" className="leemo-provider-group__title">自定义</h4>
            <div className="leemo-provider-offer-grid" data-layout="three-column">
              <button
                type="button"
                data-testid="provider-offer-card"
                data-density="compact"
                aria-label="配置 自定义服务"
                disabled={disabled}
                onClick={() => onChoose({ kind: "custom", name: "自定义服务", baseUrl: "", apiFormat: "anthropic", authMode: "api-key", productKind: "self-hosted" })}
                className="leemo-provider-offer-card group border-dashed"
              >
                <span className="leemo-provider-brand">
                  <Plus className="h-4 w-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-[13px] font-medium text-[var(--leemo-ink)]">自定义服务</span>
                  <span className="mt-1 block text-[10.5px] leading-4 text-[var(--leemo-ink-3)]">接入兼容 Anthropic、OpenAI Chat 或 Responses 的服务</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
