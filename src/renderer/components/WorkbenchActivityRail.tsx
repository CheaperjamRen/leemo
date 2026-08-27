import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  File,
  Files,
  GripVertical,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Search,
  X,
} from "lucide-react";
import {
  useApprovals,
  useArtifacts,
  useConversations,
  useUi,
  useWorkspaces,
} from "../bridge/context";
import type { ScopeKey } from "../stores/workbench-scope";
import type { TimelineItem } from "../stores/message-model";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import {
  WORKBENCH_COMPACT_SIDEBAR_WIDTH,
  WORKBENCH_TOOL_RAIL_WIDTH,
  resolveWorkbenchSidebarMode,
  resolveWorkbenchToolPresentation,
} from "../workbench-spatial";
import FileTree from "./FileTree";
import GlobalSearchPage from "../pages/GlobalSearchPage";
import { collectConversationFiles, type WorkbenchFileRef } from "./workbench-files";
import {
  deriveConversationContinuity,
  deriveNotebookContinuity,
  type ConversationContinuityInput,
} from "./workbench-overview-model";
import { WorkbenchOverview } from "./WorkbenchOverview";

const TOOL_LABELS = {
  files: "文件",
  overview: "概览",
  search: "搜索",
} as const;

const TOOL_ICONS = {
  files: Files,
  overview: LayoutDashboard,
  search: Search,
} as const;

const EMPTY_TIMELINES: Record<string, TimelineItem[]> = {};

interface WorkbenchActivityRailProps {
  shellWidth?: number;
}

function useSettledWindowWidth(override?: number): number {
  const [width, setWidth] = useState(() => (
    override ?? (typeof window === "undefined" ? 1280 : window.innerWidth)
  ));
  useEffect(() => {
    if (override !== undefined) return;
    let timer: number | null = null;
    const update = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setWidth(window.innerWidth);
      }, 72);
    };
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [override]);
  return override ?? width;
}

function scopeParts(scopeKey: ScopeKey): { workspaceId: string; bookId: string | null } {
  if (scopeKey === "global") return { workspaceId: HOME_WORKSPACE_ID, bookId: null };
  const index = scopeKey.indexOf(":");
  const kind = scopeKey.slice(0, index);
  const id = scopeKey.slice(index + 1);
  return kind === "notebook"
    ? { workspaceId: HOME_WORKSPACE_ID, bookId: id }
    : { workspaceId: id, bookId: null };
}

function fileSourceLabel(source: WorkbenchFileRef["source"]): string {
  if (source === "attachment") return "已附加";
  if (source === "read") return "已读取";
  if (source === "changed") return "已修改";
  return "已生成";
}

function artifactPreviewKind(path: string): "markdown" | "pdf" | "html" | "other" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "other";
}

function ConversationFilesPanel({ onClose, scopeKey }: { onClose: () => void; scopeKey: ScopeKey }) {
  const conversations = useConversations((s) => s.byId);
  const activeId = useConversations((s) => s.activeId);
  const timelines = useConversations((s) => s.timelines);
  const artifacts = useArtifacts((s) => s.entries);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const openPreview = useUi((s) => s.openPreview);
  const files = useMemo(() => {
    if (!activeId) return [];
    const conversation = conversations[activeId];
    const target = scopeParts(scopeKey);
    if (!conversation
      || (conversation.workspaceId ?? HOME_WORKSPACE_ID) !== target.workspaceId
      || (conversation.bookId ?? null) !== target.bookId) return [];
    const workspaceId = conversation?.workspaceId ?? activeWorkspaceId ?? HOME_WORKSPACE_ID;
    return collectConversationFiles(activeId, timelines[activeId] ?? [], artifacts, workspaceId);
  }, [activeId, activeWorkspaceId, artifacts, conversations, scopeKey, timelines]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="conversation-files-panel">
      <div className="border-b border-[var(--leemo-line)] px-4 py-3">
        <p className="text-sm font-medium text-[var(--leemo-ink)]">本次文件</p>
        <p className="mt-0.5 text-[11px] text-[var(--leemo-ink-3)]">只显示这段对话实际用到的文件</p>
      </div>
      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-xs leading-5 text-[var(--leemo-ink-3)]">这段对话还没有附加、读取或生成文件</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {files.map((file) => (
            <button
              key={file.key}
              type="button"
              disabled={!file.path}
              onClick={() => {
                if (!file.path) return;
                openPreview(file.path, file.name, file.kind);
                onClose();
              }}
              className="group flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-[var(--leemo-side-hover)] disabled:cursor-default"
            >
              <File className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-[var(--leemo-ink)]" title={file.path ?? file.name}>{file.name}</span>
                <span className="mt-0.5 block text-[10px] text-[var(--leemo-ink-3)]">{fileSourceLabel(file.source)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopedFilesPanel({ onClose, scopeKey, onOpenFile }: { onClose: () => void; scopeKey: ScopeKey; onOpenFile?: () => void }) {
  const [view, setView] = useState<"workspace" | "conversation">("workspace");

  if (scopeKey !== "global") {
    return <FileTree embedded scopeKey={scopeKey} onClose={onClose} onOpenFile={onOpenFile} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="global-files-panel">
      <div className="border-b border-[var(--leemo-line)] px-3 py-2">
        <div
          role="group"
          aria-label="文件范围"
          className="inline-flex rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-bg)] p-0.5"
        >
          <button
            type="button"
            aria-pressed={view === "workspace"}
            onClick={() => setView("workspace")}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${view === "workspace"
              ? "bg-[var(--leemo-card)] text-[var(--leemo-ink)] shadow-sm"
              : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
          >
            工作区文件
          </button>
          <button
            type="button"
            aria-pressed={view === "conversation"}
            onClick={() => setView("conversation")}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${view === "conversation"
              ? "bg-[var(--leemo-card)] text-[var(--leemo-ink)] shadow-sm"
              : "text-[var(--leemo-ink-3)] hover:text-[var(--leemo-ink-2)]"}`}
          >
            本次文件
          </button>
        </div>
      </div>
      {view === "workspace"
        ? <FileTree embedded scopeKey={scopeKey} onClose={onClose} onOpenFile={onOpenFile} />
        : <ConversationFilesPanel onClose={onClose} scopeKey={scopeKey} />}
    </div>
  );
}

function usePointerResize(
  tool: "files" | "overview" | "search",
  panelWidth: number,
  minWidth: number,
  maxWidth: number,
  focusThreshold: number,
  previewWidth: (tool: "files" | "overview" | "search", px: number | null) => void,
  commitWidth: (tool: "files" | "overview" | "search", px: number) => void,
  onFocus: () => void,
) {
  const startRef = useRef<{ x: number; width: number } | null>(null);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startRef.current = { x: event.clientX, width: panelWidth };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = startRef.current;
      if (!start || !event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
      const width = Math.min(maxWidth, Math.max(minWidth, start.width + (start.x - event.clientX)));
      previewWidth(tool, width);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = startRef.current;
      startRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (!start) return;
      const rawWidth = start.width + (start.x - event.clientX);
      commitWidth(tool, Math.min(maxWidth, Math.max(minWidth, rawWidth)));
      previewWidth(tool, null);
      if (rawWidth >= focusThreshold) onFocus();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => {
      startRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      previewWidth(tool, null);
    },
  };
}

export default function WorkbenchActivityRail({ shellWidth }: WorkbenchActivityRailProps) {
  const activeTool = useUi((s) => s.activeWorkbenchTool);
  const toolWidths = useUi((s) => s.workbenchToolWidths);
  const focused = useUi((s) => s.workbenchToolFocused);
  const documentFocused = useUi((s) =>
    s.scopeSessions[s.activeScopeKey]?.surfacePreference === "file");
  const sidebarPreference = useUi((s) => s.workbenchSidebarPreference);
  const sidebarWidth = useUi((s) => s.workbenchSidebarWidth);
  const previewOpen = useUi((s) => s.previewOpen);
  const openPreview = useUi((s) => s.openPreview);
  const openScopeConversation = useUi((s) => s.openScopeConversation);
  const toggleTool = useUi((s) => s.toggleWorkbenchTool);
  const closeTool = useUi((s) => s.closeWorkbenchTool);
  const setToolWidth = useUi((s) => s.setWorkbenchToolWidth);
  const setFocused = useUi((s) => s.setWorkbenchToolFocused);
  const scopeKey = useUi((s) => s.activeScopeKey);
  const activeConversationId = useConversations((s) => s.activeId);
  const conversations = useConversations((s) => s.byId);
  // The overview is the only rail surface that needs every conversation's
  // timeline. Keep the closed rail and the files/search panels off the hot
  // streaming path.
  const timelines = useConversations((s) => activeTool === "overview" ? s.timelines : EMPTY_TIMELINES);
  const runIds = useConversations((s) => s.runIds);
  const switchConversation = useConversations((s) => s.switchActive);
  const refreshWorkOverview = useConversations((s) => s.refreshWorkOverview);
  const correctWorkOverview = useConversations((s) => s.correctWorkOverview);
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const resolvedByRun = useApprovals((s) => s.resolvedByRun);
  const artifacts = useArtifacts((s) => s.entries);
  const activeWorkspaceId = useWorkspaces((s) => s.activeId);
  const currentWidth = useSettledWindowWidth(shellWidth);
  const [liveToolWidth, setLiveToolWidth] = useState<{ tool: "files" | "overview" | "search"; width: number } | null>(null);
  const resolvedSidebarWidth = resolveWorkbenchSidebarMode(sidebarPreference, currentWidth) === "compact"
    ? WORKBENCH_COMPACT_SIDEBAR_WIDTH
    : sidebarWidth;
  const maxPanelWidth = Math.min(520, Math.max(280, currentWidth * 0.45));
  const storedPanelWidth = activeTool ? toolWidths[activeTool] : 360;
  const authorityPanelWidth = (activeTool === "overview" || activeTool === "search") && storedPanelWidth === 360
    ? 480
    : storedPanelWidth;
  const panelWidth = Math.min(liveToolWidth?.tool === activeTool ? liveToolWidth.width : authorityPanelWidth, maxPanelWidth);
  const presentation = resolveWorkbenchToolPresentation({
    shellWidth: currentWidth,
    sidebarPreference,
    sidebarWidth,
    panelWidth,
    hasOpenFile: previewOpen,
    focused,
    documentFocused,
  });
  const docked = presentation === "docked";
  const activeScope = scopeParts(scopeKey);
  const { overviewModel, conversationOverviewModel, activeScopedConversationId } = useMemo(() => {
    const conversationIds = Object.values(conversations)
      .filter((conversation) => conversation
        && (conversation.workspaceId ?? HOME_WORKSPACE_ID) === activeScope.workspaceId
        && (conversation.bookId ?? null) === activeScope.bookId)
      .map((conversation) => conversation.id);
    const conversationIdSet = new Set(conversationIds);
    const activeScopedId = activeConversationId && conversationIdSet.has(activeConversationId)
      ? activeConversationId
      : null;
    const inputs = conversationIds.map((conversationId): ConversationContinuityInput => {
      const timeline = timelines[conversationId] ?? [];
      const pending = pendingByConversation[conversationId];
      const runIdSet = new Set<string>();
      for (const item of timeline) {
        if (item.kind !== "compact") runIdSet.add(item.runId);
      }
      const activeRunId = runIds[conversationId] ?? null;
      if (activeRunId) runIdSet.add(activeRunId);
      if (pending) runIdSet.add(pending.runId);
      const summary = pending?.kind === "question"
        ? pending.questions[0]?.question?.trim() || "等待你的选择"
        : pending?.inputSummary.trim() || "等待权限确认";
      return {
        conversationId,
        title: conversations[conversationId]?.title?.trim() || "未命名会话",
        timeline,
        activeRunId,
        ...(pending ? { pending: { interaction: pending, summary } } : {}),
        resolvedInteractions: [...runIdSet].flatMap((runId) => resolvedByRun[runId] ?? []),
        artifacts: artifacts.filter((artifact) => artifact.sourceConversationId === conversationId),
      };
    });
    const inputById = new Map(inputs.map((input) => [input.conversationId, input]));
    const activeInput = activeScopedId ? inputById.get(activeScopedId) : undefined;
    return {
      overviewModel: deriveNotebookContinuity({ conversations: inputs }),
      conversationOverviewModel: {
        conversations: activeInput ? [deriveConversationContinuity(activeInput)] : [],
      },
      activeScopedConversationId: activeScopedId,
    };
  }, [activeConversationId, activeScope.bookId, activeScope.workspaceId, artifacts, conversations, pendingByConversation, resolvedByRun, runIds, timelines]);

  const getResizeStart = usePointerResize(
    activeTool ?? "files",
    panelWidth,
    280,
    maxPanelWidth,
    maxPanelWidth + 40,
    (tool, width) => setLiveToolWidth(width === null ? null : { tool, width }),
    setToolWidth,
    () => setFocused(true),
  );

  useEffect(() => setLiveToolWidth(null), [activeTool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeTool) {
        if (focused) setFocused(false);
        else closeTool();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTool, closeTool, focused, setFocused]);

  const panel = activeTool ? (
    <div
      className={`flex min-h-0 flex-col border-l border-[var(--leemo-line)] bg-[var(--leemo-card)] shadow-[-12px_0_32px_rgba(32,32,31,0.08)] ${presentation === "docked" ? "relative shrink-0" : "absolute inset-y-0 right-[44px] z-50"}`}
      style={{ width: presentation === "focused" ? Math.max(280, currentWidth - resolvedSidebarWidth - WORKBENCH_TOOL_RAIL_WIDTH) : panelWidth }}
      data-testid="workbench-tool-panel"
      data-tool={activeTool}
      data-presentation={presentation}
      role="region"
      aria-label={`${TOOL_LABELS[activeTool]}面板`}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--leemo-line)] px-4">
        <div className="flex min-w-0 items-center gap-2">
          {(() => { const Icon = TOOL_ICONS[activeTool]; return <Icon className="h-4 w-4 shrink-0 text-[var(--leemo-ink-2)]" aria-hidden />; })()}
          <span className="truncate text-sm font-medium text-[var(--leemo-ink)]">{TOOL_LABELS[activeTool]}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="leemo-icon-btn h-7 w-7"
            title={focused ? "收起面板" : "展开面板"}
            aria-label={focused ? "收起面板" : "展开面板"}
            onClick={() => setFocused(!focused)}
          >
            {focused ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          </button>
          <button type="button" className="leemo-icon-btn h-7 w-7" title="关闭" aria-label="关闭面板" onClick={closeTool}>
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        {activeTool === "files" && (
          <ScopedFilesPanel
            onClose={closeTool}
            scopeKey={scopeKey}
            onOpenFile={closeTool}
          />
        )}
        {activeTool === "overview" && (
          <WorkbenchOverview
            model={overviewModel}
            conversationModel={conversationOverviewModel}
            notebookScopeLabel={activeScope.bookId ? "当前本子" : "当前范围"}
            onOpenConversation={(conversationId) => {
              switchConversation(conversationId);
              openScopeConversation(conversationId);
              closeTool();
            }}
            onOpenArtifact={(artifact) => {
              openPreview(artifact.path, artifact.title, artifactPreviewKind(artifact.path));
              closeTool();
            }}
            onRequestRefresh={activeScopedConversationId
              ? () => refreshWorkOverview(activeScopedConversationId)
              : undefined}
            onSaveCorrection={activeScopedConversationId
              ? (correction) => correctWorkOverview(activeScopedConversationId, correction)
              : undefined}
            activeRunInProgress={activeScopedConversationId
              ? (runIds[activeScopedConversationId] !== null && runIds[activeScopedConversationId] !== undefined)
                || Boolean(pendingByConversation[activeScopedConversationId])
              : false}
          />
        )}
        {activeTool === "search" && <GlobalSearchPage embedded initialScope="current" onClose={closeTool} />}
        <button
          type="button"
          aria-label="调整面板宽度"
          title="拖动调整宽度"
          className="absolute inset-y-0 -left-2 z-10 flex w-4 cursor-col-resize items-center justify-center text-[var(--leemo-ink-3)] opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
          {...getResizeStart}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative flex h-full shrink-0" data-testid="workbench-activity-rail-wrap">
      {docked && panel}
      {!docked && activeTool && (
        <button
          type="button"
          aria-label="关闭工具面板遮罩"
          className="absolute inset-y-0 right-[44px] z-40 bg-transparent"
          style={{ width: focused ? Math.max(0, currentWidth - resolvedSidebarWidth - WORKBENCH_TOOL_RAIL_WIDTH) : currentWidth - resolvedSidebarWidth - WORKBENCH_TOOL_RAIL_WIDTH }}
          data-testid="workbench-tool-backdrop"
          data-dimming="false"
          onClick={() => { setFocused(false); closeTool(); }}
        />
      )}
      {!docked && panel}
      <aside className="relative z-[60] flex w-11 shrink-0 flex-col items-center border-l border-[var(--leemo-line)] bg-[var(--leemo-card)] py-2" role="toolbar" aria-label="工作工具" data-testid="workbench-activity-rail">
        {(["files", "overview", "search"] as const).map((tool) => {
          const Icon = TOOL_ICONS[tool];
          const active = activeTool === tool;
          return (
            <button
              key={tool}
              type="button"
              aria-label={TOOL_LABELS[tool]}
              title={TOOL_LABELS[tool]}
              aria-pressed={active}
              onClick={() => toggleTool(tool)}
              className={`relative mb-1 grid h-9 w-9 place-items-center rounded-md transition-colors ${active ? "bg-[var(--leemo-amber-bg)] text-[var(--leemo-amber)]" : "text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-side-hover)] hover:text-[var(--leemo-ink-2)]"}`}
            >
              {active && <span className="absolute -left-[5px] inset-y-1.5 w-0.5 rounded-r bg-[var(--leemo-amber)]" aria-hidden />}
              <Icon className="h-[17px] w-[17px]" aria-hidden />
            </button>
          );
        })}
        <div className="mt-auto flex flex-col items-center gap-1 text-[var(--leemo-ink-3)]">
          <span className="sr-only">当前范围：{activeScope.bookId ?? activeWorkspaceId}</span>
        </div>
      </aside>
    </div>
  );
}
