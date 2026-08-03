import { describe, expect, it } from "vitest";
import {
  createWorkspaceChangeTracker,
  type WorkspaceChangeTrackerIO,
} from "../../src/host/workspace-change-tracker";

function fakeIO(initial: string[]) {
  let files = [...initial];
  let notify: ((filename: string | Buffer | null) => void) | undefined;
  let closed = false;
  const io: WorkspaceChangeTrackerIO = {
    snapshot: async () => ({ files: [...files], complete: true }),
    watch: (_root, onPath) => {
      notify = onPath;
      return { close: () => { closed = true; } };
    },
    settle: async () => {},
  };
  return {
    io,
    replaceFiles(next: string[]) { files = [...next]; },
    touch(path: string) { notify?.(path); },
    get closed() { return closed; },
  };
}

describe("workspace change tracker", () => {
  it("returns only user-visible net file changes", async () => {
    const fake = fakeIO([
      "笔记.md",
      "旧稿.md",
      "memory/profile.md",
      ".leemo/memory/index.md",
      "node_modules/pkg/index.js",
    ]);
    const tracker = createWorkspaceChangeTracker("C:/Leemo", {
      io: fake.io,
      ignoreLegacyRootMemory: true,
    });
    await tracker.ready;

    fake.touch("笔记.md");
    fake.touch("新稿.md");
    fake.touch("临时.md");
    fake.touch("memory/profile.md");
    fake.touch(".leemo/memory/index.md");
    fake.replaceFiles([
      "笔记.md",
      "新稿.md",
      "memory/profile.md",
      ".leemo/memory/index.md",
      "node_modules/pkg/index.js",
    ]);

    await expect(tracker.finish()).resolves.toEqual({
      changes: [
        { path: "笔记.md", change: "modified" },
        { path: "新稿.md", change: "added" },
        { path: "旧稿.md", change: "deleted" },
      ],
      omitted: 0,
    });
    expect(fake.closed).toBe(true);
  });

  it("keeps a normal notebook memory folder visible when it is not the legacy root", async () => {
    const fake = fakeIO(["memory/lesson.md"]);
    const tracker = createWorkspaceChangeTracker("C:/Leemo/高等数学", {
      io: fake.io,
      ignoreLegacyRootMemory: false,
    });
    await tracker.ready;
    fake.touch("memory/lesson.md");

    await expect(tracker.finish()).resolves.toEqual({
      changes: [{ path: "memory/lesson.md", change: "modified" }],
      omitted: 0,
    });
  });

  it("caps large receipts without reporting a false exact count", async () => {
    const fake = fakeIO([]);
    const tracker = createWorkspaceChangeTracker("C:/Leemo", {
      io: fake.io,
      maxChanges: 2,
    });
    await tracker.ready;
    fake.replaceFiles(["a.md", "b.md", "c.md", "d.md"]);

    await expect(tracker.finish()).resolves.toEqual({
      changes: [
        { path: "a.md", change: "added" },
        { path: "b.md", change: "added" },
      ],
      omitted: 2,
    });
  });

  it("finishes idempotently so interrupt and stream cleanup cannot double-report", async () => {
    const fake = fakeIO(["报告.md"]);
    const tracker = createWorkspaceChangeTracker("C:/Leemo", { io: fake.io });
    await tracker.ready;
    fake.touch("报告.md");

    const first = tracker.finish();
    const second = tracker.finish();
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({
      changes: [{ path: "报告.md", change: "modified" }],
      omitted: 0,
    });
  });
});
