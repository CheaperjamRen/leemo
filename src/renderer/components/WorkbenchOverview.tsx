import { useState } from "react";
import {
  ArrowRight,
  Bot,
  ChevronRight,
  CheckCircle2,
  Circle,
  CircleDot,
  ListTodo,
  MessageCircleMore,
} from "lucide-react";
import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";
import type { WorkOverviewData } from "../../bridge/work-overview";

type TodoStatus = "done" | "active" | "todo";
type CollaboratorStatus = "running" | "ok" | "error";

export interface WorkbenchOverviewModel {
  conversationCount: number;
  runningCount: number;
  attentionCount: number;
  artifactCount: number;
  todos: { text: string; status: TodoStatus }[];
  collaborators: { role: string; task: string; status: CollaboratorStatus }[];
  recentArtifacts: ArtifactEntry[];
  attentionItems?: { conversationId: string; summary: string }[];
  runningItems?: { conversationId: string; summary: string }[];
  sourceConversationTitles?: Record<string, string>;
  overview: (WorkOverviewData & { source: "momo" | "fallback" }) | null;
}

export interface DeriveWorkbenchOverviewInput {
  conversationIds: string[];
  activeConversationId: string | null;
  conversationTitles?: Record<string, string | undefined>;
  timelines: Record<string, TimelineItem[]>;
  runIds: Record<string, string | null | undefined>;
  pendingConversationIds: ReadonlySet<string>;
  pendingSummaries?: Record<string, string | undefined>;
  artifacts: ArtifactEntry[];
}

function latestPlan(
  conversationIds: string[],
  activeConversationId: string | null,
  timelines: Record<string, TimelineItem[]>,
  runIds: Record<string, string | null | undefined>,
): { conversationId: string; plan: Extract<TimelineItem, { kind: "plan" }> } | null {
  const ordered = activeConversationId && conversationIds.includes(activeConversationId)
    ? [activeConversationId, ...conversationIds.filter((id) => id !== activeConversationId)]
    : conversationIds;
  for (const conversationId of ordered) {
    const activeRunId = runIds[conversationId];
    if (!activeRunId) continue;
    const timeline = timelines[conversationId] ?? [];
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item.kind === "plan" && item.runId === activeRunId) return { conversationId, plan: item };
    }
  }
  return null;
}

function latestSemanticOverview(
  conversationIds: string[],
  timelines: Record<string, TimelineItem[]>,
): { conversationId: string; item: Extract<TimelineItem, { kind: "overview" }> } | null {
  let latest: { conversationId: string; item: Extract<TimelineItem, { kind: "overview" }> } | null = null;
  let latestOrder = -1;
  let order = 0;
  for (const conversationId of conversationIds) {
    for (const item of timelines[conversationId] ?? []) {
      order += 1;
      if (item.kind !== "overview") continue;
      const timestamp = item.createdAt ?? Number.NEGATIVE_INFINITY;
      const latestTimestamp = latest?.item.createdAt ?? Number.NEGATIVE_INFINITY;
      if (!latest || timestamp > latestTimestamp || (timestamp === latestTimestamp && order > latestOrder)) {
        latest = { conversationId, item };
        latestOrder = order;
      }
    }
  }
  return latest;
}

function hasLatestFailure(timeline: TimelineItem[]): boolean {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "error") return true;
    if (item.kind === "result") return item.isError;
  }
  return false;
}

function fallbackOverview(
  input: DeriveWorkbenchOverviewInput,
  conversationIds: string[],
  plan: ReturnType<typeof latestPlan>,
): WorkOverviewData | null {
  const primaryId = input.activeConversationId && conversationIds.includes(input.activeConversationId)
    ? input.activeConversationId
    : plan?.conversationId
      ?? conversationIds.find((id) => input.runIds[id] != null)
      ?? conversationIds.find((id) => input.pendingConversationIds.has(id))
      ?? conversationIds.find((id) => hasLatestFailure(input.timelines[id] ?? []))
      ?? input.artifacts.find((artifact) => conversationIds.includes(artifact.sourceConversationId))?.sourceConversationId
      ?? conversationIds[0];
  if (!primaryId) return null;

  const title = input.conversationTitles?.[primaryId]?.trim();
  const activePlan = plan?.conversationId === primaryId ? plan.plan : null;
  const activeTodo = activePlan?.todos.find((todo) => todo.status === "active");
  const nextTodo = activePlan?.todos.find((todo) => todo.status === "todo");
  const latestArtifact = [...input.artifacts]
    .filter((artifact) => artifact.sourceConversationId === primaryId)
    .sort((left, right) => right.createdAt - left.createdAt)[0];

  const overview: WorkOverviewData = { ...(title ? { theme: title } : {}) };
  if (input.runIds[primaryId] != null) {
    overview.summary = "这段工作正在进行中。";
    if (activeTodo) overview.currentPosition = activeTodo.text;
    if (nextTodo) overview.nextStep = nextTodo.text;
  } else if (input.pendingConversationIds.has(primaryId)) {
    overview.summary = "这段工作正在等待你的确认或回答。";
    overview.currentPosition = "正在等你处理";
    overview.nextStep = "处理后继续";
  } else if (hasLatestFailure(input.timelines[primaryId] ?? [])) {
    overview.summary = "这段工作上次没有完成。";
    overview.currentPosition = "上次任务遇到问题";
    overview.nextStep = "查看错误后决定是否重试";
  } else if (latestArtifact) {
    overview.summary = `最近产出了“${latestArtifact.title}”。`;
  }

  return Object.keys(overview).length > 0 ? overview : null;
}

export function deriveWorkbenchOverview(input: DeriveWorkbenchOverviewInput): WorkbenchOverviewModel {
  const conversationIds = [...new Set(input.conversationIds)];
  const plan = latestPlan(conversationIds, input.activeConversationId, input.timelines, input.runIds);
  const semantic = latestSemanticOverview(conversationIds, input.timelines);
  const fallback = fallbackOverview(input, conversationIds, plan);
  const semanticFallback = semantic
    ? fallbackOverview(
        input,
        [semantic.conversationId],
        latestPlan([semantic.conversationId], semantic.conversationId, input.timelines, input.runIds),
      )
    : null;
  const collaborators: WorkbenchOverviewModel["collaborators"] = [];

  for (const conversationId of conversationIds) {
    for (const item of input.timelines[conversationId] ?? []) {
      if (item.kind !== "activity") continue;
      collaborators.push({
        role: item.role?.trim() || "任务助手",
        task: item.task?.trim() || "协作任务",
        status: item.status ?? (item.tools.some((tool) => tool.status === "error")
          ? "error"
          : item.tools.some((tool) => tool.status === "running")
            ? "running"
            : "ok"),
      });
    }
  }

  return {
    conversationCount: conversationIds.length,
    runningCount: conversationIds.filter((id) => input.runIds[id] != null).length,
    attentionCount: conversationIds.filter((id) => input.pendingConversationIds.has(id)).length,
    artifactCount: input.artifacts.length,
    todos: (plan?.plan.todos ?? []).map(({ text, status }) => ({ text, status })),
    collaborators: collaborators.slice(-8),
    recentArtifacts: [...input.artifacts]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 8),
    attentionItems: conversationIds
      .filter((id) => input.pendingConversationIds.has(id))
      .map((conversationId) => ({
        conversationId,
        summary: input.pendingSummaries?.[conversationId]?.trim()
          || input.conversationTitles?.[conversationId]?.trim()
          || "",
      }))
      .filter((item) => item.summary.length > 0),
    runningItems: conversationIds
      .filter((id) => input.runIds[id] != null)
      .map((conversationId) => {
        const activePlan = latestPlan([conversationId], conversationId, input.timelines, input.runIds)?.plan;
        return {
          conversationId,
          summary: activePlan?.todos.find((todo) => todo.status === "active")?.text.trim()
            || input.conversationTitles?.[conversationId]?.trim()
            || "",
        };
      })
      .filter((item) => item.summary.length > 0),
    sourceConversationTitles: Object.fromEntries(
      conversationIds.flatMap((id) => {
        const title = input.conversationTitles?.[id]?.trim();
        return title ? [[id, title]] : [];
      }),
    ),
    overview: semantic
      ? { ...(semanticFallback ?? {}), ...semantic.item.overview, source: "momo" }
      : fallback
        ? { ...fallback, source: "fallback" }
        : null,
  };
}

function TodoIcon({ status }: { status: TodoStatus }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
  if (status === "active") return <CircleDot className="h-3.5 w-3.5 text-[var(--leemo-amber)]" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 text-[var(--leemo-ink-3)]" aria-hidden />;
}

function artifactBadge(title: string): string {
  const extension = title.split(".").at(-1)?.trim().toUpperCase();
  if (!extension || extension === title.toUpperCase()) return "文件";
  return extension.slice(0, 4);
}

function artifactTime(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.valueOf())) return "";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return sameDay ? `今天 ${time}` : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

interface WorkbenchOverviewProps {
  model: WorkbenchOverviewModel;
  conversationModel?: WorkbenchOverviewModel;
  notebookScopeLabel?: string;
  onOpenAttention?: (conversationId: string) => void;
  onOpenBoard?: () => void;
  onOpenArtifact?: (artifact: ArtifactEntry) => void;
}

export function WorkbenchOverview({
  model,
  conversationModel,
  notebookScopeLabel = "当前本子",
  onOpenAttention,
  onOpenBoard,
  onOpenArtifact,
}: WorkbenchOverviewProps) {
  const [scope, setScope] = useState<"notebook" | "conversation">("notebook");
  const visibleModel = scope === "conversation" && conversationModel ? conversationModel : model;
  const activeTodos = visibleModel.todos.filter((todo) => todo.status === "active");
  const doneTodoCount = visibleModel.todos.filter((todo) => todo.status === "done").length;
  const progressPercent = visibleModel.todos.length > 0
    ? Math.round((doneTodoCount / visibleModel.todos.length) * 100)
    : 0;
  const hasProgress = visibleModel.overview != null
    || visibleModel.conversationCount > 0
    || visibleModel.artifactCount > 0
    || visibleModel.todos.length > 0
    || visibleModel.collaborators.length > 0;

  if (!hasProgress && !conversationModel) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-8 text-center">
        <ListTodo className="mb-3 h-5 w-5 text-[var(--leemo-ink-3)]" aria-hidden />
        <p className="text-sm text-[var(--leemo-ink-2)]">这里还没有可汇总的进展</p>
        <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">开始一段任务后，计划、协作和产物会在这里汇总。</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-0" data-testid="workbench-overview">
      <div className="flex min-h-full flex-col">
        {conversationModel && (
          <div className="sticky top-0 z-10 -mx-5 bg-[var(--leemo-card)] px-5 pb-3 pt-4">
            <div className="grid h-9 grid-cols-2 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-side-hover)] p-0.5" role="group" aria-label="概览范围">
              {([
                ["notebook", notebookScopeLabel],
                ["conversation", "本次会话"],
              ] as const).map(([value, label]) => {
                const active = scope === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setScope(value)}
                    className={`rounded-md text-xs font-medium transition-colors ${active ? "bg-[var(--leemo-card)] text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-b border-[var(--leemo-line)] pb-4 pt-1 text-[11px] font-medium text-[var(--leemo-ink-3)]" aria-label="范围状态">
          <span><b className="font-semibold tabular-nums text-[var(--leemo-ink)]">{visibleModel.runningCount}</b> 项进行中</span>
          <span aria-hidden>·</span>
          <span><b className="font-semibold tabular-nums text-[var(--leemo-ink)]">{visibleModel.attentionCount}</b> 项待回答</span>
          <span aria-hidden>·</span>
          <span><b className="font-semibold tabular-nums text-[var(--leemo-ink)]">{visibleModel.artifactCount}</b> 个新成果</span>
        </div>

        {!hasProgress && (
          <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center px-6 text-center">
            <ListTodo className="mb-3 h-5 w-5 text-[var(--leemo-ink-3)]" aria-hidden />
            <p className="text-sm text-[var(--leemo-ink-2)]">这次会话还没有可汇总的进展</p>
            <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-3)]">开始任务后，这里会显示当前重点和成果。</p>
          </div>
        )}

        {visibleModel.overview && (
          <section className="border-b border-[var(--leemo-line)] py-5" aria-labelledby="overview-main-heading">
            <h2 id="overview-main-heading" className="text-[15px] font-semibold leading-6 text-[var(--leemo-ink)]">
              {scope === "conversation" ? "这次会话在做什么" : "这个本子在做什么"}
            </h2>
            {visibleModel.overview.theme && (
              <p className="mt-2 text-sm font-medium leading-6 text-[var(--leemo-ink)]">{visibleModel.overview.theme}</p>
            )}
            {visibleModel.overview.summary && (
              <p className="mt-1.5 text-xs leading-[1.7] text-[var(--leemo-ink-2)]">{visibleModel.overview.summary}</p>
            )}
            {(visibleModel.overview.focus || visibleModel.overview.currentPosition || visibleModel.overview.nextStep) && (
              <div className="mt-5">
                <h3 className="text-[13px] font-semibold text-[var(--leemo-ink)]">当前重点</h3>
                <div className="mt-2.5 space-y-2.5 text-xs leading-5 text-[var(--leemo-ink-2)]">
                  {visibleModel.overview.focus && (
                    <div className="flex items-start gap-2.5">
                      <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-amber)]" aria-hidden />
                      <span>{visibleModel.overview.focus}</span>
                    </div>
                  )}
                  {visibleModel.overview.currentPosition && (
                    <div className="flex items-start gap-2.5">
                      <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-amber)]" aria-hidden />
                      <span><span className="mr-1.5 text-[var(--leemo-ink-3)]">现在</span>{visibleModel.overview.currentPosition}</span>
                    </div>
                  )}
                  {visibleModel.overview.nextStep && (
                    <div className="flex items-start gap-2.5">
                      <CircleDot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-amber)]" aria-hidden />
                      <span><span className="mr-1.5 text-[var(--leemo-ink-3)]">接下来</span>{visibleModel.overview.nextStep}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {visibleModel.attentionCount > 0 && (
          <section className="border-b border-[var(--leemo-line)] py-5" aria-labelledby="overview-attention-heading">
            <h3 id="overview-attention-heading" className="text-[13px] font-semibold text-[var(--leemo-ink)]">需要你处理 · {visibleModel.attentionCount}</h3>
            <div className="mt-2 divide-y divide-[var(--leemo-line)]">
              {(visibleModel.attentionItems ?? []).map((item) => (
                <button
                  key={item.conversationId}
                  type="button"
                  aria-label={`打开待处理 ${item.summary}`}
                  onClick={() => onOpenAttention?.(item.conversationId)}
                  disabled={!onOpenAttention}
                  className="flex w-full items-center gap-2.5 py-2.5 text-left text-xs leading-5 text-[var(--leemo-ink-2)] disabled:cursor-default"
                >
                  <MessageCircleMore className="h-4 w-4 shrink-0 text-[var(--leemo-ink-2)]" aria-hidden />
                  <span className="min-w-0 flex-1 line-clamp-2">{item.summary}</span>
                  <span className="shrink-0 text-[11px] font-medium text-[var(--leemo-amber)]">待回答</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                </button>
              ))}
            </div>
          </section>
        )}

        {(visibleModel.runningCount > 0 || activeTodos.length > 0 || visibleModel.collaborators.some((item) => item.status === "running")) && (
          <section className="border-b border-[var(--leemo-line)] py-5" aria-labelledby="overview-running-heading">
            <h3 id="overview-running-heading" className="text-[13px] font-semibold text-[var(--leemo-ink)]">进行中</h3>
            <div className="mt-2.5 space-y-2.5">
              {(activeTodos.length > 0 ? activeTodos : (visibleModel.runningItems ?? []).map((item) => ({ text: item.summary, status: "active" as const }))).map((todo, index) => (
                <div key={`${todo.text}-${index}`} className="flex items-start gap-2.5 text-xs leading-5 text-[var(--leemo-ink-2)]">
                  <span className="mt-[3px] shrink-0"><TodoIcon status={todo.status} /></span>
                  <span>{todo.text}</span>
                </div>
              ))}
              {visibleModel.collaborators.filter((item) => item.status === "running").map((collaborator, index) => (
                <div key={`${collaborator.role}-${collaborator.task}-${index}`} className="flex items-start gap-2.5 text-xs leading-5 text-[var(--leemo-ink-2)]">
                  <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                  <span className="min-w-0 flex-1">{collaborator.role} · {collaborator.task}</span>
                </div>
              ))}
              {visibleModel.todos.length > 0 && (
                <div className="flex items-center gap-3 pt-1">
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--leemo-ink-3)]">{doneTodoCount}/{visibleModel.todos.length} 已完成</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--leemo-line)]" aria-label={`计划进度 ${doneTodoCount}/${visibleModel.todos.length}`}>
                    <div className="h-full rounded-full bg-[var(--leemo-amber)]" style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {visibleModel.recentArtifacts.length > 0 && (
          <section className="border-b border-[var(--leemo-line)] py-5" aria-labelledby="overview-artifacts-heading">
            <h3 id="overview-artifacts-heading" className="text-[13px] font-semibold text-[var(--leemo-ink)]">最近成果</h3>
            <div className="mt-2.5 space-y-2">
              {visibleModel.recentArtifacts.slice(0, 3).map((artifact) => {
                const sourceTitle = visibleModel.sourceConversationTitles?.[artifact.sourceConversationId];
                const time = artifactTime(artifact.createdAt);
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    aria-label={`打开成果 ${artifact.title}`}
                    onClick={() => onOpenArtifact?.(artifact)}
                    disabled={!onOpenArtifact}
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--leemo-side-hover)] disabled:cursor-default"
                  >
                    <span className="grid h-9 w-8 shrink-0 place-items-center rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] text-[9px] font-semibold text-[var(--leemo-ink-2)]">
                      {artifactBadge(artifact.title)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--leemo-ink)]" title={artifact.path}>{artifact.title}</span>
                      {(sourceTitle || time) && <span className="mt-0.5 block truncate text-[10px] text-[var(--leemo-ink-3)]">{[sourceTitle && `来自：${sourceTitle}`, time].filter(Boolean).join(" · ")}</span>}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {onOpenBoard && (
          <div className="mt-auto py-4">
            <button
              type="button"
              onClick={onOpenBoard}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs font-medium text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
            >
              打开完整看板
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
