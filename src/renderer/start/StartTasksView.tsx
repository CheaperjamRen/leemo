import { Check, Circle, FileText, ListChecks } from "lucide-react";
import { useTasks } from "../bridge/context";

export default function StartTasksView({ selectedTaskId, onOpenNote }: { selectedTaskId: string | null; onOpenNote?: (noteId: string) => void }) {
  const tasks = useTasks((state) => state.tasks);
  const toggle = useTasks((state) => state.toggle);
  const visible = tasks.filter((task) => task.deletedAt === undefined);
  return (
    <div className="leemo-start-simple-page">
      <header className="leemo-start-page-heading">
        <div><h1>待办</h1><p>完成与否由你决定，momo 的回执不会替你勾选。</p></div>
      </header>
      <section className="leemo-start-task-list" aria-label="待办列表">
        {visible.length ? visible.map((task) => (
          <article key={task.id} className={selectedTaskId === task.id ? "is-selected" : ""}>
            <button
              type="button"
              className="leemo-start-task-list__toggle"
              aria-label={task.status === "done" ? `重新打开待办 ${task.title}` : `完成待办 ${task.title}`}
              aria-pressed={task.status === "done"}
              onClick={() => { void toggle(task.id); }}
            >
              <span className="leemo-start-task-list__check">{task.status === "done" ? <Check aria-hidden /> : <Circle aria-hidden />}</span>
            </button>
            <span><strong>{task.title}</strong>{task.details && <small>{task.details}</small>}</span>
            {task.noteId ? (
              <button type="button" className="leemo-start-task-list__source" aria-label="打开来源便签" onClick={() => onOpenNote?.(task.noteId!)}>
                <FileText aria-hidden /><span>来源便签</span>
              </button>
            ) : null}
          </article>
        )) : (
          <div className="leemo-start-simple-empty"><ListChecks aria-hidden /><p>这里还没有待办。</p></div>
        )}
      </section>
    </div>
  );
}
