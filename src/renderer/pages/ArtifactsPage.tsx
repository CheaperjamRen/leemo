import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Eye,
  FileArchive,
  FileText,
  LoaderCircle,
  MessageSquare,
  TriangleAlert,
} from "lucide-react";
import { useArtifacts, useConversations, useNotebooks, useUi, useWorkspaces } from "../bridge/context";
import type { ArtifactEntry } from "../stores/artifacts";
import type { Notebook } from "../stores/notebooks";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";

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

function formatDate(createdAt: number): string {
  if (createdAt <= 0) return "较早";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(createdAt));
}

export function ArtifactsPage() {
  const artifacts = useArtifacts((s) => s.entries);
  const status = useArtifacts((s) => s.status);
  const error = useArtifacts((s) => s.error);
  const notebooks: Notebook[] = useNotebooks((s) => s.list);
  const conversations = useConversations((s) => s.byId);
  const switchActive = useConversations((s) => s.switchActive);
  const openPreview = useUi((s) => s.openPreview);
  const setView = useUi((s) => s.setView);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const activeWorkspaceKind = useWorkspaces((s) =>
    s.list.find((entry) => entry.id === s.activeId)?.kind ?? "home"
  );
  const [filter, setFilter] = useState<Filter>("all");

  const visibleArtifacts = useMemo(() => artifacts.filter((artifact) =>
    (artifact.workspaceId ?? HOME_WORKSPACE_ID) === activeWorkspaceId
  ), [activeWorkspaceId, artifacts]);

  const groupedArtifacts = useMemo(() => {
    const filtered = visibleArtifacts.filter((artifact) => (
      filter === "all"
      || (filter === "files" && artifact.kind === "file")
      || (filter === "visualizations" && artifact.kind === "visualization")
    ));
    const groups = new Map<string | null, ArtifactEntry[]>();
    for (const artifact of filtered) {
      const group = groups.get(artifact.bookId) ?? [];
      group.push(artifact);
      groups.set(artifact.bookId, group);
    }
    return Array.from(groups.entries()).map(([bookId, entries]) => ({
      bookId,
      bookTitle: activeWorkspaceKind === "external"
        ? "当前本子"
        : bookId
          ? notebooks.find((book) => book.id === bookId)?.title ?? bookId
          : "未分类",
      artifacts: entries.sort((a, b) => b.createdAt - a.createdAt),
    }));
  }, [activeWorkspaceKind, filter, notebooks, visibleArtifacts]);

  const openSource = (artifact: ArtifactEntry) => {
    switchActive(artifact.sourceConversationId);
    setView("chat");
  };

  return (
    <div className="leemo-page-scroll">
      <div className="leemo-page-frame">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--leemo-line)] pb-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[15px] font-semibold text-[var(--leemo-ink)]">成果</h1>
          <span className="text-[11px] tabular-nums text-[var(--leemo-ink-3)]">{visibleArtifacts.length} 项</span>
        </div>
        {visibleArtifacts.length > 0 && (
          <div className="ml-auto inline-flex rounded-[6px] border border-[var(--leemo-line)] bg-[var(--leemo-panel)] p-0.5" aria-label="成果类型">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`h-7 rounded-[4px] px-2.5 text-[11.5px] transition-colors ${
                filter === item.id
                  ? "bg-[var(--leemo-card)] font-medium text-[var(--leemo-ink)] shadow-sm"
                  : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"
              }`}
            >
              {item.label}
            </button>
          ))}
          </div>
        )}
      </header>

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
        <div className="py-2">
          {groupedArtifacts.map((group) => (
            <section key={group.bookId ?? "uncategorized"} className="py-3">
              <h2 className="mb-2 text-[12px] font-semibold text-[var(--leemo-ink-2)]">{group.bookTitle}</h2>
              <div className="divide-y divide-[var(--leemo-line)] border-y border-[var(--leemo-line)]">
                {group.artifacts.map((artifact) => {
                  const source = conversations[artifact.sourceConversationId];
                  const Icon = artifact.kind === "visualization" ? BarChart3 : FileText;
                  return (
                    <div
                      key={artifact.id}
                      data-testid="artifact-card"
                      className="group flex min-h-16 items-center gap-3 px-2 py-2.5 hover:bg-[var(--leemo-panel)]"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-[var(--leemo-bg-deep)] text-[var(--leemo-ink-3)]">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-[var(--leemo-ink)]">{artifact.title}</p>
                        <p className="mt-0.5 truncate text-[10.5px] text-[var(--leemo-ink-3)]">{artifact.path}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--leemo-ink-3)]">
                          <span>{formatDate(artifact.createdAt)}</span>
                          {source && <span>来自 {source.title}</span>}
                          {artifact.escaped && (
                            <span className="inline-flex items-center gap-1 text-[var(--leemo-danger)]">
                              <TriangleAlert className="h-3 w-3" aria-hidden />
                              当前本子外
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`预览 ${artifact.title}`}
                          title={artifact.escaped ? "当前本子之外的文件不能在 Leemo 中预览" : "打开预览"}
                          disabled={artifact.escaped}
                          onClick={() => openPreview(artifact.path, artifact.title, previewKind(artifact))}
                          className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)] disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`回到 ${artifact.title} 的来源对话`}
                          title="回到来源对话"
                          disabled={!source}
                          onClick={() => openSource(artifact)}
                          className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink)] disabled:cursor-not-allowed disabled:opacity-35"
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
