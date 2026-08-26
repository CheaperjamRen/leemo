import { useEffect, useRef } from "react";
import { MessageSquarePlus, X } from "lucide-react";

export interface NewTopicDialogProps {
  open: boolean;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function NewTopicDialog({
  open,
  busy,
  error,
  onConfirm,
  onCancel,
}: NewTopicDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="leemo-new-topic-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="new-topic-dialog-title"
        aria-describedby="new-topic-dialog-description"
        className="leemo-new-topic-dialog"
      >
        <div className="leemo-new-topic-dialog-heading">
          <span className="leemo-new-topic-dialog-mark" aria-hidden>
            <MessageSquarePlus />
          </span>
          <div>
            <h2 id="new-topic-dialog-title">开始新话题？</h2>
            <p id="new-topic-dialog-description">
              之前的聊天会继续保留。momo 会把下一条消息当作新的开始，需要时仍能回想以前聊过的事。
            </p>
          </div>
          <button
            ref={cancelRef}
            type="button"
            aria-label="关闭新话题窗口"
            title="关闭"
            disabled={busy}
            onClick={onCancel}
            className="leemo-new-topic-dialog-close"
          >
            <X aria-hidden />
          </button>
        </div>
        {error && <p role="alert" className="leemo-new-topic-dialog-error">{error}</p>}
        <div className="leemo-new-topic-dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel} className="leemo-new-topic-cancel">
            取消
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className="leemo-new-topic-confirm">
            {busy ? "正在准备" : "开始"}
          </button>
        </div>
      </section>
    </div>
  );
}
