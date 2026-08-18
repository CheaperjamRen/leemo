import { createStore, type StoreApi } from "zustand/vanilla";
import type { BridgeClient } from "../bridge/client";
import type { GenerateGlobalOverviewResponse } from "../../bridge/contract";
import {
  applyGlobalOverviewOverrides,
  normalizePersistedGlobalOverviewState,
  type GlobalOverviewFact,
  type GlobalOverviewFactPack,
  type GlobalOverviewItem,
  type GlobalOverviewOverride,
  type GlobalOverviewSnapshot,
  type GlobalOverviewTrigger,
  type PersistedGlobalOverviewState,
} from "../../bridge/global-pending-overview";
import {
  localDateKey,
  shouldAutoRefresh,
} from "../global-overview/auto-refresh";

export interface GlobalOverviewDisplayItem extends GlobalOverviewItem {
  liveState?: GlobalOverviewFact["state"];
  sourceMissing: boolean;
}

export interface GlobalPendingOverviewState {
  persisted: PersistedGlobalOverviewState;
  status: "idle" | "refreshing" | "error";
  error: string | null;
  hydrate(value: unknown): void;
  refresh(trigger: GlobalOverviewTrigger): Promise<void>;
  setPriority(anchorSourceId: string, value: "now" | "soon" | "later"): Promise<void>;
  ignore(anchorSourceId: string): Promise<void>;
  end(anchorSourceId: string): Promise<void>;
  restore(anchorSourceId: string): Promise<void>;
  maybeAutoRefresh(now?: number): Promise<"ran" | "skipped">;
}

export interface GlobalPendingOverviewDeps {
  getProviderSelection(): { providerId: string; modelId: string } | null;
  getFactPack(): GlobalOverviewFactPack;
  getAutoSettings(): { enabled: boolean; localTime: string };
  persistence?: { saveGlobalPendingOverview(state: PersistedGlobalOverviewState): Promise<void> };
  now?: () => number;
}

const EMPTY_PERSISTED: PersistedGlobalOverviewState = {
  version: 1,
  snapshot: null,
  overrides: [],
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function localIso(timestamp: number): string {
  const date = new Date(timestamp);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`,
  ].join("");
}

function liveStateOf(facts: readonly GlobalOverviewFact[]): GlobalOverviewFact["state"] | undefined {
  const ranks: Record<GlobalOverviewFact["state"], number> = {
    "waiting-user": 0,
    running: 1,
    "failed-retryable": 2,
    open: 3,
    uncertain: 4,
    delivered: 5,
  };
  return [...facts].sort((left, right) => ranks[left.state] - ranks[right.state])[0]?.state;
}

export function deriveGlobalOverviewDisplayItems(
  snapshot: GlobalOverviewSnapshot | null,
  facts: readonly GlobalOverviewFact[],
  overrides: readonly GlobalOverviewOverride[],
): GlobalOverviewDisplayItem[] {
  if (!snapshot) return [];
  const factIndex = new Map(facts.map((fact) => [fact.id, fact]));
  return applyGlobalOverviewOverrides(snapshot.items, facts, overrides).flatMap((item) => {
    const linked = item.sourceIds.flatMap((id) => {
      const fact = factIndex.get(id);
      return fact ? [fact] : [];
    });
    const taskOnly = item.sourceIds.every((id) => id.startsWith("task:"));
    if (taskOnly && linked.length === 0) return [];
    return [{
      ...item,
      sourceIds: [...item.sourceIds],
      ...(liveStateOf(linked) ? { liveState: liveStateOf(linked) } : {}),
      sourceMissing: linked.length !== item.sourceIds.length,
    }];
  });
}

export function createGlobalPendingOverviewStore(
  client: BridgeClient,
  deps: GlobalPendingOverviewDeps,
): StoreApi<GlobalPendingOverviewState> {
  const now = deps.now ?? (() => Date.now());
  let inFlight: Promise<void> | undefined;

  const store = createStore<GlobalPendingOverviewState>((set, get) => {
    const save = async (state: PersistedGlobalOverviewState): Promise<void> => {
      await deps.persistence?.saveGlobalPendingOverview(state);
    };

    const replaceOverride = async (
      anchorSourceId: string,
      action: GlobalOverviewOverride["action"] | "restore",
      value?: "now" | "soon" | "later",
    ): Promise<void> => {
      const current = get().persisted;
      const facts = deps.getFactPack().facts;
      const source = facts.find((fact) => fact.id === anchorSourceId);
      if (action !== "restore" && !source) {
        set({ status: "error", error: "原事项已经不存在，请先重新梳理。" });
        return;
      }
      const overrides = current.overrides.filter((override) => override.anchorSourceId !== anchorSourceId);
      if (action !== "restore") {
        overrides.push({
          anchorSourceId,
          action,
          ...(action === "priority" && value ? { value } : {}),
          updatedAt: now(),
          sourceUpdatedAt: source!.updatedAt,
        });
      }
      const next = { ...current, overrides };
      try {
        await save(next);
        set({ persisted: next, status: "idle", error: null });
      } catch (error) {
        set({ status: "error", error: `修改没有保存成功：${errorText(error)}` });
      }
    };

    return {
      persisted: { ...EMPTY_PERSISTED, overrides: [] },
      status: "idle",
      error: null,

      hydrate: (value) => {
        const normalized = normalizePersistedGlobalOverviewState(value);
        if (normalized) set({ persisted: normalized, status: "idle", error: null });
      },

      refresh: (trigger) => {
        if (inFlight) return inFlight;
        const operation = (async () => {
          const provider = deps.getProviderSelection();
          if (!provider) {
            set({ status: "error", error: "请先选择一个可用模型。" });
            return;
          }
          const pack = deps.getFactPack();
          if (pack.facts.length === 0) {
            set({ status: "error", error: "目前没有需要梳理的事项。" });
            return;
          }
          set({ status: "refreshing", error: null });
          let persisted = get().persisted;
          const timestamp = now();
          if (trigger === "scheduled") {
            const attempted = { ...persisted, lastAutoAttemptDate: localDateKey(timestamp) };
            try {
              await save(attempted);
              persisted = attempted;
              set({ persisted: attempted });
            } catch {
              set({ status: "error", error: "自动梳理没有开始：尝试日期未能保存。" });
              return;
            }
          }
          let response: GenerateGlobalOverviewResponse;
          try {
            response = await client.invoke("bridge:generateGlobalPendingOverview", {
              ...provider,
              trigger,
              localNow: localIso(timestamp),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              facts: pack.facts,
              overrides: persisted.overrides,
            });
          } catch (error) {
            set({ status: "error", error: errorText(error) });
            return;
          }
          if (!response.ok) {
            set({ status: "error", error: response.message });
            return;
          }
          const next: PersistedGlobalOverviewState = {
            ...persisted,
            snapshot: response.snapshot,
          };
          try {
            await save(next);
          } catch {
            set({ status: "error", error: "新看板没有保存成功，旧看板已保留。" });
            return;
          }
          set({ persisted: next, status: "idle", error: null });
        })();
        inFlight = operation.finally(() => {
          inFlight = undefined;
        });
        return inFlight;
      },

      setPriority: (anchorSourceId, value) => replaceOverride(anchorSourceId, "priority", value),
      ignore: (anchorSourceId) => replaceOverride(anchorSourceId, "ignore"),
      end: (anchorSourceId) => replaceOverride(anchorSourceId, "ended"),
      restore: (anchorSourceId) => replaceOverride(anchorSourceId, "restore"),

      maybeAutoRefresh: async (timestamp = now()) => {
        const settings = deps.getAutoSettings();
        const persisted = get().persisted;
        if (!shouldAutoRefresh({
          enabled: settings.enabled,
          localTime: settings.localTime,
          now: timestamp,
          ...(persisted.lastAutoAttemptDate ? { lastAutoAttemptDate: persisted.lastAutoAttemptDate } : {}),
          ...(persisted.snapshot ? { lastSuccessfulAt: persisted.snapshot.generatedAt } : {}),
        })) return "skipped";
        await get().refresh("scheduled");
        return "ran";
      },
    };
  });

  return store;
}
