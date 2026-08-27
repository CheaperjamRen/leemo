import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * Preload: the ONLY bridge between the sandboxed renderer and the main process.
 * Exposes a minimal, hand-audited surface on `window.leemoBridge` — one
 * multiplexed invoke and one channel subscribe. No Node, no ipcRenderer, no
 * secrets ever reach the renderer's global scope (contextIsolation + sandbox).
 *
 * Shape mirrors src/renderer/bridge/ipc-client.ts LeemoBridgeApi.
 */

/** Push channels the host emits (BridgeEventMap keys). Allow-listed so a
 *  compromised renderer can't subscribe to arbitrary ipc channels. */
const PUSH_CHANNELS = ["bridge:event", "bridge:approvalRequest", "bridge:approvalExpired", "bridge:askUser"] as const;
type PushChannel = (typeof PUSH_CHANNELS)[number];

contextBridge.exposeInMainWorld("leemoBridge", {
  invoke(channel: string, req: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:invoke", { channel, req });
  },

  on(channel: string, cb: (payload: unknown) => void): () => void {
    if (!PUSH_CHANNELS.includes(channel as PushChannel)) {
      throw new Error(`leemoBridge.on: refusing unknown channel "${channel}"`);
    }
    const listener = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

/** Persistence surface (SQLite in main). Separate from leemoBridge because it is
 *  not part of the frozen AI-conversation contract. One multiplexed invoke; the
 *  renderer's IpcPersistenceClient wraps it. No push channels. */
contextBridge.exposeInMainWorld("leemoPersist", {
  invoke(op: string, payload: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:persist", { op, payload });
  },
});

/** Notes are durable local records with their own main-process authority. The
 * renderer receives one explicit request channel and one invalidation event;
 * it never receives the database or Electron primitives. */
contextBridge.exposeInMainWorld("leemoCapture", {
  invoke(op: string, payload?: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:capture", { op, payload });
  },

  onChanged(cb: (payload: unknown) => void): () => void {
    const listener = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on("leemo:capture:changed", listener);
    return () => ipcRenderer.removeListener("leemo:capture:changed", listener);
  },
});

/** User-authored tasks share one narrow, main-owned SQLite service with momo.
 * The renderer can request domain operations but never receives database or
 * Electron access. */
contextBridge.exposeInMainWorld("leemoTasks", {
  invoke(op: string, payload?: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:tasks", { op, payload });
  },

  onChanged(cb: () => void): () => void {
    const listener = (): void => cb();
    ipcRenderer.on("leemo:tasks:changed", listener);
    return () => ipcRenderer.removeListener("leemo:tasks:changed", listener);
  },
});

/** Recovery actions live on their own narrow channel so the renderer cannot
 * call arbitrary capture or task operations while browsing deleted records. */
contextBridge.exposeInMainWorld("leemoTrash", {
  invoke(op: string, payload?: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:trash", { op, payload });
  },
});

/** OS-level desktop integration is kept separate from ordinary settings
 * persistence. Main reports success only after the shortcut is registered and
 * the confirmed values are durable. */
contextBridge.exposeInMainWorld("leemoDesktop", {
  configure(payload: {
    continueInBackground?: boolean;
    quickCaptureShortcut?: string;
    networkMode?: "auto" | "direct" | "manual";
    manualProxyUrl?: string;
  }): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:desktop", { op: "configure", payload });
  },
  chooseCaptureStorageRoot(): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:choose-capture-storage-root");
  },
  openCaptureStorageRoot(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("leemo:open-capture-storage-root");
  },
  onNavigate(cb: (payload: unknown) => void): () => void {
    const listener = (_event: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on("leemo:desktop:navigate", listener);
    return () => ipcRenderer.removeListener("leemo:desktop:navigate", listener);
  },
});

type WindowControlOperation = "minimize" | "toggleMaximize" | "close" | "getState";

async function invokeWindowControl(op: WindowControlOperation): Promise<{ maximized: boolean }> {
  const result = await ipcRenderer.invoke("leemo:window", { op }) as {
    ok: boolean;
    response?: { maximized?: boolean };
    error?: string;
  };
  if (!result.ok) throw new Error(result.error ?? "窗口操作没有完成。");
  return { maximized: result.response?.maximized === true };
}

contextBridge.exposeInMainWorld("leemoWindow", {
  async minimize(): Promise<void> {
    await invokeWindowControl("minimize");
  },
  toggleMaximize(): Promise<{ maximized: boolean }> {
    return invokeWindowControl("toggleMaximize");
  },
  async close(): Promise<void> {
    await invokeWindowControl("close");
  },
  getState(): Promise<{ maximized: boolean }> {
    return invokeWindowControl("getState");
  },
  onMaximizedChanged(cb: (maximized: boolean) => void): () => void {
    const listener = (_event: unknown, payload: unknown): void => {
      const maximized = payload && typeof payload === "object"
        ? (payload as { maximized?: unknown }).maximized
        : undefined;
      if (typeof maximized === "boolean") cb(maximized);
    };
    ipcRenderer.on("leemo:window:maximized-changed", listener);
    return () => ipcRenderer.removeListener("leemo:window:maximized-changed", listener);
  },
});

/** About and diagnostics expose only fixed runtime metadata and one main-owned
 * logs-directory action. Paths, credentials and conversation data never cross
 * this boundary. */
contextBridge.exposeInMainWorld("leemoAbout", {
  getInfo(): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:about", { op: "getInfo" });
  },
  openLogsDirectory(): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("leemo:about", { op: "openLogsDirectory" });
  },
});

/** Local scheduled-task surface. Time and recovery stay in main; the renderer
 * receives only a durable run id after the occurrence has been stored. */
contextBridge.exposeInMainWorld("leemoScheduler", {
  invoke(op: string, payload: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:scheduler", { op, payload });
  },

  onDue(cb: (payload: unknown) => void): () => void {
    const listener = (_e: unknown, payload: unknown): void => cb(payload);
    ipcRenderer.on("leemo:scheduler:due", listener);
    return () => ipcRenderer.removeListener("leemo:scheduler:due", listener);
  },
});

/** English-learning records are structured local data, not long-term-memory
 * prompt content. Keep them behind a narrow local IPC surface. */
contextBridge.exposeInMainWorld("leemoLearning", {
  invoke(op: string, payload: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:learning", { op, payload });
  },
});

/** Workspace surface (Leemo 主工作区、本子和用户选择的外部文件夹). Separate from
 *  leemoBridge for the same reason as leemoPersist: the filesystem is not part
 *  of the frozen AI-conversation contract (10 号 §S11). One multiplexed invoke,
 *  no push channels.
 *
 *  `pathForFile` is the one capability that CANNOT live in the renderer:
 *  Electron 32 removed `File.path`, so `webUtils.getPathForFile` in the preload
 *  is the only way to learn where a dropped file actually is. Note the
 *  direction — the renderer asks main to READ a path off an object it already
 *  holds; it never gains the ability to name arbitrary paths. New workspace
 *  roots can only enter through main's native directory picker; later calls use
 *  an opaque registered id. */
contextBridge.exposeInMainWorld("leemoWorkspace", {
  invoke(op: string, payload: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }> {
    return ipcRenderer.invoke("leemo:workspace", { op, payload });
  },

  pathForFile(file: File): string {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      // Not a real OS file (a synthetic drag, a string payload) — the caller
      // treats "" as "nothing droppable here" rather than crashing the drop.
      return "";
    }
  },
});
