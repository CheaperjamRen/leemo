import type { LeemoBridgeApi } from "./ipc-client";
import type { LeemoPersistApi } from "../persistence/ipc-persistence-client";
import type { LeemoWorkspaceApi } from "../workspace/ipc-workspace-client";
import type { LeemoSchedulerApi } from "../scheduler/client";
import type { LeemoLearningApi } from "../learning/client";

/** The preload script (src/main/preload.ts) injects these via contextBridge when
 *  the renderer runs inside Electron. Absent in browser dev — App.tsx falls back
 *  to WsBridgeClient / FixtureBridgeClient, and persistence is disabled. */
declare global {
  interface Window {
    leemoBridge?: LeemoBridgeApi;
    leemoPersist?: LeemoPersistApi;
    leemoScheduler?: LeemoSchedulerApi;
    leemoLearning?: LeemoLearningApi;
    /** 主工作区、本子、外部工作区和文件树的 Electron-only surface. */
    leemoWorkspace?: LeemoWorkspaceApi;
  }
}

export {};
