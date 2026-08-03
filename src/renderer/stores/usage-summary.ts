import { createStore, type StoreApi } from "zustand/vanilla";
import type { UsageSummary, UsageSummaryQuery } from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";

export interface UsageSummaryState {
  range: UsageSummaryQuery["range"];
  summary: UsageSummary | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  refresh(range?: UsageSummaryQuery["range"]): Promise<void>;
}

export function createUsageSummaryStore(client: BridgeClient): StoreApi<UsageSummaryState> {
  let requestSequence = 0;
  return createStore<UsageSummaryState>((set, get) => ({
    range: "today",
    summary: null,
    status: "idle",

    refresh: async (requestedRange) => {
      const range = requestedRange ?? get().range;
      const sequence = ++requestSequence;
      set({ range, status: "loading", error: undefined });
      try {
        const summary = await client.invoke("bridge:usageSummary", { range });
        if (!summary || !Array.isArray(summary.byProvider)) throw new Error("invalid usage summary");
        if (sequence !== requestSequence) return;
        set({ summary, status: "ready", error: undefined });
      } catch {
        if (sequence !== requestSequence) return;
        set({ status: "error", error: "用量读取失败，请稍后重试" });
      }
    },
  }));
}
