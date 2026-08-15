import { createStore, type StoreApi } from "zustand/vanilla";
import type { WorkspaceClient, WorkspaceRootInfo } from "../workspace/client";

export const HOME_WORKSPACE_ID = "leemo-home";

export const HOME_WORKSPACE: WorkspaceRootInfo = {
  id: HOME_WORKSPACE_ID,
  name: "Leemo",
  displayPath: "",
  kind: "home",
  available: true,
  lastOpenedAt: 0,
  archived: false,
};

export interface WorkspacesState {
  list: WorkspaceRootInfo[];
  activeId: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** The only time the one-line .leemo notice is shown. */
  justOpenedId: string | null;
  refresh(): Promise<void>;
  openFolder(): Promise<string | null>;
  select(id: string): Promise<boolean>;
  rename(id: string, name: string): Promise<boolean>;
  setArchived(id: string, archived: boolean): Promise<boolean>;
  forget(id: string): Promise<boolean>;
  dismissNotice(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeList(list: WorkspaceRootInfo[]): WorkspaceRootInfo[] {
  const home = list.find((entry) => entry.id === HOME_WORKSPACE.id && entry.kind === "home")
    ?? HOME_WORKSPACE;
  const seen = new Set([home.id]);
  const externals = list
    .filter((entry) => {
      if (entry.kind !== "external" || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  return [home, ...externals];
}

export function createWorkspacesStore(
  workspace?: WorkspaceClient,
  initial: WorkspaceRootInfo[] = [HOME_WORKSPACE],
): StoreApi<WorkspacesState> {
  let inFlight: Promise<void> | null = null;
  return createStore<WorkspacesState>((set, get) => ({
    list: normalizeList(initial),
    activeId: HOME_WORKSPACE.id,
    status: workspace?.listWorkspaces ? "idle" : "ready",
    error: null,
    justOpenedId: null,

    refresh: async () => {
      if (!workspace?.listWorkspaces) return;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        set({ status: "loading", error: null });
        try {
          const incoming = await workspace.listWorkspaces!();
          if (!Array.isArray(incoming)) throw new Error("本子列表格式不对，请重启 Leemo 后再试。");
          const list = normalizeList(incoming);
          const activeId = list.some((entry) => entry.id === get().activeId)
            ? get().activeId
            : HOME_WORKSPACE.id;
          set({ list, activeId, status: "ready", error: null });
        } catch (error: unknown) {
          set({ status: "error", error: errorMessage(error) });
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },

    openFolder: async () => {
      if (!workspace?.pickWorkspace) {
        set({ error: "当前环境不能打开本子文件夹。", status: "error" });
        return null;
      }
      set({ status: "loading", error: null });
      try {
        const picked = await workspace.pickWorkspace();
        if (picked === null) {
          set({ status: "ready" });
          return null;
        }
        const list = normalizeList([...get().list.filter((entry) => entry.id !== picked.id), picked]);
        set({
          list,
          activeId: picked.id,
          status: "ready",
          error: null,
          justOpenedId: picked.kind === "external" ? picked.id : null,
        });
        return picked.id;
      } catch (error: unknown) {
        set({ status: "error", error: errorMessage(error) });
        return null;
      }
    },

    select: async (id) => {
      const target = get().list.find((entry) => entry.id === id);
      if (!target) {
        set({ error: "没有这个本子，请重新打开文件夹。" });
        return false;
      }
      if (!target.available) {
        set({ error: `找不到「${target.name}」文件夹，请重新打开它。` });
        return false;
      }
      try {
        const touched = workspace?.touchWorkspace ? await workspace.touchWorkspace(id) : target;
        set({
          list: normalizeList([...get().list.filter((entry) => entry.id !== id), touched]),
          activeId: id,
          error: null,
          status: "ready",
          justOpenedId: null,
        });
        return true;
      } catch (error: unknown) {
        set({ error: errorMessage(error), status: "error" });
        return false;
      }
    },

    rename: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) {
        set({ error: "本子显示名称不能为空。" });
        return false;
      }
      if (!workspace?.updateWorkspace) {
        set({ error: "当前环境不能修改本子名称。" });
        return false;
      }
      try {
        const updated = await workspace.updateWorkspace(id, { name: trimmed });
        set({
          list: normalizeList([...get().list.filter((entry) => entry.id !== id), updated]),
          error: null,
          status: "ready",
        });
        return true;
      } catch (error: unknown) {
        set({ error: errorMessage(error), status: "error" });
        return false;
      }
    },

    setArchived: async (id, archived) => {
      if (!workspace?.updateWorkspace) {
        set({ error: "当前环境不能归档这个本子。" });
        return false;
      }
      try {
        const updated = await workspace.updateWorkspace(id, { archived });
        set({
          list: normalizeList([...get().list.filter((entry) => entry.id !== id), updated]),
          activeId: archived && get().activeId === id ? HOME_WORKSPACE.id : get().activeId,
          error: null,
          status: "ready",
        });
        return true;
      } catch (error: unknown) {
        set({ error: errorMessage(error), status: "error" });
        return false;
      }
    },

    forget: async (id) => {
      if (id === HOME_WORKSPACE.id) {
        set({ error: "Leemo 工作台不能从本子列表移除。" });
        return false;
      }
      if (!workspace?.forgetWorkspace) {
        set({ error: "当前环境不能从本子列表移除文件夹。" });
        return false;
      }
      try {
        const removed = await workspace.forgetWorkspace(id);
        if (!removed) return false;
        set({
          list: get().list.filter((entry) => entry.id !== id),
          activeId: get().activeId === id ? HOME_WORKSPACE.id : get().activeId,
          error: null,
          justOpenedId: get().justOpenedId === id ? null : get().justOpenedId,
        });
        return true;
      } catch (error: unknown) {
        set({ error: errorMessage(error), status: "error" });
        return false;
      }
    },

    dismissNotice: () => set({ justOpenedId: null }),
  }));
}
