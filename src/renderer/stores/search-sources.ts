import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  SearchCredentialDraft,
  SearchSourceId,
  SearchSourceStatus,
} from "../../bridge/contract";
import type { BridgeClient } from "../bridge/client";

/**
 * 联网搜索源的配置状态（轮 4 卡 H2 / 卡 H 的设置页收尾）。
 *
 * **状态里没有 key 字段，一个都没有** —— 明文 key 只在主进程的 safeStorage 加密件
 * 里，`bridge:getSearchSources` 只回"配没配"。这个 store 拿不到 key，也就不可能
 * 把 key 渲染进 DOM、写进日志、或随 devtools 快照泄出去。照 `getProviderConfig`
 * 的同一条规矩（key 只能 renderer→main，绝不 main→renderer）。
 */
export interface SearchSourcesState {
  list: SearchSourceStatus[];
  status: "idle" | "loading" | "ready" | "error";
  /** 加载失败的原因。设置页要报真话，不是静默显示一个空列表。 */
  error?: string;
  /** 每个源单独的保存态 —— 一个源存失败不该让另外两个看起来也失败。 */
  saving: Partial<Record<SearchSourceId, true>>;
  /** 每个源单独的保存错误（host 没有加密件时会抛，必须让用户看见）。 */
  saveError: Partial<Record<SearchSourceId, string>>;
  refresh(): Promise<void>;
  /**
   * 存 key。**空串 = 清除**（用户要能撤回，不能只能覆盖）—— 所以这里不 trim 掉
   * 空值就当没填，空串是一个有意义的值，照原样送到 host。
   * 返回是否成功，方便调用方决定要不要清输入框。
   */
  saveCredentials(draft: SearchCredentialDraft): Promise<boolean>;
}

export interface SearchSourcesInitial {
  list?: SearchSourceStatus[];
  status?: SearchSourcesState["status"];
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createSearchSourcesStore(
  client: BridgeClient,
  initial: SearchSourcesInitial = {}
): StoreApi<SearchSourcesState> {
  return createStore<SearchSourcesState>((set) => ({
    list: initial.list ?? [],
    status: initial.status ?? "idle",
    saving: {},
    saveError: {},

    refresh: async () => {
      set({ status: "loading", error: undefined });
      try {
        const list = await client.invoke("bridge:getSearchSources", undefined);
        // 形状守卫：IPC 回来的东西是运行时数据，不是类型保证。非数组（老 host、
        // 夹具、通道没实现）若直接放进 state，渲染时 .map 会把设置页整页打白。
        if (!Array.isArray(list)) {
          set({ status: "error", error: "搜索源配置格式不对（主进程可能版本不匹配）" });
          return;
        }
        set({ list, status: "ready" });
      } catch (e: unknown) {
        // 空列表 + ready 会让用户以为"没有可配的源"。必须是 error 态。
        set({ status: "error", error: message(e) });
      }
    },

    saveCredentials: async (draft) => {
      const source = draft.source;
      set((s) => ({
        saving: { ...s.saving, [source]: true as const },
        saveError: { ...s.saveError, [source]: undefined },
      }));
      try {
        const list = await client.invoke("bridge:saveSearchKey", draft);
        set((s) => {
          const saving = { ...s.saving };
          delete saving[source];
          // 同样的形状守卫：存成功但回包畸形时保留旧列表，不要把 state 弄坏。
          return Array.isArray(list)
            ? { list, saving, status: "ready" as const }
            : { saving };
        });
        return true;
      } catch (e: unknown) {
        // 保存失败绝不能静默假装存好了 —— 用户会以为配好了，然后搜索一直不工作。
        set((s) => {
          const saving = { ...s.saving };
          delete saving[source];
          return { saving, saveError: { ...s.saveError, [source]: message(e) } };
        });
        return false;
      }
    },
  }));
}
