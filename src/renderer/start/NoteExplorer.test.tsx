import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import NoteExplorer from "./NoteExplorer";

function note(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    markdown: "",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: 100,
    ...overrides,
  };
}

function dataTransfer(noteId?: string) {
  const values = new Map<string, string>();
  if (noteId) values.set("application/x-leemo-note", JSON.stringify({ noteId }));
  return {
    files: [] as unknown as FileList,
    types: [...values.keys()],
    effectAllowed: "all",
    dropEffect: "move",
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
  } as unknown as DataTransfer;
}

describe("NoteExplorer", () => {
  it("renders editable parent documents and their children as one compact tree", () => {
    const parent = note("parent", { title: "求职准备" });
    const child = note("child", { title: "产品故事", parentId: parent.id });
    render(<NoteExplorer notes={[child, parent]} selectedId={child.id} onSelect={vi.fn()} onCreate={vi.fn()} onMove={vi.fn()} />);

    expect(screen.getByRole("tree", { name: "文档库" })).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /求职准备/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: /产品故事/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("treeitem", { name: /产品故事/ })).toHaveAttribute("data-depth", "1");
  });

  it("keeps a matching child and its parent visible while searching", async () => {
    const parent = note("parent", { title: "求职准备" });
    const child = note("child", { title: "简历优化", parentId: parent.id });
    render(<NoteExplorer notes={[parent, child, note("other", { title: "读书" })]} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn()} onMove={vi.fn()} />);

    await userEvent.type(screen.getByRole("searchbox", { name: "搜索文档" }), "简历");
    const tree = screen.getByRole("tree", { name: "文档库" });
    expect(within(tree).getByText("求职准备")).toBeInTheDocument();
    expect(within(tree).getByText("简历优化")).toBeInTheDocument();
    expect(within(tree).queryByText("读书")).not.toBeInTheDocument();
  });

  it("moves a dragged note under a target or back to the document root", () => {
    const onMove = vi.fn();
    const parent = note("parent", { title: "求职准备" });
    const child = note("child", { title: "简历优化" });
    render(<NoteExplorer notes={[parent, child]} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn()} onMove={onMove} />);

    fireEvent.drop(screen.getByRole("treeitem", { name: /求职准备/ }), { dataTransfer: dataTransfer(child.id) });
    expect(onMove).toHaveBeenNthCalledWith(1, child.id, parent.id, 0);

    fireEvent.drop(screen.getByTestId("note-tree-root-drop"), { dataTransfer: dataTransfer(child.id) });
    expect(onMove).toHaveBeenNthCalledWith(2, child.id, null, 2);
  });
});
