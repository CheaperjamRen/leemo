import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  Braces,
  Check,
  ExternalLink,
  Eye,
  FilePlus2,
  FolderOpen,
  Link2,
  ListPlus,
  PanelLeftOpen,
  Paperclip,
  Pin,
  Save,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { CaptureAttachmentPreview, Note, NoteAttachment } from "../../captures";
import CaptureEditor, { type CaptureEditorHandle } from "../components/CaptureEditor";
import MarkdownContent from "../components/MarkdownContent";
import { useCaptures, useSettings, useTasks } from "../bridge/context";
import { IpcCaptureClient } from "../capture/client";
import { buildBacklinks } from "../notes/note-references";
import {
  latestNewDocumentRecovery,
  readDocumentRecovery,
  removeDocumentRecovery,
  writeDocumentRecovery,
  type DocumentRecoveryRecord,
} from "./document-recovery";
import NoteExplorer from "./NoteExplorer";
import NoteReferenceMenu from "./NoteReferenceMenu";

const PdfView = lazy(() => import("../components/PdfView"));

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

interface DocumentMoveUndo {
  noteId: string;
  title: string;
  parentId: string | null;
  index: number;
}

interface DocumentRecoveryConflict {
  noteId: string;
  recovery: DocumentRecoveryRecord;
}

type DocumentSaveState = "idle" | "saving" | "error";

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

function draftFromRecovery(recovery: DocumentRecoveryRecord, attachments: NoteAttachment[] = []): DocumentDraft {
  return {
    key: recovery.key,
    noteId: recovery.noteId,
    title: recovery.title,
    markdown: recovery.markdown,
    revision: recovery.baseRevision,
    attachments: attachments.map((attachment) => ({ ...attachment })),
  };
}

function recoveryFromDraft(draft: DocumentDraft, updatedAt = Date.now()): DocumentRecoveryRecord {
  return {
    key: draft.key,
    noteId: draft.noteId,
    baseRevision: draft.revision,
    title: draft.title,
    markdown: draft.markdown,
    updatedAt,
  };
}

function recoveryMatchesDraft(recovery: DocumentRecoveryRecord, draft: DocumentDraft): boolean {
  return recovery.title === draft.title && recovery.markdown === draft.markdown;
}

function visibleTitle(note: Pick<Note, "title" | "markdown">): string {
  return note.title.trim() || note.markdown.trim().split(/\r?\n/u)[0]?.slice(0, 60) || "无标题文档";
}

function attachmentCanPreview(attachment: NoteAttachment): boolean {
  const lower = attachment.name.toLocaleLowerCase();
  return Boolean(
    attachment.mimeType?.startsWith("image/")
    || attachment.mimeType === "application/pdf"
    || /\.(?:png|jpe?g|gif|webp|bmp|svg|pdf|md|markdown|mdx|txt|log|jsonl?|ya?ml|toml|ini|csv|tsv|xml|html?|css|jsx?|tsx?|py|sql|sh|ps1)$/u.test(lower),
  );
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
  const refreshCaptures = useCaptures((state) => state.refresh);
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
  const initialNewRecovery = useRef(
    libraryMode === "active" && selectedNoteId === null ? latestNewDocumentRecovery() : null,
  );
  const [activeId, setActiveId] = useState<string | null>(selectedNoteId);
  const [narrowLayout, setNarrowLayout] = useState(() => window.matchMedia?.("(max-width: 819px)").matches ?? false);
  const [explorerOpen, setExplorerOpen] = useState(() => !(window.matchMedia?.("(max-width: 819px)").matches ?? false));
  const [draft, setDraft] = useState<DocumentDraft | null>(() => (
    initialNewRecovery.current ? draftFromRecovery(initialNewRecovery.current) : null
  ));
  const [viewMode, setViewMode] = useState<"preview" | "rich" | "source">(
    initialNewRecovery.current ? "rich" : "preview",
  );
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<CaptureAttachmentPreview | null>(null);
  const [taskCandidates, setTaskCandidates] = useState<NoteTaskCandidate[] | null>(null);
  const [taskSelection, setTaskSelection] = useState("");
  const [taskReceipt, setTaskReceipt] = useState<string | null>(null);
  const [pendingTreeAction, setPendingTreeAction] = useState<PendingTreeAction | null>(null);
  const [moveUndo, setMoveUndo] = useState<DocumentMoveUndo | null>(null);
  const [saveState, setSaveState] = useState<DocumentSaveState>("idle");
  const [recoveryConflict, setRecoveryConflict] = useState<DocumentRecoveryConflict | null>(null);
  const newDraftNumber = useRef(0);
  const lastExternalSelection = useRef<string | null | undefined>(undefined);
  const latestDraftRef = useRef<DocumentDraft | null>(draft);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistedRef = useRef(new Map<string, { noteId: string; revision: number }>());
  const saveBlockedRef = useRef(false);
  const pendingSavesRef = useRef(0);
  const editorRef = useRef<CaptureEditorHandle>(null);
  const explorerToggleRef = useRef<HTMLButtonElement>(null);

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
    latestDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 819px)");
    if (!media) return;
    const apply = () => {
      setNarrowLayout(media.matches);
      setExplorerOpen(!media.matches);
    };
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, []);

  const closeExplorer = (): void => {
    setExplorerOpen(false);
    requestAnimationFrame(() => explorerToggleRef.current?.focus());
  };

  useEffect(() => {
    if (!narrowLayout || !explorerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExplorer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [explorerOpen, narrowLayout]);

  const rememberDraft = (next: DocumentDraft): void => {
    latestDraftRef.current = next;
    setDraft(next);
    if (next.noteId === null && !next.title.trim() && !next.markdown.trim()) {
      removeDocumentRecovery(next.key);
    } else {
      writeDocumentRecovery(recoveryFromDraft(next));
    }
    if (!saveBlockedRef.current && pendingSavesRef.current === 0) setSaveState("idle");
  };

  const draftForNote = (note: Note): DocumentDraft => {
    const key = `note:${note.id}`;
    persistedRef.current.set(key, { noteId: note.id, revision: note.revision });
    const recovery = readDocumentRecovery(key);
    if (!recovery || (recovery.title === note.title && recovery.markdown === note.markdown)) {
      if (recovery) removeDocumentRecovery(key);
      setRecoveryConflict(null);
      saveBlockedRef.current = false;
      return draftFromNote(note);
    }
    if (recovery.baseRevision === note.revision) {
      setRecoveryConflict(null);
      saveBlockedRef.current = false;
      return draftFromRecovery(recovery, note.attachments ?? []);
    }
    setRecoveryConflict({ noteId: note.id, recovery });
    saveBlockedRef.current = true;
    setSaveState("error");
    return draftFromNote(note);
  };

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
        const next = draftForNote(note);
        latestDraftRef.current = next;
        setDraft(next);
        setViewMode(next.title === note.title && next.markdown === note.markdown ? "preview" : "rich");
        setReferenceMenuOpen(false);
      }
      return;
    }
    if (!draft && notes[0]) setActiveId(notes[0].id);
  }, [activeId, draft, noteById, notes, selectNote]);

  const openDocument = (note: Note) => {
    if (narrowLayout) setExplorerOpen(false);
    setActiveId(note.id);
    selectNote(note.id);
    const next = draftForNote(note);
    latestDraftRef.current = next;
    setDraft(next);
    setViewMode(next.title === note.title && next.markdown === note.markdown ? "preview" : "rich");
    setReferenceMenuOpen(false);
    setTaskCandidates(null);
    setTaskSelection("");
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
    const next: DocumentDraft = {
      key: `new:${Date.now()}-${newDraftNumber.current}`,
      noteId: null,
      title: "",
      markdown: "",
      revision: null,
      attachments: [],
    };
    latestDraftRef.current = next;
    setDraft(next);
    setRecoveryConflict(null);
    saveBlockedRef.current = false;
    setSaveState("idle");
    setViewMode("rich");
    setReferenceMenuOpen(false);
    setTaskCandidates(null);
    setTaskSelection("");
    setTaskReceipt(null);
    setPendingTreeAction(null);
    setLocalError(null);
  };

  const persistDocumentSnapshot = async (snapshot: DocumentDraft): Promise<void> => {
    if (saveBlockedRef.current) return;
    pendingSavesRef.current += 1;
    setSaveState("saving");
    const persisted = persistedRef.current.get(snapshot.key);
    try {
      const saved = persisted
        ? await updateNote({
            id: persisted.noteId,
            title: snapshot.title,
            markdown: snapshot.markdown,
            expectedRevision: persisted.revision,
          })
        : snapshot.noteId && snapshot.revision !== null
          ? await updateNote({
              id: snapshot.noteId,
              title: snapshot.title,
              markdown: snapshot.markdown,
              expectedRevision: snapshot.revision,
            })
          : await createNote({ title: snapshot.title, markdown: snapshot.markdown });
      const canonicalKey = `note:${saved.id}`;
      persistedRef.current.set(snapshot.key, { noteId: saved.id, revision: saved.revision });
      persistedRef.current.set(canonicalKey, { noteId: saved.id, revision: saved.revision });

      const storedRecovery = readDocumentRecovery(snapshot.key);
      const latest = latestDraftRef.current;
      const latestIsThisDocument = latest?.key === snapshot.key || latest?.noteId === saved.id;
      if (latestIsThisDocument && latest) {
        const unchanged = latest.title === snapshot.title && latest.markdown === snapshot.markdown;
        const next = unchanged
          ? draftFromNote(saved)
          : {
              ...latest,
              key: canonicalKey,
              noteId: saved.id,
              revision: saved.revision,
              attachments: saved.attachments?.map((attachment) => ({ ...attachment })) ?? latest.attachments,
            };
        latestDraftRef.current = next;
        setDraft(next);
        setActiveId(saved.id);
        selectNote(saved.id);
        removeDocumentRecovery(snapshot.key);
        if (unchanged) {
          removeDocumentRecovery(canonicalKey);
        } else {
          writeDocumentRecovery(recoveryFromDraft(next));
        }
      } else if (storedRecovery) {
        if (recoveryMatchesDraft(storedRecovery, snapshot)) {
          removeDocumentRecovery(snapshot.key);
        } else {
          removeDocumentRecovery(snapshot.key);
          writeDocumentRecovery({
            ...storedRecovery,
            key: canonicalKey,
            noteId: saved.id,
            baseRevision: saved.revision,
          });
        }
      }
      setRecoveryConflict(null);
      setLocalError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "文档没有保存。";
      const recovery = readDocumentRecovery(snapshot.key) ?? recoveryFromDraft(snapshot);
      if (/别处更新|版本不正确/u.test(message) && snapshot.noteId) {
        setRecoveryConflict({ noteId: snapshot.noteId, recovery });
        saveBlockedRef.current = true;
        setLocalError(null);
      } else {
        setLocalError(message);
      }
      setSaveState("error");
    } finally {
      pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
      if (pendingSavesRef.current === 0 && !saveBlockedRef.current) setSaveState("idle");
    }
  };

  const saveDocument = async (snapshot = latestDraftRef.current): Promise<void> => {
    if (!snapshot || (!snapshot.title.trim() && !snapshot.markdown.trim())) {
      setLocalError("请先写下标题或正文内容。");
      return;
    }
    setLocalError(null);
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(() => persistDocumentSnapshot(snapshot));
    saveQueueRef.current = operation;
    await operation;
  };

  const dirty = Boolean(draft && (!currentNote
    || draft.title !== currentNote.title
    || draft.markdown !== currentNote.markdown));

  useEffect(() => {
    if (!draft || !dirty || saveBlockedRef.current || (!draft.title.trim() && !draft.markdown.trim())) return;
    const timer = window.setTimeout(() => { void saveDocument(draft); }, 800);
    return () => window.clearTimeout(timer);
  }, [dirty, draft?.key, draft?.title, draft?.markdown, draft?.revision]);

  const reloadAfterConflict = async (): Promise<void> => {
    if (!recoveryConflict) return;
    const noteId = recoveryConflict.noteId;
    removeDocumentRecovery(recoveryConflict.recovery.key);
    setRecoveryConflict(null);
    saveBlockedRef.current = false;
    setSaveState("idle");
    setLocalError(null);
    latestDraftRef.current = null;
    setDraft(null);
    setActiveId(null);
    selectNote(null);
    await refreshCaptures();
    setActiveId(noteId);
  };

  const copyLocalRecovery = async (): Promise<void> => {
    if (!recoveryConflict) return;
    const recovery = recoveryConflict.recovery;
    setLocalError(null);
    try {
      const saved = await createNote({
        title: `${recovery.title.trim() || "无标题文档"}（本地草稿）`,
        markdown: recovery.markdown,
      });
      removeDocumentRecovery(recovery.key);
      const next = draftFromNote(saved);
      latestDraftRef.current = next;
      persistedRef.current.set(next.key, { noteId: saved.id, revision: saved.revision });
      setDraft(next);
      setActiveId(saved.id);
      selectNote(saved.id);
      setRecoveryConflict(null);
      saveBlockedRef.current = false;
      setSaveState("idle");
      setViewMode("rich");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "本地草稿没有复制。" );
    }
  };

  const moveDocument = async (noteId: string, parentId: string | null, index: number) => {
    const source = noteById.get(noteId);
    if (!source) return;
    const originalSiblings = notes
      .filter((note) => note.parentId === source.parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder
        || right.updatedAt - left.updatedAt
        || right.createdAt - left.createdAt
        || left.id.localeCompare(right.id));
    const originalIndex = Math.max(0, originalSiblings.findIndex((note) => note.id === source.id));
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
      setMoveUndo({
        noteId: source.id,
        title: visibleTitle(source),
        parentId: source.parentId,
        index: originalIndex,
      });
    } catch {
      // The store exposes the concrete validation or revision error.
    }
  };

  const undoDocumentMove = async (): Promise<void> => {
    if (!moveUndo) return;
    const current = noteById.get(moveUndo.noteId);
    if (!current) {
      setMoveUndo(null);
      return;
    }
    setLocalError(null);
    try {
      const affected = await moveNote({
        id: current.id,
        expectedRevision: current.revision,
        parentId: moveUndo.parentId,
        index: moveUndo.index,
      });
      const restored = affected.find((note) => note.id === current.id);
      if (restored && draft?.noteId === restored.id) {
        setDraft((currentDraft) => currentDraft ? { ...currentDraft, revision: restored.revision } : currentDraft);
      }
      setMoveUndo(null);
    } catch {
      setLocalError("这次移动暂时无法撤销，文档仍保留在当前位置。");
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
    if (!editorRef.current?.insertNoteReference(target.id, visibleTitle(target))) {
      setLocalError("请先把光标放到正文中，再插入引用。");
      return;
    }
    setReferenceMenuOpen(false);
  };

  const openTaskCopy = () => {
    if (!draft?.noteId) return;
    const selection = editorRef.current?.readTaskSelection() ?? taskSelection;
    if (!selection.trim()) {
      setLocalError("请先选中要复制为待办的文字。");
      return;
    }
    setTaskReceipt(null);
    setTaskCandidates(noteTaskCandidates(selection));
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

  const adoptAttachmentRevision = (updated: Note): DocumentDraft => {
    const next = draftFromNote(updated);
    persistedRef.current.set(next.key, { noteId: updated.id, revision: updated.revision });
    latestDraftRef.current = next;
    setDraft(next);
    removeDocumentRecovery(next.key);
    return next;
  };

  const ensureAttachmentDocument = async (): Promise<DocumentDraft | null> => {
    const snapshot = latestDraftRef.current;
    if (!snapshot) return null;
    if (snapshot.noteId === null || readDocumentRecovery(snapshot.key)) {
      await saveDocument(snapshot);
    }
    const ready = latestDraftRef.current;
    if (!ready?.noteId || ready.revision === null || saveBlockedRef.current || readDocumentRecovery(ready.key)) {
      setLocalError("文档还没有保存，附件操作没有执行。请先处理保存问题。");
      return null;
    }
    return ready;
  };

  const attachFiles = async (files: File[]) => {
    const ready = await ensureAttachmentDocument();
    if (!ready) return;
    if (!window.leemoWorkspace) {
      setLocalError("无法读取拖入文件的位置，请改用桌面版 Leemo。");
      return;
    }
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      const client = requireAttachmentClient();
      let current = ready;
      for (const file of files) {
        const path = window.leemoWorkspace.pathForFile(file);
        if (!path) throw new Error("无法读取这个文件的位置，请重新选择文件。");
        const updated = captureFileDropMode === "copy"
          ? await client.attachFileCopy({ noteId: current.noteId!, expectedRevision: current.revision!, path })
          : await client.attachExternalFile({ noteId: current.noteId!, expectedRevision: current.revision!, path });
        current = adoptAttachmentRevision(updated);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "附件没有添加。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const attachPastedImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const ready = await ensureAttachmentDocument();
    if (!ready) return;
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      const updated = await requireAttachmentClient().attachImageBytes({
        noteId: ready.noteId!,
        expectedRevision: ready.revision!,
        name: file.name || "粘贴图片.png",
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      adoptAttachmentRevision(updated);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "图片没有添加。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeAttachment = async (attachment: NoteAttachment) => {
    const ready = await ensureAttachmentDocument();
    if (!ready) return;
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      const updated = await requireAttachmentClient().removeAttachment({
        noteId: ready.noteId!,
        attachmentId: attachment.id,
        expectedRevision: ready.revision!,
      });
      adoptAttachmentRevision(updated);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "附件没有移除。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const previewAttachment = async (attachment: NoteAttachment) => {
    if (!draft?.noteId) return;
    setAttachmentBusy(true);
    setLocalError(null);
    try {
      setAttachmentPreview(await requireAttachmentClient().previewAttachment({
        noteId: draft.noteId,
        attachmentId: attachment.id,
      }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "附件无法预览。");
    } finally {
      setAttachmentBusy(false);
    }
  };

  const openAttachment = async (attachment: NoteAttachment) => {
    if (!draft?.noteId) return;
    setLocalError(null);
    try {
      await requireAttachmentClient().openAttachment({ noteId: draft.noteId, attachmentId: attachment.id });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "附件没有打开。");
    }
  };

  const revealAttachment = async (attachment: NoteAttachment) => {
    if (!draft?.noteId) return;
    setLocalError(null);
    try {
      await requireAttachmentClient().revealAttachment({ noteId: draft.noteId, attachmentId: attachment.id });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "无法在资源管理器中定位附件。");
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
  const immediateParent = ancestors.at(-1) ?? null;
  const immediateParentTitle = immediateParent?.title.trim() || "无标题文档";

  return (
    <div className={`leemo-start-documents${explorerOpen ? " is-explorer-open" : ""}`} data-testid="start-documents-view" data-explorer-open={String(explorerOpen)}>
      {narrowLayout && explorerOpen ? <button type="button" className="leemo-note-explorer-backdrop" aria-label="收起文档列表遮罩" onClick={closeExplorer} /> : null}
      <NoteExplorer
        notes={notes}
        selectedId={activeId}
        onSelect={openDocument}
        onCreate={startDocument}
        onMove={(noteId, parentId, index) => { void moveDocument(noteId, parentId, index); }}
        readOnly={libraryMode === "archive"}
        title={libraryMode === "archive" ? "已归档" : "文档库"}
        onRequestClose={narrowLayout ? closeExplorer : undefined}
        collapsed={narrowLayout && !explorerOpen}
      />
      {moveUndo ? (
        <div className="leemo-document-move-undo" role="status" aria-label="文档移动结果">
          <span>已移动「{moveUndo.title}」</span>
          <button type="button" onClick={() => void undoDocumentMove()} aria-label="撤销移动">撤销</button>
          <button type="button" className="is-dismiss" onClick={() => setMoveUndo(null)} aria-label="关闭移动提示"><X aria-hidden /></button>
        </div>
      ) : null}
      <section className="leemo-document-workspace" aria-label="文档阅读与编辑">
        {draft ? (
          <>
            <header className="leemo-document-header">
              <button ref={explorerToggleRef} type="button" className="leemo-document-explorer-toggle" aria-label={explorerOpen ? "文档列表已打开" : "打开文档列表"} title={explorerOpen ? "文档列表已打开" : "打开文档列表"} onClick={() => explorerOpen ? closeExplorer() : setExplorerOpen(true)}><PanelLeftOpen aria-hidden /></button>
              <div className={`leemo-document-header__identity${ancestors.length === 0 ? " is-bare" : ""}`}>
                {immediateParent ? (
                  <nav className="leemo-document-location" aria-label="文档位置">
                    {ancestors.length > 1 ? <span aria-hidden>… /</span> : null}
                    <button
                      type="button"
                      aria-label={`打开父文档 ${immediateParentTitle}`}
                      title={immediateParentTitle}
                      onClick={() => openDocument(immediateParent)}
                    >
                      {immediateParentTitle}
                    </button>
                  </nav>
                ) : null}
                <input
                  type="text"
                  aria-label="文档标题"
                  value={draft.title === "无标题文档" ? "" : draft.title}
                  readOnly={viewMode === "preview"}
                  placeholder="请输入标题"
                  onChange={(event) => rememberDraft({ ...draft, title: event.currentTarget.value })}
                />
              </div>
              <div className="leemo-document-header__actions">
                <div className="leemo-document-mode" role="group" aria-label="文档模式">
                  <button type="button" aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}><BookOpen aria-hidden /><span>阅读</span></button>
                  <button type="button" aria-label="编辑文档" title="所见即所得编辑" aria-pressed={viewMode === "rich"} onClick={() => setViewMode("rich")}><SquarePen aria-hidden /><span>编辑</span></button>
                  <button type="button" aria-label="编辑 Markdown 源码" title="编辑 Markdown 源码" aria-pressed={viewMode === "source"} onClick={() => setViewMode("source")}><Braces aria-hidden /><span>源码</span></button>
                </div>
                <span className={recoveryConflict || saveState === "error" ? "is-dirty" : dirty ? "is-dirty" : "is-saved"}>
                  {recoveryConflict ? "内容有冲突" : saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : dirty ? "未保存" : "已保存"}
                </span>
                <button type="button" aria-label="保存文档" title="保存文档 (Ctrl+S)" disabled={!dirty || saveState === "saving" || Boolean(recoveryConflict)} onClick={() => void saveDocument()}><Save aria-hidden /></button>
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
            {attachmentPreview ? (
              <div className="leemo-attachment-preview-backdrop" onMouseDown={(event) => {
                if (event.target === event.currentTarget) setAttachmentPreview(null);
              }}>
                <section className="leemo-attachment-preview" data-kind={attachmentPreview.kind} role="dialog" aria-modal="true" aria-label={`预览 ${attachmentPreview.name}`}>
                  <header>
                    <strong>{attachmentPreview.name}</strong>
                    <button type="button" aria-label="关闭预览" onClick={() => setAttachmentPreview(null)}><X aria-hidden /></button>
                  </header>
                  <div className="leemo-attachment-preview__body">
                    {attachmentPreview.kind === "markdown" ? (
                      <MarkdownContent text={attachmentPreview.text} variant="preview" />
                    ) : attachmentPreview.kind === "text" ? (
                      <pre>{attachmentPreview.text}</pre>
                    ) : attachmentPreview.kind === "image" ? (
                      <img src={`data:${attachmentPreview.mimeType};base64,${attachmentPreview.base64}`} alt={attachmentPreview.name} />
                    ) : (
                      <Suspense fallback={<p>正在打开 PDF…</p>}>
                        <PdfView base64={attachmentPreview.base64} title={attachmentPreview.name} fileId={`capture:${draft?.noteId}:${attachmentPreview.name}`} />
                      </Suspense>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
            {recoveryConflict ? (
              <section className="leemo-document-conflict" role="alert" aria-label="内容在别处更新">
                <div><strong>内容在别处更新</strong><p>本地草稿仍然保留。重新载入最新内容，或把这份草稿另存为副本。</p></div>
                <div><button type="button" onClick={() => void reloadAfterConflict()}>重新载入</button><button type="button" onClick={() => void copyLocalRecovery()}>复制本地草稿</button></div>
              </section>
            ) : (localError || storeError) ? <p className="leemo-document-error" role="alert">{localError || storeError}</p> : null}
            <div className="leemo-document-scroll">
              <div className="leemo-document-canvas">
                {viewMode !== "preview" ? (
                  <div className="leemo-document-editor-wrap">
                    <CaptureEditor
                      key={`${draft.key}:${viewMode}`}
                      ref={editorRef}
                      variant="document"
                      mode={viewMode}
                      markdown={draft.markdown}
                      onMarkdownChange={(markdown) => {
                        const current = latestDraftRef.current;
                        if (current) rememberDraft({ ...current, markdown });
                      }}
                      onSave={() => void saveDocument()}
                      onPasteImage={(file) => void attachPastedImage(file)}
                      onDropFiles={(files) => void attachFiles(files)}
                      onOpenNoteReferenceMenu={() => setReferenceMenuOpen(true)}
                      referenceMenu={referenceMenuOpen ? (
                        <NoteReferenceMenu
                          notes={notes}
                          currentNoteId={draft.noteId}
                          onSelect={insertReference}
                          onClose={() => setReferenceMenuOpen(false)}
                        />
                      ) : null}
                      onOpenNoteReference={openDocumentId}
                      onTaskSelectionChange={setTaskSelection}
                      onDropNoteReference={(noteId) => {
                        const target = noteById.get(noteId);
                        if (target) insertReference(target);
                        else setLocalError("拖入的便签已不存在。");
                      }}
                      disabled={attachmentBusy || Boolean(recoveryConflict)}
                      autoFocus={draft.noteId === null}
                    />
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
                       <button type="button" aria-label="从便签创建待办" disabled={taskSaving || !taskSelection.trim()} onClick={openTaskCopy}>从便签创建待办</button>
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
                      <li key={attachment.id}>
                        <span><strong>{attachment.name}</strong><small>{attachment.storage === "external" ? "仅引用原文件" : "已保存副本"}</small></span>
                        <div className="leemo-document-attachments__actions">
                          {attachmentCanPreview(attachment) ? <button type="button" disabled={attachmentBusy} aria-label={`预览附件 ${attachment.name}`} title="在 Leemo 中预览" onClick={() => void previewAttachment(attachment)}><Eye aria-hidden /></button> : null}
                          <button type="button" aria-label={`打开附件 ${attachment.name}`} title="使用默认应用打开" onClick={() => void openAttachment(attachment)}><ExternalLink aria-hidden /></button>
                          <button type="button" aria-label={`在资源管理器中显示 ${attachment.name}`} title="在资源管理器中显示" onClick={() => void revealAttachment(attachment)}><FolderOpen aria-hidden /></button>
                          <button type="button" className="is-remove" disabled={attachmentBusy} aria-label={`移除附件 ${attachment.name}`} title="从文档中移除" onClick={() => void removeAttachment(attachment)}>移除</button>
                        </div>
                      </li>
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
            <footer className="leemo-document-status"><span>{draft.markdown.trim().length} 字</span>{!dirty && saveState !== "error" && <Check aria-label="内容已保存" />}</footer>
          </>
        ) : (
          <div className="leemo-document-workspace__empty">
            <FilePlus2 aria-hidden />
            <h1>{status === "loading" ? "正在读取文档…" : "还没有文档"}</h1>
            <p>新建一份文档，或先用 Alt+N 记下随手内容。</p>
            <button type="button" onClick={startDocument}>新建文档</button>
          </div>
        )}
      </section>
    </div>
  );
}
