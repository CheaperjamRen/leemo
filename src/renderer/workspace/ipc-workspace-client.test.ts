import { describe, expect, it, vi } from "vitest";
import { IpcWorkspaceClient, type LeemoWorkspaceApi } from "./ipc-workspace-client";
import type { InvokeResult } from "../bridge/ipc-client";

function api(response: unknown = undefined) {
  const invoke = vi.fn(async (_op: string, _payload?: unknown): Promise<InvokeResult> => ({ ok: true, response }));
  return {
    invoke,
    pathForFile: vi.fn(() => ""),
  } as LeemoWorkspaceApi & { invoke: typeof invoke };
}

describe("IpcWorkspaceClient workspace registry operations", () => {
  it("lists and opens workspaces without accepting a renderer-supplied path", async () => {
    const roots = [{
      id: "leemo-home",
      name: "Leemo",
      displayPath: "C:/Users/me/Leemo",
      kind: "home" as const,
      available: true,
      lastOpenedAt: 0,
    }];
    const bridge = api(roots);
    const client = new IpcWorkspaceClient(bridge);
    await expect(client.listWorkspaces()).resolves.toEqual(roots);
    expect(bridge.invoke).toHaveBeenCalledWith("listWorkspaces", undefined);

    bridge.invoke.mockResolvedValueOnce({ ok: true, response: roots[0] });
    await expect(client.pickWorkspace()).resolves.toEqual(roots[0]);
    expect(bridge.invoke).toHaveBeenLastCalledWith("pickWorkspace", undefined);
  });

  it("touches and forgets by opaque id only", async () => {
    const bridge = api(true);
    const client = new IpcWorkspaceClient(bridge);
    await client.touchWorkspace("workspace-abc");
    expect(bridge.invoke).toHaveBeenCalledWith("touchWorkspace", { id: "workspace-abc" });
    await expect(client.forgetWorkspace("workspace-abc")).resolves.toBe(true);
    expect(bridge.invoke).toHaveBeenCalledWith("forgetWorkspace", { id: "workspace-abc" });
  });

  it("surfaces a cancelled picker as null and main errors verbatim", async () => {
    const cancelled = api(null);
    await expect(new IpcWorkspaceClient(cancelled).pickWorkspace()).resolves.toBeNull();

    const failed = api();
    failed.invoke.mockResolvedValueOnce({ ok: false, error: "找不到这个工作区，请重新选择文件夹。" });
    await expect(new IpcWorkspaceClient(failed).touchWorkspace("workspace-missing")).rejects.toThrow(
      "找不到这个工作区，请重新选择文件夹。",
    );
  });

  it("carries only the opaque workspace id for file operations", async () => {
    const bridge = api([]);
    const client = new IpcWorkspaceClient(bridge);
    await client.readTree("workspace-123");
    await client.dropFiles(["C:/Downloads/a.pdf"], null, "workspace-123");
    await client.moveFile("a.pdf", null, "workspace-123");
    await client.suggestNotebook("a.pdf", "workspace-123");
    await client.readTextFile("a.md", "workspace-123");
    await client.readPreview("a.md", "workspace-123");
    await client.writeMarkdownFile("a.md", "new", "old", "workspace-123");
    await client.reveal("a.md", "workspace-123");

    expect(bridge.invoke.mock.calls.map(([op, payload]) => [op, payload])).toEqual([
      ["readTree", { workspaceId: "workspace-123" }],
      ["dropFiles", { sources: ["C:/Downloads/a.pdf"], notebookId: null, workspaceId: "workspace-123" }],
      ["moveFile", { path: "a.pdf", notebookId: null, workspaceId: "workspace-123" }],
      ["suggestNotebook", { fileName: "a.pdf", workspaceId: "workspace-123" }],
      ["readTextFile", { path: "a.md", workspaceId: "workspace-123" }],
      ["readPreview", { path: "a.md", workspaceId: "workspace-123" }],
      ["writeMarkdownFile", { path: "a.md", text: "new", expectedText: "old", workspaceId: "workspace-123" }],
      ["reveal", { path: "a.md", workspaceId: "workspace-123" }],
    ]);
  });

  it("stages a clipboard image through main instead of inventing a renderer path", async () => {
    const attachment = {
      name: "粘贴图片.png",
      path: "C:/Temp/Leemo/clipboard.png",
      size: 128,
      mimeType: "image/png",
    };
    const bridge = api(attachment);

    await expect(new IpcWorkspaceClient(bridge).stageClipboardImage()).resolves.toEqual(attachment);
    expect(bridge.invoke).toHaveBeenCalledWith("stageClipboardImage", undefined);
  });

  it("releases a staged clipboard image through the guarded main-process cache", async () => {
    const bridge = api(true);

    await expect(new IpcWorkspaceClient(bridge).releaseClipboardImage("C:/Temp/Leemo/clipboard.png"))
      .resolves.toBeUndefined();
    expect(bridge.invoke).toHaveBeenCalledWith("releaseClipboardImage", {
      path: "C:/Temp/Leemo/clipboard.png",
    });
  });
});
