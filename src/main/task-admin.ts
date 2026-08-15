import { randomUUID } from "node:crypto";
import type {
  CreateManyTasksInput,
  CreateTaskInput,
  DeleteTaskInput,
  PermanentlyDeleteTaskInput,
  RestoreTaskInput,
  UpdateTaskInput,
  UserTask,
  UserTaskRecurrence,
  UserTaskStatus,
} from "../tasks";
import type { TaskPersistence } from "./persistence/task-persistence";

const MAX_TITLE_LENGTH = 500;
const MAX_DETAILS_LENGTH = 1_000_000;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const RECURRENCES = new Set<UserTaskRecurrence>(["daily", "weekly", "monthly", "weekdays"]);

export interface TaskAdminService {
  listTasks(): UserTask[];
  createTask(input: CreateTaskInput): UserTask;
  createManyTasks(input: CreateManyTasksInput): UserTask[];
  updateTask(input: UpdateTaskInput): UserTask;
  deleteTask(input: DeleteTaskInput): void;
}

export type TaskAdminWithTrash = TaskAdminService & {
  listTrash(): UserTask[];
  restoreTask(input: RestoreTaskInput): UserTask;
  permanentlyDeleteTask(input: PermanentlyDeleteTaskInput): void;
  purgeExpired(now?: number): number;
};

export interface TaskAdminOptions {
  persistence: TaskPersistence;
  now?: () => number;
  randomId?: () => string;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("待办内容格式不正确。");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label}格式不正确。`);
  if (value.length > maxLength) throw new Error(`${label}太长，请缩短后再保存。`);
  return value;
}

function requireTitle(value: unknown): string {
  const title = requireString(value, "标题", MAX_TITLE_LENGTH).trim();
  if (!title) throw new Error("待办标题不能为空。");
  return title;
}

function requireId(value: unknown): string {
  const id = requireString(value, "待办编号", 200).trim();
  if (!id) throw new Error("待办编号不能为空。");
  return id;
}

function requireRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("待办版本不正确，请刷新后重试。");
  }
  return Number(value);
}

function optionalTimestamp(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}格式不正确。`);
  }
  return value;
}

function optionalOffset(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("提醒时间格式不正确。");
  }
  return Number(value);
}

function optionalReference(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const reference = requireString(value, label, 500).trim();
  return reference || null;
}

function requireStatus(value: unknown): UserTaskStatus {
  if (value !== "open" && value !== "done") throw new Error("待办状态不正确。");
  return value;
}

function optionalRecurrence(value: unknown): UserTaskRecurrence | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !RECURRENCES.has(value as UserTaskRecurrence)) {
    throw new Error("重复规则不正确。");
  }
  return value as UserTaskRecurrence;
}

interface NormalizedTaskInput {
  title: string;
  details: string;
  status: UserTaskStatus;
  plannedAt: number | null;
  dueAt: number | null;
  reminderAt: number | null;
  reminderOffsetMinutes: number | null;
  recurrence: UserTaskRecurrence | null;
  notebookId: string | null;
  noteId: string | null;
}

function normalizeCreateInput(value: unknown): NormalizedTaskInput {
  const input = requireRecord(value);
  return {
    title: requireTitle(input.title),
    details: requireString(input.details ?? "", "待办详情", MAX_DETAILS_LENGTH).replace(/\r\n/g, "\n"),
    status: input.status === undefined ? "open" : requireStatus(input.status),
    plannedAt: optionalTimestamp(input.plannedAt, "计划时间"),
    dueAt: optionalTimestamp(input.dueAt, "截止时间"),
    reminderAt: optionalTimestamp(input.reminderAt, "提醒时间"),
    reminderOffsetMinutes: optionalOffset(input.reminderOffsetMinutes),
    recurrence: optionalRecurrence(input.recurrence),
    notebookId: optionalReference(input.notebookId, "本子编号"),
    noteId: optionalReference(input.noteId, "便签编号"),
  };
}

function cloneTask(task: UserTask): UserTask {
  return { ...task };
}

export function createTaskAdmin(options: TaskAdminOptions): TaskAdminWithTrash {
  const now = options.now ?? Date.now;
  const randomId = options.randomId ?? randomUUID;

  const createTaskRecord = (input: NormalizedTaskInput, timestamp: number): UserTask => ({
    id: randomId(),
    ...input,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: input.status === "done" ? timestamp : null,
  });

  return {
    listTasks() {
      return options.persistence.listTasks().map(cloneTask);
    },
    createTask(value) {
      const input = normalizeCreateInput(value);
      const created = options.persistence.createTask(createTaskRecord(input, now()));
      return cloneTask(created);
    },
    createManyTasks(value) {
      const input = requireRecord(value);
      if (!Array.isArray(input.tasks)) throw new Error("待办列表格式不正确。");
      const normalized = input.tasks.map(normalizeCreateInput);
      const timestamp = now();
      const created = options.persistence.createManyTasks(
        normalized.map((task) => createTaskRecord(task, timestamp)),
      );
      return created.map(cloneTask);
    },
    updateTask(value) {
      const input = requireRecord(value);
      const id = requireId(input.id);
      const expectedRevision = requireRevision(input.expectedRevision);
      const current = options.persistence.getTask(id);
      if (!current) throw new Error("这条待办不存在，可能已被删除。");
      if (current.revision !== expectedRevision) {
        throw new Error("待办已在别处更新，请刷新后重试。");
      }

      const timestamp = now();
      const status = input.status === undefined ? current.status : requireStatus(input.status);
      const updated: UserTask = {
        ...current,
        ...(input.title !== undefined ? { title: requireTitle(input.title) } : {}),
        ...(input.details !== undefined
          ? { details: requireString(input.details, "待办详情", MAX_DETAILS_LENGTH).replace(/\r\n/g, "\n") }
          : {}),
        ...(Object.hasOwn(input, "plannedAt")
          ? { plannedAt: optionalTimestamp(input.plannedAt, "计划时间") }
          : {}),
        ...(Object.hasOwn(input, "dueAt")
          ? { dueAt: optionalTimestamp(input.dueAt, "截止时间") }
          : {}),
        ...(Object.hasOwn(input, "reminderAt")
          ? { reminderAt: optionalTimestamp(input.reminderAt, "提醒时间") }
          : {}),
        ...(Object.hasOwn(input, "reminderOffsetMinutes")
          ? { reminderOffsetMinutes: optionalOffset(input.reminderOffsetMinutes) }
          : {}),
        ...(Object.hasOwn(input, "recurrence")
          ? { recurrence: optionalRecurrence(input.recurrence) }
          : {}),
        ...(Object.hasOwn(input, "notebookId")
          ? { notebookId: optionalReference(input.notebookId, "本子编号") }
          : {}),
        ...(Object.hasOwn(input, "noteId")
          ? { noteId: optionalReference(input.noteId, "便签编号") }
          : {}),
        status,
        revision: current.revision + 1,
        updatedAt: timestamp,
        completedAt: status === "done"
          ? (current.status === "done" ? current.completedAt : timestamp)
          : null,
      };
      return cloneTask(options.persistence.updateTask(updated, expectedRevision));
    },
    deleteTask(value) {
      const input = requireRecord(value);
      const timestamp = now();
      options.persistence.deleteTask(
        requireId(input.id),
        requireRevision(input.expectedRevision),
        timestamp,
        timestamp + TRASH_RETENTION_MS,
      );
    },
    listTrash() {
      return options.persistence.listTrash().map(cloneTask);
    },
    restoreTask(value) {
      const input = requireRecord(value);
      return cloneTask(options.persistence.restoreTask(
        requireId(input.id),
        requireRevision(input.expectedRevision),
        now(),
      ));
    },
    permanentlyDeleteTask(value) {
      const input = requireRecord(value);
      options.persistence.permanentlyDeleteTask(
        requireId(input.id),
        requireRevision(input.expectedRevision),
      );
    },
    purgeExpired(currentTime = now()) {
      return options.persistence.purgeExpired(currentTime).length;
    },
  };
}
