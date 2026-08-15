import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, MessageSquare, PackageOpen, Quote, Search, X, type LucideIcon } from "lucide-react";
import {
  useArtifacts,
  useConversations,
  useFileTree,
  useNotebooks,
  usePreviewContent,
  useSettings,
  useUi,
  useWikiEntries,
  useWorkspace,
  useWorkspaces,
} from "../bridge/context";
import type { FileNode } from "../stores/file-tree";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import type { ScopeKey } from "../stores/workbench-scope";
import "./GlobalSearchPage.css";

type FilterType = "all" | "conversations" | "files" | "artifacts" | "wiki";
type SearchScope = "current" | "all";

export interface GlobalSearchPageProps {
  /** Embedded mode is used by the workbench activity rail. */
  embedded?: boolean;
  onClose?: () => void;
  initialScope?: SearchScope;
}

interface SearchResult {
  id: string;
  type: "conversation" | "file" | "artifact" | "wiki";
  title: string;
  snippet: string;
  path?: string;
  kind?: "markdown" | "pdf" | "html" | "other";
  workspaceId: string;
  bookId: string | null;
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

function scopeParts(scopeKey: ScopeKey): { workspaceId: string; bookId: string | null } {
  if (scopeKey === "global") return { workspaceId: HOME_WORKSPACE_ID, bookId: null };
  const separator = scopeKey.indexOf(":");
  const kind = scopeKey.slice(0, separator);
  const id = scopeKey.slice(separator + 1);
  return kind === "notebook"
    ? { workspaceId: HOME_WORKSPACE_ID, bookId: id }
    : { workspaceId: id, bookId: null };
}

function scopeMatches(scopeKey: ScopeKey, workspaceId: string, bookId: string | null): boolean {
  const target = scopeParts(scopeKey);
  return target.workspaceId === workspaceId && target.bookId === bookId;
}

function scopeLabel(workspaceId: string, bookId: string | null, workspaceNames: Map<string, string>, notebookNames: Map<string, string>): string {
  if (bookId) return notebookNames.get(bookId) ?? bookId;
  return workspaceNames.get(workspaceId) ?? (workspaceId === HOME_WORKSPACE_ID ? "Leemo" : "文件夹");
}

export default function GlobalSearchPage({ embedded = false, onClose, initialScope = "all" }: GlobalSearchPageProps = {}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [scopeMode, setScopeMode] = useState<SearchScope>(initialScope);

  const conversationsById = useConversations((s) => s.byId);
  const conversationOrder = useConversations((s) => s.order);
  const activateConversationScope = useConversations((s) => s.activateScope);
  const switchActive = useConversations((s) => s.switchActive);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const workspaces = useWorkspaces((s) => s.list);
  const workspaceClient = useWorkspace();
  const selectWorkspace = useWorkspaces((s) => s.select);
  const notebooks = useNotebooks((s) => s.list);
  const activeNotebookId = useNotebooks((s) => s.activeId);
  const setNotebook = useNotebooks((s) => s.setActive);
  const setMode = useSettings((s) => s.setMode);
  const artifactEntries = useArtifacts((s) => s.entries);
  const fileRoots = useFileTree((s) => s.roots);
  const refreshTree = useFileTree((s) => s.refresh);
  const wikiEntries = useWikiEntries((s) => s.entries);
  const activeScopeKey = useUi((s) => s.activeScopeKey);
  const activateWorkbenchScope = useUi((s) => s.activateWorkbenchScope);
  const transitioning = useUi((s) => s.workspaceTransitioning);
  const setTransitioning = useUi((s) => s.setWorkspaceTransitioning);
  const setView = useUi((s) => s.setView);
  const openPreview = useUi((s) => s.openPreview);
  const closeTopOverlay = useUi((s) => s.closeTopOverlay);
  const previewDrafts = usePreviewContent((s) => s.drafts);
  const clearPreviewContent = usePreviewContent((s) => s.clear);
  const discardWorkspaceDrafts = usePreviewContent((s) => s.discardWorkspaceDrafts);
  const close = onClose ?? closeTopOverlay;
  const [allWorkspaceTrees, setAllWorkspaceTrees] = useState<Record<string, FileNode[]> | null>(null);
  const [loadingAllFiles, setLoadingAllFiles] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);

  const workspaceNames = useMemo(() => new Map(workspaces.map((entry) => [entry.id, entry.name])), [workspaces]);
  const notebookNames = useMemo(() => new Map(notebooks.map((entry) => [entry.id, entry.title])), [notebooks]);
  useEffect(() => {
    if (scopeMode !== "all" || !workspaceClient) return;
    let cancelled = false;
    setLoadingAllFiles(true);
    void Promise.all(workspaces.filter((entry) => entry.available).map(async (entry) => {
      try {
        return [entry.id, await workspaceClient.readTree(entry.id)] as const;
      } catch {
        return [entry.id, []] as const;
      }
    })).then((entries) => {
      if (!cancelled) setAllWorkspaceTrees(Object.fromEntries(entries));
    }).finally(() => {
      if (!cancelled) setLoadingAllFiles(false);
    });
    return () => { cancelled = true; };
  }, [scopeMode, workspaceClient, workspaces]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const lowerQuery = query.toLocaleLowerCase();
    const matches: SearchResult[] = [];
    const includeScope = (workspaceId: string, bookId: string | null): boolean => scopeMode === "all"
      || scopeMatches(activeScopeKey, workspaceId, bookId);

    if (filter === "all" || filter === "conversations") {
      conversationOrder.forEach((id) => {
        const conv = conversationsById[id];
        if (!conv) return;
        const workspaceId = conv.workspaceId ?? HOME_WORKSPACE_ID;
        const bookId = conv.bookId ?? null;
        if (!includeScope(workspaceId, bookId) || !conv.title.toLocaleLowerCase().includes(lowerQuery)) return;
        matches.push({
          id: conv.id,
          type: "conversation",
          title: conv.title,
          snippet: `对话 · ${scopeLabel(workspaceId, bookId, workspaceNames, notebookNames)}`,
          workspaceId,
          bookId,
        });
      });
    }

    if (filter === "all" || filter === "files") {
      const trees = scopeMode === "all" && allWorkspaceTrees
        ? Object.entries(allWorkspaceTrees)
        : [[activeWorkspaceId, fileRoots] as const];
      trees.forEach(([workspaceId, roots]) => {
        flattenFiles(roots).forEach((file) => {
          const bookId = file.bookId ?? null;
          // In global scope the hidden default-workspace tree is intentionally
          // absent. It is a physical fallback, not a user-facing project.
          if (scopeMode === "current" && (!includeScope(workspaceId, bookId) || activeScopeKey === "global")) return;
          if (!file.name.toLocaleLowerCase().includes(lowerQuery) && !file.path.toLocaleLowerCase().includes(lowerQuery)) return;
          matches.push({
            id: `file:${workspaceId}:${file.path}`,
            type: "file",
            title: file.name,
            snippet: `文件 · ${scopeLabel(workspaceId, bookId, workspaceNames, notebookNames)} · ${file.path}`,
            path: file.path,
            kind: previewKind(file.path),
            workspaceId,
            bookId,
          });
        });
      });
    }

    if (filter === "all" || filter === "artifacts") {
      artifactEntries.forEach((artifact) => {
        const workspaceId = artifact.workspaceId ?? HOME_WORKSPACE_ID;
        const bookId = artifact.bookId ?? null;
        if (!includeScope(workspaceId, bookId) || !artifact.title.toLocaleLowerCase().includes(lowerQuery)) return;
        matches.push({
          id: artifact.id,
          type: "artifact",
          title: artifact.title,
          snippet: `产物 · ${scopeLabel(workspaceId, bookId, workspaceNames, notebookNames)} · ${artifact.path}`,
          path: artifact.path,
          kind: artifactKind(artifact.kind),
          workspaceId,
          bookId,
        });
      });
    }

    if (filter === "all" || filter === "wiki") {
      wikiEntries.forEach((entry) => {
        const workspaceId = entry.workspaceId ?? HOME_WORKSPACE_ID;
        const bookId = workspaceId === HOME_WORKSPACE_ID
          && notebooks.some((book) => entry.filePath === book.id || entry.filePath.startsWith(`${book.id}/`))
          ? entry.filePath.split("/")[0] ?? null
          : null;
        const wikiHaystack = [
          entry.quotedText,
          entry.filePath,
          ...entry.turns.flatMap((turn) => [turn.question, turn.answer]),
        ].join("\n").toLocaleLowerCase();
        if (!includeScope(workspaceId, bookId)
          || (scopeMode === "current" && activeScopeKey === "global" && bookId !== null)
          || !wikiHaystack.includes(lowerQuery)) return;
        matches.push({
          id: `wiki:${entry.id}`,
          type: "wiki",
          title: entry.quotedText,
          snippet: `小问答 · ${scopeLabel(workspaceId, bookId, workspaceNames, notebookNames)} · ${entry.filePath}`,
          path: entry.filePath,
          kind: previewKind(entry.filePath),
          workspaceId,
          bookId,
        });
      });
    }

    return matches;
  }, [activeScopeKey, activeWorkspaceId, allWorkspaceTrees, artifactEntries, conversationsById, conversationOrder, fileRoots, filter, notebookNames, notebooks, query, scopeMode, wikiEntries, workspaceNames]);

  const selectResultScope = async (result: SearchResult): Promise<boolean> => {
    const currentBookId = activeWorkspaceId === HOME_WORKSPACE_ID ? activeNotebookId : null;
    if (result.workspaceId === activeWorkspaceId && result.bookId === currentBookId) return true;
    if (transitioning) return false;

    const dirtyCount = Object.entries(previewDrafts).filter(([key, draft]) =>
      key.startsWith(`${activeWorkspaceId}\u0000`) && draft.status !== "clean"
    ).length;
    if (dirtyCount > 0) {
      setNavigationError(`还有 ${dirtyCount} 份 Markdown 修改没有保存，请先处理后再切换本子。`);
      return false;
    }

    setNavigationError(null);
    setTransitioning(true);
    const sourceWorkspaceId = activeWorkspaceId;
    try {
      if (result.workspaceId !== activeWorkspaceId && !await selectWorkspace(result.workspaceId)) return false;
      setNotebook(result.workspaceId === HOME_WORKSPACE_ID ? result.bookId : null);
      activateConversationScope(result.workspaceId, result.bookId);
      activateWorkbenchScope(result.bookId
        ? `notebook:${result.bookId}`
        : result.workspaceId === HOME_WORKSPACE_ID
          ? "global"
          : `workspace:${result.workspaceId}`);
      clearPreviewContent();
      await refreshTree();
      discardWorkspaceDrafts(sourceWorkspaceId);
      return true;
    } finally {
      setTransitioning(false);
    }
  };

  const handleResultClick = async (result: SearchResult) => {
    if (!(await selectResultScope(result))) return;
    if (result.type === "conversation") {
      const conversation = conversationsById[result.id];
      if (!conversation) return;
      switchActive(result.id);
      setMode(
        result.workspaceId === HOME_WORKSPACE_ID
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
    close();
  };

  return (
    <div className="search-page leemo-global-search flex min-h-0 flex-1 flex-col" data-testid={embedded ? "embedded-search-page" : undefined}>
      <div className="search-header leemo-global-search__header shrink-0 border-b border-[var(--leemo-line)]">
        <div className="flex items-center gap-2">
          <div className="leemo-global-search__field min-w-0 flex-1" data-testid="global-search-field">
            <Search aria-hidden />
            <input
              ref={inputRef}
              type="text"
              placeholder="搜索对话、文件、成果..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query.length > 0 && (
              <button
                type="button"
                aria-label="清空搜索"
                title="清空搜索"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X aria-hidden />
              </button>
            )}
          </div>
          {!embedded && (
            <button
              type="button"
              aria-label="关闭搜索"
              title="关闭搜索"
              onClick={close}
              className="leemo-global-search__close"
            >
              <X aria-hidden />
            </button>
          )}
        </div>
        <div className="leemo-global-search__controls">
          <div className="leemo-search-scope" role="group" aria-label="搜索范围">
            <ScopeButton label="当前范围" active={scopeMode === "current"} onClick={() => setScopeMode("current")} />
            <ScopeButton label="全部" active={scopeMode === "all"} onClick={() => setScopeMode("all")} />
          </div>
          <div className="search-filters leemo-search-filters" role="group" aria-label="结果类型">
            {(["all", "conversations", "files", "artifacts", "wiki"] as FilterType[]).map((value) => (
              <FilterButton
                key={value}
                label={({ all: "全部", conversations: "对话", files: "文件", artifacts: "成果", wiki: "小问答" } as const)[value]}
                active={filter === value}
                onClick={() => setFilter(value)}
              />
            ))}
          </div>
        </div>
        {navigationError && (
          <p role="alert" className="mt-2 rounded-md bg-[var(--leemo-amber-bg)] px-2.5 py-2 text-[11px] leading-4 text-[var(--leemo-ink-2)]">
            {navigationError}
          </p>
        )}
      </div>

      <div className="search-results leemo-global-search__results min-h-0 flex-1 overflow-y-auto">
        {query.trim() && (
          <p className="leemo-global-search__count" role="status">
            {loadingAllFiles && (filter === "all" || filter === "files") && results.length === 0
              ? "正在读取文件…"
              : `${results.length} 个结果`}
          </p>
        )}
        {!query.trim() ? (
          <div className="leemo-global-search__empty">
            <Search aria-hidden />
            <p>
              <span>输入关键词搜索</span>
              <small>{scopeMode === "current" ? "当前范围" : "全部内容"}</small>
            </p>
          </div>
        ) : loadingAllFiles && (filter === "all" || filter === "files") && results.length === 0 ? (
          <div className="leemo-global-search__empty">
            <Search aria-hidden />
            <p>正在读取文件…</p>
          </div>
        ) : results.length === 0 ? (
          <div className="leemo-global-search__empty">
            <Search aria-hidden />
            <p>没找到相关内容</p>
          </div>
        ) : (
          <div className="leemo-global-search__list">
            {results.map((result) => (
              <SearchResultCard key={result.id} result={result} onClick={() => void handleResultClick(result)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`leemo-search-filter ${active ? "active" : ""}`}>
      {label}
    </button>
  );
}

function ScopeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className="leemo-search-scope-button">{label}</button>;
}

function SearchResultCard({ result, onClick }: { result: SearchResult; onClick: () => void }) {
  const Icon = getIcon(result.type);
  return (
    <button
      type="button"
      tabIndex={0}
      onClick={onClick}
      className="result-card leemo-search-result group"
    >
      <span className="result-icon leemo-search-result__icon"><Icon aria-hidden /></span>
      <div className="result-content min-w-0 flex-1">
        <span className="result-title leemo-search-result__title">{result.title}</span>
        <span className="result-snippet leemo-search-result__snippet">{result.snippet}</span>
      </div>
    </button>
  );
}

function getIcon(type: SearchResult["type"]): LucideIcon {
  switch (type) {
    case "conversation": return MessageSquare;
    case "file": return FileText;
    case "artifact": return PackageOpen;
    case "wiki": return Quote;
    default: return FileText;
  }
}
