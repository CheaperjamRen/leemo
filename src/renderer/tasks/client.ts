import type {
  CreateManyTasksInput,
  CreateTaskInput,
  DeleteTaskInput,
  UpdateTaskInput,
  UserTask,
} from "../../tasks";

export interface TaskInvokeResult {
  ok: boolean;
  response?: unknown;
  error?: string;
}

export interface LeemoTasksApi {
  invoke(op: string, payload: unknown): Promise<TaskInvokeResult>;
  onChanged(listener: () => void): () => void;
}

export interface TaskClient {
  listTasks(): Promise<UserTask[]>;
  createTask(input: CreateTaskInput): Promise<UserTask>;
  createManyTasks(input: CreateManyTasksInput): Promise<UserTask[]>;
  updateTask(input: UpdateTaskInput): Promise<UserTask>;
  deleteTask(input: DeleteTaskInput): Promise<void>;
  onChanged?(listener: () => void): () => void;
}

function requireResponse<T>(result: TaskInvokeResult): T {
  if (!result.ok) throw new Error(result.error || "待办暂时无法使用，请稍后重试。");
  return result.response as T;
}

export class IpcTaskClient implements TaskClient {
  constructor(private readonly api: LeemoTasksApi) {}

  private async call<T>(op: string, payload?: unknown): Promise<T> {
    return requireResponse<T>(await this.api.invoke(op, payload));
  }

  listTasks(): Promise<UserTask[]> {
    return this.call("listTasks");
  }

  createTask(input: CreateTaskInput): Promise<UserTask> {
    return this.call("createTask", input);
  }

  createManyTasks(input: CreateManyTasksInput): Promise<UserTask[]> {
    return this.call("createManyTasks", input);
  }

  updateTask(input: UpdateTaskInput): Promise<UserTask> {
    return this.call("updateTask", input);
  }

  deleteTask(input: DeleteTaskInput): Promise<void> {
    return this.call("deleteTask", input);
  }

  onChanged(listener: () => void): () => void {
    return this.api.onChanged(listener);
  }
}
