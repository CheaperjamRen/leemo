import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipForward,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useConversations, useScheduledTasks, useUi, useWorkspaces } from "../bridge/context";
import { weekdaysForWeeklySchedule } from "../../scheduled-tasks";
import type {
  ScheduledTask,
  ScheduledTaskDraft,
  ScheduledTaskRun,
  ScheduledTaskSchedule,
} from "../../scheduled-tasks";
import "./ScheduledTasksPage.css";

type ScheduleKind = ScheduledTaskDraft["schedule"]["kind"];
type TaskListFilter = "all" | "active" | "paused" | "attention";

interface FormState {
  prompt: string;
  kind: ScheduleKind;
  date: string;
  time: string;
  weekdays: number[];
  monthday: number;
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
    weekdays: [],
    monthday: next.getDate(),
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
    weekdays: task.schedule.kind === "weekly" ? weekdaysForWeeklySchedule(task.schedule) : [],
    monthday: task.schedule.kind === "monthly" ? task.schedule.day : new Date(fallback).getDate(),
    workspaceId: task.workspaceId,
  };
}

function draftFor(form: FormState): ScheduledTaskDraft {
  const [hour, minute] = form.time.split(":").map(Number);
  let schedule: ScheduledTaskSchedule;
  if (form.kind === "once") {
    schedule = { kind: "once", runAt: new Date(`${form.date}T${form.time}:00`).getTime() };
  } else if (form.kind === "weekly") {
    schedule = { kind: "weekly", weekdays: [...form.weekdays].sort((left, right) => left - right), hour, minute };
  } else if (form.kind === "monthly") {
    schedule = { kind: "monthly", day: form.monthday, hour, minute };
  } else {
    schedule = { kind: form.kind, hour, minute };
  }
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
  if (task.schedule.kind === "daily") return `每天 ${time}`;
  if (task.schedule.kind === "monthly") return `每月 ${task.schedule.day} 日 ${time}`;
  if (task.schedule.kind === "weekdays") return `每工作日 ${time}`;
  if (task.schedule.kind === "weekends") return `每周末 ${time}`;
  return `每${weekdaysForWeeklySchedule(task.schedule).map((weekday) => WEEKDAYS[weekday]).join("、")} ${time}`;
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
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => newForm(activeWorkspaceId));
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<TaskListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (editingId || form.prompt) return;
    setForm((current) => ({ ...current, workspaceId: activeWorkspaceId }));
  }, [activeWorkspaceId, editingId, form.prompt]);

  const missed = runs.filter((run) => run.status === "missed");
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const recentRuns = runs.filter((run) => run.status !== "missed").slice(0, 10);
  const attentionTaskIds = useMemo(() => {
    const latestTerminal = new Map<string, ScheduledTaskRun>();
    for (const run of runs) {
      if (run.status === "queued" || run.status === "running") continue;
      const current = latestTerminal.get(run.taskId);
      if (!current || run.scheduledFor > current.scheduledFor) latestTerminal.set(run.taskId, run);
    }
    const ids = new Set(missed.map((run) => run.taskId));
    for (const [taskId, run] of latestTerminal) {
      if (run.status === "failed") ids.add(taskId);
    }
    return ids;
  }, [missed, runs]);
  const taskFilterCounts = useMemo(() => ({
    all: tasks.length,
    active: tasks.filter((task) => task.status === "active").length,
    paused: tasks.filter((task) => task.status === "paused").length,
    attention: tasks.filter((task) => attentionTaskIds.has(task.id)).length,
  }), [attentionTaskIds, tasks]);
  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      if (listFilter === "active" && task.status !== "active") return false;
      if (listFilter === "paused" && task.status !== "paused") return false;
      if (listFilter === "attention" && !attentionTaskIds.has(task.id)) return false;
      if (!query) return true;
      const workspace = workspaces.find((candidate) => candidate.id === task.workspaceId);
      return [task.name, task.prompt, scheduleLabel(task), workspace?.name]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query));
    });
  }, [attentionTaskIds, listFilter, searchQuery, tasks, workspaces]);

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
      <div className="leemo-page-frame">
        <header className="leemo-scheduled-hero flex items-center gap-4">
          <span className="leemo-scheduled-hero__icon grid h-10 w-10 shrink-0 place-items-center rounded-[10px]">
            <CalendarClock className="h-[19px] w-[19px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="text-[21px] font-semibold tracking-[-0.025em] text-[var(--leemo-ink)]">定时任务</h1>
              <span className="text-[11px] tabular-nums text-[var(--leemo-ink-3)]">{tasks.length} 个</span>
            </div>
            <p className="mt-0.5 text-[11.5px] text-[var(--leemo-ink-3)]">让 momo 按固定频次继续处理重复工作</p>
          </div>
          {!formOpen && (
            <button
              type="button"
              onClick={() => { setForm(newForm(activeWorkspaceId)); setEditingId(null); setFormOpen(true); }}
              className="leemo-scheduled-primary ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-medium text-white"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              新建任务
            </button>
          )}
        </header>

        {tasks.length > 0 && (
          <div className="leemo-scheduled-controls mt-4 flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="任务状态" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
              {([
                ["all", "全部"],
                ["active", "运行中"],
                ["paused", "已暂停"],
                ["attention", "需处理"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={listFilter === id}
                  onClick={() => setListFilter(id)}
                  className="leemo-scheduled-filter h-8 shrink-0 rounded-[6px] px-2.5 text-[11.5px] text-[var(--leemo-ink-3)]"
                >
                  {label} <span className="ml-1 tabular-nums text-[10px]">{taskFilterCounts[id]}</span>
                </button>
              ))}
            </div>
            <label className="leemo-scheduled-search relative ml-auto block min-w-[220px] flex-1 sm:max-w-[300px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--leemo-ink-3)]" aria-hidden />
              <input
                type="search"
                aria-label="搜索定时任务"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索定时任务"
                className="h-9 w-full rounded-[7px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] pl-9 pr-3 text-xs text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-4)]"
              />
            </label>
          </div>
        )}

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

        <div className="mt-5">
        {formOpen && (
          <div className="leemo-scheduled-dialog-backdrop fixed inset-0 z-50 grid place-items-center p-5" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduled-task-dialog-title"
            className="leemo-scheduled-dialog max-h-[calc(100vh-40px)] w-full max-w-[620px] overflow-y-auto rounded-[14px] border border-[var(--leemo-line)] bg-[var(--leemo-shell-card)]"
          >
            <div className="leemo-scheduled-dialog__header flex items-start justify-between px-5 py-4">
              <div className="flex items-center gap-2.5">
                <span className="leemo-scheduled-hero__icon grid h-9 w-9 place-items-center rounded-[9px]">
                  <CalendarClock className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <h2 id="scheduled-task-dialog-title" className="text-[15px] font-semibold text-[var(--leemo-ink)]">{editingId ? "编辑任务" : "新建任务"}</h2>
                  <p className="mt-0.5 text-[10.5px] text-[var(--leemo-ink-3)]">告诉 momo 要做什么，以及什么时候重复</p>
                </div>
              </div>
              <button type="button" onClick={resetForm} className="leemo-icon-btn" title="取消" aria-label="取消编辑">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-3.5 px-5 py-4">
              <div className="leemo-scheduled-form-section">
                <label className="block text-xs font-semibold text-[var(--leemo-ink-2)]" htmlFor="scheduled-task-prompt">要做什么</label>
                <textarea
                  id="scheduled-task-prompt"
                  value={form.prompt}
                  onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                  rows={3}
                  placeholder="例如：整理今天适合我的英语阅读材料，并生成 15 分钟练习"
                  className="mt-2 w-full resize-y rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2.5 text-[13px] leading-5 text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-4)]"
                />
                <p className="mt-1.5 text-[10px] text-[var(--leemo-ink-4)]">可以直接写自然语言，首行会作为任务名称</p>
              </div>

              <div className="leemo-scheduled-form-section">
                <span className="block text-xs font-semibold text-[var(--leemo-ink-2)]">什么时候</span>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-[8px] bg-[var(--leemo-panel)] p-1 sm:grid-cols-6" role="group" aria-label="运行频率">
                  {([
                    ["once", "仅一次"],
                    ["daily", "每天"],
                    ["weekly", "每周"],
                    ["monthly", "每月"],
                    ["weekdays", "工作日"],
                    ["weekends", "周末"],
                  ] as const).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={form.kind === kind}
                      onClick={() => setForm((current) => ({ ...current, kind }))}
                      className="leemo-scheduled-frequency h-8 rounded-[6px] text-[11px] text-[var(--leemo-ink-3)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {form.kind === "once" && (
                    <input
                      aria-label="运行日期"
                      type="date"
                      value={form.date}
                      onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                      className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                    />
                  )}
                  {form.kind === "weekly" && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="选择星期">
                      {WEEKDAYS.map((label, index) => {
                        const selected = form.weekdays.includes(index);
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setForm((current) => ({
                              ...current,
                              weekdays: selected
                                ? current.weekdays.filter((weekday) => weekday !== index)
                                : [...current.weekdays, index].sort((left, right) => left - right),
                            }))}
                            className={`h-8 rounded-[6px] border px-2.5 text-[11px] ${selected ? "border-[var(--leemo-ink-3)] bg-[var(--leemo-panel)] font-medium text-[var(--leemo-ink)]" : "border-[var(--leemo-line)] bg-[var(--leemo-bg)] text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {form.kind === "monthly" && (
                    <select
                      aria-label="每月日期"
                      value={form.monthday}
                      onChange={(event) => setForm((current) => ({ ...current, monthday: Number(event.target.value) }))}
                      className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                    >
                      {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                        <option key={day} value={day}>每月 {day} 日</option>
                      ))}
                    </select>
                  )}
                  <input
                    aria-label="运行时间"
                    type="time"
                    value={form.time}
                    onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                    className="h-9 rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                  />
                </div>
              </div>

              <div className="leemo-scheduled-form-section">
                <label className="block text-xs font-semibold text-[var(--leemo-ink-2)]" htmlFor="scheduled-task-workspace">结果放到哪里</label>
                <select
                  id="scheduled-task-workspace"
                  value={form.workspaceId}
                  onChange={(event) => setForm((current) => ({ ...current, workspaceId: event.target.value }))}
                  className="mt-2 h-9 w-full rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-2.5 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-ink-3)]"
                >
                  {workspaces.filter((workspace) => workspace.available).map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.kind === "home" ? "Leemo 工作台" : workspace.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="leemo-scheduled-dialog__footer flex items-center justify-end gap-2 px-5 py-3.5">
              <button
                type="button"
                onClick={resetForm}
                className="h-9 rounded-full border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-4 text-xs font-medium text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!form.prompt.trim() || (form.kind === "weekly" && form.weekdays.length === 0) || busyAction === "save"}
                onClick={() => void submit()}
                className="leemo-scheduled-primary inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "save" && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {editingId ? "保存修改" : "创建任务"}
              </button>
            </div>
          </section>
          </div>
        )}

        <div className="min-w-0">
        <section aria-label="任务列表" data-testid="scheduled-task-list">
          {status === "loading" && tasks.length === 0 ? (
            <div role="status" className="flex min-h-56 items-center justify-center gap-2 rounded-[8px] border border-[var(--leemo-line)] bg-white text-xs text-[var(--leemo-ink-3)]">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              正在读取任务
            </div>
          ) : tasks.length === 0 ? (
            <div data-testid="scheduled-empty-state" className="mx-auto flex min-h-[104px] w-full max-w-[560px] flex-col items-center justify-center gap-1.5 rounded-[12px] border border-[var(--leemo-line)] bg-[var(--leemo-surface-default)] px-4 text-center text-xs text-[var(--leemo-ink-3)]">
              <CalendarClock className="h-4.5 w-4.5" aria-hidden />
              <span className="font-medium text-[var(--leemo-ink-2)]">还没有定时任务</span>
              <span className="text-[10.5px]">从右上角新建一个按时运行的任务</span>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-[var(--leemo-line)] bg-[var(--leemo-bg)] text-xs text-[var(--leemo-ink-3)]">
              <Search className="h-5 w-5" aria-hidden />
              <span>没有符合当前筛选的任务</span>
            </div>
          ) : (
            <div className="leemo-scheduled-table overflow-visible rounded-[10px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)]">
              <div className="hidden h-8 grid-cols-[minmax(190px,1fr)_minmax(125px,0.72fr)_44px_96px] items-center gap-3 border-b border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-3 text-[10px] text-[var(--leemo-ink-3)] md:grid xl:grid-cols-[minmax(210px,1.55fr)_minmax(130px,0.9fr)_minmax(110px,0.78fr)_minmax(100px,0.7fr)_minmax(92px,0.62fr)_44px_96px]">
                <span>任务</span>
                <span>频率</span>
                <span className="hidden xl:block">下次运行</span>
                <span className="hidden xl:block">最近结果</span>
                <span className="hidden xl:block">范围</span>
                <span className="text-center">状态</span>
                <span className="text-right">操作</span>
              </div>
              <div className="divide-y divide-[var(--leemo-line)]">
              {filteredTasks.map((task) => {
                const workspace = workspaces.find((candidate) => candidate.id === task.workspaceId);
                const activeRun = runs.find((run) => run.taskId === task.id && (run.status === "queued" || run.status === "running"));
                const latestRun = runs.find((run) => run.taskId === task.id && run.status !== "queued" && run.status !== "running" && run.status !== "missed");
                const latestStatus = latestRun ? runStatus(latestRun) : undefined;
                return (
                  <article key={task.id} data-testid="scheduled-task-row" className="leemo-scheduled-row grid min-h-[64px] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[minmax(190px,1fr)_minmax(125px,0.72fr)_44px_96px] xl:grid-cols-[minmax(210px,1.55fr)_minmax(130px,0.9fr)_minmax(110px,0.78fr)_minmax(100px,0.7fr)_minmax(92px,0.62fr)_44px_96px]">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-[13px] font-medium text-[var(--leemo-ink)]">{task.name}</h3>
                        {activeRun && <span className="shrink-0 text-[10px] text-[var(--leemo-amber)]">进行中</span>}
                      </div>
                      {task.prompt !== task.name && (
                        <p className="mt-0.5 truncate text-[10.5px] text-[var(--leemo-ink-3)]">{task.prompt}</p>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-[var(--leemo-ink-2)]">{scheduleLabel(task)}</p>
                    <p className="hidden truncate text-[11px] tabular-nums text-[var(--leemo-ink-3)] xl:block">{task.nextRunAt && task.status === "active" ? formatTimestamp(task.nextRunAt) : "—"}</p>
                    <p className={`hidden truncate text-[11px] xl:block ${latestStatus?.className ?? "text-[var(--leemo-ink-3)]"}`} title={latestRun?.error}>
                      {activeRun ? "进行中" : latestStatus?.label ?? "尚未运行"}
                    </p>
                    <p data-testid="scheduled-task-scope" className="leemo-scheduled-scope hidden w-fit max-w-full truncate rounded-[5px] px-2 py-1 text-[10.5px] text-[var(--leemo-ink-3)] xl:block">
                      {workspace?.kind === "home" ? "Leemo 工作台" : workspace?.name ?? "本子不可用"}
                    </p>
                    <div role="group" aria-label={`${task.name} 操作`} className="contents">
                      {task.status === "completed" ? (
                        <span className="text-center text-[10px] text-[var(--leemo-ink-3)]">结束</span>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={task.status === "active"}
                          disabled={busyAction !== null}
                          onClick={() => void runAction(`pause-${task.id}`, () => setPaused(task.id, task.status !== "paused"))}
                          className="relative mx-auto h-5 w-8 rounded-full bg-[var(--leemo-line)] transition-colors aria-checked:bg-[var(--leemo-amber)] disabled:opacity-35"
                          title={task.status === "paused" ? "继续任务" : "暂停任务"}
                          aria-label={`${task.status === "paused" ? "继续" : "暂停"} ${task.name}`}
                        >
                          <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${task.status === "active" ? "translate-x-3" : ""}`} />
                          {task.status === "paused" && <span className="sr-only">已暂停</span>}
                        </button>
                      )}
                      <div className="relative flex w-[96px] shrink-0 items-center justify-end gap-0.5">
                      {task.conversationId && (
                        <button type="button" onClick={() => void openConversation(task)} className="leemo-icon-btn" title="查看最近结果" aria-label={`查看 ${task.name} 的最近结果`}>
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
                      <button
                        type="button"
                        onClick={() => setMenuTaskId((current) => current === task.id ? null : task.id)}
                        className="leemo-icon-btn"
                        title="更多操作"
                        aria-label={`更多 ${task.name} 操作`}
                        aria-expanded={menuTaskId === task.id}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                      {menuTaskId === task.id && (
                        <div className="absolute right-0 top-9 z-20 min-w-28 rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-shell-card)] p-1 shadow-[var(--leemo-shadow-popover)]">
                          <button
                            type="button"
                            disabled={busyAction !== null || Boolean(activeRun)}
                            onClick={() => { setMenuTaskId(null); setEditingId(task.id); setForm(formForTask(task)); setFormOpen(true); }}
                            className="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-35"
                            aria-label={`编辑 ${task.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden /> 编辑
                          </button>
                          <button
                            type="button"
                            disabled={busyAction !== null || Boolean(activeRun)}
                            onClick={() => {
                              setMenuTaskId(null);
                              if (window.confirm(`删除定时任务「${task.name}」？`)) {
                                void runAction(`delete-${task.id}`, () => remove(task.id));
                              }
                            }}
                            className="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-xs text-[var(--leemo-danger)] hover:bg-[var(--leemo-danger-soft)] disabled:opacity-35"
                            aria-label={`删除 ${task.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden /> 删除
                          </button>
                        </div>
                      )}
                      </div>
                    </div>
                  </article>
                );
              })}
              </div>
              <p className="border-t border-[var(--leemo-line-soft)] px-3 py-2 text-[10.5px] text-[var(--leemo-ink-3)]">
                关闭窗口后，任务仍会在后台运行
              </p>
            </div>
          )}
        </section>

        {recentRuns.length > 0 && (
          <section className="mt-5 border-t border-[var(--leemo-line)] pt-5" aria-label="最近运行">
            <h2 className="mb-2 text-xs font-semibold text-[var(--leemo-ink-2)]">最近运行</h2>
            <div className="divide-y divide-[var(--leemo-line-2)]">
              {recentRuns.map((run) => {
                const task = taskById.get(run.taskId);
                const workspace = task ? workspaces.find((candidate) => candidate.id === task.workspaceId) : undefined;
                const taskRunning = runs.some((candidate) => (
                  candidate.taskId === run.taskId && (candidate.status === "queued" || candidate.status === "running")
                ));
                const statusView = runStatus(run);
                const Icon = statusView.icon;
                return (
                  <div key={run.id} className="py-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${statusView.className} ${run.status === "running" ? "animate-spin" : ""}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink-2)]">{task?.name ?? "已删除的任务"}</span>
                      <span className={statusView.className}>{statusView.label}</span>
                      <span className="shrink-0 tabular-nums text-[var(--leemo-ink-3)]">{formatTimestamp(run.scheduledFor)}</span>
                      {run.status === "failed" && task && (
                        <button
                          type="button"
                          disabled={busyAction !== null || taskRunning || !workspace?.available}
                          onClick={() => void runAction(`retry-${run.id}`, () => runNow(task.id))}
                          className="leemo-icon-btn h-6 w-6 disabled:cursor-not-allowed disabled:opacity-35"
                          title="重新运行"
                          aria-label={`重新运行 ${task.name}`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                    {run.status === "failed" && run.error && (
                      <p className="mt-1 truncate pl-[22px] text-[var(--leemo-danger)]" title={run.error}>
                        {run.error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
        </div>
      </div>
    </div>
    </div>
  );
}
