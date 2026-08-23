import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TimelineItem } from "../../stores/message-model";
import MarkdownContent from "../MarkdownContent";
import BrowserCapturePreview from "./BrowserCapturePreview";
import { toolActionLabel, toolOutcomeLabel, toolResultLabel } from "../tool-labels";
import SubagentAvatar from "./SubagentAvatar";

export default function ActivityCard({
  item,
  stale = false,
  siblingIndex,
}: {
  item: Extract<TimelineItem, { kind: "activity" }>;
  stale?: boolean;
  siblingIndex?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const resultEntries = item.transcript.filter((entry) => entry.kind === "text");
  const inferredStatus = item.status
    ?? (item.tools.some((tool) => tool.status === "error")
      ? "error"
      : item.tools.some((tool) => tool.status === "running")
        ? "running"
        : item.tools.length > 0 || resultEntries.length > 0
          ? "ok"
          : "running");
  const paused = stale && inferredStatus === "running";
  const elapsedSeconds = item.startedAt !== undefined && item.updatedAt !== undefined
    ? Math.max(0, Math.round((item.updatedAt - item.startedAt) / 1_000))
    : 0;
  const statusLabel = paused
    ? "上次停在这里"
    : inferredStatus === "ok"
      ? "已完成"
      : inferredStatus === "error"
        ? "未完成"
        : "进行中";
  return (
    <div className="leemo-activity-card overflow-hidden rounded-[8px] border">
      <button
        type="button"
        aria-label={expanded ? "收起助手详情" : "展开助手详情"}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="leemo-activity-card__toggle flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <SubagentAvatar identity={item.role ?? "任务助手"} siblingIndex={siblingIndex} />
        <span className="shrink-0 text-[12.5px] font-medium text-[var(--leemo-ink-2)]">
          {item.role ?? "任务助手"}
        </span>
        {item.task && (
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--leemo-ink-3)]" title={item.task}>
            {item.task}
          </span>
        )}
        <span className={`${item.task ? "" : "ml-auto"} shrink-0 text-[11px] text-[var(--leemo-ink-3)]`}>
          {statusLabel}
          {elapsedSeconds > 0 ? ` · ${elapsedSeconds} 秒` : ""}
          {item.childToolUseIds.length > 0 ? ` · ${item.childToolUseIds.length} 个步骤` : ""}
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)] transition-transform ${expanded ? "rotate-90" : ""}`}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="leemo-activity-card__details space-y-2 border-t px-3 py-2.5" data-testid="subagent-details">
          {resultEntries.map((entry, index) => (
            <div key={`text-${index}`} className="text-[var(--leemo-ink-2)]">
              <MarkdownContent text={entry.text} variant="process" />
            </div>
          ))}
          {item.tools.length > 0 && (
            <div className="space-y-1 border-t border-[var(--leemo-line-soft)] pt-2">
              {item.tools.map((tool) => (
                <div key={tool.toolUseId} className="text-[11.5px]">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      tool.status === "error" && !["denied", "cancelled", "interrupted"].includes(tool.outcome ?? "")
                        ? "bg-[var(--leemo-danger)]"
                        : tool.status === "ok"
                          ? "bg-[var(--leemo-ok)]"
                          : paused
                            ? "bg-[var(--leemo-ink-3)]"
                            : "bg-[var(--leemo-amber)]"
                    }`} aria-hidden />
                    <span className="shrink-0 whitespace-nowrap font-medium text-[var(--leemo-ink-2)]">{toolActionLabel(tool.name)}</span>
                    {(tool.summary || tool.name.startsWith("mcp__playwright__") || (paused && tool.status === "running")) && (
                      <span className="min-w-0 flex-1 truncate text-[var(--leemo-ink-3)]">
                        {paused && tool.status === "running"
                          ? "上次停在这里"
                          : toolOutcomeLabel(tool.outcome, toolResultLabel(tool.name, tool.status, tool.summary))}
                      </span>
                    )}
                  </div>
                  {tool.browserCapture ? <BrowserCapturePreview capture={tool.browserCapture} /> : null}
                </div>
              ))}
            </div>
          )}
          {item.transcript.length === 0 && item.tools.length === 0 && (
            <p className="text-[11.5px] text-[var(--leemo-ink-3)]">
              {stale ? "助手上次停在这里" : "助手正在准备"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
