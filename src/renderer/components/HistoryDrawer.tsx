import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Settings } from "lucide-react";
import { useApprovals, useConversations, useNotebooks, useUi, useWorkspaces } from "../bridge/context";
import { deriveConversationStatus } from "../stores/conversation-status";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import ConversationListItem from "./ConversationListItem";

/** The buddy-mode history drawer.
 *
 *  Reads the conversations store directly — the same `byId`/`order` the
 *  workbench sidebar renders — so the two shells can never disagree about what
 *  history exists. (This list used to be three hardcoded fixture strings, which
 *  meant buddy mode showed conversations that did not exist and could not open
 *  the ones that did.) */
export default function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const byId = useConversations((s) => s.byId);
  const order = useConversations((s) => s.order);
  const activeId = useConversations((s) => s.activeId);
  const switchActive = useConversations((s) => s.switchActive);
  const createConversation = useConversations((s) => s.createConversation);
  const renameTitle = useConversations((s) => s.renameTitle);
  const pinConversation = useConversations((s) => s.pinConversation);
  const archiveConversation = useConversations((s) => s.archiveConversation);
  const moveConversation = useConversations((s) => s.moveConversation);
  const deleteConversation = useConversations((s) => s.deleteConversation);
  const timelines = useConversations((s) => s.timelines);
  const runIds = useConversations((s) => s.runIds);
  const notebookList = useNotebooks((s) => s.list);
  const workspaceList = useWorkspaces((s) => s.list);
  const pendingByConversation = useApprovals((s) => s.pendingByConversation);
  const openSettings = useUi((s) => s.openSettings);

  if (!open) return null;

  // 搭子态 is momo's global view. Conversations that belong to a 本子 stay in
  // that 本子's workbench; otherwise switching modes leaks unrelated context.
  const conversations = order
    .flatMap((id) => byId[id] ?? [])
    .filter((conversation) =>
      (conversation.workspaceId ?? HOME_WORKSPACE_ID) === HOME_WORKSPACE_ID
        && conversation.bookId === null
    );
  const pinnedFirst = (left: (typeof conversations)[number], right: (typeof conversations)[number]) =>
    Number(right.pinned ?? false) - Number(left.pinned ?? false);
  const query = q.trim();
  const matchesQuery = (title: string) => query === "" || title.includes(query);
  const list = conversations.filter((c) => !c.archived && matchesQuery(c.title)).sort(pinnedFirst);
  const archived = conversations.filter((c) => c.archived && matchesQuery(c.title)).sort(pinnedFirst);
  const archivedCount = conversations.filter((c) => c.archived).length;
  const archiveOpen = showArchived || query !== "";
  const moveTargets = [
    ...notebookList.map((book) => ({
      workspaceId: HOME_WORKSPACE_ID,
      bookId: book.id,
      label: book.title,
    })),
    ...workspaceList
      .filter((workspace) => workspace.kind === "external" && workspace.available)
      .map((workspace) => ({
        workspaceId: workspace.id,
        bookId: null,
        label: workspace.name,
      })),
  ];

  const dismiss = () => {
    setQ(""); // don't strand a stale filter on the next open
    setShowArchived(false);
    onClose();
  };

  const pick = (id: string) => {
    switchActive(id);
    dismiss();
  };

  const startNew = async () => {
    // Mirrors the workbench's "new chat" button. Failure is non-fatal: the
    // drawer just stays put rather than closing onto nothing.
    const id = await createConversation({ source: "buddy", bookId: null });
    switchActive(id);
    dismiss();
  };

  const row = (conversation: (typeof conversations)[number]) => (
    <li key={conversation.id}>
      <ConversationListItem
        conversation={conversation}
        active={conversation.id === activeId}
        variant="buddy"
        onPick={() => pick(conversation.id)}
        onRename={(title) => renameTitle(conversation.id, title)}
        onPin={(pinned) => pinConversation(conversation.id, pinned)}
        onArchive={(archivedValue) => archiveConversation(conversation.id, archivedValue)}
        onDelete={() => deleteConversation(conversation.id)}
        moveTargets={moveTargets}
        onMove={(target) => moveConversation(conversation.id, target)}
        status={deriveConversationStatus({
          timeline: timelines[conversation.id] ?? [],
          activeRunId: runIds[conversation.id] ?? null,
          pending: pendingByConversation[conversation.id] ?? null,
        })}
      />
    </li>
  );

  return (
    <>
      <div onClick={dismiss} className="fixed inset-0 z-30" style={{ background: "rgba(0,0,0,.2)" }} />
      <aside className="leemo-card-shadow-hover fixed left-0 top-0 z-40 flex h-full w-[320px] flex-col border-r border-[var(--leemo-line)] bg-[var(--leemo-card)] p-4"
        onKeyDown={(e) => { if (e.key === "Escape") dismiss(); }}>
        <input role="search" aria-label="搜索对话" placeholder="搜索…" value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-3 w-full shrink-0 rounded-lg border border-[var(--leemo-line)] bg-white px-3 py-2 text-sm text-[var(--leemo-ink)] outline-none transition placeholder:text-[var(--leemo-ink-3)] focus:border-[var(--leemo-amber)] focus:ring-2 focus:ring-[var(--leemo-amber-soft)]/60" />

        {/* The list scrolls on its own so a long history never pushes 设置 out
            of the drawer. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--leemo-ink-3)]">还没有对话</p>
          ) : list.length === 0 && archived.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--leemo-ink-3)]">没有匹配的对话</p>
          ) : (
            <>
              {list.length > 0 && <ul className="space-y-1">{list.map(row)}</ul>}
              {archivedCount > 0 && (
                <div className="mt-2 border-t border-[var(--leemo-line-soft)] pt-2">
                  <button
                    type="button"
                    aria-label={`已归档 ${archivedCount}`}
                    aria-expanded={archiveOpen}
                    onClick={() => setShowArchived((shown) => !shown)}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--leemo-ink-3)] transition-colors hover:bg-[var(--leemo-line-soft)] hover:text-[var(--leemo-ink-2)]"
                  >
                    {archiveOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                    <span>已归档 {archivedCount}</span>
                  </button>
                  {archiveOpen && archived.length > 0 && <ul className="mt-1 space-y-1">{archived.map(row)}</ul>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-3 shrink-0 border-t border-[var(--leemo-line)] pt-3">
          <button type="button" onClick={() => void startNew()}
            className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-line-soft)] hover:text-[var(--leemo-ink)]">
            <Plus className="h-4 w-4" aria-hidden />
            开始新对话
          </button>
          <button type="button" onClick={() => { openSettings("general"); dismiss(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--leemo-ink-2)] transition-colors hover:bg-[var(--leemo-line-soft)] hover:text-[var(--leemo-ink)]">
            <Settings className="h-4 w-4" aria-hidden />
            设置
          </button>
        </div>
      </aside>
    </>
  );
}
