import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  GripVertical,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Star,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { useProviders } from "../bridge/context";
import type {
  ConnectionTestResult,
  ListRemoteModelsResult,
  ModelCapabilities,
  ModelCapabilityEvidence,
  ProviderAuthMode,
  ProviderApiFormat,
  ProviderConfigView,
  ProviderDraft,
  ProviderProductKind,
  ProviderSpec,
  TaskModelRouting,
} from "../../bridge/contract";
import {
  clearUserCapabilityOverride,
  cloneModelCapabilityEvidenceMap,
  mergeCapabilityProbeResults,
  resolveCapabilityDisplay,
  setUserCapabilitySupported,
} from "../../bridge/model-capabilities";

export interface PresetOffer {
  id?: string;
  kind: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  authMode?: ProviderAuthMode;
  productKind?: ProviderProductKind;
  apiKeyUrl?: string;
  modelsUrl?: string;
  models?: string[];
  modelCapabilities?: Record<string, ModelCapabilities>;
}

export interface ProviderConfigFormProps {
  providerId?: string;
  preset?: PresetOffer;
  onSaved: (spec: ProviderSpec) => void;
  onCancel: () => void;
  onDelete?: () => Promise<void> | void;
  /** Search can reveal the technical section without introducing a second page. */
  revealAdvanced?: boolean;
  /** One-time legacy-default projection. The saved model order is authoritative. */
  preferredModelId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onTestStateChange?: (
    providerId: string,
    state: ConnectionTestResult | { pending: true } | undefined,
  ) => void;
  onBusyChange?: (busy: boolean) => void;
}

const READABLE_HEADER_NAMES = new Set([
  "accept",
  "content-type",
  "user-agent",
  "anthropic-version",
  "anthropic-beta",
  "http-referer",
  "x-title",
]);

interface HeaderRow {
  key: string;
  value: string;
  savedSecret: boolean;
}

interface ModelRow {
  id: string;
}

type TestState = ConnectionTestResult | { pending: true };
type RemoteState =
  | { pending: true }
  | { result: ListRemoteModelsResult };

interface ScopedState<T> {
  fingerprint: number;
  value: T;
}

function toHeaderRows(view: ProviderConfigView): HeaderRow[] {
  const readable = Object.entries(view.headers ?? {}).map(([key, value]) => ({
    key,
    value,
    savedSecret: false,
  }));
  const secret = (view.secretHeaderKeys ?? []).map((key) => ({ key, value: "", savedSecret: true }));
  return [...readable, ...secret];
}

function toModelRows(models: string[]): ModelRow[] {
  return models.map((id) => ({ id }));
}

function cloneCapabilities(value: Record<string, ModelCapabilities> | undefined) {
  return value
    ? Object.fromEntries(Object.entries(value).map(([id, capabilities]) => [id, { ...capabilities }]))
    : {};
}

function capabilitiesForModels(
  value: Record<string, ModelCapabilities>,
  models: ModelRow[],
): Record<string, ModelCapabilities> | undefined {
  const active = new Set(models.map((model) => model.id));
  const filtered = Object.fromEntries(
    Object.entries(value).filter(([modelId]) => active.has(modelId)).map(([modelId, capabilities]) => [modelId, { ...capabilities }]),
  );
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function evidenceForModels(
  value: Record<string, ModelCapabilityEvidence>,
  models: ModelRow[],
): Record<string, ModelCapabilityEvidence> | undefined {
  const active = new Set(models.map((model) => model.id));
  const filtered = Object.fromEntries(Object.entries(value).filter(([modelId]) => active.has(modelId)));
  return Object.keys(filtered).length > 0 ? cloneModelCapabilityEvidenceMap(filtered) : undefined;
}

function groupSnapshots(models: { id: string; displayName?: string; snapshotOf?: string }[]) {
  const bases = models.filter((model) => !model.snapshotOf);
  const orphans = models.filter(
    (model) => model.snapshotOf && !models.some((base) => base.id === model.snapshotOf),
  );
  return {
    bases: [...bases, ...orphans],
    snapshotsOf: (baseId: string) => models.filter((model) => model.snapshotOf === baseId),
  };
}

function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-[12px] font-medium text-[var(--leemo-ink-2)]">{children}</span>
      {hint && <span className="text-[10.5px] text-[var(--leemo-ink-3)]">{hint}</span>}
    </div>
  );
}

const inputClass = "h-9 w-full rounded-md border border-[var(--leemo-line)] bg-white px-3 text-[12.5px] text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)]";

function capabilityLabel(
  evidence: ModelCapabilityEvidence | undefined,
  presetHint: boolean | undefined,
  kind: "image" | "reasoning",
) {
  const display = resolveCapabilityDisplay(evidence?.[kind], presetHint);
  if (display.source === "user") return "用户已确认支持";
  if (display.status === "verified") return "已验证支持 · 自动探测";
  if (display.status === "failed") return "本次检测未通过 · 自动探测";
  return "未确认";
}

function moveModel(rows: ModelRow[], id: string, delta: number): ModelRow[] {
  const index = rows.findIndex((row) => row.id === id);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export default function ProviderConfigForm({
  providerId,
  preset,
  onSaved,
  onCancel,
  onDelete,
  revealAdvanced,
  preferredModelId,
  onDirtyChange,
  onTestStateChange,
  onBusyChange,
}: ProviderConfigFormProps) {
  const getConfig = useProviders((state) => state.getConfig);
  const saveProviderAction = useProviders((state) => state.saveProvider);
  const testConnectionAction = useProviders((state) => state.testConnection);
  const listRemoteModelsAction = useProviders((state) => state.listRemoteModels);
  const getLoginStatusAction = useProviders((state) => state.getLoginStatus);
  const loginProviderAction = useProviders((state) => state.loginProvider);
  const logoutProviderAction = useProviders((state) => state.logoutProvider);
  const loginStatuses = useProviders((state) => state.loginStatuses);

  const targetId = providerId ?? preset?.id;
  const [loading, setLoading] = useState(targetId !== undefined);
  const [existing, setExisting] = useState<ProviderConfigView | null>(null);
  const [kind, setKind] = useState(preset?.kind ?? "custom");
  const [name, setName] = useState(preset?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(preset?.baseUrl ?? "");
  const [apiFormat, setApiFormat] = useState<ProviderApiFormat>(preset?.apiFormat ?? "anthropic");
  const [authMode, setAuthMode] = useState<ProviderAuthMode>(preset?.authMode ?? "api-key");
  const [productKind, setProductKind] = useState<ProviderProductKind>(preset?.productKind ?? "self-hosted");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelRows, setModelRows] = useState<ModelRow[]>(() => toModelRows(preset?.models ?? []));
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, ModelCapabilities>>(
    () => cloneCapabilities(preset?.modelCapabilities),
  );
  const [modelCapabilityEvidence, setModelCapabilityEvidence] = useState<Record<string, ModelCapabilityEvidence>>(
    () => cloneModelCapabilityEvidenceMap(undefined) ?? {},
  );
  const [taskModelRouting, setTaskModelRouting] = useState<TaskModelRouting>({});
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([]);
  const [originalHeaderKeys, setOriginalHeaderKeys] = useState<string[]>([]);
  const [modelsUrl, setModelsUrl] = useState(preset?.modelsUrl ?? "");
  const [apiKeyUrl, setApiKeyUrl] = useState(preset?.apiKeyUrl ?? "");
  const [newModelName, setNewModelName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(revealAdvanced));
  const [expandedSnapshots, setExpandedSnapshots] = useState<Record<string, boolean>>({});
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [localTest, setLocalTest] = useState<ScopedState<TestState> | null>(null);
  const [localRemote, setLocalRemote] = useState<ScopedState<RemoteState> | null>(null);
  const mountedRef = useRef(true);
  const testGenerationRef = useRef(0);
  const remoteGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const draggedModelRef = useRef<string | null>(null);

  useEffect(() => {
    if (revealAdvanced) setAdvancedOpen(true);
  }, [revealAdvanced]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      testGenerationRef.current += 1;
      remoteGenerationRef.current += 1;
      saveGenerationRef.current += 1;
      if (targetId) onTestStateChange?.(targetId, undefined);
      onBusyChange?.(false);
    };
  }, [onBusyChange, onTestStateChange, targetId]);

  useEffect(() => {
    if (!targetId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getConfig(targetId).then((view) => {
      if (cancelled) return;
      setExisting(view);
      if (view) {
        const orderedModels = preferredModelId && view.models.includes(preferredModelId)
          ? [preferredModelId, ...view.models.filter((modelId) => modelId !== preferredModelId)]
          : view.models;
        const rows = toHeaderRows(view);
        setKind(view.kind);
        setName(view.name);
        setBaseUrl(view.baseUrl);
        setApiFormat(view.apiFormat);
        setAuthMode(view.authMode);
        setProductKind(view.productKind ?? "self-hosted");
        setModelRows(toModelRows(orderedModels));
        setModelCapabilities(cloneCapabilities(view.modelCapabilities));
        setModelCapabilityEvidence(cloneModelCapabilityEvidenceMap(view.modelCapabilityEvidence) ?? {});
        setTaskModelRouting(view.taskModelRouting ? { ...view.taskModelRouting } : {});
        setHeaderRows(rows);
        setOriginalHeaderKeys(rows.map((row) => row.key));
        setModelsUrl(view.modelsUrl ?? "");
        setApiKeyUrl(view.apiKeyUrl ?? preset?.apiKeyUrl ?? "");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [getConfig, preferredModelId, preset?.apiKeyUrl, targetId]);

  useEffect(() => {
    if (authMode !== "oauth-subscription" || !targetId) return;
    void getLoginStatusAction(targetId);
  }, [authMode, getLoginStatusAction, targetId]);

  const draft = useMemo<ProviderDraft>(() => {
    const headers: Record<string, string> = {};
    for (const row of headerRows) {
      const key = row.key.trim();
      if (!key || !row.value) continue;
      headers[key] = row.value;
    }
    const currentHeaderNames = new Set(headerRows.map((row) => row.key.trim().toLowerCase()).filter(Boolean));
    const removeHeaderKeys = originalHeaderKeys.filter((key) => !currentHeaderNames.has(key.toLowerCase()));
    const next: ProviderDraft = {
      kind,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiFormat,
      authMode,
      productKind,
      models: modelRows.map((row) => row.id),
      modelCapabilities: capabilitiesForModels(modelCapabilities, modelRows),
      modelCapabilityEvidence: evidenceForModels(modelCapabilityEvidence, modelRows),
      taskModelRouting: Object.keys(taskModelRouting).length > 0 ? { ...taskModelRouting } : {},
      modelsUrl: modelsUrl.trim(),
      apiKeyUrl: apiKeyUrl.trim(),
    };
    if (targetId) next.id = targetId;
    if (apiKey) next.apiKey = apiKey;
    if (Object.keys(headers).length > 0) next.headers = headers;
    if (removeHeaderKeys.length > 0) next.removeHeaderKeys = removeHeaderKeys;
    if (existing?.category) next.category = existing.category;
    return next;
  }, [apiFormat, apiKey, apiKeyUrl, authMode, baseUrl, existing?.category, headerRows, kind, modelCapabilities, modelCapabilityEvidence, modelRows, modelsUrl, name, originalHeaderKeys, productKind, targetId, taskModelRouting]);

  const editorSnapshot = useMemo(() => JSON.stringify({
    kind,
    name,
    baseUrl,
    apiFormat,
    authMode,
    productKind,
    apiKey,
    modelRows,
    modelCapabilities,
    modelCapabilityEvidence,
    taskModelRouting,
    headerRows,
    modelsUrl,
    apiKeyUrl,
  }), [apiFormat, apiKey, apiKeyUrl, authMode, baseUrl, headerRows, kind, modelCapabilities, modelCapabilityEvidence, modelRows, modelsUrl, name, productKind, taskModelRouting]);
  const testIdentity = useMemo(() => JSON.stringify({
    kind,
    baseUrl,
    apiFormat,
    authMode,
    apiKey,
    firstModel: modelRows[0]?.id,
    headers: headerRows,
  }), [apiFormat, apiKey, authMode, baseUrl, headerRows, kind, modelRows]);
  const connectionIdentity = useMemo(() => JSON.stringify({
    kind,
    baseUrl,
    apiFormat,
    authMode,
    apiKey,
    headers: headerRows,
    modelsUrl,
  }), [apiFormat, apiKey, authMode, baseUrl, headerRows, kind, modelsUrl]);
  const lastTestIdentityRef = useRef(testIdentity);
  const lastConnectionIdentityRef = useRef(connectionIdentity);
  const testVersionRef = useRef(0);
  const connectionVersionRef = useRef(0);
  if (lastTestIdentityRef.current !== testIdentity) {
    lastTestIdentityRef.current = testIdentity;
    testVersionRef.current += 1;
  }
  if (lastConnectionIdentityRef.current !== connectionIdentity) {
    lastConnectionIdentityRef.current = connectionIdentity;
    connectionVersionRef.current += 1;
  }
  const testFingerprint = testVersionRef.current;
  const connectionFingerprint = connectionVersionRef.current;
  const liveTestFingerprintRef = useRef(testFingerprint);
  const liveConnectionFingerprintRef = useRef(connectionFingerprint);
  liveTestFingerprintRef.current = testFingerprint;
  liveConnectionFingerprintRef.current = connectionFingerprint;

  useEffect(() => {
    if (!loading && baselineSnapshot === null) setBaselineSnapshot(editorSnapshot);
  }, [baselineSnapshot, editorSnapshot, loading]);

  const dirty = baselineSnapshot !== null && editorSnapshot !== baselineSnapshot;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const currentTestState = localTest?.fingerprint === testFingerprint ? localTest.value : undefined;
  useEffect(() => {
    if (targetId) onTestStateChange?.(targetId, currentTestState);
  }, [currentTestState, onTestStateChange, targetId]);

  const currentRemoteState = localRemote?.fingerprint === connectionFingerprint ? localRemote.value : undefined;
  const remoteResult = currentRemoteState && "result" in currentRemoteState ? currentRemoteState.result : undefined;
  const remoteModels = remoteResult?.models ?? [];
  const remoteError = remoteResult?.error;
  const remotePending = currentRemoteState !== undefined && "pending" in currentRemoteState;
  const { bases: remoteBases, snapshotsOf } = groupSnapshots(remoteModels);
  const testPending = currentTestState !== undefined && "pending" in currentTestState;
  const testResult = currentTestState && !("pending" in currentTestState) ? currentTestState : undefined;
  const isCustomProvider = kind === "custom" || existing?.category === "custom";
  const isLocalProvider = authMode === "none";
  const isPlanProvider = authMode === "plan-key";
  const isSubscriptionProvider = authMode === "oauth-subscription";
  const loginState = targetId ? loginStatuses[targetId] : undefined;
  const loginPending = loginState !== undefined && "pending" in loginState;
  const loginStatus = loginState && !("pending" in loginState) ? loginState : undefined;
  const subscriptionConnected = loginStatus?.state === "connected";
  const subscriptionLoginUnavailable = loginStatus?.state === "unavailable";
  const subscriptionName = (existing?.name ?? name).trim() || "订阅";
  const canDiscoverModels = modelsUrl.trim().length > 0;

  const addRemoteModel = (id: string) => {
    if (modelRows.some((row) => row.id === id)) return;
    setModelRows((rows) => [...rows, { id }]);
  };

  const removeModel = (id: string) => {
    setModelRows((rows) => rows.filter((row) => row.id !== id));
    setModelCapabilities((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setModelCapabilityEvidence((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setTaskModelRouting((current) => ({
      ...(current.fastModelId === id ? {} : current.fastModelId ? { fastModelId: current.fastModelId } : {}),
      ...(current.subagentModelId === id ? {} : current.subagentModelId ? { subagentModelId: current.subagentModelId } : {}),
    }));
  };

  const addHandTypedModel = () => {
    const id = newModelName.trim();
    if (!id) return;
    addRemoteModel(id);
    setNewModelName("");
  };

  const reorderModel = (id: string, delta: number) => setModelRows((rows) => moveModel(rows, id, delta));

  const makePreferredModel = (id: string) => setModelRows((rows) => {
    const preferred = rows.find((row) => row.id === id);
    if (!preferred || rows[0]?.id === id) return rows;
    return [preferred, ...rows.filter((row) => row.id !== id)];
  });

  const handleDropModel = (event: DragEvent<HTMLLIElement>, targetModelId: string) => {
    event.preventDefault();
    const sourceModelId = draggedModelRef.current;
    draggedModelRef.current = null;
    if (!sourceModelId || sourceModelId === targetModelId) return;
    setModelRows((rows) => {
      const sourceIndex = rows.findIndex((row) => row.id === sourceModelId);
      const targetIndex = rows.findIndex((row) => row.id === targetModelId);
      if (sourceIndex < 0 || targetIndex < 0) return rows;
      const next = [...rows];
      const [item] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const handleFetchModels = async () => {
    const generation = ++remoteGenerationRef.current;
    const fingerprint = connectionFingerprint;
    setLocalRemote({ fingerprint, value: { pending: true } });
    const result = await listRemoteModelsAction(targetId ? { providerId: targetId, draft } : { draft });
    if (!mountedRef.current || generation !== remoteGenerationRef.current || liveConnectionFingerprintRef.current !== fingerprint) return;
    setLocalRemote({ fingerprint, value: { result } });
  };

  const handleTestConnection = async () => {
    const modelId = modelRows[0]?.id;
    if (!modelId) return;
    const generation = ++testGenerationRef.current;
    const fingerprint = testFingerprint;
    setLocalTest({ fingerprint, value: { pending: true } });
    const result = await testConnectionAction(targetId
      ? { providerId: targetId, draft, modelId }
      : { draft, modelId });
    if (!mountedRef.current || generation !== testGenerationRef.current || liveTestFingerprintRef.current !== fingerprint) return;
    setLocalTest({ fingerprint, value: result });
    if (result.ok && result.capabilityProbes) {
      setModelCapabilityEvidence((current) => mergeCapabilityProbeResults(current, modelId, result.capabilityProbes!));
    }
  };

  const handleLogin = async () => {
    if (!targetId) return;
    setSaveError(null);
    onBusyChange?.(true);
    try {
      await loginProviderAction(targetId);
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleLogout = async () => {
    if (!targetId) return;
    setSaveError(null);
    onBusyChange?.(true);
    try {
      await logoutProviderAction(targetId);
    } finally {
      onBusyChange?.(false);
    }
  };

  const handleSave = async () => {
    const generation = ++saveGenerationRef.current;
    setSaveError(null);
    setSaving(true);
    onBusyChange?.(true);
    try {
      const result = await saveProviderAction(draft);
      if (!mountedRef.current || generation !== saveGenerationRef.current) return;
      if (result.ok) onSaved(result.spec);
      else setSaveError(result.error);
    } finally {
      if (mountedRef.current && generation === saveGenerationRef.current) setSaving(false);
      onBusyChange?.(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setSaveError(null);
    setDeleting(true);
    onBusyChange?.(true);
    try {
      await onDelete();
      if (mountedRef.current) setConfirmingDelete(false);
    } catch {
      if (mountedRef.current) setSaveError("删除失败，请重试");
    } finally {
      if (mountedRef.current) setDeleting(false);
      onBusyChange?.(false);
    }
  };

  const updateHeader = (index: number, field: "key" | "value", value: string) => {
    setHeaderRows((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      if (field === "key" && value !== row.key) return { ...row, key: value, savedSecret: false };
      return { ...row, [field]: value };
    }));
  };

  const setRouting = (slot: "fastModelId" | "subagentModelId", value: string) => {
    setTaskModelRouting((current) => {
      if (!value) {
        const next = { ...current };
        delete next[slot];
        return next;
      }
      return { ...current, [slot]: value };
    });
  };

  const setImageOverride = (modelId: string) => {
    setModelCapabilityEvidence((current) => ({
      ...current,
      [modelId]: {
        ...(current[modelId] ?? {}),
        image: setUserCapabilitySupported(current[modelId]?.image, Date.now()),
      },
    }));
  };

  const clearImageOverride = (modelId: string) => {
    setModelCapabilityEvidence((current) => ({
      ...current,
      [modelId]: {
        ...(current[modelId] ?? {}),
        image: clearUserCapabilityOverride(current[modelId]?.image),
      },
    }));
  };

  if (loading) {
    return (
      <div data-testid="provider-config-form" className="grid h-full min-h-0 flex-1 place-items-center bg-white text-xs text-[var(--leemo-ink-3)]">
        正在读取配置…
      </div>
    );
  }

  const title = existing?.saved ? existing.name : name ? `连接 ${name}` : "添加自定义服务商";
  const firstModelId = modelRows[0]?.id;
  const imageStatus = firstModelId ? resolveCapabilityDisplay(modelCapabilityEvidence[firstModelId]?.image, modelCapabilities[firstModelId]?.vision) : undefined;
  const reasoningStatus = firstModelId
    ? capabilityLabel(modelCapabilityEvidence[firstModelId], modelCapabilities[firstModelId]?.thinking, "reasoning")
    : "未确认";
  const testImageDetail = testResult?.capabilityProbes?.image.detail;
  const showingAdvanced = advancedOpen || Boolean(revealAdvanced);

  return (
    <div data-testid="provider-config-form" aria-busy={saving || deleting || loginPending} className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white">
      <fieldset disabled={saving || deleting || loginPending} className="contents">
        <header className="provider-config-header flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--leemo-line)] px-4 py-2 sm:px-5">
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] font-medium text-[var(--leemo-ink)]">{title}</h3>
            <p className="mt-0.5 text-[10.5px] text-[var(--leemo-ink-3)]">
              {isLocalProvider
                ? "本地连接，无需 API Key"
                : isSubscriptionProvider
                  ? subscriptionConnected ? "订阅已连接" : "使用已有订阅登录，无需 API Key"
                : existing?.hasApiKey
                  ? "凭据已安全保存"
                  : "完成连接后即可在对话中选择模型"}
            </p>
          </div>
        </header>

        <div className="provider-config-tabs flex h-11 shrink-0 items-end gap-6 border-b border-[var(--leemo-line)] px-5" role="tablist" aria-label="模型服务设置">
          <button type="button" role="tab" aria-selected={!showingAdvanced} onClick={() => setAdvancedOpen(false)}>连接与模型</button>
          <button type="button" role="tab" aria-selected={showingAdvanced} onClick={() => setAdvancedOpen(true)}>高级设置</button>
        </div>

        <div className="provider-config-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="provider-config-content mx-auto max-w-[720px] space-y-7 pb-2">
            {!showingAdvanced && <>
            <section aria-labelledby="provider-connection-heading">
              <h4 id="provider-connection-heading" className="mb-3 text-[13px] font-medium text-[var(--leemo-ink)]">连接信息</h4>
              <div className="space-y-4">
                <div>
                  <FieldLabel>名称</FieldLabel>
                  <input aria-label="名称" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
                </div>

                {isCustomProvider && (
                  <>
                    <div>
                      <FieldLabel>兼容协议</FieldLabel>
                      <div role="group" aria-label="兼容格式" className="grid min-h-9 grid-cols-3 overflow-hidden rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-0.5">
                        {(["anthropic", "openai", "openai-responses"] as const).map((format) => (
                          <button key={format} type="button" aria-pressed={apiFormat === format} onClick={() => setApiFormat(format)} className={`rounded-[5px] text-[11.5px] ${apiFormat === format ? "bg-white font-medium text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)]"}`}>
                            {format === "anthropic" ? "Anthropic" : format === "openai" ? "OpenAI Chat" : "OpenAI Responses"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {(isCustomProvider || isLocalProvider) && (
                  <div>
                    <FieldLabel hint={isLocalProvider ? "默认连接本机服务" : "地址与模型 ID 分开配置"}>
                      {isLocalProvider ? "本地服务地址" : "服务地址"}
                    </FieldLabel>
                    <input aria-label={isLocalProvider ? "本地服务地址" : "Base URL"} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={isLocalProvider ? "http://127.0.0.1:11434/v1" : "https://api.example.com"} className={inputClass} />
                  </div>
                )}

                {!isLocalProvider && !isSubscriptionProvider && <div>
                  <FieldLabel hint={existing?.hasApiKey ? "留空不改" : undefined}>{isPlanProvider ? "套餐 Key" : "API Key"}</FieldLabel>
                  <div className="relative">
                    <input aria-label={isPlanProvider ? "套餐 Key" : "API Key"} type={showApiKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={existing?.hasApiKey ? `已配置 ${existing.apiKeyMasked ?? ""}`.trim() : isPlanProvider ? "粘贴套餐 Key" : "粘贴 API Key"} className={`${inputClass} pr-10`} />
                    <button type="button" onClick={() => setShowApiKey((shown) => !shown)} aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} title={showApiKey ? "隐藏 API Key" : "显示 API Key"} className="absolute inset-y-0 right-0 grid w-9 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]">
                      {showApiKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                  {apiKeyUrl && <a href={apiKeyUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-[var(--leemo-amber-strong)] hover:underline">{isPlanProvider ? "查看套餐与 Key" : "获取 API Key"} <ExternalLink className="h-3 w-3" aria-hidden /></a>}
                  {existing?.hasApiKey && <p className="mt-1.5 text-[10.5px] text-[var(--leemo-ink-3)]">当前凭据 {existing.apiKeyMasked ?? "已配置"}，留空不会修改。</p>}
                </div>}

                {isSubscriptionProvider && (
                  <div className="rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3.5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-[12px] font-medium ${subscriptionConnected ? "text-[var(--leemo-ok)]" : "text-[var(--leemo-ink)]"}`}>
                          {loginPending
                            ? "正在检查登录状态…"
                            : subscriptionConnected
                              ? "订阅已连接"
                              : loginStatus?.state === "unavailable"
                                ? "需要先安装本机客户端"
                                : "尚未登录"}
                        </p>
                        <p className="mt-1 text-[10.5px] leading-4 text-[var(--leemo-ink-3)]">
                          {loginStatus?.message ?? (subscriptionConnected
                            ? "Leemo 将使用这个订阅完成对话和任务。"
                            : "登录时会打开本机客户端，完成后回到 Leemo 即可。")}
                        </p>
                      </div>
                      {subscriptionConnected ? (
                        <button type="button" onClick={() => void handleLogout()} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--leemo-line)] bg-white px-3 text-[11px] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-ink-3)]">
                          <LogOut className="h-3.5 w-3.5" aria-hidden />退出登录
                        </button>
                      ) : (
                        <button type="button" onClick={() => void handleLogin()} disabled={subscriptionLoginUnavailable} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--leemo-ink)] px-3 text-[11px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                          <LogIn className="h-3.5 w-3.5" aria-hidden />登录 {subscriptionName}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section aria-labelledby="enabled-models-heading">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h4 id="enabled-models-heading" className="text-[13px] font-medium text-[var(--leemo-ink)]">已启用模型</h4>
                  <p className="mt-0.5 text-[10.5px] text-[var(--leemo-ink-3)]">列表第一项是默认模型，可拖动调整顺序。</p>
                </div>
                {canDiscoverModels && <button type="button" onClick={() => void handleFetchModels()} disabled={remotePending} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--leemo-line)] px-2.5 text-[11px] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] disabled:opacity-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${remotePending ? "leemo-spin" : ""}`} aria-hidden />
                  {remotePending ? "读取中" : isLocalProvider ? "读取本机模型" : "拉取模型列表"}
                </button>}
              </div>
              {remoteError && (
                <div role="alert" className="mb-2 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-[var(--leemo-danger)]">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span><span className="block">{remoteError.message}</span><span className="mt-0.5 block text-[var(--leemo-ink-3)]">你仍然可以手动添加模型。</span></span>
                </div>
              )}
              {remoteBases.length > 0 && (
                <div className="mb-3 max-h-36 overflow-y-auto border-y border-[var(--leemo-line)] py-1">
                  {remoteBases.map((model) => {
                    const snapshots = snapshotsOf(model.id);
                    const expanded = expandedSnapshots[model.id] ?? false;
                    const selected = modelRows.some((row) => row.id === model.id);
                    return (
                      <div key={model.id}>
                        <div className="flex h-8 items-center gap-2 px-1 text-[11.5px] hover:bg-[var(--leemo-bg)]">
                          <input type="checkbox" checked={selected} aria-label={`${model.id} 可用`} onChange={() => selected ? removeModel(model.id) : addRemoteModel(model.id)} />
                          <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink)]">{model.displayName ?? model.id}</span>
                          {snapshots.length > 0 && <button type="button" onClick={() => setExpandedSnapshots((state) => ({ ...state, [model.id]: !expanded }))} className="text-[10px] text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]">{expanded ? "收起" : `${snapshots.length} 个快照`}</button>}
                        </div>
                        {expanded && snapshots.map((snapshot) => {
                          const snapshotSelected = modelRows.some((row) => row.id === snapshot.id);
                          return <label key={snapshot.id} className="ml-5 flex h-7 items-center gap-2 px-1 text-[10.5px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-bg)]"><input type="checkbox" checked={snapshotSelected} onChange={() => snapshotSelected ? removeModel(snapshot.id) : addRemoteModel(snapshot.id)} /><span className="truncate">{snapshot.displayName ?? snapshot.id}</span></label>;
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <input aria-label="手敲模型名" value={newModelName} onChange={(event) => setNewModelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addHandTypedModel(); } }} placeholder="输入模型 ID，回车添加" className={inputClass} />
                <button type="button" onClick={addHandTypedModel} aria-label="添加模型" title="添加模型" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--leemo-line)] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)]"><Plus className="h-4 w-4" aria-hidden /></button>
              </div>
              {modelRows.length === 0 ? (
                <div className="mt-3 border-y border-dashed border-[var(--leemo-line)] py-5 text-center text-[11px] text-[var(--leemo-ink-3)]">还没有模型，{canDiscoverModels ? "先读取列表或手动添加一个。" : "请手动添加一个模型 ID。"}</div>
              ) : (
                <ul aria-label="已启用模型列表" className="mt-3 divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">
                  {modelRows.map((row, index) => {
                    const evidence = modelCapabilityEvidence[row.id];
                    const imageDisplay = resolveCapabilityDisplay(evidence?.image, modelCapabilities[row.id]?.vision);
                    const imageFailed = imageDisplay.status === "failed" && imageDisplay.source === "probe";
                    const imageOverridden = imageDisplay.source === "user";
                    return (
                      <li key={row.id} draggable onDragStart={() => { draggedModelRef.current = row.id; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleDropModel(event, row.id)} data-preferred={index === 0 ? "true" : undefined} className="group flex min-h-[72px] items-center gap-2 py-2 text-[11px]">
                        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-[var(--leemo-ink-3)]" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span title={row.id} className="min-w-0 truncate font-medium text-[var(--leemo-ink)]">{row.id}</span>
                            {index === 0 && <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-[var(--leemo-amber-strong)]"><Star className="h-3 w-3" aria-hidden />首选</span>}
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--leemo-ink-3)]">
                            <span>图片：{capabilityLabel(evidence, modelCapabilities[row.id]?.vision, "image")}</span>
                            <span>深度思考：{capabilityLabel(evidence, modelCapabilities[row.id]?.thinking, "reasoning")}</span>
                          </div>
                          {index === 0 && imageFailed && !imageOverridden && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--leemo-ink-3)]">
                              <span>图片探测未通过，仍可尝试发送图片。</span>
                              <button type="button" onClick={() => void handleTestConnection()} className="text-[var(--leemo-amber-strong)] hover:underline">重新检测</button>
                              <button type="button" onClick={() => setImageOverride(row.id)} className="text-[var(--leemo-amber-strong)] hover:underline">我确认这个模型支持图片</button>
                            </div>
                          )}
                          {index === 0 && imageOverridden && (
                            <button type="button" onClick={() => clearImageOverride(row.id)} className="mt-1 text-[10px] text-[var(--leemo-amber-strong)] hover:underline">恢复自动判断</button>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100">
                          {index > 0 && <button type="button" onClick={() => makePreferredModel(row.id)} aria-label={`设为首选模型 ${row.id}`} title="设为首选" className="grid h-7 w-7 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-amber-strong)]"><Star className="h-3.5 w-3.5" aria-hidden /></button>}
                          <button type="button" onClick={() => reorderModel(row.id, -1)} disabled={index === 0} aria-label={`上移模型 ${row.id}`} title="上移" className="grid h-7 w-7 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink)] disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>
                          <button type="button" onClick={() => reorderModel(row.id, 1)} disabled={index === modelRows.length - 1} aria-label={`下移模型 ${row.id}`} title="下移" className="grid h-7 w-7 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink)] disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden /></button>
                          <button type="button" onClick={() => removeModel(row.id)} aria-label={`移除模型 ${row.id}`} title="移除模型" className="grid h-7 w-7 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger)]"><X className="h-3.5 w-3.5" aria-hidden /></button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            </>}

            {showingAdvanced && <div className="provider-config-advanced space-y-5">
                <section>
                  <h5 className="mb-3 text-[12.5px] font-medium text-[var(--leemo-ink)]">任务安排</h5>
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div>
                      <FieldLabel hint="留空时由 Leemo 自动推荐">快速与后台任务</FieldLabel>
                      <select aria-label="快速与后台任务方式" value={taskModelRouting.fastModelId ? "specific" : "auto"} onChange={(event) => setRouting("fastModelId", event.target.value === "specific" ? modelRows[0]?.id ?? "" : "")} className={inputClass}>
                        <option value="auto">自动推荐</option>
                        <option value="specific" disabled={modelRows.length === 0}>指定模型</option>
                      </select>
                      {taskModelRouting.fastModelId && <select aria-label="快速与后台任务模型" value={taskModelRouting.fastModelId} onChange={(event) => setRouting("fastModelId", event.target.value)} className={`${inputClass} mt-2`}>{modelRows.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}</select>}
                    </div>
                    <div>
                      <FieldLabel hint="留空时跟随当前对话模型">子任务使用的模型</FieldLabel>
                      <select aria-label="子任务使用方式" value={taskModelRouting.subagentModelId ? "specific" : "auto"} onChange={(event) => setRouting("subagentModelId", event.target.value === "specific" ? modelRows[0]?.id ?? "" : "")} className={inputClass}>
                        <option value="auto">自动继承</option>
                        <option value="specific" disabled={modelRows.length === 0}>指定模型</option>
                      </select>
                      {taskModelRouting.subagentModelId && <select aria-label="子任务使用模型" value={taskModelRouting.subagentModelId} onChange={(event) => setRouting("subagentModelId", event.target.value)} className={`${inputClass} mt-2`}>{modelRows.map((row) => <option key={row.id} value={row.id}>{row.id}</option>)}</select>}
                    </div>
                  </div>
                </section>

                {!isSubscriptionProvider && <section>
                  <h5 className="mb-3 text-[12.5px] font-medium text-[var(--leemo-ink)]">高级连接参数</h5>
                  <div className="space-y-4">
                    {!isCustomProvider && !isLocalProvider && (
                      <div>
                        <FieldLabel hint="仅在使用代理或专属部署地址时修改">Base URL</FieldLabel>
                        <input aria-label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" className={inputClass} />
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div><FieldLabel hint="可留空并手动添加模型">模型发现地址</FieldLabel><input aria-label="模型发现地址" value={modelsUrl} onChange={(event) => setModelsUrl(event.target.value)} placeholder="https://api.example.com/v1/models" className={inputClass} /></div>
                      {!isLocalProvider && <div><FieldLabel hint="帮助链接">获取 API Key 地址</FieldLabel><input aria-label="获取 API Key 地址" value={apiKeyUrl} onChange={(event) => setApiKeyUrl(event.target.value)} placeholder="https://console.example.com/keys" className={inputClass} /></div>}
                    </div>
                  </div>
                </section>}

                {!isSubscriptionProvider && <section>
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <div><h5 className="text-[12.5px] font-medium text-[var(--leemo-ink)]">自定义请求头</h5><p className="mt-0.5 text-[10.5px] text-[var(--leemo-ink-3)]">认证类值只写入主进程，不会回显到界面</p></div>
                    <button type="button" onClick={() => setHeaderRows((rows) => [...rows, { key: "", value: "", savedSecret: false }])} aria-label="添加请求头" title="添加请求头" className="grid h-8 w-8 place-items-center rounded-md border border-[var(--leemo-line)] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)]"><Plus className="h-4 w-4" aria-hidden /></button>
                  </div>
                  {headerRows.length === 0 ? <div className="border-y border-dashed border-[var(--leemo-line)] py-5 text-center text-[11px] text-[var(--leemo-ink-3)]">没有自定义请求头</div> : <div className="divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">{headerRows.map((row, index) => { const secret = row.savedSecret || !READABLE_HEADER_NAMES.has(row.key.trim().toLowerCase()); const label = row.key || String(index + 1); return <div key={`${index}-${row.savedSecret ? "saved" : "draft"}`} className="grid min-h-[52px] grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[minmax(110px,0.8fr)_minmax(150px,1.2fr)_auto]"><input aria-label={`header key ${label}`} value={row.key} onChange={(event) => updateHeader(index, "key", event.target.value)} placeholder="Header 名" className={inputClass} /><div className="relative"><input aria-label={`header value ${label}`} type={secret ? "password" : "text"} value={row.value} onChange={(event) => updateHeader(index, "value", event.target.value)} placeholder={row.savedSecret ? "已保存，留空不改" : "Header 值"} className={`${inputClass} ${row.savedSecret ? "pr-20" : ""}`} />{row.savedSecret && <span className="absolute inset-y-0 right-2 flex items-center text-[9.5px] text-[var(--leemo-ok)]">已安全保存</span>}</div><button type="button" onClick={() => setHeaderRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`删除 header ${label}`} title="删除请求头" className="grid h-8 w-8 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger)]"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button></div>; })}</div>}
                </section>}
              </div>}
          </div>
        </div>
      </fieldset>

      {(testPending || testResult) && (
        <div data-testid="connection-test-result" className="shrink-0 border-t border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-5 py-2.5 text-[11px]">
          {testPending ? <div className="flex items-center gap-2 text-[var(--leemo-ink-2)]"><RefreshCw className="h-3.5 w-3.5 leemo-spin text-[var(--leemo-amber)]" aria-hidden />正在测试连接、图片和深度思考…</div> : testResult?.ok ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--leemo-ink-2)]"><span className="inline-flex items-center gap-1 font-medium text-[var(--leemo-ok)]"><Check className="h-3.5 w-3.5" aria-hidden />连接成功</span><span>端点：可达</span><span>{isLocalProvider ? "本地服务：可用" : "凭据：有效"}</span><span>测试模型：{testResult.modelEcho ?? firstModelId ?? "通过"}</span>{testResult.latencyMs !== undefined && <span className="tabular-nums">{testResult.latencyMs} ms</span>}<span>图片：{imageStatus ? (imageStatus.source === "user" ? "用户已确认支持" : imageStatus.status === "failed" ? "本次检测未通过 · 自动探测" : imageStatus.status === "verified" ? "已验证支持 · 自动探测" : "未确认") : "未确认"}</span><span>深度思考：{reasoningStatus}</span>{testImageDetail && <span className="basis-full text-[var(--leemo-ink-3)]">图片探测详情：{testImageDetail}，仍可尝试发送图片。</span>}</div> : <div role="alert" className="flex items-start gap-2 text-[var(--leemo-danger)]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span><strong className="font-medium">连接失败：</strong>{testResult?.error?.message ?? "请检查地址、凭据和模型后重试。"}</span></div>}
        </div>
      )}

      {saveError && <p role="alert" className="shrink-0 border-t border-[var(--leemo-line)] px-5 py-2 text-[11px] text-[var(--leemo-danger)]">{saveError}</p>}

      <footer className="provider-config-footer flex min-h-[56px] shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--leemo-line)] px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2">
          {existing?.saved && onDelete && !confirmingDelete && <button type="button" onClick={() => setConfirmingDelete(true)} disabled={saving || deleting} aria-label="删除服务商" title="删除服务商" className="grid h-8 w-8 place-items-center rounded-md text-[var(--leemo-ink-3)] hover:bg-red-50 hover:text-[var(--leemo-danger)] disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden /></button>}
          {confirmingDelete && <div className="flex items-center gap-2 text-[10.5px] text-[var(--leemo-danger)]"><span>确定删除？</span><button type="button" aria-label="确认删除服务商" onClick={() => void handleDelete()} disabled={deleting} className="rounded-md bg-[var(--leemo-danger)] px-2 py-1 text-white disabled:opacity-50">{deleting ? "删除中" : "确认"}</button><button type="button" aria-label="取消删除服务商" onClick={() => setConfirmingDelete(false)} className="px-1 py-1 text-[var(--leemo-ink-3)]">取消</button></div>}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving || deleting} className="h-8 rounded-md border border-[var(--leemo-line)] px-3 text-[11.5px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-bg)] disabled:opacity-50">取消</button>
          {!isSubscriptionProvider && <button type="button" onClick={() => void handleTestConnection()} disabled={saving || deleting || testPending || !name.trim() || !baseUrl.trim() || modelRows.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--leemo-line)] px-3 text-[11.5px] text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] disabled:opacity-50"><TestTube2 className="h-3.5 w-3.5" aria-hidden />{testPending ? "测试中" : "测试连接"}</button>}
          <button type="button" onClick={() => void handleSave()} disabled={saving || deleting || !name.trim() || (!isSubscriptionProvider && !baseUrl.trim()) || (isSubscriptionProvider && !subscriptionConnected) || modelRows.length === 0} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--leemo-ink)] px-3.5 text-[11.5px] font-medium text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" aria-hidden />{saving ? "保存中" : "保存设置"}</button>
        </div>
      </footer>
    </div>
  );
}
