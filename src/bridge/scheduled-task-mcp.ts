import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  weekdaysForWeeklySchedule,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskRun,
  type ScheduledTaskSchedule,
} from "../scheduled-tasks";

const SERVER = "leemo-scheduler";
const TOOL_NAMES = {
  list: "list_scheduled_tasks",
  create: "create_scheduled_task",
  update: "update_scheduled_task",
  setStatus: "set_scheduled_task_status",
  delete: "delete_scheduled_task",
  runNow: "run_scheduled_task_now",
} as const;

export const LEEMO_SCHEDULED_TASK_TOOL_NAMES = {
  list: `mcp__${SERVER}__${TOOL_NAMES.list}`,
  create: `mcp__${SERVER}__${TOOL_NAMES.create}`,
  update: `mcp__${SERVER}__${TOOL_NAMES.update}`,
  setStatus: `mcp__${SERVER}__${TOOL_NAMES.setStatus}`,
  delete: `mcp__${SERVER}__${TOOL_NAMES.delete}`,
  runNow: `mcp__${SERVER}__${TOOL_NAMES.runNow}`,
} as const;

export type ScheduledTaskPatch = Partial<ScheduledTaskDraft>;

/** Main-process capability exposed to momo. Storage, time and workspace
 * validation stay behind this interface; the MCP never touches files or IPC. */
export interface ScheduledTaskAdmin {
  list(): ScheduledTask[];
  create(draft: ScheduledTaskDraft): ScheduledTask;
  update(id: string, patch: ScheduledTaskPatch): ScheduledTask;
  setPaused(id: string, paused: boolean): ScheduledTask;
  delete(id: string): void;
  runNow(id: string): ScheduledTaskRun;
}

export type NaturalSchedule =
  | { kind: "once"; date: string; time: string }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; weekdays: number[]; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekends"; time: string };

export interface ScheduledTaskMcpResult {
  text: string;
  isError: boolean;
}

export interface ScheduledTaskMcp {
  server: McpSdkServerConfigWithInstance;
  runList(input: Record<string, never>): Promise<ScheduledTaskMcpResult>;
  runCreate(input: { prompt: string; schedule: NaturalSchedule; name?: string }): Promise<ScheduledTaskMcpResult>;
  runUpdate(input: { id: string; prompt?: string; schedule?: NaturalSchedule; name?: string }): Promise<ScheduledTaskMcpResult>;
  runSetStatus(input: { id: string; status: "active" | "paused" }): Promise<ScheduledTaskMcpResult>;
  runDelete(input: { id: string }): Promise<ScheduledTaskMcpResult>;
  runNow(input: { id: string }): Promise<ScheduledTaskMcpResult>;
}

export interface ScheduledTaskMcpOptions {
  service: ScheduledTaskAdmin;
  /** The current conversation scope. New tasks follow it automatically rather
   * than asking the model or user to handle an opaque workspace id. */
  workspaceId: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTime(timestamp: number): string {
  const value = new Date(timestamp);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/u.exec(value.trim());
  if (!match) throw new Error("时间请使用 24 小时制，例如 08:30。");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("时间请使用 00:00 到 23:59。");
  return { hour, minute };
}

function parseSchedule(input: NaturalSchedule): ScheduledTaskSchedule {
  const { hour, minute } = parseClock(input.time);
  if (input.kind === "daily") return { kind: "daily", hour, minute };
  if (input.kind === "weekly") return { kind: "weekly", weekdays: input.weekdays, hour, minute };
  if (input.kind === "monthly") return { kind: "monthly", day: input.day, hour, minute };
  if (input.kind === "weekdays") return { kind: "weekdays", hour, minute };
  if (input.kind === "weekends") return { kind: "weekends", hour, minute };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input.date.trim());
  if (!match) throw new Error("日期请使用 YYYY-MM-DD，例如 2026-08-07。");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
  ) {
    throw new Error("日期不存在，请重新确认。");
  }
  return { kind: "once", runAt: local.getTime() };
}

function scheduleLabel(schedule: ScheduledTaskSchedule): string {
  if (schedule.kind === "once") return formatDateTime(schedule.runAt);
  if (schedule.kind === "daily") return `每天 ${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.kind === "monthly") return `每月 ${schedule.day} 日 ${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.kind === "weekdays") return `每工作日 ${pad(schedule.hour)}:${pad(schedule.minute)}`;
  if (schedule.kind === "weekends") return `每周末 ${pad(schedule.hour)}:${pad(schedule.minute)}`;
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `每${weekdaysForWeeklySchedule(schedule).map((weekday) => weekdays[weekday]).join("、")} ${pad(schedule.hour)}:${pad(schedule.minute)}`;
}

function statusLabel(status: ScheduledTask["status"]): string {
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已完成";
  return "运行中";
}

function errorResult(error: unknown): ScheduledTaskMcpResult {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.split("\n", 1)[0].replace(/^Error:\s*/u, "").slice(0, 240);
  return { text: `定时任务没有更新：${message}`, isError: true };
}

export function createScheduledTaskMcp(options: ScheduledTaskMcpOptions): ScheduledTaskMcp {
  const runList: ScheduledTaskMcp["runList"] = async () => {
    try {
      const tasks = options.service.list();
      if (tasks.length === 0) return { text: "还没有定时任务。", isError: false };
      return {
        text: [
          "当前定时任务：",
          ...tasks.map((task) => [
            `- ${task.name}（${statusLabel(task.status)}；${scheduleLabel(task.schedule)}）`,
            `  任务标识：${task.id}`,
            `  内容：${task.prompt}`,
          ].join("\n")),
        ].join("\n"),
        isError: false,
      };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runCreate: ScheduledTaskMcp["runCreate"] = async (input) => {
    try {
      const task = options.service.create({
        prompt: input.prompt,
        schedule: parseSchedule(input.schedule),
        workspaceId: options.workspaceId,
        ...(input.name ? { name: input.name } : {}),
      });
      return {
        text: `已创建定时任务“${task.name}”，${scheduleLabel(task.schedule)}运行。`,
        isError: false,
      };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runUpdate: ScheduledTaskMcp["runUpdate"] = async (input) => {
    try {
      const patch: ScheduledTaskPatch = {
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.schedule === undefined ? {} : { schedule: parseSchedule(input.schedule) }),
      };
      if (Object.keys(patch).length === 0) throw new Error("请说明要修改的内容或时间。");
      const task = options.service.update(input.id, patch);
      return { text: `已更新定时任务“${task.name}”，${scheduleLabel(task.schedule)}运行。`, isError: false };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runSetStatus: ScheduledTaskMcp["runSetStatus"] = async (input) => {
    try {
      const task = options.service.setPaused(input.id, input.status === "paused");
      return { text: `定时任务“${task.name}”已${task.status === "paused" ? "暂停" : "恢复"}。`, isError: false };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runDelete: ScheduledTaskMcp["runDelete"] = async (input) => {
    try {
      options.service.delete(input.id);
      return { text: "定时任务已删除。", isError: false };
    } catch (error) {
      return errorResult(error);
    }
  };

  const runNow: ScheduledTaskMcp["runNow"] = async (input) => {
    try {
      options.service.runNow(input.id);
      return { text: "定时任务已开始运行。", isError: false };
    } catch (error) {
      return errorResult(error);
    }
  };

  const scheduleSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("once"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).describe("设备本地日期，YYYY-MM-DD"),
      time: z.string().regex(/^\d{2}:\d{2}$/u).describe("设备本地时间，24 小时制 HH:mm"),
    }),
    z.object({
      kind: z.literal("daily"),
      time: z.string().regex(/^\d{2}:\d{2}$/u).describe("每天运行的设备本地时间，24 小时制 HH:mm"),
    }),
    z.object({
      kind: z.literal("weekly"),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
        .describe("星期几，可多选：0 周日，1 周一，直到 6 周六"),
      time: z.string().regex(/^\d{2}:\d{2}$/u).describe("设备本地时间，24 小时制 HH:mm"),
    }),
    z.object({
      kind: z.literal("monthly"),
      day: z.number().int().min(1).max(31).describe("每月几日；当月没有该日期时，本月不运行"),
      time: z.string().regex(/^\d{2}:\d{2}$/u).describe("设备本地时间，24 小时制 HH:mm"),
    }),
    z.object({
      kind: z.literal("weekdays"),
      time: z.string().regex(/^\d{2}:\d{2}$/u).describe("每周一至周五运行的设备本地时间，24 小时制 HH:mm"),
    }),
    z.object({
      kind: z.literal("weekends"),
      time: z.string().regex(/^\d{2}:\d{2}$/u).describe("每周六、周日运行的设备本地时间，24 小时制 HH:mm"),
    }),
  ]);
  const idSchema = z.string().trim().min(1).max(128).describe("先用 list_scheduled_tasks 得到的任务标识");
  const result = (value: ScheduledTaskMcpResult) => ({
    content: [{ type: "text", text: value.text }],
    isError: value.isError,
  }) as never;

  return {
    server: createSdkMcpServer({
      name: SERVER,
      version: "1.0.0",
      tools: [
        tool(
          TOOL_NAMES.list,
          "查看用户在 Leemo 中已有的定时任务及任务标识。修改、暂停、运行或删除前先调用。只读。",
          {},
          async () => result(await runList({})),
        ),
        tool(
          TOOL_NAMES.create,
          "按用户明确要求创建一个本地定时任务。新任务自动归属当前对话所在的本子或工作区；不要询问内部路径或工作区标识。一次性日期和时间都按用户设备本地时钟理解。",
          {
            prompt: z.string().trim().min(1).max(20_000).describe("到时间后要让 momo 完成的具体任务"),
            schedule: scheduleSchema,
            name: z.string().trim().min(1).max(48).optional().describe("可选短标题；省略时由任务内容生成"),
          },
          async (args) => result(await runCreate(args as Parameters<typeof runCreate>[0])),
        ),
        tool(
          TOOL_NAMES.update,
          "修改一个已有定时任务的内容、标题或运行时间。先查看任务列表取得标识；只传用户要求改动的字段。",
          {
            id: idSchema,
            prompt: z.string().trim().min(1).max(20_000).optional(),
            schedule: scheduleSchema.optional(),
            name: z.string().trim().min(1).max(48).optional(),
          },
          async (args) => result(await runUpdate(args as Parameters<typeof runUpdate>[0])),
        ),
        tool(
          TOOL_NAMES.setStatus,
          "暂停或恢复一个已有定时任务。先查看任务列表取得标识。",
          { id: idSchema, status: z.enum(["active", "paused"]) },
          async (args) => result(await runSetStatus(args as Parameters<typeof runSetStatus>[0])),
        ),
        tool(
          TOOL_NAMES.runNow,
          "立即运行一个已有定时任务。先查看任务列表取得标识。",
          { id: idSchema },
          async (args) => result(await runNow(args as Parameters<typeof runNow>[0])),
        ),
        tool(
          TOOL_NAMES.delete,
          "按用户明确要求删除一个已有定时任务。先查看任务列表取得标识。",
          { id: idSchema },
          async (args) => result(await runDelete(args as Parameters<typeof runDelete>[0])),
        ),
      ],
    }),
    runList,
    runCreate,
    runUpdate,
    runSetStatus,
    runDelete,
    runNow,
  };
}
