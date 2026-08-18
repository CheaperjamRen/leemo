import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { CreateTaskInput, UpdateTaskInput, UserTaskRecurrence } from "../tasks";
import type { CaptureAdminService } from "../main/capture-admin";
import type { TaskAdminService } from "../main/task-admin";

const SERVER = "leemo-workboard";
const TOOL_NAMES = {
  listNotes: "list_notes",
  createNote: "create_note",
  updateNote: "update_note",
  deleteNote: "delete_note",
  listTasks: "list_tasks",
  createTask: "create_task",
  createTasks: "create_tasks",
  updateTask: "update_task",
  setTaskCompleted: "set_task_completed",
  deleteTask: "delete_task",
} as const;

export const LEEMO_CAPTURE_TASK_TOOL_NAMES = {
  listNotes: `mcp__${SERVER}__${TOOL_NAMES.listNotes}`,
  createNote: `mcp__${SERVER}__${TOOL_NAMES.createNote}`,
  updateNote: `mcp__${SERVER}__${TOOL_NAMES.updateNote}`,
  deleteNote: `mcp__${SERVER}__${TOOL_NAMES.deleteNote}`,
  listTasks: `mcp__${SERVER}__${TOOL_NAMES.listTasks}`,
  createTask: `mcp__${SERVER}__${TOOL_NAMES.createTask}`,
  createTasks: `mcp__${SERVER}__${TOOL_NAMES.createTasks}`,
  updateTask: `mcp__${SERVER}__${TOOL_NAMES.updateTask}`,
  setTaskCompleted: `mcp__${SERVER}__${TOOL_NAMES.setTaskCompleted}`,
  deleteTask: `mcp__${SERVER}__${TOOL_NAMES.deleteTask}`,
} as const;

export interface CaptureTaskMcpResult {
  text: string;
  isError: boolean;
}

type TimeInput = string | number | null;

export interface TaskDraftInput {
  title: string;
  details?: string;
  plannedAt?: TimeInput;
  dueAt?: TimeInput;
  reminderAt?: TimeInput;
  reminderOffsetMinutes?: number | null;
  recurrence?: UserTaskRecurrence | null;
}

export interface TaskUpdateDraftInput extends Omit<TaskDraftInput, "title"> {
  id: string;
  expectedRevision: number;
  title?: string;
  notebookId?: string | null;
}

export interface CaptureTaskMcp {
  server: McpSdkServerConfigWithInstance;
  runListNotes(input: Record<string, never>): Promise<CaptureTaskMcpResult>;
  runCreateNote(input: { title: string; markdown: string }): Promise<CaptureTaskMcpResult>;
  runUpdateNote(input: { id: string; expectedRevision: number; title: string; markdown: string }): Promise<CaptureTaskMcpResult>;
  runDeleteNote(input: { id: string; expectedRevision: number }): Promise<CaptureTaskMcpResult>;
  runListTasks(input: Record<string, never>): Promise<CaptureTaskMcpResult>;
  runCreateTask(input: TaskDraftInput): Promise<CaptureTaskMcpResult>;
  runCreateTasks(input: { tasks: TaskDraftInput[] }): Promise<CaptureTaskMcpResult>;
  runUpdateTask(input: TaskUpdateDraftInput): Promise<CaptureTaskMcpResult>;
  runSetTaskCompleted(input: { id: string; expectedRevision: number; completed: boolean }): Promise<CaptureTaskMcpResult>;
  runDeleteTask(input: { id: string; expectedRevision: number }): Promise<CaptureTaskMcpResult>;
}

export interface CaptureTaskMcpOptions {
  captures: CaptureAdminService;
  tasks: TaskAdminService;
  /** Current user-visible notebook. It is injected by the conversation host;
   * the model never asks the user for this internal association. */
  notebookId?: string;
}

function conciseError(prefix: string, error: unknown): CaptureTaskMcpResult {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.split("\n", 1)[0].replace(/^Error:\s*/u, "").slice(0, 240);
  return { text: `${prefix}没有更新：${message}`, isError: true };
}

function preview(value: string, limit = 400): string {
  const compact = value.trim().replace(/\s+/gu, " ");
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function toTimestamp(value: TimeInput | undefined, label: string): number | null | undefined {
  if (value === undefined || value === null) return value;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error(`${label}无法识别，请使用带日期的明确时间。`);
  }
  return timestamp;
}

function taskInput(input: TaskDraftInput, notebookId?: string): CreateTaskInput {
  return {
    title: input.title,
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.plannedAt === undefined ? {} : { plannedAt: toTimestamp(input.plannedAt, "计划时间") }),
    ...(input.dueAt === undefined ? {} : { dueAt: toTimestamp(input.dueAt, "截止时间") }),
    ...(input.reminderAt === undefined ? {} : { reminderAt: toTimestamp(input.reminderAt, "提醒时间") }),
    ...(input.reminderOffsetMinutes === undefined ? {} : { reminderOffsetMinutes: input.reminderOffsetMinutes }),
    ...(input.recurrence === undefined ? {} : { recurrence: input.recurrence }),
    ...(notebookId ? { notebookId } : {}),
  };
}

function updateTaskInput(input: TaskUpdateDraftInput, notebookId?: string): UpdateTaskInput {
  return {
    id: input.id,
    expectedRevision: input.expectedRevision,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.plannedAt === undefined ? {} : { plannedAt: toTimestamp(input.plannedAt, "计划时间") }),
    ...(input.dueAt === undefined ? {} : { dueAt: toTimestamp(input.dueAt, "截止时间") }),
    ...(input.reminderAt === undefined ? {} : { reminderAt: toTimestamp(input.reminderAt, "提醒时间") }),
    ...(input.reminderOffsetMinutes === undefined ? {} : { reminderOffsetMinutes: input.reminderOffsetMinutes }),
    ...(input.recurrence === undefined ? {} : { recurrence: input.recurrence }),
    ...(input.notebookId === undefined
      ? (notebookId ? { notebookId } : {})
      : { notebookId: input.notebookId }),
  };
}

function recurrenceLabel(value: UserTaskRecurrence | null): string {
  if (value === "daily") return "每天";
  if (value === "weekly") return "每周";
  if (value === "monthly") return "每月";
  if (value === "weekdays") return "工作日";
  return "不重复";
}

export function createCaptureTaskMcp(options: CaptureTaskMcpOptions): CaptureTaskMcp {
  const runListNotes: CaptureTaskMcp["runListNotes"] = async () => {
    try {
      const notes = options.captures.listNotes();
      if (notes.length === 0) return { text: "还没有便签。", isError: false };
      return {
        text: [
          "当前便签：",
          ...notes.map((note) => [
            `- ${note.title || "无标题便签"}`,
            `  便签标识：${note.id}；版本：${note.revision}`,
            ...(note.markdown.trim() ? [`  内容：${preview(note.markdown)}`] : []),
          ].join("\n")),
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      return conciseError("便签", error);
    }
  };

  const runCreateNote: CaptureTaskMcp["runCreateNote"] = async (input) => {
    try {
      const note = options.captures.createNote(input);
      return { text: `已保存便签“${note.title || "无标题便签"}”。`, isError: false };
    } catch (error) {
      return conciseError("便签", error);
    }
  };

  const runUpdateNote: CaptureTaskMcp["runUpdateNote"] = async (input) => {
    try {
      const note = options.captures.updateNote(input);
      return { text: `已更新便签“${note.title || "无标题便签"}”。`, isError: false };
    } catch (error) {
      return conciseError("便签", error);
    }
  };

  const runDeleteNote: CaptureTaskMcp["runDeleteNote"] = async (input) => {
    try {
      options.captures.deleteNote({ ...input, childStrategy: "subtree" });
      return { text: "便签已删除。", isError: false };
    } catch (error) {
      return conciseError("便签", error);
    }
  };

  const runListTasks: CaptureTaskMcp["runListTasks"] = async () => {
    try {
      const tasks = options.tasks.listTasks();
      if (tasks.length === 0) return { text: "还没有待办。", isError: false };
      return {
        text: [
          "当前待办：",
          ...tasks.map((task) => [
            `- ${task.status === "done" ? "已完成" : "未完成"}：${task.title}`,
            `  待办标识：${task.id}；版本：${task.revision}`,
            ...(task.details.trim() ? [`  详情：${preview(task.details)}`] : []),
            ...(task.dueAt === null ? [] : [`  截止时间：${new Date(task.dueAt).toLocaleString()}`]),
            ...(task.reminderAt === null ? [] : [`  提醒时间：${new Date(task.reminderAt).toLocaleString()}`]),
            ...(task.recurrence === null ? [] : [`  重复：${recurrenceLabel(task.recurrence)}`]),
          ].join("\n")),
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      return conciseError("待办", error);
    }
  };

  const runCreateTask: CaptureTaskMcp["runCreateTask"] = async (input) => {
    try {
      const task = options.tasks.createTask(taskInput(input, options.notebookId));
      return { text: `已创建待办“${task.title}”。`, isError: false };
    } catch (error) {
      return conciseError("待办", error);
    }
  };

  const runCreateTasks: CaptureTaskMcp["runCreateTasks"] = async (input) => {
    try {
      const tasks = options.tasks.createManyTasks({
        tasks: input.tasks.map((item) => taskInput(item, options.notebookId)),
      });
      return { text: `已创建 ${tasks.length} 条待办。`, isError: false };
    } catch (error) {
      return conciseError("待办", error);
    }
  };

  const runUpdateTask: CaptureTaskMcp["runUpdateTask"] = async (input) => {
    try {
      const task = options.tasks.updateTask(updateTaskInput(input, options.notebookId));
      return { text: `已更新待办“${task.title}”。`, isError: false };
    } catch (error) {
      return conciseError("待办", error);
    }
  };

  const runSetTaskCompleted: CaptureTaskMcp["runSetTaskCompleted"] = async (input) => {
    try {
      const task = options.tasks.updateTask({
        id: input.id,
        expectedRevision: input.expectedRevision,
        status: input.completed ? "done" : "open",
      });
      return {
        text: input.completed ? `待办“${task.title}”已完成。` : `待办“${task.title}”已恢复为未完成。`,
        isError: false,
      };
    } catch (error) {
      return conciseError("待办", error);
    }
  };

  const runDeleteTask: CaptureTaskMcp["runDeleteTask"] = async (input) => {
    try {
      options.tasks.deleteTask(input);
      return { text: "待办已删除。", isError: false };
    } catch (error) {
      return conciseError("待办", error);
    }
  };

  const result = (value: CaptureTaskMcpResult) => ({
    content: [{ type: "text", text: value.text }],
    isError: value.isError,
  }) as never;
  const idSchema = z.string().trim().min(1).max(200).describe("先查看列表得到的记录标识，不要让用户手动提供");
  const revisionSchema = z.number().int().min(0).describe("与记录标识一起从列表得到的版本号");
  const timeSchema = z.union([
    z.string().trim().min(1).describe("明确的 ISO 8601 日期时间；按用户设备所在时区理解"),
    z.number().nonnegative().describe("Unix 毫秒时间戳"),
  ]).nullable();
  const recurrenceSchema = z.enum(["daily", "weekly", "monthly", "weekdays"]);
  const taskDraftSchema = {
    title: z.string().trim().min(1).max(500).describe("待办标题"),
    details: z.string().max(1_000_000).optional().describe("可选的补充说明"),
    plannedAt: timeSchema.optional().describe("可选计划开始时间。用户没说就不要猜"),
    dueAt: timeSchema.optional().describe("可选截止时间。多个日期角色不清楚时先问用户，不要猜第一个日期"),
    reminderAt: timeSchema.optional().describe("可选提醒时间。只有用户意思明确时填写"),
    reminderOffsetMinutes: z.number().int().nonnegative().nullable().optional().describe("可选的提前提醒分钟数"),
    recurrence: recurrenceSchema.nullable().optional().describe("可选重复规则"),
  };
  const taskUpdateSchema = {
    id: idSchema,
    expectedRevision: revisionSchema,
    title: z.string().trim().min(1).max(500).optional().describe("只在需要改标题时填写"),
    details: z.string().max(1_000_000).optional().describe("只在需要改补充说明时填写"),
    plannedAt: timeSchema.optional().describe("要清除计划时间时传 null；用户没说就不要猜"),
    dueAt: timeSchema.optional().describe("要清除截止时间时传 null；多个日期角色不清楚时先问用户"),
    reminderAt: timeSchema.optional().describe("要清除提醒时间时传 null；只有用户意思明确时填写"),
    reminderOffsetMinutes: z.number().int().nonnegative().nullable().optional().describe("可选的提前提醒分钟数"),
    recurrence: recurrenceSchema.nullable().optional().describe("要停止重复时传 null"),
    notebookId: z.string().trim().min(1).max(500).nullable().optional().describe("当前对话在本子中时会自动保持；只有用户明确改到另一本子或取消关联时填写，不要向用户索要内部标识"),
  };

  return {
    server: createSdkMcpServer({
      name: SERVER,
      version: "1.0.0",
      tools: [
        tool(
          TOOL_NAMES.listNotes,
          "查看用户保存在 Leemo 便签里的内容。只读；需要修改或删除时先查看列表取得对应记录。",
          {},
          async () => result(await runListNotes({})),
        ),
        tool(
          TOOL_NAMES.createNote,
          "当用户明确要记录便签、灵感或稍后整理的内容时，直接保存，不要重复确认。普通任务产物仍应写入本子文件，不要塞进便签。",
          {
            title: z.string().max(500).describe("便签标题，可以留空"),
            markdown: z.string().max(1_000_000).describe("便签正文，使用 Markdown"),
          },
          async (args) => result(await runCreateNote(args as Parameters<typeof runCreateNote>[0])),
        ),
        tool(
          TOOL_NAMES.updateNote,
          "按用户明确要求修改一条已有便签。先查看便签列表；只在会影响实际内容的歧义存在时询问用户。",
          {
            id: idSchema,
            expectedRevision: revisionSchema,
            title: z.string().max(500),
            markdown: z.string().max(1_000_000),
          },
          async (args) => result(await runUpdateNote(args as Parameters<typeof runUpdateNote>[0])),
        ),
        tool(
          TOOL_NAMES.deleteNote,
          "按用户明确要求删除一条已有便签。先查看便签列表取得对应记录；不要询问用户内部标识。",
          { id: idSchema, expectedRevision: revisionSchema },
          async (args) => result(await runDeleteNote(args as Parameters<typeof runDeleteNote>[0])),
        ),
        tool(
          TOOL_NAMES.listTasks,
          "查看用户当前的待办、完成状态、时间与对应记录。只读；需要修改或删除时先查看列表。",
          {},
          async () => result(await runListTasks({})),
        ),
        tool(
          TOOL_NAMES.createTask,
          "按用户明确要求直接创建一条待办。当前本子会自动关联，不要询问本子标识。日期角色明确就执行；截止、计划、提醒含义不清时才询问，不要擅自把第一个日期当截止时间。",
          taskDraftSchema,
          async (args) => result(await runCreateTask(args as Parameters<typeof runCreateTask>[0])),
        ),
        tool(
          TOOL_NAMES.createTasks,
          "把用户明确给出的多条事项一次性加入待办。当前本子会自动关联。逐条保留原意；只有会改变执行结果的日期或字段歧义才询问。",
          { tasks: z.array(z.object(taskDraftSchema)).min(1).max(100) },
          async (args) => result(await runCreateTasks(args as Parameters<typeof runCreateTasks>[0])),
        ),
        tool(
          TOOL_NAMES.updateTask,
          "按用户明确要求修改已有待办的标题、说明、时间、提醒、重复或关联本子。先查看待办列表取得对应记录；当前对话所在本子会自动保持，不要向用户索要内部标识。日期角色不清时先确认，不要猜。",
          taskUpdateSchema,
          async (args) => result(await runUpdateTask(args as Parameters<typeof runUpdateTask>[0])),
        ),
        tool(
          TOOL_NAMES.setTaskCompleted,
          "按用户明确要求把一条待办标为完成，或恢复为未完成。先查看待办列表取得对应记录，不要询问用户内部标识。",
          { id: idSchema, expectedRevision: revisionSchema, completed: z.boolean() },
          async (args) => result(await runSetTaskCompleted(args as Parameters<typeof runSetTaskCompleted>[0])),
        ),
        tool(
          TOOL_NAMES.deleteTask,
          "按用户明确要求删除一条待办。先查看待办列表取得对应记录，不要询问用户内部标识。",
          { id: idSchema, expectedRevision: revisionSchema },
          async (args) => result(await runDeleteTask(args as Parameters<typeof runDeleteTask>[0])),
        ),
      ],
    }),
    runListNotes,
    runCreateNote,
    runUpdateNote,
    runDeleteNote,
    runListTasks,
    runCreateTask,
    runCreateTasks,
    runUpdateTask,
    runSetTaskCompleted,
    runDeleteTask,
  };
}
