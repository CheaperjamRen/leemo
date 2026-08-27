import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Clock3, FileText, Inbox, Pin, Plus, Search, X } from "lucide-react";
import type { Note } from "../../captures";
import { NOTE_DRAG_MIME, noteIdFromDragPayload } from "../notes/note-references";
import { buildNoteTree, noteSystemViews, type NoteTreeNode } from "../notes/note-tree";

type ExplorerLens = "documents" | "inbox" | "pinned" | "recent";
export type NoteDropPosition = "before" | "inside" | "after";

interface NoteDropIntent {
  sourceId: string;
  targetId: string;
  position: NoteDropPosition;
  parentId: string | null;
  index: number;
}

export function noteDropPosition(pointerY: number, rect: Pick<DOMRect, "top" | "height">): NoteDropPosition {
  if (rect.height <= 0) return "inside";
  const ratio = (pointerY - rect.top) / rect.height;
  if (ratio < 0.28) return "before";
  if (ratio > 0.72) return "after";
  return "inside";
}

function wouldCreateCycle(
  sourceId: string,
  parentId: string | null,
  noteById: ReadonlyMap<string, Note>,
): boolean {
  let currentId = parentId;
  const seen = new Set<string>();
  while (currentId) {
    if (currentId === sourceId || seen.has(currentId)) return true;
    seen.add(currentId);
    currentId = noteById.get(currentId)?.parentId ?? null;
  }
  return false;
}

function resolveDropIntent({
  sourceId,
  target,
  siblings,
  position,
  noteById,
}: {
  sourceId: string;
  target: NoteTreeNode;
  siblings: readonly NoteTreeNode[];
  position: NoteDropPosition;
  noteById: ReadonlyMap<string, Note>;
}): NoteDropIntent | null {
  const source = noteById.get(sourceId);
  if (!source || sourceId === target.note.id) return null;
  const parentId = position === "inside" ? target.note.id : target.note.parentId;
  if (wouldCreateCycle(sourceId, parentId, noteById)) return null;
  if (position === "inside") {
    return {
      sourceId,
      targetId: target.note.id,
      position,
      parentId,
      index: target.children.filter((child) => child.note.id !== sourceId).length,
    };
  }
  const remaining = siblings.filter((sibling) => sibling.note.id !== sourceId);
  const targetIndex = remaining.findIndex((sibling) => sibling.note.id === target.note.id);
  if (targetIndex < 0) return null;
  return {
    sourceId,
    targetId: target.note.id,
    position,
    parentId,
    index: targetIndex + (position === "after" ? 1 : 0),
  };
}

function filterTree(nodes: readonly NoteTreeNode[], query: string): NoteTreeNode[] {
  if (!query) return nodes.map((node) => ({ ...node, children: filterTree(node.children, query) }));
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    const matches = `${node.note.title}\n${node.note.markdown}`.toLocaleLowerCase().includes(query);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

function TreeRows({
  nodes,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  onMove,
  noteById,
  dropIntent,
  onDropIntent,
  onDragStartNote,
  onDragEndNote,
  readOnly,
}: {
  nodes: readonly NoteTreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  onToggle(id: string): void;
  onSelect(note: Note): void;
  onMove(noteId: string, parentId: string | null, index: number): void;
  noteById: ReadonlyMap<string, Note>;
  dropIntent: NoteDropIntent | null;
  onDropIntent(intent: NoteDropIntent | null): void;
  onDragStartNote(noteId: string): void;
  onDragEndNote(): void;
  readOnly: boolean;
}) {
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.note.id);
    return (
      <div key={node.note.id}>
        <div
          role="treeitem"
          aria-label={node.note.title || "无标题文档"}
          aria-selected={selectedId === node.note.id}
          aria-expanded={hasChildren ? isExpanded : undefined}
          data-depth={depth}
          data-drop-position={dropIntent?.targetId === node.note.id ? dropIntent.position : undefined}
          className="leemo-note-tree__row"
          style={{ "--note-depth": depth } as CSSProperties}
          draggable={!readOnly}
          onDragStart={(event) => {
            if (readOnly) return;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(NOTE_DRAG_MIME, JSON.stringify({ noteId: node.note.id }));
            onDragStartNote(node.note.id);
          }}
          onDragOver={(event) => {
            if (readOnly) return;
            if (!Array.from(event.dataTransfer.types).includes(NOTE_DRAG_MIME)) return;
            const noteId = noteIdFromDragPayload(event.dataTransfer);
            if (!noteId) return;
            const intent = resolveDropIntent({
              sourceId: noteId,
              target: node,
              siblings: nodes,
              position: noteDropPosition(event.clientY, event.currentTarget.getBoundingClientRect()),
              noteById,
            });
            if (!intent) {
              event.dataTransfer.dropEffect = "none";
              onDropIntent(null);
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDropIntent(intent);
          }}
          onDrop={(event) => {
            if (readOnly) return;
            const noteId = noteIdFromDragPayload(event.dataTransfer);
            if (!noteId || noteId === node.note.id) return;
            const intent = resolveDropIntent({
              sourceId: noteId,
              target: node,
              siblings: nodes,
              position: noteDropPosition(event.clientY, event.currentTarget.getBoundingClientRect()),
              noteById,
            });
            if (!intent) return;
            event.preventDefault();
            event.stopPropagation();
            onMove(intent.sourceId, intent.parentId, intent.index);
            onDropIntent(null);
            onDragEndNote();
          }}
          onDragEnd={onDragEndNote}
        >
          {hasChildren ? (
            <button
              type="button"
              className="leemo-note-tree__toggle"
              aria-label={`${isExpanded ? "收起" : "展开"}${node.note.title || "无标题文档"}`}
              onClick={() => onToggle(node.note.id)}
            >
              {isExpanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            </button>
          ) : <span className="leemo-note-tree__toggle" aria-hidden />}
          <button
            type="button"
            className="leemo-note-tree__open"
            onClick={() => onSelect(node.note)}
          >
            <FileText aria-hidden />
            <span>{node.note.title || "无标题文档"}</span>
          </button>
        </div>
        {isExpanded ? (
          <TreeRows
            nodes={node.children}
            depth={depth + 1}
            expanded={expanded}
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
            onMove={onMove}
            noteById={noteById}
            dropIntent={dropIntent}
            onDropIntent={onDropIntent}
            onDragStartNote={onDragStartNote}
            onDragEndNote={onDragEndNote}
            readOnly={readOnly}
          />
        ) : null}
      </div>
    );
  });
}

export default function NoteExplorer({
  notes,
  selectedId,
  onSelect,
  onCreate,
  onMove,
  readOnly = false,
  title = "文档库",
  onRequestClose,
  collapsed = false,
}: {
  notes: readonly Note[];
  selectedId: string | null;
  onSelect(note: Note): void;
  onCreate(): void;
  onMove(noteId: string, parentId: string | null, index: number): void;
  readOnly?: boolean;
  title?: string;
  onRequestClose?(): void;
  collapsed?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<ExplorerLens>("documents");
  const baseTree = useMemo(() => buildNoteTree(notes), [notes]);
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const views = useMemo(() => noteSystemViews(notes, Date.now()), [notes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<NoteDropIntent | null>(null);
  const expandTimer = useRef<number | null>(null);

  const clearExpandTimer = (): void => {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTimer.current = null;
  };

  const updateDropIntent = (intent: NoteDropIntent | null): void => {
    clearExpandTimer();
    setDropIntent(intent);
    if (intent?.position !== "inside" || expanded.has(intent.targetId)) return;
    expandTimer.current = window.setTimeout(() => {
      setExpanded((current) => new Set(current).add(intent.targetId));
      expandTimer.current = null;
    }, 550);
  };

  const finishDrag = (): void => {
    clearExpandTimer();
    setDraggingId(null);
    setDropIntent(null);
  };

  useEffect(() => () => clearExpandTimer(), []);

  useEffect(() => {
    setExpanded((current) => {
      const next = new Set(current);
      const visit = (nodes: readonly NoteTreeNode[]) => {
        for (const node of nodes) {
          if (node.children.length > 0) next.add(node.note.id);
          visit(node.children);
        }
      };
      visit(baseTree);
      return next;
    });
  }, [baseTree]);

  const shownTree = useMemo(() => {
    const source = lens === "documents"
      ? baseTree
      : buildNoteTree((lens === "inbox" ? views.inbox : lens === "pinned" ? views.pinned : views.recent)
        .map((note) => ({ ...note, parentId: null })));
    return filterTree(source, query.trim().toLocaleLowerCase());
  }, [baseTree, lens, query, views.inbox, views.pinned, views.recent]);

  const lenses: Array<{ id: ExplorerLens; label: string; count: number; icon: typeof Inbox }> = [
    { id: "inbox", label: "收集箱", count: views.inbox.length, icon: Inbox },
    { id: "pinned", label: "置顶", count: views.pinned.length, icon: Pin },
    { id: "recent", label: "最近", count: views.recent.length, icon: Clock3 },
  ];

  return (
    <aside className="leemo-note-explorer" aria-label="文档 Explorer" aria-hidden={collapsed || undefined}>
      <header className="leemo-note-explorer__header">
        <div><strong>{title}</strong><span>{notes.length}</span></div>
        <div className="leemo-note-explorer__header-actions">
          {!readOnly ? <button type="button" aria-label="新建文档" title="新建文档" onClick={onCreate}><Plus aria-hidden /></button> : null}
          {onRequestClose ? <button type="button" className="leemo-note-explorer__close" aria-label="关闭文档列表" title="关闭文档列表" onClick={onRequestClose}><X aria-hidden /></button> : null}
        </div>
      </header>
      <label className="leemo-note-explorer__search">
        <Search aria-hidden />
        <input
          type="search"
          aria-label="搜索文档"
          placeholder="搜索标题和正文"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      {!readOnly ? <nav className="leemo-note-explorer__lenses" aria-label="文档视图">
        {lenses.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" aria-current={lens === item.id ? "page" : undefined} onClick={() => setLens(item.id)}>
              <Icon aria-hidden /><span>{item.label}</span><small>{item.count}</small>
            </button>
          );
        })}
      </nav> : null}
      <div className="leemo-note-explorer__tree-heading">
        <button type="button" aria-current={lens === "documents" ? "page" : undefined} onClick={() => setLens("documents")}>
          <FileText aria-hidden /><span>文档树</span>
        </button>
      </div>
      <div
        className={`leemo-note-tree${draggingId ? " is-dragging" : ""}`}
        role="tree"
        aria-label="文档库"
        data-testid="note-tree-root-drop"
        onDragOver={(event) => {
          if (readOnly) return;
          if (Array.from(event.dataTransfer.types).includes(NOTE_DRAG_MIME)) event.preventDefault();
        }}
        onDrop={(event) => {
          if (readOnly) return;
          if ((event.target as HTMLElement).closest("[role='treeitem']")) return;
          const noteId = noteIdFromDragPayload(event.dataTransfer);
          if (!noteId) return;
          event.preventDefault();
          onMove(noteId, null, baseTree.filter((node) => node.note.id !== noteId).length);
          finishDrag();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) updateDropIntent(null);
        }}
      >
        {shownTree.length > 0 ? (
          <TreeRows
            nodes={shownTree}
            depth={0}
            expanded={expanded}
            selectedId={selectedId}
            onToggle={(id) => setExpanded((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onSelect={onSelect}
            onMove={onMove}
            noteById={noteById}
            dropIntent={dropIntent}
            onDropIntent={updateDropIntent}
            onDragStartNote={setDraggingId}
            onDragEndNote={finishDrag}
            readOnly={readOnly}
          />
        ) : <p>{query ? "没有匹配的文档" : "还没有文档"}</p>}
        {draggingId ? <div className="leemo-note-tree__root-target" aria-hidden>移到文档树顶层</div> : null}
      </div>
    </aside>
  );
}
