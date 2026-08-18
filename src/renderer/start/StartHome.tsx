import { ArrowRight, CalendarDays, CheckCircle2, FileText, Inbox, Sparkles } from "lucide-react";
import { useMemo } from "react";
import {
  useApprovals,
  useArtifacts,
  useCaptures,
  useConversations,
  useGlobalPendingOverview,
  useTasks,
  useWorkspaces,
} from "../bridge/context";
import { buildGlobalOverviewFactPack } from "../global-overview/facts";
import { deriveGlobalOverviewDisplayItems } from "../stores/global-pending-overview";
import type { StartDestination } from "./start-navigation";
import GlobalPendingOverviewCard from "./GlobalPendingOverviewCard";

function isToday(timestamp: number | null): boolean {
  if (timestamp === null) return false;
  const now = new Date();
  const value = new Date(timestamp);
  return value.getFullYear() === now.getFullYear()
    && value.getMonth() === now.getMonth()
    && value.getDate() === now.getDate();
}

export default function StartHome({
  onOpen,
  onOpenTask,
  onOpenNote,
}: {
  onOpen(destination: StartDestination): void;
  onOpenTask?(taskId: string): void;
  onOpenNote?(noteId: string, destination: "inbox" | "recent"): void;
}) {
  const tasks = useTasks((state) => state.tasks);
  const notes = useCaptures((state) => state.notes);
  const conversations = useConversations((state) => state.byId);
  const timelines = useConversations((state) => state.timelines);
  const runIds = useConversations((state) => state.runIds);
  const pending = useApprovals((state) => state.pendingByConversation);
  const artifacts = useArtifacts((state) => state.entries);
  const workspaces = useWorkspaces((state) => state.list);
  const snapshot = useGlobalPendingOverview((state) => state.persisted.snapshot);
  const overrides = useGlobalPendingOverview((state) => state.persisted.overrides);
  const overviewStatus = useGlobalPendingOverview((state) => state.status);
  const overviewError = useGlobalPendingOverview((state) => state.error);
  const refreshOverview = useGlobalPendingOverview((state) => state.refresh);

  const facts = useMemo(() => buildGlobalOverviewFactPack({
    tasks,
    conversations,
    timelines,
    runIds,
    pendingConversationIds: new Set(Object.entries(pending).flatMap(([id, value]) => value ? [id] : [])),
    artifacts,
    workspaceLabels: Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name])),
  }).facts, [artifacts, conversations, pending, runIds, tasks, timelines, workspaces]);
  const overviewItems = useMemo(
    () => deriveGlobalOverviewDisplayItems(snapshot, facts, overrides),
    [facts, overrides, snapshot],
  );
  const todayTaskCount = tasks.filter((task) => task.status === "open" && task.deletedAt === undefined && (isToday(task.plannedAt) || isToday(task.dueAt))).length;
  const todayTasks = tasks.filter((task) => task.status === "open" && task.deletedAt === undefined && (isToday(task.plannedAt) || isToday(task.dueAt))).slice(0, 3);
  const inboxCount = notes.filter((note) => note.archivedAt === undefined && note.deletedAt === undefined).length;
  const inbox = notes.filter((note) => note.archivedAt === undefined && note.deletedAt === undefined).slice(0, 3);
  const recentAll = [...notes].filter((note) => note.deletedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = recentAll.slice(0, 3);
  const todayLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  return (
    <div className="leemo-start-home">
      <header className="leemo-start-home__hero">
        <h1>开始</h1>
        <p className="leemo-start-home__summary">
          <CalendarDays aria-hidden />
          <span>{todayLabel}</span>
          <i aria-hidden />
          <span>{todayTaskCount} 项待办</span>
          <i aria-hidden />
          <span>{inboxCount} 条收集</span>
          <i aria-hidden />
          <span>{recentAll.length} 个最近文档</span>
        </p>
      </header>
      <div className="leemo-start-home__grid">
        <GlobalPendingOverviewCard
          snapshot={snapshot}
          items={overviewItems}
          status={overviewStatus}
          error={overviewError}
          onRefresh={() => { void refreshOverview("manual"); }}
          onOpenBoard={() => onOpen("overview")}
          onOpenItem={() => onOpen("overview")}
        />

        <section className="leemo-start-card" data-density={todayTasks.length === 0 ? "compact" : todayTasks.length < 3 ? "regular" : "full"} aria-labelledby="start-today-title">
          <header className="leemo-start-card__header">
            <span className="leemo-start-card__index">02</span>
            <div className="leemo-start-card__heading"><h2 id="start-today-title">今天</h2><span>{todayTaskCount} 项</span></div>
          </header>
          <div className="leemo-start-plain-list">
            {todayTasks.length ? todayTasks.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask ? onOpenTask(task.id) : onOpen("tasks")}><CheckCircle2 aria-hidden /><span><strong>{task.title}</strong>{task.notebookId && <small>{task.notebookId}</small>}</span><ArrowRight aria-hidden /></button>) : <p>今天还没有明确安排。</p>}
          </div>
          <footer className="leemo-start-card__footer"><span>只展示明确属于今天的待办</span><button onClick={() => onOpen("tasks")}>查看待办 <ArrowRight aria-hidden /></button></footer>
        </section>

        <section className="leemo-start-card" data-density={inbox.length === 0 ? "compact" : inbox.length < 3 ? "regular" : "full"} aria-labelledby="start-inbox-title">
          <header className="leemo-start-card__header">
            <span className="leemo-start-card__index">03</span>
            <div className="leemo-start-card__heading"><h2 id="start-inbox-title">收集箱</h2><span>{inboxCount} 条最近记录</span></div>
          </header>
          <div className="leemo-start-plain-list">
            {inbox.length ? inbox.map((note) => <button type="button" key={note.id} onClick={() => onOpenNote ? onOpenNote(note.id, "inbox") : onOpen("inbox")}><Inbox aria-hidden /><span><strong>{note.title || note.markdown.slice(0, 48) || "无标题便签"}</strong></span><ArrowRight aria-hidden /></button>) : <p>随手记下的内容会安静地留在这里。</p>}
          </div>
          <footer className="leemo-start-card__footer"><span><Sparkles aria-hidden />记录后不会自动叫醒 AI</span><button onClick={() => onOpen("inbox")}>打开收集箱 <ArrowRight aria-hidden /></button></footer>
        </section>

        <section className="leemo-start-card" data-density={recent.length === 0 ? "compact" : recent.length < 3 ? "regular" : "full"} aria-labelledby="start-recent-title">
          <header className="leemo-start-card__header">
            <span className="leemo-start-card__index">04</span>
            <div className="leemo-start-card__heading"><h2 id="start-recent-title">最近</h2><span>本地文档</span></div>
          </header>
          <div className="leemo-start-plain-list">
            {recent.length ? recent.map((note) => <button type="button" key={note.id} onClick={() => onOpenNote ? onOpenNote(note.id, "recent") : onOpen("recent")}><FileText aria-hidden /><span><strong>{note.title || "无标题便签"}</strong></span><time>{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</time></button>) : <p>最近编辑过的文档会出现在这里。</p>}
          </div>
          <footer className="leemo-start-card__footer"><span>原文件与便签都保持本地</span><button onClick={() => onOpen("recent")}>查看最近 <ArrowRight aria-hidden /></button></footer>
        </section>
      </div>
    </div>
  );
}
