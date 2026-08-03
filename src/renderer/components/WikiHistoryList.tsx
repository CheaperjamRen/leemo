import { useWikiEntries, useUi } from "../bridge/context";
import { FileText } from "lucide-react";
import type { WikiEntry } from "../stores/wiki-entries";

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function previewKind(path: string): "markdown" | "pdf" | "html" | "other" {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".pdf")) return "pdf";
  return "other";
}

export function wikiEntryMatches(entry: WikiEntry, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  if (!needle) return true;
  return [
    entry.filePath,
    entry.quotedText,
    ...entry.turns.flatMap((turn) => [turn.question, turn.answer]),
  ].some((value) => value.toLocaleLowerCase("zh-CN").includes(needle));
}

export default function WikiHistoryList({ query = "" }: { query?: string }) {
  const entries = useWikiEntries((s) => s.entries);
  const openPreview = useUi((s) => s.openPreview);

  if (entries.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-[var(--leemo-ink-3)]">还没有小问答记录</div>
    );
  }

  const visibleEntries = entries.filter((entry) => wikiEntryMatches(entry, query));
  if (visibleEntries.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-[var(--leemo-ink-3)]">没有匹配的小问答</div>
    );
  }

  // Group by filePath, preserving first-seen order.
  const groups: { filePath: string; items: WikiEntry[] }[] = [];
  for (const entry of visibleEntries) {
    let group = groups.find((g) => g.filePath === entry.filePath);
    if (!group) {
      group = { filePath: entry.filePath, items: [] };
      groups.push(group);
    }
    group.items.push(entry);
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.filePath} data-testid="wiki-file-group">
          <div className="flex items-center gap-1.5 px-1 py-1 text-xs font-medium text-[var(--leemo-ink-2)]">
            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{fileName(group.filePath)}</span>
          </div>
          <div className="space-y-0.5">
            {group.items.map((entry) => (
              <button
                key={entry.id}
                onClick={() => openPreview(entry.filePath, fileName(entry.filePath), previewKind(entry.filePath))}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-side-hover)]"
              >
                <span className="min-w-0 flex-1 truncate">{entry.quotedText}</span>
                <span className="shrink-0 text-[10px] text-[var(--leemo-ink-3)]">{entry.turns.length} 轮</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
