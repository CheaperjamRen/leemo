import { useState } from "react";
import { ChevronDown, Copy, Files, FolderOpen, TriangleAlert } from "lucide-react";
import type { TimelineItem } from "../../stores/message-model";

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
  const [filesOpen, setFilesOpen] = useState(false);
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
    <button type="button" className="inline-flex items-center gap-1 transition-colors hover:text-[var(--leemo-ink-2)]"
      onClick={() => void navigator.clipboard?.writeText(result.finalText)}>
      <Copy className="h-3 w-3" aria-hidden />
      复制
    </button>
  );
  const cacheTokens = usage ? usage.usage.cacheReadTokens + usage.usage.cacheCreationTokens : 0;
  const fullMemoryLabel = memory ? normalizeReceiptLabel(memory.label) : "";
  const visibleMemoryLabel = truncateReceiptLabel(fullMemoryLabel);
  const memoryUndone = memory?.undone === true || memoryUndoState === "undone";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--leemo-ink-3)]">
      {lead}
      {result.createdAt !== undefined && (
        <time dateTime={new Date(result.createdAt).toISOString()} className="tabular-nums">
          {formatTime(result.createdAt)}
        </time>
      )}
      {usage?.usage.durationMs !== undefined && <span className="tabular-nums">{formatDuration(usage.usage.durationMs)}</span>}
      {usage && (
        <button
          type="button"
          aria-label={usageOpen ? "收起用量" : "查看用量"}
          aria-expanded={usageOpen}
          onClick={() => setUsageOpen((open) => !open)}
          className="rounded-sm underline decoration-[var(--leemo-line)] underline-offset-2 transition-colors hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
        >
          {usageOpen ? "收起用量" : "查看用量"}
        </button>
      )}
      {files && files.changes.length > 0 && (
        <>
          <button
            type="button"
            data-file-change-receipt
            aria-label={filesOpen ? "收起文件变化" : "查看文件变化"}
            aria-expanded={filesOpen}
            onClick={() => setFilesOpen((open) => !open)}
            className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
          >
            <Files className="h-3 w-3" aria-hidden />
            修改了 {files.changes.length + files.omitted} 个文件
            <ChevronDown className={`h-3 w-3 transition-transform ${filesOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {filesOpen && (
            <ul className="basis-full space-y-1 pl-4 text-[10.5px] leading-4">
              {files.changes.map((change) => (
                <li key={change.path} className="flex min-w-0 items-center gap-2">
                  <span className="w-7 shrink-0 text-[var(--leemo-ink-3)]">{fileChangeLabel[change.change]}</span>
                  {onOpenFile && change.change !== "deleted" ? (
                    <button
                      type="button"
                      aria-label={`预览 ${change.path}`}
                      title={change.path}
                      onClick={() => onOpenFile(change)}
                      className="min-w-0 break-all text-left text-[var(--leemo-ink-2)] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-[var(--leemo-line)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
                    >
                      {change.path}
                    </button>
                  ) : (
                    <span className="min-w-0 break-all text-[var(--leemo-ink-2)]" title={change.path}>{change.path}</span>
                  )}
                  {onRevealFile && change.change !== "deleted" && (
                    <button
                      type="button"
                      aria-label={`在文件夹中显示 ${change.path}`}
                      title="在文件夹中显示"
                      onClick={() => onRevealFile(change)}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-sm transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)]"
                    >
                      <FolderOpen className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
              {files.omitted > 0 && (
                <li className="text-[var(--leemo-ink-3)]">另有 {files.omitted} 个文件未展开</li>
              )}
            </ul>
          )}
        </>
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
      {usage && usageOpen && (
        <div className="basis-full rounded-[6px] border border-[var(--leemo-line-2)] bg-[var(--leemo-panel)]/60 px-2.5 py-2 text-[10.5px] leading-5">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums">
            <span>{usage.usage.providerId} / {usage.usage.modelId}</span>
            <span>输入 {fmt(usage.usage.inputTokens)}</span>
            <span>输出 {fmt(usage.usage.outputTokens)}</span>
            <span>缓存 {fmt(cacheTokens)}</span>
            <span>{usage.usage.costUsd === undefined ? "未估价" : `US$${usage.usage.costUsd}`}</span>
            {usage.usage.tokensEstimated && <span>Token 为估算</span>}
          </div>
        </div>
      )}
    </div>
  );
}
