import type { Note } from "../../captures";

export interface NoteTreeNode {
  note: Note;
  children: NoteTreeNode[];
}

function compareNotes(left: Note, right: Note): number {
  return left.sortOrder - right.sortOrder
    || right.updatedAt - left.updatedAt
    || right.createdAt - left.createdAt
    || left.id.localeCompare(right.id);
}

function hasValidParentChain(note: Note, byId: ReadonlyMap<string, Note>): boolean {
  if (note.parentId === null) return false;
  if (!byId.has(note.parentId)) return false;
  const visited = new Set([note.id]);
  let currentId: string | null = note.parentId;
  while (currentId !== null) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const current = byId.get(currentId);
    if (!current) return false;
    currentId = current.parentId;
  }
  return true;
}

export function buildNoteTree(notes: readonly Note[]): NoteTreeNode[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const nodes = new Map(notes.map((note) => [note.id, { note, children: [] as NoteTreeNode[] }]));
  const roots: NoteTreeNode[] = [];

  for (const note of notes) {
    const node = nodes.get(note.id)!;
    if (!hasValidParentChain(note, byId)) {
      roots.push(node);
      continue;
    }
    nodes.get(note.parentId!)!.children.push(node);
  }

  const sortLevel = (level: NoteTreeNode[]): void => {
    level.sort((left, right) => compareNotes(left.note, right.note));
    for (const node of level) sortLevel(node.children);
  };
  sortLevel(roots);
  return roots;
}

function activeNotes(notes: readonly Note[]): Note[] {
  return notes.filter((note) => note.archivedAt === undefined && note.deletedAt === undefined);
}

export function noteSystemViews(notes: readonly Note[], now: number): {
  inbox: Note[];
  pinned: Note[];
  recent: Note[];
} {
  const active = activeNotes(notes);
  const newestFirst = (left: Note, right: Note): number => (
    right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  );
  return {
    inbox: active.filter((note) => note.organizedAt === null).sort(newestFirst),
    pinned: active
      .filter((note) => note.pinnedAt !== null)
      .sort((left, right) => (
        (right.pinnedAt ?? 0) - (left.pinnedAt ?? 0) || newestFirst(left, right)
      )),
    recent: active.filter((note) => note.updatedAt <= now).sort(newestFirst),
  };
}
