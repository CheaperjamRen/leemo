export const QUICK_DRAFT_ID = "quick" as const;

export type QuickCaptureMode = "note" | "task";
export type QuickDraftRecurrence = "daily" | "weekly" | "monthly" | "weekdays";

/** Reserved discriminator for the later workbench milestone. Task storage is
 * deliberately not part of the quick-capture MVP. */
export type CaptureEntityKind = "note" | "userTask";

export type NoteAttachmentKind = "image" | "file";
export type NoteAttachmentStorage = "managed" | "external";

/**
 * Managed paths are relative to the user-selected Leemo storage root. External
 * paths are absolute references to the user's original file. Keeping managed
 * paths relative makes moving the storage root cheap and recoverable.
 */
export interface NoteAttachment {
  id: string;
  kind: NoteAttachmentKind;
  storage: NoteAttachmentStorage;
  name: string;
  path: string;
  mimeType?: string;
  size: number;
  createdAt: number;
}

export interface CaptureAttachmentActionInput {
  noteId: string;
  attachmentId: string;
}

export type CaptureAttachmentPreview =
  | { kind: "image"; name: string; mimeType: string; base64: string }
  | { kind: "pdf"; name: string; base64: string }
  | { kind: "markdown"; name: string; text: string }
  | { kind: "text"; name: string; text: string };

export interface Note {
  id: string;
  title: string;
  markdown: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** A note can contain child notes while remaining an editable document itself. */
  parentId: string | null;
  /** Stable zero-based order among siblings. */
  sortOrder: number;
  /** Present when the user pins the note; the timestamp keeps ordering deterministic. */
  pinnedAt: number | null;
  /** Present after the note leaves the unorganized inbox. */
  organizedAt: number | null;
  /** Present when the note is hidden from the ordinary library. */
  archivedAt?: number;
  /** Present only while the note is in Leemo's trash. */
  deletedAt?: number;
  /** Present only while the note is in Leemo's trash. */
  purgeAfter?: number;
  /** Absent for legacy and attachment-free notes. */
  attachments?: NoteAttachment[];
}

export interface QuickDraft {
  id: typeof QUICK_DRAFT_ID;
  mode: QuickCaptureMode;
  title: string;
  markdown: string;
  plannedAt: number | null;
  dueAt: number | null;
  reminderAt: number | null;
  recurrence: QuickDraftRecurrence | null;
  revision: number;
  updatedAt: number;
}

export interface SaveQuickDraftInput {
  mode: QuickCaptureMode;
  title: string;
  markdown: string;
  plannedAt?: number | null;
  dueAt?: number | null;
  reminderAt?: number | null;
  recurrence?: QuickDraftRecurrence | null;
  expectedRevision: number;
}

export interface CommitQuickDraftInput {
  expectedRevision: number;
}

export interface UpdateNoteInput {
  id: string;
  title: string;
  markdown: string;
  expectedRevision: number;
}

export interface CreateNoteInput {
  title: string;
  markdown: string;
}

export interface MoveNoteInput {
  id: string;
  expectedRevision: number;
  parentId: string | null;
  index: number;
}

export interface SetNotePinnedInput {
  id: string;
  expectedRevision: number;
  pinned: boolean;
}

export interface MarkNoteOrganizedInput {
  id: string;
  expectedRevision: number;
  organized: boolean;
}

export type NoteChildStrategy = "subtree" | "lift";

export interface MutateNoteTreeInput {
  id: string;
  expectedRevision: number;
  childStrategy: NoteChildStrategy;
}

export type DeleteNoteInput = MutateNoteTreeInput;

export type ArchiveNoteInput = MutateNoteTreeInput;

export interface UnarchiveNoteInput {
  id: string;
  expectedRevision: number;
}

export interface RestoreNoteInput {
  id: string;
  expectedRevision: number;
}

export interface PermanentlyDeleteNoteInput {
  id: string;
  expectedRevision: number;
}

export interface AttachImageBytesInput {
  noteId: string;
  expectedRevision: number;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface AttachFileInput {
  noteId: string;
  expectedRevision: number;
  path: string;
}

export interface RemoveNoteAttachmentInput {
  noteId: string;
  attachmentId: string;
  expectedRevision: number;
}

export interface MigrateCaptureStorageInput {
  newRoot: string;
}

/** The five operations shared by the regular and narrow quick-capture clients. */
export interface CaptureOperationInputs {
  getQuickDraft: undefined;
  saveQuickDraft: SaveQuickDraftInput;
  commitQuickDraft: CommitQuickDraftInput;
  listNotes: undefined;
  listArchivedNotes: undefined;
  updateNote: UpdateNoteInput;
  moveNote: MoveNoteInput;
  setNotePinned: SetNotePinnedInput;
  markNoteOrganized: MarkNoteOrganizedInput;
  attachImageBytes: AttachImageBytesInput;
  attachExternalFile: AttachFileInput;
  attachFileCopy: AttachFileInput;
  previewAttachment: CaptureAttachmentActionInput;
  openAttachment: CaptureAttachmentActionInput;
  revealAttachment: CaptureAttachmentActionInput;
  removeAttachment: RemoveNoteAttachmentInput;
  migrateStorageRoot: MigrateCaptureStorageInput;
}

export type CaptureOperation = keyof CaptureOperationInputs;

export type CaptureChange =
  | {
    entity: "quickDraft";
    action: "saved" | "cleared";
    id: typeof QUICK_DRAFT_ID;
    revision: number;
  }
  | {
    entity: "note";
    action: "created" | "updated" | "moved" | "pinned" | "organized" | "archived" | "unarchived" | "deleted" | "restored" | "permanentlyDeleted";
    id: string;
    revision: number;
  };
