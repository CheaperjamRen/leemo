import { createStore, type StoreApi } from "zustand/vanilla";
import type { WorkspaceClient, PlacedFile } from "../workspace/client";

/**
 * The real ~/Leemo/ tree as a UI mirror (轮 3 卡 G, 10 号 §S11).
 *
 * `path` is workspace-RELATIVE with "/" separators, and its FIRST SEGMENT is the
 * owning notebook id — which is what makes `artifacts.ts bookForPath` work.
 * (The old fixture used "/books/A/…", whose first segment was "books", so that
 * lookup silently matched nothing.) The renderer never holds an absolute path;
 * main re-validates every path it receives against the workspace root.
 */
export interface FileNode {
  path: string;
  name: string;
  kind: "file" | "dir";
  bookId: string | null;
  children?: FileNode[];
  isNew?: boolean;
  referenced?: boolean;
}

export interface FileTreeState {
  roots: FileNode[];
  expandedPaths: Set<string>;
  loading: boolean;
  error: string | null;
  toggleExpand(path: string): void;
  /** Re-read the tree from disk (no fs.watch — see 轮 3 卡 G 抉择②). */
  refresh(): Promise<void>;
  /** Really MOVE the file into a notebook, then re-read. Rejects on failure:
   *  the previous implementation only relabelled `bookId` in memory, so the UI
   *  claimed a move that had not happened and a refresh silently undid it. */
  moveToBook(path: string, bookId: string | null): Promise<void>;
  /** File dropped OS files (absolute paths) into a notebook, or 默认工作区 when
   *  bookId is null (06 §2.2), then re-read. */
  dropFiles(sources: string[], bookId: string | null, workspaceId?: string): Promise<PlacedFile[]>;
}

export function createFileTreeStore(
  workspace?: WorkspaceClient,
  initialRoots: FileNode[] = [],
  options: { resolveWorkspaceId?: () => string } = {},
): StoreApi<FileTreeState> {
  const inFlight = new Map<string, Promise<void>>();
  let selectedRequestKey: string | null = null;

  return createStore<FileTreeState>((set, get) => {
    const refresh = async (): Promise<void> => {
      if (!workspace) return;
      const workspaceId = options.resolveWorkspaceId?.();
      const requestKey = workspaceId ?? "__legacy-home__";
      selectedRequestKey = requestKey;
      const running = inFlight.get(requestKey);
      if (running) return running;
      let task!: Promise<void>;
      task = (async () => {
        set({ loading: true });
        try {
          const roots = workspaceId === undefined
            ? await workspace.readTree()
            : await workspace.readTree(workspaceId);
          if (selectedRequestKey !== requestKey) return;
          set({ roots, loading: false, error: null });
        } catch (e: unknown) {
          if (selectedRequestKey !== requestKey) return;
          // Keep the tree on screen: a transient read error should not look
          // like "your files are gone".
          set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
          if (inFlight.get(requestKey) === task) inFlight.delete(requestKey);
        }
      })();
      inFlight.set(requestKey, task);
      return task;
    };

    return {
      roots: initialRoots,
      expandedPaths: new Set<string>(),
      loading: false,
      error: null,

      toggleExpand: (path) =>
        set((state) => {
          const next = new Set(state.expandedPaths);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return { expandedPaths: next };
        }),

      refresh,

      moveToBook: async (path, bookId) => {
        if (!workspace) return;
        try {
          const workspaceId = options.resolveWorkspaceId?.();
          if (workspaceId === undefined) await workspace.moveFile(path, bookId);
          else await workspace.moveFile(path, bookId, workspaceId);
        } catch (e: unknown) {
          set({ error: e instanceof Error ? e.message : String(e) });
          throw e instanceof Error ? e : new Error(String(e));
        }
        set({ error: null });
        await refresh();
      },

      dropFiles: async (sources, bookId, requestedWorkspaceId) => {
        if (!workspace) return [];
        let placed: PlacedFile[];
        try {
          const workspaceId = requestedWorkspaceId ?? options.resolveWorkspaceId?.();
          placed = workspaceId === undefined
            ? await workspace.dropFiles(sources, bookId)
            : await workspace.dropFiles(sources, bookId, workspaceId);
        } catch (e: unknown) {
          set({ error: e instanceof Error ? e.message : String(e) });
          throw e instanceof Error ? e : new Error(String(e));
        }
        set({ error: null });
        await refresh();
        // Expand the receiving notebook so the user SEES where the file landed.
        const first = placed[0];
        if (first?.bookId) {
          const book = first.bookId;
          set((state) => {
            const next = new Set(state.expandedPaths);
            next.add(book);
            return { expandedPaths: next };
          });
        }
        return placed;
      },
    };
  });
}
