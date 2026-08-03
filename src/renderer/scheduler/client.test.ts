import { describe, expect, it, vi } from "vitest";
import { IpcSchedulerClient, type LeemoSchedulerApi } from "./client";

describe("IpcSchedulerClient", () => {
  it("keeps the renderer on the narrow scheduler operation surface", async () => {
    const invoke = vi.fn(async (op: string) => ({
      ok: true,
      response: op === "list" ? { tasks: [], runs: [] } : undefined,
    }));
    const api: LeemoSchedulerApi = { invoke, onDue: vi.fn(() => () => undefined) };
    const client = new IpcSchedulerClient(api);

    expect(await client.list()).toEqual({ tasks: [], runs: [] });
    await client.skipMissed("run-1");
    expect(invoke).toHaveBeenNthCalledWith(1, "list", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "skipMissed", { runId: "run-1" });
  });

  it("forwards durable due ids and turns IPC failures into real errors", async () => {
    let due: ((payload: unknown) => void) | undefined;
    const api: LeemoSchedulerApi = {
      invoke: vi.fn(async () => ({ ok: false, error: "本地时钟不可用" })),
      onDue: (cb) => { due = cb; return () => { due = undefined; }; },
    };
    const client = new IpcSchedulerClient(api);
    const received = vi.fn();
    const off = client.onDue(received);
    due?.({ taskId: "task-1", runId: "run-1" });
    expect(received).toHaveBeenCalledWith({ taskId: "task-1", runId: "run-1" });
    await expect(client.list()).rejects.toThrow("本地时钟不可用");
    off();
  });
});
