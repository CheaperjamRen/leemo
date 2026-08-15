import type { Note, PermanentlyDeleteNoteInput, RestoreNoteInput } from "../captures";
import type { PermanentlyDeleteTaskInput, RestoreTaskInput, UserTask } from "../tasks";
import type { CaptureAdminWithTrash } from "./capture-admin";
import type { TaskAdminWithTrash } from "./task-admin";

export type TrashIpcSender = "main" | "quick";

export interface TrashSnapshot {
  notes: Note[];
  tasks: UserTask[];
}

export interface TrashIpcResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export interface TrashIpcDispatcher {
  handle(sender: TrashIpcSender | null, message: unknown): Promise<TrashIpcResult>;
}

export interface TrashIpcOptions {
  captures: CaptureAdminWithTrash;
  tasks: TaskAdminWithTrash;
}

function requireMessage(value: unknown): { op: string; payload?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("回收站请求格式不正确。");
  }
  const message = value as Record<string, unknown>;
  if (typeof message.op !== "string" || !message.op) throw new Error("回收站操作不能为空。");
  return { op: message.op, payload: message.payload };
}

function requireTrashItem(value: unknown): { kind: "note" | "task"; id: string; expectedRevision: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("回收站项目格式不正确。");
  }
  const input = value as Record<string, unknown>;
  if (input.kind !== "note" && input.kind !== "task") throw new Error("回收站项目类型不正确。");
  return {
    kind: input.kind,
    id: input.id as string,
    expectedRevision: input.expectedRevision as number,
  };
}

export function createTrashIpcDispatcher(options: TrashIpcOptions): TrashIpcDispatcher {
  return {
    async handle(sender, rawMessage) {
      try {
        if (sender !== "main") throw new Error("这个窗口无权访问回收站。");
        const message = requireMessage(rawMessage);
        switch (message.op) {
          case "list":
            return {
              ok: true,
              response: {
                notes: options.captures.listTrash(),
                tasks: options.tasks.listTrash(),
              } satisfies TrashSnapshot,
            };
          case "restore": {
            const input = requireTrashItem(message.payload);
            const response = input.kind === "note"
              ? options.captures.restoreNote(input satisfies RestoreNoteInput)
              : options.tasks.restoreTask(input satisfies RestoreTaskInput);
            return { ok: true, response };
          }
          case "permanentlyDelete": {
            const input = requireTrashItem(message.payload);
            if (input.kind === "note") {
              await options.captures.permanentlyDeleteNote(input satisfies PermanentlyDeleteNoteInput);
            } else {
              options.tasks.permanentlyDeleteTask(input satisfies PermanentlyDeleteTaskInput);
            }
            return { ok: true, response: undefined };
          }
          default:
            throw new Error(`未知的回收站操作：${message.op}`);
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
