import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Eye,
  FileArchive,
  FileText,
  LoaderCircle,
  MessageSquare,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useArtifacts, useConversations, useNotebooks, useUi, useWorkspaces } from "../bridge/context";
import type { ArtifactEntry } from "../stores/artifacts";
import type { Notebook } from "../stores/notebooks";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import "./ArtifactsPage.css";

type Filter = "all" | "files" | "visualizations";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "files", label: "文件" },
  { id: "visualizations", label: "可视化" },
];

function previewKind(entry: ArtifactEntry): "markdown" | "pdf" | "html" | "other" {
  if (entry.kind === "visualization") return "html";
  const path = entry.path.toLocaleLowerCase();
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "markdown";
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".html") || path.endsWith(".htm")) return "html";
  return "other";
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfNextLocalDay(timestamp: number): number {
  const date = new Date(startOfLocalDay(timestamp));
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function formatArtifactTime(createdAt: number, now: number): string {
  if (createdAt <= 0) return "较早";
  const created = new Date(createdAt);
  const todayStart = startOfLocalDay(now);
  if (createdAt >= todayStart && createdAt < startOfNextLocalDay(now)) {
    return `${String(created.getHours()).padStart(2, "0")}:${String(created.getMinutes()).padStart(2, "0")}`;
  }
  const dayDifference = Math.round((todayStart - startOfLocalDay(createdAt)) / (24 * 60 * 60 * 1_000));
  if (dayDifference === 1) return "昨天";
  if (dayDifference > 1 && dayDifference < 7) return `${dayDifference} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(created);
}

export function ArtifactsPage() {
  const artifacts = useArtifacts((s) => s.entries);
  const status = useArtifacts((s) => s.status);
  const error = useArtifacts((s) => s.error);
  const notebooks: Notebook[] = useNotebooks((s) => s.list);
  const conversations = useConversations((s) => s.byId);
  const switchActive = useConversations((s) => s.switchActive);
  const openPreview = useUi((s) => s.openPreview);
  const previewActivePath = useUi((s) => s.previewActivePath);
  const setView = useUi((s) => s.setView);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const activeWorkspaceKind = useWorkspaces((s) =>
    s.list.find((entry) => entry.id === s.activeId)?.kind ?? "home"
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [notebookFilter, setNotebookFilter] = useState("all");
  const [query, setQuery] = useState("");
  const renderedAt = Date.now();
  const todayStart = startOfLocalDay(renderedAt);
  const tomorrowStart = startOfNextLocalDay(renderedAt);

  const visibleArtifacts = useMemo(() => artifacts.filter((artifact) =>
    (artifact.workspaceId ?? HOME_WORKSPACE_ID) === activeWorkspaceId
  ), [activeWorkspaceId, artifacts]);

  const groupedArtifacts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = visibleArtifacts.filter((artifact) => {
      const kindMatches = filter === "all"
        || (filter === "files" && artifact.kind === "file")
        || (filter === "visualizations" && artifact.kind === "visualization");
      const notebookMatches = notebookFilter === "all"
        || (notebookFilter === "uncategorized" ? artifact.bookId === null : artifact.bookId === notebookFilter);
      const queryMatches = !normalizedQuery
        || artifact.title.toLocaleLowerCase().includes(normalizedQuery)
        || artifact.path.toLocaleLowerCase().includes(normalizedQuery);
      return kindMatches && notebookMatches && queryMatches;
    }).sort((a, b) => b.createdAt - a.createdAt);
    const today: ArtifactEntry[] = [];
    const earlier: ArtifactEntry[] = [];
    for (const artifact of filtered) {
      if (artifact.createdAt >= todayStart && artifact.createdAt < tomorrowStart) {
        today.push(artifact);
      } else {
        earlier.push(artifact);
      }
    }
    return [
      { id: "today", title: "今天", artifacts: today },
      { id: "earlier", title: "更早", artifacts: earlier },
    ].filter((group) => group.artifacts.length > 0);
  }, [filter, notebookFilter, query, todayStart, tomorrowStart, visibleArtifacts]);

  const openSource = (artifact: ArtifactEntry) => {
    switchActive(artifact.sourceConversationId);
    setView("chat");
  };

  return (
    <div className="leemo-page-scroll artifacts-page">
      <div className="leemo-page-frame artifacts-page__frame">
      <header className="artifacts-page__header">
        <div>
          <div className="artifacts-page__title-line">
            <h1>成果</h1>
            <span>{visibleArtifacts.length} 项</span>
          </div>
          <p>由 momo 生成、整理或修改的文件都在这里。</p>
        </div>
      </header>

      {visibleArtifacts.length > 0 && (
        <div className="artifacts-page__controls">
          <label className="artifacts-page__search">
            <Search aria-hidden />
            <input
              type="search"
              aria-label="搜索成果"
              placeholder="搜索文件名或路径"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="筛选本子"
            value={notebookFilter}
            onChange={(event) => setNotebookFilter(event.target.value)}
          >
            <option value="all">全部本子</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>{notebook.title}</option>
            ))}
            <option value="uncategorized">未分类</option>
          </select>
          <div className="artifacts-page__filters" aria-label="成果类型">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={filter === item.id ? "is-active" : ""}
            >
              {item.label}
            </button>
          ))}
          </div>
        </div>
      )}

      {status === "loading" ? (
        <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--leemo-ink-3)]">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          正在整理成果
        </div>
      ) : status === "error" ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[var(--leemo-danger)]">
          <AlertCircle className="h-4 w-4" aria-hidden />
          {error ?? "成果记录读取失败"}
        </div>
      ) : visibleArtifacts.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center">
          <FileArchive className="h-6 w-6 text-[var(--leemo-ink-3)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--leemo-ink-2)]">还没有成果</p>
          <p className="text-xs text-[var(--leemo-ink-3)]">完成的文件和可视化会收在这里</p>
          <button
            type="button"
            onClick={() => setView("chat")}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] px-3 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            回到对话
          </button>
        </div>
      ) : groupedArtifacts.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-[var(--leemo-ink-3)]">这个分类还没有成果</div>
      ) : (
        <div className="artifacts-page__groups">
          {groupedArtifacts.map((group) => (
            <section key={group.id} className="artifacts-page__group">
              <h2>{group.title}</h2>
              <div className="artifacts-page__list" role="list" aria-label={`${group.title}的成果`}>
                {group.artifacts.map((artifact) => {
                  const source = conversations[artifact.sourceConversationId];
                  const Icon = artifact.kind === "visualization" ? BarChart3 : FileText;
                  const notebookTitle = activeWorkspaceKind === "external"
                    ? "当前本子"
                    : artifact.bookId
                      ? notebooks.find((notebook) => notebook.id === artifact.bookId)?.title ?? artifact.bookId
                      : "未分类";
                  return (
                    <div
                      key={artifact.id}
                      data-testid="artifact-card"
                      className={`artifacts-page__row${previewActivePath === artifact.path ? " is-active" : ""}`}
                      role="listitem"
                      aria-current={previewActivePath === artifact.path ? "true" : undefined}
                      tabIndex={artifact.escaped ? -1 : 0}
                      onClick={() => {
                        if (!artifact.escaped) openPreview(artifact.path, artifact.title, previewKind(artifact));
                      }}
                      onKeyDown={(event) => {
                        if (!artifact.escaped && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          openPreview(artifact.path, artifact.title, previewKind(artifact));
                        }
                      }}
                    >
                      <span className="artifacts-page__icon">
                        <Icon aria-hidden />
                      </span>
                      <div className="artifacts-page__row-copy">
                        <p className="artifacts-page__row-title" title={artifact.path}>{artifact.title}</p>
                        <span className="artifacts-page__path">{artifact.path}</span>
                        <div className="artifacts-page__meta">
                          <span>{notebookTitle}</span>
                          {source && <span>来自 {source.title}</span>}
                          {artifact.escaped && (
                            <span className="inline-flex items-center gap-1 text-[var(--leemo-danger)]">
                              <TriangleAlert className="h-3 w-3" aria-hidden />
                              当前本子外
                            </span>
                          )}
                        </div>
                      </div>
                      <time
                        className="artifacts-page__time"
                        dateTime={artifact.createdAt > 0 ? new Date(artifact.createdAt).toISOString() : undefined}
                      >
                        {formatArtifactTime(artifact.createdAt, renderedAt)}
                      </time>
                      <div className="artifacts-page__actions">
                        <button
                          type="button"
                          aria-label={`预览 ${artifact.title}`}
                          title={artifact.escaped ? "当前本子之外的文件不能在 Leemo 中预览" : "打开预览"}
                          disabled={artifact.escaped}
                          onClick={(event) => {
                            event.stopPropagation();
                            openPreview(artifact.path, artifact.title, previewKind(artifact));
                          }}
                          className="artifacts-page__icon-button"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`回到 ${artifact.title} 的来源对话`}
                          title="回到来源对话"
                          disabled={!source}
                          onClick={(event) => {
                            event.stopPropagation();
                            openSource(artifact);
                          }}
                          className="artifacts-page__icon-button"
                        >
                          <MessageSquare className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
