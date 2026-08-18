import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  FilePlus2,
  Link2,
  ListPlus,
  Paperclip,
  Pin,
  Save,
  Trash2,
} from "lucide-react";
import type { Note, NoteAttachment } from "../../captures";
import CaptureEditor from "../components/CaptureEditor";
import MarkdownContent from "../components/MarkdownContent";
import { useCaptures, useSettings, useTasks } from "../bridge/context";
import { IpcCaptureClient } from "../capture/client";
import { buildBacklinks, noteReferenceHref } from "../notes/note-references";
import NoteExplorer from "./NoteExplorer";
import NoteReferenceMenu from "./NoteReferenceMenu";

interface DocumentDraft {
  key: string;
  noteId: string | null;
  title: string;
  markdown: string;
  revision: number | null;
  attachments: NoteAttachment[];
}

interface NoteTaskCandidate {
  id: string;
  title: string;
  details: string;
  selected: boolean;
}

interface PendingTreeAction {
  kind: "archive" | "trash";
  childCount: number;
}

function draftFromNote(note: Note): DocumentDraft {
  return {
    key: `note:${note.id}`,
    noteId: note.id,
    title: note.title,
    markdown: note.markdown,
    revision: note.revision,
    attachments: note.attachments?.map((attachment) => ({ ...attachment })) ?? [],
  };
}

function visibleTitle(note: Pick<Note, "title" | "markdown">): string {
  return note.title.trim() || note.markdown.trim().split(/\r?\n/u)[0]?.slice(0, 60) || "无标题文档";
}

function noteTaskCandidates(markdown: string): NoteTaskCandidate[] {
  return markdown.replace(/\r\n/gu, "\n").split("\n").flatMap((details, index) => {
    const line = details.trim();
    if (!line || /^[-*+]\s+\[[xX]\]\s+/u.test(line)) return [];
    const title = line
      .replace(/^[-*+]\s+\[ \]\s+/u, "")
      .replace(/^[-*+]\s+/u, "")
      .replace(/^\d+[.)]\s+/u, "")
      .trim();
    return title ? [{ id: `${index}:${details}`, title, details, selected: true }] : [];
  });
}

export default function StartDocumentsView({
  selectedNoteId = null,
  onOpenTask,
  libraryMode = "active",
  onRestored,
}: {
  selectedNoteId?: string | null;
  onOpenTask?: (taskId: string) => void;
  libraryMode?: "active" | "archive";
  onRestored?: (noteId: string) => void;
}) {
  const activeNotes = useCaptures((state) => state.notes);
  const archivedNotes = useCaptures((state) => state.archivedNotes);
  const notes = libraryMode === "archive" ? archivedNotes : activeNotes;
  const status = useCaptures((state) => state.status);
  const storeError = useCaptures((state) => state.error);
  const saving = useCaptures((state) => state.saving);
  const selectNote = useCaptures((state) => state.selectNote);
  const createNote = useCaptures((state) => state.createNote);
  const updateNote = useCaptures((state) => state.updateNote);
  const moveNote = useCaptures((state) => state.moveNote);
  const setNotePinned = useCaptures((state) => state.setNotePinned);
  const markNoteOrganized = useCaptures((state) => state.markNoteOrganized);
  const archiveNote = useCaptures((state) => state.archiveNote);
  const unarchiveNote = useCaptures((state) => state.unarchiveNote);
  const deleteNote = useCaptures((state) => state.deleteNote);
  const captureFileDropMode = useSettings((state) => state.captureFileDropMode);
  const createManyTasks = useTasks((state) => state.createMany);
  const tasksForNote = useTasks((state) => state.tasksForNote);
  const taskSaving = useTasks((state) => state.saving);
  const taskError = useTasks((state) => state.error);
  const [activeId, setActiveId] = useState<string | null>(selectedNoteId);
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [taskCandidates, setTaskCandidates] = useState<NoteTaskCandidate[] | null>(null);
  const [taskReceipt, setTaskReceipt] = useState<string | null>(null);
  const [pendingTreeAction, setPendingTreeAction] = useState<PendingTreeAction | null>(null);
  const newDraftNumber = useRef(0);
  const lastExternalSelection = useRef<string | null | undefined>(undefined);

  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const currentNote = activeId ? noteById.get(activeId) ?? null : null;
  const backlinks = useMemo(() => buildBacklinks(notes), [notes]);
  const backlinkNotes = (activeId ? backlinks.get(activeId) ?? [] : [])
    .flatMap((id) => noteById.get(id) ?? []);
  const linkedTasks = draft?.noteId ? tasksForNote(draft.noteId) : [];
  const descendantCount = useMemo(() => {
    if (!currentNote) return 0;
    const childrenByParent = new Map<string, Note[]>();
    for (const note of notes) {
      if (!note.parentId) continue;
      const children = childrenByParent.get(note.parentId) ?? [];
      children.push(note);
      childrenByParent.set(note.parentId, children);
    }
    const visited = new Set<string>();
    const stack = [...(childrenByParent.get(currentNote.id) ?? [])];
    while (stack.length > 0) {
      const note = stack.pop()!;
      if (visited.has(note.id)) continue;
      visited.add(note.id);
      stack.push(...(childrenByParent.get(note.id) ?? []));
    }
    return visited.size;
  }, [currentNote, notes]);

  useEffect(() => {
    if (selectedNoteId === lastExternalSelection.current) return;
    if (selectedNoteId && noteById.has(selectedNoteId)) {
      lastExternalSelection.current = selectedNoteId;
      setActiveId(selectedNoteId);
      return;
    }
    if (selectedNoteId === null) lastExternalSelection.current = null;
  }, [noteById, selectedNoteId]);

  useEffect(() => {
    if (activeId) {
      const note = noteById.get(activeId);
      if (note && draft?.noteId !== activeId) {
        selectNote(activeId);
        setDraft(draftFromNote(note));
        setViewMode("preview");
        setReferenceMenuOpen(false);
      }
      return;
    }
    if (!draft && notes[0]) setActiveId(notes[0].id);
  }, [activeId, draft, noteById, notes, selectNote]);

  const openDocument = (note: Note) => {
    setActiveId(note.id);
    selectNote(note.id);
    setDraft(draftFromNote(note));
    setViewMode("preview");
    setReferenceMenuOpen(false);
    setTaskCandidates(null);
    setTaskReceipt(null);
    setPendingTreeAction(null);
    setLocalError(null);
  };

  const openDocumentId = (noteId: string) => {
    const note = noteById.get(noteId);
    if (!note) {
      setLocalError("引用的便签已不存在或正在回收站中。");
      return;
    }
    openDocument(note);
  };

  const startDocument = () => {
    newDraftNumber.current += 1;
    setActiveId(null);
    selectNote(null);
    setDraft({
      key: `new:${newDraftNumber.current}`,
      noteId: null,
      title: "",
      markdown: "",
      revision: null,
      attachments: [],
    });
    setViewMode("edit");
    setReferenceMenuOpen(false);
    setTaskCandidates(null);
    setTaskReceipt(null);
    setPendingTreeAction(null);
    setLocalError(null);
  };

  const saveDocument = async () => {
    if (!draft || (!draft.title.trim() && !draft.markdown.trim())) {
      setLocalError("请先写下标题或正文内容。");
      return;
    }
    setLocalError(null);
    try {
      const saved = draft.noteId && draft.revision !== null
        ? await updateNote({
            id: draft.noteId,
            title: draft.title,
            markdown: draft.markdown,
            expectedRevision: draft.revision,
          })
        : await createNote({ title: draft.title, markdown: draft.markdown });
      setActiveId(saved.id);
      selectNote(saved.id);
      setDraft(draftFromNote(saved));
    } catch {
      // The store owns the user-facing failure copy.
    }
  };

  const moveDocument = async (noteId: string, parentId: string | null, index: number) => {
    const source = noteById.get(noteId);
    if (!source) return;
    setLocalError(null);
    try {
      const affected = await moveNote({ id: noteId, expectedRevision: source.revision, parentId, index });
      let moved = affected.find((note) => note.id === noteId);
      if (moved?.organizedAt === null) {
        moved = await markNoteOrganized({ id: moved.id, expectedRevision: moved.revision, organized: true });
      }
      if (moved && draft?.noteId === moved.id) {
        setDraft((current) => current ? { ...current, revision: moved!.revision } : current);
      }
    } catch {
      // The store exposes the concrete validation or revision error.
    }
  };

  const togglePin = async () => {
    if (!currentNote) return;
    try {
      const note = await setNotePinned({
        id: currentNote.id,
        expectedRevision: currentNote.revision,
        pinned: currentNote.pinnedAt === null,
      });
      setDraft((current) => current ? { ...current, revision: note.revision } : current);
    } catch {
      // Store error is rendered below the header.
    }
  };

  const archiveCurrent = async (childStrategy: "subtree" | "lift") => {
    if (!currentNote) return;
    setPendingTreeAction(null);
    try {
      await archiveNote({ id: currentNote.id, expectedRevision: currentNote.revision, childStrategy });
      setDraft(null);
      setActiveId(null);
      selectNote(null);
    } catch {
      // Store error is rendered below the header.
    }
  };

  const trashCurrent = async (childStrategy: "subtree" | "lift") => {
    if (!currentNote) return;
    setPendingTreeAction(null);
    try {
      await deleteNote({ id: currentNote.id, expectedRevision: currentNote.revision, childStrategy });
      setDraft(null);
      setActiveId(null);
      selectNote(null);
    } catch {
      // Store error is rendered below the header.
    }
  };

  const requestTreeAction = (kind: PendingTreeAction["kind"]) => {
    if (!currentNote) return;
    if (descendantCount === 0) {
      if (kind === "archive") void archiveCurrent("subtree");
      else void trashCurrent("subtree");
      return;
    }
    setPendingTreeAction({ kind, childCount: descendantCount });
  };

  const restoreCurrent = async () => {
    if (!currentNote) return;
    try {
      await unarchiveNote({ id: currentNote.id, expectedRevision: currentNote.revision });
      setDraft(null);
      setActiveId(null);
      selectNote(null);
      onRestored?.(currentNote.id);
    } catch {
      // Store error is rendered below the header.
    }
  };

  const insertReference = (target: Note) => {
    if (!draft) return;
    const withoutTrigger = draft.markdown.replace(/@\s*$/u, "").trimEnd();
    const separator = withoutTrigger ? "\n\n" : "";
    setDraft({
      ...draft,
      markdown: `${withoutTrigger}${separator}[${visibleTitle(target)}](${noteReferenceHref(target.id)})`,
    });
    setReferenceMenuOpen(false);
    setEditorVersion((version) => version + 1);
  };

  const openTaskCopy = () => {
    if (!draft?.noteId) return;
    setTaskReceipt(null);
    setTaskCandidates(noteTaskCandidates(draft.markdown));
  };

  const submitTaskCopy = async () => {
    if (!draft?.noteId || !taskCandidates) return;
    const selected = taskCandidates.filter((candidate) => candidate.selected && candidate.title.trim());
    if (selected.length === 0) return;
    try {
      const created = await createManyTasks(selected.map((candidate) => ({
        title: candidate.title.trim(),
        details: candidate.details,
        noteId: draft.noteId,
      })));
      setTaskCandidates(null);
      setTaskReceipt(`已创建 ${created.length} 条待办 · 便签原文保留`);
    } catch {
      // Task store exposes the user-facing error in the copy panel.
    }
  };

  const requireAttachmentClient = (): IpcCaptureClient => {
    if (!window.leemoCapture) throw new Error("此环境暂时无法添加附件。");
    return new IpcCaptureClient(window.leemoCapture);
  };

  const attachFiles = async (files: File[]) => {
    if (!draft?.noteId || draft.revision === null) {
      setLocalError("请先保存文档，再添加附件。");
      return;
    }
    if (!window.leemoWorkspace) {
      setLocalError("无法读取拖入文件的位置，请改用桌面版 Leemo。");
      return;
    }
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      const client = requireAttachmentClient();
      let current = draft;
      for (const file of files) {
        const path = window.leemoWorkspace.pathForFile(file);
        if (!path) throw new Error("无法读取这个文件的位置，请重新选择文件。");
        const updated = captureFileDropMode === "copy"
          ? await client.attachFileCopy({ noteId: current.noteId!, expectedRevision: current.revision!, path })
          : await client.attachExternalFile({ noteId: current.noteId!, expectedRevision: current.revision!, path });
        current = draftFromNote(updated);
      }
      setDraft(current);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "附件没有添加。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const attachPastedImage = async (file: File) => {
    if (!draft?.noteId || draft.revision === null || !file.type.startsWith("image/")) return;
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      const updated = await requireAttachmentClient().attachImageBytes({
        noteId: draft.noteId,
        expectedRevision: draft.revision,
        name: file.name || "粘贴图片.png",
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      setDraft(draftFromNote(updated));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "图片没有添加。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = async (attachment: NoteAttachment) => {
    if (!draft?.noteId || draft.revision === null) return;
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      const updated = await requireAttachmentClient().removeAttachment({
        noteId: draft.noteId,
        attachmentId: attachment.id,
        expectedRevision: draft.revision,
      });
      setDraft(draftFromNote(updated));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "附件没有移除。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const ancestors = useMemo(() => {
    const result: Note[] = [];
    let parentId = currentNote?.parentId ?? null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = noteById.get(parentId);
      if (!parent) break;
      result.unshift(parent);
      parentId = parent.parentId;
    }
    return result;
  }, [currentNote?.parentId, noteById]);

  const dirty = Boolean(draft && (!currentNote
    || draft.title !== currentNote.title
    || draft.markdown !== currentNote.markdown));

  return (
    <div className="leemo-start-documents" data-testid="start-documents-view">
      <NoteExplorer
        notes={notes}
        selectedId={activeId}
        onSelect={openDocument}
        onCreate={startDocument}
        onMove={(noteId, parentId, index) => { void moveDocument(noteId, parentId, index); }}
        readOnly={libraryMode === "archive"}
        title={libraryMode === "archive" ? "已归档" : "我的文档"}
      />
      <section className="leemo-document-workspace" aria-label="文档阅读与编辑">
        {draft ? (
          <>
            <header className="leemo-document-header">
              <div className="leemo-document-header__identity">
                <p>{ancestors.map((note) => visibleTitle(note)).join(" / ") || "我的文档"}</p>
                <input
                  type="text"
                  aria-label="文档标题"
                  value={draft.title}
                  readOnly={viewMode === "preview"}
                  placeholder="无标题文档"
                  onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
                />
              </div>
              <div className="leemo-document-header__actions">
                <div className="leemo-document-mode" role="group" aria-label="文档模式">
                  <button type="button" aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}>阅读</button>
                  <button type="button" aria-label="编辑文档" aria-pressed={viewMode === "edit"} onClick={() => setViewMode("edit")}>编辑</button>
                </div>
                <span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "未保存" : "已保存"}</span>
                <button type="button" aria-label="保存文档" title="保存文档 (Ctrl+S)" disabled={!dirty || saving} onClick={() => void saveDocument()}><Save aria-hidden /></button>
                <button type="button" aria-label={currentNote?.pinnedAt === null ? "置顶文档" : "取消置顶"} title={currentNote?.pinnedAt === null ? "置顶" : "取消置顶"} disabled={!currentNote || saving} onClick={() => void togglePin()}><Pin aria-hidden /></button>
                {libraryMode === "archive"
                  ? <button type="button" aria-label="恢复文档" title="恢复" disabled={!currentNote || saving} onClick={() => void restoreCurrent()}><Archive aria-hidden /></button>
                  : <button type="button" aria-label="归档文档" title="归档" disabled={!currentNote || saving} onClick={() => requestTreeAction("archive")}><Archive aria-hidden /></button>}
                <button type="button" aria-label="移到回收站" title="移到回收站" disabled={!currentNote || saving} onClick={() => requestTreeAction("trash")}><Trash2 aria-hidden /></button>
              </div>
            </header>
            {pendingTreeAction ? (
              <div className="leemo-document-tree-action-backdrop">
                <section
                  className="leemo-document-tree-action"
                  role="dialog"
                  aria-modal="true"
                  aria-label={pendingTreeAction.kind === "archive" ? "归档父便签" : "删除父便签"}
                >
                  <div>
                    <strong>{pendingTreeAction.kind === "archive" ? "归档这组文档？" : "把这组文档移到回收站？"}</strong>
                    <p>将影响 {pendingTreeAction.childCount} 条子便签。你可以保留整棵结构，或只处理当前父便签。</p>
                  </div>
                  <div className="leemo-document-tree-action__choices">
                    <button type="button" onClick={() => pendingTreeAction.kind === "archive" ? void archiveCurrent("subtree") : void trashCurrent("subtree")}>连同子便签一起处理</button>
                    <button type="button" onClick={() => pendingTreeAction.kind === "archive" ? void archiveCurrent("lift") : void trashCurrent("lift")}>只处理这条，子便签上移</button>
                  </div>
                  <button type="button" className="leemo-document-tree-action__cancel" onClick={() => setPendingTreeAction(null)}>取消</button>
                </section>
              </div>
            ) : null}
            {(localError || storeError) ? <p className="leemo-document-error" role="alert">{localError || storeError}</p> : null}
            <div className="leemo-document-scroll">
              <div className="leemo-document-canvas">
                {viewMode === "edit" ? (
                  <div className="leemo-document-editor-wrap">
                    <CaptureEditor
                      key={`${draft.key}:${editorVersion}`}
                      markdown={draft.markdown}
                      onMarkdownChange={(markdown) => setDraft((current) => current ? { ...current, markdown } : current)}
                      onSave={() => void saveDocument()}
                      onPasteImage={(file) => void attachPastedImage(file)}
                      onDropFiles={(files) => void attachFiles(files)}
                      onOpenNoteReferenceMenu={() => setReferenceMenuOpen(true)}
                      onDropNoteReference={(noteId) => {
                        const target = noteById.get(noteId);
                        if (target) insertReference(target);
                        else setLocalError("拖入的便签已不存在。");
                      }}
                      disabled={saving || attachmentBusy}
                      autoFocus={draft.noteId === null}
                    />
                    {referenceMenuOpen ? (
                      <NoteReferenceMenu
                        notes={notes}
                        currentNoteId={draft.noteId}
                        onSelect={insertReference}
                        onClose={() => setReferenceMenuOpen(false)}
                      />
                    ) : null}
                  </div>
                ) : draft.markdown ? (
                  <MarkdownContent text={draft.markdown} variant="preview" onOpenNoteReference={openDocumentId} />
                ) : (
                  <div className="leemo-document-empty-copy"><FilePlus2 aria-hidden /><p>这是一份空白文档。切换到编辑开始书写。</p></div>
                )}

                {draft.noteId ? (
                  <section className="leemo-document-task-link" aria-label="关联待办">
                    <header>
                      <div><ListPlus aria-hidden /><strong>关联待办</strong></div>
                      <button type="button" aria-label="从便签创建待办" disabled={taskSaving || noteTaskCandidates(draft.markdown).length === 0} onClick={openTaskCopy}>从便签创建待办</button>
                    </header>
                    {taskReceipt ? <p className="leemo-document-task-link__receipt" role="status">{taskReceipt}</p> : null}
                    {linkedTasks.length > 0 ? <div className="leemo-document-task-link__existing">{linkedTasks.map((task) => <button key={task.id} type="button" onClick={() => onOpenTask?.(task.id)}><span>{task.title}</span><small>{task.status === "done" ? "已完成" : "待办"}</small></button>)}</div> : null}
                  </section>
                ) : null}

                {taskCandidates ? (
                  <section className="leemo-document-task-copy" aria-label="创建待办预览">
                    <header><div><strong>从便签创建待办</strong><span>原文不会改变；只复制你保留的条目。</span></div><button type="button" onClick={() => setTaskCandidates(null)}>取消</button></header>
                    <div>{taskCandidates.map((candidate, index) => (
                      <label key={candidate.id}>
                        <input type="checkbox" aria-label={`选择待办 ${candidate.title}`} checked={candidate.selected} onChange={(event) => setTaskCandidates((current) => current?.map((item) => item.id === candidate.id ? { ...item, selected: event.currentTarget.checked } : item) ?? null)} />
                        <input type="text" aria-label={`待办标题 ${index + 1}`} value={candidate.title} onChange={(event) => setTaskCandidates((current) => current?.map((item) => item.id === candidate.id ? { ...item, title: event.currentTarget.value } : item) ?? null)} />
                      </label>
                    ))}</div>
                    {taskError ? <p role="alert">{taskError}</p> : null}
                    <footer><span>已选 {taskCandidates.filter((candidate) => candidate.selected).length} 条</span><button type="button" disabled={taskSaving || taskCandidates.every((candidate) => !candidate.selected || !candidate.title.trim())} onClick={() => void submitTaskCopy()}>创建 {taskCandidates.filter((candidate) => candidate.selected).length} 条待办</button></footer>
                  </section>
                ) : null}

                <section className="leemo-document-attachments" aria-label="附件与引用">
                  <header><div><Paperclip aria-hidden /><strong>附件与引用</strong></div><label><input type="file" multiple disabled={!draft.noteId || attachmentBusy} onChange={(event) => { void attachFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} /><span>添加文件</span></label></header>
                  {draft.attachments.length > 0 ? (
                    <ul>{draft.attachments.map((attachment) => (
                      <li key={attachment.id}><span><strong>{attachment.name}</strong><small>{attachment.storage === "external" ? "仅引用原文件" : "已保存副本"}</small></span><button type="button" disabled={attachmentBusy} aria-label={`移除附件 ${attachment.name}`} onClick={() => void removeAttachment(attachment)}>移除</button></li>
                    ))}</ul>
                  ) : <p>拖入文件可按当前设置保留引用或保存副本。</p>}
                </section>

                {backlinkNotes.length > 0 ? (
                  <section className="leemo-document-backlinks" aria-label="被这些文档引用">
                    <header><Link2 aria-hidden /><strong>被这些文档引用</strong></header>
                    {backlinkNotes.map((note) => <button key={note.id} type="button" onClick={() => openDocument(note)}><FilePlus2 aria-hidden /><span>{visibleTitle(note)}</span></button>)}
                  </section>
                ) : null}
              </div>
            </div>
            <footer className="leemo-document-status"><span>{draft.markdown.trim().length} 字</span><span>{saving || attachmentBusy ? "正在保存…" : dirty ? "有未保存修改" : "已保存到本地"}</span>{!dirty && <Check aria-hidden />}</footer>
          </>
        ) : (
          <div className="leemo-document-workspace__empty">
            <FilePlus2 aria-hidden />
            <h1>{status === "loading" ? "正在读取文档…" : "从一份安静的文档开始"}</h1>
            <p>这里不会自动调用模型；你可以只把 Leemo 当作本地文档与便签工具。</p>
            <button type="button" onClick={startDocument}>新建文档</button>
          </div>
        )}
      </section>
    </div>
  );
}
