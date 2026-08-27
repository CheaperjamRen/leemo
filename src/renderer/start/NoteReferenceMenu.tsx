import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import type { Note } from "../../captures";

export default function NoteReferenceMenu({
  notes,
  currentNoteId,
  onSelect,
  onClose,
}: {
  notes: readonly Note[];
  currentNoteId: string | null;
  onSelect(note: Note): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);
  const shown = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return notes
      .filter((note) => note.id !== currentNoteId)
      .filter((note) => !normalized || `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 12);
  }, [currentNoteId, notes, query]);

  return (
    <div ref={menuRef} className="leemo-note-reference-menu" role="dialog" aria-label="引用便签">
      <header><strong>引用便签</strong><button type="button" aria-label="关闭引用菜单" onClick={onClose}><X aria-hidden /></button></header>
      <label><Search aria-hidden /><input ref={inputRef} type="search" aria-label="搜索可引用便签" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="输入标题" /></label>
      <div role="listbox" aria-label="可引用便签">
        {shown.length > 0 ? shown.map((note) => (
          <button key={note.id} type="button" role="option" aria-selected="false" onClick={() => onSelect(note)}>
            <FileText aria-hidden /><span><strong>{note.title || "无标题文档"}</strong><small>{note.markdown.replace(/\s+/gu, " ").slice(0, 54) || "空白文档"}</small></span>
          </button>
        )) : <p>没有匹配的便签</p>}
      </div>
    </div>
  );
}
