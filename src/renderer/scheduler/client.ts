import type { InvokeResult } from "../bridge/ipc-client";
import {
  cloneScheduledTask,
  cloneScheduledTaskRun,
  nextRunAtForSchedule,
  normalizeScheduledTaskDraft,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskDueEvent,
  type ScheduledTaskRun,
  type ScheduledTaskSnapshot,
} from "../../scheduled-tasks";

export interface SchedulerClient {
  list(): Promise<ScheduledTaskSnapshot>;
  create(draft: ScheduledTaskDraft): Promise<ScheduledTask>;
  update(id: string, draft: ScheduledTaskDraft): Promise<ScheduledTask>;
  setPaused(id: string, paused: boolean): Promise<ScheduledTask>;
  delete(id: string): Promise<void>;
  runNow(id: string): Promise<ScheduledTaskRun>;
  runMissed(runId: string): Promise<ScheduledTaskRun>;
  skipMissed(runId: string): Promise<void>;
  claim(runId: string): Promise<ScheduledTaskRun | null>;
  complete(
    runId: string,
    status: "succeeded" | "failed",
    conversationId?: string,
    error?: string,
  ): Promise<void>;
  attachConversation(taskId: string, conversationId: string): Promise<void>;
  onDue(cb: (payload: ScheduledTaskDueEvent) => void): () => void;
}

export interface LeemoSchedulerApi {
  invoke(op: string, payload: unknown): Promise<InvokeResult>;
  onDue(cb: (payload: unknown) => void): () => void;
}

export class IpcSchedulerClient implements SchedulerClient {
  constructor(private readonly api: LeemoSchedulerApi) {}

  private async invoke<T>(op: string, payload?: unknown): Promise<T> {
    const result = await this.api.invoke(op, payload);
    if (!result.ok) throw new Error(result.error ?? "定时任务操作失败");
    return result.response as T;
  }

  list(): Promise<ScheduledTaskSnapshot> {
    return this.invoke("list");
  }

  create(draft: ScheduledTaskDraft): Promise<ScheduledTask> {
    return this.invoke("create", draft);
  }

  update(id: string, draft: ScheduledTaskDraft): Promise<ScheduledTask> {
    return this.invoke("update", { id, draft });
  }

  setPaused(id: string, paused: boolean): Promise<ScheduledTask> {
    return this.invoke("setPaused", { id, paused });
  }

  delete(id: string): Promise<void> {
    return this.invoke("delete", { id });
  }

  runNow(id: string): Promise<ScheduledTaskRun> {
    return this.invoke("runNow", { id });
  }

  runMissed(runId: string): Promise<ScheduledTaskRun> {
    return this.invoke("runMissed", { runId });
  }

  skipMissed(runId: string): Promise<void> {
    return this.invoke("skipMissed", { runId });
  }

  claim(runId: string): Promise<ScheduledTaskRun | null> {
    return this.invoke("claim", { runId });
  }

  complete(
    runId: string,
    status: "succeeded" | "failed",
    conversationId?: string,
    error?: string,
  ): Promise<void> {
    return this.invoke("complete", { runId, status, conversationId, error });
  }

  attachConversation(taskId: string, conversationId: string): Promise<void> {
    return this.invoke("attachConversation", { taskId, conversationId });
  }

  onDue(cb: (payload: ScheduledTaskDueEvent) => void): () => void {
    return this.api.onDue((payload) => cb(payload as ScheduledTaskDueEvent));
  }
}

/** Browser-dev fallback. It keeps the page interactive without pretending that
 * a browser tab can provide restart-safe background scheduling. */
export class MemorySchedulerClient implements SchedulerClient {
  private tasks: ScheduledTask[] = [];
  private runs: ScheduledTaskRun[] = [];
  private nextId = 1;

  private id(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  private requireTask(id: string): ScheduledTask {
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error("没有这个定时任务，它可能已经被删除。");
    return task;
  }

  private active(taskId: string): boolean {
    return this.runs.some((run) => run.taskId === taskId && (run.status === "queued" || run.status === "running"));
  }

  async list(): Promise<ScheduledTaskSnapshot> {
    return {
      tasks: this.tasks.map(cloneScheduledTask),
      runs: this.runs.map(cloneScheduledTaskRun),
    };
  }

  async create(draft: ScheduledTaskDraft): Promise<ScheduledTask> {
    const current = Date.now();
    const clean = normalizeScheduledTaskDraft(draft, current, "local");
    const task: ScheduledTask = {
      id: this.id("task"),
      ...clean,
      nextRunAt: nextRunAtForSchedule(clean.schedule, current),
      status: "active",
      createdAt: current,
      updatedAt: current,
    };
    this.tasks = [task, ...this.tasks];
    return cloneScheduledTask(task);
  }

  async update(id: string, draft: ScheduledTaskDraft): Promise<ScheduledTask> {
    const existing = this.requireTask(id);
    if (this.active(id)) throw new Error("任务运行时不能修改，请等它结束后再试。");
    const current = Date.now();
    const clean = normalizeScheduledTaskDraft(draft, current, "local");
    const task: ScheduledTask = {
      ...existing,
      ...clean,
      nextRunAt: nextRunAtForSchedule(clean.schedule, current),
      status: existing.status === "paused" ? "paused" : "active",
      updatedAt: current,
    };
    this.tasks = this.tasks.map((candidate) => candidate.id === id ? task : candidate);
    return cloneScheduledTask(task);
  }

  async setPaused(id: string, paused: boolean): Promise<ScheduledTask> {
    const existing = this.requireTask(id);
    const current = Date.now();
    const nextRunAt = paused ? existing.nextRunAt : nextRunAtForSchedule(existing.schedule, current);
    if (!paused && nextRunAt === null) throw new Error("这次任务的时间已经过去，请编辑时间后再开启。");
    const task: ScheduledTask = {
      ...existing,
      status: paused ? "paused" : "active",
      nextRunAt,
      updatedAt: current,
    };
    this.tasks = this.tasks.map((candidate) => candidate.id === id ? task : candidate);
    return cloneScheduledTask(task);
  }

  async delete(id: string): Promise<void> {
    if (this.active(id)) throw new Error("任务运行时不能删除，请等它结束后再试。");
    this.requireTask(id);
    this.tasks = this.tasks.filter((task) => task.id !== id);
    this.runs = this.runs.filter((run) => run.taskId !== id);
  }

  private queue(task: ScheduledTask, trigger: "manual" | "catch-up"): ScheduledTaskRun {
    if (this.active(task.id)) throw new Error("这个任务已经在运行，请等它结束后再试。");
    const current = Date.now();
    const run: ScheduledTaskRun = {
      id: this.id("run"),
      taskId: task.id,
      scheduledFor: current,
      trigger,
      status: "queued",
      createdAt: current,
    };
    this.runs = [run, ...this.runs];
    return cloneScheduledTaskRun(run);
  }

  async runNow(id: string): Promise<ScheduledTaskRun> {
    return this.queue(this.requireTask(id), "manual");
  }

  async runMissed(runId: string): Promise<ScheduledTaskRun> {
    const missed = this.runs.find((run) => run.id === runId && run.status === "missed");
    if (!missed) throw new Error("这条错过记录已经处理过了。");
    const queued = this.queue(this.requireTask(missed.taskId), "catch-up");
    this.runs = this.runs.map((run) => run.id === runId ? { ...run, status: "skipped", completedAt: Date.now() } : run);
    return queued;
  }

  async skipMissed(runId: string): Promise<void> {
    const missed = this.runs.find((run) => run.id === runId && run.status === "missed");
    if (!missed) throw new Error("这条错过记录已经处理过了。");
    this.runs = this.runs.map((run) => run.id === runId ? { ...run, status: "skipped", completedAt: Date.now() } : run);
  }

  async claim(runId: string): Promise<ScheduledTaskRun | null> {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run || run.status !== "queued") return null;
    const claimed: ScheduledTaskRun = { ...run, status: "running", startedAt: Date.now() };
    this.runs = this.runs.map((candidate) => candidate.id === runId ? claimed : candidate);
    return cloneScheduledTaskRun(claimed);
  }

  async complete(
    runId: string,
    status: "succeeded" | "failed",
    conversationId?: string,
    error?: string,
  ): Promise<void> {
    this.runs = this.runs.map((run) => run.id === runId
      ? { ...run, status, completedAt: Date.now(), conversationId, error }
      : run);
  }

  async attachConversation(taskId: string, conversationId: string): Promise<void> {
    this.tasks = this.tasks.map((task) => task.id === taskId
      ? { ...task, conversationId, updatedAt: Date.now() }
      : task);
  }

  onDue(): () => void {
    return () => undefined;
  }
}
