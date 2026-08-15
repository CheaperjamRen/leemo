import type { Note, PermanentlyDeleteNoteInput, RestoreNoteInput } from "../../captures";
import type { PermanentlyDeleteTaskInput, RestoreTaskInput, UserTask } from "../../tasks";

export interface TrashSnapshot {
  notes: Note[];
  tasks: UserTask[];
}

export type TrashItemInput =
  | ({ kind: "note" } & RestoreNoteInput)
  | ({ kind: "task" } & RestoreTaskInput);

export type PermanentlyDeleteTrashItemInput =
  | ({ kind: "note" } & PermanentlyDeleteNoteInput)
  | ({ kind: "task" } & PermanentlyDeleteTaskInput);

export interface LeemoTrashApi {
  invoke(op: string, payload?: unknown): Promise<{ ok: boolean; response?: unknown; error?: string }>;
}

function requireResponse<T>(result: { ok: boolean; response?: unknown; error?: string }): T {
  if (!result.ok) throw new Error(result.error || "回收站暂时无法使用，请稍后重试。");
  return result.response as T;
}

export class IpcTrashClient {
  constructor(private readonly api: LeemoTrashApi) {}

  private async call<T>(op: string, payload?: unknown): Promise<T> {
    return requireResponse<T>(await this.api.invoke(op, payload));
  }

  list(): Promise<TrashSnapshot> {
    return this.call("list");
  }

  restore(input: TrashItemInput): Promise<Note | UserTask> {
    return this.call("restore", input);
  }

  permanentlyDelete(input: PermanentlyDeleteTrashItemInput): Promise<void> {
    return this.call("permanentlyDelete", input);
  }
}
