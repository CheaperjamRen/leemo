import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import type { ConversationMeta } from "../stores/conversations";
import type { ConversationStatus } from "../stores/conversation-status";

export interface ConversationMoveTarget {
  workspaceId: string;
  bookId: string | null;
  label: string;
}

function statusClass(kind: ConversationStatus["kind"]): string {
  if (kind === "failed") return "text-[var(--leemo-danger)]";
  if (kind === "completed") return "text-[var(--leemo-ok)]";
  if (kind === "running" || kind === "blocked") return "text-[var(--leemo-amber)]";
  return "text-[var(--leemo-ink-3)]";
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "操作没有完成，请稍后再试。";
}

export default function ConversationListItem({
  conversation,
  active,
  variant,
  onPick,
  onRename,
  onPin,
  onArchive,
  onDelete,
  moveTargets = [],
  onMove,
  status,
}: {
  conversation: ConversationMeta;
  active: boolean;
  variant: "buddy" | "workbench";
  onPick: () => void;
  onRename: (title: string) => void;
  onPin?: (pinned: boolean) => void | Promise<void>;
  onArchive?: (archived: boolean) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  moveTargets?: ConversationMoveTarget[];
  onMove?: (target: ConversationMoveTarget) => void | Promise<void>;
  status?: ConversationStatus;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
    setMoving(false);
    setConfirmingDelete(false);
  };
  const beginEdit = () => {
    setDraft(conversation.title);
    setEditing(true);
    closeMenu();
  };
  const commit = (event?: FormEvent) => {
    event?.preventDefault();
    const title = draft.trim();
    if (title) onRename(title);
    setEditing(false);
  };
  const runAction = async (action: () => void | Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      closeMenu();
    } catch (error: unknown) {
      setActionError(actionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const selectedClass = variant === "buddy"
    ? active
      ? "bg-[var(--leemo-amber-bg)] text-[var(--leemo-ink)]"
      : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-line-soft)] hover:text-[var(--leemo-ink)]"
    : active
      ? "bg-[var(--leemo-card)] text-[var(--leemo-ink)] shadow-[0_1px_3px_rgba(24,31,38,0.08)] ring-1 ring-inset ring-[var(--leemo-line-soft)]"
      : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]";
  const menuItemClass = "flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-xs text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)] disabled:opacity-45";

  if (editing) {
    return (
      <form onSubmit={commit} className={`flex w-full items-center gap-1 rounded-lg px-1.5 py-1 ${selectedClass}`}>
        <input
          autoFocus
          aria-label="对话标题"
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-[5px] border border-[var(--leemo-amber-line)] bg-white px-2 py-1 text-[13px] text-[var(--leemo-ink)] outline-none focus:ring-2 focus:ring-[var(--leemo-amber-soft)]"
        />
        <button type="submit" className="leemo-icon-btn h-7 w-7" aria-label="保存标题" title="保存">
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" onClick={() => setEditing(false)} className="leemo-icon-btn h-7 w-7" aria-label="取消改名" title="取消">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </form>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full" data-conversation-id={conversation.id}>
      <div className={`group flex w-full items-center rounded-lg transition-colors ${selectedClass}`}>
        <button
          type="button"
          aria-label={conversation.title}
          title={conversation.title}
          onClick={onPick}
          className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 text-left text-sm"
        >
          {conversation.pinned && <Pin className="h-3 w-3 shrink-0 text-[var(--leemo-amber)]" aria-label="已置顶" />}
          <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
          {conversation.unread && !active && (
            <span aria-label="未读" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--leemo-amber)]" />
          )}
        </button>
        {status && (
          <span
            role="status"
            aria-label={`${conversation.title}：${status.label}`}
            title={status.detail}
            className={`mr-1 flex shrink-0 items-center gap-1 text-[10.5px] ${statusClass(status.kind)}`}
          >
            <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
            <span>{status.label}</span>
          </span>
        )}
        <button
          type="button"
          aria-label={`更多操作：${conversation.title}`}
          title="更多操作"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((open) => !open);
            setMoving(false);
            setConfirmingDelete(false);
            setActionError(null);
          }}
          className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] opacity-0 transition hover:bg-white/70 hover:text-[var(--leemo-ink-2)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)] group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {actionError && (
        <p role="alert" className="px-2.5 pb-1 text-[11px] leading-4 text-[var(--leemo-danger)]">
          {actionError}
        </p>
      )}

      {menuOpen && (
        <div className="absolute right-1 top-8 z-30 w-[180px] rounded-md border border-[var(--leemo-line)] bg-white p-1 shadow-[0_10px_28px_rgba(32,32,31,0.14)]">
          {moving ? (
            <>
              <button type="button" className={menuItemClass} onClick={() => setMoving(false)} disabled={busy}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                返回
              </button>
              <div className="my-1 h-px bg-[var(--leemo-line)]" />
              {moveTargets.map((target) => (
                <button
                  type="button"
                  key={`${target.workspaceId}:${target.bookId ?? ""}`}
                  className={menuItemClass}
                  aria-label={`移动到${target.label}`}
                  title={target.label}
                  disabled={busy}
                  onClick={() => void runAction(() => onMove?.(target))}
                >
                  <FolderInput className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{target.label}</span>
                </button>
              ))}
            </>
          ) : confirmingDelete ? (
            <div className="p-1">
              <p className="px-1 pb-2 text-xs text-[var(--leemo-ink-2)]">删除后无法恢复</p>
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-[5px] px-2 py-1 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]" disabled={busy}>取消</button>
                <button type="button" aria-label="确认删除对话" onClick={() => void runAction(() => onDelete?.())} className="rounded-[5px] bg-[var(--leemo-danger)] px-2 py-1 text-xs text-white disabled:opacity-50" disabled={busy}>删除</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className={menuItemClass} onClick={beginEdit} disabled={busy}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                重命名
              </button>
              {onPin && (
                <button type="button" className={menuItemClass} onClick={() => void runAction(() => onPin(!conversation.pinned))} disabled={busy}>
                  {conversation.pinned ? <PinOff className="h-3.5 w-3.5" aria-hidden /> : <Pin className="h-3.5 w-3.5" aria-hidden />}
                  {conversation.pinned ? "取消置顶" : "置顶"}
                </button>
              )}
              {onMove && moveTargets.length > 0 && (
                <button type="button" className={menuItemClass} onClick={() => setMoving(true)} disabled={busy}>
                  <FolderInput className="h-3.5 w-3.5" aria-hidden />
                  移动到其他本子
                </button>
              )}
              {onArchive && (
                <button type="button" className={menuItemClass} onClick={() => void runAction(() => onArchive(!conversation.archived))} disabled={busy}>
                  {conversation.archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> : <Archive className="h-3.5 w-3.5" aria-hidden />}
                  {conversation.archived ? "移出归档" : "归档"}
                </button>
              )}
              {onDelete && (
                <>
                  <div className="my-1 h-px bg-[var(--leemo-line)]" />
                  <button type="button" className={`${menuItemClass} text-[var(--leemo-danger)] hover:text-[var(--leemo-danger)]`} onClick={() => setConfirmingDelete(true)} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    删除对话
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
