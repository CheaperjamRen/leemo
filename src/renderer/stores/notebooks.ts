import { createStore, type StoreApi } from "zustand/vanilla";
import type { WorkspaceClient, WorkspaceNotebook } from "../workspace/client";

/**
 * 本子 (notebook) = a DIRECTORY under ~/Leemo (06 §五, 轮 3 卡 G).
 *
 * The directory name remains the stable id. Display rename/archive metadata is
 * projected by main and never changes, moves or deletes the real folder.
 */
export type Notebook = WorkspaceNotebook;

export interface NotebooksState {
  list: Notebook[];
  /** Absolute workspace root (~/Leemo), display-only; "" until first refresh. */
  root: string;
  /** The 本子 the user is working in. Drives 拖入归类 (06 §2.2: a drop with a
   *  notebook context lands straight in it) and prompt layer ⑨ (06 §7.4). */
  activeId: string | null;
  loading: boolean;
  /** Last failure, in the user-facing wording main produced. */
  error: string | null;
  /** Re-read the directories. Explicit rather than fs.watch: Windows watch
   *  events are noisy/duplicated, and every mutation here already knows to
   *  refresh. */
  refresh(): Promise<void>;
  /** Create the real directory. Rejects (does not silently no-op) so the caller
   *  can show why — duplicate name, illegal characters. */
  createNotebook(title: string): Promise<string>;
  renameNotebook(id: string, title: string): Promise<boolean>;
  setNotebookArchived(id: string, archived: boolean): Promise<boolean>;
  setActive(id: string | null): void;
}

export function createNotebooksStore(
  workspace?: WorkspaceClient,
  initial: Notebook[] = [],
): StoreApi<NotebooksState> {
  // Concurrent refreshes collapse into one read: mount + a just-created notebook
  // + a drop landing can easily fire together.
  let inFlight: Promise<void> | null = null;

  return createStore<NotebooksState>((set, get) => ({
    list: initial.map((n) => ({ ...n })),
    root: "",
    activeId: null,
    loading: false,
    error: null,

    refresh: async () => {
      if (!workspace) return; // browser dev / fixtures: no filesystem at all
      if (inFlight) return inFlight;

      inFlight = (async () => {
        set({ loading: true });
        try {
          const { root, notebooks } = await workspace.listNotebooks();
          // Drop an activeId whose directory is gone (deleted in Explorer):
          // otherwise every new conversation would carry a dead bookId.
          const active = get().activeId;
          const stillThere = active !== null && notebooks.some((n) => n.id === active);
          set({
            list: notebooks,
            root,
            loading: false,
            error: null,
            ...(active !== null && !stillThere ? { activeId: null } : {}),
          });
        } catch (e: unknown) {
          // Keep whatever list we had: a transient read failure should not blank
          // the sidebar the user is looking at.
          set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },

    createNotebook: async (title) => {
      const trimmed = title.trim();
      // Reject before the IPC hop — no reason to ask main to validate a blank.
      if (!trimmed) {
        const error = "本子名不能为空";
        set({ error });
        throw new Error(error);
      }
      if (!workspace) {
        const error = "当前环境不能建本子（没有连接本子文件夹）";
        set({ error });
        throw new Error(error);
      }

      try {
        const book = await workspace.createNotebook(trimmed);
        set((state) => ({
          // Sort by id to match main's ordering, so the new notebook appears
          // where a refresh would also put it.
          list: [...state.list.filter((b) => b.id !== book.id), book].sort((a, b) =>
            a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
          ),
          // Select it: the user just made this notebook, so the next drop and
          // the next conversation should belong to it.
          activeId: book.id,
          error: null,
        }));
        return book.id;
      } catch (e: unknown) {
        const error = e instanceof Error ? e.message : String(e);
        set({ error });
        throw e instanceof Error ? e : new Error(error);
      }
    },

    renameNotebook: async (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) {
        set({ error: "本子显示名称不能为空" });
        return false;
      }
      if (!workspace?.updateNotebook) {
        set({ error: "当前环境不能修改本子名称。" });
        return false;
      }
      try {
        const updated = await workspace.updateNotebook(id, { title: trimmed });
        set((state) => ({
          list: state.list.map((book) => book.id === id ? updated : book)
            .sort((left, right) => left.title.localeCompare(right.title, "zh-CN")),
          error: null,
        }));
        return true;
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },

    setNotebookArchived: async (id, archived) => {
      if (!workspace?.updateNotebook) {
        set({ error: "当前环境不能归档这个本子。" });
        return false;
      }
      try {
        const updated = await workspace.updateNotebook(id, { archived });
        set((state) => ({
          list: state.list.map((book) => book.id === id ? updated : book),
          activeId: archived && state.activeId === id ? null : state.activeId,
          error: null,
        }));
        return true;
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },

    setActive: (id) => set({ activeId: id }),
  }));
}
