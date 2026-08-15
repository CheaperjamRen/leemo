export type UserTaskStatus = "open" | "done";

export type UserTaskRecurrence = "daily" | "weekly" | "monthly" | "weekdays";

export interface UserTask {
  id: string;
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
  revision: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** Present only while the task is in Leemo's trash. */
  deletedAt?: number;
  /** Present only while the task is in Leemo's trash. */
  purgeAfter?: number;
}

export interface CreateTaskInput {
  title: string;
  details?: string;
  status?: UserTaskStatus;
  plannedAt?: number | null;
  dueAt?: number | null;
  reminderAt?: number | null;
  reminderOffsetMinutes?: number | null;
  recurrence?: UserTaskRecurrence | null;
  notebookId?: string | null;
  noteId?: string | null;
}

export interface CreateManyTasksInput {
  tasks: CreateTaskInput[];
}

export interface UpdateTaskInput {
  id: string;
  expectedRevision: number;
  title?: string;
  details?: string;
  status?: UserTaskStatus;
  plannedAt?: number | null;
  dueAt?: number | null;
  reminderAt?: number | null;
  reminderOffsetMinutes?: number | null;
  recurrence?: UserTaskRecurrence | null;
  notebookId?: string | null;
  noteId?: string | null;
}

export interface DeleteTaskInput {
  id: string;
  expectedRevision: number;
}

export interface RestoreTaskInput {
  id: string;
  expectedRevision: number;
}

export interface PermanentlyDeleteTaskInput {
  id: string;
  expectedRevision: number;
}

export interface TaskOperationInputs {
  listTasks: undefined;
  createTask: CreateTaskInput;
  createManyTasks: CreateManyTasksInput;
  updateTask: UpdateTaskInput;
  deleteTask: DeleteTaskInput;
}

export type TaskOperation = keyof TaskOperationInputs;
