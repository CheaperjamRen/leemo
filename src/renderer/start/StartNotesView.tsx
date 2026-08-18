import { Archive, Clock3, FileText, Inbox, MapPin, Pin, Trash2 } from "lucide-react";
import { useCaptures } from "../bridge/context";
import type { StartDestination } from "./start-navigation";

const COPY: Record<Exclude<StartDestination, "home" | "overview" | "tasks">, { title: string; description: string; icon: typeof FileText }> = {
  inbox: { title: "收集箱", description: "未经整理的随手记录。记录后不会自动触发 AI。", icon: Inbox },
  pinned: { title: "置顶", description: "这里将在文档整理能力接通后展示你主动置顶的内容。", icon: Pin },
  recent: { title: "最近", description: "最近编辑过的本地便签。", icon: Clock3 },
  locations: { title: "位置", description: "外部文件位置仍由 Windows 资源管理器管理，不复制成另一套文件系统。", icon: MapPin },
  documents: { title: "我的文档", description: "本地云文档式整理将在下一张工程卡接入；现有便签数据不会迁移或丢失。", icon: FileText },
  archive: { title: "已归档", description: "已归档便签仍保留在本地。", icon: Archive },
  trash: { title: "回收站", description: "删除内容仍沿用现有恢复与永久删除规则。", icon: Trash2 },
};

export default function StartNotesView({ destination, selectedNoteId = null, onOpenNote }: { destination: Exclude<StartDestination, "home" | "overview" | "tasks">; selectedNoteId?: string | null; onOpenNote?: (noteId: string) => void }) {
  const notes = useCaptures((state) => destination === "archive" ? state.archivedNotes : state.notes);
  const copy = COPY[destination];
  const Icon = copy.icon;
  const shown = destination === "recent" ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt) : notes;
  return (
    <div className="leemo-start-simple-page">
      <header className="leemo-start-page-heading"><div><h1>{copy.title}</h1><p>{copy.description}</p></div></header>
      {shown.length > 0 && ["inbox", "recent", "archive"].includes(destination) ? (
        <section className="leemo-start-note-list" aria-label={copy.title}>
          {shown.map((note) => <article key={note.id} className={selectedNoteId === note.id ? "is-selected" : undefined}><button type="button" aria-label={`打开文档 ${note.title || "无标题便签"}`} onClick={() => onOpenNote?.(note.id)}><Icon aria-hidden /><div><h2>{note.title || "无标题便签"}</h2><p>{note.markdown.slice(0, 120) || "空白便签"}</p></div><time>{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</time></button></article>)}
        </section>
      ) : (
        <div className="leemo-start-simple-empty"><Icon aria-hidden /><p>{destination === "inbox" ? "随手记下的内容会出现在这里。" : copy.description}</p></div>
      )}
    </div>
  );
}
