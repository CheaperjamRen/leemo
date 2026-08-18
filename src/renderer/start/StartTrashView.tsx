import { useEffect, useMemo, useState } from "react";
import { FileText, ListChecks, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { Note } from "../../captures";
import type { UserTask } from "../../tasks";
import { IpcTrashClient, type TrashSnapshot } from "../trash/client";

function titleOf(note: Note): string {
  return note.title.trim() || note.markdown.trim().split(/\r?\n/u)[0]?.slice(0, 60) || "无标题文档";
}

function daysLeft(purgeAfter: number | undefined): number | null {
  if (!purgeAfter) return null;
  return Math.max(0, Math.ceil((purgeAfter - Date.now()) / 86_400_000));
}

export default function StartTrashView() {
  const [snapshot, setSnapshot] = useState<TrashSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const client = useMemo(() => window.leemoTrash ? new IpcTrashClient(window.leemoTrash) : null, []);

  const load = async () => {
    if (!client) {
      setError("当前环境暂时无法打开回收站。");
      setSnapshot({ notes: [], tasks: [] });
      return;
    }
    setError(null);
    try {
      setSnapshot(await client.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回收站暂时无法读取。");
    }
  };

  useEffect(() => { void load(); }, []);

  const restore = async (kind: "note" | "task", item: Note | UserTask) => {
    if (!client) return;
    setBusyKey(`${kind}:${item.id}`);
    setError(null);
    try {
      await client.restore({ kind, id: item.id, expectedRevision: item.revision });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复失败，请稍后重试。");
    } finally {
      setBusyKey(null);
    }
  };

  const permanentlyDelete = async (kind: "note" | "task", item: Note | UserTask, title: string) => {
    if (!client || !window.confirm(`确定要彻底删除“${title}”吗？此操作无法恢复。`)) return;
    setBusyKey(`${kind}:${item.id}`);
    setError(null);
    try {
      await client.permanentlyDelete({ kind, id: item.id, expectedRevision: item.revision });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "彻底删除失败，请稍后重试。");
    } finally {
      setBusyKey(null);
    }
  };

  const empty = snapshot && snapshot.notes.length === 0 && snapshot.tasks.length === 0;
  return (
    <div className="leemo-start-trash">
      <header className="leemo-start-page-heading">
        <div><h1>回收站</h1><p>便签保留 30 天；恢复父便签时会连同仍在回收站的子级一起恢复。</p></div>
        <button type="button" aria-label="刷新回收站" disabled={busyKey !== null} onClick={() => void load()}><RefreshCw aria-hidden />刷新</button>
      </header>
      {error ? <p className="leemo-start-trash__error" role="alert">{error}</p> : null}
      {!snapshot ? <div className="leemo-start-simple-empty"><Trash2 aria-hidden /><p>正在读取回收站…</p></div> : null}
      {empty ? <div className="leemo-start-simple-empty"><Trash2 aria-hidden /><p>回收站是空的。</p></div> : null}
      {snapshot && snapshot.notes.length > 0 ? (
        <section className="leemo-start-trash__section" aria-label="已删除便签">
          <h2><FileText aria-hidden />已删除便签 <span>{snapshot.notes.length}</span></h2>
          <div className="leemo-start-trash__list">
            {snapshot.notes.map((note) => {
              const title = titleOf(note);
              const busy = busyKey === `note:${note.id}`;
              const remaining = daysLeft(note.purgeAfter);
              return <article key={note.id}>
                <div><strong>{title}</strong><p>{remaining === null ? "已删除" : `还可恢复 ${remaining} 天`}</p></div>
                <div><button type="button" disabled={busy} aria-label={`恢复便签 ${title}`} onClick={() => void restore("note", note)}><RotateCcw aria-hidden />恢复</button><button type="button" disabled={busy} aria-label={`彻底删除便签 ${title}`} onClick={() => void permanentlyDelete("note", note, title)}>彻底删除</button></div>
              </article>;
            })}
          </div>
        </section>
      ) : null}
      {snapshot && snapshot.tasks.length > 0 ? (
        <section className="leemo-start-trash__section leemo-start-trash__section--tasks" aria-label="已删除待办">
          <button type="button" className="leemo-start-trash__task-toggle" aria-expanded={tasksOpen} onClick={() => setTasksOpen((open) => !open)}><ListChecks aria-hidden />已删除待办 {snapshot.tasks.length}<span>{tasksOpen ? "收起" : "查看"}</span></button>
          {tasksOpen ? <div className="leemo-start-trash__list">{snapshot.tasks.map((task) => {
            const busy = busyKey === `task:${task.id}`;
            return <article key={task.id}><div><strong>{task.title}</strong><p>{task.details || "没有补充说明"}</p></div><div><button type="button" disabled={busy} aria-label={`恢复待办 ${task.title}`} onClick={() => void restore("task", task)}><RotateCcw aria-hidden />恢复</button><button type="button" disabled={busy} aria-label={`彻底删除待办 ${task.title}`} onClick={() => void permanentlyDelete("task", task, task.title)}>彻底删除</button></div></article>;
          })}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
