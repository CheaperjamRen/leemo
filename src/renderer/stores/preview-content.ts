import { createStore, type StoreApi } from "zustand/vanilla";
import type { PreviewPayload, WorkspaceClient } from "../workspace/client";

/**
 * 预览区的内容层（轮 4「预览区通电」）。
 *
 * 在此之前 `PreviewPane` 里有个写死的 `FIXTURE_CONTENT: Record<string,string> = {}`
 * ——点开任何文件都落到 `?? "(内容加载中)"`，也就是**永远**在"加载中"。这个 store
 * 就是那句 fixture 的替代：路径 → 真实内容 + 四态（loading/ok/error/无工作区）。
 *
 * 为什么按 path 存一张表而不是只存"当前那一个"：预览区是多标签的（02 §九），
 * 标签之间切来切换回去不该每次都重读磁盘、也不该在切换瞬间闪一下空白。
 */

export interface PreviewEntry {
  status: "loading" | "ready" | "error";
  payload?: PreviewPayload;
  /** 人话错误（main 抛的就是中文，原样展示）。 */
  error?: string;
  errorKind?: PreviewErrorKind;
}

export interface PreviewDraft {
  originalText: string;
  text: string;
  status: "clean" | "dirty" | "saving" | "error";
  error?: string;
  savedAt?: number;
}

export function previewDraftKey(workspaceId: string | undefined, path: string): string {
  return `${workspaceId ?? ""}\u0000${path}`;
}

export type PreviewErrorKind = "missing" | "permission" | "directory" | "workspace" | "unknown";

export function classifyPreviewError(message: string): PreviewErrorKind {
  if (/没有连上工作区|没有连接本子文件夹|当前环境读不了文件/i.test(message)) return "workspace";
  if (/读不到这个文件|ENOENT|no such file|not found/i.test(message)) return "missing";
  if (/EACCES|EPERM|permission denied|access denied|拒绝访问|没有权限/i.test(message)) return "permission";
  if (/这是个文件夹|is a directory|EISDIR/i.test(message)) return "directory";
  return "unknown";
}

export interface PreviewContentState {
  byPath: Record<string, PreviewEntry>;
  drafts: Record<string, PreviewDraft>;
  /** 读一个文件。已在读或已读好就不重复读，除非 `force`。 */
  load(path: string, opts?: { force?: boolean }): Promise<void>;
  /** 标签关掉时扔掉内容 —— 一个 25MB 的 PDF base64 不该在关掉之后还留在内存里。 */
  forget(path: string): void;
  /** Drop cached payloads when the relative paths now point at another root. */
  clear(): void;
  beginEdit(path: string, originalText: string): void;
  updateDraft(path: string, text: string): void;
  saveDraft(path: string): Promise<boolean>;
  discardDraft(path: string): void;
  /** Remove every editor snapshot owned by one workspace, even after the
   * active workspace id has already changed. */
  discardWorkspaceDrafts(workspaceId: string): void;
}

export function createPreviewContentStore(
  workspace?: WorkspaceClient,
  options: {
    resolveWorkspaceId?: () => string;
    /** Browser-only visual fixtures. Production never supplies these. */
    initialEntries?: Record<string, PreviewEntry>;
  } = {},
): StoreApi<PreviewContentState> {
  // 同一路径的并发读收敛成一次：标签切换 + 首次挂载很容易同时触发。
  const inFlight = new Map<string, Promise<void>>();
  let generation = 0;
  let workspaceObserved = false;
  let observedWorkspaceId: string | undefined;

  return createStore<PreviewContentState>((set, get) => ({
    byPath: options.initialEntries ?? {},
    drafts: {},

    load: async (path, opts = {}) => {
      if (!path) return;
      if (!workspace) {
        const fixtureEntry = get().byPath[path];
        if (!opts.force && fixtureEntry?.status === "ready") return;
        // 浏览器 dev 里根本没有文件系统。说清楚是"这个环境读不了"，而不是让用户
        // 对着一个空白面板猜文件是不是坏了。
        set((s) => ({
          byPath: {
            ...s.byPath,
            [path]: {
              status: "error",
              error: "当前环境读不了文件（没有连接本子文件夹）",
              errorKind: "workspace",
            },
          },
        }));
        return;
      }

      const workspaceId = options.resolveWorkspaceId?.();
      if (!workspaceObserved) {
        workspaceObserved = true;
        observedWorkspaceId = workspaceId;
      } else if (workspaceId !== observedWorkspaceId) {
        observedWorkspaceId = workspaceId;
        generation += 1;
        inFlight.clear();
        set({ byPath: {} });
      }
      const requestGeneration = generation;
      const requestKey = `${workspaceId ?? ""}\u0000${path}`;

      const existing = get().byPath[path];
      if (!opts.force && existing?.status === "ready") return;
      const running = inFlight.get(requestKey);
      if (running && !opts.force) return running;

      let task!: Promise<void>;
      task = (async () => {
        set((s) => ({ byPath: { ...s.byPath, [path]: { status: "loading" } } }));
        try {
          const payload = workspaceId === undefined
            ? await workspace.readPreview(path)
            : await workspace.readPreview(path, workspaceId);
          if (generation !== requestGeneration) return;
          set((s) => ({ byPath: { ...s.byPath, [path]: { status: "ready", payload } } }));
        } catch (e: unknown) {
          if (generation !== requestGeneration) return;
          const error = e instanceof Error ? e.message : String(e);
          set((s) => ({
            byPath: {
              ...s.byPath,
              [path]: { status: "error", error, errorKind: classifyPreviewError(error) },
            },
          }));
        } finally {
          if (inFlight.get(requestKey) === task) inFlight.delete(requestKey);
        }
      })();

      inFlight.set(requestKey, task);
      return task;
    },

    forget: (path) => set((s) => {
      if (!(path in s.byPath)) return s;
      const next = { ...s.byPath };
      delete next[path];
      return { byPath: next };
    }),

    clear: () => {
      generation += 1;
      inFlight.clear();
      set({ byPath: {} });
    },

    beginEdit: (path, originalText) => {
      const key = previewDraftKey(options.resolveWorkspaceId?.(), path);
      set((state) => state.drafts[key]
        ? state
        : {
            drafts: {
              ...state.drafts,
              [key]: { originalText, text: originalText, status: "clean" },
            },
          });
    },

    updateDraft: (path, text) => {
      const key = previewDraftKey(options.resolveWorkspaceId?.(), path);
      set((state) => {
        const current = state.drafts[key];
        if (!current || current.status === "saving") return state;
        return {
          drafts: {
            ...state.drafts,
            [key]: {
              ...current,
              text,
              status: text === current.originalText ? "clean" : "dirty",
              error: undefined,
            },
          },
        };
      });
    },

    saveDraft: async (path) => {
      const workspaceId = options.resolveWorkspaceId?.();
      const key = previewDraftKey(workspaceId, path);
      const draft = get().drafts[key];
      if (!draft || draft.status === "clean") return true;
      if (draft.status === "saving") return false;
      if (!workspace?.writeMarkdownFile) {
        set((state) => ({
          drafts: {
            ...state.drafts,
            [key]: {
              ...state.drafts[key],
              status: "error",
              error: "当前环境不能保存文件。你的草稿仍保留在这里。",
            },
          },
        }));
        return false;
      }

      const savingText = draft.text;
      const expectedText = draft.originalText;
      set((state) => ({
        drafts: {
          ...state.drafts,
          [key]: { ...state.drafts[key], status: "saving", error: undefined },
        },
      }));
      try {
        const payload = workspaceId === undefined
          ? await workspace.writeMarkdownFile(path, savingText, expectedText)
          : await workspace.writeMarkdownFile(path, savingText, expectedText, workspaceId);
        set((state) => {
          const stillViewingSavedWorkspace = options.resolveWorkspaceId?.() === workspaceId;
          return {
            ...(stillViewingSavedWorkspace
              ? { byPath: { ...state.byPath, [path]: { status: "ready" as const, payload } } }
              : {}),
            drafts: {
              ...state.drafts,
              [key]: {
                originalText: savingText,
                text: savingText,
                status: "clean",
                savedAt: Date.now(),
              },
            },
          };
        });
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({
          drafts: {
            ...state.drafts,
            [key]: {
              ...state.drafts[key],
              status: "error",
              error: message,
            },
          },
        }));
        return false;
      }
    },

    discardDraft: (path) => {
      const key = previewDraftKey(options.resolveWorkspaceId?.(), path);
      set((state) => {
        if (!(key in state.drafts)) return state;
        const drafts = { ...state.drafts };
        delete drafts[key];
        return { drafts };
      });
    },

    discardWorkspaceDrafts: (workspaceId) => {
      const prefix = `${workspaceId}\u0000`;
      set((state) => {
        const entries = Object.entries(state.drafts);
        if (!entries.some(([key]) => key.startsWith(prefix))) return state;
        return {
          drafts: Object.fromEntries(entries.filter(([key]) => !key.startsWith(prefix))),
        };
      });
    },
  }));
}
