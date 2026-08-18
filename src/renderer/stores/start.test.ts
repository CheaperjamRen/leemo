import { describe, expect, it } from "vitest";
import { createStartStore } from "./start";

describe("Start store", () => {
  it("opens destinations and preserves exact selected task/note targets", () => {
    const store = createStartStore();
    expect(store.getState()).toMatchObject({ destination: "home", selectedTaskId: null, selectedNoteId: null });

    store.getState().open("tasks", { taskId: "task-1" });
    expect(store.getState()).toMatchObject({ destination: "tasks", selectedTaskId: "task-1", selectedNoteId: null });

    store.getState().open("documents", { noteId: "note-1" });
    expect(store.getState()).toMatchObject({ destination: "documents", selectedTaskId: null, selectedNoteId: "note-1" });
  });
});
