import { randomUUID } from "node:crypto";
import type { ScheduledTaskAdmin, ScheduledTaskPatch } from "../bridge/scheduled-task-mcp";
import {
  cloneScheduledTask,
  cloneScheduledTaskRun,
  nextRunAtForSchedule,
  normalizeScheduledTaskDraft,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskRun,
  type ScheduledTaskSnapshot,
} from "../scheduled-tasks";
import type { Persistence } from "./persistence/schema";

type ScheduledTaskPersistence = Pick<Persistence,
  | "listScheduledTasks"
  | "getScheduledTask"
  | "saveScheduledTask"
  | "deleteScheduledTask"
  | "listScheduledTaskRuns"
  | "getScheduledTaskRun"
  | "saveScheduledTaskRun"
  | "claimScheduledTaskRun"
  | "completeScheduledTaskRun"
>;

export interface ScheduledTaskAdminService extends ScheduledTaskAdmin {
  snapshot(): ScheduledTaskSnapshot;
  runMissed(runId: string): ScheduledTaskRun;
  skipMissed(runId: string): void;
  claim(runId: string): ScheduledTaskRun | null;
  complete(input: {
    runId: string;
    status: "succeeded" | "failed";
    conversationId?: string;
    error?: string;
  }): ScheduledTaskRun;
  attachConversation(taskId: string, conversationId: string): ScheduledTask;
}

export interface ScheduledTaskAdminOptions {
  persistence: ScheduledTaskPersistence;
  resolveWorkspace(id: string): unknown;
  refresh(): void;
  now?: () => number;
  timezone?: () => string;
  randomId?: () => string;
}

export function createScheduledTaskAdmin(options: ScheduledTaskAdminOptions): ScheduledTaskAdminService {
  const now = options.now ?? Date.now;
  const timezone = options.timezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || "local");
  const randomId = options.randomId ?? randomUUID;

  const requireTask = (id: string): ScheduledTask => {
    const task = options.persistence.getScheduledTask(id.trim());
    if (!task) throw new Error("没有这个定时任务，它可能已经被删除。");
    return task;
  };

  const requireMissedRun = (id: string): ScheduledTaskRun => {
    const run = options.persistence.getScheduledTaskRun(id.trim());
    if (!run || run.status !== "missed") throw new Error("这条错过记录已经处理过了。");
    return run;
  };

  const hasActiveRun = (id: string): boolean => options.persistence
    .listScheduledTaskRuns(id, 500)
    .some((run) => run.status === "queued" || run.status === "running");

  const buildTask = (draft: ScheduledTaskDraft, existing?: ScheduledTask): ScheduledTask => {
    const current = now();
    const clean = normalizeScheduledTaskDraft(draft, current, timezone());
    options.resolveWorkspace(clean.workspaceId);
    const nextRunAt = nextRunAtForSchedule(clean.schedule, current);
    if (nextRunAt === null) throw new Error("这个时间已经过去，请选择未来的时间。");
    const workspaceChanged = existing && existing.workspaceId !== clean.workspaceId;
    return {
      id: existing?.id ?? randomId(),
      name: clean.name,
      prompt: clean.prompt,
      schedule: clean.schedule,
      timezone: clean.timezone,
      nextRunAt,
      workspaceId: clean.workspaceId,
      status: existing?.status === "paused" ? "paused" : "active",
      ...(!workspaceChanged && existing?.conversationId ? { conversationId: existing.conversationId } : {}),
      createdAt: existing?.createdAt ?? current,
      updatedAt: current,
      ...(existing?.lastRunAt === undefined ? {} : { lastRunAt: existing.lastRunAt }),
    };
  };

  const queueRun = (task: ScheduledTask, trigger: "manual" | "catch-up"): ScheduledTaskRun => {
    if (hasActiveRun(task.id)) throw new Error("这个任务已经在运行，请等它结束后再试。");
    options.resolveWorkspace(task.workspaceId);
    const current = now();
    const run: ScheduledTaskRun = {
      id: randomId(),
      taskId: task.id,
      scheduledFor: current,
      trigger,
      status: "queued",
      createdAt: current,
    };
    options.persistence.saveScheduledTaskRun(run);
    return cloneScheduledTaskRun(run);
  };

  const service: ScheduledTaskAdminService = {
    list: () => options.persistence.listScheduledTasks().map(cloneScheduledTask),
    snapshot: () => ({
      tasks: options.persistence.listScheduledTasks().map(cloneScheduledTask),
      runs: options.persistence.listScheduledTaskRuns(undefined, 200).map(cloneScheduledTaskRun),
    }),
    create(draft) {
      const task = buildTask(draft);
      options.persistence.saveScheduledTask(task);
      options.refresh();
      return cloneScheduledTask(task);
    },
    update(id: string, patch: ScheduledTaskPatch) {
      const existing = requireTask(id);
      if (hasActiveRun(existing.id)) throw new Error("任务运行时不能修改，请等它结束后再试。");
      const nextName = patch.name ?? (patch.prompt === undefined ? existing.name : undefined);
      const task = buildTask({
        prompt: patch.prompt ?? existing.prompt,
        schedule: patch.schedule ?? existing.schedule,
        workspaceId: patch.workspaceId ?? existing.workspaceId,
        timezone: patch.timezone ?? existing.timezone,
        ...(nextName === undefined ? {} : { name: nextName }),
      }, existing);
      options.persistence.saveScheduledTask(task);
      options.refresh();
      return cloneScheduledTask(task);
    },
    setPaused(id, paused) {
      const existing = requireTask(id);
      const current = now();
      const nextRunAt = paused ? existing.nextRunAt : nextRunAtForSchedule(existing.schedule, current);
      if (!paused && nextRunAt === null) throw new Error("这次任务的时间已经过去，请编辑时间后再开启。");
      const task: ScheduledTask = {
        ...existing,
        status: paused ? "paused" : "active",
        nextRunAt,
        updatedAt: current,
      };
      options.persistence.saveScheduledTask(task);
      options.refresh();
      return cloneScheduledTask(task);
    },
    delete(id) {
      const task = requireTask(id);
      if (hasActiveRun(task.id)) throw new Error("任务运行时不能删除，请等它结束后再试。");
      options.persistence.deleteScheduledTask(task.id);
      options.refresh();
    },
    runNow(id) {
      return queueRun(requireTask(id), "manual");
    },
    runMissed(runId) {
      const missed = requireMissedRun(runId);
      const queued = queueRun(requireTask(missed.taskId), "catch-up");
      options.persistence.saveScheduledTaskRun({ ...missed, status: "skipped", completedAt: now() });
      return queued;
    },
    skipMissed(runId) {
      const missed = requireMissedRun(runId);
      options.persistence.saveScheduledTaskRun({ ...missed, status: "skipped", completedAt: now() });
    },
    claim(runId) {
      return options.persistence.claimScheduledTaskRun(runId.trim(), now()) ?? null;
    },
    complete(input) {
      const run = options.persistence.getScheduledTaskRun(input.runId.trim());
      if (!run) throw new Error("找不到这次运行记录。");
      const completed: ScheduledTaskRun = {
        ...run,
        status: input.status,
        completedAt: now(),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.status === "failed"
          ? { error: Array.from((input.error ?? "任务没有完成").trim()).slice(0, 500).join("") }
          : { error: undefined }),
      };
      options.persistence.completeScheduledTaskRun(completed);
      const task = options.persistence.getScheduledTask(run.taskId);
      if (task) {
        options.persistence.saveScheduledTask({
          ...task,
          ...(input.conversationId ? { conversationId: input.conversationId } : {}),
          lastRunAt: run.scheduledFor,
          updatedAt: now(),
        });
      }
      return cloneScheduledTaskRun(completed);
    },
    attachConversation(taskId, conversationId) {
      const task = requireTask(taskId);
      if (!conversationId.trim()) throw new Error("对话 id 不能为空。");
      const updated = { ...task, conversationId: conversationId.trim(), updatedAt: now() };
      options.persistence.saveScheduledTask(updated);
      return cloneScheduledTask(updated);
    },
  };

  return service;
}
