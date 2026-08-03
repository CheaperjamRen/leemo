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

export default function TextBubble({ item }: { item: Extract<TimelineItem, { kind: "text" }> }) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[560px] flex-col items-end gap-1">
          <div className="w-fit max-w-full rounded-[12px] bg-[var(--leemo-bg-deep)] px-3.5 py-2 text-[13.5px] leading-[1.75] text-[var(--leemo-ink)] ring-1 ring-[var(--leemo-line-2)]">
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
  return (
    <div className="flex items-start gap-2.5">
      <MomoAvatar size={26} />
      <div className="max-w-[600px] pt-[3px] text-[13.5px] leading-[1.8] text-[var(--leemo-ink)]">
        <MarkdownContent text={item.text} variant="answer" />
        {item.streaming && (
          <span aria-hidden
            className="leemo-caret ml-[3px] inline-block h-[14px] w-[3px] translate-y-[2px] rounded-[1.5px] bg-[var(--leemo-amber)]" />
        )}
      </div>
    </div>
  );
}
