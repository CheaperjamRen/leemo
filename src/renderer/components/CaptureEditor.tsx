import { useEffect, useMemo } from "react";
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
import { $createQuoteNode, QuoteNode } from "@lexical/rich-text";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import {
  Bold,
  AtSign,
  List as ListIcon,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react";
import { NOTE_DRAG_MIME, noteIdFromDragPayload } from "../notes/note-references";
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
  },
};

export interface CaptureEditorProps {
  markdown: string;
  onMarkdownChange(markdown: string): void;
  onSave(): void;
  onPasteImage?(file: File): void;
  onDropFiles?(files: File[]): void;
  onOpenNoteReferenceMenu?(): void;
  onDropNoteReference?(noteId: string): void;
  autoFocus?: boolean;
  disabled?: boolean;
}

function CaptureToolbar({
  disabled,
  onOpenNoteReferenceMenu,
}: {
  disabled: boolean;
  onOpenNoteReferenceMenu?: () => void;
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

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

export default function CaptureEditor({
  markdown,
  onMarkdownChange,
  onSave,
  onPasteImage,
  onDropFiles,
  onOpenNoteReferenceMenu,
  onDropNoteReference,
  autoFocus = false,
  disabled = false,
}: CaptureEditorProps) {
  const initialConfig = useMemo<InitialConfigType>(() => ({
    namespace: "LeemoCaptureEditor",
    nodes: [ListNode, ListItemNode, QuoteNode],
    theme: CAPTURE_THEME,
    editable: !disabled,
    editorState: () => $convertFromMarkdownString(markdown, CAPTURE_TRANSFORMERS),
    onError(error) {
      throw error;
    },
  }), [markdown, disabled]);

  return (
    <div className="capture-editor" data-testid="capture-editor">
      <LexicalComposer initialConfig={initialConfig}>
        <CaptureToolbar disabled={disabled} onOpenNoteReferenceMenu={onOpenNoteReferenceMenu} />
        <div className="capture-editor__canvas">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="capture-editor__content"
                aria-label="便签正文"
                spellCheck
                onKeyDown={(event) => {
                  if (event.key === "@" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    onOpenNoteReferenceMenu?.();
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    onSave();
                  }
                }}
                onPaste={(event) => {
                  const image = [...event.clipboardData.files]
                    .find((file) => file.type.startsWith("image/"));
                  if (!image) return;
                  event.preventDefault();
                  onPasteImage?.(image);
                }}
                onDragOver={(event) => {
                  if (
                    event.dataTransfer.files.length > 0
                    || Array.from(event.dataTransfer.types).includes(NOTE_DRAG_MIME)
                  ) event.preventDefault();
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
            }
            placeholder={<p className="capture-editor__placeholder">写下此刻想到的事…</p>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) => {
            editorState.read(() => onMarkdownChange($convertToMarkdownString(CAPTURE_TRANSFORMERS)));
          }}
        />
        <ListPlugin />
        <CheckListPlugin />
        <HistoryPlugin />
        <TabIndentationPlugin />
        <EditablePlugin disabled={disabled} />
        {autoFocus ? <AutoFocusPlugin /> : null}
      </LexicalComposer>
    </div>
  );
}

export { CAPTURE_TRANSFORMERS };
