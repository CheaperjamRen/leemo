import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import StartTrashView from "./StartTrashView";

const deleted: Note = {
  id: "deleted-parent",
  title: "旧求职方案",
  markdown: "正文",
  revision: 2,
  createdAt: 10,
  updatedAt: 20,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: 10,
  deletedAt: 20,
  purgeAfter: 2_592_000_020,
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.leemoTrash;
});

describe("StartTrashView", () => {
  it("restores notes through the real trash bridge and refreshes the visible snapshot", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, response: { notes: [deleted], tasks: [] } })
      .mockResolvedValueOnce({ ok: true, response: [{ ...deleted, deletedAt: undefined, purgeAfter: undefined, revision: 3 }] })
      .mockResolvedValueOnce({ ok: true, response: { notes: [], tasks: [] } });
    window.leemoTrash = { invoke };
    render(<StartTrashView />);

    await userEvent.click(await screen.findByRole("button", { name: "恢复便签 旧求职方案" }));
    await waitFor(() => expect(invoke).toHaveBeenNthCalledWith(2, "restore", {
      kind: "note",
      id: deleted.id,
      expectedRevision: deleted.revision,
    }));
    expect(await screen.findByText("回收站是空的。" )).toBeInTheDocument();
  });
});
