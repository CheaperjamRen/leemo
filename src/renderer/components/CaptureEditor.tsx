import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";
import { $createCodeNode } from "@lexical/code-core";
import { $createLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $convertFromMarkdownString, $convertToMarkdownString, $generateNodesFromMarkdownString, BOLD_ITALIC_STAR, BOLD_STAR, CHECK_LIST, ITALIC_STAR, ORDERED_LIST, QUOTE, UNORDERED_LIST, type Transformer } from "@lexical/markdown";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, QuoteNode, type HeadingTagType } from "@lexical/rich-text";
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
  ChevronDown,
  Highlighter,
  Italic,
  Link2,
  List as ListIcon,
  ListChecks,
  ListOrdered,
  PanelTop,
  Quote,
  Redo2,
  Undo2,
  Table2,
  Sigma,
  Workflow,
} from "lucide-react";
import { NOTE_DRAG_MIME, noteIdFromDragPayload, noteIdFromReferenceHref, noteReferenceHref } from "../notes/note-references";
import {
  $createMathNode,
  $createMermaidNode,
  WORKBENCH_MARKDOWN_NODES,
  WORKBENCH_TRANSFORMERS,
  CALLOUT_NORMALIZATION_TAG,
  CalloutInteractionPlugin,
  CalloutNormalizationPlugin,
  insertCalloutWithParagraph,
} from "./MarkdownEditor";
import { $createGfmTableNode } from "./GfmTableEditor";
import "./CaptureEditor.css";
import { normalizeLegacyMarkdown } from "./markdown-normalization";

const CAPTURE_TRANSFORMERS: Transformer[] = [
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  QUOTE,
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  ITALIC_STAR,
];

function looksLikeMarkdownDocument(value: string): boolean {
  if (!value.trim()) return false;
  return /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```|~~~|\$\$\s*$|\|.+\|)|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)|\$[^$\n]+\$/mu.test(value);
}

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
  referenceMenu?: ReactNode;
  onOpenNoteReference?(noteId: string): void;
  onDropNoteReference?(noteId: string): void;
  onTaskSelectionChange?(selection: string): void;
  mode?: "rich" | "source";
  variant?: "capture" | "document";
  autoFocus?: boolean;
  disabled?: boolean;
}

export interface CaptureEditorHandle {
  insertNoteReference(noteId: string, label: string): boolean;
  readTaskSelection(): string;
}

function CaptureToolbar({
  disabled,
  onOpenNoteReferenceMenu,
  referenceMenu,
  variant,
}: {
  disabled: boolean;
  onOpenNoteReferenceMenu?: () => void;
  referenceMenu?: ReactNode;
  variant: "capture" | "document";
}) {
  const [editor] = useLexicalComposerContext();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [blockType, setBlockType] = useState<"paragraph" | HeadingTagType>("paragraph");
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false });
  const keepSelection = (action: () => void) => editor.focus(action);

  useEffect(() => {
    if (variant !== "document") return;
    const readSelection = (): boolean => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      setActiveFormats({ bold: selection.hasFormat("bold"), italic: selection.hasFormat("italic") });
      const topLevel = selection.anchor.getNode().getTopLevelElement();
      setBlockType($isHeadingNode(topLevel) ? topLevel.getTag() : "paragraph");
      return false;
    };
    const unregisterSelection = editor.registerCommand(SELECTION_CHANGE_COMMAND, readSelection, COMMAND_PRIORITY_LOW);
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => editorState.read(() => readSelection()));
    return () => {
      unregisterSelection();
      unregisterUpdate();
    };
  }, [editor, variant]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  const setDocumentBlock = (value: "paragraph" | HeadingTagType): void => {
    setBlockType(value);
    keepSelection(() => editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $setBlocksType(selection, () => value === "paragraph" ? $createParagraphNode() : $createHeadingNode(value));
    }));
  };
  const runMoreAction = (action: () => void): void => {
    keepSelection(action);
    setMoreOpen(false);
  };
  const insertLink = (): void => {
    const url = window.prompt("链接地址");
    if (url?.trim()) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
  };
  const insertMath = (): void => editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertNodes([$createMathNode("x", true)]);
  });
  const insertTable = (): void => editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertNodes([$createGfmTableNode()]);
  });

  if (variant === "document") {
    return (
      <div className="capture-editor__toolbar capture-editor__toolbar--document" role="toolbar" aria-label="便签格式">
        <select aria-label="段落样式" value={blockType} disabled={disabled} onChange={(event) => setDocumentBlock(event.currentTarget.value as "paragraph" | HeadingTagType)}>
          <option value="paragraph">正文</option>
          <option value="h1">一级标题</option>
          <option value="h2">二级标题</option>
          <option value="h3">三级标题</option>
        </select>
        <span className="capture-editor__toolbar-divider" aria-hidden />
        <button type="button" className="capture-editor__tool-button" aria-label="加粗" aria-pressed={activeFormats.bold} title="加粗 (Ctrl+B)" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"))}><Bold size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button" aria-label="斜体" aria-pressed={activeFormats.italic} title="斜体 (Ctrl+I)" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"))}><Italic size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button" aria-label="圆点列表" title="圆点列表" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined))}><ListIcon size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button" aria-label="序号列表" title="序号列表" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined))}><ListOrdered size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button" aria-label="清单" title="清单" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}><ListChecks size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button" aria-label="引用注释" title="引用注释" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(() => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createQuoteNode()); }))}><Quote size={15} strokeWidth={1.8} aria-hidden /></button>
        {onOpenNoteReferenceMenu ? <div className="capture-editor__reference-wrap"><button type="button" className="capture-editor__tool-button" aria-label="引用便签" title="引用便签 (@)" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(onOpenNoteReferenceMenu)}><AtSign size={15} strokeWidth={1.8} aria-hidden /></button>{referenceMenu}</div> : null}
        <span className="capture-editor__toolbar-divider capture-editor__toolbar-divider--objects" aria-hidden />
        <button type="button" className="capture-editor__tool-button capture-editor__tool-button--wide-priority" aria-label="插入链接" title="插入链接" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(insertLink)}><Link2 size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button capture-editor__tool-button--wide-priority" aria-label="插入表格" title="插入表格" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(insertTable)}><Table2 size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button capture-editor__tool-button--wide-priority" aria-label="插入公式" title="插入公式" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => keepSelection(insertMath)}><Sigma size={15} strokeWidth={1.8} aria-hidden /></button>
        <div ref={moreRef} className="capture-editor__more-wrap">
          <button type="button" className="capture-editor__more-trigger" aria-label="更多格式" aria-expanded={moreOpen} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => setMoreOpen((open) => !open)}>更多<ChevronDown size={14} aria-hidden /></button>
          {moreOpen ? (
            <div className="capture-editor__more-menu" role="menu" aria-label="更多格式">
              <button type="button" className="capture-editor__menu-item--responsive-only" role="menuitem" onClick={() => runMoreAction(insertLink)}><Link2 aria-hidden />插入链接</button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(() => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createCodeNode()); }))}><Code2 aria-hidden />代码块</button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "highlight"))}><Highlighter aria-hidden />文字高亮</button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(() => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) insertCalloutWithParagraph(selection); }))}><PanelTop aria-hidden />高亮块</button>
              <button type="button" className="capture-editor__menu-item--responsive-only" role="menuitem" onClick={() => runMoreAction(insertMath)}><Sigma aria-hidden />插入公式</button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(() => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertNodes([$createMermaidNode("flowchart LR\n  A --> B")]); }))}><Workflow aria-hidden />插入 Mermaid 图表</button>
              <button type="button" className="capture-editor__menu-item--responsive-only" role="menuitem" onClick={() => runMoreAction(insertTable)}><Table2 aria-hidden />插入表格</button>
            </div>
          ) : null}
        </div>
        <span className="capture-editor__toolbar-spacer" aria-hidden />
        <button type="button" className="capture-editor__tool-button" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 size={15} strokeWidth={1.8} aria-hidden /></button>
        <button type="button" className="capture-editor__tool-button" aria-label="重做" title="重做 (Ctrl+Shift+Z)" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 size={15} strokeWidth={1.8} aria-hidden /></button>
      </div>
    );
  }

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
      {onOpenNoteReferenceMenu ? (
        <button
          type="button"
          className="capture-editor__tool-button"
          aria-label="引用便签"
          title="引用便签 (@)"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => keepSelection(onOpenNoteReferenceMenu)}
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
  referenceMenu,
  onDropNoteReference,
  onTaskSelectionChange,
  autoFocus,
  disabled,
  textareaRef,
  onSourceSelectionChange,
}: CaptureEditorProps & {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSourceSelectionChange(start: number, end: number): void;
}) {
  const reportSelection = (textarea: HTMLTextAreaElement): void => {
    onSourceSelectionChange(textarea.selectionStart, textarea.selectionEnd);
    onTaskSelectionChange?.(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd));
  };

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
          <div className="capture-editor__reference-wrap">
            <button
              type="button"
              aria-label="引用便签"
              title="引用便签 (@)"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const textarea = textareaRef.current;
                if (textarea) {
                  textarea.focus();
                  reportSelection(textarea);
                }
                onOpenNoteReferenceMenu();
              }}
            >
              <AtSign size={15} aria-hidden />
            </button>
            {referenceMenu}
          </div>
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
        onSelect={(event) => reportSelection(event.currentTarget)}
        onClick={(event) => reportSelection(event.currentTarget)}
        onKeyUp={(event) => reportSelection(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey && onOpenNoteReferenceMenu) {
            event.preventDefault();
            reportSelection(event.currentTarget);
            onOpenNoteReferenceMenu();
          }
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
            reportSelection(event.currentTarget);
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

function MarkdownDocumentPastePlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!enabled || !("clipboardData" in event)) return false;
      const plainText = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeMarkdownDocument(plainText)) return false;
      event.preventDefault();
      const currentSelection = $getSelection();
      const selection = $isRangeSelection(currentSelection) ? currentSelection : $getRoot().selectEnd();
      selection.insertNodes($generateNodesFromMarkdownString(plainText, WORKBENCH_TRANSFORMERS, true));
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  ), [editor, enabled]);
  return null;
}

function CaptureEditorBridge({
  onReady,
  onSelectionChange,
}: {
  onReady(editor: LexicalEditor | null): void;
  onSelectionChange(selection: RangeSelection | null, text: string): void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    onReady(editor);
    const captureSelection = (): boolean => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        onSelectionChange(selection.clone(), selection.getTextContent());
      } else {
        onSelectionChange(null, "");
      }
      return false;
    };
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      captureSelection,
      COMMAND_PRIORITY_LOW,
    );
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => captureSelection());
    });
    return () => {
      unregisterSelection();
      unregisterUpdate();
      onReady(null);
    };
  }, [editor, onReady, onSelectionChange]);

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
      spellCheck={false}
      onKeyDown={(event) => {
        if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey && onOpenNoteReferenceMenu) {
          event.preventDefault();
          onOpenNoteReferenceMenu();
        }
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
        if (image) {
          event.preventDefault();
          onPasteImage?.(image);
          return;
        }
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

const CaptureEditor = forwardRef<CaptureEditorHandle, CaptureEditorProps>(function CaptureEditor({
  markdown,
  onMarkdownChange,
  onSave,
  onPasteImage,
  onDropFiles,
  onOpenNoteReferenceMenu,
  referenceMenu,
  onOpenNoteReference,
  onDropNoteReference,
  onTaskSelectionChange,
  mode = "rich",
  variant = "capture",
  autoFocus = false,
  disabled = false,
}, ref) {
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceSelectionRef = useRef({ start: 0, end: 0 });
  const richEditorRef = useRef<LexicalEditor | null>(null);
  const richSelectionRef = useRef<RangeSelection | null>(null);
  const taskSelectionRef = useRef("");
  const publishTaskSelection = useCallback((text: string): void => {
    taskSelectionRef.current = text;
    onTaskSelectionChange?.(text);
  }, [onTaskSelectionChange]);
  const captureRichSelection = useCallback((selection: RangeSelection | null, text: string): void => {
    richSelectionRef.current = selection;
    publishTaskSelection(text);
  }, [publishTaskSelection]);
  const bindRichEditor = useCallback((editor: LexicalEditor | null): void => {
    richEditorRef.current = editor;
  }, []);

  useImperativeHandle(ref, () => ({
    insertNoteReference(noteId, label) {
      const href = noteReferenceHref(noteId);
      if (mode === "source") {
        const textarea = sourceTextareaRef.current;
        const start = Math.max(0, Math.min(sourceSelectionRef.current.start, markdown.length));
        const end = Math.max(start, Math.min(sourceSelectionRef.current.end, markdown.length));
        const link = `[${label}](${href})`;
        onMarkdownChange(`${markdown.slice(0, start)}${link}${markdown.slice(end)}`);
        requestAnimationFrame(() => {
          textarea?.focus();
          textarea?.setSelectionRange(start + link.length, start + link.length);
        });
        return true;
      }

      const editor = richEditorRef.current;
      if (!editor) return false;
      let inserted = false;
      editor.update(() => {
        const current = $getSelection();
        const selection = $isRangeSelection(current) ? current : richSelectionRef.current?.clone() ?? null;
        if (!selection) return;
        if (!$isRangeSelection(current)) $setSelection(selection);
        const link = $createLinkNode(href);
        link.append($createTextNode(label));
        selection.insertNodes([link]);
        inserted = true;
      });
      return inserted;
    },
    readTaskSelection() {
      if (mode === "source") {
        const start = Math.max(0, Math.min(sourceSelectionRef.current.start, markdown.length));
        const end = Math.max(start, Math.min(sourceSelectionRef.current.end, markdown.length));
        return markdown.slice(start, end);
      }
      return taskSelectionRef.current;
    },
  }), [markdown, mode, onMarkdownChange]);

  const transformers = variant === "document" ? WORKBENCH_TRANSFORMERS : CAPTURE_TRANSFORMERS;
  const editorMarkdown = normalizeLegacyMarkdown(markdown);
  const initialConfig = useMemo<InitialConfigType>(() => ({
    namespace: "LeemoCaptureEditor",
    nodes: variant === "document" ? WORKBENCH_MARKDOWN_NODES : [ListNode, ListItemNode, QuoteNode],
    theme: CAPTURE_THEME,
    editable: !disabled,
    editorState: () => $convertFromMarkdownString(editorMarkdown, transformers, undefined, variant === "document"),
    onError(error) {
      throw error;
    },
  }), [editorMarkdown, disabled, transformers, variant]);

  if (mode === "source") {
    return (
      <SourceCaptureEditor
        markdown={editorMarkdown}
        onMarkdownChange={onMarkdownChange}
        onSave={onSave}
        onPasteImage={onPasteImage}
        onDropFiles={onDropFiles}
        onOpenNoteReferenceMenu={onOpenNoteReferenceMenu}
        referenceMenu={referenceMenu}
        onDropNoteReference={onDropNoteReference}
        onTaskSelectionChange={onTaskSelectionChange}
        autoFocus={autoFocus}
        disabled={disabled}
        mode={mode}
        variant={variant}
        textareaRef={sourceTextareaRef}
        onSourceSelectionChange={(start, end) => {
          sourceSelectionRef.current = { start, end };
        }}
      />
    );
  }

  const toolbar = (
    <CaptureToolbar
      disabled={disabled}
      onOpenNoteReferenceMenu={onOpenNoteReferenceMenu}
      referenceMenu={referenceMenu}
      variant={variant}
    />
  );
  const canvas = (
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
  );

  return (
    <div className={`capture-editor capture-editor--${variant}`} data-testid="capture-editor">
      <LexicalComposer initialConfig={initialConfig}>
        {variant === "capture" ? <>{canvas}{toolbar}</> : <>{toolbar}{canvas}</>}
        <CalloutInteractionPlugin />
        <CalloutNormalizationPlugin />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState, _editor, tags) => {
            if (tags.has(CALLOUT_NORMALIZATION_TAG)) return;
            editorState.read(() => {
              const nextMarkdown = $convertToMarkdownString(transformers, undefined, variant === "document");
              onMarkdownChange(nextMarkdown);
            });
          }}
        />
        <ListPlugin />
        <CheckListPlugin />
        <MarkdownDocumentPastePlugin enabled={variant === "document"} />
        <HistoryPlugin />
        {variant === "document" ? <LinkPlugin /> : null}
        {variant === "document" ? <MarkdownShortcutPlugin transformers={transformers} /> : null}
        <TabIndentationPlugin />
        <EditablePlugin disabled={disabled} />
        <CaptureEditorBridge onReady={bindRichEditor} onSelectionChange={captureRichSelection} />
        {autoFocus ? <AutoFocusPlugin /> : null}
      </LexicalComposer>
    </div>
  );
});

CaptureEditor.displayName = "CaptureEditor";

export default CaptureEditor;

export { CAPTURE_TRANSFORMERS };
