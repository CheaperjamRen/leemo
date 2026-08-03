import { useState } from "react";
import type { TimelineItem } from "../../stores/message-model";
import MarkdownContent from "../MarkdownContent";
import BrowserCapturePreview from "./BrowserCapturePreview";
import { toolActionLabel, toolResultLabel } from "../tool-labels";

export default function ActivityCard({
  item,
  stale = false,
}: {
  item: Extract<TimelineItem, { kind: "activity" }>;
  stale?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const paused = stale && item.tools.some((tool) => tool.status === "running");
  return (
    <div className="overflow-hidden rounded-[8px] border border-dashed border-[var(--leemo-line)] bg-[var(--leemo-panel)]">
      <button
        type="button"
        aria-label={expanded ? "收起分身详情" : "展开分身详情"}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-[7px] text-left hover:bg-[var(--leemo-side-hover)]"
      >
        <svg viewBox="0 0 24 24" className="h-[12px] w-[12px] shrink-0 text-[var(--leemo-amber)]" aria-hidden>
          <path d="M12 2c.6 5.5 4.5 9.4 10 10-5.5.6-9.4 4.5-10 10-.6-5.5-4.5-9.4-10-10C7.5 11.4 11.4 7.5 12 2Z" fill="currentColor" />
        </svg>
        <span className="text-[12.5px] font-medium text-[var(--leemo-ink-2)]">
          {paused ? "分身上次停在这里" : "分身干活"}
        </span>
        <span className="ml-auto text-[11px] text-[var(--leemo-ink-3)]">{item.childToolUseIds.length} 个工具</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`h-3 w-3 text-[var(--leemo-ink-3)] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-[var(--leemo-line)] px-3 py-2.5" data-testid="subagent-details">
          {item.transcript.map((entry, index) => (
            <div
              key={`${entry.kind}-${index}`}
              className={entry.kind === "thinking"
                ? "text-[var(--leemo-ink-3)]"
                : "text-[var(--leemo-ink-2)]"}
            >
              <MarkdownContent text={entry.text} variant="process" />
            </div>
          ))}
          {item.tools.length > 0 && (
            <div className="space-y-1 border-t border-[var(--leemo-line-soft)] pt-2">
              {item.tools.map((tool) => (
                <div key={tool.toolUseId} className="text-[11.5px]">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      tool.status === "error"
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
                          : toolResultLabel(tool.name, tool.status, tool.summary)}
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
              {stale ? "分身上次停在这里" : "分身正在准备"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
