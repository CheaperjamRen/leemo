import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  BridgeClient,
} from "../bridge/client";
import type {
  MemoryChangeResult,
  MemoryHistoryEntry,
  MemoryScopeView,
  MemoryView,
  UpdateMemoryRequest,
} from "../../bridge/contract";

export interface UndoMemoryRequest {
  scope: MemoryScopeView;
  targetChangeId: string;
  conversationId?: string;
}

export interface MemoryState {
  records: MemoryView[];
  historyById: Record<string, MemoryHistoryEntry[]>;
  loading: boolean;
  listError: string | null;
  directoryError: string | null;
  mutationErrors: Record<string, string>;
  historyErrors: Record<string, string>;
  historyLoadingIds: string[];
  pendingUndoIds: string[];
  undoneChangeIds: string[];
  undoErrors: Record<string, string>;
  refresh(scopes: MemoryScopeView[], includeInactive?: boolean): Promise<void>;
  update(request: UpdateMemoryRequest): Promise<MemoryChangeResult>;
  remove(scope: MemoryScopeView, id: string): Promise<MemoryChangeResult>;
  pin(scope: MemoryScopeView, id: string, pinned: boolean): Promise<MemoryChangeResult>;
  loadHistory(scope: MemoryScopeView, id: string): Promise<MemoryHistoryEntry[]>;
  undo(request: UndoMemoryRequest): Promise<boolean>;
  openDirectory(scope: MemoryScopeView): Promise<void>;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replaceMutationRecord(
  records: MemoryView[],
  oldId: string,
  change: MemoryChangeResult,
): MemoryView[] {
  const index = records.findIndex((record) => record.id === oldId);
  if (change.memory.status !== "current") {
    return index < 0 ? records : [...records.slice(0, index), ...records.slice(index + 1)];
  }
  if (index < 0) return [...records, change.memory];
  return [...records.slice(0, index), change.memory, ...records.slice(index + 1)];
}

function without(values: string[], value: string): string[] {
  return values.filter((candidate) => candidate !== value);
}

function sameScope(left: MemoryScopeView, right: MemoryScopeView): boolean {
  return left.type === right.type
    && (left.type === "global"
      || (left.type === "notebook" && right.type === "notebook" && left.notebookId === right.notebookId)
      || (left.type === "workspace" && right.type === "workspace" && left.workspaceId === right.workspaceId));
}

export function createMemoryStore(client: BridgeClient): StoreApi<MemoryState> {
  let latestRefreshRequest = 0;
  const latestHistoryRequestById = new Map<string, number>();
  return createStore<MemoryState>((set, get) => ({
    records: [],
    historyById: {},
    loading: false,
    listError: null,
    directoryError: null,
    mutationErrors: {},
    historyErrors: {},
    historyLoadingIds: [],
    pendingUndoIds: [],
    undoneChangeIds: [],
    undoErrors: {},

    refresh: async (scopes, includeInactive) => {
      const requestId = ++latestRefreshRequest;
      set({ loading: true, listError: null });
      try {
        const records = await client.invoke("bridge:listMemory", {
          scopes,
          ...(includeInactive === undefined ? {} : { includeInactive }),
        });
        if (!Array.isArray(records)) throw new Error("记忆列表返回格式不正确。");
        if (requestId !== latestRefreshRequest) return;
        set({ records, loading: false, listError: null });
      } catch (error: unknown) {
        if (requestId !== latestRefreshRequest) return;
        set({ loading: false, listError: messageFor(error) });
      }
    },

    update: async (request) => {
      try {
        const change = await client.invoke("bridge:updateMemory", request);
        latestRefreshRequest += 1;
        set((state) => ({
          records: replaceMutationRecord(state.records, request.id, change),
          loading: false,
          mutationErrors: Object.fromEntries(
            Object.entries(state.mutationErrors).filter(([id]) => id !== request.id),
          ),
        }));
        return change;
      } catch (error: unknown) {
        set((state) => ({
          mutationErrors: { ...state.mutationErrors, [request.id]: messageFor(error) },
        }));
        throw error;
      }
    },

    remove: async (scope, id) => {
      try {
        const change = await client.invoke("bridge:deleteMemory", { scope, id });
        latestRefreshRequest += 1;
        latestHistoryRequestById.set(id, (latestHistoryRequestById.get(id) ?? 0) + 1);
        set((state) => ({
          records: replaceMutationRecord(state.records, id, change),
          historyById: Object.fromEntries(
            Object.entries(state.historyById).filter(([recordId]) => recordId !== id),
          ),
          historyErrors: Object.fromEntries(
            Object.entries(state.historyErrors).filter(([recordId]) => recordId !== id),
          ),
          historyLoadingIds: without(state.historyLoadingIds, id),
          loading: false,
          mutationErrors: Object.fromEntries(
            Object.entries(state.mutationErrors).filter(([recordId]) => recordId !== id),
          ),
        }));
        return change;
      } catch (error: unknown) {
        set((state) => ({
          mutationErrors: { ...state.mutationErrors, [id]: messageFor(error) },
        }));
        throw error;
      }
    },

    pin: async (scope, id, pinned) => {
      try {
        const change = await client.invoke("bridge:pinMemory", { scope, id, pinned });
        latestRefreshRequest += 1;
        set((state) => ({
          records: replaceMutationRecord(state.records, id, change),
          loading: false,
          mutationErrors: Object.fromEntries(
            Object.entries(state.mutationErrors).filter(([recordId]) => recordId !== id),
          ),
        }));
        return change;
      } catch (error: unknown) {
        set((state) => ({
          mutationErrors: { ...state.mutationErrors, [id]: messageFor(error) },
        }));
        throw error;
      }
    },

    loadHistory: async (scope, id) => {
      const requestId = (latestHistoryRequestById.get(id) ?? 0) + 1;
      latestHistoryRequestById.set(id, requestId);
      set((state) => ({
        historyLoadingIds: state.historyLoadingIds.includes(id)
          ? state.historyLoadingIds
          : [...state.historyLoadingIds, id],
        historyErrors: Object.fromEntries(
          Object.entries(state.historyErrors).filter(([recordId]) => recordId !== id),
        ),
      }));
      try {
        const history = await client.invoke("bridge:memoryHistory", { scope, id });
        if (!Array.isArray(history)) throw new Error("记忆历史返回格式不正确。");
        if (latestHistoryRequestById.get(id) !== requestId) return history;
        set((state) => ({
          historyById: { ...state.historyById, [id]: history },
          historyLoadingIds: without(state.historyLoadingIds, id),
          historyErrors: Object.fromEntries(
            Object.entries(state.historyErrors).filter(([recordId]) => recordId !== id),
          ),
        }));
        return history;
      } catch (error: unknown) {
        if (latestHistoryRequestById.get(id) !== requestId) throw error;
        set((state) => ({
          historyLoadingIds: without(state.historyLoadingIds, id),
          historyErrors: { ...state.historyErrors, [id]: messageFor(error) },
        }));
        throw error;
      }
    },

    undo: async (request) => {
      const id = request.targetChangeId;
      set((state) => ({
        pendingUndoIds: state.pendingUndoIds.includes(id)
          ? state.pendingUndoIds
          : [...state.pendingUndoIds, id],
        undoErrors: Object.fromEntries(
          Object.entries(state.undoErrors).filter(([changeId]) => changeId !== id),
        ),
      }));
      try {
        const result = await client.invoke("bridge:undoMemory", request);
        if (!result.ok) {
          set((state) => ({
            pendingUndoIds: without(state.pendingUndoIds, id),
            undoErrors: {
              ...state.undoErrors,
              [id]: result.conflict
                ? "这条记忆后来又被修改了，无法直接撤销。"
                : "这条记忆现在无法撤销。",
            },
          }));
          return false;
        }
        set((state) => ({
          pendingUndoIds: without(state.pendingUndoIds, id),
          undoneChangeIds: state.undoneChangeIds.includes(id)
            ? state.undoneChangeIds
            : [...state.undoneChangeIds, id],
          undoErrors: Object.fromEntries(
            Object.entries(state.undoErrors).filter(([changeId]) => changeId !== id),
          ),
        }));
        // The receipt and settings page share this store. Re-read only the
        // affected scope so a successful undo cannot leave a stale fact visible
        // or discard cached records from other notebooks.
        const requestId = ++latestRefreshRequest;
        try {
          const records = await client.invoke("bridge:listMemory", { scopes: [request.scope] });
          if (!Array.isArray(records)) throw new Error("记忆列表返回格式不正确。");
          if (requestId !== latestRefreshRequest) return true;
          set((state) => ({
            records: [
              ...state.records.filter((record) => !sameScope(record.scope, request.scope)),
              ...records,
            ],
            loading: false,
            listError: null,
          }));
        } catch (error: unknown) {
          if (requestId !== latestRefreshRequest) return true;
          // The durable undo already succeeded. Keep that honest result while
          // surfacing that the visible list could not be refreshed.
          set({ loading: false, listError: messageFor(error) });
        }
        return true;
      } catch (error: unknown) {
        set((state) => ({
          pendingUndoIds: without(state.pendingUndoIds, id),
          undoErrors: { ...state.undoErrors, [id]: messageFor(error) },
        }));
        return false;
      }
    },

    openDirectory: async (scope) => {
      set({ directoryError: null });
      try {
        await client.invoke("bridge:openMemoryDir", { scope });
        set({ directoryError: null });
      } catch (error: unknown) {
        set({ directoryError: messageFor(error) });
        throw error;
      }
    },
  }));
}
