import { describe, expect, it, vi } from "vitest";
import { IpcTrashClient, type LeemoTrashApi } from "./client";

describe("IpcTrashClient", () => {
  it("uses the narrow trash operations and surfaces main-process errors", async () => {
    const invoke = vi.fn(async (op: string) => {
      if (op === "list") return { ok: true, response: { notes: [], tasks: [] } };
      if (op === "restore") return { ok: true, response: { id: "note-1", revision: 3 } };
      return { ok: false, error: "这条记录不存在" };
    });
    const client = new IpcTrashClient({ invoke } as LeemoTrashApi);

    await expect(client.list()).resolves.toEqual({ notes: [], tasks: [] });
    await expect(client.restore({ kind: "note", id: "note-1", expectedRevision: 2 }))
      .resolves.toMatchObject({ revision: 3 });
    await expect(client.permanentlyDelete({ kind: "task", id: "task-1", expectedRevision: 2 }))
      .rejects.toThrow("这条记录不存在");
    expect(invoke).toHaveBeenNthCalledWith(2, "restore", {
      kind: "note", id: "note-1", expectedRevision: 2,
    });
  });
});
