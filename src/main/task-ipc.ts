import type {
  CreateManyTasksInput,
  CreateTaskInput,
  DeleteTaskInput,
  UpdateTaskInput,
} from "../tasks";
import type { TaskAdminService } from "./task-admin";

export type TaskIpcSender = "main" | "quick";

export interface TaskIpcResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export interface TaskIpcDispatcher {
  handle(sender: TaskIpcSender | null, message: unknown): TaskIpcResult;
}

const OPERATIONS = new Set([
  "listTasks",
  "createTask",
  "createManyTasks",
  "updateTask",
  "deleteTask",
]);

function requireMessage(value: unknown): { op: string; payload?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("待办请求格式不正确。");
  }
  const message = value as Record<string, unknown>;
  if (typeof message.op !== "string" || !message.op) {
    throw new Error("待办操作不能为空。");
  }
  return { op: message.op, payload: message.payload };
}

export function createTaskIpcDispatcher(admin: TaskAdminService): TaskIpcDispatcher {
  return {
    handle(sender, rawMessage) {
      try {
        const message = requireMessage(rawMessage);
        if (!OPERATIONS.has(message.op)) throw new Error(`未知的待办操作：${message.op}`);
        if (sender !== "main" && !(sender === "quick" && message.op === "createTask")) {
          throw new Error("无法确认待办窗口身份。");
        }

        let response: unknown;
        switch (message.op) {
          case "listTasks":
            response = admin.listTasks();
            break;
          case "createTask":
            response = admin.createTask(message.payload as CreateTaskInput);
            break;
          case "createManyTasks":
            response = admin.createManyTasks(message.payload as CreateManyTasksInput);
            break;
          case "updateTask":
            response = admin.updateTask(message.payload as UpdateTaskInput);
            break;
          case "deleteTask":
            response = admin.deleteTask(message.payload as DeleteTaskInput);
            break;
          default:
            throw new Error(`未知的待办操作：${message.op}`);
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
