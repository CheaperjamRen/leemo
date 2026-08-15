import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, FileText, Save, Trash2 } from "lucide-react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type {
  SearchCredentialDraft,
  SearchSourceId,
  SearchSourceStatus,
} from "../../bridge/contract";
import type { SearchSourcesState } from "../stores/search-sources";

type SourceDraft = { apiKey: string; engineId: string };

const SOURCE_GROUPS: Array<{
  label: string;
  sourceIds: SearchSourceId[];
}> = [
  { label: "默认来源", sourceIds: ["anysearch"] },
  { label: "中文增强", sourceIds: ["doubao", "metaso"] },
  {
    label: "更多来源",
    sourceIds: ["tavily", "bocha", "google", "exa", "brave", "serpapi", "serper", "bing", "firecrawl"],
  },
];

function ToggleRow({
  label,
  note,
  checked,
  disabled,
  indent,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  disabled?: boolean;
  indent?: boolean;
  onChange: (enabled: boolean) => void;
}): React.JSX.Element {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-center gap-3 py-2.5 ${
        indent ? "pl-7" : ""
      } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--leemo-amber)]"
        aria-label={label}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--leemo-ink)]">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--leemo-ink-3)]">{note}</span>
      </span>
    </label>
  );
}

function sourceStatus(source: SearchSourceStatus): string {
  if (source.blockedReason) return "暂不可用";
  if (source.keyless) return source.configured ? "开箱可用 · 已增强" : "开箱可用";
  return source.configured ? "已配置" : "可选";
}

function emptyDraft(): SourceDraft {
  return { apiKey: "", engineId: "" };
}

export function SearchSourcesSection({
  store,
  webEnabled,
  webSearchEnabled,
  webFetchEnabled,
  onToggleWeb,
  onToggleSearch,
  onToggleFetch,
}: {
  store: StoreApi<SearchSourcesState>;
  webEnabled: boolean;
  webSearchEnabled: boolean;
  webFetchEnabled: boolean;
  onToggleWeb: (enabled: boolean) => void;
  onToggleSearch: (enabled: boolean) => void;
  onToggleFetch: (enabled: boolean) => void;
}): React.JSX.Element {
  const {
    list,
    status,
    error,
    saving,
    saveError,
    refresh,
    saveCredentials,
  } = useStore(store);
  const [openSource, setOpenSource] = useState<SearchSourceId | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SearchSourceId, SourceDraft>>>({});
  const [validationError, setValidationError] = useState<Partial<Record<SearchSourceId, string>>>({});
  const [confirmClear, setConfirmClear] = useState<SearchSourceId | null>(null);

  useEffect(() => {
    if (status === "idle") void refresh();
  }, [status, refresh]);

  const sourcesById = useMemo(
    () => new Map(list.map((source) => [source.id, source])),
    [list],
  );

  const updateDraft = (id: SearchSourceId, patch: Partial<SourceDraft>): void => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? emptyDraft()), ...patch },
    }));
    setValidationError((current) => ({ ...current, [id]: undefined }));
  };

  const submit = async (source: SearchSourceStatus): Promise<void> => {
    const draft = drafts[source.id] ?? emptyDraft();
    const apiKey = draft.apiKey.trim();
    const engineId = draft.engineId.trim();
    let request: SearchCredentialDraft;

    if (source.id === "google") {
      if (!apiKey || !engineId) {
        setValidationError((current) => ({
          ...current,
          google: "API Key 和搜索引擎 ID 需要一起填写。",
        }));
        return;
      }
      request = { source: source.id, apiKey, engineId };
    } else {
      if (!apiKey) {
        setValidationError((current) => ({ ...current, [source.id]: "请填写 API Key。" }));
        return;
      }
      request = { source: source.id, apiKey };
    }

    const ok = await saveCredentials(request);
    if (ok) {
      setDrafts((current) => ({ ...current, [source.id]: emptyDraft() }));
      setValidationError((current) => ({ ...current, [source.id]: undefined }));
    }
  };

  const clear = async (source: SearchSourceStatus): Promise<void> => {
    const request: SearchCredentialDraft = source.id === "google"
      ? { source: source.id, apiKey: "", engineId: "" }
      : { source: source.id, apiKey: "" };
    const ok = await saveCredentials(request);
    if (ok) {
      setConfirmClear(null);
      setDrafts((current) => ({ ...current, [source.id]: emptyDraft() }));
    }
  };

  const renderSource = (source: SearchSourceStatus): React.JSX.Element => {
    const blocked = !!source.blockedReason;
    const isOpen = openSource === source.id;
    const draft = drafts[source.id] ?? emptyDraft();
    const sourceError = validationError[source.id] ?? saveError[source.id];
    const isSaving = saving[source.id] === true;

    return (
      <div key={source.id} className="bg-white">
        <button
          type="button"
          aria-label={blocked ? `${source.label} 暂不可用` : `配置 ${source.label}`}
          aria-expanded={blocked ? false : isOpen}
          disabled={blocked}
          onClick={() => {
            if (blocked) return;
            setOpenSource(isOpen ? null : source.id);
            setConfirmClear(null);
          }}
          className={`flex min-h-16 w-full items-center justify-between gap-4 px-1 py-3 text-left ${
            blocked ? "cursor-not-allowed opacity-65" : "hover:bg-[var(--leemo-work-hover)]"
          }`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--leemo-ink)]">{source.label}</span>
              <span className={`text-[11px] ${source.configured || source.keyless ? "text-emerald-700" : "text-[var(--leemo-ink-3)]"}`}>
                {sourceStatus(source)}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">
              {source.blockedReason ?? source.note}
            </p>
          </div>
          {!blocked && (
            <ChevronDown
              aria-hidden="true"
              size={16}
              strokeWidth={1.8}
              className={`shrink-0 text-[var(--leemo-ink-3)] transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>

        {isOpen && !blocked && (
          <div className="border-t border-[var(--leemo-line-soft)] bg-[#FCFCFB] px-3 py-4 sm:px-4">
            <div className={`grid gap-3 ${source.id === "google" ? "sm:grid-cols-2" : ""}`}>
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-[var(--leemo-ink-2)]">
                  {source.id === "google" ? "Google API Key" : `${source.label} API Key`}
                </span>
                <input
                  type="password"
                  aria-label={source.id === "google" ? "Google API Key" : `${source.label} API Key`}
                  autoComplete="off"
                  value={draft.apiKey}
                  onChange={(event) => updateDraft(source.id, { apiKey: event.target.value })}
                  placeholder={source.configured ? "输入新 Key 以替换" : "粘贴 API Key"}
                  className="h-10 w-full rounded-md border border-[var(--leemo-line)] bg-white px-3 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                />
              </label>

              {source.id === "google" && (
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-[var(--leemo-ink-2)]">Google 搜索引擎 ID</span>
                  <input
                    type="text"
                    aria-label="Google 搜索引擎 ID"
                    autoComplete="off"
                    value={draft.engineId}
                    onChange={(event) => updateDraft(source.id, { engineId: event.target.value })}
                    placeholder={source.configured ? "输入新 ID 以替换" : "例如 cx 标识"}
                    className="h-10 w-full rounded-md border border-[var(--leemo-line)] bg-white px-3 text-sm text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                  />
                </label>
              )}
            </div>

            {source.id === "google" && source.configured && (
              <p className="mt-2 text-[11px] leading-5 text-[var(--leemo-ink-3)]">
                更换配置时，需要同时重新填写这两项。
              </p>
            )}

            {sourceError && (
              <p role="alert" className="mt-2 text-xs leading-5 text-[var(--leemo-danger,#B42318)]">
                {sourceError}
              </p>
            )}

            {confirmClear === source.id ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--leemo-line-soft)] pt-3">
                <p className="text-xs text-[var(--leemo-ink-2)]">确定清除 {source.label}？</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(null)}
                    className="h-8 px-2.5 text-xs text-[var(--leemo-ink-2)] hover:text-[var(--leemo-ink)]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    aria-label="确认清除"
                    disabled={isSaving}
                    onClick={() => void clear(source)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--leemo-danger,#B42318)] px-2.5 text-xs text-[var(--leemo-danger,#B42318)] disabled:opacity-50"
                  >
                    <Trash2 aria-hidden="true" size={13} />
                    确认清除
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--leemo-line-soft)] pt-3">
                <div>
                  {source.configured && (
                    <button
                      type="button"
                      aria-label={`清除 ${source.label} 配置`}
                      onClick={() => setConfirmClear(source.id)}
                      className="inline-flex h-8 items-center gap-1.5 px-1 text-xs text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger,#B42318)]"
                    >
                      <Trash2 aria-hidden="true" size={13} />
                      清除配置
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`保存 ${source.label}`}
                  disabled={isSaving}
                  onClick={() => void submit(source)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#171717] px-3 text-xs font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  <Save aria-hidden="true" size={14} />
                  {isSaving ? "保存中…" : "保存"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="mb-9">
      <div className="mb-4">
        <h2 className="text-xl font-medium text-[var(--leemo-ink)]">联网与浏览</h2>
        <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--leemo-ink-3)]">
          默认搜索不需要配置。你也可以添加更适合中文或特定地区的来源，momo 会在需要时自动选择。
        </p>
      </div>

      <div className="mb-7 divide-y divide-[var(--leemo-line-soft)] border-y border-[var(--leemo-line)]">
        <ToggleRow
          label="允许联网"
          note="总开关。关闭后 momo 只使用本地信息。"
          checked={webEnabled}
          onChange={onToggleWeb}
        />
        <ToggleRow
          label="联网搜索"
          note="需要新信息时搜索公开网页与学术资料。"
          checked={webEnabled && webSearchEnabled}
          disabled={!webEnabled}
          indent
          onChange={onToggleSearch}
        />
        <ToggleRow
          label="读取网页"
          note="打开搜索结果或你发来的网页链接并读取内容。"
          checked={webEnabled && webFetchEnabled}
          disabled={!webEnabled}
          indent
          onChange={onToggleFetch}
        />
      </div>

      {status === "loading" && (
        <p className="py-3 text-xs text-[var(--leemo-ink-3)]">正在读取搜索来源…</p>
      )}
      {status === "error" && (
        <p role="alert" className="border-y border-[var(--leemo-line)] py-3 text-xs text-[var(--leemo-danger,#B42318)]">
          读不出搜索来源：{error}
        </p>
      )}

      {status === "ready" && SOURCE_GROUPS.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="mb-6">
          <p className="mb-2 text-[11px] font-medium text-[var(--leemo-ink-3)]">{group.label}</p>
          <div className="divide-y divide-[var(--leemo-line-soft)] border-y border-[var(--leemo-line)]">
            {group.sourceIds.map((id) => {
              const source = sourcesById.get(id);
              return source ? renderSource(source) : null;
            })}
          </div>
        </div>
      ))}

      {status === "ready" && (
        <div role="group" aria-label="学术检索" className="mb-6">
          <p className="mb-2 text-[11px] font-medium text-[var(--leemo-ink-3)]">学术检索</p>
          <div className="flex min-h-16 items-center justify-between gap-4 border-y border-[var(--leemo-line)] py-3">
            <div className="flex min-w-0 items-center gap-3">
              <FileText aria-hidden="true" size={17} className="shrink-0 text-[var(--leemo-ink-3)]" />
              <div>
                <p className="text-sm font-medium text-[var(--leemo-ink)]">arXiv</p>
                <p className="mt-1 text-xs text-[var(--leemo-ink-3)]">论文问题时自动使用</p>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-emerald-700">
              <Check aria-hidden="true" size={13} />
              已内置
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
