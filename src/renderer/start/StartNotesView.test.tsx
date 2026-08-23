import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../captures";
import type { CaptureClient } from "../capture/client";
import { BridgeProvider } from "../bridge/context";
import StartNotesView from "./StartNotesView";

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
    organizedAt: null,
    ...overrides,
  };
}

function client(notes: Note[]): CaptureClient {
  return {
    getQuickDraft: vi.fn(), saveQuickDraft: vi.fn(), commitQuickDraft: vi.fn(),
    listNotes: vi.fn(async () => notes), listArchivedNotes: vi.fn(async () => []),
    createNote: vi.fn(), updateNote: vi.fn(), moveNote: vi.fn(), setNotePinned: vi.fn(),
    markNoteOrganized: vi.fn(), archiveNote: vi.fn(), unarchiveNote: vi.fn(), deleteNote: vi.fn(),
    attachImageBytes: vi.fn(), attachExternalFile: vi.fn(), attachFileCopy: vi.fn(), previewAttachment: vi.fn(), openAttachment: vi.fn(), revealAttachment: vi.fn(), removeAttachment: vi.fn(),
    migrateStorageRoot: vi.fn(), onChanged: vi.fn(() => vi.fn()),
  };
}

describe("StartNotesView", () => {
  it("shows only unorganized notes in Inbox with ordinary user-facing copy", async () => {
    const loose = note("loose", { title: "临时灵感" });
    const organized = note("organized", { title: "项目文档", organizedAt: 200 });
    render(<BridgeProvider capture={client([loose, organized])}><StartNotesView destination="inbox" /></BridgeProvider>);

    const list = await screen.findByRole("region", { name: "收集箱" });
    expect(within(list).getByText("临时灵感")).toBeInTheDocument();
    expect(within(list).queryByText("项目文档")).not.toBeInTheDocument();
    expect(screen.getByText("尚未归入文档树的随手记录。")).toBeInTheDocument();
    expect(screen.queryByText(/自动触发 AI/)).not.toBeInTheDocument();
  });

  it("projects pinned notes instead of showing a future-engineering placeholder", async () => {
    const pinned = note("pinned", { title: "求职主线", pinnedAt: 300, organizedAt: 200 });
    const ordinary = note("ordinary", { title: "普通记录", organizedAt: 200 });
    render(<BridgeProvider capture={client([pinned, ordinary])}><StartNotesView destination="pinned" /></BridgeProvider>);

    const list = await screen.findByRole("region", { name: "置顶" });
    expect(within(list).getByText("求职主线")).toBeInTheDocument();
    expect(within(list).queryByText("普通记录")).not.toBeInTheDocument();
    expect(screen.queryByText(/能力接通后|工程卡/)).not.toBeInTheDocument();
  });
});
