import { describe, expect, it, vi } from "vitest";
import type {
  CaptureChange,
  CommitQuickDraftInput,
  CreateNoteInput,
  DeleteNoteInput,
  MarkNoteOrganizedInput,
  MoveNoteInput,
  Note,
  QuickDraft,
  SaveQuickDraftInput,
  SetNotePinnedInput,
} from "../../captures";
import type { CreateTaskInput, UserTask } from "../../tasks";
import {
  IpcCaptureClient,
  IpcQuickCaptureClient,
  type LeemoCaptureApi,
  type LeemoQuickCaptureApi,
} from "./client";

const draft: QuickDraft = {
  id: "quick",
  mode: "note",
  title: "今天",
  markdown: "**先投一份**",
  plannedAt: null,
  dueAt: null,
  reminderAt: null,
  recurrence: null,
  revision: 3,
  updatedAt: 42,
};

const note: Note = {
  id: "note-1",
  title: draft.title,
  markdown: draft.markdown,
  revision: 1,
  createdAt: 43,
  updatedAt: 43,
  parentId: null,
  sortOrder: 0,
  pinnedAt: null,
  organizedAt: null,
};

const task: UserTask = {
  id: "task-1",
  title: "投递简历",
  details: "完善作品集",
  status: "open",
  plannedAt: null,
  dueAt: null,
  reminderAt: null,
  reminderOffsetMinutes: null,
  recurrence: null,
  notebookId: null,
  noteId: null,
  revision: 1,
  createdAt: 43,
  updatedAt: 43,
  completedAt: null,
};

describe("capture clients", () => {
  it("maps the main-window client to typed generic operations", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, response: draft })
      .mockResolvedValueOnce({ ok: true, response: [note] })
      .mockResolvedValueOnce({ ok: true, response: [note] });
    const api: LeemoCaptureApi = { invoke, onChanged: vi.fn(() => vi.fn()) };
    const client = new IpcCaptureClient(api);

    await expect(client.getQuickDraft()).resolves.toEqual(draft);
    await expect(client.listNotes()).resolves.toEqual([note]);
    await expect(client.listArchivedNotes()).resolves.toEqual([note]);
    expect(invoke).toHaveBeenNthCalledWith(1, "getQuickDraft", undefined);
    expect(invoke).toHaveBeenNthCalledWith(2, "listNotes", undefined);
    expect(invoke).toHaveBeenNthCalledWith(3, "listArchivedNotes", undefined);
  });

  it("keeps create and delete operations on the main-window client", async () => {
    const createInput: CreateNoteInput = { title: "新便签", markdown: "正文" };
    const deleteInput: DeleteNoteInput = { id: note.id, expectedRevision: 1 };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, response: note })
      .mockResolvedValueOnce({ ok: true });
    const client = new IpcCaptureClient({ invoke, onChanged: vi.fn(() => vi.fn()) });

    await expect(client.createNote(createInput)).resolves.toEqual(note);
    await expect(client.deleteNote(deleteInput)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenNthCalledWith(1, "createNote", createInput);
    expect(invoke).toHaveBeenNthCalledWith(2, "deleteNote", deleteInput);
  });

  it("forwards note organization operations through the main-window client", async () => {
    const moveInput: MoveNoteInput = {
      id: note.id,
      expectedRevision: note.revision,
      parentId: "parent-note",
      index: 0,
    };
    const pinInput: SetNotePinnedInput = { id: note.id, expectedRevision: 2, pinned: true };
    const organizedInput: MarkNoteOrganizedInput = { id: note.id, expectedRevision: 3, organized: true };
    const moved = { ...note, parentId: "parent-note", revision: 2 };
    const pinned = { ...moved, pinnedAt: 100, revision: 3 };
    const organized = { ...pinned, organizedAt: 200, revision: 4 };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, response: [moved] })
      .mockResolvedValueOnce({ ok: true, response: pinned })
      .mockResolvedValueOnce({ ok: true, response: organized });
    const client = new IpcCaptureClient({ invoke, onChanged: vi.fn(() => vi.fn()) });

    await expect(client.moveNote(moveInput)).resolves.toEqual([moved]);
    await expect(client.setNotePinned(pinInput)).resolves.toEqual(pinned);
    await expect(client.markNoteOrganized(organizedInput)).resolves.toEqual(organized);
    expect(invoke).toHaveBeenNthCalledWith(1, "moveNote", moveInput);
    expect(invoke).toHaveBeenNthCalledWith(2, "setNotePinned", pinInput);
    expect(invoke).toHaveBeenNthCalledWith(3, "markNoteOrganized", organizedInput);
  });

  it("uses only named methods in the quick window and forwards exact inputs", async () => {
    const saveInput: SaveQuickDraftInput = {
      mode: "note",
      title: draft.title,
      markdown: draft.markdown,
      expectedRevision: 2,
    };
    const commitInput: CommitQuickDraftInput = { expectedRevision: 3 };
    const taskInput: CreateTaskInput = { title: task.title, details: task.details };
    const api: LeemoQuickCaptureApi = {
      getQuickDraft: vi.fn().mockResolvedValue({ ok: true, response: draft }),
      saveQuickDraft: vi.fn().mockResolvedValue({ ok: true, response: draft }),
      commitQuickDraft: vi.fn().mockResolvedValue({ ok: true, response: note }),
      createTask: vi.fn().mockResolvedValue({ ok: true, response: task }),
      attachImageBytes: vi.fn().mockResolvedValue({ ok: true, response: note }),
      attachDroppedFile: vi.fn().mockResolvedValue({ ok: true, response: note }),
      pathForFile: vi.fn(() => "E:/resume.pdf"),
      hide: vi.fn(),
      onChanged: vi.fn(() => vi.fn()),
    };
    const client = new IpcQuickCaptureClient(api);

    await expect(client.getQuickDraft()).resolves.toEqual(draft);
    await expect(client.saveQuickDraft(saveInput)).resolves.toEqual(draft);
    await expect(client.commitQuickDraft(commitInput)).resolves.toEqual(note);
    await expect(client.createTask(taskInput)).resolves.toEqual(task);
    await client.hide();

    expect(api.saveQuickDraft).toHaveBeenCalledWith(saveInput);
    expect(api.commitQuickDraft).toHaveBeenCalledWith(commitInput);
    expect(api.createTask).toHaveBeenCalledWith(taskInput);
    expect(api.hide).toHaveBeenCalledOnce();
  });

  it("throws user-facing IPC errors and forwards change subscriptions", async () => {
    const onChanged = vi.fn();
    const unsubscribe = vi.fn();
    const api: LeemoCaptureApi = {
      invoke: vi.fn().mockResolvedValue({ ok: false, error: "内容已在别处更新，请刷新后重试。" }),
      onChanged: vi.fn((listener) => {
        onChanged.mockImplementation(listener);
        return unsubscribe;
      }),
    };
    const client = new IpcCaptureClient(api);
    const listener = vi.fn();
    const stop = client.onChanged(listener);
    const change: CaptureChange = {
      entity: "quickDraft",
      action: "saved",
      id: "quick",
      revision: 4,
    };

    onChanged(change);
    expect(listener).toHaveBeenCalledWith(change);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await expect(client.getQuickDraft()).rejects.toThrow("内容已在别处更新，请刷新后重试。");
  });
});
