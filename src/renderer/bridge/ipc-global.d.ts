import type { LeemoBridgeApi } from "./ipc-client";
import type { LeemoPersistApi } from "../persistence/ipc-persistence-client";
import type { LeemoWorkspaceApi } from "../workspace/ipc-workspace-client";
import type { LeemoSchedulerApi } from "../scheduler/client";
import type { LeemoLearningApi } from "../learning/client";
import type { LeemoCaptureApi, LeemoQuickCaptureApi } from "../capture/client";
import type { LeemoTasksApi } from "../tasks/client";
import type { LeemoTrashApi } from "../trash/client";

interface LeemoDesktopApi {
  configure(payload: {
    continueInBackground?: boolean;
    quickCaptureShortcut?: string;
  }): Promise<
    | {
      ok: true;
      response: {
        continueInBackground: boolean;
        quickCaptureShortcut: string;
        captureStorageRoot?: string;
      };
    }
    | { ok: false; error: string }
  >;
  chooseCaptureStorageRoot(): Promise<
    | { ok: true; response?: string }
    | { ok: false; error: string }
  >;
  openCaptureStorageRoot(): Promise<
    | { ok: true }
    | { ok: false; error: string }
  >;
  onNavigate(listener: (target:
    | { kind: "conversation"; conversationId: string }
    | { kind: "task"; taskId: string }
  ) => void): () => void;
}

interface LeemoAboutInfo {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
  diagnostics: string;
}

interface LeemoAboutApi {
  getInfo(): Promise<
    | { ok: true; response: LeemoAboutInfo }
    | { ok: false; error: string }
  >;
  openLogsDirectory(): Promise<
    | { ok: true }
    | { ok: false; error: string }
  >;
}

interface LeemoWindowApi {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<{ maximized: boolean }>;
  close(): Promise<void>;
  getState(): Promise<{ maximized: boolean }>;
  onMaximizedChanged(listener: (maximized: boolean) => void): () => void;
}

/** The preload script (src/main/preload.ts) injects these via contextBridge when
 *  the renderer runs inside Electron. Absent in browser dev — App.tsx falls back
 *  to WsBridgeClient / FixtureBridgeClient, and persistence is disabled. */
declare global {
  interface Window {
    leemoBridge?: LeemoBridgeApi;
    leemoPersist?: LeemoPersistApi;
    leemoScheduler?: LeemoSchedulerApi;
    leemoLearning?: LeemoLearningApi;
    leemoCapture?: LeemoCaptureApi;
    leemoTasks?: LeemoTasksApi;
    leemoTrash?: LeemoTrashApi;
    leemoQuickCapture?: LeemoQuickCaptureApi;
    leemoDesktop?: LeemoDesktopApi;
    leemoWindow?: LeemoWindowApi;
    leemoAbout?: LeemoAboutApi;
    /** 主工作区、本子、外部工作区和文件树的 Electron-only surface. */
    leemoWorkspace?: LeemoWorkspaceApi;
  }
}

export {};
