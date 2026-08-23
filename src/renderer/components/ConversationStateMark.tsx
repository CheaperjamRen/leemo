import { CircleAlert } from "lucide-react";
import type { ConversationMarker } from "../stores/conversation-status";

export default function ConversationStateMark({
  marker,
  label,
  detail,
  className = "",
}: {
  marker: ConversationMarker;
  label: string;
  detail?: string;
  className?: string;
}): React.JSX.Element | null {
  if (!marker) return null;

  const stateLabel = marker === "running" ? "进行中" : marker === "error" ? "报错" : "未读";
  const accessibleLabel = `${label}：${stateLabel}`;
  const title = marker === "unread"
    ? detail && detail !== "任务已完成"
      ? `未读：${detail}`
      : "未读"
    : detail ?? stateLabel;

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      title={title}
      className={`mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center ${
        marker === "running"
          ? "text-[var(--leemo-amber)]"
          : marker === "error"
            ? "text-[var(--leemo-danger)]"
            : "text-[var(--leemo-amber)]"
      } ${className}`.trim()}
    >
      {marker === "running" ? (
        <span
          data-conversation-running-dot
          className="h-1.5 w-1.5 rounded-full bg-current ring-2 ring-[var(--leemo-amber-soft)]"
          aria-hidden
        />
      ) : marker === "error" ? (
        <CircleAlert className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      )}
    </span>
  );
}
