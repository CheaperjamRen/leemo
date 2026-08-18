import type { Note } from "../../captures";

const NOTE_LINK_PATTERN = /(?<!!)\[[^\]\n]*\]\(\s*leemo-note:\/\/([^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu;

export const NOTE_DRAG_MIME = "application/x-leemo-note";

export function noteReferenceHref(noteId: string): string {
  return `leemo-note://${encodeURIComponent(noteId)}`;
}

export function noteIdFromReferenceHref(href: string): string | null {
  if (!href.startsWith("leemo-note://")) return null;
  try {
    const id = decodeURIComponent(href.slice("leemo-note://".length)).trim();
    return id || null;
  } catch {
    return null;
  }
}

export function noteIdFromDragPayload(dataTransfer: Pick<DataTransfer, "getData">): string | null {
  try {
    const value = JSON.parse(dataTransfer.getData(NOTE_DRAG_MIME)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const noteId = (value as { noteId?: unknown }).noteId;
    return typeof noteId === "string" && noteId.trim() ? noteId.trim() : null;
  } catch {
    return null;
  }
}

export function extractNoteReferenceIds(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(NOTE_LINK_PATTERN)) {
    try {
      const id = decodeURIComponent(match[1] ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    } catch {
      // A malformed local target remains ordinary text instead of opening an
      // external URL or breaking the whole document.
    }
  }
  return ids;
}

export function buildBacklinks(notes: readonly Note[]): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
  for (const note of notes) {
    for (const targetId of extractNoteReferenceIds(note.markdown)) {
      if (targetId === note.id) continue;
      const sources = backlinks.get(targetId) ?? [];
      sources.push(note.id);
      backlinks.set(targetId, sources);
    }
  }
  return backlinks;
}
