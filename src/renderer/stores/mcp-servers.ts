import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  McpConnectionTestResult,
  McpServerDraft,
  McpServerView,
} from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";

export interface McpServersState {
  list: McpServerView[];
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  saving: Record<string, boolean>;
  tests: Record<string, McpConnectionTestResult | { pending: true }>;
  refresh(): Promise<void>;
  save(draft: McpServerDraft): Promise<{ ok: true; view: McpServerView } | { ok: false; error: string }>;
  remove(id: string): Promise<boolean>;
  setEnabled(view: McpServerView, enabled: boolean): Promise<boolean>;
  test(id: string): Promise<void>;
}

function cloneView(view: McpServerView): McpServerView {
  return {
    ...view,
    args: view.args ? [...view.args] : undefined,
    envKeys: [...view.envKeys],
    headerKeys: [...view.headerKeys],
  };
}

function publicDraft(view: McpServerView, enabled: boolean): McpServerDraft {
  return {
    id: view.id,
    name: view.name,
    description: view.description,
    transport: view.transport,
    command: view.command,
    args: view.args ? [...view.args] : undefined,
    url: view.url,
    enabled,
    timeoutMs: view.timeoutMs,
    alwaysLoad: view.alwaysLoad,
    browserMode: view.browserMode,
    // env/headers deliberately omitted: host semantics = keep encrypted values.
  };
}

export function createMcpServersStore(
  client: BridgeClient,
  initial: McpServerView[] = [],
): StoreApi<McpServersState> {
  return createStore<McpServersState>((set, get) => ({
    list: initial.map(cloneView),
    status: initial.length > 0 ? "ready" : "idle",
    saving: {},
    tests: {},

    refresh: async () => {
      set({ status: "loading", error: undefined });
      try {
        const list = await client.invoke("bridge:listMcpServers", undefined);
        set({ list: list.map(cloneView), status: "ready" });
      } catch {
        set({ status: "error", error: "读不出 MCP 配置，请重试。" });
      }
    },

    save: async (draft) => {
      const key = draft.id ?? "__new__";
      set((state) => ({ saving: { ...state.saving, [key]: true } }));
      try {
        const view = cloneView(await client.invoke("bridge:saveMcpServer", draft));
        set((state) => {
          const exists = state.list.some((candidate) => candidate.id === view.id);
          const tests = { ...state.tests };
          delete tests[view.id];
          return {
            list: exists
              ? state.list.map((candidate) => candidate.id === view.id ? view : candidate)
              : [...state.list, view],
            saving: { ...state.saving, [key]: false },
            tests,
          };
        });
        return { ok: true, view };
      } catch {
        set((state) => ({ saving: { ...state.saving, [key]: false } }));
        return { ok: false, error: "MCP 没有保存成功，请检查配置后重试。" };
      }
    },

    remove: async (id) => {
      set((state) => ({ saving: { ...state.saving, [id]: true } }));
      try {
        await client.invoke("bridge:deleteMcpServer", { id });
        set((state) => ({
          list: state.list.filter((candidate) => candidate.id !== id),
          saving: { ...state.saving, [id]: false },
        }));
        return true;
      } catch {
        set((state) => ({ saving: { ...state.saving, [id]: false } }));
        return false;
      }
    },

    setEnabled: async (view, enabled) => {
      const result = await get().save(publicDraft(view, enabled));
      return result.ok;
    },

    test: async (id) => {
      set((state) => ({ tests: { ...state.tests, [id]: { pending: true } } }));
      try {
        const result = await client.invoke("bridge:testMcpServer", { id });
        set((state) => ({ tests: { ...state.tests, [id]: result } }));
      } catch {
        set((state) => ({
          tests: { ...state.tests, [id]: { ok: false, tools: [], error: "连接测试失败，请重试。" } },
        }));
      }
    },
  }));
}
