import { useState, type ReactNode } from "react";
import type { TimelineItem } from "../../stores/message-model";
import ToolCard from "./ToolCard";
import PlanCard from "./PlanCard";
import ActivityCard from "./ActivityCard";
import CompactDivider from "./CompactDivider";
import ApprovalBar from "../ApprovalBar";
import { isMcpToolName, toolActionLabel } from "../tool-labels";
import MomoAvatar from "../momo/MomoAvatar";

function renderProcess(
  item: TimelineItem,
  runId: string,
  density: ProcessDensity,
  stale: boolean,
  siblingIndex?: number,
) {
  switch (item.kind) {
    // A tool awaiting permission renders its approval card right here, so the
    // question sits where the work is instead of at the end of the turn.
    case "tool": return (
      <div key={item.id} className="space-y-1.5">
        <ToolCard item={item} stale={stale} />
        {item.toolUseId !== undefined && (
          <ApprovalBar
            runId={runId}
            toolUseId={item.toolUseId}
            density={density === "buddy" ? "buddy" : "default"}
          />
        )}
      </div>
    );
    case "plan": return <PlanCard key={item.id} item={item} />;
    case "activity": return <ActivityCard key={item.id} item={item} stale={stale} siblingIndex={siblingIndex} />;
    case "retry": return <RetryStatus key={item.id} item={item} />;
    case "compact": return <CompactDivider key={item.id} item={item} />;
    case "thinking": return null;
    default: return null;
  }
}

function RetryStatus({ item }: { item: Extract<TimelineItem, { kind: "retry" }> }) {
  const [expanded, setExpanded] = useState(false);
  const label = item.state === "recovered"
    ? "连接已恢复"
    : item.state === "failed"
      ? "重新连接未成功"
      : item.summary;
  return (
    <div className="overflow-hidden rounded-[9px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)]">
      <button
        type="button"
        aria-label="查看重连错误详情"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.state === "failed" ? "bg-[var(--leemo-danger)]" : "bg-[var(--leemo-amber)]"}`}
          aria-hidden
        />
        <span className="min-w-0 truncate text-[12px] text-[var(--leemo-ink-2)]">{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)] transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <pre className="max-h-36 overflow-auto border-t border-[var(--leemo-line-2)] px-2.5 py-2 text-[11px] leading-5 text-[var(--leemo-ink-3)] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {item.detail}
        </pre>
      )}
    </div>
  );
}

type ProcessDensity = "workbench" | "buddy";
export type ProcessOutcome = "success" | "error" | "interrupted";

function hasStaleWork(items: TimelineItem[]): boolean {
  return items.some((item) =>
    (item.kind === "tool" && item.status === "running")
    || (item.kind === "activity" && (
      item.status === "running" || item.tools.some((tool) => tool.status === "running")
    ))
    || (item.kind === "thinking" && item.streaming),
  );
}

function buddySummary(
  items: TimelineItem[],
  activeTurn: boolean,
  stale: boolean,
  outcome?: ProcessOutcome,
): string {
  const latest = [...items].reverse().find((item) => item.kind !== "thinking");
  if (latest?.kind === "retry" && latest.state === "retrying") return latest.summary;
  if (outcome === "interrupted") return "momo 已停下这一步";
  if (outcome === "error") return "有一步没完成，点开看看";
  const hasError = items.some((item) =>
    (item.kind === "tool" && item.status === "error")
    || (item.kind === "activity" && (
      item.status === "error" || item.tools.some((tool) => tool.status === "error")
    )),
  );
  if (hasError) return "有一步没完成，点开看看";
  if (stale) return "上次停在这里";

  if (!activeTurn) {
    return "任务已完成";
  }

  const activeItem = [...items].reverse().find((item) =>
    (item.kind === "tool" && item.status === "running")
    || (item.kind === "activity" && (
      item.status === "running" || item.tools.some((tool) => tool.status === "running")
    ))
    || (item.kind === "plan" && item.todos.some((todo) => todo.status === "active"))
    || (item.kind === "thinking" && item.streaming),
  );
  if (!activeItem) return "momo 正在继续处理…";
  if (activeItem.kind === "thinking") return "momo 正在想一想…";
  if (activeItem.kind === "plan") return "momo 正在梳理步骤…";
  if (activeItem.kind === "activity") return "momo 请了小助手一起核对…";
  if (activeItem.kind === "tool") {
    const name = activeItem.name.toLowerCase();
    if (/read|grep|glob|notebook/.test(name)) return "momo 正在翻翻本子里的内容…";
    if (/websearch|webfetch|browser|playwright|chrome/.test(name)) return "momo 正在查资料…";
    if (/write|edit/.test(name)) return "momo 正在整理内容…";
    if (/bash|powershell|shell|command/.test(name)) return "momo 正在运行检查…";
    if (/task|agent/.test(name)) return "momo 请了小助手一起核对…";
  }
  return "momo 正在继续处理…";
}

function toolAction(name: string): string {
  if (isMcpToolName(name)) return toolActionLabel(name).replace(/^在/u, "");
  const lower = name.toLowerCase();
  if (/websearch|webfetch|browser|playwright|chrome/.test(lower)) return "查询资料";
  if (/grep|glob|search/.test(lower)) return "搜索内容";
  if (/read|notebook/.test(lower)) return "读取资料";
  if (/write|edit/.test(lower)) return "编辑文件";
  if (/bash|powershell|shell|command/.test(lower)) return "执行命令";
  if (/task|agent/.test(lower)) return "运行子任务";
  return `运行 ${name}`;
}

function workbenchSummary(
  items: TimelineItem[],
  activeTurn: boolean,
  stale: boolean,
  outcome?: ProcessOutcome,
): string {
  const latest = [...items].reverse().find((item) => item.kind !== "thinking");
  if (latest?.kind === "retry" && latest.state === "retrying") return latest.summary;
  const lastAction = [...items].reverse().find((item) =>
    item.kind === "tool" || item.kind === "activity" || item.kind === "plan" || item.kind === "compact",
  );
  const pending = [...items].reverse().find((item) =>
    (item.kind === "tool" && item.status === "running")
    || (item.kind === "activity" && (
      item.status === "running" || item.tools.some((tool) => tool.status === "running")
    ))
    || (item.kind === "plan" && item.todos.some((todo) => todo.status === "active")),
  );
  if (outcome === "interrupted" && pending) {
    if (pending.kind === "tool") return `${toolAction(pending.name)}已停止`;
    if (pending.kind === "activity") return "助手已停止";
    return "计划更新已停止";
  }
  if (outcome === "error" && pending) {
    if (pending.kind === "tool") return `${toolAction(pending.name)}未完成`;
    if (pending.kind === "activity") return "助手未完成";
    return "计划更新未完成";
  }
  const failed = [...items].reverse().find((item) =>
    (item.kind === "tool" && item.status === "error")
    || (item.kind === "activity" && (
      item.status === "error" || item.tools.some((tool) => tool.status === "error")
    )),
  );
  if (failed?.kind === "tool") return `${toolAction(failed.name)}未完成`;
  if (failed?.kind === "activity") return "助手未完成";
  // With no concrete action status to preserve, the terminal event is the only
  // trustworthy description of what happened to the process block.
  if (!lastAction && outcome === "interrupted") return "处理过程已停止";
  if (!lastAction && outcome === "error") return "处理过程未完成";
  if (stale) return "上次停在这里";

  if (activeTurn) {
    const activeItem = [...items].reverse().find((item) =>
      (item.kind === "tool" && item.status === "running")
      || (item.kind === "activity" && (
        item.status === "running" || item.tools.some((tool) => tool.status === "running")
      ))
      || (item.kind === "plan" && item.todos.some((todo) => todo.status === "active"))
      || (item.kind === "thinking" && item.streaming),
    );
    if (activeItem?.kind === "tool") return `正在${toolAction(activeItem.name)}`;
    if (activeItem?.kind === "activity") return "助手正在处理";
    if (activeItem?.kind === "plan") return "正在更新计划";
    if (activeItem?.kind === "thinking") return "正在思考";
    return "正在继续处理";
  }

  if (lastAction?.kind === "tool") {
    const verifiedFileMutation = /read|notebook/i.test(lastAction.name)
      && items.some((item) => item.kind === "tool"
        && item.status === "ok"
        && /write|edit/i.test(item.name));
    if (verifiedFileMutation) return "处理文件已完成";
    return `${toolAction(lastAction.name)}已完成`;
  }
  if (lastAction?.kind === "activity") return "助手已完成";
  if (lastAction?.kind === "plan") return "计划已更新";
  if (lastAction?.kind === "compact") return "上下文已整理";
  return "处理过程已完成";
}

export default function ProcessFold({
  items,
  defaultCollapsed,
  runId,
  density = "workbench",
  active = true,
  archivedContent,
  archivedCount = 0,
  hidePlanDetails = false,
  summaryOverride,
  showAvatar = true,
  outcome,
  stale: staleOverride,
}: {
  items: TimelineItem[];
  defaultCollapsed: boolean;
  runId: string;
  density?: ProcessDensity;
  active?: boolean;
  archivedContent?: ReactNode;
  archivedCount?: number;
  /** A live approval already explains the current step. Keep plan progress in
   * the header without repeating a visually dominant four-row plan above it. */
  hidePlanDetails?: boolean;
  summaryOverride?: string;
  showAvatar?: boolean;
  /** Trust the turn terminal event over a tool card's last local status. */
  outcome?: ProcessOutcome;
  /** Explicit false lets a terminal result win even if a tool-finished event
   * was lost. Direct card fixtures can omit it and infer stale running work. */
  stale?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [prevDefault, setPrevDefault] = useState(defaultCollapsed);
  if (defaultCollapsed !== prevDefault) {
    setPrevDefault(defaultCollapsed);
    setCollapsed(defaultCollapsed);
  }
  const totalSteps = items.length + archivedCount;
  if (totalSteps === 0) return null;
  const buddy = density === "buddy";
  const stale = staleOverride ?? (!active && hasStaleWork(items));
  const summary = summaryOverride ?? (buddy
    ? buddySummary(items, active, stale, outcome)
    : workbenchSummary(items, active, stale, outcome));
  const plans = items.filter((item) => item.kind === "plan");
  const retries = items.filter((item) => item.kind === "retry");
  const tools = items.filter((item) => item.kind === "tool");
  const activities = items.filter((item) => item.kind === "activity");
  const otherItems = items.filter((item) => item.kind === "compact");
  const latestPlan = plans.at(-1);
  const planDone = latestPlan?.todos.filter((todo) => todo.status === "done").length ?? 0;
  const planTotal = latestPlan?.todos.length ?? 0;
  const planHasUnfinished = latestPlan?.todos.some((todo) => todo.status !== "done") ?? false;
  // A successful terminal result is the source of truth for the turn. Keep the
  // model's original plan visible when expanded, but do not advertise a stale
  // partial fraction beside a completed delivery.
  const showPlanProgress = planTotal > 0 && !(outcome === "success" && planHasUnfinished);
  return (
    <div
      data-testid="process-fold"
      data-component-role={buddy ? "buddy-process" : "run-plan"}
      data-surface-level={buddy || !active ? "default" : "sunken"}
      data-active={active ? "true" : "false"}
      data-state={active ? "active" : "terminal"}
      data-expanded={collapsed ? "false" : "true"}
      data-turn-identity-anchor={showAvatar ? "true" : "false"}
      className={buddy
        ? "my-1 overflow-hidden rounded-[8px]"
        : "leemo-process-fold my-1 overflow-hidden rounded-[10px] border"}
    >
      <button
        data-testid="process-fold-toggle"
        type="button"
        aria-label={buddy ? undefined : `momo 的干活过程：${summary}，${totalSteps} 步`}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
        className={buddy
          ? "flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-[12px] text-[var(--leemo-ink-3)] transition-colors hover:text-[var(--leemo-ink-2)]"
          : "leemo-process-fold__toggle flex h-9 w-full items-center gap-2 px-2 text-left transition-colors"}
      >
        {buddy ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--leemo-amber)]" aria-hidden />
            <span className="min-w-0 truncate">{summary}</span>
          </>
        ) : (
          <>
            {showAvatar ? <MomoAvatar size={22} state={active ? "thinking" : "calm"} /> : null}
            <span className="min-w-0 truncate text-[12px] font-medium text-[var(--leemo-ink-2)]">{summary}</span>
            {showPlanProgress ? (
              <>
                <span data-testid="process-fold-progress" className="shrink-0 text-[11px] tabular-nums text-[var(--leemo-ink-3)]">
                  {planDone} / {planTotal}
                </span>
                <span className="relative h-1 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--leemo-line-2)]" aria-hidden>
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-[var(--leemo-amber)] transition-[width]"
                    style={{ width: `${Math.round((planDone / planTotal) * 100)}%` }}
                  />
                </span>
              </>
            ) : (
              <span className="text-[11px] text-[var(--leemo-ink-3)]">{totalSteps} 步</span>
            )}
            {archivedCount > 0 && (
              <span className="text-[11px] text-[var(--leemo-ink-3)]">含 {archivedCount} 条确认记录</span>
            )}
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11.5px] text-[var(--leemo-ink-3)]">
          {!buddy && (collapsed ? "展开" : "收起")}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
            className={`h-[13px] w-[13px] transition-transform ${collapsed ? "" : "rotate-180"}`} aria-hidden>
            <path d="m6 9.2 6 6 6-6" />
          </svg>
        </span>
      </button>
      {!collapsed && (
        <div data-testid="process-fold-details" className="leemo-process-fold__details max-h-[220px] space-y-1.5 overflow-y-auto border-t px-2.5 py-2.5">
          {!hidePlanDetails && plans.map((item) => renderProcess(item, runId, density, stale))}
          {retries.map((item) => renderProcess(item, runId, density, stale))}
          {tools.length > 0 && (
            <section className="space-y-1.5" aria-label={`工具与命令，${tools.length} 次`}>
              <h4 className="pt-1 text-[11px] font-medium text-[var(--leemo-ink-3)]">工具与命令 · {tools.length} 次</h4>
              {tools.map((item) => renderProcess(item, runId, density, stale))}
            </section>
          )}
          {activities.length > 0 && (
            <section className="space-y-1.5" aria-label={`助手协作，${activities.length}`}>
              <h4 className="pt-1 text-[11px] font-medium text-[var(--leemo-ink-3)]">助手协作 · {activities.length}</h4>
              {activities.map((item, siblingIndex) => renderProcess(item, runId, density, stale, siblingIndex))}
            </section>
          )}
          {otherItems.map((item) => renderProcess(item, runId, density, stale))}
          {archivedContent}
        </div>
      )}
    </div>
  );
}
