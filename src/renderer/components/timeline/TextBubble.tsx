import MomoAvatar from "../momo/MomoAvatar";
import { Paperclip } from "lucide-react";
import MarkdownContent from "../MarkdownContent";
import type { TimelineItem } from "../../stores/message-model";

function formatTime(createdAt: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(createdAt));
}

export default function TextBubble({
  item,
  density = "workbench",
  showCaret = item.streaming,
  showAvatar = true,
}: {
  item: Extract<TimelineItem, { kind: "text" }>;
  density?: "workbench" | "buddy";
  showCaret?: boolean;
  showAvatar?: boolean;
}) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end" data-timeline-message="user">
        <div className="flex max-w-[min(520px,65%)] flex-col items-end gap-1">
          <div
            data-message-role="user"
            data-surface-level="content"
            className={`w-fit max-w-full rounded-[12px] px-3.5 py-2 leading-[1.65] text-[var(--leemo-ink)] ring-1 ${density === "buddy" ? "leemo-buddy-user-bubble text-[15.5px]" : "leemo-workbench-user-bubble text-[14.5px]"}`}
          >
            {item.attachments && item.attachments.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 ${item.text ? "mb-1.5" : ""}`}>
                {item.attachments.map((attachment, index) => (
                  <span
                    key={`${attachment.name}-${index}`}
                    className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--leemo-line)] bg-white px-2 py-0.5 text-xs text-[var(--leemo-ink-2)]"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{attachment.name}</span>
                  </span>
                ))}
              </div>
            )}
            {item.text && <div className="whitespace-pre-wrap">{item.text}</div>}
          </div>
          {item.createdAt !== undefined && (
            <time dateTime={new Date(item.createdAt).toISOString()} className="px-0.5 text-[10.5px] tabular-nums text-[var(--leemo-ink-3)]">
              {formatTime(item.createdAt)}
            </time>
          )}
        </div>
      </div>
    );
  }
  const isBuddy = density === "buddy";
  return (
    <div className={`flex items-start ${isBuddy ? "gap-3" : "gap-2.5"}`} data-timeline-message="momo">
      {showAvatar
        ? <MomoAvatar size={isBuddy ? 30 : 22} />
        : <span aria-hidden className={isBuddy ? "w-[30px] shrink-0" : "w-[22px] shrink-0"} />}
      <div
        data-testid={isBuddy ? "buddy-momo-bubble" : undefined}
        className={isBuddy
          ? "leemo-buddy-momo-bubble max-w-[620px] rounded-[13px] px-4 py-2.5 text-[15.5px] leading-[1.7] text-[var(--leemo-ink)]"
          : "max-w-[700px] pt-[1px] text-[15px] leading-[1.72] text-[var(--leemo-ink)]"}
      >
        <MarkdownContent text={item.text} variant="answer" />
        {showCaret && (
          <span aria-hidden
            className="leemo-caret ml-[3px] inline-block h-[14px] w-[3px] translate-y-[2px] rounded-[1.5px] bg-[var(--leemo-amber)]" />
        )}
      </div>
    </div>
  );
}
