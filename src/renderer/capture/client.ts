import type {
  AttachFileInput,
  AttachImageBytesInput,
  ArchiveNoteInput,
  CaptureChange,
  CommitQuickDraftInput,
  CreateNoteInput,
  DeleteNoteInput,
  Note,
  MigrateCaptureStorageInput,
  QuickDraft,
  RemoveNoteAttachmentInput,
  SaveQuickDraftInput,
  UpdateNoteInput,
  UnarchiveNoteInput,
} from "../../captures";
import type { CreateTaskInput, UserTask } from "../../tasks";

export interface CaptureInvokeResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export interface LeemoCaptureApi {
  invoke(op: string, payload: unknown): Promise<CaptureInvokeResult>;
  onChanged(listener: (change: CaptureChange) => void): () => void;
}

export interface LeemoQuickCaptureApi {
  getQuickDraft(): Promise<CaptureInvokeResult>;
  saveQuickDraft(input: SaveQuickDraftInput): Promise<CaptureInvokeResult>;
  commitQuickDraft(input: CommitQuickDraftInput): Promise<CaptureInvokeResult>;
  createTask(input: CreateTaskInput): Promise<CaptureInvokeResult>;
  attachImageBytes(input: AttachImageBytesInput): Promise<CaptureInvokeResult>;
  attachDroppedFile(input: AttachFileInput): Promise<CaptureInvokeResult>;
  pathForFile(file: File): string;
  hide(): void;
  onChanged(listener: (change: CaptureChange) => void): () => void;
}

export interface CaptureClient {
  getQuickDraft(): Promise<QuickDraft>;
  saveQuickDraft(input: SaveQuickDraftInput): Promise<QuickDraft>;
  commitQuickDraft(input: CommitQuickDraftInput): Promise<Note>;
  listNotes(): Promise<Note[]>;
  listArchivedNotes(): Promise<Note[]>;
  createNote(input: CreateNoteInput): Promise<Note>;
  updateNote(input: UpdateNoteInput): Promise<Note>;
  archiveNote(input: ArchiveNoteInput): Promise<Note>;
  unarchiveNote(input: UnarchiveNoteInput): Promise<Note>;
  deleteNote(input: DeleteNoteInput): Promise<void>;
  attachImageBytes(input: AttachImageBytesInput): Promise<Note>;
  attachExternalFile(input: AttachFileInput): Promise<Note>;
  attachFileCopy(input: AttachFileInput): Promise<Note>;
  removeAttachment(input: RemoveNoteAttachmentInput): Promise<Note>;
  migrateStorageRoot(input: MigrateCaptureStorageInput): Promise<string>;
  onChanged(listener: (change: CaptureChange) => void): () => void;
}

export interface QuickCaptureClient
  extends Pick<
    CaptureClient,
    "getQuickDraft" | "saveQuickDraft" | "commitQuickDraft" | "onChanged"
  > {
  hide(): Promise<void>;
  createTask(input: CreateTaskInput): Promise<UserTask>;
  attachImageBytes(input: AttachImageBytesInput): Promise<Note>;
  attachDroppedFile(input: AttachFileInput): Promise<Note>;
  pathForFile(file: File): string;
}

function requireResponse<T>(result: CaptureInvokeResult): T {
  if (!result.ok) {
    throw new Error(result.error || "快捷记录暂时无法使用，请稍后重试。");
  }
  return result.response as T;
}

export class IpcCaptureClient implements CaptureClient {
  constructor(private readonly api: LeemoCaptureApi) {}

  private async call<T>(op: string, payload?: unknown): Promise<T> {
    return requireResponse<T>(await this.api.invoke(op, payload));
  }

  getQuickDraft(): Promise<QuickDraft> {
    return this.call("getQuickDraft");
  }

  saveQuickDraft(input: SaveQuickDraftInput): Promise<QuickDraft> {
    return this.call("saveQuickDraft", input);
  }

  commitQuickDraft(input: CommitQuickDraftInput): Promise<Note> {
    return this.call("commitQuickDraft", input);
  }

  listNotes(): Promise<Note[]> {
    return this.call("listNotes");
  }

  listArchivedNotes(): Promise<Note[]> {
    return this.call("listArchivedNotes");
  }

  createNote(input: CreateNoteInput): Promise<Note> {
    return this.call("createNote", input);
  }

  updateNote(input: UpdateNoteInput): Promise<Note> {
    return this.call("updateNote", input);
  }

  archiveNote(input: ArchiveNoteInput): Promise<Note> {
    return this.call("archiveNote", input);
  }

  unarchiveNote(input: UnarchiveNoteInput): Promise<Note> {
    return this.call("unarchiveNote", input);
  }

  deleteNote(input: DeleteNoteInput): Promise<void> {
    return this.call("deleteNote", input);
  }

  attachImageBytes(input: AttachImageBytesInput): Promise<Note> {
    return this.call("attachImageBytes", input);
  }

  attachExternalFile(input: AttachFileInput): Promise<Note> {
    return this.call("attachExternalFile", input);
  }

  attachFileCopy(input: AttachFileInput): Promise<Note> {
    return this.call("attachFileCopy", input);
  }

  removeAttachment(input: RemoveNoteAttachmentInput): Promise<Note> {
    return this.call("removeAttachment", input);
  }

  migrateStorageRoot(input: MigrateCaptureStorageInput): Promise<string> {
    return this.call("migrateStorageRoot", input);
  }

  onChanged(listener: (change: CaptureChange) => void): () => void {
    return this.api.onChanged(listener);
  }
}

export class IpcQuickCaptureClient implements QuickCaptureClient {
  constructor(private readonly api: LeemoQuickCaptureApi) {}

  async getQuickDraft(): Promise<QuickDraft> {
    return requireResponse<QuickDraft>(await this.api.getQuickDraft());
  }

  async saveQuickDraft(input: SaveQuickDraftInput): Promise<QuickDraft> {
    return requireResponse<QuickDraft>(await this.api.saveQuickDraft(input));
  }

  async commitQuickDraft(input: CommitQuickDraftInput): Promise<Note> {
    return requireResponse<Note>(await this.api.commitQuickDraft(input));
  }

  async createTask(input: CreateTaskInput): Promise<UserTask> {
    return requireResponse<UserTask>(await this.api.createTask(input));
  }

  async attachImageBytes(input: AttachImageBytesInput): Promise<Note> {
    return requireResponse<Note>(await this.api.attachImageBytes(input));
  }

  async attachDroppedFile(input: AttachFileInput): Promise<Note> {
    return requireResponse<Note>(await this.api.attachDroppedFile(input));
  }

  pathForFile(file: File): string {
    return this.api.pathForFile(file);
  }

  async hide(): Promise<void> {
    this.api.hide();
  }

  onChanged(listener: (change: CaptureChange) => void): () => void {
    return this.api.onChanged(listener);
  }
}
