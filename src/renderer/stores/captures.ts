import { createStore, type StoreApi } from "zustand/vanilla";
import type { ArchiveNoteInput, CreateNoteInput, DeleteNoteInput, Note, UnarchiveNoteInput, UpdateNoteInput } from "../../captures";
import type { CaptureClient } from "../capture/client";

export type CapturesStatus = "idle" | "loading" | "ready" | "error";

export interface CapturesState {
  notes: Note[];
  archivedNotes: Note[];
  status: CapturesStatus;
  error: string | null;
  saving: boolean;
  selectedId: string | null;
  refresh(): Promise<void>;
  selectNote(id: string | null): void;
  createNote(input: CreateNoteInput): Promise<Note>;
  updateNote(input: UpdateNoteInput): Promise<Note>;
  deleteNote(input: DeleteNoteInput): Promise<void>;
  archiveNote(input: ArchiveNoteInput): Promise<Note>;
  unarchiveNote(input: UnarchiveNoteInput): Promise<Note>;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newestFirst(notes: Note[], note: Note): Note[] {
  return [note, ...notes.filter((candidate) => candidate.id !== note.id)];
}

const NO_CAPTURE_CLIENT = "此环境未连接本地便签。";

export function createCapturesStore(client?: CaptureClient): StoreApi<CapturesState> {
  let latestRefreshRequest = 0;
  const requireClient = (): CaptureClient => {
    if (client) return client;
    const error = new Error(NO_CAPTURE_CLIENT);
    store.setState({ error: error.message, saving: false });
    throw error;
  };

  const store = createStore<CapturesState>((set) => ({
    notes: [],
    archivedNotes: [],
    status: client ? "idle" : "ready",
    error: null,
    saving: false,
    selectedId: null,

    refresh: async () => {
      if (!client) {
        set({ notes: [], archivedNotes: [], status: "ready", error: null });
        return;
      }
      const requestId = ++latestRefreshRequest;
      set({ status: "loading", error: null });
      try {
        const [notes, archivedNotes] = await Promise.all([client.listNotes(), client.listArchivedNotes()]);
        if (requestId !== latestRefreshRequest) return;
        set({ notes, archivedNotes, status: "ready", error: null });
      } catch (error: unknown) {
        if (requestId !== latestRefreshRequest) return;
        set({ status: "error", error: messageFor(error) });
      }
    },

    selectNote: (selectedId) => set({ selectedId, error: null }),

    createNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const note = await requireClient().createNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: newestFirst(state.notes, note),
          selectedId: note.id,
          status: "ready",
          saving: false,
          error: null,
        }));
        return note;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },

    updateNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const note = await requireClient().updateNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: newestFirst(state.notes, note),
          selectedId: note.id,
          status: "ready",
          saving: false,
          error: null,
        }));
        return note;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },

    deleteNote: async (input) => {
      set({ saving: true, error: null });
      try {
        await requireClient().deleteNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: state.notes.filter((candidate) => candidate.id !== input.id),
          archivedNotes: state.archivedNotes.filter((candidate) => candidate.id !== input.id),
          selectedId: state.selectedId === input.id ? null : state.selectedId,
          status: "ready",
          saving: false,
          error: null,
        }));
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },

    archiveNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const note = await requireClient().archiveNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: state.notes.filter((candidate) => candidate.id !== note.id),
          archivedNotes: newestFirst(state.archivedNotes, note),
          selectedId: note.id,
          status: "ready",
          saving: false,
          error: null,
        }));
        return note;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },

    unarchiveNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const note = await requireClient().unarchiveNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: newestFirst(state.notes, note),
          archivedNotes: state.archivedNotes.filter((candidate) => candidate.id !== note.id),
          selectedId: note.id,
          status: "ready",
          saving: false,
          error: null,
        }));
        return note;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },
  }));

  return store;
}
