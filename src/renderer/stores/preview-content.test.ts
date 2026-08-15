import { describe, expect, it, vi } from "vitest";
import { createPreviewContentStore } from "./preview-content";
import type { PreviewPayload, WorkspaceClient } from "../workspace/client";

const TEXT: PreviewPayload = { kind: "text", text: "# 标题", truncated: false, size: 7 };

function workspace(impl?: (path: string) => Promise<PreviewPayload>) {
  const readPreview = vi.fn(impl ?? (async () => TEXT));
  const writeMarkdownFile = vi.fn(async (_path: string, text: string) => ({
    kind: "text" as const,
    text,
    truncated: false,
    size: Buffer.byteLength(text),
  }));
  return {
    client: { readPreview, writeMarkdownFile } as unknown as WorkspaceClient,
    readPreview,
    writeMarkdownFile,
  };
}

describe("preview-content store", () => {
  it("keeps a ready browser-fixture preview instead of replacing it with a workspace error", async () => {
    const store = createPreviewContentStore(undefined, {
      initialEntries: { "demo.md": { status: "ready", payload: TEXT } },
    });

    await store.getState().load("demo.md");

    expect(store.getState().byPath["demo.md"]).toEqual({ status: "ready", payload: TEXT });
  });

  it("goes loading → ready and keeps the payload under its path", async () => {
    const { client } = workspace();
    const store = createPreviewContentStore(client);

    const task = store.getState().load("math/notes.md");
    expect(store.getState().byPath["math/notes.md"]?.status).toBe("loading");
    await task;

    expect(store.getState().byPath["math/notes.md"]).toEqual({ status: "ready", payload: TEXT });
  });

  it("surfaces the host's own wording on failure instead of a blank pane", async () => {
    const { client } = workspace(async () => {
      throw new Error("读不到这个文件：math/gone.md");
    });
    const store = createPreviewContentStore(client);
    await store.getState().load("math/gone.md");

    expect(store.getState().byPath["math/gone.md"]).toEqual({
      status: "error",
      error: "读不到这个文件：math/gone.md",
      errorKind: "missing",
    });
  });

  it.each([
    ["ENOENT: no such file or directory, stat 'C:\\Users\\me\\Leemo\\math\\gone.md'", "missing"],
    ["EACCES: permission denied, open 'C:\\Users\\me\\Leemo\\math\\locked.md'", "permission"],
    ["EPERM: operation not permitted, open 'C:\\Users\\me\\Leemo\\math\\locked.md'", "permission"],
    ["当前环境读不了文件（没有连接本子文件夹）", "workspace"],
    ["unexpected transport failure", "unknown"],
  ] as const)("classifies preview failures for a useful next step: %s", async (message, errorKind) => {
    const { client } = workspace(async () => { throw new Error(message); });
    const store = createPreviewContentStore(client);
    await store.getState().load("math/file.md");
    expect(store.getState().byPath["math/file.md"]).toMatchObject({ status: "error", errorKind });
  });

  it("reads a given path once — a re-open of the same tab hits no disk", async () => {
    const { client, readPreview } = workspace();
    const store = createPreviewContentStore(client);
    await store.getState().load("a.md");
    await store.getState().load("a.md");
    expect(readPreview).toHaveBeenCalledTimes(1);
  });

  it("reads a relative path from the selected workspace id", async () => {
    const { client, readPreview } = workspace();
    const store = createPreviewContentStore(client, {
      resolveWorkspaceId: () => "workspace-123",
    });
    await store.getState().load("README.md");
    expect(readPreview).toHaveBeenCalledWith("README.md", "workspace-123");
  });

  it("collapses concurrent loads of one path into a single read", async () => {
    let release: (p: PreviewPayload) => void = () => {};
    const { client, readPreview } = workspace(() => new Promise<PreviewPayload>((r) => { release = r; }));
    const store = createPreviewContentStore(client);

    const a = store.getState().load("a.md");
    const b = store.getState().load("a.md");
    release(TEXT);
    await Promise.all([a, b]);

    expect(readPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().byPath["a.md"]?.status).toBe("ready");
  });

  it("force re-reads a path already in hand (the file changed on disk)", async () => {
    const { client, readPreview } = workspace();
    const store = createPreviewContentStore(client);
    await store.getState().load("a.md");
    await store.getState().load("a.md", { force: true });
    expect(readPreview).toHaveBeenCalledTimes(2);
  });

  it("keeps several paths side by side (预览区是多标签的)", async () => {
    const { client } = workspace(async (path) => ({ kind: "text", text: path, truncated: false, size: 1 }));
    const store = createPreviewContentStore(client);
    await store.getState().load("a.md");
    await store.getState().load("b.md");

    expect(store.getState().byPath["a.md"]?.payload).toMatchObject({ text: "a.md" });
    expect(store.getState().byPath["b.md"]?.payload).toMatchObject({ text: "b.md" });
  });

  it("forget drops the content — a 25MB PDF must not outlive its closed tab", async () => {
    const { client } = workspace();
    const store = createPreviewContentStore(client);
    await store.getState().load("a.md");
    store.getState().forget("a.md");
    expect(store.getState().byPath["a.md"]).toBeUndefined();
    // 扔一个不存在的不该炸，也不该换掉 byPath 的引用。
    const before = store.getState().byPath;
    store.getState().forget("nope.md");
    expect(store.getState().byPath).toBe(before);
  });

  it("clears every cached payload when the workspace root changes", async () => {
    const { client } = workspace();
    const store = createPreviewContentStore(client);
    await store.getState().load("a.md");
    await store.getState().load("b.md");
    store.getState().clear();
    expect(store.getState().byPath).toEqual({});
  });

  it("does not let an in-flight preview from the previous workspace overwrite the new one", async () => {
    let activeId = "workspace-a";
    let releaseOld!: (payload: PreviewPayload) => void;
    const readPreview = vi.fn((path: string, workspaceId?: string) => {
      if (workspaceId === "workspace-a") {
        return new Promise<PreviewPayload>((resolve) => { releaseOld = resolve; });
      }
      return Promise.resolve<PreviewPayload>({
        kind: "text",
        text: `new:${path}`,
        truncated: false,
        size: 1,
      });
    });
    const store = createPreviewContentStore(
      { readPreview } as unknown as WorkspaceClient,
      { resolveWorkspaceId: () => activeId },
    );

    const oldLoad = store.getState().load("README.md");
    activeId = "workspace-b";
    store.getState().clear();
    await store.getState().load("README.md");
    releaseOld({ kind: "text", text: "old", truncated: false, size: 1 });
    await oldLoad;

    expect(readPreview).toHaveBeenCalledTimes(2);
    expect(store.getState().byPath["README.md"]?.payload).toMatchObject({ text: "new:README.md" });
  });

  it("says the ENVIRONMENT can't read files when there is no workspace at all", async () => {
    const store = createPreviewContentStore(undefined);
    await store.getState().load("a.md");
    expect(store.getState().byPath["a.md"]).toMatchObject({ status: "error", errorKind: "workspace" });
    expect(store.getState().byPath["a.md"]?.error).toContain("没有连接本子文件夹");
  });

  it("ignores an empty path (no tab is open)", async () => {
    const { client, readPreview } = workspace();
    const store = createPreviewContentStore(client);
    await store.getState().load("");
    expect(readPreview).not.toHaveBeenCalled();
    expect(store.getState().byPath).toEqual({});
  });

  it("keeps a workspace-scoped draft and replaces the cached preview after save", async () => {
    const { client, writeMarkdownFile } = workspace();
    const store = createPreviewContentStore(client, { resolveWorkspaceId: () => "workspace-123" });
    await store.getState().load("notes.md");
    store.getState().beginEdit("notes.md", "# 标题");
    store.getState().updateDraft("notes.md", "# 新标题");

    expect(store.getState().drafts["workspace-123\u0000notes.md"]).toMatchObject({
      text: "# 新标题",
      originalText: "# 标题",
      status: "dirty",
    });
    await expect(store.getState().saveDraft("notes.md")).resolves.toBe(true);
    expect(writeMarkdownFile).toHaveBeenCalledWith("notes.md", "# 新标题", "# 标题", "workspace-123");
    expect(store.getState().byPath["notes.md"]?.payload).toMatchObject({ text: "# 新标题" });
    expect(store.getState().drafts["workspace-123\u0000notes.md"]).toMatchObject({
      text: "# 新标题",
      originalText: "# 新标题",
      status: "clean",
    });
  });

  it("keeps a dirty draft and a useful error when save fails", async () => {
    const { client } = workspace();
    client.writeMarkdownFile = vi.fn(async () => {
      throw new Error("文件已在其他地方发生了变化。你的草稿还在，请重新载入后再保存。");
    });
    const store = createPreviewContentStore(client);
    store.getState().beginEdit("notes.md", "old");
    store.getState().updateDraft("notes.md", "my draft");

    await expect(store.getState().saveDraft("notes.md")).resolves.toBe(false);
    expect(store.getState().drafts["\u0000notes.md"]).toMatchObject({
      text: "my draft",
      status: "error",
      error: expect.stringContaining("草稿还在"),
    });
  });

  it("does not mix drafts from workspaces that use the same relative path", () => {
    let workspaceId = "workspace-a";
    const { client } = workspace();
    const store = createPreviewContentStore(client, { resolveWorkspaceId: () => workspaceId });
    store.getState().beginEdit("README.md", "A");
    store.getState().updateDraft("README.md", "draft A");
    workspaceId = "workspace-b";
    store.getState().beginEdit("README.md", "B");

    expect(store.getState().drafts["workspace-a\u0000README.md"]?.text).toBe("draft A");
    expect(store.getState().drafts["workspace-b\u0000README.md"]?.text).toBe("B");
  });

  it("can clear one workspace after the active id has already changed", () => {
    let workspaceId = "workspace-a";
    const { client } = workspace();
    const store = createPreviewContentStore(client, { resolveWorkspaceId: () => workspaceId });
    store.getState().beginEdit("README.md", "A");
    workspaceId = "workspace-b";
    store.getState().beginEdit("README.md", "B");

    store.getState().discardWorkspaceDrafts("workspace-a");

    expect(store.getState().drafts["workspace-a\u0000README.md"]).toBeUndefined();
    expect(store.getState().drafts["workspace-b\u0000README.md"]?.text).toBe("B");
  });

  it("does not start a second write while the first save is still running", async () => {
    let finish!: (payload: Extract<PreviewPayload, { kind: "text" }>) => void;
    const { client } = workspace();
    const writeMarkdownFile = vi.fn(() => new Promise<Extract<PreviewPayload, { kind: "text" }>>((resolve) => {
      finish = resolve;
    }));
    client.writeMarkdownFile = writeMarkdownFile;
    const store = createPreviewContentStore(client);
    store.getState().beginEdit("notes.md", "old");
    store.getState().updateDraft("notes.md", "new");

    const first = store.getState().saveDraft("notes.md");
    await expect(store.getState().saveDraft("notes.md")).resolves.toBe(false);
    expect(writeMarkdownFile).toHaveBeenCalledTimes(1);
    finish({ kind: "text", text: "new", truncated: false, size: 3 });
    await expect(first).resolves.toBe(true);
  });

  it("does not let a late save replace the preview cache of another workspace", async () => {
    let workspaceId = "workspace-a";
    let finish!: (payload: Extract<PreviewPayload, { kind: "text" }>) => void;
    const { client } = workspace();
    client.readPreview = vi.fn(async (_path: string, requestedWorkspaceId?: string) => ({
      kind: "text" as const,
      text: requestedWorkspaceId ?? "home",
      truncated: false,
      size: 1,
    }));
    client.writeMarkdownFile = vi.fn(() => new Promise<Extract<PreviewPayload, { kind: "text" }>>((resolve) => {
      finish = resolve;
    }));
    const store = createPreviewContentStore(client, { resolveWorkspaceId: () => workspaceId });
    await store.getState().load("README.md");
    store.getState().beginEdit("README.md", "workspace-a");
    store.getState().updateDraft("README.md", "saved-a");
    const saving = store.getState().saveDraft("README.md");

    workspaceId = "workspace-b";
    await store.getState().load("README.md");
    finish({ kind: "text", text: "saved-a", truncated: false, size: 7 });
    await saving;

    expect(store.getState().byPath["README.md"]?.payload).toMatchObject({ text: "workspace-b" });
    expect(store.getState().drafts["workspace-a\u0000README.md"]).toMatchObject({
      text: "saved-a",
      status: "clean",
    });
  });
});
