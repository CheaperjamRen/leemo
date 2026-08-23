import {
  $getNodeByKey,
  DecoratorNode,
  HISTORY_PUSH_TAG,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { MultilineElementTransformer } from "@lexical/markdown";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Eraser,
  GripHorizontal,
  GripVertical,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type TableAlignment = "left" | "center" | "right";

export interface ParsedGfmTable {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
  columnWidths?: number[];
}

type TableAxisSelection =
  | { kind: "row"; start: number; end: number }
  | { kind: "column"; start: number; end: number }
  | { kind: "table"; start: 0; end: 0 };

type TableCellSelection = {
  kind: "cells";
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type TableSelection = TableAxisSelection | TableCellSelection;

const TABLE_WIDTH_METADATA = /^<!--\s*leemo-table:\s*widths=([\d.,\s]+)\s*-->$/iu;
const MIN_COLUMN_WIDTH = 80;
const DEFAULT_COLUMN_WIDTH = 160;
const INPUT_COMMIT_DELAY_MS = 120;

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = body.endsWith("|") && !body.endsWith("\\|") ? body.slice(0, -1) : body;
  const cells: string[] = [];
  let current = "";

  for (let index = 0; index < withoutEnd.length; index += 1) {
    const char = withoutEnd[index];
    if (char === "\\") {
      const next = withoutEnd[index + 1];
      if (next === "|" || next === "\\") {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeWidths(raw: string | undefined, columnCount: number): number[] | undefined {
  if (!raw) return undefined;
  const widths = raw.split(",").map((value) => Number.parseInt(value.trim(), 10));
  if (widths.length !== columnCount || widths.some((value) => !Number.isFinite(value) || value < MIN_COLUMN_WIDTH)) return undefined;
  return widths;
}

export function parseGfmTable(source: string): ParsedGfmTable {
  const lines = source.trim().split(/\r?\n/u);
  const metadataMatch = TABLE_WIDTH_METADATA.exec(lines.at(-1) ?? "");
  if (metadataMatch) lines.pop();
  const headers = parseTableRow(lines[0] ?? "| 列 1 | 列 2 |");
  const safeHeaders = headers.length > 0 ? headers : ["列 1"];
  const divider = parseTableRow(lines[1] ?? safeHeaders.map(() => "---").join(" | "));
  const alignments = safeHeaders.map((_, index): TableAlignment => {
    const token = divider[index] ?? "---";
    return token.startsWith(":") && token.endsWith(":") ? "center" : token.endsWith(":") ? "right" : "left";
  });
  const rows = lines.slice(2).map(parseTableRow).map((row) => safeHeaders.map((_, index) => row[index] ?? ""));
  return {
    headers: safeHeaders,
    alignments,
    rows: rows.length > 0 ? rows : [safeHeaders.map(() => "")],
    columnWidths: normalizeWidths(metadataMatch?.[1], safeHeaders.length),
  };
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|").replace(/\r?\n/gu, "<br>");
}

export function serializeGfmTable(table: ParsedGfmTable): string {
  const row = (cells: string[]) => `| ${cells.map(escapeTableCell).join(" | ")} |`;
  const divider = table.alignments.map((alignment) => alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---");
  const lines = [row(table.headers), row(divider), ...table.rows.map(row)];
  if (table.columnWidths?.length === table.headers.length) {
    lines.push(`<!-- leemo-table: widths=${table.columnWidths.map((width) => Math.round(width)).join(",")} -->`);
  }
  return lines.join("\n");
}

function blankRow(columnCount: number): string[] {
  return Array.from({ length: columnCount }, () => "");
}

function normalizedRange(start: number, end: number, maximum: number): [number, number] {
  const low = Math.max(0, Math.min(start, end, maximum));
  const high = Math.max(low, Math.min(Math.max(start, end), maximum));
  return [low, high];
}

export function insertTableRows(table: ParsedGfmTable, rawStart: number, rawEnd: number, direction: "above" | "below"): ParsedGfmTable {
  const [start, end] = normalizedRange(rawStart, rawEnd, table.rows.length - 1);
  const count = end - start + 1;
  const insertionIndex = direction === "above" ? start : end + 1;
  const additions = Array.from({ length: count }, () => blankRow(table.headers.length));
  return { ...table, rows: [...table.rows.slice(0, insertionIndex), ...additions, ...table.rows.slice(insertionIndex)] };
}

export function deleteTableRows(table: ParsedGfmTable, rawStart: number, rawEnd: number): ParsedGfmTable {
  const [start, end] = normalizedRange(rawStart, rawEnd, table.rows.length - 1);
  const rows = table.rows.filter((_, index) => index < start || index > end);
  return { ...table, rows: rows.length > 0 ? rows : [blankRow(table.headers.length)] };
}

export function insertTableColumns(table: ParsedGfmTable, rawStart: number, rawEnd: number, direction: "left" | "right"): ParsedGfmTable {
  const [start, end] = normalizedRange(rawStart, rawEnd, table.headers.length - 1);
  const count = end - start + 1;
  const insertionIndex = direction === "left" ? start : end + 1;
  const newHeaders = Array.from({ length: count }, (_, index) => `列 ${table.headers.length + index + 1}`);
  const insert = <T,>(values: T[], additions: T[]): T[] => [...values.slice(0, insertionIndex), ...additions, ...values.slice(insertionIndex)];
  return {
    headers: insert(table.headers, newHeaders),
    alignments: insert(table.alignments, Array.from({ length: count }, (): TableAlignment => "left")),
    rows: table.rows.map((row) => insert(row, Array.from({ length: count }, () => ""))),
    columnWidths: table.columnWidths
      ? insert(table.columnWidths, Array.from({ length: count }, () => DEFAULT_COLUMN_WIDTH))
      : undefined,
  };
}

export function deleteTableColumns(table: ParsedGfmTable, rawStart: number, rawEnd: number): ParsedGfmTable {
  const [start, end] = normalizedRange(rawStart, rawEnd, table.headers.length - 1);
  const keep = (_: unknown, index: number) => index < start || index > end;
  let headers = table.headers.filter(keep);
  let alignments = table.alignments.filter(keep);
  let rows = table.rows.map((row) => row.filter(keep));
  let columnWidths = table.columnWidths?.filter(keep);
  if (headers.length === 0) {
    headers = ["列 1"];
    alignments = ["left"];
    rows = table.rows.map(() => [""]);
    columnWidths = table.columnWidths ? [DEFAULT_COLUMN_WIDTH] : undefined;
  }
  return { headers, alignments, rows, columnWidths };
}

function parseTsv(value: string): string[][] {
  return value.replace(/\r\n?/gu, "\n").split("\n").filter((line, index, lines) => line.length > 0 || index < lines.length - 1).map((line) => line.split("\t"));
}

export function pasteTableMatrix(table: ParsedGfmTable, rawGridRow: number, rawColumn: number, clipboardText: string): ParsedGfmTable {
  const matrix = parseTsv(clipboardText);
  if (matrix.length === 0) return table;
  const startRow = Math.max(0, rawGridRow);
  const startColumn = Math.max(0, rawColumn);
  const requiredColumns = startColumn + Math.max(...matrix.map((row) => row.length));
  let next = table;
  if (requiredColumns > next.headers.length) {
    const missing = requiredColumns - next.headers.length;
    next = {
      headers: [...next.headers, ...Array.from({ length: missing }, (_, index) => `列 ${next.headers.length + index + 1}`)],
      alignments: [...next.alignments, ...Array.from({ length: missing }, (): TableAlignment => "left")],
      rows: next.rows.map((row) => [...row, ...Array.from({ length: missing }, () => "")]),
      columnWidths: next.columnWidths
        ? [...next.columnWidths, ...Array.from({ length: missing }, () => DEFAULT_COLUMN_WIDTH)]
        : undefined,
    };
  }
  const requiredBodyRows = Math.max(0, startRow + matrix.length - 1);
  if (requiredBodyRows > next.rows.length) {
    const missing = requiredBodyRows - next.rows.length;
    const additions = Array.from({ length: missing }, () => blankRow(next.headers.length));
    next = { ...next, rows: [...next.rows, ...additions] };
  }

  const headers = [...next.headers];
  const rows = next.rows.map((row) => [...row]);
  matrix.forEach((matrixRow, rowOffset) => {
    const targetGridRow = startRow + rowOffset;
    matrixRow.forEach((value, columnOffset) => {
      const targetColumn = startColumn + columnOffset;
      if (targetGridRow === 0) headers[targetColumn] = value;
      else rows[targetGridRow - 1][targetColumn] = value;
    });
  });
  return { ...next, headers, rows };
}

export function resizeTableColumns(widths: number[], boundaryIndex: number, delta: number): number[] {
  const next = widths.map((width) => Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
  if (boundaryIndex < 0 || boundaryIndex >= next.length) return next;
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  if (boundaryIndex === next.length - 1) {
    next[boundaryIndex] = Math.max(MIN_COLUMN_WIDTH, Math.round(next[boundaryIndex] + safeDelta));
    return next;
  }
  const total = next[boundaryIndex] + next[boundaryIndex + 1];
  const current = Math.max(MIN_COLUMN_WIDTH, Math.min(total - MIN_COLUMN_WIDTH, Math.round(next[boundaryIndex] + safeDelta)));
  next[boundaryIndex] = current;
  next[boundaryIndex + 1] = total - current;
  return next;
}

interface TableToolRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function positionTableTools({
  anchor,
  container,
  toolbar,
  viewport,
  avoidAboveUntil,
}: {
  anchor: TableToolRect;
  container: TableToolRect;
  toolbar: TableToolRect;
  viewport: TableToolRect;
  /** Content such as a table header that the floating strip must not cover. */
  avoidAboveUntil?: number;
}): { left: number; placement: "above" | "below"; top: number } {
  const gutter = 6;
  const toolbarWidth = Math.min(toolbar.width, Math.max(0, container.width - gutter * 2));
  const centered = (anchor.left + anchor.right) / 2 - container.left - toolbarWidth / 2;
  const left = Math.round(Math.max(gutter, Math.min(container.width - toolbarWidth - gutter, centered)));
  const usableTop = Math.max(viewport.top, avoidAboveUntil ?? viewport.top);
  const spaceAbove = anchor.top - usableTop;
  const spaceBelow = viewport.bottom - anchor.bottom;
  const placement = spaceAbove >= toolbar.height + gutter * 2 || spaceAbove >= spaceBelow ? "above" : "below";
  const top = Math.round(placement === "above"
    ? anchor.top - container.top - toolbar.height - gutter
    : anchor.bottom - container.top + gutter);
  return { left, placement, top };
}

function tableGrid(table: ParsedGfmTable): string[][] {
  return [table.headers, ...table.rows];
}

function selectionMatrix(table: ParsedGfmTable, selection: TableSelection): string[][] {
  const grid = tableGrid(table);
  if (selection.kind === "table") return grid;
  if (selection.kind === "cells") {
    const [startRow, endRow] = normalizedRange(selection.startRow, selection.endRow, grid.length - 1);
    const [startColumn, endColumn] = normalizedRange(selection.startColumn, selection.endColumn, table.headers.length - 1);
    return grid.slice(startRow, endRow + 1).map((row) => row.slice(startColumn, endColumn + 1));
  }
  if (selection.kind === "row") {
    const [start, end] = normalizedRange(selection.start, selection.end, table.rows.length - 1);
    return table.rows.slice(start, end + 1);
  }
  const [start, end] = normalizedRange(selection.start, selection.end, table.headers.length - 1);
  return grid.map((row) => row.slice(start, end + 1));
}

function matrixToTsv(matrix: string[][]): string {
  return matrix.map((row) => row.join("\t")).join("\n");
}

interface GfmTableCellProps {
  alignment: TableAlignment;
  column: number;
  editable: boolean;
  gridRow: number;
  header: boolean;
  label: string;
  selected: boolean;
  value: string;
  onBlur(): void;
  onChange(gridRow: number, column: number, value: string): void;
  onFocus(gridRow: number, column: number): void;
  onKeyDown(event: KeyboardEvent<HTMLInputElement>, gridRow: number, column: number): void;
  onPaste(event: ClipboardEvent<HTMLInputElement>, gridRow: number, column: number): void;
  onPointerDown(event: ReactPointerEvent<HTMLInputElement>, gridRow: number, column: number): void;
  onPointerEnter(event: ReactPointerEvent<HTMLInputElement>, gridRow: number, column: number): void;
}

const GfmTableCell = memo(function GfmTableCell({
  alignment,
  column,
  editable,
  gridRow,
  header,
  label,
  selected,
  value,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  onPaste,
  onPointerDown,
  onPointerEnter,
}: GfmTableCellProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const input = (
    <input
      data-table-cell={`${gridRow}:${column}`}
      aria-label={label}
      value={draft}
      disabled={!editable}
      onFocus={() => onFocus(gridRow, column)}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setDraft(next);
        onChange(gridRow, column, next);
      }}
      onBlur={onBlur}
      onKeyDown={(event) => onKeyDown(event, gridRow, column)}
      onPaste={(event) => onPaste(event, gridRow, column)}
      onPointerDown={(event) => onPointerDown(event, gridRow, column)}
      onPointerEnter={(event) => onPointerEnter(event, gridRow, column)}
    />
  );
  if (header) {
    return <th aria-selected={selected} className={`markdown-editor__table-data-header${selected ? " is-selected" : ""}`} style={{ textAlign: alignment }}>{input}</th>;
  }
  return <td aria-selected={selected} className={selected ? "is-selected" : ""} style={{ textAlign: alignment }}>{input}</td>;
});

function clearSelection(table: ParsedGfmTable, selection: TableSelection): ParsedGfmTable {
  if (selection.kind === "table") return { ...table, headers: table.headers.map(() => ""), rows: table.rows.map((row) => row.map(() => "")) };
  if (selection.kind === "cells") {
    const [startRow, endRow] = normalizedRange(selection.startRow, selection.endRow, table.rows.length);
    const [startColumn, endColumn] = normalizedRange(selection.startColumn, selection.endColumn, table.headers.length - 1);
    return {
      ...table,
      headers: table.headers.map((value, column) => startRow === 0 && column >= startColumn && column <= endColumn ? "" : value),
      rows: table.rows.map((row, rowIndex) => row.map((value, column) => rowIndex + 1 >= Math.max(1, startRow)
        && rowIndex + 1 <= endRow
        && column >= startColumn
        && column <= endColumn ? "" : value)),
    };
  }
  if (selection.kind === "row") {
    const [start, end] = normalizedRange(selection.start, selection.end, table.rows.length - 1);
    return { ...table, rows: table.rows.map((row, index) => index >= start && index <= end ? row.map(() => "") : row) };
  }
  const [start, end] = normalizedRange(selection.start, selection.end, table.headers.length - 1);
  return {
    ...table,
    headers: table.headers.map((value, index) => index >= start && index <= end ? "" : value),
    rows: table.rows.map((row) => row.map((value, index) => index >= start && index <= end ? "" : value)),
  };
}

function toggleMarkdownBold(value: string): string {
  const match = /^(\s*)(.*?)(\s*)$/su.exec(value);
  const leading = match?.[1] ?? "";
  const body = match?.[2] ?? value;
  const trailing = match?.[3] ?? "";
  if (!body) return value;
  return body.startsWith("**") && body.endsWith("**") && body.length >= 4
    ? `${leading}${body.slice(2, -2)}${trailing}`
    : `${leading}**${body}**${trailing}`;
}

function boldCellSelection(table: ParsedGfmTable, selection: TableCellSelection): ParsedGfmTable {
  const [startRow, endRow] = normalizedRange(selection.startRow, selection.endRow, table.rows.length);
  const [startColumn, endColumn] = normalizedRange(selection.startColumn, selection.endColumn, table.headers.length - 1);
  return {
    ...table,
    headers: table.headers.map((value, column) => startRow === 0 && column >= startColumn && column <= endColumn ? toggleMarkdownBold(value) : value),
    rows: table.rows.map((row, rowIndex) => row.map((value, column) => rowIndex + 1 >= Math.max(1, startRow)
      && rowIndex + 1 <= endRow
      && column >= startColumn
      && column <= endColumn ? toggleMarkdownBold(value) : value)),
  };
}

type SerializedGfmTableNode = Spread<{
  source: string;
  type: "workbench-gfm-table";
  version: 1;
}, SerializedLexicalNode>;

export class GfmTableNode extends DecoratorNode<ReactNode> {
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
  setSource(source: string): void { this.getWritable().__source = source; }
  exportJSON(): SerializedGfmTableNode {
    return { ...super.exportJSON(), source: this.__source, type: "workbench-gfm-table", version: 1 };
  }
  decorate(): ReactNode {
    return <GfmTableEditor nodeKey={this.getKey()} source={this.getSource()} />;
  }
}

export const DEFAULT_GFM_TABLE = "| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n|  |  |";
export function $createGfmTableNode(source = DEFAULT_GFM_TABLE): GfmTableNode { return new GfmTableNode(source); }
export function $isGfmTableNode(node: LexicalNode | null | undefined): node is GfmTableNode { return node instanceof GfmTableNode; }

function GfmTableEditor({ nodeKey, source }: { nodeKey: NodeKey; source: string }) {
  const [editor] = useLexicalComposerContext();
  const [table, setTable] = useState(() => parseGfmTable(source));
  const [selection, setSelection] = useState<TableSelection | null>(null);
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [editable, setEditable] = useState(() => editor.isEditable());
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const [toolPosition, setToolPosition] = useState<{ left: number; placement: "above" | "below"; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const latestTableRef = useRef(table);
  const lastCommittedSourceRef = useRef(source);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionAnchorRef = useRef<{ kind: "row" | "column"; index: number } | null>(null);
  const cellDragAnchorRef = useRef<{ row: number; column: number } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => editor.registerEditableListener(setEditable), [editor]);

  const commitNow = useCallback((next: ParsedGfmTable) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    const serialized = serializeGfmTable(next);
    lastCommittedSourceRef.current = serialized;
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isGfmTableNode(node)) node.setSource(serialized);
    });
  }, [editor, nodeKey]);

  const scheduleCommit = useCallback((next: ParsedGfmTable) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      setTable(next);
      commitNow(next);
    }, INPUT_COMMIT_DELAY_MS);
  }, [commitNow]);

  const replaceTable = useCallback((next: ParsedGfmTable, immediate = true) => {
    latestTableRef.current = next;
    if (immediate) {
      setTable(next);
      commitNow(next);
    } else {
      scheduleCommit(next);
    }
  }, [commitNow, scheduleCommit]);

  useEffect(() => {
    if (source !== lastCommittedSourceRef.current) {
      const next = parseGfmTable(source);
      latestTableRef.current = next;
      setTable(next);
      lastCommittedSourceRef.current = source;
    }
  }, [source]);

  useEffect(() => () => {
    if (!commitTimerRef.current) return;
    clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    commitNow(latestTableRef.current);
  }, [commitNow]);

  useEffect(() => {
    const scroll = tableScrollRef.current;
    if (!scroll) return;
    const check = () => setHasHorizontalOverflow(scroll.scrollWidth - scroll.clientWidth > 8);
    check();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", check);
      return () => window.removeEventListener("resize", check);
    }
    const observer = new ResizeObserver(check);
    observer.observe(scroll);
    if (tableRef.current) observer.observe(tableRef.current);
    return () => observer.disconnect();
  }, [table.columnWidths, table.headers.length, table.rows.length]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const toolbar = toolbarRef.current;
    if (!container || !toolbar || !selection) {
      setToolPosition(null);
      return;
    }
    const handleSelector = selection.kind === "column"
      ? ".markdown-editor__table-column-handle button[aria-pressed='true']"
      : selection.kind === "row"
        ? ".markdown-editor__table-row-handle button[aria-pressed='true']"
        : selection.kind === "cells"
          ? ".markdown-editor__table-data-header.is-selected, .markdown-editor__gfm-table td.is-selected"
          : ".markdown-editor__table-corner button[aria-pressed='true']";
    const update = () => {
      const handles = [...container.querySelectorAll<HTMLElement>(handleSelector)];
      if (handles.length === 0) return;
      const first = handles[0].getBoundingClientRect();
      const anchor: TableToolRect = {
        left: first.left,
        right: first.right,
        top: first.top,
        bottom: first.bottom,
        width: first.width,
        height: first.height,
      };
      for (const handle of handles.slice(1)) {
        const rect = handle.getBoundingClientRect();
        anchor.left = Math.min(anchor.left, rect.left);
        anchor.right = Math.max(anchor.right, rect.right);
        anchor.top = Math.min(anchor.top, rect.top);
        anchor.bottom = Math.max(anchor.bottom, rect.bottom);
        anchor.width = anchor.right - anchor.left;
        anchor.height = anchor.bottom - anchor.top;
      }
      const containerRect = container.getBoundingClientRect();
      const documentScroll = container.closest<HTMLElement>(".leemo-document-scroll");
      const viewport = documentScroll?.getBoundingClientRect() ?? {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const avoidAboveUntil = selection.kind === "cells"
        ? tableRef.current?.tHead?.getBoundingClientRect().bottom
        : undefined;
      const next = positionTableTools({
        anchor,
        container: containerRect,
        toolbar: toolbar.getBoundingClientRect(),
        viewport,
        avoidAboveUntil,
      });
      setToolPosition((current) => current && current.left === next.left && current.top === next.top && current.placement === next.placement ? current : next);
    };
    const frame = window.requestAnimationFrame(update);
    const tableScroll = tableScrollRef.current;
    const documentScroll = container.closest<HTMLElement>(".leemo-document-scroll");
    tableScroll?.addEventListener("scroll", update, { passive: true });
    documentScroll?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    observer?.observe(toolbar);
    if (tableRef.current) observer?.observe(tableRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      tableScroll?.removeEventListener("scroll", update);
      documentScroll?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [selection, table]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    const finishCellDrag = () => { cellDragAnchorRef.current = null; };
    window.addEventListener("pointerup", finishCellDrag);
    window.addEventListener("pointercancel", finishCellDrag);
    return () => {
      window.removeEventListener("pointerup", finishCellDrag);
      window.removeEventListener("pointercancel", finishCellDrag);
    };
  }, []);

  const selectAxis = (kind: "row" | "column", index: number, extend: boolean): void => {
    const anchor = selectionAnchorRef.current;
    if (extend && anchor?.kind === kind) {
      setSelection({ kind, start: anchor.index, end: index });
      return;
    }
    selectionAnchorRef.current = { kind, index };
    setSelection({ kind, start: index, end: index });
  };

  const isSelected = (gridRow: number, column: number): boolean => {
    if (!selection) return false;
    if (selection.kind === "table") return true;
    if (selection.kind === "cells") {
      const [startRow, endRow] = normalizedRange(selection.startRow, selection.endRow, table.rows.length);
      const [startColumn, endColumn] = normalizedRange(selection.startColumn, selection.endColumn, table.headers.length - 1);
      return gridRow >= startRow && gridRow <= endRow && column >= startColumn && column <= endColumn;
    }
    if (selection.kind === "column") {
      const [start, end] = normalizedRange(selection.start, selection.end, table.headers.length - 1);
      return column >= start && column <= end;
    }
    if (gridRow === 0) return false;
    const [start, end] = normalizedRange(selection.start, selection.end, table.rows.length - 1);
    return gridRow - 1 >= start && gridRow - 1 <= end;
  };

  const focusCell = useCallback((gridRow: number, column: number): void => {
    requestAnimationFrame(() => {
      const input = tableRef.current?.querySelector<HTMLInputElement>(`[data-table-cell="${gridRow}:${column}"]`);
      input?.focus();
      input?.select();
    });
  }, []);

  const updateCell = useCallback((gridRow: number, column: number, value: string): void => {
    const currentTable = latestTableRef.current;
    const next = gridRow === 0
      ? { ...currentTable, headers: currentTable.headers.map((cell, index) => index === column ? value : cell) }
      : {
          ...currentTable,
          rows: currentTable.rows.map((row, rowIndex) => rowIndex === gridRow - 1
            ? row.map((cell, columnIndex) => columnIndex === column ? value : cell)
            : row),
        };
    replaceTable(next, false);
  }, [replaceTable]);

  const handleTab = useCallback((event: KeyboardEvent<HTMLInputElement>, gridRow: number, column: number): void => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
      setSelection(null);
      return;
    }
    if (event.key !== "Tab") return;
    const currentTable = latestTableRef.current;
    const columnCount = currentTable.headers.length;
    const totalGridRows = currentTable.rows.length + 1;
    const current = gridRow * columnCount + column;
    if (event.shiftKey && current === 0) return;
    event.preventDefault();
    if (!event.shiftKey && current === totalGridRows * columnCount - 1) {
      const next = { ...currentTable, rows: [...currentTable.rows, blankRow(columnCount)] };
      replaceTable(next);
      focusCell(totalGridRows, 0);
      return;
    }
    const nextIndex = current + (event.shiftKey ? -1 : 1);
    focusCell(Math.floor(nextIndex / columnCount), nextIndex % columnCount);
  }, [focusCell, replaceTable]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLInputElement>, gridRow: number, column: number): void => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !/[\r\n]/u.test(text)) return;
    event.preventDefault();
    const next = pasteTableMatrix(latestTableRef.current, gridRow, column, text);
    replaceTable(next);
    focusCell(gridRow, column);
  }, [focusCell, replaceTable]);

  const focusTableCell = useCallback((row: number, column: number): void => {
    setActiveCell({ row, column });
    setCopyState("idle");
  }, []);

  const startCellDrag = useCallback((event: ReactPointerEvent<HTMLInputElement>, row: number, column: number): void => {
    if (event.button !== 0 || !editable) return;
    cellDragAnchorRef.current = { row, column };
    if (selection?.kind === "cells") setSelection(null);
  }, [editable, selection?.kind]);

  const extendCellDrag = useCallback((event: ReactPointerEvent<HTMLInputElement>, row: number, column: number): void => {
    const anchor = cellDragAnchorRef.current;
    if (!anchor || (event.buttons & 1) !== 1 || (anchor.row === row && anchor.column === column)) return;
    event.preventDefault();
    setSelection({
      kind: "cells",
      startRow: anchor.row,
      endRow: row,
      startColumn: anchor.column,
      endColumn: column,
    });
  }, []);

  const flushTable = useCallback(() => {
    setTable(latestTableRef.current);
    commitNow(latestTableRef.current);
  }, [commitNow]);

  const copySelection = async (): Promise<void> => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(matrixToTsv(selectionMatrix(latestTableRef.current, selection)));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
    }
  };

  const pasteIntoSelection = async (): Promise<void> => {
    if (!selection || selection.kind !== "cells") return;
    try {
      const text = await navigator.clipboard.readText();
      const startRow = Math.min(selection.startRow, selection.endRow);
      const startColumn = Math.min(selection.startColumn, selection.endColumn);
      replaceTable(pasteTableMatrix(latestTableRef.current, startRow, startColumn, text));
      setCopyState("idle");
    } catch {
      setCopyState("failed");
    }
  };

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>, boundaryIndex: number): void => {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const measured = [...(tableRef.current?.querySelectorAll<HTMLElement>(".markdown-editor__table-data-header") ?? [])]
      .map((element) => Math.max(MIN_COLUMN_WIDTH, Math.round(element.getBoundingClientRect().width)));
    const initial = table.columnWidths?.length === table.headers.length
      ? [...table.columnWidths]
      : table.headers.map((_, index) => measured[index] ?? DEFAULT_COLUMN_WIDTH);
    const startX = event.clientX;
    let latest = initial;
    resizeCleanupRef.current?.();
    const move = (pointerEvent: PointerEvent) => {
      latest = resizeTableColumns(initial, boundaryIndex, pointerEvent.clientX - startX);
      const next = { ...latestTableRef.current, columnWidths: latest };
      latestTableRef.current = next;
      setTable(next);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      resizeCleanupRef.current = null;
    };
    const up = () => {
      cleanup();
      replaceTable({ ...latestTableRef.current, columnWidths: latest });
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
  };

  const selectionLabel = selection?.kind === "row"
    ? `第 ${Math.min(selection.start, selection.end) + 1}${selection.start === selection.end ? "" : `–${Math.max(selection.start, selection.end) + 1}`} 行`
    : selection?.kind === "column"
      ? `第 ${Math.min(selection.start, selection.end) + 1}${selection.start === selection.end ? "" : `–${Math.max(selection.start, selection.end) + 1}`} 列`
      : selection?.kind === "cells"
        ? `${Math.abs(selection.endRow - selection.startRow) + 1} × ${Math.abs(selection.endColumn - selection.startColumn) + 1} 单元格`
        : selection?.kind === "table" ? "整张表格" : "";

  const applySelectionAction = (action: string): void => {
    if (!selection) return;
    const currentTable = latestTableRef.current;
    if (selection.kind === "cells") {
      if (action === "bold") replaceTable(boldCellSelection(currentTable, selection));
    } else if (selection.kind === "row") {
      if (action === "before") replaceTable(insertTableRows(currentTable, selection.start, selection.end, "above"));
      if (action === "after") replaceTable(insertTableRows(currentTable, selection.start, selection.end, "below"));
      if (action === "delete") {
        const next = deleteTableRows(currentTable, selection.start, selection.end);
        replaceTable(next);
        const nextIndex = Math.min(Math.min(selection.start, selection.end), next.rows.length - 1);
        selectionAnchorRef.current = { kind: "row", index: nextIndex };
        setSelection({ kind: "row", start: nextIndex, end: nextIndex });
      }
    } else if (selection.kind === "column") {
      if (action === "before") replaceTable(insertTableColumns(currentTable, selection.start, selection.end, "left"));
      if (action === "after") replaceTable(insertTableColumns(currentTable, selection.start, selection.end, "right"));
      if (action === "delete") {
        const next = deleteTableColumns(currentTable, selection.start, selection.end);
        replaceTable(next);
        const nextIndex = Math.min(Math.min(selection.start, selection.end), next.headers.length - 1);
        selectionAnchorRef.current = { kind: "column", index: nextIndex };
        setSelection({ kind: "column", start: nextIndex, end: nextIndex });
      }
      if (action === "align") {
        const [start, end] = normalizedRange(selection.start, selection.end, table.headers.length - 1);
        const nextAlignment: Record<TableAlignment, TableAlignment> = { left: "center", center: "right", right: "left" };
        replaceTable({ ...currentTable, alignments: currentTable.alignments.map((value, index) => index >= start && index <= end ? nextAlignment[value] : value) });
      }
      if (action === "distribute") replaceTable({ ...currentTable, columnWidths: undefined });
    }
    if (action === "clear") replaceTable(clearSelection(currentTable, selection));
  };

  const removeTable = (): void => {
    if (!editable) return;
    let removed = false;
    const performRemoval = () => {
      if (removed) return;
      removed = true;
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isGfmTableNode(node)) node.remove();
      }, { tag: HISTORY_PUSH_TAG });
    };
    // A newly opened document can have an empty history state until its first
    // Lexical selection exists. Focus once before the destructive update so
    // that this very first action is undoable too.
    editor.focus(performRemoval, { defaultSelection: "rootEnd" });
    window.setTimeout(performRemoval, 0);
  };

  const widths = table.columnWidths;
  const tableStyle: CSSProperties = widths
    ? { width: `${Math.max(420, 20 + widths.reduce((sum, width) => sum + width, 0))}px` }
    : {};

  return (
    <div
      ref={containerRef}
      className="markdown-editor__gfm-table"
      contentEditable={false}
      data-compact-fit={table.headers.length <= 3 ? "true" : "false"}
      data-selection-kind={selection?.kind ?? "none"}
      onKeyDownCapture={(event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c" || !selection) return;
        const target = event.target as HTMLInputElement;
        if (target instanceof HTMLInputElement && target.selectionStart !== target.selectionEnd) return;
        event.preventDefault();
        void copySelection();
      }}
    >
      {selection ? (
        <div
          ref={toolbarRef}
          className="markdown-editor__table-tools"
          role="toolbar"
          aria-label="表格工具"
          data-placement={toolPosition?.placement ?? "above"}
          style={toolPosition ? {
            "--table-tools-left": `${toolPosition.left}px`,
            "--table-tools-top": `${toolPosition.top}px`,
          } as CSSProperties : undefined}
        >
          <span className="markdown-editor__table-selection-label">{selectionLabel}</span>
          {selection.kind === "row" || selection.kind === "column" ? (
            <>
              <button type="button" aria-label={selection.kind === "row" ? "在上方插入行" : "在左侧插入列"} title={selection.kind === "row" ? "在上方插入行" : "在左侧插入列"} disabled={!editable} onClick={() => applySelectionAction("before")}>
                <TableStructureIcon kind={selection.kind === "row" ? "insert-row-above" : "insert-column-left"} /><span>前插</span>
              </button>
              <button type="button" aria-label={selection.kind === "row" ? "在下方插入行" : "在右侧插入列"} title={selection.kind === "row" ? "在下方插入行" : "在右侧插入列"} disabled={!editable} onClick={() => applySelectionAction("after")}>
                <TableStructureIcon kind={selection.kind === "row" ? "insert-row-below" : "insert-column-right"} /><span>后插</span>
              </button>
            </>
          ) : null}
          {selection.kind === "column" ? (
            <>
              <button type="button" aria-label="切换所选列对齐" title="左对齐 / 居中 / 右对齐" disabled={!editable} onClick={() => applySelectionAction("align")}>
                {table.alignments[Math.min(selection.start, selection.end)] === "center" ? <AlignCenter aria-hidden /> : table.alignments[Math.min(selection.start, selection.end)] === "right" ? <AlignRight aria-hidden /> : <AlignLeft aria-hidden />}<span>对齐</span>
              </button>
              <button type="button" aria-label="恢复等宽列" title="恢复等宽列" disabled={!editable} onClick={() => applySelectionAction("distribute")}><TableStructureIcon kind="equal-columns" /><span>等宽</span></button>
            </>
          ) : null}
          {selection.kind === "cells" ? (
            <>
              <button type="button" aria-label="粘贴到所选单元格" title="从剪贴板粘贴" disabled={!editable} onClick={() => void pasteIntoSelection()}><ClipboardPaste aria-hidden /><span>粘贴</span></button>
              <button type="button" aria-label="加粗所选单元格" title="批量加粗单元格内容" disabled={!editable} onClick={() => applySelectionAction("bold")}><Bold aria-hidden /><span>加粗</span></button>
            </>
          ) : null}
          <span className="markdown-editor__table-tool-spacer" aria-hidden />
          <button type="button" aria-label="复制所选表格内容" title="复制为制表符分隔文本" onClick={() => void copySelection()}>{copyState === "copied" ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}<span>{copyState === "copied" ? "已复制" : "复制"}</span></button>
          <button type="button" aria-label="清空所选表格内容" title="清空内容" disabled={!editable} onClick={() => applySelectionAction("clear")}><Eraser aria-hidden /><span>清空</span></button>
          {selection.kind !== "cells" ? (
            <button
              type="button"
              className="is-danger"
              aria-label={selection.kind === "table" ? "删除表格" : selection.kind === "row" ? "删除所选行" : "删除所选列"}
              title={selection.kind === "table" ? "删除表格（可撤销）" : selection.kind === "row" ? "删除所选行" : "删除所选列"}
              disabled={!editable}
              onClick={() => selection.kind === "table" ? removeTable() : applySelectionAction("delete")}
            ><Trash2 aria-hidden /><span>删除</span></button>
          ) : null}
        </div>
      ) : null}

      <div ref={tableScrollRef} className={`markdown-editor__table-scroll${hasHorizontalOverflow ? " is-overflowing" : ""}`}>
        <table ref={tableRef} style={tableStyle} role="grid" aria-label="Markdown 表格" aria-multiselectable="true">
          <colgroup>
            <col className="markdown-editor__table-selector-column" />
            {table.headers.map((_, index) => <col key={index} style={widths ? { width: `${widths[index]}px` } : undefined} />)}
          </colgroup>
          <thead>
            <tr className="markdown-editor__table-column-handles" aria-hidden="false">
              <th className="markdown-editor__table-corner">
                <button type="button" aria-label="选择整张表格" aria-pressed={selection?.kind === "table"} disabled={!editable} onClick={() => { selectionAnchorRef.current = null; setSelection({ kind: "table", start: 0, end: 0 }); }}><TableCornerIcon /></button>
              </th>
              {table.headers.map((_, index) => (
                <th key={index} className="markdown-editor__table-column-handle">
                  <button type="button" aria-label={`选择第 ${index + 1} 列`} aria-pressed={selection?.kind === "column" && isSelected(0, index)} disabled={!editable} onClick={(event) => selectAxis("column", index, event.shiftKey)}><GripHorizontal aria-hidden /></button>
                  <span className="markdown-editor__table-resizer" role="separator" aria-label={`调整第 ${index + 1} 列宽`} aria-orientation="vertical" onPointerDown={(event) => startResize(event, index)} />
                </th>
              ))}
            </tr>
            <tr>
              <th className="markdown-editor__table-row-handle markdown-editor__table-row-handle--header" aria-hidden />
              {table.headers.map((header, index) => (
                <GfmTableCell
                  key={index}
                  alignment={table.alignments[index]}
                  column={index}
                  editable={editable}
                  gridRow={0}
                  header
                  label={`表头 ${index + 1}`}
                  selected={isSelected(0, index)}
                  value={header}
                  onBlur={flushTable}
                  onChange={updateCell}
                  onFocus={focusTableCell}
                  onKeyDown={handleTab}
                  onPaste={handlePaste}
                  onPointerDown={startCellDrag}
                  onPointerEnter={extendCellDrag}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="markdown-editor__table-row-handle">
                  <button type="button" aria-label={`选择第 ${rowIndex + 1} 行`} aria-pressed={selection?.kind === "row" && isSelected(rowIndex + 1, 0)} disabled={!editable} onClick={(event) => selectAxis("row", rowIndex, event.shiftKey)}><GripVertical aria-hidden /></button>
                </th>
                {row.map((cell, columnIndex) => (
                  <GfmTableCell
                    key={columnIndex}
                    alignment={table.alignments[columnIndex]}
                    column={columnIndex}
                    editable={editable}
                    gridRow={rowIndex + 1}
                    header={false}
                    label={`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                    selected={isSelected(rowIndex + 1, columnIndex)}
                    value={cell}
                    onBlur={flushTable}
                    onChange={updateCell}
                    onFocus={focusTableCell}
                    onKeyDown={handleTab}
                    onPaste={handlePaste}
                    onPointerDown={startCellDrag}
                    onPointerEnter={extendCellDrag}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sr-only" aria-live="polite">{copyState === "copied" ? "已复制表格内容" : copyState === "failed" ? "复制失败" : ""}</p>
      <span className="sr-only">当前单元格第 {activeCell.row + 1} 行第 {activeCell.column + 1} 列</span>
    </div>
  );
}

function TableCornerIcon() {
  return <span className="markdown-editor__table-corner-icon" aria-hidden><i /><i /><i /><i /></span>;
}

type TableStructureIconKind =
  | "insert-column-left"
  | "insert-column-right"
  | "insert-row-above"
  | "insert-row-below"
  | "equal-columns";

function TableStructureIcon({ kind }: { kind: TableStructureIconKind }) {
  const common = {
    "aria-hidden": true,
    "data-table-action-icon": kind,
    fill: "none",
    height: 18,
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
    viewBox: "0 0 24 24",
    width: 18,
  };

  if (kind === "insert-column-left") {
    return <svg {...common}><rect x="8" y="4" width="5" height="16" rx="1" /><rect x="15" y="4" width="5" height="16" rx="1" /><path d="M4 8v8M1 12h6" /></svg>;
  }
  if (kind === "insert-column-right") {
    return <svg {...common}><rect x="4" y="4" width="5" height="16" rx="1" /><rect x="11" y="4" width="5" height="16" rx="1" /><path d="M20 8v8M17 12h6" /></svg>;
  }
  if (kind === "insert-row-above") {
    return <svg {...common}><rect x="4" y="8" width="16" height="5" rx="1" /><rect x="4" y="15" width="16" height="5" rx="1" /><path d="M8 4h8M12 1v6" /></svg>;
  }
  if (kind === "insert-row-below") {
    return <svg {...common}><rect x="4" y="4" width="16" height="5" rx="1" /><rect x="4" y="11" width="16" height="5" rx="1" /><path d="M8 20h8M12 17v6" /></svg>;
  }
  return <svg {...common}><rect x="3" y="4" width="4" height="16" rx="1" /><rect x="10" y="4" width="4" height="16" rx="1" /><rect x="17" y="4" width="4" height="16" rx="1" /><path d="M8 2h8M8 2l2-1M8 2l2 1M16 2l-2-1M16 2l-2 1" /></svg>;
}

const GFM_TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u;
export const GFM_TABLE_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [GfmTableNode],
  export: (node) => $isGfmTableNode(node) ? node.getSource() : null,
  regExpStart: /^\s*\|?.+\|.+\|?\s*$/u,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    if (!GFM_TABLE_DIVIDER.test(lines[startLineIndex + 1] ?? "")) return null;
    let endLineIndex = startLineIndex + 1;
    while (endLineIndex + 1 < lines.length && /\|/u.test(lines[endLineIndex + 1]) && lines[endLineIndex + 1].trim()) {
      endLineIndex += 1;
    }
    if (TABLE_WIDTH_METADATA.test(lines[endLineIndex + 1] ?? "")) endLineIndex += 1;
    rootNode.append($createGfmTableNode(lines.slice(startLineIndex, endLineIndex + 1).join("\n")));
    return [true, endLineIndex];
  },
  replace: () => false,
  type: "multiline-element",
};
