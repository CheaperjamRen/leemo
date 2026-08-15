import { describe, expect, it, vi } from "vitest";
import { IpcTaskClient, type LeemoTasksApi } from "./client";

describe("IpcTaskClient", () => {
  it("uses the narrow task IPC operations for list, create, update, and delete", async () => {
    const invoke = vi.fn(async (op: string) => ({
      ok: true,
      response: op === "listTasks" ? [] : op === "deleteTask" ? undefined : { id: "task-1" },
    }));
    const client = new IpcTaskClient({ invoke, onChanged: vi.fn(() => vi.fn()) } as LeemoTasksApi);

    await expect(client.listTasks()).resolves.toEqual([]);
    await client.createTask({ title: "提交简历" });
    await client.updateTask({ id: "task-1", expectedRevision: 1, status: "done" });
    await client.deleteTask({ id: "task-1", expectedRevision: 2 });

    expect(invoke.mock.calls).toEqual([
      ["listTasks", undefined],
      ["createTask", { title: "提交简历" }],
      ["updateTask", { id: "task-1", expectedRevision: 1, status: "done" }],
      ["deleteTask", { id: "task-1", expectedRevision: 2 }],
    ]);
  });

  it("surfaces a user-readable main-process error", async () => {
    const client = new IpcTaskClient({
      invoke: vi.fn(async () => ({ ok: false, error: "待办已在别处更新，请刷新后重试。" })),
      onChanged: vi.fn(() => vi.fn()),
    });

    await expect(client.listTasks()).rejects.toThrow("待办已在别处更新，请刷新后重试。");
  });

  it("forwards task invalidation events so a fired reminder cannot leave the UI stale", () => {
    const unsubscribe = vi.fn();
    const onChanged = vi.fn(() => unsubscribe);
    const client = new IpcTaskClient({ invoke: vi.fn(), onChanged });
    const listener = vi.fn();

    expect(client.onChanged(listener)).toBe(unsubscribe);
    expect(onChanged).toHaveBeenCalledWith(listener);
  });
});
