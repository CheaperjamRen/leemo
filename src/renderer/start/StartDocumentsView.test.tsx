import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import type { CaptureClient } from "../capture/client";
import { BridgeProvider } from "../bridge/context";
import StartDocumentsView from "./StartDocumentsView";

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

function captureClient(notes: Note[]) {
  const updateNote = vi.fn(async (input) => ({
    ...notes.find((note) => note.id === input.id)!,
    title: input.title,
    markdown: input.markdown,
    revision: input.expectedRevision + 1,
    updatedAt: 200,
  }));
  const client: CaptureClient = {
    getQuickDraft: vi.fn(),
    saveQuickDraft: vi.fn(),
    commitQuickDraft: vi.fn(),
    listNotes: vi.fn(async () => notes),
    listArchivedNotes: vi.fn(async () => []),
    createNote: vi.fn(async ({ title, markdown }) => note("new", { title, markdown })),
    updateNote,
    moveNote: vi.fn(async () => notes),
    setNotePinned: vi.fn(async () => notes[0]!),
    markNoteOrganized: vi.fn(async () => notes[0]!),
    archiveNote: vi.fn(async () => ({ ...notes[0]!, archivedAt: 200 })),
    unarchiveNote: vi.fn(async () => notes[0]!),
    deleteNote: vi.fn(async () => undefined),
    attachImageBytes: vi.fn(),
    attachExternalFile: vi.fn(),
    attachFileCopy: vi.fn(),
    removeAttachment: vi.fn(),
    migrateStorageRoot: vi.fn(),
    onChanged: vi.fn(() => vi.fn()),
  };
  return { client, updateNote };
}

describe("StartDocumentsView", () => {
  it("opens local note references inside the same library and edits the selected document", async () => {
    const parent = note("parent", {
      title: "求职准备",
      markdown: "继续看[产品故事](leemo-note://story)",
    });
    const story = note("story", { title: "产品故事", parentId: parent.id });
    const { client, updateNote } = captureClient([parent, story]);
    render(<BridgeProvider capture={client}><StartDocumentsView selectedNoteId={parent.id} /></BridgeProvider>);

    await userEvent.click(await screen.findByRole("link", { name: /产品故事/ }));
    expect(screen.getByDisplayValue("产品故事")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "编辑文档" }));
    const title = screen.getByRole("textbox", { name: "文档标题" });
    await userEvent.clear(title);
    await userEvent.type(title, "产品故事 v2");
    await userEvent.click(screen.getByRole("button", { name: "保存文档" }));

    await waitFor(() => expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({
      id: story.id,
      title: "产品故事 v2",
    })));
  });

  it("inserts a stable reference from the @ menu and shows backlinks", async () => {
    const source = note("source", { title: "来源", markdown: "[目标](leemo-note://target)" });
    const target = note("target", { title: "目标" });
    const { client } = captureClient([source, target]);
    render(<BridgeProvider capture={client}><StartDocumentsView selectedNoteId={target.id} /></BridgeProvider>);

    expect(await screen.findByRole("button", { name: /来源/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "编辑文档" }));
    await userEvent.click(screen.getByRole("button", { name: "引用便签" }));
    await userEvent.click(screen.getByRole("option", { name: /来源/ }));
    expect(screen.getByRole("textbox", { name: "便签正文" })).toHaveTextContent("来源");
  });
});
