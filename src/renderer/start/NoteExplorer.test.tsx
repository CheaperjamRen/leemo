import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import NoteExplorer, { noteDropPosition } from "./NoteExplorer";

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

function fireDragAt(kind: "dragOver" | "drop", target: Element, transfer: DataTransfer, clientY: number): void {
  const event = createEvent[kind](target, { dataTransfer: transfer });
  Object.defineProperty(event, "clientY", { configurable: true, value: clientY });
  fireEvent(target, event);
}

describe("NoteExplorer", () => {
  it("maps the pointer to before, inside, and after drop zones", () => {
    const rect = { top: 100, height: 40 } as DOMRect;
    expect(noteDropPosition(102, rect)).toBe("before");
    expect(noteDropPosition(120, rect)).toBe("inside");
    expect(noteDropPosition(138, rect)).toBe("after");
  });

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
    expect(onMove).toHaveBeenNthCalledWith(2, child.id, null, 1);
  });

  it("reorders before or after a sibling using visible row drop zones", () => {
    const onMove = vi.fn();
    const first = note("first", { title: "第一章", sortOrder: 0 });
    const second = note("second", { title: "第二章", sortOrder: 1 });
    const third = note("third", { title: "第三章", sortOrder: 2 });
    render(<NoteExplorer notes={[first, second, third]} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn()} onMove={onMove} />);

    const secondRow = screen.getByRole("treeitem", { name: /第二章/ });
    vi.spyOn(secondRow, "getBoundingClientRect").mockReturnValue({ top: 100, height: 40 } as DOMRect);
    fireDragAt("dragOver", secondRow, dataTransfer(first.id), 102);
    expect(secondRow).toHaveAttribute("data-drop-position", "before");
    fireDragAt("drop", secondRow, dataTransfer(first.id), 102);
    expect(onMove).toHaveBeenNthCalledWith(1, first.id, null, 0);

    const thirdRow = screen.getByRole("treeitem", { name: /第三章/ });
    vi.spyOn(thirdRow, "getBoundingClientRect").mockReturnValue({ top: 100, height: 40 } as DOMRect);
    fireDragAt("drop", thirdRow, dataTransfer(first.id), 138);
    expect(onMove).toHaveBeenNthCalledWith(2, first.id, null, 2);
  });

  it("rejects a drop that would move a parent inside its own descendant", () => {
    const onMove = vi.fn();
    const parent = note("parent", { title: "求职准备" });
    const child = note("child", { title: "产品故事", parentId: parent.id });
    render(<NoteExplorer notes={[parent, child]} selectedId={null} onSelect={vi.fn()} onCreate={vi.fn()} onMove={onMove} />);

    const childRow = screen.getByRole("treeitem", { name: /产品故事/ });
    vi.spyOn(childRow, "getBoundingClientRect").mockReturnValue({ top: 100, height: 40 } as DOMRect);
    const transfer = dataTransfer(parent.id);
    fireDragAt("dragOver", childRow, transfer, 120);
    expect(transfer.dropEffect).toBe("none");
    fireDragAt("drop", childRow, transfer, 120);
    expect(onMove).not.toHaveBeenCalled();
  });
});
