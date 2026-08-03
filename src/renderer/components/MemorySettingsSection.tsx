import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import {
  Check,
  FolderOpen,
  History,
  MessageSquare,
  Pencil,
  Pin,
  RotateCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { MemoryScopeView, MemorySourceTypeView, MemoryStatusView, MemoryView } from "../../bridge/contract";
import type { MemoryState } from "../stores/memory";

type ScopeFilter = "all" | "global" | "book";

export interface MemorySettingsNotebook {
  id: string;
  title: string;
}

export interface MemorySettingsWorkspace {
  id: string;
  name: string;
  available: boolean;
}

export interface MemorySettingsConversation {
  id: string;
  title: string;
}

export interface MemorySettingsSectionProps {
  store: StoreApi<MemoryState>;
  notebooks: MemorySettingsNotebook[];
  workspaces: MemorySettingsWorkspace[];
  conversations: Record<string, MemorySettingsConversation>;
  rememberMode: boolean;
  onRememberModeChange(enabled: boolean): void;
  onOpenConversation(conversationId: string): void;
}

const KIND_LABELS: Record<MemoryView["kind"], string> = {
  profile: "个人资料",
  preference: "偏好",
  state: "近况",
  goal: "目标",
  episode: "重要经历",
  notebook: "本子约定",
};

const SOURCE_LABELS: Record<MemorySourceTypeView, string> = {
  "explicit-user": "用户明确说",
  "native-auto": "momo 自动整理",
  "legacy-import": "旧数据迁移",
  "settings-edit": "你在设置里修改",
};

const STATUS_LABELS: Record<MemoryStatusView, string> = {
  current: "当前有效",
  uncertain: "待确认",
  superseded: "已被新信息替代",
  deleted: "已删除",
};

function formatDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function actionSummary(statement: string): string {
  const normalized = statement.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= 48 ? normalized : `${characters.slice(0, 48).join("")}…`;
}

type FocusTarget = {
  action: "edit" | "delete";
  id?: string;
};

export default function MemorySettingsSection({
  store,
  notebooks,
  workspaces,
  conversations,
  rememberMode,
  onRememberModeChange,
  onOpenConversation,
}: MemorySettingsSectionProps): React.JSX.Element {
  const memory = useStore(store);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [directoryValue, setDirectoryValue] = useState("global");
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const [editing, setEditing] = useState<{ id: string; statement: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingActionIds, setPendingActionIds] = useState<string[]>([]);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const sectionTitleRef = useRef<HTMLHeadingElement | null>(null);
  const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const notebookTitles = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook.title])),
    [notebooks],
  );
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );
  const scopes = useMemo<MemoryScopeView[]>(() => [
    { type: "global" },
    ...notebooks.map((notebook) => ({ type: "notebook" as const, notebookId: notebook.id })),
    ...workspaces
      .filter((workspace) => workspace.available)
      .map((workspace) => ({ type: "workspace" as const, workspaceId: workspace.id })),
  ], [notebooks, workspaces]);
  const refreshMemory = useCallback(async () => {
    await store.getState().refresh(scopes);
  }, [scopes, store]);

  useEffect(() => {
    void refreshMemory();
  }, [refreshMemory]);

  useEffect(() => {
    if (directoryValue === "global") return;
    if (directoryValue.startsWith("notebook:")) {
      const notebookId = directoryValue.slice("notebook:".length);
      if (!notebooks.some((notebook) => notebook.id === notebookId)) setDirectoryValue("global");
      return;
    }
    if (directoryValue.startsWith("workspace:")) {
      const workspaceId = directoryValue.slice("workspace:".length);
      if (!workspaces.some((workspace) => workspace.id === workspaceId && workspace.available)) {
        setDirectoryValue("global");
      }
      return;
    }
    setDirectoryValue("global");
  }, [directoryValue, notebooks, workspaces]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useLayoutEffect(() => {
    if (!focusTarget) return;
    const refs = focusTarget.action === "edit" ? editButtonRefs.current : deleteButtonRefs.current;
    const element = focusTarget.id ? refs.get(focusTarget.id) : undefined;
    (element ?? sectionTitleRef.current)?.focus();
    setFocusTarget(null);
  }, [confirmDeleteId, editing, focusTarget, memory.records]);

  const beginAction = (id: string) => {
    setPendingActionIds((current) => current.includes(id) ? current : [...current, id]);
  };

  const endAction = (id: string) => {
    setPendingActionIds((current) => current.filter((candidate) => candidate !== id));
  };

  const scopeLabel = (scope: MemoryScopeView): string => {
    if (scope.type === "global") return "关于我";
    if (scope.type === "notebook") return notebookTitles.get(scope.notebookId) ?? scope.notebookId;
    return workspaceNames.get(scope.workspaceId) ?? scope.workspaceId;
  };

  const selectScopeFilter = (next: ScopeFilter) => {
    setScopeFilter(next);
    if (next === "global") {
      setDirectoryValue("global");
      return;
    }
    if (next === "book" && !directoryValue.startsWith("notebook:") && !directoryValue.startsWith("workspace:")) {
      const firstNotebook = notebooks[0];
      const firstWorkspace = workspaces.find((workspace) => workspace.available);
      if (firstNotebook) setDirectoryValue(`notebook:${firstNotebook.id}`);
      else if (firstWorkspace) setDirectoryValue(`workspace:${firstWorkspace.id}`);
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRecords = memory.records
    .filter((record) => (
      scopeFilter === "all"
      || (scopeFilter === "global" && record.scope.type === "global")
      || (scopeFilter === "book" && (record.scope.type === "notebook" || record.scope.type === "workspace"))
    ))
    .filter((record) => {
      if (!normalizedQuery) return true;
      return [record.statement, record.topic, KIND_LABELS[record.kind], scopeLabel(record.scope)]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned)
      || (b.lastConfirmedAt ?? b.learnedAt) - (a.lastConfirmedAt ?? a.learnedAt));

  const openSelectedDirectory = async () => {
    const scope: MemoryScopeView = directoryValue === "global"
      ? { type: "global" }
      : directoryValue.startsWith("notebook:")
        ? { type: "notebook", notebookId: directoryValue.slice("notebook:".length) }
        : { type: "workspace", workspaceId: directoryValue.slice("workspace:".length) };
    setOpeningDirectory(true);
    try {
      await memory.openDirectory(scope);
    } catch {
      // The directory-specific store error stays beside this action for retry.
    } finally {
      setOpeningDirectory(false);
    }
  };

  const saveEdit = async (record: MemoryView) => {
    if (!editing || editing.id !== record.id || !editing.statement.trim()) return;
    beginAction(record.id);
    try {
      const change = await memory.update({
        scope: record.scope,
        id: record.id,
        statement: editing.statement,
      });
      setEditing(null);
      setFocusTarget({ action: "edit", id: change.memory.id });
    } catch {
      // Keep the editor open so the user can retry without retyping.
    } finally {
      endAction(record.id);
    }
  };

  const togglePin = async (record: MemoryView) => {
    beginAction(record.id);
    try {
      await memory.pin(record.scope, record.id, !record.pinned);
    } catch {
      // The existing value stays visible and the store explains the failure.
    } finally {
      endAction(record.id);
    }
  };

  const deleteRecord = async (record: MemoryView) => {
    const index = filteredRecords.findIndex((candidate) => candidate.id === record.id);
    const nextRecord = filteredRecords[index + 1] ?? filteredRecords[index - 1];
    beginAction(record.id);
    try {
      await memory.remove(record.scope, record.id);
      setConfirmDeleteId(null);
      if (historyOpenId === record.id) setHistoryOpenId(null);
      setFocusTarget({ action: "edit", id: nextRecord?.id });
    } catch {
      // Keep the confirmation in place; a failed delete must never look successful.
    } finally {
      endAction(record.id);
    }
  };

  const loadHistory = async (record: MemoryView) => {
    try {
      await memory.loadHistory(record.scope, record.id);
    } catch {
      // The record-specific history error remains beside the retry action.
    }
  };

  const toggleHistory = (record: MemoryView) => {
    if (historyOpenId === record.id) {
      setHistoryOpenId(null);
      return;
    }
    setHistoryOpenId(record.id);
    void loadHistory(record);
  };

  return (
    <section className="mb-8" aria-labelledby="memory-settings-title">
      <div className="border-y border-[var(--leemo-line)] py-4">
        <div className="flex items-center justify-between gap-5">
          <div className="min-w-0">
            <h2
              ref={sectionTitleRef}
              id="memory-settings-title"
              tabIndex={-1}
              className="rounded-sm text-xl font-medium text-[var(--leemo-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--leemo-amber)]"
            >
              momo 记得的
            </h2>
            <span className="mt-1 block max-w-2xl text-xs leading-5 text-[var(--leemo-ink-3)]">
              开启后，momo 会在合适时机记住长期有用的信息；关闭后不会新增，也不会删除已有记忆。
            </span>
          </div>
          <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                aria-label="启用自动记忆"
                checked={rememberMode}
                onChange={(event) => onRememberModeChange(event.target.checked)}
                className="peer sr-only"
              />
              <span className="absolute inset-0 rounded-full bg-[var(--leemo-line)] transition-colors peer-checked:bg-[var(--leemo-amber)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--leemo-amber)]" />
              <span className="relative ml-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
          </label>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[190px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--leemo-ink-3)]" aria-hidden />
          <input
            type="search"
            aria-label="搜索记忆"
            placeholder="搜索 momo 记得的内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] pl-9 pr-3 text-sm text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)]"
          />
        </label>
        <div className="inline-flex h-9 shrink-0 overflow-hidden rounded-md border border-[var(--leemo-line)]" aria-label="记忆范围">
          {([
            { id: "all", label: "全部", aria: "查看全部记忆" },
            { id: "global", label: "关于我", aria: "只看关于我的记忆" },
            { id: "book", label: "本子", aria: "只看本子记忆" },
          ] as const).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={item.aria}
              aria-pressed={scopeFilter === item.id}
              onClick={() => selectScopeFilter(item.id)}
              className={`min-w-14 px-3 text-xs transition-colors ${
                scopeFilter === item.id
                  ? "bg-[var(--leemo-ink)] text-white"
                  : "bg-white text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-bg)]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <select
          aria-label="要打开的记忆目录"
          value={directoryValue}
          onChange={(event) => setDirectoryValue(event.target.value)}
          className="h-8 min-w-32 rounded-md border border-[var(--leemo-line)] bg-white px-2 text-xs text-[var(--leemo-ink-2)] outline-none focus:border-[var(--leemo-amber)]"
        >
          <option value="global">关于我</option>
          {notebooks.map((notebook) => (
            <option key={notebook.id} value={`notebook:${notebook.id}`}>本子：{notebook.title}</option>
          ))}
          {workspaces.filter((workspace) => workspace.available).map((workspace) => (
            <option key={workspace.id} value={`workspace:${workspace.id}`}>本子：{workspace.name}</option>
          ))}
        </select>
        <button
          type="button"
          aria-label="打开本地记忆目录"
          title="打开本地记忆目录"
          disabled={openingDirectory}
          onClick={() => void openSelectedDirectory()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--leemo-line)] bg-white px-3 text-xs font-medium text-[var(--leemo-ink-2)] hover:border-[var(--leemo-amber)] disabled:cursor-wait disabled:opacity-60"
        >
          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          {openingDirectory ? "正在打开" : "打开目录"}
        </button>
      </div>

      {memory.listError && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--leemo-danger-line)] py-3 text-xs text-[var(--leemo-danger)]">
          <span className="min-w-0 flex-1 break-words">{memory.listError}</span>
          <button type="button" aria-label="重新读取记忆" onClick={() => void refreshMemory()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-current px-2.5">
            <RotateCw className="h-3.5 w-3.5" aria-hidden />
            重新读取
          </button>
        </div>
      )}

      {memory.directoryError && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--leemo-danger-line)] py-3 text-xs text-[var(--leemo-danger)]">
          <span className="min-w-0 flex-1 break-words">{memory.directoryError}</span>
          <button type="button" aria-label="重新打开记忆目录" onClick={() => void openSelectedDirectory()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-current px-2.5">
            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
            重新打开
          </button>
        </div>
      )}

      {memory.loading && memory.records.length === 0 ? (
        <p role="status" className="py-10 text-center text-sm text-[var(--leemo-ink-3)]">正在读取 momo 的记忆…</p>
      ) : memory.listError && memory.records.length === 0 ? null : memory.records.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--leemo-ink-3)]">momo 还没有需要长期记住的内容</p>
      ) : filteredRecords.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--leemo-ink-3)]">
          {normalizedQuery ? "没有匹配的记忆" : "这个范围里还没有记忆"}
        </p>
      ) : (
        <div className="mt-4 divide-y divide-[var(--leemo-line-soft)] border-y border-[var(--leemo-line)]">
          {filteredRecords.map((record) => {
            const busy = pendingActionIds.includes(record.id);
            const history = memory.historyById[record.id] ?? [];
            const historyError = memory.historyErrors[record.id];
            const historyLoading = memory.historyLoadingIds.includes(record.id);
            const historyOpen = historyOpenId === record.id;
            const summary = actionSummary(record.statement);
            return (
              <article key={record.id} className="py-3.5">
                {memory.mutationErrors[record.id] && (
                  <p role="alert" className="mb-2 break-words text-xs text-[var(--leemo-danger)]">
                    {memory.mutationErrors[record.id]}
                  </p>
                )}
                {editing?.id === record.id ? (
                  <div>
                    <textarea
                      ref={editorRef}
                      autoFocus
                      aria-label="编辑记忆内容"
                      maxLength={8_000}
                      rows={3}
                      value={editing.statement}
                      onChange={(event) => setEditing({ id: record.id, statement: event.target.value })}
                      className="w-full resize-y rounded-md border border-[var(--leemo-line)] bg-[var(--leemo-bg)] px-3 py-2 text-sm leading-6 text-[var(--leemo-ink)] outline-none focus:border-[var(--leemo-amber)]"
                    />
                    <div className="mt-2 flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label="取消记忆修改"
                        title="取消"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                          setFocusTarget({ action: "edit", id: record.id });
                        }}
                        className="grid h-8 w-8 place-items-center rounded-md text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-bg)] hover:text-[var(--leemo-ink)] disabled:opacity-50"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="保存记忆修改"
                        title="保存"
                        disabled={busy || !editing.statement.trim()}
                        onClick={() => void saveEdit(record)}
                        className="grid h-8 w-8 place-items-center rounded-md bg-[var(--leemo-ink)] text-white disabled:opacity-40"
                      >
                        <Check className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                ) : confirmDeleteId === record.id ? (
                  <div role="alertdialog" aria-label="确认删除记忆" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm leading-6 text-[var(--leemo-ink)]">{record.statement}</p>
                      <p className="mt-1 text-xs text-[var(--leemo-danger)]">删除后不会再用于理解你，修改记录仍会保留，方便以后核对。</p>
                    </div>
                    <div className="flex shrink-0 justify-end gap-2">
                      <button
                        type="button"
                        autoFocus
                        aria-label="保留这条记忆"
                        disabled={busy}
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setFocusTarget({ action: "delete", id: record.id });
                        }}
                        className="h-8 rounded-md border border-[var(--leemo-line)] px-3 text-xs text-[var(--leemo-ink-2)]"
                      >
                        保留
                      </button>
                      <button type="button" aria-label="确认删除这条记忆" disabled={busy} onClick={() => void deleteRecord(record)} className="h-8 rounded-md bg-[var(--leemo-danger)] px-3 text-xs font-medium text-white disabled:opacity-50">删除</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm leading-6 text-[var(--leemo-ink)]">{record.statement}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--leemo-ink-3)]">
                          <span>{scopeLabel(record.scope)}</span>
                          <span aria-hidden>·</span>
                          <span>{KIND_LABELS[record.kind]}</span>
                          <span aria-hidden>·</span>
                          <span>最后确认 {formatDate(record.lastConfirmedAt ?? record.learnedAt)}</span>
                        </div>
                      </div>
                      <div className="flex h-8 shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`${record.pinned ? "取消置顶" : "置顶"}记忆：${summary}`}
                          title={record.pinned ? "取消置顶" : "置顶"}
                          aria-pressed={record.pinned}
                          disabled={busy}
                          onClick={() => void togglePin(record)}
                          className={`grid h-8 w-8 place-items-center rounded-md hover:bg-[var(--leemo-bg)] disabled:opacity-40 ${record.pinned ? "text-[var(--leemo-amber)]" : "text-[var(--leemo-ink-3)]"}`}
                        >
                          <Pin className="h-4 w-4" aria-hidden fill={record.pinned ? "currentColor" : "none"} />
                        </button>
                        <button
                          ref={(node) => {
                            if (node) editButtonRefs.current.set(record.id, node);
                            else editButtonRefs.current.delete(record.id);
                          }}
                          type="button"
                          aria-label={`编辑记忆：${summary}`}
                          title="编辑"
                          disabled={busy}
                          onClick={() => { setEditing({ id: record.id, statement: record.statement }); setConfirmDeleteId(null); }}
                          className="grid h-8 w-8 place-items-center rounded-md text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-bg)] hover:text-[var(--leemo-ink)] disabled:opacity-40"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`查看记忆历史：${summary}`}
                          title="历史与来源"
                          aria-expanded={historyOpen}
                          disabled={busy}
                          onClick={() => toggleHistory(record)}
                          className="grid h-8 w-8 place-items-center rounded-md text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-bg)] hover:text-[var(--leemo-ink)] disabled:opacity-40"
                        >
                          <History className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          ref={(node) => {
                            if (node) deleteButtonRefs.current.set(record.id, node);
                            else deleteButtonRefs.current.delete(record.id);
                          }}
                          type="button"
                          aria-label={`删除记忆：${summary}`}
                          title="删除"
                          disabled={busy}
                          onClick={() => { setConfirmDeleteId(record.id); setEditing(null); }}
                          className="grid h-8 w-8 place-items-center rounded-md text-[var(--leemo-ink-3)] hover:bg-[var(--leemo-danger-soft)] hover:text-[var(--leemo-danger)] disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </div>

                    {historyOpen && (
                      <div className="mt-3 border-l-2 border-[var(--leemo-line)] pl-4">
                        {historyLoading ? (
                          <p role="status" className="py-2 text-xs text-[var(--leemo-ink-3)]">正在读取历史…</p>
                        ) : historyError ? (
                          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-[var(--leemo-danger)]">
                            <span className="min-w-0 flex-1 break-words">{historyError}</span>
                            <button
                              type="button"
                              aria-label="重新读取这条记忆的历史"
                              onClick={() => void loadHistory(record)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-current px-2.5"
                            >
                              <RotateCw className="h-3.5 w-3.5" aria-hidden />
                              重新读取
                            </button>
                          </div>
                        ) : history.length === 0 ? (
                          <p className="py-2 text-xs text-[var(--leemo-ink-3)]">还没有更早的版本</p>
                        ) : (
                          <div className="divide-y divide-[var(--leemo-line-soft)]">
                            {history.map((version) => {
                              const source = version.sourceConversationId
                                ? conversations[version.sourceConversationId]
                                : undefined;
                              return (
                                <div key={`${version.id}:${version.learnedAt}`} className="py-2.5">
                                  <p className="break-words text-xs leading-5 text-[var(--leemo-ink-2)]">{version.statement}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-[var(--leemo-ink-3)]">
                                    <span>{STATUS_LABELS[version.status]}</span>
                                    <span aria-hidden>·</span>
                                    <span>{SOURCE_LABELS[version.sourceType]}</span>
                                    <span aria-hidden>·</span>
                                    <span>{formatDate(version.validFrom ?? version.learnedAt)}{version.validTo ? ` 至 ${formatDate(version.validTo)}` : " 起"}</span>
                                    {source ? (
                                      <button
                                        type="button"
                                        aria-label={`查看来源对话：${source.title}`}
                                        onClick={() => onOpenConversation(source.id)}
                                        className="inline-flex items-center gap-1 underline decoration-[var(--leemo-line)] underline-offset-2 hover:text-[var(--leemo-ink)]"
                                      >
                                        <MessageSquare className="h-3 w-3" aria-hidden />
                                        {source.title}
                                      </button>
                                    ) : version.sourceConversationId ? (
                                      <span>来源对话已不存在</span>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
