import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  QUICK_DRAFT_ID,
  type AttachFileInput,
  type AttachImageBytesInput,
  type ArchiveNoteInput,
  type CaptureChange,
  type CommitQuickDraftInput,
  type CreateNoteInput,
  type DeleteNoteInput,
  type PermanentlyDeleteNoteInput,
  type Note,
  type NoteAttachment,
  type MigrateCaptureStorageInput,
  type QuickCaptureMode,
  type QuickDraftRecurrence,
  type QuickDraft,
  type RemoveNoteAttachmentInput,
  type RestoreNoteInput,
  type SaveQuickDraftInput,
  type UpdateNoteInput,
  type UnarchiveNoteInput,
} from "../captures";
import type { CaptureStorageService } from "./capture-storage";
import type { CapturePersistence } from "./persistence/capture-persistence";

const MAX_TITLE_LENGTH = 500;
const MAX_MARKDOWN_LENGTH = 1_000_000;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface CaptureAdminService {
  getQuickDraft(): QuickDraft;
  saveQuickDraft(input: SaveQuickDraftInput): QuickDraft;
  commitQuickDraft(input: CommitQuickDraftInput): Note;
  listNotes(): Note[];
  listArchivedNotes(): Note[];
  getNote(id: string): Note | null;
  createNote(input: CreateNoteInput): Note;
  updateNote(input: UpdateNoteInput): Note;
  archiveNote(input: ArchiveNoteInput): Note;
  unarchiveNote(input: UnarchiveNoteInput): Note;
  deleteNote(input: DeleteNoteInput): void;
  /** Optional during staged main-process wiring; createCaptureAdmin provides all five. */
  attachImageBytes?(input: AttachImageBytesInput): Promise<Note>;
  attachExternalFile?(input: AttachFileInput): Promise<Note>;
  attachFileCopy?(input: AttachFileInput): Promise<Note>;
  removeAttachment?(input: RemoveNoteAttachmentInput): Promise<Note>;
  migrateStorageRoot?(input: MigrateCaptureStorageInput): Promise<string>;
  subscribe(listener: (change: CaptureChange) => void): () => void;
}

export type CaptureAdminWithAttachments = CaptureAdminService & Required<Pick<
  CaptureAdminService,
  | "attachImageBytes"
  | "attachExternalFile"
  | "attachFileCopy"
  | "removeAttachment"
  | "migrateStorageRoot"
>>;

export type CaptureAdminWithTrash = CaptureAdminWithAttachments & {
  listTrash(): Note[];
  restoreNote(input: RestoreNoteInput): Note;
  permanentlyDeleteNote(input: PermanentlyDeleteNoteInput): Promise<void>;
  purgeExpired(now?: number): Promise<number>;
};

export interface CaptureAdminOptions {
  persistence: CapturePersistence;
  now?: () => number;
  randomId?: () => string;
  storage?: CaptureStorageService;
  getStorageRoot?: () => string | undefined;
  setStorageRoot?: (root: string) => void;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("便签内容格式不正确。");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label}格式不正确。`);
  if (value.length > maxLength) throw new Error(`${label}太长，请缩短后再保存。`);
  return value;
}

function requireRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("便签版本不正确，请刷新后重试。");
  }
  return Number(value);
}

function requireId(value: unknown): string {
  const id = requireString(value, "便签编号", 200).trim();
  if (!id) throw new Error("便签编号不能为空。");
  return id;
}

function normalizeContent(value: unknown): { title: string; markdown: string } {
  const input = requireRecord(value);
  return {
    title: requireString(input.title, "标题", MAX_TITLE_LENGTH),
    markdown: requireString(input.markdown, "正文", MAX_MARKDOWN_LENGTH).replace(/\r\n/g, "\n"),
  };
}

function optionalTimestamp(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}格式不正确。`);
  }
  return value;
}

function optionalRecurrence(value: unknown): QuickDraftRecurrence | null {
  if (value === undefined || value === null) return null;
  if (value === "daily" || value === "weekly" || value === "monthly" || value === "weekdays") {
    return value;
  }
  throw new Error("重复规则不正确。");
}

function normalizeTaskFields(value: Record<string, unknown>) {
  return {
    plannedAt: optionalTimestamp(value.plannedAt, "计划时间"),
    dueAt: optionalTimestamp(value.dueAt, "截止时间"),
    reminderAt: optionalTimestamp(value.reminderAt, "提醒时间"),
    recurrence: optionalRecurrence(value.recurrence),
  };
}

function requireNonEmptyContent(content: { title: string; markdown: string }): {
  title: string;
  markdown: string;
} {
  const title = content.title.trim();
  if (!title && !content.markdown.trim()) throw new Error("请先写下标题或正文内容。");
  return { title, markdown: content.markdown };
}

function cloneDraft(draft: QuickDraft): QuickDraft {
  return { ...draft };
}

function cloneNote(note: Note): Note {
  return {
    ...note,
    ...(note.attachments ? { attachments: note.attachments.map((attachment) => ({ ...attachment })) } : {}),
  };
}

function requireStorage(options: CaptureAdminOptions): CaptureStorageService {
  if (!options.storage) throw new Error("便签附件服务尚未准备好，请稍后重试。");
  return options.storage;
}

function requireFilePath(value: unknown): string {
  const filePath = requireString(value, "文件路径", 32_000).trim();
  if (!filePath) throw new Error("请选择要添加的文件。");
  return filePath;
}

function requireAttachmentId(value: unknown): string {
  const id = requireString(value, "附件编号", 200).trim();
  if (!id) throw new Error("附件编号不能为空。");
  return id;
}

function requireImageBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value as number[]);
  }
  throw new Error("图片内容格式不正确。");
}

export function createCaptureAdmin(options: CaptureAdminOptions): CaptureAdminWithTrash {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;
  const listeners = new Set<(change: CaptureChange) => void>();

  const emit = (change: CaptureChange): void => {
    for (const listener of listeners) {
      try {
        listener({ ...change });
      } catch {
        // A closed renderer must not turn an already committed DB write into a
        // reported failure for another renderer.
      }
    }
  };

  const getPersistedDraft = (): QuickDraft | undefined => options.persistence.getQuickDraft();

  const service: CaptureAdminWithTrash = {
    getQuickDraft() {
      return cloneDraft(getPersistedDraft() ?? {
        id: QUICK_DRAFT_ID,
        mode: "note",
        title: "",
        markdown: "",
        plannedAt: null,
        dueAt: null,
        reminderAt: null,
        recurrence: null,
        revision: 0,
        updatedAt: 0,
      });
    },
    saveQuickDraft(value) {
      const input = requireRecord(value);
      const content = normalizeContent(input);
      const mode = input.mode;
      if (mode !== "note" && mode !== "task") throw new Error("快捷记录类型不正确。");
      const draft = options.persistence.saveQuickDraft({
        mode: mode as QuickCaptureMode,
        ...content,
        ...normalizeTaskFields(input),
        expectedRevision: requireRevision(input.expectedRevision),
        updatedAt: now(),
      });
      emit({
        entity: "quickDraft",
        action: "saved",
        id: QUICK_DRAFT_ID,
        revision: draft.revision,
      });
      return cloneDraft(draft);
    },
    commitQuickDraft(value) {
      const input = requireRecord(value);
      const expectedRevision = requireRevision(input.expectedRevision);
      const draft = getPersistedDraft();
      if (!draft) throw new Error("没有可提交的快捷草稿。");
      if (draft.revision !== expectedRevision) {
        throw new Error("内容已在别处更新，请刷新后重试。");
      }
      if (draft.mode === "task") throw new Error("待办提交将在后续里程碑开放。");
      const content = requireNonEmptyContent(normalizeContent(draft));
      const timestamp = now();
      const note: Note = {
        id: randomId(),
        ...content,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        parentId: null,
        sortOrder: 0,
        pinnedAt: null,
        organizedAt: null,
      };
      const committed = options.persistence.commitQuickDraft(note, expectedRevision);
      emit({ entity: "note", action: "created", id: committed.id, revision: committed.revision });
      emit({
        entity: "quickDraft",
        action: "cleared",
        id: QUICK_DRAFT_ID,
        revision: draft.revision,
      });
      return cloneNote(committed);
    },
    listNotes() {
      return options.persistence.listNotes().map(cloneNote);
    },
    listArchivedNotes() {
      return options.persistence.listArchivedNotes().map(cloneNote);
    },
    getNote(value) {
      const note = options.persistence.getNote(requireId(value));
      return note ? cloneNote(note) : null;
    },
    createNote(value) {
      const content = requireNonEmptyContent(normalizeContent(value));
      const timestamp = now();
      const created = options.persistence.createNote({
        id: randomId(),
        ...content,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        parentId: null,
        sortOrder: 0,
        pinnedAt: null,
        organizedAt: null,
      });
      emit({ entity: "note", action: "created", id: created.id, revision: created.revision });
      return cloneNote(created);
    },
    updateNote(value) {
      const input = requireRecord(value);
      const content = requireNonEmptyContent(normalizeContent(input));
      const updated = options.persistence.updateNote({
        id: requireId(input.id),
        ...content,
        expectedRevision: requireRevision(input.expectedRevision),
        updatedAt: now(),
      });
      emit({ entity: "note", action: "updated", id: updated.id, revision: updated.revision });
      return cloneNote(updated);
    },
    archiveNote(value) {
      const input = requireRecord(value);
      const archived = options.persistence.archiveNote(
        requireId(input.id),
        requireRevision(input.expectedRevision),
        now(),
      );
      emit({ entity: "note", action: "archived", id: archived.id, revision: archived.revision });
      return cloneNote(archived);
    },
    unarchiveNote(value) {
      const input = requireRecord(value);
      const restored = options.persistence.unarchiveNote(
        requireId(input.id),
        requireRevision(input.expectedRevision),
        now(),
      );
      emit({ entity: "note", action: "unarchived", id: restored.id, revision: restored.revision });
      return cloneNote(restored);
    },
    deleteNote(value) {
      const input = requireRecord(value);
      const id = requireId(input.id);
      const expectedRevision = requireRevision(input.expectedRevision);
      const timestamp = now();
      const trashed = options.persistence.deleteNote(
        id,
        expectedRevision,
        timestamp,
        timestamp + TRASH_RETENTION_MS,
      );
      emit({ entity: "note", action: "deleted", id, revision: trashed.revision });
    },
    listTrash() {
      return options.persistence.listTrash().map(cloneNote);
    },
    restoreNote(value) {
      const input = requireRecord(value);
      const restored = options.persistence.restoreNote(
        requireId(input.id),
        requireRevision(input.expectedRevision),
        now(),
      );
      emit({ entity: "note", action: "restored", id: restored.id, revision: restored.revision });
      return cloneNote(restored);
    },
    async permanentlyDeleteNote(value) {
      const input = requireRecord(value);
      const deleted = options.persistence.permanentlyDeleteNote(
        requireId(input.id),
        requireRevision(input.expectedRevision),
      );
      if (options.storage) {
        for (const attachment of deleted.attachments ?? []) {
          if (attachment.storage !== "managed") continue;
          await options.storage.removeAttachment(options.getStorageRoot?.(), attachment).catch(() => undefined);
        }
      }
      emit({ entity: "note", action: "permanentlyDeleted", id: deleted.id, revision: deleted.revision });
    },
    async purgeExpired(currentTime = now()) {
      const deleted = options.persistence.purgeExpired(currentTime);
      if (options.storage) {
        for (const note of deleted) {
          for (const attachment of note.attachments ?? []) {
            if (attachment.storage !== "managed") continue;
            await options.storage.removeAttachment(options.getStorageRoot?.(), attachment).catch(() => undefined);
          }
        }
      }
      for (const note of deleted) {
        emit({ entity: "note", action: "permanentlyDeleted", id: note.id, revision: note.revision });
      }
      return deleted.length;
    },
    async attachImageBytes(value) {
      const input = requireRecord(value);
      const noteId = requireId(input.noteId);
      const expectedRevision = requireRevision(input.expectedRevision);
      const current = options.persistence.getNote(noteId);
      if (!current) throw new Error("这条便签不存在，可能已被删除。");
      if (current.revision !== expectedRevision) throw new Error("内容已在别处更新，请刷新后重试。");
      const storage = requireStorage(options);
      const storageRoot = options.getStorageRoot?.();
      const attachment = await storage.storeImageBytes(storageRoot, noteId, {
        name: requireString(input.name, "图片名称", 500),
        mimeType: requireString(input.mimeType, "图片类型", 200),
        bytes: requireImageBytes(input.bytes),
      });
      try {
        const updated = options.persistence.addNoteAttachment(
          noteId,
          attachment,
          expectedRevision,
          now(),
        );
        emit({ entity: "note", action: "updated", id: updated.id, revision: updated.revision });
        return cloneNote(updated);
      } catch (error) {
        await storage.removeAttachment(storageRoot, attachment).catch(() => undefined);
        throw error;
      }
    },
    async attachExternalFile(value) {
      const input = requireRecord(value);
      const noteId = requireId(input.noteId);
      const expectedRevision = requireRevision(input.expectedRevision);
      const storage = requireStorage(options);
      const attachment = await storage.referenceExternalFile(requireFilePath(input.path));
      const updated = options.persistence.addNoteAttachment(
        noteId,
        attachment,
        expectedRevision,
        now(),
      );
      emit({ entity: "note", action: "updated", id: updated.id, revision: updated.revision });
      return cloneNote(updated);
    },
    async attachFileCopy(value) {
      const input = requireRecord(value);
      const noteId = requireId(input.noteId);
      const expectedRevision = requireRevision(input.expectedRevision);
      const current = options.persistence.getNote(noteId);
      if (!current) throw new Error("这条便签不存在，可能已被删除。");
      if (current.revision !== expectedRevision) throw new Error("内容已在别处更新，请刷新后重试。");
      const storage = requireStorage(options);
      const storageRoot = options.getStorageRoot?.();
      const attachment = await storage.copyExternalFile(storageRoot, noteId, requireFilePath(input.path));
      try {
        const updated = options.persistence.addNoteAttachment(
          noteId,
          attachment,
          expectedRevision,
          now(),
        );
        emit({ entity: "note", action: "updated", id: updated.id, revision: updated.revision });
        return cloneNote(updated);
      } catch (error) {
        await storage.removeAttachment(storageRoot, attachment).catch(() => undefined);
        throw error;
      }
    },
    async removeAttachment(value) {
      const input = requireRecord(value);
      const noteId = requireId(input.noteId);
      const attachmentId = requireAttachmentId(input.attachmentId);
      const expectedRevision = requireRevision(input.expectedRevision);
      const current = options.persistence.getNote(noteId);
      if (!current) throw new Error("这条便签不存在，可能已被删除。");
      const attachment = current.attachments?.find((candidate) => candidate.id === attachmentId);
      if (!attachment) throw new Error("这个便签附件不存在，可能已被移除。");
      const updated = options.persistence.removeNoteAttachment(
        noteId,
        attachmentId,
        expectedRevision,
        now(),
      );
      emit({ entity: "note", action: "updated", id: updated.id, revision: updated.revision });
      await requireStorage(options)
        .removeAttachment(options.getStorageRoot?.(), attachment as NoteAttachment)
        .catch(() => undefined);
      return cloneNote(updated);
    },
    async migrateStorageRoot(value) {
      const input = requireRecord(value);
      if (!options.setStorageRoot) throw new Error("文件存储位置设置尚未准备好，请稍后重试。");
      const newRoot = requireFilePath(input.newRoot);
      const storage = requireStorage(options);
      const currentRoot = options.getStorageRoot?.();
      const migrated = await storage.migrateManagedStorage(
        currentRoot,
        newRoot,
      );
      options.setStorageRoot(migrated);
      if (currentRoot?.trim() && path.resolve(currentRoot.trim()) !== migrated) {
        await storage.cleanupManagedStorage(currentRoot).catch(() => undefined);
      }
      return migrated;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return service;
}
