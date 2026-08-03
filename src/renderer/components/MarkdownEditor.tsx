import { useRef, type KeyboardEvent } from "react";
import {
  Bold,
  Code2,
  Copy,
  Heading2,
  Italic,
  List as ListIcon,
  Quote,
  Save,
} from "lucide-react";
import type { PreviewDraft } from "../stores/preview-content";

export type MarkdownFormat = "bold" | "italic" | "heading" | "quote" | "list" | "code";

export interface MarkdownFormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function applyMarkdownFormat(
  text: string,
  rawStart: number,
  rawEnd: number,
  format: MarkdownFormat,
): MarkdownFormatResult {
  const start = Math.max(0, Math.min(rawStart, text.length));
  const end = Math.max(start, Math.min(rawEnd, text.length));
  const selected = text.slice(start, end);

  const wrap = (before: string, after = before): MarkdownFormatResult => ({
    text: `${text.slice(0, start)}${before}${selected}${after}${text.slice(end)}`,
    selectionStart: start + before.length,
    selectionEnd: end + before.length,
  });

  if (format === "bold") return wrap("**");
  if (format === "italic") return wrap("*");
  if (format === "code") {
    return selected.includes("\n") ? wrap("```\n", "\n```") : wrap("`");
  }

  const prefix = format === "heading" ? "## " : format === "quote" ? "> " : "- ";
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const formatted = lines.map((line) => `${prefix}${line}`).join("\n");
  return {
    text: `${text.slice(0, lineStart)}${formatted}${text.slice(lineEnd)}`,
    selectionStart: start + prefix.length,
    selectionEnd: end + prefix.length * lines.length,
  };
}

const TOOL_BUTTON = "grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--leemo-amber-line)] disabled:cursor-not-allowed disabled:opacity-35";

function FormatButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={TOOL_BUTTON}>
      {children}
    </button>
  );
}

export default function MarkdownEditor({
  title,
  draft,
  disabled = false,
  onChange,
  onSave,
}: {
  title: string;
  draft: PreviewDraft;
  disabled?: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saving = disabled || draft.status === "saving";

  const apply = (format: MarkdownFormat) => {
    const editor = editorRef.current;
    if (!editor || saving) return;
    const result = applyMarkdownFormat(draft.text, editor.selectionStart, editor.selectionEnd, format);
    onChange(result.text);
    window.setTimeout(() => {
      editor.focus();
      editor.setSelectionRange(result.selectionStart, result.selectionEnd);
    }, 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLocaleLowerCase();
    if (key === "s") {
      event.preventDefault();
      if (!saving && draft.status !== "clean") onSave();
    } else if (key === "b") {
      event.preventDefault();
      apply("bold");
    } else if (key === "i") {
      event.preventDefault();
      apply("italic");
    }
  };

  const statusLabel = disabled
    ? "正在切换…"
    : draft.status === "saving"
    ? "保存中…"
    : draft.status === "clean"
      ? "已保存"
      : draft.status === "error"
        ? "保存失败"
        : "未保存";

  return (
    <div className="flex min-h-[240px] flex-1 flex-col bg-[var(--leemo-bg)]" data-testid="markdown-editor">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--leemo-line)] px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <FormatButton label="加粗" disabled={saving} onClick={() => apply("bold")}><Bold className="h-3.5 w-3.5" aria-hidden /></FormatButton>
          <FormatButton label="斜体" disabled={saving} onClick={() => apply("italic")}><Italic className="h-3.5 w-3.5" aria-hidden /></FormatButton>
          <FormatButton label="二级标题" disabled={saving} onClick={() => apply("heading")}><Heading2 className="h-3.5 w-3.5" aria-hidden /></FormatButton>
          <FormatButton label="引用" disabled={saving} onClick={() => apply("quote")}><Quote className="h-3.5 w-3.5" aria-hidden /></FormatButton>
          <FormatButton label="无序列表" disabled={saving} onClick={() => apply("list")}><ListIcon className="h-3.5 w-3.5" aria-hidden /></FormatButton>
          <FormatButton label="代码" disabled={saving} onClick={() => apply("code")}><Code2 className="h-3.5 w-3.5" aria-hidden /></FormatButton>
        </div>
        <span className={`shrink-0 text-[10.5px] ${draft.status === "error" ? "text-[var(--leemo-danger)]" : draft.status === "dirty" ? "text-[var(--leemo-amber)]" : "text-[var(--leemo-ink-3)]"}`}>
          {statusLabel}
        </span>
        <button
          type="button"
          aria-label="保存"
          title="保存 (Ctrl+S)"
          disabled={saving || draft.status === "clean"}
          onClick={onSave}
          className={`${TOOL_BUTTON} ml-1 text-[var(--leemo-ink-2)]`}
        >
          <Save className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <textarea
        ref={editorRef}
        aria-label={`编辑 ${title}`}
        value={draft.text}
        disabled={saving}
        spellCheck
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] disabled:opacity-70"
      />
      {draft.error && (
        <div className="flex shrink-0 items-start gap-2 border-t border-[var(--leemo-line)] px-3 py-2" role="alert">
          <p className="min-w-0 flex-1 text-[11px] leading-4 text-[var(--leemo-danger)]">{draft.error}</p>
          <button
            type="button"
            aria-label="复制草稿"
            title="复制草稿"
            onClick={() => void navigator.clipboard?.writeText(draft.text)}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
          >
            <Copy className="h-3 w-3" aria-hidden />
            复制草稿
          </button>
        </div>
      )}
    </div>
  );
}
