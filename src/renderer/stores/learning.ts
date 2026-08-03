import { createStore, type StoreApi } from "zustand/vanilla";
import type { LearningClient } from "../learning/client";
import type { LearningProfileDraft, LearningSnapshot } from "../../learning";

export interface LearningState {
  snapshot: LearningSnapshot | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  refresh(): Promise<void>;
  saveProfile(draft: LearningProfileDraft): Promise<boolean>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLearningStore(client: LearningClient): StoreApi<LearningState> {
  let inFlight: Promise<void> | undefined;
  return createStore<LearningState>((set) => ({
    snapshot: null,
    status: "idle",
    error: null,
    refresh: async () => {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        set({ status: "loading", error: null });
        try {
          set({ snapshot: await client.getSnapshot(), status: "ready", error: null });
        } catch (error) {
          set({ status: "error", error: message(error) });
        } finally {
          inFlight = undefined;
        }
      })();
      return inFlight;
    },
    saveProfile: async (draft) => {
      try {
        await client.saveProfile(draft);
        set({ snapshot: await client.getSnapshot(), status: "ready", error: null });
        return true;
      } catch (error) {
        set({ status: "error", error: message(error) });
        return false;
      }
    },
  }));
}
