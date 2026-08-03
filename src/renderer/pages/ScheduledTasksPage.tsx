import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useConversations, useScheduledTasks, useUi, useWorkspaces } from "../bridge/context";
import type { ScheduledTask, ScheduledTaskDraft, ScheduledTaskRun } from "../../scheduled-tasks";

type ScheduleKind = ScheduledTaskDraft["schedule"]["kind"];

interface FormState {
  prompt: string;
  kind: ScheduleKind;
  date: string;
  time: string;
  weekday: number;
  workspaceId: string;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function localDateInput(timestamp: number): string {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function localTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function newForm(workspaceId: string): FormState {
  const next = new Date(Date.now() + 60 * 60 * 1_000);
  next.setSeconds(0, 0);
  return {
    prompt: "",
    kind: "once",
    date: localDateInput(next.getTime()),
    time: localTimeInput(next.getTime()),
    weekday: next.getDay(),
    workspaceId,
  };
}

function formForTask(task: ScheduledTask): FormState {
  const fallback = task.nextRunAt ?? Date.now() + 60 * 60 * 1_000;
  return {
    prompt: task.prompt,
    kind: task.schedule.kind,
    date: task.schedule.kind === "once" ? localDateInput(task.schedule.runAt) : localDateInput(fallback),
    time: task.schedule.kind === "once"
      ? localTimeInput(task.schedule.runAt)
      : `${String(task.schedule.hour).padStart(2, "0")}:${String(task.schedule.minute).padStart(2, "0")}`,
    weekday: task.schedule.kind === "weekly" ? task.schedule.weekday : new Date(fallback).getDay(),
    workspaceId: task.workspaceId,
  };
}

function draftFor(form: FormState): ScheduledTaskDraft {
  const [hour, minute] = form.time.split(":").map(Number);
  const schedule = form.kind === "once"
    ? { kind: "once" as const, runAt: new Date(`${form.date}T${form.time}:00`).getTime() }
    : form.kind === "daily"
      ? { kind: "daily" as const, hour, minute }
      : { kind: "weekly" as const, weekday: form.weekday, hour, minute };
  return { prompt: form.prompt, schedule, workspaceId: form.workspaceId };
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function scheduleLabel(task: ScheduledTask): string {
  if (task.schedule.kind === "once") return formatTimestamp(task.schedule.runAt);
  const time = `${String(task.schedule.hour).padStart(2, "0")}:${String(task.schedule.minute).padStart(2, "0")}`;
  return task.schedule.kind === "daily" ? `每天 ${time}` : `每${WEEKDAYS[task.schedule.weekday]} ${time}`;
}

function runStatus(run: ScheduledTaskRun): { label: string; icon: typeof Clock3; className: string } {
  switch (run.status) {
    case "succeeded": return { label: "已完成", icon: CheckCircle2, className: "text-[var(--leemo-ok)]" };
    case "failed": return { label: "未完成", icon: XCircle, className: "text-[var(--leemo-danger)]" };
    case "missed": return { label: "已错过", icon: Clock3, className: "text-[var(--leemo-amber)]" };
    case "skipped": return { label: "已跳过", icon: SkipForward, className: "text-[var(--leemo-ink-3)]" };
    case "running": return { label: "进行中", icon: LoaderCircle, className: "text-[var(--leemo-amber)]" };
    default: return { label: "等待开始", icon: Clock3, className: "text-[var(--leemo-ink-3)]" };
  }
}

export default function ScheduledTasksPage() {
  const tasks = useScheduledTasks((state) => state.tasks);
  const runs = useScheduledTasks((state) => state.runs);
  const status = useScheduledTasks((state) => state.status);
  const error = useScheduledTasks((state) => state.error);
  const create = useScheduledTasks((state) => state.create);
  const update = useScheduledTasks((state) => state.update);
  const setPaused = useScheduledTasks((state) => state.setPaused);
  const remove = useScheduledTasks((state) => state.remove);
  const runNow = useScheduledTasks((state) => state.runNow);
  const runMissed = useScheduledTasks((state) => state.runMissed);
  const skipMissed = useScheduledTasks((state) => state.skipMissed);
  const workspaces = useWorkspaces((state) => state.list);
  const activeWorkspaceId = useWorkspaces((state) => state.activeId);
  const selectWorkspace = useWorkspaces((state) => state.select);
  const activateWorkspace = useConversations((state) => state.activateWorkspace);
  const switchActive = useConversations((state) => state.switchActive);
  const setView = useUi((state) => state.setView);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(tasks.length === 0);
  const [form, setForm] = useState<FormState>(() => newForm(activeWorkspaceId));
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (editingId || form.prompt) return;
    setForm((current) => ({ ...current, workspaceId: activeWorkspaceId }));
  }, [activeWorkspaceId, editingId, form.prompt]);

  useEffect(() => {
    if (tasks.length === 0) setFormOpen(true);
  }, [tasks.length]);

  const missed = runs.filter((run) => run.status === "missed");
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const recentRuns = runs.filter((run) => run.status !== "missed").slice(0, 10);

  const resetForm = () => {
    setEditingId(null);
    setForm(newForm(activeWorkspaceId));
    setFormOpen(false);
  };

  const submit = async () => {
    setBusyAction("save");
    const ok = editingId ? await update(editingId, draftFor(form)) : await create(draftFor(form));
    setBusyAction(null);
    if (ok) resetForm();
  };

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    setBusyAction(key);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  const openConversation = async (task: ScheduledTask) => {
    if (!task.conversationId) return;
    const selected = await selectWorkspace(task.workspaceId);
    if (!selected) return;
    activateWorkspace(task.workspaceId);
    switchActive(task.conversationId);
    setView("chat");
  };

  return (
    <div className="leemo-page-scroll">
      <div className="leemo-page-frame max-w-5xl">
        <header className="flex items-center gap-3 border-b border-[var(--leemo-line)] pb-4">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[15px] font-semibold text-[var(--leemo-ink)]">定时任务</h1>
            <span className="text-[11px] tabular-nums text-[var(--leemo-ink-3)]">{tasks.length} 个</span>
          </div>
          {!formOpen && (
            <button
              type="button"
              onClick={() => { setForm(newForm(activeWorkspaceId)); setEditingId(null); setFormOpen(true); }}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs font-medium text-white hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建任务
            </button>
          )}
        </header>

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 border-y border-[var(--leemo-danger-soft)] py-3 text-xs text-[var(--leemo-danger)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {missed.length > 0 && (
          <section className="mt-5 border-y border-[var(--leemo-amber-line)] bg-[var(--leemo-amber-bg)] px-4 py-3" aria-label="错过的任务">
            <h2 className="text-xs font-semibold text-[var(--leemo-ink)]">回来后有 {missed.length} 次任务需要处理</h2>
            <div className="mt-2 divide-y divide-[var(--leemo-amber-line)]">
              {missed.map((run) => {
                const task = taskById.get(run.taskId);
                if (!task) return null;
                return (
                  <div key={run.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink-2)]">
                      {task.name} · {formatTimestamp(run.scheduledFor)}
                    </span>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void runAction(`catch-${run.id}`, () => runMissed(run.id))}
                      className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-[var(--leemo-amber-line)] bg-white px-2 text-[11px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-50"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      补跑
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void runAction(`skip-${run.id}`, () => skipMissed(run.id))}
                      className="inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[11px] text-[var(--leemo-ink-3)] hover:bg-white/70 disabled:opacity-50"
                    >
                      <SkipForward className="h-3 w-3" aria-hidden />
                      跳过
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {formOpen && (
          <section className="border-b border-[var(--leemo-line)] py-5" aria-label={editingId ? "编辑定时任务" : "新建定时任务"}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-[var(--leemo-ink)]">{editingId ? "编辑任务" : "新建任务"}</h2>
              {tasks.length > 0 && (
                <button type="button" onClick={resetForm} className="leemo-icon-btn" title="取消" aria-label="取消编辑">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            <label className="block text-xs font-medium text-[var(--leemo-ink-2)]" htmlFor="scheduled-task-prompt">要做什么</label>
            <textarea
              id="scheduled-task-prompt"
              value={form.prompt}
              onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
              rows={3}
              placeholder="例如：给我一份 10 分钟英语练习"
              className="mt-2 w-full resize-y rounded-[6px] border border-[var(--leemo-line)] bg-white px-3 py-2.5 text-sm leading-6 text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-ink-3)]"
            />

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]">
              <div>
                <span className="block text-xs font-medium text-[var(--leemo-ink-2)]">什么时候</span>
                <div className="mt-2 inline-flex rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-panel)] p-0.5" aria-label="运行频率">
                  {(["once", "daily", "weekly"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={form.kind === kind}
                      onClick={() => setForm((current) => ({ ...current, kind }))}
                      className={`h-7 rounded-[4px] px-3 text-[11.5px] ${form.kind === kind ? "bg-white font-medium text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
                    >
                      {kind === "once" ? "一次" : kind === "daily" ? "每天" : "每周"}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {form.kind === "once" && (
                    <input
                      aria-label="运行日期"
                      type="date"
                      value={form.date}
                      onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                      className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-white px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                    />
                  )}
                  {form.kind === "weekly" && (
                    <select
                      aria-label="星期"
                      value={form.weekday}
                      onChange={(event) => setForm((current) => ({ ...current, weekday: Number(event.target.value) }))}
                      className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-white px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                    >
                      {WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}
                    </select>
                  )}
                  <input
                    aria-label="运行时间"
                    type="time"
                    value={form.time}
                    onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                    className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-white px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--leemo-ink-2)]" htmlFor="scheduled-task-workspace">结果放到哪里</label>
                <select
                  id="scheduled-task-workspace"
                  value={form.workspaceId}
                  onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))}
                  className="mt-2 h-9 w-full rounded-[6px] border border-[var(--leemo-line)] bg-white px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                >
                  {workspaces.filter((workspace) => workspace.available).map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.kind === "home" ? "Leemo 工作台" : workspace.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={!form.prompt.trim() || busyAction === "save"}
                onClick={() => void submit()}
                className="inline-flex h-9 items-center gap-1.5 rounded-[6px] bg-[var(--leemo-ink)] px-4 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "save" && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {editingId ? "保存修改" : "创建任务"}
              </button>
            </div>
          </section>
        )}

        <section className="py-5" aria-label="任务列表">
          {status === "loading" && tasks.length === 0 ? (
            <div role="status" className="flex min-h-36 items-center justify-center gap-2 text-xs text-[var(--leemo-ink-3)]">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              正在读取任务
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex min-h-24 items-center justify-center text-xs text-[var(--leemo-ink-3)]">还没有定时任务</div>
          ) : (
            <div className="divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">
              {tasks.map((task) => {
                const workspace = workspaces.find((candidate) => candidate.id === task.workspaceId);
                const activeRun = runs.find((run) => run.taskId === task.id && (run.status === "queued" || run.status === "running"));
                return (
                  <article key={task.id} className="flex flex-wrap items-center gap-3 px-2 py-3.5 sm:px-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-panel)] text-[var(--leemo-ink-3)]">
                      <CalendarClock className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-[180px] flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-[13px] font-medium text-[var(--leemo-ink)]">{task.name}</h3>
                        {activeRun && <span className="shrink-0 text-[10px] text-[var(--leemo-amber)]">进行中</span>}
                        {task.status === "paused" && <span className="shrink-0 text-[10px] text-[var(--leemo-ink-3)]">已暂停</span>}
                        {task.status === "completed" && <span className="shrink-0 text-[10px] text-[var(--leemo-ink-3)]">已结束</span>}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--leemo-ink-3)]">
                        {scheduleLabel(task)} · {workspace?.kind === "home" ? "Leemo 工作台" : workspace?.name ?? "本子不可用"}
                        {task.nextRunAt && task.status === "active" ? ` · 下次 ${formatTimestamp(task.nextRunAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {task.conversationId && (
                        <button type="button" onClick={() => void openConversation(task)} className="leemo-icon-btn" title="打开任务对话" aria-label={`打开 ${task.name} 的任务对话`}>
                          <MessageSquare className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyAction !== null || Boolean(activeRun) || !workspace?.available}
                        onClick={() => void runAction(`run-${task.id}`, () => runNow(task.id))}
                        className="leemo-icon-btn disabled:cursor-not-allowed disabled:opacity-35"
                        title="立即运行"
                        aria-label={`立即运行 ${task.name}`}
                      >
                        <Play className="h-4 w-4" aria-hidden />
                      </button>
                      {task.status !== "completed" && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => void runAction(`pause-${task.id}`, () => setPaused(task.id, task.status !== "paused"))}
                          className="leemo-icon-btn disabled:opacity-35"
                          title={task.status === "paused" ? "继续任务" : "暂停任务"}
                          aria-label={`${task.status === "paused" ? "继续" : "暂停"} ${task.name}`}
                        >
                          {task.status === "paused" ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyAction !== null || Boolean(activeRun)}
                        onClick={() => { setEditingId(task.id); setForm(formForTask(task)); setFormOpen(true); }}
                        className="leemo-icon-btn disabled:opacity-35"
                        title="编辑任务"
                        aria-label={`编辑 ${task.name}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null || Boolean(activeRun)}
                        onClick={() => {
                          if (window.confirm(`删除定时任务「${task.name}」？`)) {
                            void runAction(`delete-${task.id}`, () => remove(task.id));
                          }
                        }}
                        className="leemo-icon-btn text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger)] disabled:opacity-35"
                        title="删除任务"
                        aria-label={`删除 ${task.name}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {recentRuns.length > 0 && (
          <section className="border-t border-[var(--leemo-line)] py-5" aria-label="最近运行">
            <h2 className="mb-2 text-xs font-semibold text-[var(--leemo-ink-2)]">最近运行</h2>
            <div className="divide-y divide-[var(--leemo-line-2)]">
              {recentRuns.map((run) => {
                const task = taskById.get(run.taskId);
                const statusView = runStatus(run);
                const Icon = statusView.icon;
                return (
                  <div key={run.id} className="flex items-center gap-2 py-2 text-[11px]">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${statusView.className} ${run.status === "running" ? "animate-spin" : ""}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink-2)]">{task?.name ?? "已删除的任务"}</span>
                    <span className={statusView.className}>{statusView.label}</span>
                    <span className="shrink-0 tabular-nums text-[var(--leemo-ink-3)]">{formatTimestamp(run.scheduledFor)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
