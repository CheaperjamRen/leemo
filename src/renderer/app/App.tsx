import { useMemo } from "react";
import { BridgeProvider, useSettings } from "../bridge/context";
import { WsBridgeClient } from "../bridge/ws-client";
import { IpcBridgeClient } from "../bridge/ipc-client";
import { IpcPersistenceClient } from "../persistence/ipc-persistence-client";
import { IpcWorkspaceClient } from "../workspace/ipc-workspace-client";
import { IpcSchedulerClient } from "../scheduler/client";
import { IpcLearningClient } from "../learning/client";
import { IpcCaptureClient } from "../capture/client";
import { IpcTaskClient } from "../tasks/client";
import BuddyShell from "../components/BuddyShell";
import WorkbenchShell from "../components/WorkbenchShell";
import StartShell from "../start/StartShell";
import { OnboardingWizard } from "../components/OnboardingWizard";
import AppOverlays from "../components/AppOverlays";

function AppShell() {
  const surface = useSettings((s) => s.surface);
  const mode = useSettings((s) => s.mode);
  return (
    <>
      {surface === "start"
        ? <StartShell />
        : mode === "buddy"
          ? <BuddyShell />
          : <WorkbenchShell />}
      <AppOverlays />
      <OnboardingWizard />
    </>
  );
}

export default function App() {
  // Transport selection (highest priority first):
  //  1. Electron IPC  — window.leemoBridge injected by the preload (desktop app)
  //  2. WebSocket     — VITE_LEEMO_LIVE=1 opt-in for browser dev against bridge:dev
  //  3. Fixture       — default (no client): replays DEMO_TURN_EVENTS, no real AI
  const ipcApi = typeof window !== "undefined" ? window.leemoBridge : undefined;
  const persistApi = typeof window !== "undefined" ? window.leemoPersist : undefined;
  const workspaceApi = typeof window !== "undefined" ? window.leemoWorkspace : undefined;
  const schedulerApi = typeof window !== "undefined" ? window.leemoScheduler : undefined;
  const learningApi = typeof window !== "undefined" ? window.leemoLearning : undefined;
  const captureApi = typeof window !== "undefined" ? window.leemoCapture : undefined;
  const tasksApi = typeof window !== "undefined" ? window.leemoTasks : undefined;
  const wsLive = import.meta.env.VITE_LEEMO_LIVE === "1";
  const live = Boolean(ipcApi) || wsLive;

  const client = useMemo(() => {
    if (ipcApi) return new IpcBridgeClient(ipcApi);
    if (wsLive) return new WsBridgeClient(import.meta.env.VITE_LEEMO_BRIDGE_URL);
    return undefined;
  }, [ipcApi, wsLive]);

  // Persistence is Electron-only (SQLite in main). Absent in browser dev → the
  // stores stay in-memory. Requires the IPC transport (window.leemoPersist).
  const persist = useMemo(
    () => (persistApi ? new IpcPersistenceClient(persistApi) : undefined),
    [persistApi],
  );

  // Workspace (本子 = 目录 under ~/Leemo, 轮 3 卡 G) is likewise Electron-only:
  // it needs a real filesystem. Absent in browser dev → notebooks stay empty and
  // the file tree falls back to fixture data.
  const workspace = useMemo(
    () => (workspaceApi ? new IpcWorkspaceClient(workspaceApi) : undefined),
    [workspaceApi],
  );

  const scheduler = useMemo(
    () => (schedulerApi ? new IpcSchedulerClient(schedulerApi) : undefined),
    [schedulerApi],
  );
  const learning = useMemo(
    () => (learningApi ? new IpcLearningClient(learningApi) : undefined),
    [learningApi],
  );
  const capture = useMemo(
    () => (captureApi ? new IpcCaptureClient(captureApi) : undefined),
    [captureApi],
  );
  const tasks = useMemo(
    () => (tasksApi ? new IpcTaskClient(tasksApi) : undefined),
    [tasksApi],
  );

  return (
    <BridgeProvider client={client} live={live} persist={persist} workspace={workspace} scheduler={scheduler} learning={learning} capture={capture} tasks={tasks}>
      <AppShell />
    </BridgeProvider>
  );
}
