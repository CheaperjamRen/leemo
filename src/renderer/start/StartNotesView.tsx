import { Archive, Clock3, FileText, Inbox, Pin, Trash2 } from "lucide-react";
import { useCaptures } from "../bridge/context";
import type { StartDestination } from "./start-navigation";
import { markdownPreviewText } from "../components/markdown-normalization";

const COPY: Record<Exclude<StartDestination, "home" | "overview" | "tasks" | "locations">, { title: string; description: string; icon: typeof FileText }> = {
  inbox: { title: "收集箱", description: "尚未归入文档树的随手记录。", icon: Inbox },
  pinned: { title: "置顶", description: "你主动置顶的文档。", icon: Pin },
  recent: { title: "最近", description: "最近编辑过的本地便签。", icon: Clock3 },
  documents: { title: "文档库", description: "整理和编辑本地文档。", icon: FileText },
  archive: { title: "已归档", description: "暂时收起、不再出现在日常列表中的文档。", icon: Archive },
  trash: { title: "回收站", description: "最近删除的内容。", icon: Trash2 },
};

export default function StartNotesView({ destination, selectedNoteId = null, onOpenNote }: { destination: Exclude<StartDestination, "home" | "overview" | "tasks" | "locations">; selectedNoteId?: string | null; onOpenNote?: (noteId: string) => void }) {
  const notes = useCaptures((state) => destination === "archive" ? state.archivedNotes : state.notes);
  const copy = COPY[destination];
  const Icon = copy.icon;
  const shown = destination === "inbox"
    ? notes.filter((note) => note.organizedAt === null)
    : destination === "pinned"
      ? notes.filter((note) => note.pinnedAt !== null).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
      : destination === "recent"
        ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
        : notes;
  return (
    <div className="leemo-start-simple-page">
      <header className="leemo-start-page-heading"><div><h1>{copy.title}</h1><p>{copy.description}</p></div></header>
      {shown.length > 0 && ["inbox", "pinned", "recent", "archive"].includes(destination) ? (
        <section className="leemo-start-note-list" aria-label={copy.title}>
          {shown.map((note) => <article key={note.id} className={selectedNoteId === note.id ? "is-selected" : undefined}><button type="button" aria-label={`打开文档 ${note.title || "无标题便签"}`} onClick={() => onOpenNote?.(note.id)}><Icon aria-hidden /><div><h2>{note.title || "无标题便签"}</h2><p>{markdownPreviewText(note.markdown) || "空白便签"}</p></div><time>{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</time></button></article>)}
        </section>
      ) : (
        <div className="leemo-start-simple-empty"><Icon aria-hidden /><p>{destination === "inbox" ? "还没有随手记录。" : destination === "pinned" ? "还没有置顶文档。" : copy.description}</p></div>
      )}
    </div>
  );
}
