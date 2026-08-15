import { createStore, type StoreApi } from "zustand/vanilla";
import type { SchedulerClient } from "../scheduler/client";
import type { ConversationsState } from "./conversations";
import type { NotificationsState } from "./notifications";
import type { WorkspacesState } from "./workspaces";
import type { TimelineItem } from "./message-model";
import type {
  ScheduledTask,
  ScheduledTaskDraft,
  ScheduledTaskRun,
} from "../../scheduled-tasks";

export interface ScheduledTasksState {
  tasks: ScheduledTask[];
  runs: ScheduledTaskRun[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  refresh(): Promise<void>;
  create(draft: ScheduledTaskDraft): Promise<boolean>;
  update(id: string, draft: ScheduledTaskDraft): Promise<boolean>;
  setPaused(id: string, paused: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  runNow(id: string): Promise<boolean>;
  runMissed(runId: string): Promise<boolean>;
  skipMissed(runId: string): Promise<boolean>;
  /** Subscribe after conversation hydration. */
  start(): () => void;
}

interface ScheduledTasksDeps {
  conversations: StoreApi<ConversationsState>;
  workspaces: StoreApi<WorkspacesState>;
  notifications: StoreApi<NotificationsState>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminalFor(timeline: TimelineItem[], runId: string): Extract<TimelineItem, { kind: "result" }> | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "result" && item.runId === runId) return item;
  }
  return undefined;
}

function runError(timeline: TimelineItem[], runId: string, result?: Extract<TimelineItem, { kind: "result" }>): string {
  if (result?.finalText.trim()) return result.finalText.trim();
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "error" && item.runId === runId && item.message.trim()) return item.message.trim();
  }
  return result?.interrupted ? "任务被中断" : "任务没有完成";
}

function waitForTerminal(
  conversations: StoreApi<ConversationsState>,
  conversationId: string,
  rendererRunId: string,
): Promise<Extract<TimelineItem, { kind: "result" }>> {
  return new Promise((resolve) => {
    const read = (): Extract<TimelineItem, { kind: "result" }> | undefined => terminalFor(
      conversations.getState().timelines[conversationId] ?? [],
      rendererRunId,
    );
    const existing = read();
    if (existing) {
      resolve(existing);
      return;
    }
    const unsubscribe = conversations.subscribe(() => {
      const result = read();
      if (!result) return;
      unsubscribe();
      resolve(result);
    });
  });
}

export function createScheduledTasksStore(
  client: SchedulerClient,
  deps: ScheduledTasksDeps,
): StoreApi<ScheduledTasksState> {
  const executing = new Set<string>();
  let inFlightRefresh: Promise<void> | null = null;

  const store = createStore<ScheduledTasksState>((set, get) => {
    const refresh = async (): Promise<void> => {
      if (inFlightRefresh) return inFlightRefresh;
      inFlightRefresh = (async () => {
        set({ status: "loading", error: null });
        try {
          const snapshot = await client.list();
          set({ tasks: snapshot.tasks, runs: snapshot.runs, status: "ready", error: null });
        } catch (error: unknown) {
          set({ status: "error", error: message(error) });
        } finally {
          inFlightRefresh = null;
        }
      })();
      return inFlightRefresh;
    };

    const execute = async (runId: string): Promise<boolean> => {
      if (executing.has(runId)) return false;
      executing.add(runId);
      let conversationId: string | undefined;
      let task: ScheduledTask | undefined;
      let finalError: string | null = null;
      try {
        const claimed = await client.claim(runId);
        if (!claimed) return false;
        task = get().tasks.find((candidate) => candidate.id === claimed.taskId);
        if (!task) {
          await refresh();
          task = get().tasks.find((candidate) => candidate.id === claimed.taskId);
        }
        if (!task) throw new Error("找不到这个定时任务。");

        const workspace = deps.workspaces.getState().list.find((candidate) => candidate.id === task!.workspaceId);
        if (!workspace?.available) throw new Error(`找不到「${workspace?.name ?? "任务本子"}」文件夹，请重新打开后补跑。`);

        conversationId = task.conversationId;
        if (!conversationId || !deps.conversations.getState().byId[conversationId]) {
          conversationId = await deps.conversations.getState().createConversation({
            source: "workbench",
            bookId: null,
            workspaceId: task.workspaceId,
            activate: false,
          });
          deps.conversations.getState().renameTitle(conversationId, task.name);
          await client.attachConversation(task.id, conversationId);
        }

        await deps.conversations.getState().send(conversationId, task.prompt);
        const rendererRunId = deps.conversations.getState().runIds[conversationId];
        if (!rendererRunId) throw new Error("任务没有成功开始，请稍后重试。");
        const result = await waitForTerminal(deps.conversations, conversationId, rendererRunId);
        const timeline = deps.conversations.getState().timelines[conversationId] ?? [];
        if (result.isError || result.interrupted) {
          const error = runError(timeline, rendererRunId, result);
          finalError = error;
          await client.complete(runId, "failed", conversationId, error);
          return false;
        }
        await client.complete(runId, "succeeded", conversationId);
        return true;
      } catch (error: unknown) {
        const detail = message(error);
        finalError = detail;
        await client.complete(runId, "failed", conversationId, detail).catch(() => undefined);
        if (task) {
          deps.notifications.getState().push({
            text: `定时任务「${task.name}」没有完成`,
            kind: "generic",
            ...(conversationId ? { conversationId } : {}),
          });
        }
        return false;
      } finally {
        executing.delete(runId);
        await refresh();
        if (finalError) set({ error: finalError, status: "error" });
      }
    };

    const mutate = async (action: () => Promise<unknown>): Promise<boolean> => {
      set({ error: null });
      try {
        await action();
        await refresh();
        return true;
      } catch (error: unknown) {
        set({ error: message(error), status: "error" });
        return false;
      }
    };

    return {
      tasks: [],
      runs: [],
      status: "idle",
      error: null,
      refresh,
      create: (draft) => mutate(() => client.create(draft)),
      update: (id, draft) => mutate(() => client.update(id, draft)),
      setPaused: (id, paused) => mutate(() => client.setPaused(id, paused)),
      remove: (id) => mutate(() => client.delete(id)),
      runNow: async (id) => {
        set({ error: null });
        try {
          const run = await client.runNow(id);
          await refresh();
          return await execute(run.id);
        } catch (error: unknown) {
          set({ error: message(error), status: "error" });
          return false;
        }
      },
      runMissed: async (runId) => {
        set({ error: null });
        try {
          const run = await client.runMissed(runId);
          await refresh();
          return await execute(run.id);
        } catch (error: unknown) {
          set({ error: message(error), status: "error" });
          return false;
        }
      },
      skipMissed: (runId) => mutate(() => client.skipMissed(runId)),
      start: () => {
        const unsubscribe = client.onDue((payload) => {
          void refresh().then(() => execute(payload.runId));
        });
        void refresh().then(() => {
          for (const run of get().runs.filter((candidate) => candidate.status === "queued")) {
            void execute(run.id);
          }
        });
        return unsubscribe;
      },
    };
  });
  return store;
}
