import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import katex from "katex";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  DecoratorNode,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  type ElementTransformer,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  TRANSFORMERS,
} from "@lexical/markdown";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { $setBlocksType } from "@lexical/selection";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $createCodeNode, CodeNode } from "@lexical/code-core";
import { LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import {
  Bold,
  Check,
  Code2,
  Copy,
  Highlighter,
  Italic,
  Link2,
  List as ListIcon,
  ListChecks,
  ListOrdered,
  Quote,
  Redo2,
  Save,
  Sigma,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import MarkdownContent from "./MarkdownContent";
import type { PreviewDraft } from "../stores/preview-content";
import "katex/dist/katex.min.css";
import "./MarkdownEditor.css";

export type MarkdownFormat = "bold" | "italic" | "heading" | "quote" | "list" | "code";

export interface MarkdownFormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Kept for callers that format a plain Markdown selection outside Lexical. */
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
  if (format === "code") return selected.includes("\n") ? wrap("```\n", "\n```") : wrap("`");

  const prefix = format === "heading" ? "## " : format === "quote" ? "> " : "- ";
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  return {
    text: `${text.slice(0, lineStart)}${lines.map((line) => `${prefix}${line}`).join("\n")}${text.slice(lineEnd)}`,
    selectionStart: start + prefix.length,
    selectionEnd: end + prefix.length * lines.length,
  };
}

type SerializedMathNode = Spread<{
  formula: string;
  inline: boolean;
  type: "workbench-math";
  version: 1;
}, SerializedLexicalNode>;

class MathNode extends DecoratorNode<ReactNode> {
  __formula: string;
  __inline: boolean;

  static getType(): string { return "workbench-math"; }
  static clone(node: MathNode): MathNode { return new MathNode(node.__formula, node.__inline, node.__key); }
  static importJSON(node: SerializedMathNode): MathNode { return new MathNode(node.formula, node.inline); }

  constructor(formula: string, inline: boolean, key?: NodeKey) {
    super(key);
    this.__formula = formula;
    this.__inline = inline;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement(this.__inline ? "span" : "div");
  }

  updateDOM(previous: MathNode): boolean { return previous.__inline !== this.__inline; }
  isInline(): boolean { return this.__inline; }
  getTextContent(): string { return this.__inline ? `$${this.__formula}$` : `$$\n${this.__formula}\n$$`; }
  exportJSON(): SerializedMathNode {
    return { ...super.exportJSON(), formula: this.__formula, inline: this.__inline, type: "workbench-math", version: 1 };
  }

  decorate(): ReactNode {
    let html: string;
    try {
      html = katex.renderToString(this.__formula, { displayMode: !this.__inline, throwOnError: false, strict: "ignore" });
    } catch {
      html = this.__formula;
    }
    const className = this.__inline ? "markdown-editor__math-inline" : "markdown-editor__math-block";
    return <span className={className} data-testid="markdown-editor-math" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  getFormula(): string { return this.getLatest().__formula; }
}

function $createMathNode(formula: string, inline: boolean): MathNode {
  return new MathNode(formula, inline);
}
function $isMathNode(node: LexicalNode | null | undefined): node is MathNode { return node instanceof MathNode; }

type SerializedMermaidNode = Spread<{
  source: string;
  type: "workbench-mermaid";
  version: 1;
}, SerializedLexicalNode>;

class MermaidNode extends DecoratorNode<ReactNode> {
  __source: string;

  static getType(): string { return "workbench-mermaid"; }
  static clone(node: MermaidNode): MermaidNode { return new MermaidNode(node.__source, node.__key); }
  static importJSON(node: SerializedMermaidNode): MermaidNode { return new MermaidNode(node.source); }

  constructor(source: string, key?: NodeKey) {
    super(key);
    this.__source = source;
  }

  createDOM(): HTMLElement { return document.createElement("div"); }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  getTextContent(): string { return `\`\`\`mermaid\n${this.__source}\n\`\`\``; }
  getSource(): string { return this.getLatest().__source; }
  exportJSON(): SerializedMermaidNode {
    return { ...super.exportJSON(), source: this.__source, type: "workbench-mermaid", version: 1 };
  }
  decorate(): ReactNode {
    return (
      <div className="markdown-editor__mermaid" contentEditable={false}>
        <MarkdownContent text={`\`\`\`mermaid\n${this.__source}\n\`\`\``} variant="preview" />
      </div>
    );
  }
}

function $createMermaidNode(source: string): MermaidNode { return new MermaidNode(source); }
function $isMermaidNode(node: LexicalNode | null | undefined): node is MermaidNode { return node instanceof MermaidNode; }

type SerializedGfmTableNode = Spread<{
  source: string;
  type: "workbench-gfm-table";
  version: 1;
}, SerializedLexicalNode>;

class GfmTableNode extends DecoratorNode<ReactNode> {
  __source: string;

  static getType(): string { return "workbench-gfm-table"; }
  static clone(node: GfmTableNode): GfmTableNode { return new GfmTableNode(node.__source, node.__key); }
  static importJSON(node: SerializedGfmTableNode): GfmTableNode { return new GfmTableNode(node.source); }

  constructor(source: string, key?: NodeKey) {
    super(key);
    this.__source = source;
  }

  createDOM(): HTMLElement { return document.createElement("div"); }
  updateDOM(): false { return false; }
  isInline(): false { return false; }
  getTextContent(): string { return this.__source; }
  getSource(): string { return this.getLatest().__source; }
  exportJSON(): SerializedGfmTableNode {
    return { ...super.exportJSON(), source: this.__source, type: "workbench-gfm-table", version: 1 };
  }
  decorate(): ReactNode {
    return (
      <div className="markdown-editor__gfm-table" contentEditable={false}>
        <MarkdownContent text={this.__source} variant="preview" />
      </div>
    );
  }
}

function $createGfmTableNode(source: string): GfmTableNode { return new GfmTableNode(source); }
function $isGfmTableNode(node: LexicalNode | null | undefined): node is GfmTableNode { return node instanceof GfmTableNode; }

const INLINE_MATH_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MathNode],
  export: (node) => $isMathNode(node) && node.isInline() ? `$${node.getFormula()}$` : null,
  importRegExp: /\$([^$\n]+?)\$/,
  regExp: /\$([^$\n]+?)\$$/,
  replace: (textNode, match) => {
    const formula = match[1]?.trim();
    if (formula) textNode.replace($createMathNode(formula, true));
  },
  trigger: "$",
  type: "text-match",
};

const BLOCK_MATH_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [MathNode],
  export: (node) => $isMathNode(node) && !node.isInline() ? `$$\n${node.getFormula()}\n$$` : null,
  regExpStart: /^\$\$\s*$/,
  regExpEnd: /^\$\$\s*$/,
  replace: (rootNode, _children, _start, _end, lines) => {
    rootNode.append($createMathNode((lines ?? []).join("\n").trim(), false));
  },
  type: "multiline-element",
};

const SINGLE_LINE_BLOCK_MATH_TRANSFORMER: ElementTransformer = {
  dependencies: [MathNode],
  export: (node) => $isMathNode(node) && !node.isInline() ? `$$${node.getFormula()}$$` : null,
  regExp: /^\$\$(.+)\$\$\s*$/,
  replace: (parentNode, _children, match) => {
    const formula = match[1]?.trim();
    if (!formula) return false;
    parentNode.replace($createMathNode(formula, false));
  },
  type: "element",
};

const MERMAID_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [MermaidNode],
  export: (node) => $isMermaidNode(node) ? `\`\`\`mermaid\n${node.getSource()}\n\`\`\`` : null,
  regExpStart: /^\s*```mermaid\s*$/i,
  regExpEnd: /^\s*```\s*$/,
  replace: (rootNode, _children, _start, _end, lines) => {
    rootNode.append($createMermaidNode((lines ?? []).join("\n")));
  },
  type: "multiline-element",
};

const GFM_TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const GFM_TABLE_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [GfmTableNode],
  export: (node) => $isGfmTableNode(node) ? node.getSource() : null,
  regExpStart: /^\s*\|?.+\|.+\|?\s*$/,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    if (!GFM_TABLE_DIVIDER.test(lines[startLineIndex + 1] ?? "")) return null;
    let endLineIndex = startLineIndex + 1;
    while (endLineIndex + 1 < lines.length && /\|/.test(lines[endLineIndex + 1]) && lines[endLineIndex + 1].trim()) {
      endLineIndex += 1;
    }
    rootNode.append($createGfmTableNode(lines.slice(startLineIndex, endLineIndex + 1).join("\n")));
    return [true, endLineIndex];
  },
  replace: () => false,
  type: "multiline-element",
};

const WORKBENCH_TRANSFORMERS = [
  GFM_TABLE_TRANSFORMER,
  MERMAID_TRANSFORMER,
  BLOCK_MATH_TRANSFORMER,
  SINGLE_LINE_BLOCK_MATH_TRANSFORMER,
  CHECK_LIST,
  ...TRANSFORMERS,
  INLINE_MATH_TRANSFORMER,
];

const EDITOR_THEME: InitialConfigType["theme"] = {
  paragraph: "markdown-editor__paragraph",
  quote: "markdown-editor__quote",
  heading: {
    h1: "markdown-editor__h1",
    h2: "markdown-editor__h2",
    h3: "markdown-editor__h3",
    h4: "markdown-editor__h4",
    h5: "markdown-editor__h5",
    h6: "markdown-editor__h6",
  },
  list: {
    checklist: "markdown-editor__checklist",
    listitem: "markdown-editor__list-item",
    listitemChecked: "markdown-editor__list-item--checked",
    listitemUnchecked: "markdown-editor__list-item--unchecked",
    nested: { listitem: "markdown-editor__list-item--nested" },
    ol: "markdown-editor__ordered-list",
    ul: "markdown-editor__unordered-list",
  },
  text: {
    bold: "markdown-editor__bold",
    italic: "markdown-editor__italic",
    underline: "markdown-editor__underline",
    strikethrough: "markdown-editor__strikethrough",
    code: "markdown-editor__inline-code",
    highlight: "markdown-editor__highlight",
  },
  code: "markdown-editor__code",
  link: "markdown-editor__link",
};

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="markdown-editor__tool-button"
    >
      {children}
    </button>
  );
}

function EditorToolbar({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState("paragraph");
  const focus = (action: () => void) => editor.focus(action);
  const setBlock = (value: string) => {
    setBlockType(value);
    focus(() => editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      if (value === "paragraph") $setBlocksType(selection, () => $createParagraphNode());
      else $setBlocksType(selection, () => $createHeadingNode(value as HeadingTagType));
    }));
  };
  const format = (kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "highlight") =>
    focus(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, kind));

  return (
    <div className="markdown-editor__toolbar" role="toolbar" aria-label="文档格式">
      <ToolButton label="撤销" disabled={disabled} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 aria-hidden /></ToolButton>
      <ToolButton label="重做" disabled={disabled} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 aria-hidden /></ToolButton>
      <span className="markdown-editor__divider" aria-hidden />
      <select aria-label="段落样式" value={blockType} disabled={disabled} onChange={(event) => setBlock(event.target.value)}>
        <option value="paragraph">正文</option>
        <option value="h1">一级标题</option>
        <option value="h2">二级标题</option>
        <option value="h3">三级标题</option>
      </select>
      <span className="markdown-editor__divider" aria-hidden />
      <ToolButton label="加粗" disabled={disabled} onClick={() => format("bold")}><Bold aria-hidden /></ToolButton>
      <ToolButton label="斜体" disabled={disabled} onClick={() => format("italic")}><Italic aria-hidden /></ToolButton>
      <ToolButton label="下划线" disabled={disabled} onClick={() => format("underline")}><Underline aria-hidden /></ToolButton>
      <ToolButton label="删除线" disabled={disabled} onClick={() => format("strikethrough")}><Strikethrough aria-hidden /></ToolButton>
      <ToolButton label="链接" disabled={disabled} onClick={() => focus(() => {
        const url = window.prompt("链接地址");
        if (url?.trim()) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
      })}><Link2 aria-hidden /></ToolButton>
      <ToolButton label="引用" disabled={disabled} onClick={() => focus(() => editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createQuoteNode());
      }))}><Quote aria-hidden /></ToolButton>
      <span className="markdown-editor__divider" aria-hidden />
      <ToolButton label="无序列表" disabled={disabled} onClick={() => focus(() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined))}><ListIcon aria-hidden /></ToolButton>
      <ToolButton label="序号列表" disabled={disabled} onClick={() => focus(() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined))}><ListOrdered aria-hidden /></ToolButton>
      <ToolButton label="清单" disabled={disabled} onClick={() => focus(() => editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined))}><ListChecks aria-hidden /></ToolButton>
      <ToolButton label="行内代码" disabled={disabled} onClick={() => format("code")}><Code2 aria-hidden /></ToolButton>
      <ToolButton label="代码块" disabled={disabled} onClick={() => focus(() => editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createCodeNode());
      }))}><Code2 aria-hidden /></ToolButton>
      <ToolButton label="插入公式" disabled={disabled} onClick={() => focus(() => editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertNodes([$createMathNode("x", true)]);
      }))}><Sigma aria-hidden /></ToolButton>
      <ToolButton label="高亮" disabled={disabled} onClick={() => format("highlight")}><Highlighter aria-hidden /></ToolButton>
    </div>
  );
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

function MarkdownSyncPlugin({ markdown, lastEmitted }: { markdown: string; lastEmitted: React.MutableRefObject<string | null> }) {
  const [editor] = useLexicalComposerContext();
  const lastApplied = useRef(markdown);
  useEffect(() => {
    if (markdown === lastEmitted.current) {
      lastEmitted.current = null;
      lastApplied.current = markdown;
      return;
    }
    if (markdown === lastApplied.current) return;
    lastApplied.current = markdown;
    editor.update(() => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, WORKBENCH_TRANSFORMERS, undefined, true);
    });
  }, [editor, lastEmitted, markdown]);
  return null;
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
  onChange(text: string): void;
  onSave(): void;
}) {
  const saving = disabled || draft.status === "saving";
  const lastEmitted = useRef<string | null>(null);
  const initialConfig = useMemo<InitialConfigType>(() => ({
    namespace: `LeemoMarkdownEditor:${title}`,
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, CodeNode, LinkNode, MathNode, MermaidNode, GfmTableNode],
    theme: EDITOR_THEME,
    editable: !saving,
    editorState: () => $convertFromMarkdownString(draft.text, WORKBENCH_TRANSFORMERS, undefined, true),
    onError(error) { throw error; },
  // Lexical owns live state; later prop changes are handled without remounting by MarkdownSyncPlugin.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [title]);

  const statusLabel = disabled
    ? "正在切换…"
    : draft.status === "saving"
      ? "保存中…"
      : draft.status === "clean"
        ? "已自动保存"
        : draft.status === "error"
          ? "保存失败"
          : "未保存";
  const characterCount = draft.text.replace(/\s/g, "").length;
  const lineCount = draft.text === "" ? 1 : draft.text.split(/\r\n|\r|\n/).length;

  return (
    <div className="markdown-editor" data-testid="markdown-editor">
      <LexicalComposer initialConfig={initialConfig}>
        <div className="markdown-editor__topline">
          <EditorToolbar disabled={saving} />
          <span className={`markdown-editor__save-state markdown-editor__save-state--${draft.status}`}>{statusLabel}</span>
          <button
            type="button"
            aria-label="保存"
            title="保存 (Ctrl+S)"
            disabled={saving || draft.status === "clean"}
            onClick={onSave}
            className="markdown-editor__save-button"
          >
            {draft.status === "clean" ? <Check aria-hidden /> : <Save aria-hidden />}
          </button>
        </div>
        <div className="markdown-editor__canvas">
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                className="markdown-editor__content"
                aria-label={`编辑 ${title}`}
                aria-disabled={saving}
                spellCheck
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    if (!saving && draft.status !== "clean") onSave();
                  }
                }}
              />
            )}
            placeholder={<p className="markdown-editor__placeholder">开始写作…</p>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) => editorState.read(() => {
            const markdown = $convertToMarkdownString(WORKBENCH_TRANSFORMERS, undefined, true);
            lastEmitted.current = markdown;
            onChange(markdown);
          })}
        />
        <MarkdownSyncPlugin markdown={draft.text} lastEmitted={lastEmitted} />
        <HistoryPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={WORKBENCH_TRANSFORMERS} />
        <TabIndentationPlugin />
        <EditablePlugin disabled={saving} />
      </LexicalComposer>
      <div className="markdown-editor__status" data-testid="markdown-editor-status">
        <span>本地文件</span>
        <span>{statusLabel} · {characterCount} 字 · {lineCount} 行</span>
      </div>
      {draft.error && (
        <div className="markdown-editor__error" role="alert">
          <p>{draft.error}</p>
          <button type="button" aria-label="复制草稿" title="复制草稿" onClick={() => void navigator.clipboard?.writeText(draft.text)}>
            <Copy aria-hidden />
            复制草稿
          </button>
        </div>
      )}
    </div>
  );
}
