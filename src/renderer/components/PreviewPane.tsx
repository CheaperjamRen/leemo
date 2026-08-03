import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, Eye, FolderOpen, Pencil, RefreshCw, X } from "lucide-react";
import { usePreviewContent, useUi, useWorkspace, useWorkspaces } from "../bridge/context";
import { wrapVisualizationHtml } from "../utils/wrap-visualization-html";
import { previewDraftKey, type PreviewEntry } from "../stores/preview-content";
import type { PreviewErrorKind } from "../stores/preview-content";
import SelectionMenu from "./SelectionMenu";
import MarkdownContent from "./MarkdownContent";
import MarkdownEditor from "./MarkdownEditor";

// pdfjs 是个大包，而且在 jsdom 里跑不起来（要 Canvas/Worker）。lazy 之后：不点 PDF
// 就不下载它，组件测试也不会因为顶层 import 就炸。
const PdfView = lazy(() => import("./PdfView"));

function Notice({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="p-4 text-sm text-[var(--leemo-ink-3)]" data-testid={testId}>
      {children}
    </div>
  );
}

const ERROR_COPY: Record<PreviewErrorKind, { title: string; detail: string }> = {
  missing: {
    title: "文件已经不在这里",
    detail: "文件可能被移动、改名或删除。确认路径后重试，或回到来源对话重新生成。",
  },
  permission: {
    title: "暂时没有权限读取",
    detail: "检查文件权限，或关闭正在占用它的程序后重试。",
  },
  directory: {
    title: "这里打开的是文件夹",
    detail: "请从文件树里选择具体文件。",
  },
  workspace: {
    title: "本子文件夹没有连接好",
    detail: "重新打开这个本子后再试；文件本身不会被修改。",
  },
  unknown: {
    title: "预览没有打开",
    detail: "文件没有被修改。可以重试；如果仍失败，请从文件夹中打开原文件。",
  },
};

function PreviewProblem({
  testId,
  title,
  detail,
  path,
  actions,
}: {
  testId: string;
  title: string;
  detail: string;
  path: string;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center p-6" data-testid={testId}>
      <div className="w-full max-w-[360px] text-center">
        <AlertTriangle className="mx-auto h-5 w-5 text-[var(--leemo-amber)]" aria-hidden />
        <h2 className="mt-2 text-sm font-semibold text-[var(--leemo-ink)]">{title}</h2>
        <p className="mt-1.5 text-xs leading-5 text-[var(--leemo-ink-3)]">{detail}</p>
        <code className="mt-3 block break-all rounded-[6px] bg-[var(--leemo-panel)] px-2.5 py-2 text-left text-[11px] text-[var(--leemo-ink-2)]">
          {path}
        </code>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

interface PreviewPaneProps {
  onRewriteSelection?: (source: {
    workspaceId: string;
    filePath: string;
    selectedText: string;
  }) => void;
}

export default function PreviewPane({ onRewriteSelection }: PreviewPaneProps) {
  const previewTabs = useUi((s) => s.previewTabs);
  const previewActivePath = useUi((s) => s.previewActivePath);
  const closePreviewTab = useUi((s) => s.closePreviewTab);
  const openPreview = useUi((s) => s.openPreview);
  const byPath = usePreviewContent((s) => s.byPath);
  const drafts = usePreviewContent((s) => s.drafts);
  const load = usePreviewContent((s) => s.load);
  const forget = usePreviewContent((s) => s.forget);
  const beginEdit = usePreviewContent((s) => s.beginEdit);
  const updateDraft = usePreviewContent((s) => s.updateDraft);
  const saveDraft = usePreviewContent((s) => s.saveDraft);
  const discardDraft = usePreviewContent((s) => s.discardDraft);
  const workspace = useWorkspace();
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const workspaceTransitioning = useUi((s) => s.workspaceTransitioning);
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const [viewModes, setViewModes] = useState<Record<string, "preview" | "edit">>({});
  const [pendingClose, setPendingClose] = useState<{ path: string; title: string } | null>(null);
  const [closingSave, setClosingSave] = useState(false);

  const activeTab = previewTabs.find((t) => t.path === previewActivePath) ?? null;

  // 轮 4「预览区通电」: 内容来自真实文件。此前这里是
  // `const FIXTURE_CONTENT: Record<string, string> = {}` —— 点开任何文件都落到
  // `?? "(内容加载中)"`，也就是永远"加载中"。
  useEffect(() => {
    if (activeTab) void load(activeTab.path);
  }, [activeTab, activeWorkspaceId, load]);

  const entry: PreviewEntry | undefined = activeTab ? byPath[activeTab.path] : undefined;
  const activeDraftKey = activeTab ? previewDraftKey(activeWorkspaceId, activeTab.path) : "";
  const activeDraft = activeDraftKey ? drafts[activeDraftKey] : undefined;
  const activeTextPayload = entry?.payload?.kind === "text" ? entry.payload : undefined;
  const canEditMarkdown = Boolean(
    activeTab?.kind === "markdown"
    && activeTextPayload
    && !activeTextPayload.truncated
    && workspace?.writeMarkdownFile,
  );
  const activeViewMode = activeDraftKey
    ? viewModes[activeDraftKey] ?? (activeDraft ? "edit" : "preview")
    : "preview";
  const editingMarkdown = canEditMarkdown && activeViewMode === "edit" && Boolean(activeDraft);

  const startEditing = () => {
    if (workspaceTransitioning || !activeTab || !activeTextPayload || activeTextPayload.truncated || !workspace?.writeMarkdownFile) return;
    beginEdit(activeTab.path, activeTextPayload.text);
    setViewModes((current) => ({ ...current, [activeDraftKey]: "edit" }));
  };

  const showMarkdownPreview = () => {
    if (!activeDraftKey) return;
    setViewModes((current) => ({ ...current, [activeDraftKey]: "preview" }));
  };

  const closeTabNow = (path: string) => {
    const key = previewDraftKey(activeWorkspaceId, path);
    discardDraft(path);
    forget(path);
    closePreviewTab(path);
    setViewModes((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const requestCloseTab = (path: string, title: string) => {
    const draft = drafts[previewDraftKey(activeWorkspaceId, path)];
    if (draft && draft.status !== "clean") {
      setPendingClose({ path, title });
      return;
    }
    closeTabNow(path);
  };

  const saveAndClosePending = async () => {
    if (!pendingClose || closingSave) return;
    const target = pendingClose;
    setClosingSave(true);
    try {
      const saved = await saveDraft(target.path);
      setPendingClose(null);
      if (saved) closeTabNow(target.path);
    } finally {
      setClosingSave(false);
    }
  };

  const renderPayload = (): React.ReactNode => {
    if (!activeTab || !entry?.payload) return null;
    const payload = entry.payload;

    if (payload.kind === "unpreviewable") {
      return (
        <PreviewProblem
          testId="preview-unpreviewable"
          title="暂时不能在 Leemo 里预览"
          detail={payload.reason}
          path={activeTab.path}
          actions={(
            <>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] px-2.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                onClick={() => void workspace?.reveal(activeTab.path, activeWorkspaceId)}
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                在文件夹中显示
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
                onClick={() => void navigator.clipboard?.writeText(activeTab.path)}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                复制路径
              </button>
            </>
          )}
        />
      );
    }

    if (payload.kind === "binary") {
      return (
        <Suspense fallback={<Notice testId="preview-pdf-loading">正在载入 PDF 阅读器…</Notice>}>
          <PdfView base64={payload.base64} title={activeTab.title} />
        </Suspense>
      );
    }

    // 以下都是文本。用**标签声明的类型**决定怎么渲染，而不是再猜一次内容 ——
    // main 已经确认过这是文本，剩下的只是 md/html/纯文本三种渲染方式。
    const truncatedNote = payload.truncated ? (
      <p className="border-t border-[var(--leemo-line)] p-2 text-xs text-[var(--leemo-ink-3)]">
        文件太大，只显示了开头一部分
      </p>
    ) : null;

    if (activeTab.kind === "html") {
      return (
        <iframe
          sandbox=""
          srcDoc={wrapVisualizationHtml(payload.text)}
          className="w-full flex-1 border-0"
          style={{ minHeight: "200px" }}
          title={activeTab.title}
        />
      );
    }

    if (activeTab.kind === "markdown") {
      const visibleText = activeDraft?.text ?? payload.text;
      return (
        <>
          {canEditMarkdown && (
            <div className="flex h-10 shrink-0 items-center justify-end border-b border-[var(--leemo-line)] px-2">
              <div className="inline-flex h-7 items-center rounded-[6px] bg-[var(--leemo-panel)] p-0.5 text-[11px]">
                <button
                  type="button"
                  aria-label={`阅读 ${activeTab.title}`}
                  aria-pressed={activeViewMode === "preview"}
                  onClick={showMarkdownPreview}
                  className={`inline-flex h-6 items-center gap-1 rounded-[5px] px-2 transition-colors ${activeViewMode === "preview" ? "bg-[var(--leemo-bg)] text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
                >
                  <Eye className="h-3 w-3" aria-hidden />
                  阅读
                </button>
                <button
                  type="button"
                  aria-label={`编辑 ${activeTab.title}`}
                  aria-pressed={activeViewMode === "edit"}
                  disabled={workspaceTransitioning}
                  onClick={startEditing}
                  className={`inline-flex h-6 items-center gap-1 rounded-[5px] px-2 transition-colors ${activeViewMode === "edit" ? "bg-[var(--leemo-bg)] text-[var(--leemo-ink)] shadow-sm" : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
                >
                  <Pencil className="h-3 w-3" aria-hidden />
                  编辑
                </button>
              </div>
            </div>
          )}
          {editingMarkdown && activeDraft ? (
            <MarkdownEditor
              title={activeTab.title}
              draft={activeDraft}
              disabled={workspaceTransitioning}
              onChange={(text) => updateDraft(activeTab.path, text)}
              onSave={() => void saveDraft(activeTab.path)}
            />
          ) : (
            <div
              className="prose-leemo max-w-none px-4 py-3 text-sm text-[var(--leemo-ink)]"
              data-testid="preview-markdown"
            >
              <MarkdownContent text={visibleText} variant="preview" />
            </div>
          )}
          {!editingMarkdown && truncatedNote}
        </>
      );
    }

    // 纯文本（.txt/.log/LICENSE/未知扩展名但内容是文本）：等宽、保留换行，不做
    // markdown 解析 —— 对着一个 .log 把 `#` 变成标题是帮倒忙。
    return (
      <>
        <pre className="whitespace-pre-wrap px-4 py-3 text-sm text-[var(--leemo-ink)]" data-testid="preview-plaintext">
          {payload.text}
        </pre>
        {truncatedNote}
      </>
    );
  };

  const renderContent = () => {
    if (!activeTab) return null;
    if (entry?.status === "error") {
      const copy = ERROR_COPY[entry.errorKind ?? "unknown"];
      return (
        <PreviewProblem
          testId="preview-error"
          title={copy.title}
          detail={copy.detail}
          path={activeTab.path}
          actions={(
            <>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[var(--leemo-line)] px-2.5 text-xs font-medium text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]"
                onClick={() => void load(activeTab.path, { force: true })}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重试
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"
                onClick={() => void navigator.clipboard?.writeText(activeTab.path)}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                复制路径
              </button>
            </>
          )}
        />
      );
    }
    if (!entry || entry.status === "loading") {
      return <Notice testId="preview-loading">正在读 {activeTab.title}…</Notice>;
    }
    return renderPayload();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="preview-pane">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-2 py-1">
        {previewTabs.map((tab) => {
          const draft = drafts[previewDraftKey(activeWorkspaceId, tab.path)];
          const dirty = draft && draft.status !== "clean";
          return (
            <div
              key={tab.path}
              className={`group flex items-center gap-1 rounded px-2 py-1 text-xs ${
                tab.path === previewActivePath
                  ? "bg-[var(--leemo-bg)] text-[var(--leemo-ink)]"
                  : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] cursor-pointer"
              }`}
              onClick={() => openPreview(tab.path, tab.title, tab.kind)}
            >
              <span className="max-w-[120px] truncate">{tab.title}</span>
              {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--leemo-amber)]" title="未保存" aria-label="未保存" />}
              <button
                data-testid={`close-tab-${tab.path}`}
                disabled={draft?.status === "saving"}
                onClick={(event) => { event.stopPropagation(); requestCloseTab(tab.path, tab.title); }}
                className="opacity-60 hover:opacity-100 disabled:cursor-wait disabled:opacity-25"
                aria-label={`关闭 ${tab.title}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      {/* Content area */}
      <div
        ref={selectionRootRef}
        data-preview-selection-root="true"
        className={`relative flex min-h-0 flex-1 flex-col ${editingMarkdown ? "overflow-hidden" : "overflow-auto"}`}
      >
        {previewTabs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-[var(--leemo-ink-3)]">
            没有打开的文件，从对话或文件树点开一个
          </div>
        ) : (
          renderContent()
        )}
        {!editingMarkdown && (
          <SelectionMenu
            workspaceId={activeWorkspaceId}
            filePath={previewActivePath}
            selectionRoot={selectionRootRef}
            onRewrite={previewActivePath && activeTab?.kind === "markdown" && onRewriteSelection
              ? (selectedText) => onRewriteSelection({
                  workspaceId: activeWorkspaceId,
                  filePath: previewActivePath,
                  selectedText,
                })
              : undefined}
          />
        )}
      </div>

      {pendingClose && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-labelledby="preview-close-title">
          <div className="w-full max-w-[330px] rounded-[8px] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-4 shadow-xl">
            <h2 id="preview-close-title" className="text-sm font-semibold text-[var(--leemo-ink)]">保存这份修改？</h2>
            <p className="mt-1.5 text-xs leading-5 text-[var(--leemo-ink-3)]">
              {pendingClose.title} 还有未保存的内容。
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" disabled={closingSave} onClick={() => setPendingClose(null)} className="h-8 rounded-[6px] px-2.5 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40">
                继续编辑
              </button>
              <button type="button" disabled={closingSave} onClick={() => { const target = pendingClose; setPendingClose(null); closeTabNow(target.path); }} className="h-8 rounded-[6px] px-2.5 text-xs text-[var(--leemo-danger)] hover:bg-[var(--leemo-side-hover)] disabled:opacity-40">
                不保存
              </button>
              <button type="button" disabled={closingSave} onClick={() => void saveAndClosePending()} className="h-8 rounded-[6px] bg-[var(--leemo-ink)] px-3 text-xs font-medium text-[var(--leemo-bg)] hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
                {closingSave ? "保存中…" : "保存并关闭"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
