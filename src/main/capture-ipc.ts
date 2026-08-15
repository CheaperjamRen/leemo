import type {
  AttachFileInput,
  AttachImageBytesInput,
  ArchiveNoteInput,
  CommitQuickDraftInput,
  CreateNoteInput,
  DeleteNoteInput,
  MigrateCaptureStorageInput,
  RemoveNoteAttachmentInput,
  SaveQuickDraftInput,
  UpdateNoteInput,
  UnarchiveNoteInput,
} from "../captures";
import type { CaptureAdminService } from "./capture-admin";

export type CaptureIpcSender = "main" | "quick";

export interface CaptureIpcResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export interface CaptureIpcDispatcher {
  handle(sender: CaptureIpcSender | null, message: unknown): Promise<CaptureIpcResult>;
}

export interface CaptureIpcDispatcherOptions {
  getQuickCaptureFileDropMode?(): "reference" | "copy";
}

const QUICK_OPERATIONS = new Set([
  "getQuickDraft",
  "saveQuickDraft",
  "commitQuickDraft",
  "attachImageBytes",
  "attachDroppedFile",
]);

const MAIN_OPERATIONS = new Set([
  ...QUICK_OPERATIONS,
  "listNotes",
  "listArchivedNotes",
  "getNote",
  "createNote",
  "updateNote",
  "archiveNote",
  "unarchiveNote",
  "deleteNote",
  "attachImageBytes",
  "attachExternalFile",
  "attachFileCopy",
  "attachDroppedFile",
  "removeAttachment",
  "migrateStorageRoot",
]);

function requireMessage(value: unknown): { op: string; payload?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("快捷记录请求格式不正确。");
  }
  const message = value as Record<string, unknown>;
  if (typeof message.op !== "string" || !message.op) {
    throw new Error("快捷记录操作不能为空。");
  }
  return { op: message.op, payload: message.payload };
}

function requirePayloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("快捷记录参数格式不正确。");
  }
  return value as Record<string, unknown>;
}

export function createCaptureIpcDispatcher(
  admin: CaptureAdminService,
  options: CaptureIpcDispatcherOptions = {},
): CaptureIpcDispatcher {
  return {
    async handle(sender, rawMessage) {
      try {
        if (sender !== "main" && sender !== "quick") {
          throw new Error("无法确认快捷记录窗口身份。");
        }
        const message = requireMessage(rawMessage);
        if (!MAIN_OPERATIONS.has(message.op)) {
          throw new Error(`未知的快捷记录操作：${message.op}`);
        }
        const allowed = sender === "quick" ? QUICK_OPERATIONS : MAIN_OPERATIONS;
        if (!allowed.has(message.op)) throw new Error("这个窗口无权执行该操作。");

        let response: unknown;
        switch (message.op) {
          case "getQuickDraft":
            response = admin.getQuickDraft();
            break;
          case "saveQuickDraft":
            response = admin.saveQuickDraft(message.payload as SaveQuickDraftInput);
            break;
          case "commitQuickDraft":
            response = admin.commitQuickDraft(message.payload as CommitQuickDraftInput);
            break;
          case "listNotes":
            response = admin.listNotes();
            break;
          case "listArchivedNotes":
            response = admin.listArchivedNotes();
            break;
          case "getNote":
            response = admin.getNote(requirePayloadRecord(message.payload).id as string);
            break;
          case "createNote":
            response = admin.createNote(message.payload as CreateNoteInput);
            break;
          case "updateNote":
            response = admin.updateNote(message.payload as UpdateNoteInput);
            break;
          case "archiveNote":
            response = admin.archiveNote(message.payload as ArchiveNoteInput);
            break;
          case "unarchiveNote":
            response = admin.unarchiveNote(message.payload as UnarchiveNoteInput);
            break;
          case "deleteNote":
            response = admin.deleteNote(message.payload as DeleteNoteInput);
            break;
          case "attachImageBytes":
            response = await admin.attachImageBytes!(message.payload as AttachImageBytesInput);
            break;
          case "attachDroppedFile": {
            const input = message.payload as AttachFileInput;
            response = options.getQuickCaptureFileDropMode?.() === "copy"
              ? await admin.attachFileCopy!(input)
              : await admin.attachExternalFile!(input);
            break;
          }
          case "attachExternalFile":
            response = await admin.attachExternalFile!(message.payload as AttachFileInput);
            break;
          case "attachFileCopy":
            response = await admin.attachFileCopy!(message.payload as AttachFileInput);
            break;
          case "removeAttachment":
            response = await admin.removeAttachment!(message.payload as RemoveNoteAttachmentInput);
            break;
          case "migrateStorageRoot":
            response = await admin.migrateStorageRoot!(message.payload as MigrateCaptureStorageInput);
            break;
          default:
            throw new Error(`未知的快捷记录操作：${message.op}`);
        }
        return { ok: true, response };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
