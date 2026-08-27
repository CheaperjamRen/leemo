import { useContext, useMemo, useState } from "react";
import { ArchiveRestore, Folder, MessageCircle, Search, Trash2 } from "lucide-react";
import { useStore } from "zustand";
import { BridgeContext, type BridgeStores } from "../bridge/context";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";

type ArchivedRow =
  | { kind: "conversation"; id: string; title: string; owner: string; running: boolean }
  | { kind: "notebook"; id: string; title: string; owner: string }
  | { kind: "workspace"; id: string; title: string; owner: string };

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export default function ArchivedContentSettings(): React.JSX.Element {
  const stores = useContext(BridgeContext) as BridgeStores;
  const conversations = useStore(stores.conversations, (state) => state.byId);
  const runIds = useStore(stores.conversations, (state) => state.runIds);
  const archiveConversation = useStore(stores.conversations, (state) => state.archiveConversation);
  const deleteConversation = useStore(stores.conversations, (state) => state.deleteConversation);
  const notebooks = useStore(stores.notebooks, (state) => state.list);
  const setNotebookArchived = useStore(stores.notebooks, (state) => state.setNotebookArchived);
  const workspaces = useStore(stores.workspaces!, (state) => state.list);
  const setWorkspaceArchived = useStore(stores.workspaces!, (state) => state.setArchived);
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const notebookById = useMemo(() => new Map(notebooks.map((book) => [book.id, book.title])), [notebooks]);
  const workspaceById = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])), [workspaces]);
  const rows = useMemo<ArchivedRow[]>(() => {
    const conversationRows = Object.values(conversations)
      .filter((conversation) => conversation.archived)
      .map((conversation): ArchivedRow => {
        const workspaceId = conversation.workspaceId ?? HOME_WORKSPACE_ID;
        const owner = conversation.bookId
          ? notebookById.get(conversation.bookId) ?? conversation.bookId
          : workspaceId === HOME_WORKSPACE_ID
            ? "默认工作区"
            : workspaceById.get(workspaceId) ?? "已打开文件夹";
        return {
          kind: "conversation",
          id: conversation.id,
          title: conversation.title.trim() || "未命名对话",
          owner,
          running: Boolean(runIds[conversation.id]),
        };
      });
    const notebookRows = notebooks
      .filter((book) => book.archived)
      .map((book): ArchivedRow => ({ kind: "notebook", id: book.id, title: book.title, owner: "Leemo 本子" }));
    const workspaceRows = workspaces
      .filter((workspace) => workspace.kind === "external" && workspace.archived)
      .map((workspace): ArchivedRow => ({
        kind: "workspace",
        id: workspace.id,
        title: workspace.name,
        owner: workspace.displayPath,
      }));
    return [...conversationRows, ...notebookRows, ...workspaceRows]
      .sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
  }, [conversations, notebookById, notebooks, runIds, workspaceById, workspaces]);
  const needle = normalized(query);
  const visibleRows = needle
    ? rows.filter((row) => normalized(`${row.title}\n${row.owner}`).includes(needle))
    : rows;
  const pendingDelete = confirmDeleteId
    ? rows.find((row): row is Extract<ArchivedRow, { kind: "conversation" }> => (
        row.kind === "conversation" && row.id === confirmDeleteId
      ))
    : undefined;

  const perform = async (key: string, action: () => Promise<unknown>): Promise<void> => {
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyKey(null);
    }
  };

  const restore = (row: ArchivedRow): void => {
    if (row.kind === "conversation") {
      void perform(`conversation:${row.id}`, () => archiveConversation(row.id, false));
    } else if (row.kind === "notebook") {
      void perform(`notebook:${row.id}`, () => setNotebookArchived(row.id, false));
    } else {
      void perform(`workspace:${row.id}`, () => setWorkspaceArchived(row.id, false));
    }
  };

  return (
    <section
      className="settings-archive mt-8 border-t border-[var(--leemo-line)] pt-7"
      aria-label="已归档内容"
    >
      <div className="settings-section-heading">
        <h3>已归档内容</h3>
        <p>归档后的对话和本子会安静地留在这里，需要时再恢复。</p>
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-panel)] px-4 py-5 text-center text-xs text-[var(--leemo-ink-3)]">
          目前没有已归档内容
        </div>
      ) : (
        <>
          <label className="mt-3 flex h-9 items-center gap-2 rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-surface)] px-3 text-[var(--leemo-ink-3)] focus-within:border-[var(--leemo-amber-line)]">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <input
              type="search"
              aria-label="搜索已归档内容"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索标题或本子"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--leemo-ink)] outline-none placeholder:text-[var(--leemo-ink-4)]"
            />
          </label>
          <div className="mt-3 overflow-hidden rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] bg-[var(--leemo-surface)]">
            {visibleRows.length === 0 ? (
              <p className="px-4 py-5 text-center text-xs text-[var(--leemo-ink-3)]">没有匹配的归档内容</p>
            ) : visibleRows.map((row) => {
              const key = `${row.kind}:${row.id}`;
              const Icon = row.kind === "conversation" ? MessageCircle : Folder;
              return (
                <div key={key} className="flex min-h-[52px] items-center gap-3 border-b border-[var(--leemo-line-soft)] px-3 py-2 last:border-b-0">
                  <Icon className="h-4 w-4 shrink-0 text-[var(--leemo-ink-3)]" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs font-medium text-[var(--leemo-ink)]" title={row.title}>{row.title}</strong>
                    <small className="mt-0.5 block truncate text-[10.5px] text-[var(--leemo-ink-3)]" title={row.owner}>{row.owner}</small>
                  </span>
                  {row.kind === "conversation" && (
                    <button
                      type="button"
                      aria-label={`删除对话 ${row.title}`}
                      title={row.running ? "运行结束后可删除" : "删除对话"}
                      disabled={Boolean(busyKey) || row.running}
                      onClick={() => setConfirmDeleteId(row.id)}
                      className="leemo-icon-btn h-7 w-7 text-[var(--leemo-ink-3)] hover:text-[var(--leemo-danger)] disabled:opacity-35"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`恢复${row.kind === "conversation" ? "对话" : "本子"} ${row.title}`}
                    disabled={Boolean(busyKey)}
                    onClick={() => restore(row)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--leemo-radius-control)] border border-[var(--leemo-line)] px-2.5 text-[11px] text-[var(--leemo-ink-2)] transition-colors hover:border-[var(--leemo-amber-line)] hover:bg-[var(--leemo-amber-bg)] disabled:opacity-40"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                    恢复
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-[var(--leemo-danger)]">{error}</p>}

      {pendingDelete && (
        <div className="mt-3 rounded-[var(--leemo-radius-control)] border border-[var(--leemo-danger)]/25 bg-[var(--leemo-danger)]/5 p-3" role="alertdialog" aria-label="删除已归档对话">
          <p className="text-xs font-medium text-[var(--leemo-ink)]">删除“{pendingDelete.title}”？</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--leemo-ink-3)]">这会移除本地对话记录，已有文件仍保留在原文件夹。</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" disabled={Boolean(busyKey)} onClick={() => setConfirmDeleteId(null)} className="h-8 rounded-[var(--leemo-radius-control)] px-3 text-xs text-[var(--leemo-ink-2)] hover:bg-[var(--leemo-side-hover)]">取消</button>
            <button
              type="button"
              aria-label={`确认删除对话 ${pendingDelete.title}`}
              disabled={Boolean(busyKey)}
              onClick={() => void perform(`delete:${pendingDelete.id}`, async () => {
                await deleteConversation(pendingDelete.id);
                setConfirmDeleteId(null);
              })}
              className="h-8 rounded-[var(--leemo-radius-control)] bg-[var(--leemo-danger)] px-3 text-xs font-medium text-white disabled:opacity-40"
            >
              删除对话
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
