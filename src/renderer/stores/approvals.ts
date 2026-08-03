import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ApprovalRequest,
  ApprovalTier,
  AskUserAnswerItem,
  AskUserPayload,
  AskUserQuestion,
  RiskLevel,
  WhitelistEntry,
} from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";

export type PendingInteraction =
  | {
      kind: "approval";
      id: string;
      conversationId: string;
      runId: string;
      toolName: string;
      inputSummary: string;
      risk: RiskLevel;
      /** SDK tool-call id, so the card renders next to the tool that raised
       *  it. Absent for hosts that predate the field. */
      toolUseId?: string;
      receivedAt: number;
    }
  | {
      kind: "question";
      id: string;
      conversationId: string;
      runId: string;
      questions: AskUserQuestion[];
      receivedAt: number;
    };

export type ResolvedInteraction =
  | {
      kind: "approval";
      id: string;
      runId: string;
      toolName: string;
      inputSummary: string;
      risk: RiskLevel;
      toolUseId?: string;
      outcome: ApprovalTier | "cancelled";
    }
  | {
      kind: "question";
      id: string;
      runId: string;
      questions: AskUserQuestion[];
      items: AskUserAnswerItem[] | null;
    };

export interface ApprovalsData {
  pendingByConversation: Record<string, PendingInteraction | null>;
  resolvedByRun: Record<string, ResolvedInteraction[]>;
}

export interface ApprovalsState extends ApprovalsData {
  whitelist: WhitelistEntry[];
  decide(id: string, decision: ApprovalTier, message?: string): Promise<void>;
  answer(id: string, items: AskUserAnswerItem[]): Promise<void>;
  cancelForConversation(conversationId: string): void;
  refreshWhitelist(): Promise<void>;
  revokeWhitelistEntry(entry: { toolName: string; risk: RiskLevel }): Promise<void>;
}

export interface ApprovalsStoreDeps {
  now?: () => number;
  notifyError?: (message: string) => void;
}

const SAFE_BRIDGE_ERROR = "无法完成操作，请稍后重试。";

function appendResolved(data: ApprovalsData, item: ResolvedInteraction): ApprovalsData {
  const existing = data.resolvedByRun[item.runId] ?? [];
  return {
    pendingByConversation: data.pendingByConversation,
    resolvedByRun: { ...data.resolvedByRun, [item.runId]: [...existing, item] },
  };
}

function resolvedFromCancelled(interaction: PendingInteraction): ResolvedInteraction {
  if (interaction.kind === "approval") {
    return {
      kind: "approval",
      id: interaction.id,
      runId: interaction.runId,
      toolName: interaction.toolName,
      inputSummary: interaction.inputSummary,
      risk: interaction.risk,
      toolUseId: interaction.toolUseId,
      outcome: "cancelled",
    };
  }
  return {
    kind: "question",
    id: interaction.id,
    runId: interaction.runId,
    questions: interaction.questions,
    items: null,
  };
}

function pendingAfter(
  data: ApprovalsData,
  conversationId: string,
  interaction: PendingInteraction,
): ApprovalsData {
  const previous = data.pendingByConversation[conversationId];
  let next = data;
  if (previous) next = appendResolved(data, resolvedFromCancelled(previous));
  return {
    pendingByConversation: { ...next.pendingByConversation, [conversationId]: interaction },
    resolvedByRun: next.resolvedByRun,
  };
}

/** Fold an approval push using its payload route and renderer-owned run id. */
export function foldApprovalRequest(
  prev: ApprovalsData,
  payload: ApprovalRequest,
  runId: string,
  receivedAt: number,
): ApprovalsData {
  const interaction: PendingInteraction = {
    kind: "approval",
    id: payload.id,
    conversationId: payload.conversationId,
    runId,
    toolName: payload.toolName,
    inputSummary: payload.inputSummary,
    risk: payload.risk,
    toolUseId: payload.toolUseId,
    receivedAt,
  };
  return pendingAfter(prev, payload.conversationId, interaction);
}

/** Fold an ask-user push using its payload route and renderer-owned run id. */
export function foldAskUser(
  prev: ApprovalsData,
  payload: AskUserPayload,
  runId: string,
  receivedAt: number,
): ApprovalsData {
  const interaction: PendingInteraction = {
    kind: "question",
    id: payload.id,
    conversationId: payload.conversationId,
    runId,
    questions: payload.questions,
    receivedAt,
  };
  return pendingAfter(prev, payload.conversationId, interaction);
}

function findPending(
  state: ApprovalsData,
  id: string,
  kind: PendingInteraction["kind"],
): PendingInteraction | undefined {
  for (const pending of Object.values(state.pendingByConversation)) {
    if (pending?.id === id && pending.kind === kind) return pending;
  }
  return undefined;
}

function resolvedFromDecision(
  interaction: PendingInteraction & { kind: "approval" },
  decision: ApprovalTier,
): ResolvedInteraction {
  return {
    kind: "approval",
    id: interaction.id,
    runId: interaction.runId,
    toolName: interaction.toolName,
    inputSummary: interaction.inputSummary,
    risk: interaction.risk,
    toolUseId: interaction.toolUseId,
    outcome: decision,
  };
}

function resolvedFromAnswer(
  interaction: PendingInteraction & { kind: "question" },
  items: AskUserAnswerItem[],
): ResolvedInteraction {
  return {
    kind: "question",
    id: interaction.id,
    runId: interaction.runId,
    questions: interaction.questions,
    items,
  };
}

interface InFlight {
  conversationId: string;
  interaction: PendingInteraction;
  optimistic: ResolvedInteraction;
  cancelled: boolean;
}

export function createApprovalsStore(client: BridgeClient, deps: ApprovalsStoreDeps = {}): StoreApi<ApprovalsState> {
  const now = deps.now ?? Date.now;
  const inFlight = new Set<InFlight>();
  const latestFlightByConversation = new Map<string, InFlight>();

  const notifyBridgeError = (): void => {
    try {
      deps.notifyError?.(SAFE_BRIDGE_ERROR);
    } catch {
      // A notification sink must never replace the original Bridge rejection.
    }
  };

  const store = createStore<ApprovalsState>((set, get) => ({
    pendingByConversation: {},
    resolvedByRun: {},
    whitelist: [],

    decide: async (id, decision, message) => {
      const interaction = findPending(get(), id, "approval");
      if (!interaction || interaction.kind !== "approval") return;
      const optimistic = resolvedFromDecision(interaction, decision);
      const flight: InFlight = { conversationId: interaction.conversationId, interaction, optimistic, cancelled: false };
      inFlight.add(flight);
      latestFlightByConversation.set(interaction.conversationId, flight);
      set((state) => {
        const current = state.pendingByConversation[interaction.conversationId];
        if (current?.id !== id || current.kind !== "approval") return state;
        return {
          pendingByConversation: { ...state.pendingByConversation, [interaction.conversationId]: null },
          resolvedByRun: appendResolved(state, optimistic).resolvedByRun,
        };
      });
      try {
        await client.invoke("bridge:approvalDecision", { id, decision, ...(message === undefined ? {} : { message }) });
      } catch (error) {
        set((state) => {
          const runItems = state.resolvedByRun[optimistic.runId] ?? [];
          const resolvedByRun = {
            ...state.resolvedByRun,
            [optimistic.runId]: runItems.filter((item) => item !== optimistic),
          };
          const current = state.pendingByConversation[flight.conversationId];
          if (current === null && !flight.cancelled && latestFlightByConversation.get(flight.conversationId) === flight) {
            return {
              pendingByConversation: { ...state.pendingByConversation, [flight.conversationId]: flight.interaction },
              resolvedByRun,
            };
          }
          return { resolvedByRun };
        });
        notifyBridgeError();
        throw error;
      } finally {
        inFlight.delete(flight);
        if (latestFlightByConversation.get(flight.conversationId) === flight) {
          latestFlightByConversation.delete(flight.conversationId);
        }
      }
    },

    answer: async (id, items) => {
      const interaction = findPending(get(), id, "question");
      if (!interaction || interaction.kind !== "question") return;
      const optimistic = resolvedFromAnswer(interaction, items);
      const flight: InFlight = { conversationId: interaction.conversationId, interaction, optimistic, cancelled: false };
      inFlight.add(flight);
      latestFlightByConversation.set(interaction.conversationId, flight);
      set((state) => {
        const current = state.pendingByConversation[interaction.conversationId];
        if (current?.id !== id || current.kind !== "question") return state;
        return {
          pendingByConversation: { ...state.pendingByConversation, [interaction.conversationId]: null },
          resolvedByRun: appendResolved(state, optimistic).resolvedByRun,
        };
      });
      try {
        await client.invoke("bridge:askUserAnswer", { id, items });
      } catch (error) {
        set((state) => {
          const runItems = state.resolvedByRun[optimistic.runId] ?? [];
          const resolvedByRun = {
            ...state.resolvedByRun,
            [optimistic.runId]: runItems.filter((item) => item !== optimistic),
          };
          const current = state.pendingByConversation[flight.conversationId];
          if (current === null && !flight.cancelled && latestFlightByConversation.get(flight.conversationId) === flight) {
            return {
              pendingByConversation: { ...state.pendingByConversation, [flight.conversationId]: flight.interaction },
              resolvedByRun,
            };
          }
          return { resolvedByRun };
        });
        notifyBridgeError();
        throw error;
      } finally {
        inFlight.delete(flight);
        if (latestFlightByConversation.get(flight.conversationId) === flight) {
          latestFlightByConversation.delete(flight.conversationId);
        }
      }
    },

    cancelForConversation: (conversationId) => {
      // Mark every in-flight reply first. A newer pending card may be present;
      // cancelling that card must still prevent an older rejected invoke from
      // reviving its stale interaction below.
      for (const flight of inFlight) {
        if (flight.conversationId === conversationId) flight.cancelled = true;
      }
      const pending = get().pendingByConversation[conversationId];
      if (pending) {
        set((state) => {
          const current = state.pendingByConversation[conversationId];
          if (!current) return state;
          const archived = appendResolved(state, resolvedFromCancelled(current));
          return {
            pendingByConversation: { ...archived.pendingByConversation, [conversationId]: null },
            resolvedByRun: archived.resolvedByRun,
          };
        });
        return;
      }
      // The card is already optimistically resolved, but an interrupt/error can
      // still race the Bridge invoke. The in-flight marker above prevents a
      // reject from reviving it.
    },

    refreshWhitelist: async () => {
      const entries = await client.invoke("bridge:listWhitelist", undefined);
      set({ whitelist: Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [] });
    },

    revokeWhitelistEntry: async (entry) => {
      await client.invoke("bridge:revokeWhitelist", { toolName: entry.toolName, risk: entry.risk });
      await get().refreshWhitelist();
    },
  }));

  return store;
}
