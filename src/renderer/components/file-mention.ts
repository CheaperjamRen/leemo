import type { WorkspaceFileNode } from "../workspace/client";

export interface FileMentionQuery {
  start: number;
  end: number;
  query: string;
}

export function parseFileMention(value: string, caret: number): FileMentionQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > value.length) return null;
  const before = value.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(value[start - 1] ?? "")) return null;
  const query = before.slice(start + 1);
  if (query.length > 80 || /[\r\n]/.test(query)) return null;
  // A whitespace followed by more text means the user already moved on from
  // the mention. File names may contain spaces, so only close after the first
  // whitespace when another non-space token follows it.
  if (/\s+\S/.test(query)) return null;
  return { start, end: caret, query: query.trimStart() };
}

function flattenFiles(nodes: readonly WorkspaceFileNode[], out: WorkspaceFileNode[]): void {
  for (const node of nodes) {
    if (node.kind === "file") out.push(node);
    else if (node.children) flattenFiles(node.children, out);
  }
}

function isOrderedMatch(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

export function filterWorkspaceFiles(
  roots: readonly WorkspaceFileNode[],
  query: string,
  limit = 10,
): WorkspaceFileNode[] {
  const files: WorkspaceFileNode[] = [];
  flattenFiles(roots, files);
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return files.slice(0, limit);

  return files
    .map((file, order) => {
      const name = file.name.toLocaleLowerCase();
      const path = file.path.toLocaleLowerCase();
      const rank = name.startsWith(needle)
        ? 0
        : name.includes(needle)
          ? 1
          : isOrderedMatch(needle, name)
            ? 2
            : path.includes(needle)
              ? 3
              : isOrderedMatch(needle, path)
                ? 4
                : 5;
      return { file, order, rank };
    })
    .filter(({ rank }) => rank < 5)
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, limit)
    .map(({ file }) => file);
}

export function applyFileMentionPick(
  value: string,
  mention: FileMentionQuery,
): { value: string; caret: number } {
  return {
    value: `${value.slice(0, mention.start)}${value.slice(mention.end)}`,
    caret: mention.start,
  };
}
