import { useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Check, Circle, FileText, ListChecks, Pencil, Plus, Trash2, X } from "lucide-react";
import type { UserTask } from "../../tasks";
import { useTasks } from "../bridge/context";

type TaskFilter = "open" | "done" | "all";

interface TaskDraft {
  title: string;
  details: string;
  plannedDate: string;
}

const EMPTY_DRAFT: TaskDraft = { title: "", details: "", plannedDate: "" };

function toDateInput(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(timestamp - offset).toISOString().slice(0, 10);
}

function fromDateInput(value: string): number | null {
  return value ? new Date(`${value}T09:00:00`).getTime() : null;
}

function draftFor(task?: UserTask): TaskDraft {
  return task ? {
    title: task.title,
    details: task.details,
    plannedDate: toDateInput(task.plannedAt),
  } : { ...EMPTY_DRAFT };
}

function TaskEditor({ task, saving, onCancel, onSubmit }: {
  task?: UserTask;
  saving: boolean;
  onCancel(): void;
  onSubmit(draft: TaskDraft): Promise<void>;
}) {
  const [draft, setDraft] = useState(() => draftFor(task));
  const [validation, setValidation] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      setValidation("请先写下待办标题。");
      return;
    }
    setValidation(null);
    await onSubmit({ ...draft, title: draft.title.trim(), details: draft.details.trim() });
  };

  return (
    <form className="leemo-start-task-editor" aria-label={task ? `编辑待办 ${task.title}` : "新建待办"} onSubmit={(event) => { void submit(event); }}>
      <header>
        <div><strong>{task ? "编辑待办" : "新建待办"}</strong><span>{task ? "修改不会改变完成状态。" : "先记下来，完成时间由你决定。"}</span></div>
        <button type="button" aria-label="关闭待办编辑" onClick={onCancel}><X aria-hidden /></button>
      </header>
      <div className="leemo-start-task-editor__fields">
        <label className="leemo-start-task-editor__title">
          <span>标题</span>
          <input autoFocus type="text" aria-label="待办标题" value={draft.title} placeholder="例如：完善作品集" disabled={saving} onChange={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, title: value })); }} />
        </label>
        <label>
          <span>计划日期</span>
          <input type="date" aria-label="计划日期" value={draft.plannedDate} disabled={saving} onChange={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, plannedDate: value })); }} />
        </label>
        <label className="leemo-start-task-editor__details">
          <span>说明（可选）</span>
          <textarea aria-label="待办说明" value={draft.details} rows={2} disabled={saving} placeholder="补充你需要记住的上下文" onChange={(event) => { const value = event.currentTarget.value; setDraft((current) => ({ ...current, details: value })); }} />
        </label>
      </div>
      <footer>
        {validation ? <p role="alert">{validation}</p> : <span />}
        <button type="button" onClick={onCancel}>取消</button>
        <button type="submit" className="is-primary" disabled={saving}>{task ? "保存待办" : "创建待办"}</button>
      </footer>
    </form>
  );
}

export default function StartTasksView({ selectedTaskId, onOpenNote }: { selectedTaskId: string | null; onOpenNote?: (noteId: string) => void }) {
  const tasks = useTasks((state) => state.tasks);
  const storeError = useTasks((state) => state.error);
  const saving = useTasks((state) => state.saving);
  const create = useTasks((state) => state.create);
  const update = useTasks((state) => state.update);
  const remove = useTasks((state) => state.delete);
  const toggle = useTasks((state) => state.toggle);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const visible = useMemo(() => tasks
    .filter((task) => task.deletedAt === undefined)
    .filter((task) => filter === "all" || task.status === filter)
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "open" ? -1 : 1;
      if (left.plannedAt !== right.plannedAt) return (left.plannedAt ?? Number.MAX_SAFE_INTEGER) - (right.plannedAt ?? Number.MAX_SAFE_INTEGER);
      return right.updatedAt - left.updatedAt;
    }), [filter, tasks]);
  const editingTask = typeof editingId === "string" && editingId !== "new" ? tasks.find((task) => task.id === editingId) : undefined;
  const deleteCandidate = deleteCandidateId ? tasks.find((task) => task.id === deleteCandidateId) : undefined;

  const runAction = async (action: () => Promise<unknown>, onSuccess?: () => void) => {
    setActionError(null);
    try {
      await action();
      onSuccess?.();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="leemo-start-simple-page leemo-start-tasks">
      <header className="leemo-start-page-heading leemo-start-task-heading">
        <div><h1>待办</h1><p>按计划和完成状态整理你的待办。</p></div>
        <button type="button" className="leemo-start-task-heading__create" onClick={() => setEditingId("new")}><Plus aria-hidden />新建待办</button>
      </header>

      <div className="leemo-start-task-filters" aria-label="筛选待办">
        {(["open", "done", "all"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "open" ? "未完成" : value === "done" ? "已完成" : "全部"}
            <span>{tasks.filter((task) => task.deletedAt === undefined && (value === "all" || task.status === value)).length}</span>
          </button>
        ))}
      </div>

      {editingId ? (
        <TaskEditor
          key={editingId}
          task={editingTask}
          saving={saving}
          onCancel={() => setEditingId(null)}
          onSubmit={async (draft) => runAction(
            () => editingTask
              ? update({ id: editingTask.id, expectedRevision: editingTask.revision, title: draft.title, details: draft.details, plannedAt: fromDateInput(draft.plannedDate) })
              : create({ title: draft.title, details: draft.details, plannedAt: fromDateInput(draft.plannedDate) }),
            () => setEditingId(null),
          )}
        />
      ) : null}

      {actionError || storeError ? <p className="leemo-start-task-error" role="alert">{actionError || storeError}</p> : null}

      <section className="leemo-start-task-list" aria-label="待办列表">
        {visible.length ? visible.map((task) => (
          <article key={task.id} className={`${selectedTaskId === task.id ? "is-selected" : ""} ${task.status === "done" ? "is-done" : ""}`.trim()}>
            <button type="button" className="leemo-start-task-list__toggle" aria-label={task.status === "done" ? `重新打开待办 ${task.title}` : `完成待办 ${task.title}`} aria-pressed={task.status === "done"} onClick={() => { void runAction(() => toggle(task.id)); }}>
              <span className="leemo-start-task-list__check">{task.status === "done" ? <Check aria-hidden /> : <Circle aria-hidden />}</span>
            </button>
            <div className="leemo-start-task-list__content">
              <strong>{task.title}</strong>
              <div>
                {task.details ? <small>{task.details}</small> : null}
                {task.plannedAt ? <time dateTime={new Date(task.plannedAt).toISOString()}><CalendarDays aria-hidden />{new Date(task.plannedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time> : null}
              </div>
            </div>
            <div className="leemo-start-task-list__actions">
              {task.noteId ? <button type="button" className="leemo-start-task-list__source" aria-label="打开来源便签" onClick={() => onOpenNote?.(task.noteId!)}><FileText aria-hidden /><span>来源便签</span></button> : null}
              <button type="button" aria-label={`编辑待办 ${task.title}`} title="编辑" onClick={() => setEditingId(task.id)}><Pencil aria-hidden /></button>
              <button type="button" aria-label={`删除待办 ${task.title}`} title="删除" onClick={() => setDeleteCandidateId(task.id)}><Trash2 aria-hidden /></button>
            </div>
          </article>
        )) : (
          <div className="leemo-start-simple-empty"><ListChecks aria-hidden /><p>{filter === "done" ? "还没有已完成的待办。" : "这里还没有待办。"}</p><button type="button" onClick={() => setEditingId("new")}><Plus aria-hidden />新建待办</button></div>
        )}
      </section>

      {deleteCandidate ? (
        <div className="leemo-start-task-confirm-backdrop">
          <div className="leemo-start-task-confirm" role="dialog" aria-modal="true" aria-label="删除待办？">
            <strong>删除“{deleteCandidate.title}”？</strong>
            <p>它会先进入回收站，不会立即永久删除。</p>
            <footer><button type="button" onClick={() => setDeleteCandidateId(null)}>取消</button><button type="button" className="is-danger" disabled={saving} onClick={() => { void runAction(() => remove({ id: deleteCandidate.id, expectedRevision: deleteCandidate.revision }), () => setDeleteCandidateId(null)); }}>确认删除</button></footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
