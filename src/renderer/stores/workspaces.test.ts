import { describe, expect, it, vi } from "vitest";
import type { WorkspaceClient, WorkspaceRootInfo } from "../workspace/client";
import { createWorkspacesStore } from "./workspaces";

const HOME: WorkspaceRootInfo = {
  id: "leemo-home",
  name: "Leemo",
  displayPath: "C:/Users/me/Leemo",
  kind: "home",
  available: true,
  lastOpenedAt: 0,
};
const PROJECT: WorkspaceRootInfo = {
  id: "workspace-123",
  name: "毕业设计",
  displayPath: "D:/Projects/毕业设计",
  kind: "external",
  available: true,
  lastOpenedAt: 20,
};

function client(over: Partial<WorkspaceClient> = {}): WorkspaceClient {
  return {
    listWorkspaces: async () => [HOME, PROJECT],
    pickWorkspace: async () => PROJECT,
    touchWorkspace: async (id) => id === HOME.id ? HOME : PROJECT,
  forgetWorkspace: async () => true,
    updateWorkspace: async (id, input) => ({ ...(id === HOME.id ? HOME : PROJECT), ...input }),
    listNotebooks: async () => ({ root: HOME.displayPath, notebooks: [] }),
    createNotebook: async () => { throw new Error("unused"); },
    ensureStarterNotebook: async () => { throw new Error("unused"); },
    readTree: async () => [],
    dropFiles: async () => [],
    moveFile: async () => { throw new Error("unused"); },
    suggestNotebook: async () => null,
    readTextFile: async () => "",
    readPreview: async () => ({ kind: "unpreviewable", reason: "unused", size: 0 }),
    reveal: async () => {},
    pathForFile: () => "",
    ...over,
  };
}

describe("createWorkspacesStore", () => {
  it("starts at the Leemo home workspace and refreshes recent folders", async () => {
    const store = createWorkspacesStore(client());
    expect(store.getState().activeId).toBe(HOME.id);
    await store.getState().refresh();
    expect(store.getState().list).toEqual([HOME, PROJECT]);
    expect(store.getState().status).toBe("ready");
  });

  it("native picker cancellation changes nothing", async () => {
    const pickWorkspace = vi.fn(async () => null);
    const store = createWorkspacesStore(client({ pickWorkspace }), [HOME]);
    await expect(store.getState().openFolder()).resolves.toBeNull();
    expect(store.getState().activeId).toBe(HOME.id);
    expect(store.getState().list).toEqual([HOME]);
  });

  it("selects a newly picked folder and exposes one lightweight first-use notice", async () => {
    const pickWorkspace = vi.fn(async () => PROJECT);
    const store = createWorkspacesStore(client({ pickWorkspace }), [HOME]);
    await expect(store.getState().openFolder()).resolves.toBe(PROJECT.id);
    expect(pickWorkspace).toHaveBeenCalledWith();
    expect(store.getState().activeId).toBe(PROJECT.id);
    expect(store.getState().justOpenedId).toBe(PROJECT.id);
    expect(store.getState().list).toEqual([HOME, PROJECT]);
    store.getState().dismissNotice();
    expect(store.getState().justOpenedId).toBeNull();
  });

  it("selects an existing workspace using only its opaque id", async () => {
    const touchWorkspace = vi.fn(async () => PROJECT);
    const store = createWorkspacesStore(client({ touchWorkspace }), [HOME, PROJECT]);
    await expect(store.getState().select(PROJECT.id)).resolves.toBe(true);
    expect(touchWorkspace).toHaveBeenCalledWith(PROJECT.id);
    expect(touchWorkspace).not.toHaveBeenCalledWith(PROJECT.displayPath);
    expect(store.getState().activeId).toBe(PROJECT.id);
  });

  it("keeps a missing folder visible but refuses to select it", async () => {
    const missing = { ...PROJECT, available: false };
    const touchWorkspace = vi.fn();
    const store = createWorkspacesStore(client({ touchWorkspace }), [HOME, missing]);
    await expect(store.getState().select(missing.id)).resolves.toBe(false);
    expect(touchWorkspace).not.toHaveBeenCalled();
    expect(store.getState().activeId).toBe(HOME.id);
    expect(store.getState().error).toMatch(/找不到.*毕业设计/);
  });

  it("forgets a recent entry without optimistic deletion on failure", async () => {
    const forgetWorkspace = vi.fn(async () => { throw new Error("主进程拒绝移除"); });
    const store = createWorkspacesStore(client({ forgetWorkspace }), [HOME, PROJECT]);
    await expect(store.getState().forget(PROJECT.id)).resolves.toBe(false);
    expect(store.getState().list).toContainEqual(PROJECT);
    expect(store.getState().error).toContain("主进程拒绝移除");
  });

  it("falls back to home after successfully forgetting the active external workspace", async () => {
    const store = createWorkspacesStore(client(), [HOME, PROJECT]);
    store.setState({ activeId: PROJECT.id });
    await expect(store.getState().forget(PROJECT.id)).resolves.toBe(true);
    expect(store.getState().activeId).toBe(HOME.id);
    expect(store.getState().list).toEqual([HOME]);
  });

  it("renames and archives an external folder entry without forgetting it", async () => {
    const updateWorkspace = vi.fn(async (_id: string, input: { name?: string; archived?: boolean }) => ({
      ...PROJECT,
      ...input,
    }));
    const store = createWorkspacesStore(client({ updateWorkspace }), [HOME, PROJECT]);
    store.setState({ activeId: PROJECT.id });

    await expect(store.getState().rename(PROJECT.id, "毕业论文资料")).resolves.toBe(true);
    expect(store.getState().list.find((entry) => entry.id === PROJECT.id)?.name).toBe("毕业论文资料");

    await expect(store.getState().setArchived(PROJECT.id, true)).resolves.toBe(true);
    expect(store.getState().list.find((entry) => entry.id === PROJECT.id)?.archived).toBe(true);
    expect(store.getState().activeId).toBe(HOME.id);
    expect(updateWorkspace).toHaveBeenCalledTimes(2);
  });

  it("degrades to a truthful unsupported state outside Electron", async () => {
    const store = createWorkspacesStore(undefined);
    await store.getState().refresh();
    await expect(store.getState().openFolder()).resolves.toBeNull();
    expect(store.getState().error).toMatch(/当前环境不能打开本子文件夹/);
  });
});
