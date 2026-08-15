import type { UserTask } from "../../tasks";
import type { SqliteDatabase } from "./schema";

export interface TaskPersistence {
  listTasks(): UserTask[];
  getTask(id: string): UserTask | undefined;
  createTask(task: UserTask): UserTask;
  createManyTasks(tasks: UserTask[]): UserTask[];
  updateTask(task: UserTask, expectedRevision: number): UserTask;
  deleteTask(id: string, expectedRevision: number, deletedAt: number, purgeAfter: number): UserTask;
  listTrash(): UserTask[];
  restoreTask(id: string, expectedRevision: number, updatedAt: number): UserTask;
  permanentlyDeleteTask(id: string, expectedRevision: number): UserTask;
  purgeExpired(now: number): UserTask[];
}

interface TaskRow {
  id: string;
  title: string;
  details: string;
  status: UserTask["status"];
  planned_at: number | null;
  due_at: number | null;
  reminder_at: number | null;
  reminder_offset_minutes: number | null;
  recurrence: UserTask["recurrence"];
  notebook_id: string | null;
  note_id: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  deleted_at: number | null;
  purge_after: number | null;
}

interface RunResult {
  changes: number;
}

function staleRevisionError(): Error {
  return new Error("待办已在别处更新，请刷新后重试。");
}

function taskNotFoundError(): Error {
  return new Error("这条待办不存在，可能已被删除。");
}

function toTask(row: TaskRow): UserTask {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    status: row.status,
    plannedAt: row.planned_at,
    dueAt: row.due_at,
    reminderAt: row.reminder_at,
    reminderOffsetMinutes: row.reminder_offset_minutes,
    recurrence: row.recurrence,
    notebookId: row.notebook_id,
    noteId: row.note_id,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    ...(row.deleted_at !== null ? { deletedAt: row.deleted_at } : {}),
    ...(row.purge_after !== null ? { purgeAfter: row.purge_after } : {}),
  };
}

function taskParams(task: UserTask): unknown[] {
  return [
    task.id,
    task.title,
    task.details,
    task.status,
    task.plannedAt,
    task.dueAt,
    task.reminderAt,
    task.reminderOffsetMinutes,
    task.recurrence,
    task.notebookId,
    task.noteId,
    task.revision,
    task.createdAt,
    task.updatedAt,
    task.completedAt,
    task.deletedAt ?? null,
    task.purgeAfter ?? null,
  ];
}

export function createTaskPersistence(db: SqliteDatabase): TaskPersistence {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'done')),
      planned_at INTEGER,
      due_at INTEGER,
      reminder_at INTEGER,
      reminder_offset_minutes INTEGER,
      recurrence TEXT CHECK (recurrence IS NULL OR recurrence IN ('daily', 'weekly', 'monthly', 'weekdays')),
      notebook_id TEXT,
      note_id TEXT,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      deleted_at INTEGER,
      purge_after INTEGER
    );
  `);

  const taskColumns = new Set(
    (db.prepare(`PRAGMA table_info(user_tasks)`).all() as { name: string }[]).map((column) => column.name),
  );
  if (!taskColumns.has("deleted_at")) db.exec(`ALTER TABLE user_tasks ADD COLUMN deleted_at INTEGER`);
  if (!taskColumns.has("purge_after")) db.exec(`ALTER TABLE user_tasks ADD COLUMN purge_after INTEGER`);
  db.exec(`CREATE INDEX IF NOT EXISTS user_tasks_trash_purge_idx ON user_tasks(deleted_at, purge_after)`);

  const columns = `
    id, title, details, status, planned_at, due_at, reminder_at,
    reminder_offset_minutes, recurrence, notebook_id, note_id, revision,
    created_at, updated_at, completed_at, deleted_at, purge_after
  `;
  const listStatement = db.prepare(`
    SELECT ${columns} FROM user_tasks WHERE deleted_at IS NULL
    ORDER BY updated_at DESC, created_at DESC, id ASC
  `);
  const getStatement = db.prepare(`SELECT ${columns} FROM user_tasks WHERE id = ? AND deleted_at IS NULL`);
  const getTrashStatement = db.prepare(`SELECT ${columns} FROM user_tasks WHERE id = ? AND deleted_at IS NOT NULL`);
  const listTrashStatement = db.prepare(`
    SELECT ${columns} FROM user_tasks WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC, id ASC
  `);
  const insertStatement = db.prepare(`
    INSERT INTO user_tasks (${columns})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = db.prepare(`
    UPDATE user_tasks SET
      title = ?, details = ?, status = ?, planned_at = ?, due_at = ?,
      reminder_at = ?, reminder_offset_minutes = ?, recurrence = ?,
      notebook_id = ?, note_id = ?, revision = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const trashStatement = db.prepare(`
    UPDATE user_tasks
    SET deleted_at = ?, purge_after = ?, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NULL
  `);
  const restoreStatement = db.prepare(`
    UPDATE user_tasks
    SET deleted_at = NULL, purge_after = NULL, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL
  `);
  const permanentlyDeleteStatement = db.prepare(`
    DELETE FROM user_tasks WHERE id = ? AND revision = ? AND deleted_at IS NOT NULL
  `);

  const insert = (task: UserTask): UserTask => {
    insertStatement.run(...taskParams(task));
    return { ...task };
  };

  const getTask = (id: string): UserTask | undefined => {
    const row = getStatement.get(id) as TaskRow | undefined;
    return row ? toTask(row) : undefined;
  };
  const getTrashTask = (id: string): UserTask | undefined => {
    const row = getTrashStatement.get(id) as TaskRow | undefined;
    return row ? toTask(row) : undefined;
  };

  const createManyTasks = db.transaction((tasks: UserTask[]): UserTask[] => {
    for (const task of tasks) insert(task);
    return tasks.map((task) => ({ ...task }));
  }) as (tasks: UserTask[]) => UserTask[];

  const updateTask = db.transaction((task: UserTask, expectedRevision: number): UserTask => {
    const current = getTask(task.id);
    if (!current) throw taskNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = updateStatement.run(
      task.title,
      task.details,
      task.status,
      task.plannedAt,
      task.dueAt,
      task.reminderAt,
      task.reminderOffsetMinutes,
      task.recurrence,
      task.notebookId,
      task.noteId,
      task.revision,
      task.updatedAt,
      task.completedAt,
      task.id,
      expectedRevision,
    ) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return { ...task };
  }) as (task: UserTask, expectedRevision: number) => UserTask;

  const deleteTask = db.transaction((
    id: string,
    expectedRevision: number,
    deletedAt: number,
    purgeAfter: number,
  ): UserTask => {
    const current = getTask(id);
    if (!current) throw taskNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = trashStatement.run(deletedAt, purgeAfter, deletedAt, id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getTrashTask(id)!;
  }) as TaskPersistence["deleteTask"];

  const restoreTask = db.transaction((id: string, expectedRevision: number, updatedAt: number): UserTask => {
    const current = getTrashTask(id);
    if (!current) throw taskNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = restoreStatement.run(updatedAt, id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return getTask(id)!;
  }) as TaskPersistence["restoreTask"];

  const permanentlyDeleteTask = db.transaction((id: string, expectedRevision: number): UserTask => {
    const current = getTrashTask(id);
    if (!current) throw taskNotFoundError();
    if (current.revision !== expectedRevision) throw staleRevisionError();
    const result = permanentlyDeleteStatement.run(id, expectedRevision) as RunResult;
    if (result.changes !== 1) throw staleRevisionError();
    return current;
  }) as TaskPersistence["permanentlyDeleteTask"];

  const purgeExpired = db.transaction((now: number): UserTask[] => {
    const expired = (listTrashStatement.all() as TaskRow[])
      .filter((row) => row.purge_after !== null && row.purge_after < now)
      .map(toTask);
    for (const task of expired) permanentlyDeleteStatement.run(task.id, task.revision);
    return expired;
  }) as TaskPersistence["purgeExpired"];

  return {
    listTasks: () => (listStatement.all() as TaskRow[]).map(toTask),
    getTask,
    createTask: insert,
    createManyTasks,
    updateTask,
    deleteTask,
    listTrash: () => (listTrashStatement.all() as TaskRow[]).map(toTask),
    restoreTask,
    permanentlyDeleteTask,
    purgeExpired,
  };
}
