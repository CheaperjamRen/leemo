import type {
  MarkNoteOrganizedInput,
  MoveNoteInput,
  Note,
  NoteAttachment,
  QuickDraft,
  SaveQuickDraftInput,
  SetNotePinnedInput,
  UpdateNoteInput,
} from "../../captures";
import type { SqliteDatabase } from "./schema";

export interface CapturePersistence {
  getQuickDraft(): QuickDraft | undefined;
  saveQuickDraft(input: SaveQuickDraftInput & { updatedAt: number }): QuickDraft;
  commitQuickDraft(note: Note, expectedRevision: number): Note;
  listNotes(): Note[];
  listArchivedNotes(): Note[];
  getNote(id: string): Note | undefined;
  createNote(note: Note): Note;
  updateNote(input: UpdateNoteInput & { updatedAt: number }): Note;
  moveNote(input: MoveNoteInput): Note[];
  setNotePinned(input: SetNotePinnedInput & { updatedAt: number }): Note;
  markNoteOrganized(input: MarkNoteOrganizedInput & { updatedAt: number }): Note;
  archiveNote(id: string, expectedRevision: number, archivedAt: number): Note;
  unarchiveNote(id: string, expectedRevision: number, updatedAt: number): Note;
  deleteNote(id: string, expectedRevision: number, deletedAt: number, purgeAfter: number): Note;
  listTrash(): Note[];
  restoreNote(id: string, expectedRevision: number, updatedAt: number): Note;
  permanentlyDeleteNote(id: string, expectedRevision: number): Note;
  purgeExpired(now: number): Note[];
  addNoteAttachment(
    noteId: string,
    attachment: NoteAttachment,
    expectedRevision: number,
    updatedAt: number,
  ): Note;
  removeNoteAttachment(
    noteId: string,
    attachmentId: string,
    expectedRevision: number,
    updatedAt: number,
  ): Note;
}

interface QuickDraftRow {
  id: "quick";
  mode: QuickDraft["mode"];
  title: string;
  markdown: string;
  planned_at: number | null;
  due_at: number | null;
  reminder_at: number | null;
  recurrence: QuickDraft["recurrence"];
  revision: number;
  updated_at: number;
}

interface NoteRow {
  id: string;
  title: string;
  markdown: string;
  revision: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after: number | null;
  archived_at: number | null;
  parent_id: string | null;
  sort_order: number;
  pinned_at: number | null;
  organized_at: number | null;
}

interface NoteAttachmentRow {
  id: string;
  note_id: string;
  kind: NoteAttachment["kind"];
  storage: NoteAttachment["storage"];
  name: string;
  file_path: string;
  mime_type: string | null;
  size: number;
  created_at: number;
}

interface RunResult {
  changes: number;
}

function staleRevisionError(): Error {
  return new Error("内容已在别处更新，请刷新后重试。");
}

function noteNotFoundError(): Error {
  return new Error("这条便签不存在，可能已被删除。");
}

function noteParentNotFoundError(): Error {
  return new Error("目标父级便签不存在，可能已被删除。");
}

function noteCycleError(): Error {
  return new Error("便签不能放进自己或自己的子级中，已取消这次循环移动。");
}

function toQuickDraft(row: QuickDraftRow): QuickDraft {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    markdown: row.markdown,
    plannedAt: row.planned_at,
    dueAt: row.due_at,
    reminderAt: row.reminder_at,
    recurrence: row.recurrence,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function toAttachment(row: NoteAttachmentRow): NoteAttachment {
  return {
    id: row.id,
    kind: row.kind,
    storage: row.storage,
    name: row.name,
    path: row.file_path,
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    size: row.size,
    createdAt: row.created_at,
  };
}

function toNote(row: NoteRow, attachments: NoteAttachment[]): Note {
  return {
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    pinnedAt: row.pinned_at,
    organizedAt: row.organized_at,
    ...(row.deleted_at !== null ? { deletedAt: row.deleted_at } : {}),
    ...(row.purge_after !== null ? { purgeAfter: row.purge_after } : {}),
    ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function createCapturePersistence(db: SqliteDatabase): CapturePersistence {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quick_drafts (
      id TEXT PRIMARY KEY CHECK (id = 'quick'),
      mode TEXT NOT NULL CHECK (mode IN ('note', 'task')),
      title TEXT NOT NULL,
      markdown TEXT NOT NULL,
      planned_at INTEGER,
      due_at INTEGER,
      reminder_at INTEGER,
      recurrence TEXT,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      purge_after INTEGER,
      archived_at INTEGER,
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      pinned_at INTEGER,
      organized_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS note_attachments (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'file')),
      storage TEXT NOT NULL CHECK (storage IN ('managed', 'external')),
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS note_attachments_note_id_idx
      ON note_attachments(note_id, created_at, id);
  `);

  const noteColumns = new Set(
    (db.prepare(`PRAGMA table_info(notes)`).all() as { name: string }[]).map((column) => column.name),
  );
  if (!noteColumns.has("deleted_at")) db.exec(`ALTER TABLE notes ADD COLUMN deleted_at INTEGER`);
  if (!noteColumns.has("purge_after")) db.exec(`ALTER TABLE notes ADD COLUMN purge_after INTEGER`);
  if (!noteColumns.has("archived_at")) db.exec(`ALTER TABLE notes ADD COLUMN archived_at INTEGER`);
  if (!noteColumns.has("parent_id")) db.exec(`ALTER TABLE notes ADD COLUMN parent_id TEXT`);
  if (!noteColumns.has("sort_order")) db.exec(`ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  if (!noteColumns.has("pinned_at")) db.exec(`ALTER TABLE notes ADD COLUMN pinned_at INTEGER`);
  if (!noteColumns.has("organized_at")) db.exec(`ALTER TABLE notes ADD COLUMN organized_at INTEGER`);
  db.exec(`CREATE INDEX IF NOT EXISTS notes_trash_purge_idx ON notes(deleted_at, purge_after)`);
  db.exec(`CREATE INDEX IF NOT EXISTS notes_parent_sort_idx ON notes(parent_id, sort_order, id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS notes_pinned_idx ON notes(pinned_at, id)`);

  const quickDraftColumns = new Set(
    (db.prepare(`PRAGMA table_info(quick_drafts)`).all() as { name: string }[]).map((column) => column.name),
  );
  if (!quickDraftColumns.has("planned_at")) db.exec(`ALTER TABLE quick_drafts ADD COLUMN planned_at INTEGER`);
  if (!quickDraftColumns.has("due_at")) db.exec(`ALTER TABLE quick_drafts ADD COLUMN due_at INTEGER`);
  if (!quickDraftColumns.has("reminder_at")) db.exec(`ALTER TABLE quick_drafts ADD COLUMN reminder_at INTEGER`);
  if (!quickDraftColumns.has("recurrence")) db.exec(`ALTER TABLE quick_drafts ADD COLUMN recurrence TEXT`);

  const getQuickDraftStatement = db.prepare(`
    SELECT id, mode, title, markdown, planned_at, due_at, reminder_at, recurrence, revision, updated_at
    FROM quick_drafts
    WHERE id = 'quick'
  `);

  const insertQuickDraftStatement = db.prepare(`
    INSERT INTO quick_drafts
      (id, mode, title, markdown, planned_at, due_at, reminder_at, recurrence, revision, updated_at)
    VALUES ('quick', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateQuickDraftStatement = db.prepare(`
    UPDATE quick_drafts
    SET mode = ?, title = ?, markdown = ?, planned_at = ?, due_at = ?, reminder_at = ?, recurrence = ?, revision = ?, updated_at = ?
    WHERE id = 'quick' AND revision = ?
  `);
  const deleteQuickDraftStatement = db.prepare(`
    DELETE FROM quick_drafts WHERE id = 'quick' AND revision = ?
  `);
  const getNoteStatement = db.prepare(`
    SELECT id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
           parent_id, sort_order, pinned_at, organized_at
    FROM notes WHERE id = ? AND deleted_at IS NULL
  `);
  const listNotesStatement = db.prepare(`
    SELECT id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
           parent_id, sort_order, pinned_at, organized_at
    FROM notes WHERE deleted_at IS NULL AND archived_at IS NULL
    ORDER BY updated_at DESC, created_at DESC, id ASC
  `);
  const listArchivedNotesStatement = db.prepare(`
    SELECT id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
           parent_id, sort_order, pinned_at, organized_at
    FROM notes WHERE deleted_at IS NULL AND archived_at IS NOT NULL
    ORDER BY archived_at DESC, updated_at DESC, created_at DESC, id ASC
  `);
  const getTrashNoteStatement = db.prepare(`
    SELECT id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
           parent_id, sort_order, pinned_at, organized_at
    FROM notes WHERE id = ? AND deleted_at IS NOT NULL
  `);
  const listTrashStatement = db.prepare(`
    SELECT id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
           parent_id, sort_order, pinned_at, organized_at
    FROM notes WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC, id ASC
  `);
  const listOrganizationRowsStatement = db.prepare(`
    SELECT id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
           parent_id, sort_order, pinned_at, organized_at
    FROM notes
    WHERE deleted_at IS NULL
  `);
  const insertNoteStatement = db.prepare(`
    INSERT INTO notes (
      id, title, markdown, revision, created_at, updated_at, deleted_at, purge_after, archived_at,
      parent_id, sort_order, pinned_at, organized_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
  `);
  const updateNoteStatement = db.prepare(`
    UPDATE notes
    SET title = ?, markdown = ?, revision = ?, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const archiveNoteStatement = db.prepare(`
    UPDATE notes
    SET archived_at = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL AND archived_at IS NULL
  `);
  const unarchiveNoteStatement = db.prepare(`
    UPDATE notes
    SET archived_at = NULL, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL AND archived_at IS NOT NULL
  `);
  const trashNoteStatement = db.prepare(`
    UPDATE notes
    SET deleted_at = ?, purge_after = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const restoreNoteStatement = db.prepare(`
    UPDATE notes
    SET deleted_at = NULL, purge_after = NULL, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL
  `);
  const permanentlyDeleteNoteStatement = db.prepare(`
    DELETE FROM notes WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL
  `);
  const listNoteAttachmentsStatement = db.prepare(`
    SELECT id, note_id, kind, storage, name, file_path, mime_type, size, created_at
    FROM note_attachments
    WHERE note_id = ?
    ORDER BY created_at ASC, id ASC
  `);
  const getNoteAttachmentStatement = db.prepare(`
    SELECT id, note_id, kind, storage, name, file_path, mime_type, size, created_at
    FROM note_attachments
    WHERE note_id = ? AND id = ?
  `);
  const insertNoteAttachmentStatement = db.prepare(`
    INSERT INTO note_attachments
      (id, note_id, kind, storage, name, file_path, mime_type, size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteNoteAttachmentStatement = db.prepare(`
    DELETE FROM note_attachments WHERE note_id = ? AND id = ?
  `);
  const deleteNoteAttachmentsStatement = db.prepare(`
    DELETE FROM note_attachments WHERE note_id = ?
  `);
  const revisionNoteStatement = db.prepare(`
    UPDATE notes
    SET revision = ?, updated_at = ?
    WHERE id = ? AND revision = ?
  `);
  const updateNoteSortStatement = db.prepare(`
    UPDATE notes
    SET sort_order = ?
    WHERE id = ? AND deleted_at IS NULL
  `);
  const moveNoteStatement = db.prepare(`
    UPDATE notes
    SET parent_id = ?, sort_order = ?, revision = revision + 1
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const setNotePinnedStatement = db.prepare(`
    UPDATE notes
    SET pinned_at = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const markNoteOrganizedStatement = db.prepare(`
    UPDATE notes
    SET organized_at = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);

  const listNoteAttachments = (noteId: string): NoteAttachment[] =>
    (listNoteAttachmentsStatement.all(noteId) as NoteAttachmentRow[]).map(toAttachment);

  const getQuickDraft = (): QuickDraft | undefined => {
    const row = getQuickDraftStatement.get() as QuickDraftRow | undefined;
    return row ? toQuickDraft(row) : undefined;
  };

  const saveQuickDraft = db.transaction((
    input: SaveQuickDraftInput & { updatedAt: number },
  ): QuickDraft => {
    const current = getQuickDraft();
    const currentRevision = current?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) throw staleRevisionError();
    const revision = currentRevision + 1;
    const plannedAt = input.plannedAt ?? null;
    const dueAt = input.dueAt ?? null;
    const reminderAt = input.reminderAt ?? null;
    const recurrence = input.recurrence ?? null;
    if (current) {
      const result = updateQuickDraftStatement.run(
        input.mode,
        input.title,
        input.markdown,
        plannedAt,
        dueAt,
        reminderAt,
        recurrence,
        revision,
        input.updatedAt,
        currentRevision,
      ) as RunResult;
      if (result.changes !== 1) throw staleRevisionError();
    } else {
      insertQuickDraftStatement.run(
        input.mode,
        input.title,
        input.markdown,
        plannedAt,
        dueAt,
        reminderAt,
        recurrence,
        revision,
        input.updatedAt,
      );
    }
    return {
      id: "quick",
      mode: input.mode,
      title: input.title,
      markdown: input.markdown,
      plannedAt,
      dueAt,
      reminderAt,
      recurrence,
      revision,
      updatedAt: input.updatedAt,
    };
  }) as (input: SaveQuickDraftInput & { updatedAt: number }) => QuickDraft;

  const createNote = (note: Note): Note => {
    insertNoteStatement.run(
      note.id,
      note.title,
      note.markdown,
      note.revision,
      note.createdAt,
      note.updatedAt,
      note.parentId,
      note.sortOrder,
      note.pinnedAt,
      note.organizedAt,
    );
    return { ...note };
  };

  const commitQuickDraft = db.transaction((note: Note, expectedRevision: number): Note => {
    const draft = getQuickDraft();
    if (!draft) throw new Error("没有可提交的快捷草稿。");
    if (draft.revision !== expectedRevision) throw staleRevisionError();
    createNote(note);
    const result = deleteQuickDraftStatement.run(expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return { ...note };
  }) as (note: Note, expectedRevision: number) => Note;

  const getNote = (id: string): Note | undefined => {
    const row = getNoteStatement.get(id) as NoteRow | undefined;
    return row ? toNote(row, listNoteAttachments(id)) : undefined;
  };
  const listArchivedNotes = (): Note[] =>
    (listArchivedNotesStatement.all() as NoteRow[]).map((row) => toNote(row, listNoteAttachments(row.id)));
  const getTrashNote = (id: string): Note | undefined => {
    const row = getTrashNoteStatement.get(id) as NoteRow | undefined;
    return row ? toNote(row, listNoteAttachments(id)) : undefined;
  };

  const updateNote = db.transaction((
    input: UpdateNoteInput & { updatedAt: number },
  ): Note => {
    const current = getNote(input.id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== input.expectedRevision) throw staleRevisionError();
    const revision = current.revision + 1;
    const result = updateNoteStatement.run(
      input.title,
      input.markdown,
      revision,
      input.updatedAt,
      input.id,
      input.expectedRevision,
    ) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return {
      ...current,
      title: input.title,
      markdown: input.markdown,
      revision,
      updatedAt: input.updatedAt,
    };
  }) as (input: UpdateNoteInput & { updatedAt: number }) => Note;

  const sortSiblings = (rows: NoteRow[]): NoteRow[] => [...rows].sort((left, right) => (
    left.sort_order - right.sort_order
    || right.updated_at - left.updated_at
    || right.created_at - left.created_at
    || left.id.localeCompare(right.id)
  ));

  const sameParent = (left: string | null, right: string | null): boolean => left === right;

  const moveNote = db.transaction((input: MoveNoteInput): Note[] => {
    if (!Number.isInteger(input.index) || input.index < 0) {
      throw new Error("便签排序位置必须是非负整数。");
    }
    const rows = listOrganizationRowsStatement.all() as NoteRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const current = byId.get(input.id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== input.expectedRevision) throw staleRevisionError();
    if (input.parentId === input.id) throw noteCycleError();
    if (input.parentId !== null && !byId.has(input.parentId)) throw noteParentNotFoundError();

    let ancestorId = input.parentId;
    const visited = new Set<string>();
    while (ancestorId !== null) {
      if (ancestorId === input.id) throw noteCycleError();
      if (visited.has(ancestorId)) throw noteCycleError();
      visited.add(ancestorId);
      ancestorId = byId.get(ancestorId)?.parent_id ?? null;
    }

    const oldSiblings = sortSiblings(rows.filter((row) => (
      row.id !== input.id && sameParent(row.parent_id, current.parent_id)
    )));
    const targetSiblings = sameParent(current.parent_id, input.parentId)
      ? oldSiblings
      : sortSiblings(rows.filter((row) => (
        row.id !== input.id && sameParent(row.parent_id, input.parentId)
      )));
    const insertionIndex = Math.min(input.index, targetSiblings.length);
    const nextTargetSiblings = [...targetSiblings];
    nextTargetSiblings.splice(insertionIndex, 0, { ...current, parent_id: input.parentId });

    for (const [index, row] of oldSiblings.entries()) {
      if (row.sort_order !== index) updateNoteSortStatement.run(index, row.id);
    }
    for (const [index, row] of nextTargetSiblings.entries()) {
      if (row.id === input.id) continue;
      if (row.sort_order !== index) updateNoteSortStatement.run(index, row.id);
    }
    const moved = moveNoteStatement.run(
      input.parentId,
      insertionIndex,
      input.id,
      input.expectedRevision,
    ) as RunResult;
    if (moved.changes !== 1) throw staleRevisionError();

    const affectedIds = sameParent(current.parent_id, input.parentId)
      ? nextTargetSiblings.map((row) => row.id)
      : [...oldSiblings.map((row) => row.id), ...nextTargetSiblings.map((row) => row.id)];
    return affectedIds.map((id) => getNote(id)!).filter(Boolean);
  }) as CapturePersistence["moveNote"];

  const setNotePinned = db.transaction((
    input: SetNotePinnedInput & { updatedAt: number },
  ): Note => {
    const current = getNote(input.id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== input.expectedRevision) throw staleRevisionError();
    const result = setNotePinnedStatement.run(
      input.pinned ? input.updatedAt : null,
      input.updatedAt,
      input.id,
      input.expectedRevision,
    ) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(input.id)!;
  }) as CapturePersistence["setNotePinned"];

  const markNoteOrganized = db.transaction((
    input: MarkNoteOrganizedInput & { updatedAt: number },
  ): Note => {
    const current = getNote(input.id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== input.expectedRevision) throw staleRevisionError();
    const result = markNoteOrganizedStatement.run(
      input.organized ? input.updatedAt : null,
      input.updatedAt,
      input.id,
      input.expectedRevision,
    ) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(input.id)!;
  }) as CapturePersistence["markNoteOrganized"];

  const archiveNote = db.transaction((id: string, expectedRevision: number, archivedAt: number): Note => {
    const current = getNote(id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = archiveNoteStatement.run(archivedAt, archivedAt, id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(id)!;
  }) as CapturePersistence["archiveNote"];

  const unarchiveNote = db.transaction((id: string, expectedRevision: number, updatedAt: number): Note => {
    const current = getNote(id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = unarchiveNoteStatement.run(updatedAt, id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(id)!;
  }) as CapturePersistence["unarchiveNote"];

  const addNoteAttachment = db.transaction((
    noteId: string,
    attachment: NoteAttachment,
    expectedRevision: number,
    updatedAt: number,
  ): Note => {
    const current = getNote(noteId);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    insertNoteAttachmentStatement.run(
      attachment.id,
      noteId,
      attachment.kind,
      attachment.storage,
      attachment.name,
      attachment.path,
      attachment.mimeType ?? null,
      attachment.size,
      attachment.createdAt,
    );
    const revision = current.revision + 1;
    const result = revisionNoteStatement.run(revision, updatedAt, noteId, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(noteId)!;
  }) as CapturePersistence["addNoteAttachment"];

  const removeNoteAttachment = db.transaction((
    noteId: string,
    attachmentId: string,
    expectedRevision: number,
    updatedAt: number,
  ): Note => {
    const current = getNote(noteId);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    if (!getNoteAttachmentStatement.get(noteId, attachmentId)) {
      throw new Error("这个便签附件不存在，可能已被移除。");
    }
    deleteNoteAttachmentStatement.run(noteId, attachmentId);
    const revision = current.revision + 1;
    const result = revisionNoteStatement.run(revision, updatedAt, noteId, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(noteId)!;
  }) as CapturePersistence["removeNoteAttachment"];

  const deleteNote = db.transaction((
    id: string,
    expectedRevision: number,
    deletedAt: number,
    purgeAfter: number,
  ): Note => {
    const current = getNote(id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = trashNoteStatement.run(deletedAt, purgeAfter, deletedAt, id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getTrashNote(id)!;
  }) as CapturePersistence["deleteNote"];

  const restoreNote = db.transaction((id: string, expectedRevision: number, updatedAt: number): Note => {
    const current = getTrashNote(id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = restoreNoteStatement.run(updatedAt, id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getNote(id)!;
  }) as CapturePersistence["restoreNote"];

  const permanentlyDeleteNote = db.transaction((id: string, expectedRevision: number): Note => {
    const current = getTrashNote(id);
    if (!current) throw noteNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    deleteNoteAttachmentsStatement.run(id);
    const result = permanentlyDeleteNoteStatement.run(id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return current;
  }) as CapturePersistence["permanentlyDeleteNote"];

  const purgeExpired = db.transaction((now: number): Note[] => {
    const expired = (listTrashStatement.all() as NoteRow[])
      .filter((row) => row.purge_after !== null && row.purge_after < now)
      .map((row) => toNote(row, listNoteAttachments(row.id)));
    for (const note of expired) {
      deleteNoteAttachmentsStatement.run(note.id);
      permanentlyDeleteNoteStatement.run(note.id, note.revision);
    }
    return expired;
  }) as CapturePersistence["purgeExpired"];

  return {
    getQuickDraft,
    saveQuickDraft,
    commitQuickDraft,
    listNotes: () => (listNotesStatement.all() as NoteRow[])
      .map((row) => toNote(row, listNoteAttachments(row.id))),
    listArchivedNotes,
    getNote,
    createNote,
    updateNote,
    moveNote,
    setNotePinned,
    markNoteOrganized,
    archiveNote,
    unarchiveNote,
    deleteNote,
    listTrash: () => (listTrashStatement.all() as NoteRow[])
      .map((row) => toNote(row, listNoteAttachments(row.id))),
    restoreNote,
    permanentlyDeleteNote,
    purgeExpired,
    addNoteAttachment,
    removeNoteAttachment,
  };
}
