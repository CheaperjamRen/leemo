import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  FileText,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import type { WorkOverviewUserCorrection } from "../../bridge/work-overview";
import type { ArtifactEntry } from "../stores/artifacts";
import type { TimelineItem } from "../stores/message-model";
import {
  deriveNotebookContinuity,
  type ConversationContinuitySnapshot,
  type NotebookContinuitySnapshot,
} from "./workbench-overview-model";

export type WorkbenchOverviewModel = NotebookContinuitySnapshot;

/** @deprecated Task 8 replaces this ActivityRail adapter with direct Task 4 projections. */
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

/** @deprecated Task 8 replaces this compatibility adapter with real pending/resolved inputs. */
export function deriveWorkbenchOverview(input: DeriveWorkbenchOverviewInput): WorkbenchOverviewModel {
  const ids = [...new Set(input.conversationIds)];
  return deriveNotebookContinuity({
    conversations: ids.map((conversationId) => ({
      conversationId,
      title: input.conversationTitles?.[conversationId]?.trim() || "未命名会话",
      timeline: input.timelines[conversationId] ?? [],
      activeRunId: input.runIds[conversationId] ?? null,
      artifacts: input.artifacts.filter((entry) => entry.sourceConversationId === conversationId),
    })),
  });
}

interface WorkbenchOverviewProps {
  model: NotebookContinuitySnapshot;
  conversationModel?: NotebookContinuitySnapshot;
  notebookScopeLabel?: string;
  onOpenConversation?: (conversationId: string) => void;
  onOpenAttention?: (conversationId: string) => void;
  onOpenArtifact?: (artifact: ArtifactEntry) => void;
  onOpenBoard?: () => void;
  onRequestRefresh?: () => Promise<void> | void;
  onSaveCorrection?: (correction: WorkOverviewUserCorrection) => Promise<void> | void;
}

type RefreshState = { kind: "idle" | "pending" | "success" | "error"; message: string };

function updatedTime(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-[var(--leemo-line-soft)] py-4 last:border-b-0">
      <h3 className="text-[13px] font-semibold leading-5 text-[var(--leemo-ink)]">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function DotRow({
  children,
  tone = "quiet",
}: {
  children: React.ReactNode;
  tone?: "quiet" | "active" | "done" | "danger";
}) {
  const color = tone === "active"
    ? "text-[var(--leemo-amber)]"
    : tone === "done"
      ? "text-[var(--leemo-ok)]"
      : tone === "danger"
        ? "text-[var(--leemo-danger)]"
        : "text-[var(--leemo-ink-3)]";
  return (
    <div className="flex items-start gap-2.5 py-1 text-xs leading-5 text-[var(--leemo-ink-2)]">
      {tone === "done"
        ? <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden />
        : tone === "danger"
          ? <AlertCircle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden />
          : <Circle className={`mt-1 h-2.5 w-2.5 shrink-0 ${color}`} aria-hidden />}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function ArtifactRows({
  artifacts,
  onOpen,
}: {
  artifacts: readonly ArtifactEntry[];
  onOpen?: (artifact: ArtifactEntry) => void;
}) {
  return (
    <div className="divide-y divide-[var(--leemo-line-soft)]">
      {artifacts.slice(0, 5).map((entry) => (
        <button
          key={entry.id}
          type="button"
          aria-label={`打开成果 ${entry.title}`}
          disabled={!onOpen}
          onClick={() => onOpen?.(entry)}
          className="group flex w-full items-center gap-2.5 rounded-[var(--leemo-radius-control)] px-1 py-2 text-left transition-colors hover:bg-[var(--leemo-hover)] disabled:cursor-default"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--leemo-ink-2)]" title={entry.path}>{entry.title}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-4)] transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function ConversationOverview({
  snapshot,
  onOpenArtifact,
  editing,
  objective,
  criteria,
  onObjectiveChange,
  onCriteriaChange,
  onCancelEdit,
  onSaveEdit,
  saving,
  userFixed,
}: {
  snapshot: ConversationContinuitySnapshot;
  onOpenArtifact?: (artifact: ArtifactEntry) => void;
  editing: boolean;
  objective: string;
  criteria: string;
  onObjectiveChange: (value: string) => void;
  onCriteriaChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  saving: boolean;
  userFixed: boolean;
}) {
  const currentPlan = snapshot.currentPlan?.current ? snapshot.currentPlan : undefined;
  return (
    <div className="min-w-0">
      <Section title="工作目标">
        {editing ? (
          <form aria-label="编辑工作目标" className="space-y-3" onSubmit={(event) => { event.preventDefault(); onSaveEdit(); }}>
            <label className="block text-[11px] font-medium text-[var(--leemo-ink-3)]">
              工作目标
              <input
                aria-label="工作目标"
                maxLength={160}
                value={objective}
                onChange={(event) => onObjectiveChange(event.target.value)}
                className="mt-1.5 h-9 w-full rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 text-xs text-[var(--leemo-ink)] outline-none transition-shadow focus:border-[var(--leemo-border-highlight)] focus:ring-2 focus:ring-[var(--leemo-focus-ring)]"
              />
            </label>
            <label className="block text-[11px] font-medium text-[var(--leemo-ink-3)]">
              完成标准
              <textarea
                aria-label="完成标准"
                rows={3}
                value={criteria}
                onChange={(event) => onCriteriaChange(event.target.value)}
                className="mt-1.5 w-full resize-none rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-card)] px-3 py-2 text-xs leading-5 text-[var(--leemo-ink)] outline-none transition-shadow focus:border-[var(--leemo-border-highlight)] focus:ring-2 focus:ring-[var(--leemo-focus-ring)]"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onCancelEdit} className="h-8 rounded-full px-3 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-hover)]">取消</button>
              <button type="submit" disabled={saving || !objective.trim()} className="h-8 rounded-full bg-[var(--leemo-action-accent)] px-3.5 text-xs font-semibold text-[var(--leemo-action-accent-ink)] disabled:opacity-45">保存</button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium leading-6 text-[var(--leemo-ink)]">{snapshot.objective?.text ?? "尚未明确工作目标"}</p>
              {userFixed && <span className="mt-0.5 shrink-0 rounded-full bg-[var(--leemo-amber-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--leemo-amber-ink)]">由你固定</span>}
            </div>
            {snapshot.successCriteria.length > 0 && (
              <div className="mt-2 border-l-2 border-[var(--leemo-line-2)] pl-3">
                {snapshot.successCriteria.slice(0, 5).map((item) => <p key={item} className="py-0.5 text-[11px] leading-5 text-[var(--leemo-ink-3)]">{item}</p>)}
              </div>
            )}
          </>
        )}
      </Section>

      {(snapshot.currentPhase || snapshot.currentFocus) && (
        <Section title="当前阶段与当前重点">
          {snapshot.currentPhase && <p className="text-xs font-medium leading-5 text-[var(--leemo-ink)]">{snapshot.currentPhase}</p>}
          {snapshot.currentFocus && <p className="mt-1 text-xs leading-5 text-[var(--leemo-ink-2)]">{snapshot.currentFocus}</p>}
        </Section>
      )}

      {currentPlan && (
        <Section title="本轮执行">
          <p className="mb-1.5 text-[11px] font-medium tabular-nums text-[var(--leemo-ink-3)]">已完成 {currentPlan.done}/{currentPlan.total} 个已知步骤</p>
          {currentPlan.steps.slice(0, 5).map((step) => (
            <DotRow key={`${step.status}-${step.text}`} tone={step.status === "done" ? "done" : step.status === "active" ? "active" : "quiet"}>{step.text}</DotRow>
          ))}
        </Section>
      )}

      {snapshot.nextKnown.length > 0 && (
        <Section title="接下来">
          {snapshot.nextKnown.slice(0, 5).map((item) => (
            <DotRow key={`${item.certainty}-${item.text}`}>{item.certainty === "possible" ? `可能需要${item.text.replace(/^可能需要/u, "").trim()}` : item.text}</DotRow>
          ))}
        </Section>
      )}

      {snapshot.blockers.length > 0 && (
        <Section title="阻塞或待决定">
          {snapshot.blockers.slice(0, 5).map((item) => <DotRow key={`${item.kind}-${item.text}`} tone="danger">{item.text}</DotRow>)}
        </Section>
      )}

      {snapshot.completed.length > 0 && (
        <Section title="已完成">
          {snapshot.completed.slice(0, 5).map((item) => <DotRow key={item.evidenceId} tone="done">{item.text}</DotRow>)}
        </Section>
      )}

      {snapshot.artifacts.length > 0 && (
        <Section title="相关成果">
          <ArtifactRows artifacts={snapshot.artifacts} onOpen={onOpenArtifact} />
        </Section>
      )}
    </div>
  );
}

function NotebookOverview({
  snapshot,
  onOpenConversation,
}: {
  snapshot: NotebookContinuitySnapshot;
  onOpenConversation?: (conversationId: string) => void;
}) {
  if (snapshot.conversations.length === 0) {
    return <p className="py-16 text-center text-xs text-[var(--leemo-ink-3)]">当前范围还没有可恢复的工作记录</p>;
  }
  return (
    <div className="divide-y divide-[var(--leemo-line-soft)]">
      {snapshot.conversations.slice(0, 5).map((row) => (
        <button
          key={row.conversationId}
          type="button"
          aria-label={`打开会话 ${row.title}`}
          disabled={!onOpenConversation}
          onClick={() => onOpenConversation?.(row.conversationId)}
          className="group w-full rounded-[var(--leemo-radius-control)] px-1 py-3.5 text-left transition-colors hover:bg-[var(--leemo-hover)] disabled:cursor-default"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--leemo-ink)]">{row.title}</span>
            <span className="shrink-0 text-[10px] text-[var(--leemo-ink-3)]">{updatedTime(row.updatedAt)}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-4)] transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--leemo-ink-2)]">{row.objective?.text ?? "尚未明确工作目标"}</p>
          {row.currentPhase && <p className="mt-1 text-[11px] leading-4 text-[var(--leemo-ink-3)]"><span className="mr-1.5">当前阶段</span>{row.currentPhase}</p>}
          {row.nextKnown[0] && <p className="mt-1 text-[11px] leading-4 text-[var(--leemo-ink-3)]"><span className="mr-1.5">下一步</span>{row.nextKnown[0].text}</p>}
          {row.blockers[0] && <p className="mt-1 text-[11px] leading-4 text-[var(--leemo-danger)]"><span className="mr-1.5">待处理</span>{row.blockers[0].text}</p>}
        </button>
      ))}
    </div>
  );
}

export function WorkbenchOverview({
  model,
  conversationModel,
  notebookScopeLabel = "当前本子",
  onOpenConversation,
  onOpenAttention,
  onOpenArtifact,
  onRequestRefresh,
  onSaveCorrection,
}: WorkbenchOverviewProps) {
  const activeConversation = conversationModel?.conversations[0];
  const [scope, setScope] = useState<"notebook" | "conversation">(activeConversation ? "conversation" : "notebook");
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState(activeConversation?.objective?.text ?? "");
  const [criteria, setCriteria] = useState((activeConversation?.successCriteria ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [userFixed, setUserFixed] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>({ kind: "idle", message: "" });
  const sourceOpener = onOpenConversation ?? onOpenAttention;
  const refreshDisabled = !activeConversation || activeConversation.state === "running" || refreshState.kind === "pending" || !onRequestRefresh;

  const beginEdit = () => {
    if (!activeConversation || !onSaveCorrection) return;
    setObjective(activeConversation.objective?.text ?? "");
    setCriteria(activeConversation.successCriteria.join("\n"));
    setEditing(true);
    setMenuOpen(false);
  };

  const saveEdit = async () => {
    if (!onSaveCorrection || !objective.trim()) return;
    setSaving(true);
    try {
      await onSaveCorrection({
        objective: objective.trim(),
        successCriteria: criteria.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean).slice(0, 5),
      });
      setUserFixed(true);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    if (refreshDisabled || !onRequestRefresh) return;
    setRefreshState({ kind: "pending", message: "正在更新概览…" });
    setMenuOpen(false);
    try {
      await onRequestRefresh();
      setRefreshState({ kind: "success", message: "概览已更新" });
    } catch (error) {
      setRefreshState({ kind: "error", message: error instanceof Error ? error.message : "概览暂时无法更新" });
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" data-testid="workbench-overview">
      <div className="sticky top-0 z-10 -mx-5 border-b border-[var(--leemo-line-soft)] bg-[var(--leemo-card)] px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 min-w-0 flex-1 grid-cols-2 rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-surface-sunken)] p-0.5" role="group" aria-label="概览范围">
            <button type="button" aria-pressed={scope === "conversation"} disabled={!activeConversation} onClick={() => { setScope("conversation"); setMenuOpen(false); }} className="rounded-[calc(var(--leemo-radius-control)-2px)] text-xs font-medium text-[var(--leemo-ink-2)] transition-colors aria-pressed:bg-[var(--leemo-card)] aria-pressed:text-[var(--leemo-ink)] aria-pressed:shadow-[var(--leemo-shadow-resting)] disabled:opacity-40">本次会话</button>
            <button type="button" aria-pressed={scope === "notebook"} onClick={() => { setScope("notebook"); setMenuOpen(false); }} className="rounded-[calc(var(--leemo-radius-control)-2px)] text-xs font-medium text-[var(--leemo-ink-2)] transition-colors aria-pressed:bg-[var(--leemo-card)] aria-pressed:text-[var(--leemo-ink)] aria-pressed:shadow-[var(--leemo-shadow-resting)]">{notebookScopeLabel}</button>
          </div>
          <div className="relative">
            <button type="button" aria-label="概览操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} className="leemo-icon-btn h-8 w-8"><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-20 w-36 rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-surface-overlay)] p-1.5 shadow-[var(--leemo-shadow-popover)]">
                <button type="button" onClick={refresh} disabled={refreshDisabled} className="flex h-8 w-full items-center gap-2 rounded-full px-2.5 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-hover)] disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" aria-hidden />更新概览</button>
                <button type="button" onClick={beginEdit} disabled={!activeConversation || !onSaveCorrection} className="flex h-8 w-full items-center gap-2 rounded-full px-2.5 text-left text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-hover)] disabled:opacity-40"><FileText className="h-3.5 w-3.5" aria-hidden />编辑工作目标</button>
              </div>
            )}
          </div>
        </div>
        {(refreshState.kind !== "idle" || activeConversation?.updatedAt) && (
          <div className="mt-2 flex min-h-5 items-center gap-2 text-[11px] text-[var(--leemo-ink-3)]">
            {refreshState.kind !== "idle" ? (
              <p role="status" className={`text-xs ${refreshState.kind === "error" ? "text-[var(--leemo-danger)]" : "text-[var(--leemo-ink-3)]"}`}>{refreshState.message}</p>
            ) : <p>更新于 {updatedTime(activeConversation?.updatedAt)}</p>}
          </div>
        )}
      </div>

      {scope === "conversation" && activeConversation ? (
        <ConversationOverview
          snapshot={activeConversation}
          onOpenArtifact={onOpenArtifact}
          editing={editing}
          objective={objective}
          criteria={criteria}
          onObjectiveChange={setObjective}
          onCriteriaChange={setCriteria}
          onCancelEdit={() => setEditing(false)}
          onSaveEdit={saveEdit}
          saving={saving}
          userFixed={userFixed}
        />
      ) : (
        <NotebookOverview snapshot={model} onOpenConversation={sourceOpener} />
      )}
    </div>
  );
}
