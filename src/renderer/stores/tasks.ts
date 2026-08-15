import { createStore, type StoreApi } from "zustand/vanilla";
import type { CreateTaskInput, DeleteTaskInput, UpdateTaskInput, UserTask } from "../../tasks";
import type { TaskClient } from "../tasks/client";

type TasksStatus = "idle" | "loading" | "ready" | "error";

export interface TasksState {
  tasks: UserTask[];
  status: TasksStatus;
  error: string | null;
  saving: boolean;
  refresh(): Promise<void>;
  create(input: CreateTaskInput): Promise<UserTask>;
  createMany(inputs: CreateTaskInput[]): Promise<UserTask[]>;
  update(input: UpdateTaskInput): Promise<UserTask>;
  delete(input: DeleteTaskInput): Promise<void>;
  toggle(id: string): Promise<UserTask>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replaceTask(tasks: UserTask[], changed: UserTask): UserTask[] {
  return tasks.map((task) => task.id === changed.id ? changed : task);
}

const NO_TASK_CLIENT = "此环境未连接本地待办。";

export function createTasksStore(client?: TaskClient): StoreApi<TasksState> {
  let refreshRequest = 0;
  const store = createStore<TasksState>((set, get) => {
    const requireClient = (): TaskClient => {
      if (client) return client;
      throw new Error(NO_TASK_CLIENT);
    };

    const mutate = async <T,>(action: () => Promise<T>, apply: (value: T) => UserTask[]): Promise<T> => {
      set({ saving: true, error: null });
      try {
        const value = await action();
        refreshRequest += 1;
        set({ tasks: apply(value), status: "ready", saving: false, error: null });
        return value;
      } catch (error: unknown) {
        set({ saving: false, error: errorMessage(error) });
        throw error;
      }
    };

    return {
      tasks: [],
      status: client ? "idle" : "ready",
      error: null,
      saving: false,

      refresh: async () => {
        if (!client) {
          set({ tasks: [], status: "ready", error: null });
          return;
        }
        const request = ++refreshRequest;
        set({ status: "loading", error: null });
        try {
          const tasks = await client.listTasks();
          if (request !== refreshRequest) return;
          set({ tasks, status: "ready", error: null });
        } catch (error: unknown) {
          if (request !== refreshRequest) return;
          set({ status: "error", error: errorMessage(error) });
        }
      },

      create: (input) => mutate(
        () => requireClient().createTask(input),
        (created) => [created, ...get().tasks],
      ),

      createMany: (tasks) => mutate(
        () => requireClient().createManyTasks({ tasks }),
        (created) => [...created, ...get().tasks],
      ),

      update: (input) => mutate(
        () => requireClient().updateTask(input),
        (updated) => replaceTask(get().tasks, updated),
      ),

      delete: async (input) => {
        set({ saving: true, error: null });
        try {
          await requireClient().deleteTask(input);
          refreshRequest += 1;
          set((state) => ({
            tasks: state.tasks.filter((task) => task.id !== input.id),
            status: "ready",
            saving: false,
            error: null,
          }));
        } catch (error: unknown) {
          set({ saving: false, error: errorMessage(error) });
          throw error;
        }
      },

      toggle: async (id) => {
        const current = get().tasks.find((task) => task.id === id);
        if (!current) throw new Error("没有找到这条待办。");
        return get().update({
          id: current.id,
          expectedRevision: current.revision,
          status: current.status === "done" ? "open" : "done",
        });
      },
    };
  });

  return store;
}
