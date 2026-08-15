import type { TimelineItem } from "../../stores/message-model";
import { useState } from "react";
import BrowserCapturePreview from "./BrowserCapturePreview";
import { toolActionLabel, toolOutcomeLabel, toolResultLabel } from "../tool-labels";
import RawToolDetails from "./RawToolDetails";

const STATUS_LABEL = { running: "进行中…", ok: "完成", error: "失败" } as const;

/* 工具类型图标（按 name）：Read→doc, Grep→search, Write→pencil, 其它→通用扳手。
   stroke 风格照 k3/workbench-mode.html：fill=none stroke=currentColor 1.7 round。 */
function typeIcon(name: string) {
  const cls = "h-[14px] w-[14px] shrink-0 text-[var(--leemo-ink-3)]";
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: cls,
    "aria-hidden": true,
  } as const;
  switch (name) {
    case "Read":
      return (
        <svg {...common}>
          <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z" />
          <path d="M13.5 3v5.5H19" />
          <path d="M9 13.2h6" />
          <path d="M9 16.6h4" />
        </svg>
      );
    case "Grep":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m19.8 19.8-3.6-3.6" />
        </svg>
      );
    case "Write":
      return (
        <svg {...common}>
          <path d="M12 20h8.5" />
          <path d="M16.6 3.6a2.1 2.1 0 0 1 3 3L7.4 18.8l-4 1 1-4 12.2-12.2Z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3.5 17.5a2.12 2.12 0 0 0 3 3l5.2-5.2a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7Z" />
        </svg>
      );
  }
}

export default function ToolCard({
  item,
  stale = false,
}: {
  item: Extract<TimelineItem, { kind: "tool" }>;
  stale?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const paused = stale && item.status === "running";
  const neutralStop = item.outcome === "denied" || item.outcome === "cancelled" || item.outcome === "interrupted";
  const resultLabel = toolOutcomeLabel(
    item.outcome,
    toolResultLabel(item.name, item.status, item.summary ?? STATUS_LABEL[item.status]),
  );
  return (
    <div className="w-full overflow-hidden rounded-[8px] border border-[var(--leemo-line-2)] bg-[var(--leemo-panel)] transition-colors hover:border-[var(--leemo-line)] hover:bg-[var(--leemo-card)]">
      <button
        type="button"
        aria-label={expanded ? "收起工具详情" : "展开工具详情"}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-[6px] text-left"
      >
        {paused ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
            className="h-[13px] w-[13px] shrink-0 text-[var(--leemo-ink-3)]" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M9.5 9v6M14.5 9v6" />
          </svg>
        ) : item.status === "running" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            className="h-[13px] w-[13px] shrink-0 leemo-spin text-[var(--leemo-amber)]" aria-hidden>
            <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
          </svg>
        ) : item.status === "ok" ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className="h-[13px] w-[13px] shrink-0 text-[var(--leemo-ok)]" aria-hidden>
            <path d="m4.8 12.6 4.6 4.6 9.8-10.4" />
          </svg>
        ) : neutralStop ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
            className="h-[13px] w-[13px] shrink-0 text-[var(--leemo-ink-3)]" aria-hidden>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M8.5 12h7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
            className="h-[13px] w-[13px] shrink-0 text-[var(--leemo-danger)]" aria-hidden>
            <path d="M12 4.5 3.5 19.5h17L12 4.5Z" />
            <path d="M12 10v3.6" />
            <path d="M12 16.6h.01" />
          </svg>
        )}
        {typeIcon(item.name)}
        <span className="shrink-0 whitespace-nowrap text-[12.5px] font-medium text-[var(--leemo-ink-2)]">{toolActionLabel(item.name)}</span>
        <span className="ml-auto min-w-0 flex-1 truncate text-right text-[11px] text-[var(--leemo-ink-3)]">
          {paused ? "上次停在这里" : resultLabel}
        </span>
      </button>
      {item.browserCapture ? <div className="px-3 pb-2"><BrowserCapturePreview capture={item.browserCapture} /></div> : null}
      {expanded ? <RawToolDetails item={item} /> : null}
    </div>
  );
}
