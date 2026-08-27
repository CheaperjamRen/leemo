import { useEffect, useState, type ComponentProps } from "react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { ConversationMeta } from "../stores/conversations";
import type { TimelineItem } from "../stores/message-model";
import { useApprovals, useConversations, useNotebooks, useWorkspaces } from "../bridge/context";
import { deriveConversationStatus } from "../stores/conversation-status";
import { HOME_WORKSPACE_ID } from "../stores/workspaces";
import ConversationListItem from "./ConversationListItem";
import "./HistoryDrawer.css";

type HistoryGroupId = "pinned" | "today" | "recent" | "earlier";

interface HistoryGroup {
  id: HistoryGroupId;
  label: string;
  conversations: ConversationMeta[];
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const EMPTY_TIMELINES: Record<string, TimelineItem[]> = {};

function LiveHistoryConversationItem({
  conversationId,
  ...props
}: Omit<ComponentProps<typeof ConversationListItem>, "status"> & {
  conversationId: string;
}): React.JSX.Element {
  const activeRunId = useConversations((state) => state.runIds[conversationId] ?? null);
  const terminalTimeline = useConversations((state) => (
    activeRunId ? undefined : state.timelines[conversationId]
  ));
  const pending = useApprovals((state) => state.pendingByConversation[conversationId] ?? null);
  return (
    <ConversationListItem
      {...props}
      status={deriveConversationStatus({
        timeline: terminalTimeline ?? [],
        activeRunId,
        pending,
      })}
    />
  );
}

function activityTime(conversation: ConversationMeta): number {
  return conversation.lastActivityAt || conversation.lastOpenedAt || conversation.createdAt;
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function groupConversations(conversations: ConversationMeta[], now: number): HistoryGroup[] {
  const today = startOfLocalDay(now);
  const recentBoundary = today - (7 * DAY_MS);
  const sorted = [...conversations].sort((left, right) => activityTime(right) - activityTime(left));
  const groups: HistoryGroup[] = [
    { id: "pinned", label: "置顶", conversations: [] },
    { id: "today", label: "今天", conversations: [] },
    { id: "recent", label: "最近 7 天", conversations: [] },
    { id: "earlier", label: "更早", conversations: [] },
  ];

  for (const conversation of sorted) {
    if (conversation.pinned) {
      groups[0].conversations.push(conversation);
      continue;
    }
    const timestamp = activityTime(conversation);
    if (timestamp >= today) groups[1].conversations.push(conversation);
    else if (timestamp >= recentBoundary) groups[2].conversations.push(conversation);
    else groups[3].conversations.push(conversation);
  }

  return groups.filter((group) => group.conversations.length > 0);
}

function formatActivityTime(conversation: ConversationMeta, now: number): string {
  const timestamp = activityTime(conversation);
  const date = new Date(timestamp);
  const today = startOfLocalDay(now);
  const day = startOfLocalDay(timestamp);
  if (day === today) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  if (day === today - DAY_MS) return "昨天";
  if (date.getFullYear() === new Date(now).getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** Buddy mode keeps global conversations here; notebook conversations remain
 * inside their real workbench so the two surfaces never imply duplicate data. */
export default function HistoryDrawer({
  open,
  onClose,
  relationshipId,
  onPickChapter,
}: {
  open: boolean;
  onClose: () => void;
  relationshipId?: string | null;
  onPickChapter?: (conversationId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<HistoryGroupId, boolean>>>({});
  const byId = useConversations((s) => s.byId);
  const order = useConversations((s) => s.order);
  const renameTitle = useConversations((s) => s.renameTitle);
  const setConversationUnread = useConversations((s) => s.setConversationUnread);
  const pinConversation = useConversations((s) => s.pinConversation);
  const archiveConversation = useConversations((s) => s.archiveConversation);
  const moveConversation = useConversations((s) => s.moveConversation);
  const deleteConversation = useConversations((s) => s.deleteConversation);
  // Search needs message bodies; a closed drawer and an empty search do not.
  const timelines = useConversations((s) => open && q.trim() !== "" ? s.timelines : EMPTY_TIMELINES);
  const notebookList = useNotebooks((s) => s.list);
  const workspaceList = useWorkspaces((s) => s.list);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setQ("");
      setShowArchived(false);
      setCollapsedGroups({});
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const now = Date.now();
  const conversations = order
    .flatMap((id) => byId[id] ?? [])
    .filter((conversation) =>
      conversation.source === "buddy"
        && (conversation.workspaceId ?? HOME_WORKSPACE_ID) === HOME_WORKSPACE_ID
        && conversation.bookId === null
    );
  const query = q.trim();
  const normalizedQuery = query.toLocaleLowerCase();
  const matchesQuery = (conversation: ConversationMeta) => query === ""
    || conversation.title.toLocaleLowerCase().includes(normalizedQuery)
    || (timelines[conversation.id] ?? []).some((item) => (
      item.kind === "text" && item.text.toLocaleLowerCase().includes(normalizedQuery)
    ));
  const visible = conversations.filter((conversation) => !conversation.archived && matchesQuery(conversation));
  const groups = groupConversations(visible, now);
  const archived = conversations
    .filter((conversation) => conversation.archived && matchesQuery(conversation))
    .sort((left, right) => activityTime(right) - activityTime(left));
  const archivedCount = conversations.filter((conversation) => conversation.archived).length;
  const archiveOpen = showArchived || query !== "";
  const moveTargets = [
    ...notebookList.map((book) => ({ workspaceId: HOME_WORKSPACE_ID, bookId: book.id, label: book.title })),
    ...workspaceList
      .filter((workspace) => workspace.kind === "external" && workspace.available)
      .map((workspace) => ({ workspaceId: workspace.id, bookId: null, label: workspace.name })),
  ];

  const dismiss = () => {
    setQ("");
    setShowArchived(false);
    setCollapsedGroups({});
    onClose();
  };

  const pick = (id: string) => {
    onPickChapter?.(id);
    dismiss();
  };

  const row = (conversation: ConversationMeta) => (
    <li key={conversation.id} className="buddy-history-row">
      <LiveHistoryConversationItem
        conversationId={conversation.id}
        conversation={conversation}
        active={conversation.id === relationshipId}
        variant="buddy"
        onPick={() => pick(conversation.id)}
        onRename={(title) => renameTitle(conversation.id, title)}
        onUnread={(unread) => setConversationUnread(conversation.id, unread)}
        onPin={(pinned) => pinConversation(conversation.id, pinned)}
        onArchive={(archivedValue) => archiveConversation(conversation.id, archivedValue)}
        onDelete={() => deleteConversation(conversation.id)}
        moveTargets={moveTargets}
        onMove={(target) => moveConversation(conversation.id, target)}
      />
      <span className="buddy-history-row-time" aria-hidden>{formatActivityTime(conversation, now)}</span>
    </li>
  );

  return (
    <>
      <div
        data-testid="buddy-history-scrim"
        className="buddy-history-scrim"
        onClick={dismiss}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="momo 的记录"
        data-history-drawer="buddy"
        className="buddy-history-drawer"
        onKeyDown={(event) => { if (event.key === "Escape") dismiss(); }}
      >
        <header className="buddy-history-header">
          <h2>momo 的记录</h2>
          <button type="button" className="buddy-history-close" aria-label="关闭记录" onClick={dismiss}>
            <X aria-hidden />
          </button>
        </header>

        <div className="buddy-history-controls">
          <label className="buddy-history-search">
            <Search aria-hidden />
            <input
              role="searchbox"
              aria-label="搜索记录"
              placeholder="搜索记录"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
        </div>

        <div className="buddy-history-list" data-testid="buddy-history-list">
          {conversations.length === 0 ? (
            <p className="buddy-history-empty">还没有记录</p>
          ) : groups.length === 0 && archived.length === 0 ? (
            <p className="buddy-history-empty">没有匹配的记录</p>
          ) : (
            groups.map((group) => {
              const collapsed = collapsedGroups[group.id] === true;
              return (
                <section key={group.id} data-testid="buddy-history-group" data-group={group.id} className="buddy-history-group">
                  <button
                    type="button"
                    className="buddy-history-group-heading"
                    aria-label={`${collapsed ? "展开" : "折叠"}${group.label}`}
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !collapsed }))}
                  >
                    <span>{group.label}</span>
                    {collapsed ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
                  </button>
                  {!collapsed && <ul>{group.conversations.map(row)}</ul>}
                </section>
              );
            })
          )}
        </div>

        {archivedCount > 0 && (
          <div className="buddy-history-archive">
            {archiveOpen && archived.length > 0 && <ul>{archived.map(row)}</ul>}
            <button
              type="button"
              aria-label={`已归档 ${archivedCount}`}
              aria-expanded={archiveOpen}
              onClick={() => setShowArchived((shown) => !shown)}
            >
              <span>已归档</span>
              {archiveOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
