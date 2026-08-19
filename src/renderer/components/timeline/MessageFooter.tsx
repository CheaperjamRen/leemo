import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Copy, FileDiff, FileText, FolderOpen, TriangleAlert } from "lucide-react";
import type { TimelineItem } from "../../stores/message-model";
import AnchoredLayer from "../AnchoredLayer";

type ResultItem = Extract<TimelineItem, { kind: "result" }>;
type UsageItem = Extract<TimelineItem, { kind: "usage" }>;
type MemoryItem = Extract<TimelineItem, { kind: "memory" }>;
type FilesItem = Extract<TimelineItem, { kind: "files" }>;
type FileChangeItem = FilesItem["changes"][number];
export type MemoryUndoState = "idle" | "pending" | "error" | "undone";

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatTime(createdAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(createdAt));
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))} 毫秒`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function normalizeReceiptLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateReceiptLabel(value: string, maxLength = 48): string {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : `${chars.slice(0, maxLength - 1).join("")}…`;
}

function memoryPrefix(action: MemoryItem["action"]): string {
  if (action === "removed") return "已忘掉：";
  if (action === "candidate") return "记下待确认：";
  return "记住了：";
}

const fileChangeLabel: Record<FilesItem["changes"][number]["change"], string> = {
  added: "新建",
  modified: "修改",
  deleted: "删除",
};

export default function MessageFooter({
  result,
  usage,
  files,
  memory,
  memoryUndoState = "idle",
  memoryUndoError,
  hideErrorLead = false,
  onOpenFile,
  onRevealFile,
  onUndoMemory,
}: {
  result: ResultItem;
  usage?: UsageItem;
  files?: FilesItem;
  memory?: MemoryItem;
  memoryUndoState?: MemoryUndoState;
  memoryUndoError?: string;
  hideErrorLead?: boolean;
  onOpenFile?: (change: FileChangeItem) => void;
  onRevealFile?: (change: FileChangeItem) => void;
  onUndoMemory?: (memory: MemoryItem) => void;
}) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageHovered, setUsageHovered] = useState(false);
  const [fileChangesOpen, setFileChangesOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const usageAnchorRef = useRef<HTMLButtonElement>(null);
  const usageCloseTimerRef = useRef<number | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const usageVisible = usageOpen || usageHovered;

  const cancelUsageClose = (): void => {
    if (usageCloseTimerRef.current === null) return;
    window.clearTimeout(usageCloseTimerRef.current);
    usageCloseTimerRef.current = null;
  };
  const scheduleUsageClose = (): void => {
    cancelUsageClose();
    usageCloseTimerRef.current = window.setTimeout(() => {
      setUsageHovered(false);
      usageCloseTimerRef.current = null;
    }, 90);
  };
  useEffect(() => () => {
    cancelUsageClose();
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);
  const copyAnswer = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持复制");
      await navigator.clipboard.writeText(result.finalText);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimerRef.current = null;
    }, 1_800);
  };
  // `writeClaim` was added when the auditor stopped treating every path mention
  // as a completed write. Requiring the marker also suppresses stale false
  // alarms already persisted by older builds without rewriting user history.
  const escaped = result.pathAudit.claimed.filter((c) => c.writeClaim === true && !c.withinCwd);
  // Findings #2/#3: an interrupted or errored run has no trustworthy final text —
  // show a status affordance instead of a copy button that would copy "".
  const lead = result.isError ? (
    hideErrorLead ? null : (
      <span className="inline-flex items-center gap-1 text-[var(--leemo-danger)]">
        <TriangleAlert className="h-3 w-3" aria-hidden />
        这条没跑完
      </span>
    )
  ) : result.interrupted ? (
    <span>已停止</span>
  ) : (
    <button
      type="button"
      aria-label={copyState === "copied" ? "已复制回答" : copyState === "error" ? "复制回答失败" : "复制回答"}
      aria-live="polite"
      className={`inline-flex items-center gap-1 rounded-[5px] px-0.5 transition-colors ${copyState === "copied" ? "text-[var(--leemo-success)]" : copyState === "error" ? "text-[var(--leemo-danger)]" : "hover:text-[var(--leemo-ink-2)]"}`}
      onClick={() => void copyAnswer()}
    >
      {copyState === "copied" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {copyState === "copied" ? "已复制" : copyState === "error" ? "复制失败" : "复制"}
    </button>
  );
  const cacheTokens = usage ? usage.usage.cacheReadTokens + usage.usage.cacheCreationTokens : 0;
  const modelBreakdown = usage?.usage.modelBreakdown ?? [];
  const singleModelUsage = modelBreakdown.length === 1 ? modelBreakdown[0] : undefined;
  const fullMemoryLabel = memory ? normalizeReceiptLabel(memory.label) : "";
  const visibleMemoryLabel = truncateReceiptLabel(fullMemoryLabel);
  const memoryUndone = memory?.undone === true || memoryUndoState === "undone";
  const deliveryFiles = files?.changes.slice(0, 3) ?? [];
  const primaryDelivery = deliveryFiles[0];
  const deliveryTotal = files ? files.changes.length + files.omitted : 0;
  const hiddenDeliveryCount = Math.max(0, deliveryTotal - deliveryFiles.length);
  const collapsedDeliveryCount = Math.max(0, deliveryTotal - (primaryDelivery ? 1 : 0));
  const deliveryVerb = files?.changes.some((change) => change.change !== "deleted") ? "交付" : "处理";
  const visibleChangeSummary = files?.changes.every((change) => change.change === "modified")
    ? `修改了 ${deliveryTotal} 个文件`
    : files?.changes.every((change) => change.change === "added")
      ? `新建了 ${deliveryTotal} 个文件`
      : files?.changes.every((change) => change.change === "deleted")
        ? `删除了 ${deliveryTotal} 个文件`
        : `查看 ${deliveryTotal} 处文件变化`;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--leemo-ink-3)]">
      {lead}
      {result.createdAt !== undefined && (
        <time dateTime={new Date(result.createdAt).toISOString()} className="tabular-nums">
          {formatTime(result.createdAt)}
        </time>
      )}
      {usage?.usage.durationMs !== undefined && <span className="tabular-nums">{formatDuration(usage.usage.durationMs)}</span>}
      {usage && (
        <button
          ref={usageAnchorRef}
          type="button"
          aria-label={usageOpen ? "收起用量" : "查看用量"}
          aria-expanded={usageVisible}
          onClick={() => setUsageOpen((open) => !open)}
          onMouseEnter={() => {
            cancelUsageClose();
            setUsageHovered(true);
          }}
          onMouseLeave={scheduleUsageClose}
          onFocus={() => setUsageHovered(true)}
          onBlur={scheduleUsageClose}
          className="rounded-sm underline decoration-[var(--leemo-line)] underline-offset-2 transition-colors hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
        >
          {usageOpen ? "收起用量" : "查看用量"}
        </button>
      )}
      {files && files.changes.length > 0 && (
        <section
          data-file-delivery-receipt
          aria-label={`本轮${deliveryVerb}文件`}
          className="mt-1.5 basis-full overflow-hidden rounded-[8px] border border-[var(--leemo-line-soft)] bg-[var(--leemo-panel)]/42 text-[var(--leemo-ink)] shadow-none"
        >
          <div className="flex min-h-12 min-w-0 items-center gap-2 px-3 py-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-success)]" aria-hidden />
            <span className="shrink-0 text-[11px] font-medium text-[var(--leemo-ink-3)]">本轮{deliveryVerb} {deliveryTotal} 个文件</span>
            <span className="h-3 w-px shrink-0 bg-[var(--leemo-line-2)]" aria-hidden />
            {primaryDelivery && (
              <>
                <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                <span className="shrink-0 text-[10.5px] text-[var(--leemo-ink-3)]">{fileChangeLabel[primaryDelivery.change]}</span>
                {onOpenFile && primaryDelivery.change !== "deleted" ? (
                  <button
                    type="button"
                    aria-label={`预览 ${primaryDelivery.path}`}
                    title={primaryDelivery.path}
                    onClick={() => onOpenFile(primaryDelivery)}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-[var(--leemo-ink-2)] transition-colors hover:text-[var(--leemo-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
                  >
                    {primaryDelivery.path}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--leemo-ink-2)]" title={primaryDelivery.path}>{primaryDelivery.path}</span>
                )}
              </>
            )}
            {collapsedDeliveryCount > 0 && <span className="shrink-0 text-[10.5px] text-[var(--leemo-ink-3)]">另 {collapsedDeliveryCount} 个</span>}
            {primaryDelivery && onRevealFile && primaryDelivery.change !== "deleted" && (
              <button
                type="button"
                aria-label={`在文件夹中显示 ${primaryDelivery.path}`}
                title="在文件夹中显示"
                onClick={() => onRevealFile(primaryDelivery)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {deliveryTotal > 1 && (
              <button
                type="button"
                aria-label="查看文件变化"
                aria-expanded={fileChangesOpen}
                data-file-change-receipt
                title={visibleChangeSummary}
                onClick={() => setFileChangesOpen((open) => !open)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
              >
                <FileDiff className="sr-only" aria-hidden />
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)] transition-transform ${fileChangesOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            )}
          </div>
          {fileChangesOpen && (
            <div
              data-file-change-card
              className="max-h-[132px] overflow-y-auto border-t border-[var(--leemo-line-2)] bg-[var(--leemo-card)]/70 px-3 py-1.5"
            >
              {deliveryFiles.slice(1).map((change) => (
                <div key={`${change.path}-${change.change}`} data-delivery-file-row className="flex h-8 min-w-0 items-center gap-2 text-[11.5px]">
                  <span className="w-7 shrink-0 text-[var(--leemo-ink-3)]">{fileChangeLabel[change.change]}</span>
                  {onOpenFile && change.change !== "deleted" ? <button type="button" aria-label={`预览 ${change.path}`} title={change.path} onClick={() => onOpenFile(change)} className="min-w-0 flex-1 truncate text-left text-[var(--leemo-ink-2)] hover:text-[var(--leemo-ink)]">{change.path}</button> : <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink-2)]" title={change.path}>{change.path}</span>}
                  {onRevealFile && change.change !== "deleted" && <button type="button" aria-label={`在文件夹中显示 ${change.path}`} title="在文件夹中显示" onClick={() => onRevealFile(change)} className="grid h-6 w-6 shrink-0 place-items-center text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"><FolderOpen className="h-3.5 w-3.5" aria-hidden /></button>}
                </div>
              ))}
              {hiddenDeliveryCount > 0 && (
                <div className="flex h-7 items-center text-[11.5px] text-[var(--leemo-ink-3)]">另有 {hiddenDeliveryCount} 个文件，可在成果页查看</div>
              )}
            </div>
          )}
        </section>
      )}
      {memory && fullMemoryLabel && (
        <span
          data-memory-receipt
          className="inline-flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap"
        >
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={fullMemoryLabel}>
            {memoryPrefix(memory.action)}{visibleMemoryLabel}
          </span>
          <span aria-hidden>·</span>
          {memoryUndone ? (
            <span>已撤销</span>
          ) : memoryUndoState === "pending" ? (
            <button
              type="button"
              disabled
              aria-label="正在撤销这条记忆"
              className="cursor-wait opacity-70"
            >
              撤销中
            </button>
          ) : memoryUndoState === "error" ? (
            <>
              <span title={memoryUndoError}>撤销失败</span>
              {onUndoMemory && (
                <button
                  type="button"
                  aria-label="重试撤销这条记忆"
                  title={memoryUndoError}
                  onClick={() => onUndoMemory(memory)}
                  className="rounded-sm underline decoration-[var(--leemo-line)] underline-offset-2 transition-colors hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
                >
                  重试
                </button>
              )}
            </>
          ) : onUndoMemory ? (
            <button
              type="button"
              aria-label="撤销这条记忆"
              onClick={() => onUndoMemory(memory)}
              className="rounded-sm underline decoration-[var(--leemo-line)] underline-offset-2 transition-colors hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
            >
              撤销
            </button>
          ) : null}
        </span>
      )}
      {escaped.length > 0 && (
        <span className="inline-flex basis-full items-start gap-1 text-[var(--leemo-amber-ink)]">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>声称写到当前本子外：{escaped.map((c) => c.path).join("、")}</span>
        </span>
      )}
      {usage && (
        <AnchoredLayer
          open={usageVisible}
          anchor={usageAnchorRef}
          preferred="top-start"
          ariaLabel="用量详情"
          onDismiss={() => {
            setUsageOpen(false);
            setUsageHovered(false);
          }}
          className="w-max max-w-[min(520px,calc(100vw-16px))] rounded-[8px] border border-[var(--leemo-line-2)] bg-[var(--leemo-card)] px-3 py-2 text-[10.5px] leading-5 text-[var(--leemo-ink-3)] shadow-[0_14px_34px_-18px_rgba(15,23,42,0.38)]"
        >
        <div onMouseEnter={cancelUsageClose} onMouseLeave={scheduleUsageClose}>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums">
            <span>{usage.usage.providerId} / {usage.usage.modelId}</span>
            {singleModelUsage?.servingProvider && <span>{singleModelUsage.servingProvider}</span>}
            <span>输入 {fmt(usage.usage.inputTokens)}</span>
            <span>输出 {fmt(usage.usage.outputTokens)}</span>
            <span>缓存 {fmt(cacheTokens)}</span>
            <span>{usage.usage.costUsd === undefined ? "未估价" : `US$${usage.usage.costUsd}`}</span>
            {usage.usage.tokensEstimated && <span>Token 为估算</span>}
          </div>
          {modelBreakdown.length > 1 && (
            <div className="mt-1.5 border-t border-[var(--leemo-line-2)] pt-1.5">
              {modelBreakdown.map((model) => (
                <div
                  key={`${model.providerId}:${model.modelId}:${model.servingProvider ?? ""}`}
                  className="flex flex-wrap gap-x-2 font-mono tabular-nums"
                >
                  <span>{model.modelId}</span>
                  {model.servingProvider && <span>{model.servingProvider}</span>}
                  <span>输入 {fmt(model.inputTokens)}</span>
                  <span>输出 {fmt(model.outputTokens)}</span>
                  <span>US${model.costUsd}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        </AnchoredLayer>
      )}
    </div>
  );
}
