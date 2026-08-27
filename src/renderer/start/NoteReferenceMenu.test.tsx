import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import NoteReferenceMenu from "./NoteReferenceMenu";

function note(id: string, title: string): Note {
  return {
    id,
    title,
    markdown: "",
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
    parentId: null,
    sortOrder: 0,
    pinnedAt: null,
    organizedAt: null,
  };
}

describe("NoteReferenceMenu", () => {
  it("filters real notes, excludes the current document and returns the selected record", async () => {
    const onSelect = vi.fn();
    render(
      <NoteReferenceMenu
        notes={[note("current", "当前文档"), note("resume", "简历优化"), note("story", "产品故事")]}
        currentNoteId="current"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("option", { name: /当前文档/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索可引用便签" }), "简历");
    expect(screen.getByRole("option", { name: /简历优化/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /产品故事/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /简历优化/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "resume" }));
  });

  it("closes when the user clicks outside the reference picker", () => {
    const onClose = vi.fn();
    render(
      <NoteReferenceMenu
        notes={[note("resume", "简历优化")]}
        currentNoteId={null}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
