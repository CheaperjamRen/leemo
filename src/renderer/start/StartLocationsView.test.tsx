import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "../bridge/context";
import type { HumanFolderInfo, WorkspaceClient } from "../workspace/client";
import StartLocationsView from "./StartLocationsView";

function folder(id: string, overrides: Partial<HumanFolderInfo> = {}): HumanFolderInfo {
  return {
    id,
    name: id,
    displayPath: `C:/Users/Rengar/${id}`,
    available: true,
    lastOpenedAt: 10,
    ...overrides,
  };
}

function workspace(initial: HumanFolderInfo[] = []) {
  let current = [...initial];
  const client = {
    listHumanFolders: vi.fn(async () => current),
    pickHumanFolder: vi.fn(async () => {
      const added = folder("新文件夹");
      current = [added, ...current];
      return added;
    }),
    openHumanFolder: vi.fn(async (id: string) => {
      const found = current.find((item) => item.id === id);
      if (!found) throw new Error("找不到这个文件夹");
      return { ...found, lastOpenedAt: 20 };
    }),
    forgetHumanFolder: vi.fn(async (id: string) => {
      current = current.filter((item) => item.id !== id);
      return true;
    }),
  } as unknown as WorkspaceClient;
  return { client, getCurrent: () => current };
}

describe("StartLocationsView", () => {
  it("adds and opens a human-only folder shortcut", async () => {
    const f = workspace();
    render(<BridgeProvider workspace={f.client}><StartLocationsView /></BridgeProvider>);

    expect(await screen.findByText("还没有常用文件夹")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: /添加文件夹/ })[0]);
    expect(await screen.findByText("新文件夹")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /打开文件夹 新文件夹/ }));
    expect(f.client.openHumanFolder).toHaveBeenCalledWith("新文件夹");
  });

  it("shows unavailable folders and removes only the shortcut", async () => {
    const f = workspace([folder("失联资料", { available: false })]);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<BridgeProvider workspace={f.client}><StartLocationsView /></BridgeProvider>);

    expect(await screen.findByText("文件夹不可用")).toBeInTheDocument();
    const forget = screen.getByRole("button", { name: "移除 失联资料" });
    await userEvent.click(forget);
    await waitFor(() => expect(screen.queryByText("失联资料")).not.toBeInTheDocument());
    expect(f.client.forgetHumanFolder).toHaveBeenCalledWith("失联资料");
  });
});
