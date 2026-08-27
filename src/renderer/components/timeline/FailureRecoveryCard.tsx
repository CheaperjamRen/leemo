import { useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleX,
  Code2,
  Ellipsis,
  LockKeyhole,
} from "lucide-react";
import type { TimelineItem } from "../../stores/message-model";
import "./FailureRecoveryCard.css";
import { useDismissiblePopover } from "../useDismissiblePopover";

export interface FailureRecoveryModel {
  badge: string;
  title: string;
  description: string;
  completed: string[];
  unfinished: string[];
  rawDetails: string[];
  pasteLabel: string;
}

function uniqueFacts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const facts: string[] = [];
  for (const value of values) {
    const fact = value?.trim();
    if (!fact || seen.has(fact)) continue;
    seen.add(fact);
    facts.push(fact);
  }
  return facts;
}

function latestUserText(items: TimelineItem[]): string {
  return [...items].reverse().find(
    (item): item is Extract<TimelineItem, { kind: "text" }> =>
      item.kind === "text" && item.role === "user",
  )?.text ?? "";
}

export function buildFailureRecoveryModel(items: TimelineItem[]): FailureRecoveryModel {
  const latestPlan = [...items].reverse().find(
    (item): item is Extract<TimelineItem, { kind: "plan" }> => item.kind === "plan",
  );
  const failedTools = items.filter(
    (item): item is Extract<TimelineItem, { kind: "tool" }> =>
      item.kind === "tool" && item.status === "error",
  );
  const completedTools = items.filter(
    (item): item is Extract<TimelineItem, { kind: "tool" }> =>
      item.kind === "tool" && item.status === "ok" && Boolean(item.summary?.trim()),
  );
  const failedTool = failedTools.at(-1);
  const rawErrors = items.filter(
    (item): item is Extract<TimelineItem, { kind: "error" }> => item.kind === "error",
  );
  const retryFailures = items.filter(
    (item): item is Extract<TimelineItem, { kind: "retry" }> =>
      item.kind === "retry" && item.state === "failed",
  );
  const isWebFailure = failedTools.some((item) =>
    /(?:web|browser|fetch|http|url)/i.test(item.name),
  );
  const title = failedTool?.summary?.trim()
    || rawErrors.at(-1)?.message.trim()
    || retryFailures.at(-1)?.summary.trim()
    || "这次任务没有完成";

  const completed = uniqueFacts([
    ...(latestPlan?.todos.filter((todo) => todo.status === "done").map((todo) => todo.text) ?? []),
    ...completedTools.map((tool) => tool.summary),
  ]);
  const unfinished = uniqueFacts([
    ...(latestPlan?.todos.filter((todo) => todo.status === "active" || todo.status === "todo").map((todo) => todo.text) ?? []),
    ...failedTools.map((tool) => tool.summary).filter((summary) => summary?.trim() !== title),
  ]);
  const rawDetails = uniqueFacts([
    ...rawErrors.map((error) => error.message),
    ...retryFailures.map((retry) => retry.detail || retry.summary),
  ]);
  const userText = latestUserText(items);

  return {
    badge: isWebFailure ? "网页读取失败" : "任务未完成",
    title,
    description: isWebFailure
      ? "页面可能需要登录，或暂时拒绝访问。已经完成的内容都保留着。"
      : "已经完成的内容都保留着，可以从这里继续。",
    completed,
    unfinished,
    rawDetails,
    pasteLabel: /(?:JD|岗位|职位|招聘)/i.test(userText) ? "粘贴 JD 继续" : "粘贴资料继续",
  };
}

function FactRow({
  kind,
  facts,
}: {
  kind: "completed" | "unfinished";
  facts: string[];
}) {
  const completed = kind === "completed";
  return (
    <div
      className={`failure-recovery__fact failure-recovery__fact--${kind}`}
      data-testid={`failure-${kind}-row`}
    >
      <span className="failure-recovery__fact-icon" aria-hidden>
        {completed ? <Check /> : <CircleX />}
      </span>
      <span className="failure-recovery__fact-label">{completed ? "已完成" : "未完成"}</span>
      <span className="failure-recovery__fact-text" title={facts.join(" · ")}>{facts.join(" · ")}</span>
    </div>
  );
}

export default function FailureRecoveryCard({
  items,
  retryError,
  onRetry,
  onPaste,
  onDismiss,
}: {
  items: TimelineItem[];
  retryError?: string;
  onRetry?: () => Promise<void>;
  onPaste: () => Promise<void>;
  onDismiss?: () => void;
}) {
  const model = useMemo(() => buildFailureRecoveryModel(items), [items]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreLayerRef = useRef<HTMLDivElement>(null);
  const [busyAction, setBusyAction] = useState<"retry" | "paste" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const rawDetails = useMemo(
    () => uniqueFacts([...model.rawDetails, retryError]),
    [model.rawDetails, retryError],
  );

  useDismissiblePopover({
    open: moreOpen,
    triggerRef: moreTriggerRef,
    layerRef: moreLayerRef,
    onDismiss: () => setMoreOpen(false),
  });

  const runAction = async (action: "retry" | "paste", callback: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(action);
    setActionError(null);
    try {
      await callback();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "暂时无法继续，请稍后再试。");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="failure-recovery" data-testid="buddy-failure-recovery" aria-label="任务恢复">
      <div className="failure-recovery__badge">{model.badge}</div>
      <h3>{model.title}</h3>
      <p className="failure-recovery__description">{model.description}</p>

      {(model.completed.length > 0 || model.unfinished.length > 0) && (
        <div className="failure-recovery__facts">
          {model.completed.length > 0 && <FactRow kind="completed" facts={model.completed} />}
          {model.unfinished.length > 0 && <FactRow kind="unfinished" facts={model.unfinished} />}
        </div>
      )}

      <p className="failure-recovery__retained">
        <LockKeyhole aria-hidden />
        不会丢失当前进度。
      </p>

      {rawDetails.length > 0 && (
        <div className="failure-recovery__details">
          <button
            type="button"
            className="failure-recovery__details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <Code2 aria-hidden />
            <span>查看错误详情</span>
            <ChevronRight className={detailsOpen ? "is-open" : ""} aria-hidden />
          </button>
          {detailsOpen && (
            <pre className="failure-recovery__raw">{rawDetails.join("\n\n")}</pre>
          )}
        </div>
      )}

      {actionError && <p className="failure-recovery__action-error" role="alert">{actionError}</p>}
      <div className="failure-recovery__actions">
        {onRetry && (
          <button
            type="button"
            className="failure-recovery__button failure-recovery__button--primary"
            disabled={busyAction !== null}
            onClick={() => { void runAction("retry", onRetry); }}
          >
            {busyAction === "retry" ? "重试中…" : "重试"}
          </button>
        )}
        <button
          type="button"
          className="failure-recovery__button"
          disabled={busyAction !== null}
          onClick={() => { void runAction("paste", onPaste); }}
        >
          {busyAction === "paste" ? "读取中…" : model.pasteLabel}
        </button>
        {onDismiss && (
          <div className="failure-recovery__more-wrap">
            <button
              ref={moreTriggerRef}
              type="button"
              className="failure-recovery__button failure-recovery__button--icon"
              aria-label="更多恢复操作"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <Ellipsis aria-hidden />
            </button>
            {moreOpen && (
              <div ref={moreLayerRef} className="failure-recovery__menu">
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onDismiss();
                  }}
                >
                  不再显示恢复入口
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
