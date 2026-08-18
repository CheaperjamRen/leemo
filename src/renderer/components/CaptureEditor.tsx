import { useEffect, useMemo, useRef } from "react";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString, BOLD_ITALIC_STAR, BOLD_STAR, CHECK_LIST, ITALIC_STAR, ORDERED_LIST, QUOTE, UNORDERED_LIST, type Transformer } from "@lexical/markdown";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, QuoteNode } from "@lexical/rich-text";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {
  Bold,
  AtSign,
  Code2,
  Heading2,
  Italic,
  List as ListIcon,
  ListChecks,
  ListOrdered,
  PanelTop,
  Quote,
  Redo2,
  Undo2,
  Table2,
} from "lucide-react";
import { NOTE_DRAG_MIME, noteIdFromDragPayload, noteIdFromReferenceHref } from "../notes/note-references";
import {
  $createCalloutNode,
  $createGfmTableNode,
  WORKBENCH_MARKDOWN_NODES,
  WORKBENCH_TRANSFORMERS,
} from "./MarkdownEditor";
import "./CaptureEditor.css";

const CAPTURE_TRANSFORMERS: Transformer[] = [
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  QUOTE,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
];

const CAPTURE_THEME: InitialConfigType["theme"] = {
  paragraph: "capture-editor__paragraph",
  quote: "capture-editor__quote",
  heading: {
    h1: "capture-editor__h1",
    h2: "capture-editor__h2",
    h3: "capture-editor__h3",
    h4: "capture-editor__h4",
    h5: "capture-editor__h5",
    h6: "capture-editor__h6",
  },
  list: {
    checklist: "capture-editor__checklist",
    listitem: "capture-editor__list-item",
    listitemChecked: "capture-editor__list-item--checked",
    listitemUnchecked: "capture-editor__list-item--unchecked",
    nested: { listitem: "capture-editor__list-item--nested" },
    ol: "capture-editor__ordered-list",
    ul: "capture-editor__unordered-list",
  },
  text: {
    bold: "capture-editor__bold",
    italic: "capture-editor__italic",
    code: "capture-editor__inline-code",
    highlight: "capture-editor__highlight",
    strikethrough: "capture-editor__strikethrough",
  },
  code: "capture-editor__code",
  link: "capture-editor__link",
};

export interface CaptureEditorProps {
  markdown: string;
  onMarkdownChange(markdown: string): void;
  onSave(): void;
  onPasteImage?(file: File): void;
  onDropFiles?(files: File[]): void;
  onOpenNoteReferenceMenu?(): void;
  onOpenNoteReference?(noteId: string): void;
  onDropNoteReference?(noteId: string): void;
  mode?: "rich" | "source";
  variant?: "capture" | "document";
  autoFocus?: boolean;
  disabled?: boolean;
}

function CaptureToolbar({
  disabled,
  onOpenNoteReferenceMenu,
  variant,
}: {
  disabled: boolean;
  onOpenNoteReferenceMenu?: () => void;
  variant: "capture" | "document";
}) {
  const [editor] = useLexicalComposerContext();
  const keepSelection = (action: () => void) => editor.focus(action);

  return (
    <div className="capture-editor__toolbar" role="toolbar" aria-label="便签格式">
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="加粗"
        title="加粗 (Ctrl+B)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => keepSelection(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"))}
      >
        <Bold size={15} strokeWidth={1.8} aria-hidden />
      </button>
      {variant === "document" ? (
        <>
          <button
            type="button"
            className="capture-editor__tool-button"
            aria-label="二级标题"
            title="二级标题"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => keepSelection(() => editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createHeadingNode("h2"));
            }))}
          >
            <Heading2 size={15} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            className="capture-editor__tool-button"
            aria-label="斜体"
            title="斜体 (Ctrl+I)"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => keepSelection(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"))}
          >
            <Italic size={15} strokeWidth={1.8} aria-hidden />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="序号列表"
        title="序号列表"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => keepSelection(() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined))}
      >
        <ListOrdered size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="圆点列表"
        title="圆点列表"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => keepSelection(() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined))}
      >
        <ListIcon size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="清单"
        title="清单"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => keepSelection(() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}
      >
        <ListChecks size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="引用注释"
        title="引用注释"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => keepSelection(() => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createQuoteNode());
            }
          });
        })}
      >
        <Quote size={15} strokeWidth={1.8} aria-hidden />
      </button>
      {variant === "document" ? (
        <>
          <button
            type="button"
            className="capture-editor__tool-button"
            aria-label="高亮块"
            title="高亮块"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => keepSelection(() => editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) selection.insertNodes([$createCalloutNode()]);
            }))}
          ><PanelTop size={15} strokeWidth={1.8} aria-hidden /></button>
          <button
            type="button"
            className="capture-editor__tool-button"
            aria-label="插入表格"
            title="插入表格"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => keepSelection(() => editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) selection.insertNodes([$createGfmTableNode()]);
            }))}
          ><Table2 size={15} strokeWidth={1.8} aria-hidden /></button>
        </>
      ) : null}
      {onOpenNoteReferenceMenu ? (
        <button
          type="button"
          className="capture-editor__tool-button"
          aria-label="引用便签"
          title="引用便签 (@)"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpenNoteReferenceMenu}
        >
          <AtSign size={15} strokeWidth={1.8} aria-hidden />
        </button>
      ) : null}
      <span className="capture-editor__toolbar-divider" aria-hidden />
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="撤销"
        title="撤销 (Ctrl+Z)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      >
        <Undo2 size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <button
        type="button"
        className="capture-editor__tool-button"
        aria-label="重做"
        title="重做 (Ctrl+Shift+Z)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
      >
        <Redo2 size={15} strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}

interface MarkdownSelectionResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export function toggleMarkdownBold(text: string, rawStart: number, rawEnd: number): MarkdownSelectionResult {
  const start = Math.max(0, Math.min(rawStart, text.length));
  const end = Math.max(start, Math.min(rawEnd, text.length));
  const selected = text.slice(start, end);

  if (start >= 2 && text.slice(start - 2, start) === "**" && text.slice(end, end + 2) === "**") {
    return {
      text: `${text.slice(0, start - 2)}${selected}${text.slice(end + 2)}`,
      selectionStart: start - 2,
      selectionEnd: end - 2,
    };
  }

  if (selected.startsWith("**") && selected.endsWith("**") && selected.length >= 4) {
    return {
      text: `${text.slice(0, start)}${selected.slice(2, -2)}${text.slice(end)}`,
      selectionStart: start,
      selectionEnd: end - 4,
    };
  }

  return {
    text: `${text.slice(0, start)}**${selected}**${text.slice(end)}`,
    selectionStart: start + 2,
    selectionEnd: end + 2,
  };
}

function SourceCaptureEditor({
  markdown,
  onMarkdownChange,
  onSave,
  onPasteImage,
  onDropFiles,
  onOpenNoteReferenceMenu,
  onDropNoteReference,
  autoFocus,
  disabled,
}: CaptureEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const restoreSelection = (result: MarkdownSelectionResult) => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  return (
    <div className="capture-editor capture-editor--source" data-testid="capture-editor">
      <div className="capture-editor__source-bar">
        <span><Code2 size={14} aria-hidden />Markdown 源码</span>
        {onOpenNoteReferenceMenu ? (
          <button type="button" aria-label="引用便签" title="引用便签 (@)" disabled={disabled} onClick={onOpenNoteReferenceMenu}>
            <AtSign size={15} aria-hidden />
          </button>
        ) : null}
      </div>
      <textarea
        ref={textareaRef}
        className="capture-editor__source"
        aria-label="Markdown 源码"
        value={markdown}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => onMarkdownChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) onOpenNoteReferenceMenu?.();
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            onSave();
          }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
            event.preventDefault();
            const result = toggleMarkdownBold(markdown, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
            onMarkdownChange(result.text);
            restoreSelection(result);
          }
        }}
        onPaste={(event) => {
          const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
          if (!image) return;
          event.preventDefault();
          onPasteImage?.(image);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.files.length > 0 || Array.from(event.dataTransfer.types).includes(NOTE_DRAG_MIME)) event.preventDefault();
        }}
        onDrop={(event) => {
          const noteId = noteIdFromDragPayload(event.dataTransfer);
          if (noteId) {
            event.preventDefault();
            onDropNoteReference?.(noteId);
            return;
          }
          const files = [...event.dataTransfer.files];
          if (files.length === 0) return;
          event.preventDefault();
          onDropFiles?.(files);
        }}
      />
    </div>
  );
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

function CaptureContentEditable({
  onSave,
  onPasteImage,
  onDropFiles,
  onOpenNoteReferenceMenu,
  onOpenNoteReference,
  onDropNoteReference,
}: Pick<CaptureEditorProps,
  "onSave" | "onPasteImage" | "onDropFiles" | "onOpenNoteReferenceMenu" | "onOpenNoteReference" | "onDropNoteReference"
>) {
  return (
    <ContentEditable
      className="capture-editor__content"
      aria-label="便签正文"
      spellCheck
      onKeyDown={(event) => {
        if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) onOpenNoteReferenceMenu?.();
        if ((event.ctrlKey || event.metaKey) && !event.altKey) {
          const key = event.key.toLowerCase();
          if (key === "s") {
            event.preventDefault();
            onSave();
          }
        }
      }}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (!anchor) return;
        const noteId = noteIdFromReferenceHref(anchor.getAttribute("href") ?? "");
        if (!noteId) return;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) onOpenNoteReference?.(noteId);
      }}
      onPaste={(event) => {
        const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
        if (!image) return;
        event.preventDefault();
        onPasteImage?.(image);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.files.length > 0 || Array.from(event.dataTransfer.types).includes(NOTE_DRAG_MIME)) event.preventDefault();
      }}
      onDrop={(event) => {
        const noteId = noteIdFromDragPayload(event.dataTransfer);
        if (noteId) {
          event.preventDefault();
          onDropNoteReference?.(noteId);
          return;
        }
        const files = [...event.dataTransfer.files];
        if (files.length === 0) return;
        event.preventDefault();
        onDropFiles?.(files);
      }}
    />
  );
}

export default function CaptureEditor({
  markdown,
  onMarkdownChange,
  onSave,
  onPasteImage,
  onDropFiles,
  onOpenNoteReferenceMenu,
  onOpenNoteReference,
  onDropNoteReference,
  mode = "rich",
  variant = "capture",
  autoFocus = false,
  disabled = false,
}: CaptureEditorProps) {
  const transformers = variant === "document" ? WORKBENCH_TRANSFORMERS : CAPTURE_TRANSFORMERS;
  const initialConfig = useMemo<InitialConfigType>(() => ({
    namespace: "LeemoCaptureEditor",
    nodes: variant === "document" ? WORKBENCH_MARKDOWN_NODES : [ListNode, ListItemNode, QuoteNode],
    theme: CAPTURE_THEME,
    editable: !disabled,
    editorState: () => $convertFromMarkdownString(markdown, transformers, undefined, variant === "document"),
    onError(error) {
      throw error;
    },
  }), [markdown, disabled, transformers, variant]);

  if (mode === "source") {
    return (
      <SourceCaptureEditor
        markdown={markdown}
        onMarkdownChange={onMarkdownChange}
        onSave={onSave}
        onPasteImage={onPasteImage}
        onDropFiles={onDropFiles}
        onOpenNoteReferenceMenu={onOpenNoteReferenceMenu}
        onDropNoteReference={onDropNoteReference}
        autoFocus={autoFocus}
        disabled={disabled}
        mode={mode}
        variant={variant}
      />
    );
  }

  return (
    <div className="capture-editor" data-testid="capture-editor">
      <LexicalComposer initialConfig={initialConfig}>
        <CaptureToolbar disabled={disabled} onOpenNoteReferenceMenu={onOpenNoteReferenceMenu} variant={variant} />
        <div className="capture-editor__canvas">
          <RichTextPlugin
            contentEditable={
              <CaptureContentEditable
                onSave={onSave}
                onPasteImage={onPasteImage}
                onDropFiles={onDropFiles}
                onOpenNoteReferenceMenu={onOpenNoteReferenceMenu}
                onOpenNoteReference={onOpenNoteReference}
                onDropNoteReference={onDropNoteReference}
              />
            }
            placeholder={<p className="capture-editor__placeholder">写下此刻想到的事…</p>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) => {
            editorState.read(() => onMarkdownChange($convertToMarkdownString(transformers, undefined, variant === "document")));
          }}
        />
        <ListPlugin />
        <CheckListPlugin />
        <HistoryPlugin />
        {variant === "document" ? <LinkPlugin /> : null}
        {variant === "document" ? <MarkdownShortcutPlugin transformers={transformers} /> : null}
        <TabIndentationPlugin />
        <EditablePlugin disabled={disabled} />
        {autoFocus ? <AutoFocusPlugin /> : null}
      </LexicalComposer>
    </div>
  );
}

export { CAPTURE_TRANSFORMERS };
