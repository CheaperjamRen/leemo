import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  BalanceInfo,
  ProviderSpec,
  ProviderConfigView,
  ProviderDraft,
  ConnectionTestRequest,
  ConnectionTestResult,
  ListRemoteModelsResult,
  ListRemoteModelsRequest,
  ProviderError,
  ProviderLoginStatus,
  RemoteModel,
} from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";
import { cloneModelCapabilityEvidenceMap } from "../../bridge/model-capabilities";

/** Key a not-yet-saved wizard draft's test/discovery results under — there is
 *  no instance id yet (卡 F3, per the task card's explicit key convention). */
export const DRAFT_TEST_KEY = "__draft__";

export interface ProvidersState {
  list: ProviderSpec[];
  /** Derived: `spec.configured === true`. Every instance with a usable cloud
   *  credential or a saved key-free local model selection. */
  configured: ProviderSpec[];
  /** Derived: everything else — untouched preset families and incomplete
   *  saved entries. */
  unconfigured: ProviderSpec[];
  status: "loading" | "ready" | "error";
  error?: string;
  /** @deprecated kept only so existing fixture/test call sites that still pass
   *  `configuredIds` as an initial seed keep compiling; the real filter is now
   *  `spec.configured`, not an id membership list (卡 F3 — catalog now lists
   *  unconfigured families too, so "every listed id is configured" is no
   *  longer true). New code should read `configured`/`unconfigured` instead. */
  configuredIds: string[];
  balances: Record<string, { info: BalanceInfo; fetchedAt: number } | { error: string }>;
  /** Connection-test results, keyed by instance id or `DRAFT_TEST_KEY` for an
   *  unsaved wizard draft. */
  tests: Record<string, ConnectionTestResult | { pending: true }>;
  /** Remote-model-discovery results, same keying as `tests`. */
  remoteModels: Record<string, { models: RemoteModel[] } | { pending: true } | { error: ProviderError }>;
  loginStatuses: Record<string, ProviderLoginStatus | { pending: true }>;
  refresh(): Promise<void>;
  fetchBalance(providerId: string): Promise<void>;
  /** GET side of the config form. Returns null for an unknown id (never
   *  throws) so the form can render a "not found" state instead of crashing. */
  getConfig(providerId: string): Promise<ProviderConfigView | null>;
  /** Create or update an instance, then refresh the catalog so the settings
   *  page and the input-box model picker see the change immediately. */
  saveProvider(draft: ProviderDraft): Promise<{ ok: true; spec: ProviderSpec } | { ok: false; error: string }>;
  deleteProvider(providerId: string): Promise<void>;
  /** Result lands in `tests[key]` — `key` is `req.providerId` when testing a
   *  saved instance, or `DRAFT_TEST_KEY` when testing an unsaved draft. */
  testConnection(req: ConnectionTestRequest): Promise<ConnectionTestResult>;
  /** Result lands in `remoteModels[key]`, same keying as `testConnection`. */
  listRemoteModels(req: ListRemoteModelsRequest): Promise<ListRemoteModelsResult>;
  getLoginStatus(providerId: string): Promise<ProviderLoginStatus>;
  loginProvider(providerId: string): Promise<ProviderLoginStatus>;
  logoutProvider(providerId: string): Promise<ProviderLoginStatus>;
}

function safeError(fallback: string): string {
  // Provider state must never become a transport for credentials or raw host
  // errors. Detailed diagnostics belong to the main process logs.
  return fallback;
}

function cloneList(list: ProviderSpec[]): ProviderSpec[] {
  return list.map((provider) => ({
    ...provider,
    models: [...provider.models],
    modelCapabilities: provider.modelCapabilities
      ? Object.fromEntries(
          Object.entries(provider.modelCapabilities).map(([modelId, capabilities]) => [
            modelId,
            { ...capabilities },
          ]),
        )
      : undefined,
    modelCapabilityEvidence: cloneModelCapabilityEvidenceMap(provider.modelCapabilityEvidence),
    capabilities: { ...provider.capabilities },
  }));
}

function splitConfigured(list: ProviderSpec[]): { configured: ProviderSpec[]; unconfigured: ProviderSpec[] } {
  const configured = list.filter((p) => p.configured === true);
  const unconfigured = list.filter((p) => p.configured !== true);
  return { configured, unconfigured };
}

/** The key `testConnection`/`listRemoteModels` file their result under: the
 *  saved instance's id, or `DRAFT_TEST_KEY` for an unsaved wizard draft.
 *  `req.providerId` and `req.draft` are mutually exclusive per the contract,
 *  so a draft-only request always keys to the draft slot. */
function requestKey(req: { providerId?: string; draft?: ProviderDraft }): string {
  return req.providerId ?? DRAFT_TEST_KEY;
}

export function createProvidersStore(
  client: BridgeClient,
  initial: { list?: ProviderSpec[]; configuredIds?: string[] } = {},
): StoreApi<ProvidersState> {
  const initialList = cloneList(initial.list ?? []);
  const { configured: initialConfigured, unconfigured: initialUnconfigured } = splitConfigured(initialList);
  // Back-compat seed: an old fixture call site may still pass `configuredIds`
  // explicitly (pre-卡F3 catalogs where every listed provider was, in fact,
  // configured). It has no effect on the real `configured` derivation above.
  const initialConfiguredIds = [...(initial.configuredIds ?? [])];

  return createStore<ProvidersState>((set, get) => ({
    list: initialList,
    configured: initialConfigured,
    unconfigured: initialUnconfigured,
    status: initial.list ? "ready" : "loading",
    configuredIds: initialConfiguredIds,
    balances: {},
    tests: {},
    remoteModels: {},
    loginStatuses: {},

    refresh: async () => {
      try {
        const list = cloneList(await client.invoke("bridge:listProviders", undefined));
        const { configured, unconfigured } = splitConfigured(list);
        set({
          list,
          configured,
          unconfigured,
          configuredIds: configured.map((provider) => provider.id),
          status: "ready",
          error: undefined,
        });
      } catch {
        set({ status: "error", error: safeError("Provider refresh failed") });
      }
    },

    fetchBalance: async (providerId) => {
      const provider = get().list.find((candidate) => candidate.id === providerId);
      if (!provider || provider.capabilities.balanceApi !== true) return;

      try {
        const info = await client.invoke("bridge:fetchBalance", { providerId });
        set((state) => ({
          balances: { ...state.balances, [providerId]: { info, fetchedAt: Date.now() } },
        }));
      } catch {
        set((state) => ({
          balances: { ...state.balances, [providerId]: { error: safeError("Balance fetch failed") } },
        }));
      }
    },

    getConfig: async (providerId) => {
      try {
        return await client.invoke("bridge:getProviderConfig", { providerId });
      } catch {
        return null;
      }
    },

    saveProvider: async (draft) => {
      try {
        const spec = await client.invoke("bridge:saveProvider", draft);
        await get().refresh();
        if (get().status === "error") {
          set((state) => {
            const index = state.list.findIndex((provider) => provider.id === spec.id);
            const list = index >= 0
              ? state.list.map((provider, providerIndex) => providerIndex === index ? spec : provider)
              : [...state.list, spec];
            const cloned = cloneList(list);
            const { configured, unconfigured } = splitConfigured(cloned);
            return {
              list: cloned,
              configured,
              unconfigured,
              configuredIds: configured.map((provider) => provider.id),
            };
          });
        }
        return { ok: true, spec };
      } catch {
        // Never surface the raw upstream/host error string — it could carry
        // path/env detail we don't want in renderer state. A flat, safe
        // message is enough for the form to show "save failed, try again".
        return { ok: false, error: safeError("保存失败，请重试") };
      }
    },

    deleteProvider: async (providerId) => {
      let deleted = false;
      try {
        await client.invoke("bridge:deleteProvider", { providerId });
        deleted = true;
      } finally {
        await get().refresh();
        if (deleted && get().status === "error") {
          set((state) => {
            const list = cloneList(state.list.filter((provider) => provider.id !== providerId));
            const { configured, unconfigured } = splitConfigured(list);
            return {
              list,
              configured,
              unconfigured,
              configuredIds: configured.map((provider) => provider.id),
            };
          });
        }
      }
    },

    testConnection: async (req) => {
      const key = requestKey(req);
      set((state) => ({ tests: { ...state.tests, [key]: { pending: true } } }));
      try {
        const result = await client.invoke("bridge:testConnection", req);
        set((state) => ({ tests: { ...state.tests, [key]: result } }));
        return result;
      } catch {
        const result: ConnectionTestResult = {
          ok: false,
          error: { kind: "unknown", message: safeError("连接测试失败，请重试") },
        };
        set((state) => ({
          tests: {
            ...state.tests,
            [key]: result,
          },
        }));
        return result;
      }
    },

    listRemoteModels: async (req) => {
      const key = requestKey(req);
      set((state) => ({ remoteModels: { ...state.remoteModels, [key]: { pending: true } } }));
      try {
        const result = await client.invoke("bridge:listRemoteModels", req);
        set((state) => ({
          remoteModels: {
            ...state.remoteModels,
            [key]: result.error ? { error: result.error } : { models: result.models },
          },
        }));
        return result;
      } catch {
        const result: ListRemoteModelsResult = {
          models: [],
          error: { kind: "unknown", message: safeError("拉取模型列表失败，请重试") },
        };
        set((state) => ({
          remoteModels: {
            ...state.remoteModels,
            [key]: { error: result.error! },
          },
        }));
        return result;
      }
    },

    getLoginStatus: async (providerId) => {
      try {
        const result = await client.invoke("bridge:getProviderLoginStatus", { providerId });
        set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: result } }));
        return result;
      } catch {
        const result: ProviderLoginStatus = { state: "unavailable", message: "暂时无法检查登录状态。" };
        set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: result } }));
        return result;
      }
    },

    loginProvider: async (providerId) => {
      set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: { pending: true } } }));
      try {
        const result = await client.invoke("bridge:loginProvider", { providerId });
        set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: result } }));
        return result;
      } catch {
        const result: ProviderLoginStatus = { state: "unavailable", message: "登录没有完成，可以重新尝试。" };
        set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: result } }));
        return result;
      }
    },

    logoutProvider: async (providerId) => {
      set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: { pending: true } } }));
      try {
        const result = await client.invoke("bridge:logoutProvider", { providerId });
        set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: result } }));
        return result;
      } catch {
        const result: ProviderLoginStatus = { state: "unavailable", message: "退出登录失败，请重试。" };
        set((state) => ({ loginStatuses: { ...state.loginStatuses, [providerId]: result } }));
        return result;
      }
    },
  }));
}
