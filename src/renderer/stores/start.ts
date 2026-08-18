import { createStore, type StoreApi } from "zustand/vanilla";
import { isStartDestination, type StartDestination } from "../start/start-navigation";

export interface StartSelection {
  taskId?: string | null;
  noteId?: string | null;
}

export interface StartState {
  destination: StartDestination;
  selectedTaskId: string | null;
  selectedNoteId: string | null;
  sidebarOpen: boolean;
  open(destination: StartDestination, selection?: StartSelection): void;
  toggleSidebar(): void;
  closeSidebar(): void;
}

export function createStartStore(): StoreApi<StartState> {
  return createStore<StartState>((set) => ({
    destination: "home",
    selectedTaskId: null,
    selectedNoteId: null,
    sidebarOpen: false,
    open: (destination, selection = {}) => {
      if (!isStartDestination(destination)) return;
      set({
        destination,
        selectedTaskId: selection.taskId ?? null,
        selectedNoteId: selection.noteId ?? null,
        sidebarOpen: false,
      });
    },
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    closeSidebar: () => set({ sidebarOpen: false }),
  }));
}
