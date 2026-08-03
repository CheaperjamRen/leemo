import { useState, useMemo } from "react";
import { FileText, MessageSquare, PackageOpen, Quote, X, type LucideIcon } from "lucide-react";
import {
  useArtifacts,
  useConversations,
  useFileTree,
  useNotebooks,
  useSettings,
  useUi,
  useWikiEntries,
  useWorkspaces,
} from "../bridge/context";
import WikiHistoryList, { wikiEntryMatches } from "../components/WikiHistoryList";
import type { FileNode } from "../stores/file-tree";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";

type FilterType = "all" | "conversations" | "files" | "artifacts" | "wiki";

interface SearchResult {
  id: string;
  type: "conversation" | "file" | "artifact" | "wiki";
  title: string;
  snippet: string;
  path?: string;
  kind?: "markdown" | "pdf" | "html" | "other";
}

function artifactKind(kind: "file" | "visualization"): "html" | "other" {
  return kind === "visualization" ? "html" : "other";
}

function previewKind(path: string): "markdown" | "pdf" | "html" | "other" {
  const lower = path.toLocaleLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "other";
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = [];
  for (const node of nodes) {
    if (node.kind === "file") files.push(node);
    if (node.children) files.push(...flattenFiles(node.children));
  }
  return files;
}

export default function GlobalSearchPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const conversationsById = useConversations((s) => s.byId);
  const conversationOrder = useConversations((s) => s.order);
  const switchActive = useConversations((s) => s.switchActive);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const selectWorkspace = useWorkspaces((s) => s.select);
  const setNotebook = useNotebooks((s) => s.setActive);
  const setMode = useSettings((s) => s.setMode);
  const artifactEntries = useArtifacts((s) => s.entries);
  const fileRoots = useFileTree((s) => s.roots);
  const wikiEntries = useWikiEntries((s) => s.entries);
  const setView = useUi((s) => s.setView);
  const openPreview = useUi((s) => s.openPreview);
  const closeTopOverlay = useUi((s) => s.closeTopOverlay);

  const results = useMemo(() => {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase();
    const matches: SearchResult[] = [];

    if (filter === "all" || filter === "conversations") {
      conversationOrder.forEach((id) => {
        const conv = conversationsById[id];
        if (conv && conv.title.toLowerCase().includes(lowerQuery)) {
          matches.push({
            id: conv.id,
            type: "conversation",
            title: conv.title,
            snippet: `对话 • ${conv.bookId || "未分类"}`,
          });
        }
      });
    }

    if (filter === "all" || filter === "files") {
      flattenFiles(fileRoots).forEach((file) => {
        if (file.name.toLocaleLowerCase("zh-CN").includes(lowerQuery)
          || file.path.toLocaleLowerCase("zh-CN").includes(lowerQuery)) {
          matches.push({
            id: `file:${file.path}`,
            type: "file",
            title: file.name,
            snippet: `文件 · ${file.path}`,
            path: file.path,
            kind: previewKind(file.path),
          });
        }
      });
    }

    if (filter === "all" || filter === "artifacts") {
      artifactEntries.forEach((art) => {
        if (art.title.toLowerCase().includes(lowerQuery)) {
          matches.push({
            id: art.id,
            type: "artifact",
            title: art.title,
            snippet: `${art.kind} • ${art.path}`,
            path: art.path,
            kind: artifactKind(art.kind),
          });
        }
      });
    }

    if (filter === "all") {
      wikiEntries.forEach((entry) => {
        if (!wikiEntryMatches(entry, query)) return;
        matches.push({
          id: `wiki:${entry.id}`,
          type: "wiki",
          title: entry.quotedText,
          snippet: `小问答 · ${entry.filePath} · ${entry.turns.length} 轮`,
          path: entry.filePath,
          kind: previewKind(entry.filePath),
        });
      });
    }

    return matches;
  }, [query, filter, conversationOrder, conversationsById, artifactEntries, fileRoots, wikiEntries]);

  const handleResultClick = async (result: SearchResult) => {
    if (result.type === "conversation") {
      const conversation = conversationsById[result.id];
      if (!conversation) return;
      const workspaceId = conversation.workspaceId ?? HOME_WORKSPACE_ID;
      if (workspaceId !== activeWorkspaceId && !await selectWorkspace(workspaceId)) return;
      setNotebook(workspaceId === HOME_WORKSPACE_ID ? conversation.bookId : null);
      switchActive(result.id);
      setMode(
        workspaceId === HOME_WORKSPACE_ID
          && conversation.bookId === null
          && conversation.source === "buddy"
          ? "buddy"
          : "workbench",
      );
      setView("chat");
    } else if (result.path) {
      setView("chat");
      openPreview(result.path, result.title, result.kind ?? "other");
    }
    closeTopOverlay();
  };

  return (
    <div className="search-page flex min-h-0 flex-1 flex-col">
      {/* 搜索头部 */}
      <div className="search-header shrink-0 border-b border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-6 py-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="搜索对话、文件、成果..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-4 py-2.5 text-sm text-[var(--leemo-ink)] placeholder-[var(--leemo-ink-3)] outline-none transition-colors focus:border-[var(--leemo-amber)] focus:ring-1 focus:ring-[var(--leemo-amber)]"
          />
          <button
            type="button"
            aria-label="关闭搜索"
            title="关闭搜索"
            onClick={closeTopOverlay}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[6px] text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* 过滤按钮 */}
        <div className="search-filters mt-3 flex gap-2">
          <FilterButton
            label="全部"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterButton
            label="对话"
            active={filter === "conversations"}
            onClick={() => setFilter("conversations")}
          />
          <FilterButton
            label="文件"
            active={filter === "files"}
            onClick={() => setFilter("files")}
          />
          <FilterButton
            label="成果"
            active={filter === "artifacts"}
            onClick={() => setFilter("artifacts")}
          />
          <FilterButton
            label="小问答"
            active={filter === "wiki"}
            onClick={() => setFilter("wiki")}
          />
        </div>
      </div>

      {/* 搜索结果 */}
      <div className="search-results min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {filter === "wiki" ? (
          <WikiHistoryList query={query} />
        ) : !query.trim() ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--leemo-ink-3)]">输入关键词搜索</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--leemo-ink-3)]">没找到相关内容</p>
          </div>
        ) : (
          <div className="space-y-1">
            {results.map((result) => (
              <SearchResultCard
                key={result.id}
                result={result}
                onClick={() => void handleResultClick(result)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface FilterButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterButton({ label, active, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "active bg-[var(--leemo-amber-bg)] text-[var(--leemo-amber)]"
          : "text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)]"
      }`}
    >
      {label}
    </button>
  );
}

interface SearchResultCardProps {
  result: SearchResult;
  onClick: () => void;
}

function SearchResultCard({ result, onClick }: SearchResultCardProps) {
  const Icon = getIcon(result.type);

  return (
    <div
      role="button"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      className="result-card group flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-3 transition-all hover:border-[var(--leemo-line)] hover:bg-[var(--leemo-panel)]"
    >
      <div className="result-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--leemo-side)] text-base">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="result-content min-w-0 flex-1">
        <div className="result-title mb-0.5 text-sm font-medium text-[var(--leemo-ink)] group-hover:text-[var(--leemo-amber)]">
          {result.title}
        </div>
        <div className="result-snippet text-xs text-[var(--leemo-ink-2)]">{result.snippet}</div>
      </div>
    </div>
  );
}

function getIcon(type: SearchResult["type"]): LucideIcon {
  switch (type) {
    case "conversation":
      return MessageSquare;
    case "file":
      return FileText;
    case "artifact":
      return PackageOpen;
    case "wiki":
      return Quote;
    default:
      return FileText;
  }
}
