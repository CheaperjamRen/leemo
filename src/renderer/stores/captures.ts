import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  ArchiveNoteInput,
  CreateNoteInput,
  DeleteNoteInput,
  MarkNoteOrganizedInput,
  MoveNoteInput,
  Note,
  SetNotePinnedInput,
  UnarchiveNoteInput,
  UpdateNoteInput,
} from "../../captures";
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
  moveNote(input: MoveNoteInput): Promise<Note[]>;
  setNotePinned(input: SetNotePinnedInput): Promise<Note>;
  markNoteOrganized(input: MarkNoteOrganizedInput): Promise<Note>;
  deleteNote(input: DeleteNoteInput): Promise<Note[]>;
  archiveNote(input: ArchiveNoteInput): Promise<Note[]>;
  unarchiveNote(input: UnarchiveNoteInput): Promise<Note[]>;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newestFirst(notes: Note[], note: Note): Note[] {
  return [note, ...notes.filter((candidate) => candidate.id !== note.id)];
}

function mergeNoteSnapshot(notes: Note[], snapshot: readonly Note[]): Note[] {
  const replacements = new Map(snapshot.map((note) => [note.id, note]));
  const merged = notes.map((note) => replacements.get(note.id) ?? note);
  for (const note of snapshot) {
    if (!notes.some((candidate) => candidate.id === note.id)) merged.push(note);
  }
  return merged;
}

function replaceNote(notes: Note[], replacement: Note): Note[] {
  return notes.map((note) => note.id === replacement.id ? replacement : note);
}

function applyTreeMutation(notes: Note[], archivedNotes: Note[], affected: readonly Note[]) {
  const ids = new Set(affected.map((note) => note.id));
  const active = affected.filter((note) => note.deletedAt === undefined && note.archivedAt === undefined);
  const archived = affected.filter((note) => note.deletedAt === undefined && note.archivedAt !== undefined);
  return {
    notes: mergeNoteSnapshot(notes.filter((note) => !ids.has(note.id)), active),
    archivedNotes: mergeNoteSnapshot(archivedNotes.filter((note) => !ids.has(note.id)), archived),
  };
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

    moveNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const affected = await requireClient().moveNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: mergeNoteSnapshot(state.notes, affected),
          archivedNotes: mergeNoteSnapshot(state.archivedNotes, affected),
          status: "ready",
          saving: false,
          error: null,
        }));
        return affected;
      } catch (error: unknown) {
        set({ saving: false, error: messageFor(error) });
        throw error;
      }
    },

    setNotePinned: async (input) => {
      set({ saving: true, error: null });
      try {
        const note = await requireClient().setNotePinned(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: replaceNote(state.notes, note),
          archivedNotes: replaceNote(state.archivedNotes, note),
          status: "ready",
          saving: false,
          error: null,
        }));
        return note;
      } catch (error: unknown) {
        set({ saving: false, error: messageFor(error) });
        throw error;
      }
    },

    markNoteOrganized: async (input) => {
      set({ saving: true, error: null });
      try {
        const note = await requireClient().markNoteOrganized(input);
        latestRefreshRequest += 1;
        set((state) => ({
          notes: replaceNote(state.notes, note),
          archivedNotes: replaceNote(state.archivedNotes, note),
          status: "ready",
          saving: false,
          error: null,
        }));
        return note;
      } catch (error: unknown) {
        set({ saving: false, error: messageFor(error) });
        throw error;
      }
    },

    deleteNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const affected = await requireClient().deleteNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          ...applyTreeMutation(state.notes, state.archivedNotes, affected),
          selectedId: affected.some((note) => note.deletedAt !== undefined && note.id === state.selectedId) ? null : state.selectedId,
          status: "ready",
          saving: false,
          error: null,
        }));
        return affected;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },

    archiveNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const affected = await requireClient().archiveNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          ...applyTreeMutation(state.notes, state.archivedNotes, affected),
          selectedId: input.id,
          status: "ready",
          saving: false,
          error: null,
        }));
        return affected;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },

    unarchiveNote: async (input) => {
      set({ saving: true, error: null });
      try {
        const affected = await requireClient().unarchiveNote(input);
        latestRefreshRequest += 1;
        set((state) => ({
          ...applyTreeMutation(state.notes, state.archivedNotes, affected),
          selectedId: input.id,
          status: "ready",
          saving: false,
          error: null,
        }));
        return affected;
      } catch (error: unknown) {
        const message = messageFor(error);
        set({ saving: false, error: message });
        throw error;
      }
    },
  }));

  return store;
}
