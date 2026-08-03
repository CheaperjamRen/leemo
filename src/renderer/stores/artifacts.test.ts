import { describe, expect, it } from "vitest";
import {
  LEEMO_DOCUMENT_CREATE_TOOL_NAMES,
  LEEMO_VISUALIZATION_TOOL_NAME,
  createArtifactsStore,
  deriveArtifact,
  deriveArtifactsFromConversations,
  type ArtifactEntry,
} from "./artifacts";
import type { TimelineItem } from "./message-model";

const books = [
  { id: "math", title: "数学", color: "blue" as const, isSample: true },
  { id: "writing", title: "写作", color: "green" as const, isSample: false },
];

function tool(overrides: Partial<Extract<TimelineItem, { kind: "tool" }>> = {}): Extract<TimelineItem, { kind: "tool" }> {
  return {
    kind: "tool", id: "timeline-1", runId: "run-1", toolUseId: "tool-1", name: "Write",
    input: { file_path: "math/notes.md" }, status: "ok", ...overrides,
  };
}

function ctx(overrides: Partial<{ conversationId: string; runId: string; books: typeof books; now: number; workspaceRoot?: string; workspaceId?: string; bookId?: string | null }> = {}) {
  return { conversationId: "conv-1", runId: "run-1", books, now: 100, workspaceRoot: "C:\\Users\\me\\Leemo", ...overrides };
}

describe("deriveArtifact", () => {
  it("returns null for running, error, missing path, and empty path", () => {
    expect(deriveArtifact(tool({ status: "running" }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ status: "error" }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ input: {} }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ input: { file_path: 42 } }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ input: { file_path: "  " } }), ctx())).toBeNull();
  });

  it("requires file_path for terminal Write and Edit, while visualization accepts file, file_path, or path", () => {
    expect(deriveArtifact(tool({ input: { path: "math/write.md" } }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ name: "Edit", input: { path: "math/edit.md" } }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ name: LEEMO_VISUALIZATION_TOOL_NAME, input: { path: "math/viz.html" } }), ctx())).toMatchObject({ kind: "visualization", path: "math/viz.html" });
    expect(deriveArtifact(tool({ name: LEEMO_VISUALIZATION_TOOL_NAME, input: { file: "math/viz-file.html" } }), ctx())).toMatchObject({ kind: "visualization", path: "math/viz-file.html" });
  });
  it("derives a Write artifact with title, book and stable metadata", () => {
    expect(deriveArtifact(tool(), ctx())).toEqual({
      id: "conv-1:tool-1", kind: "file", path: "math/notes.md", title: "notes.md", bookId: "math",
      sourceConversationId: "conv-1", sourceRunId: "run-1", createdAt: 100, escaped: false,
    });
  });

  it("recognizes Edit as a file artifact even without a previous Write", () => {
    expect(deriveArtifact(tool({ name: "Edit", toolUseId: "edit-1", input: { file_path: "writing/draft.md" } }), ctx())).toMatchObject({
      id: "conv-1:edit-1", kind: "file", path: "writing/draft.md", title: "draft.md", bookId: "writing", escaped: false,
    });
  });

  it("falls back to a non-empty visualization path when file_path is blank", () => {
    expect(deriveArtifact(tool({ name: LEEMO_VISUALIZATION_TOOL_NAME, input: { file_path: "  ", path: "math/chart.html" } }), ctx())).toMatchObject({
      kind: "visualization", path: "math/chart.html", title: "chart.html", bookId: "math",
    });
    expect(deriveArtifact(tool({ input: { file_path: "  ", path: "math/write.md" } }), ctx())).toBeNull();
    expect(deriveArtifact(tool({ name: "Edit", input: { file_path: "  ", path: "math/edit.md" } }), ctx())).toBeNull();
  });

  it("uses the one visualization tool constant and reads path fields, never HTML", () => {
    expect(deriveArtifact(tool({ name: LEEMO_VISUALIZATION_TOOL_NAME, toolUseId: "viz-1", input: { path: "writing/chart.html", html: "<html>not-a-path</html>" } }), ctx())).toMatchObject({
      id: "conv-1:viz-1", kind: "visualization", path: "writing/chart.html", title: "chart.html", bookId: "writing",
    });
    expect(deriveArtifact(tool({ name: LEEMO_VISUALIZATION_TOOL_NAME, input: { html: "<html>not-a-path</html>" } }), ctx())).toBeNull();
  });

  it("projects a root visualization into the same default workspace used by its host tool", () => {
    expect(deriveArtifact(tool({
      name: LEEMO_VISUALIZATION_TOOL_NAME,
      input: { file_path: "英语学习/本周进度.html" },
    }), ctx({ bookId: null }))).toMatchObject({
      kind: "visualization",
      path: "默认工作区/英语学习/本周进度.html",
      escaped: false,
    });
  });

  it("resolves traversal before containment and keeps outside paths escaped", () => {
    expect(deriveArtifact(tool({ input: { file_path: "C:\\Users\\me\\Leemo\\..\\outside.md" } }), ctx())).toMatchObject({
      path: "C:/Users/me/outside.md", escaped: true, bookId: null,
    });
    expect(deriveArtifact(tool({ input: { file_path: "/workspace/Leemo/../outside.md" }, toolUseId: "unix-outside" }), ctx())).toMatchObject({
      path: "/workspace/outside.md", escaped: true, bookId: null,
    });
  });

  it("preserves lexical identities for safe and escaped relative paths", () => {
    const safe = deriveArtifact(tool({ input: { file_path: "outside.md" }, toolUseId: "safe" }), ctx());
    const escaped = deriveArtifact(tool({ input: { file_path: "../outside.md" }, toolUseId: "escaped" }), ctx());
    const equivalent = deriveArtifact(tool({ input: { file_path: "a/../../outside.md" }, toolUseId: "equivalent" }), ctx());

    expect(safe).toMatchObject({ path: "outside.md", escaped: false, bookId: null });
    expect(escaped).toMatchObject({ path: "../outside.md", escaped: true, bookId: null });
    expect(equivalent).toMatchObject({ path: "../outside.md", escaped: true, bookId: null });

    const store = createArtifactsStore();
    store.getState().registerArtifact(safe!);
    store.getState().registerArtifact(escaped!);
    expect(store.getState().entries.map((entry) => [entry.path, entry.escaped])).toEqual([
      ["../outside.md", true],
      ["outside.md", false],
    ]);
  });

  it("matches a notebook only at the normalized path prefix", () => {
    expect(deriveArtifact(tool({ input: { file_path: "exports/math/notes.md" } }), ctx())).toMatchObject({ bookId: null });
    expect(deriveArtifact(tool({ input: { file_path: "math/exports/notes.md" }, toolUseId: "nested" }), ctx())).toMatchObject({ bookId: "math" });
  });
  it("normalizes workspace absolute paths and marks outside paths escaped", () => {
    expect(deriveArtifact(tool({ input: { file_path: "C:\\Users\\me\\Leemo\\math\\win.md" } }), ctx())).toMatchObject({
      path: "math/win.md", title: "win.md", bookId: "math", escaped: false,
    });
    expect(deriveArtifact(tool({ input: { file_path: "/tmp/outside.md" }, toolUseId: "outside" }), ctx())).toMatchObject({
      path: "/tmp/outside.md", title: "outside.md", bookId: null, escaped: true,
    });
    expect(deriveArtifact(tool({ input: { file_path: "writing\\unix.md" }, toolUseId: "separators" }), ctx())).toMatchObject({
      path: "writing/unix.md", title: "unix.md", bookId: "writing", escaped: false,
    });
  });

  it("uses lexical workspace containment for Windows and POSIX roots", () => {
    expect(deriveArtifact(tool({ input: { file_path: "C:\\Users\\me\\Leemo\\math\\inside.md" } }), ctx())).toMatchObject({
      path: "math/inside.md", escaped: false, bookId: "math",
    });
    expect(deriveArtifact(tool({ input: { file_path: "C:\\Users\\me\\Leemo\\..\\outside.md" }, toolUseId: "win-escape" }), ctx())).toMatchObject({
      path: "C:/Users/me/outside.md", escaped: true, bookId: null,
    });
    expect(deriveArtifact(tool({ input: { file_path: "/home/me/Leemo/math/inside.md" }, toolUseId: "posix-inside" }), ctx({ workspaceRoot: "/home/me/Leemo" }))).toMatchObject({
      path: "math/inside.md", escaped: false, bookId: "math",
    });
    expect(deriveArtifact(tool({ input: { file_path: "/tmp/Leemo/math/outside.md" }, toolUseId: "posix-outside" }), ctx({ workspaceRoot: "/home/me/Leemo" }))).toMatchObject({
      path: "/tmp/Leemo/math/outside.md", escaped: true, bookId: null,
    });
  });

  it("keeps absolute identity conservative when workspaceRoot is absent", () => {
    expect(deriveArtifact(tool({ input: { file_path: "/home/me/Leemo/math/notes.md" }, toolUseId: "no-root" }), ctx({ workspaceRoot: undefined }))).toMatchObject({
      path: "/home/me/Leemo/math/notes.md", escaped: true, bookId: null,
    });
  });

  it("keeps UNC paths distinct from POSIX paths", () => {
    const unc = deriveArtifact(tool({ input: { file_path: "\\\\server\\share\\outside.md" }, toolUseId: "unc" }), ctx({ workspaceRoot: "\\\\server\\share\\Leemo" }));
    const posix = deriveArtifact(tool({ input: { file_path: "/server/share/outside.md" }, toolUseId: "posix" }), ctx({ workspaceRoot: "/server/share/Leemo" }));
    expect(unc).toMatchObject({ path: "//server/share/outside.md", escaped: true, bookId: null });
    expect(posix).toMatchObject({ path: "/server/share/outside.md", escaped: true, bookId: null });
    const store = createArtifactsStore();
    store.getState().registerArtifact(unc!);
    store.getState().registerArtifact(posix!);
    expect(store.getState().entries).toHaveLength(2);
  });

  it("does not mutate the item, context or books", () => {
    const item = tool(); const context = ctx();
    const beforeItem = structuredClone(item); const beforeContext = structuredClone(context);
    deriveArtifact(item, context);
    expect(item).toEqual(beforeItem); expect(context).toEqual(beforeContext);
  });

  it("handles root directory as file_path returning . instead of empty path", () => {
    expect(deriveArtifact(tool({ input: { file_path: "C:\\Users\\me\\Leemo" } }), ctx())).toMatchObject({
      path: ".", title: ".", escaped: false, bookId: null,
    });
    expect(deriveArtifact(tool({ input: { file_path: "/home/me/Leemo" }, toolUseId: "posix-root" }), ctx({ workspaceRoot: "/home/me/Leemo" }))).toMatchObject({
      path: ".", title: ".", escaped: false, bookId: null,
    });
  });

  it("handles workspaceRoot with trailing slash correctly", () => {
    expect(deriveArtifact(tool({ input: { file_path: "C:\\Users\\me\\Leemo\\math\\x.md" }, toolUseId: "trailing-backslash" }), ctx({ workspaceRoot: "C:\\Users\\me\\Leemo\\" }))).toMatchObject({
      path: "math/x.md", escaped: false, bookId: "math",
    });
    expect(deriveArtifact(tool({ input: { file_path: "/home/me/Leemo/math/y.md" }, toolUseId: "trailing-slash" }), ctx({ workspaceRoot: "/home/me/Leemo/" }))).toMatchObject({
      path: "math/y.md", escaped: false, bookId: "math",
    });
  });

  it("collects files created by Leemo document tools but never treats a read as a new artifact", () => {
    const expected = [
      [LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createWord, "默认工作区/周报.docx"],
      [LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createPresentation, "默认工作区/复盘.pptx"],
      [LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createSpreadsheet, "默认工作区/计划.xlsx"],
    ] as const;

    for (const [name, filePath] of expected) {
      expect(deriveArtifact(tool({ name, input: { file_path: filePath } }), ctx())).toMatchObject({
        kind: "file",
        path: filePath,
        title: filePath.split("/").at(-1),
        escaped: false,
      });
    }
    expect(deriveArtifact(tool({
      name: "mcp__leemo-documents__read_document",
      input: { file_path: "默认工作区/周报.docx" },
    }), ctx())).toBeNull();
  });

  it("indexes the Word edit output copy, not the source document", () => {
    expect(deriveArtifact(tool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.editWord,
      input: { file_path: "默认工作区/简历.docx" },
    }), ctx())).toMatchObject({
      path: "默认工作区/简历-修改版.docx",
      title: "简历-修改版.docx",
    });
    expect(deriveArtifact(tool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.editWord,
      input: { file_path: "默认工作区/简历.docx", output_path: "默认工作区/简历-v2.docx" },
    }), ctx())).toMatchObject({ path: "默认工作区/简历-v2.docx" });
  });

  it("projects creator paths through the conversation workspace instead of indexing the model's stale input", () => {
    expect(deriveArtifact(tool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createWord,
      input: { file_path: "周报.docx" },
    }), ctx({ bookId: null }))).toMatchObject({
      path: "默认工作区/周报.docx",
      bookId: null,
      escaped: false,
    });
    expect(deriveArtifact(tool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createPresentation,
      input: { file_path: "默认工作区/复盘.pptx" },
    }), ctx({ bookId: null }))).toMatchObject({ path: "默认工作区/复盘.pptx" });
    expect(deriveArtifact(tool({ input: { file_path: "讲义.md" } }), ctx({ bookId: "math" })))
      .toMatchObject({ path: "math/讲义.md", bookId: "math" });
    expect(deriveArtifact(tool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createSpreadsheet,
      input: { file_path: "计划.xlsx" },
    }), ctx({ bookId: null, workspaceId: "workspace-project" })))
      .toMatchObject({ path: "计划.xlsx", bookId: null });
  });

  it("keeps an explicit absolute path at its real workspace-relative location", () => {
    expect(deriveArtifact(tool({
      name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createWord,
      input: { file_path: "C:\\Users\\me\\Leemo\\根目录报告.docx" },
    }), ctx({ bookId: null }))).toMatchObject({
      path: "根目录报告.docx",
      bookId: null,
      escaped: false,
    });
  });

  it("keeps the originating workspace on the artifact", () => {
    expect(deriveArtifact(tool(), ctx({ workspaceId: "workspace-project" }))).toMatchObject({
      workspaceId: "workspace-project",
    });
  });
});

describe("deriveArtifactsFromConversations", () => {
  const finished = (runId: string, createdAt: number): TimelineItem => ({
    kind: "result",
    id: `result-${runId}`,
    runId,
    isError: false,
    interrupted: false,
    finalText: "完成",
    pathAudit: { claimed: [] },
    createdAt,
  });

  it("rebuilds successful files and visualizations, ignores failures, and keeps the latest entry per path", () => {
    const conversations = [
      {
        meta: { id: "conv-new", lastActivityAt: 500 },
        timeline: [
          tool({ runId: "run-new", toolUseId: "write-new", input: { file_path: "math/shared.md" } }),
          finished("run-new", 480),
          tool({
            runId: "run-viz",
            toolUseId: "viz-file",
            name: LEEMO_VISUALIZATION_TOOL_NAME,
            input: { file: "writing/overview.html" },
          }),
          finished("run-viz", 490),
          tool({ runId: "run-failed", toolUseId: "failed", status: "error", input: { file_path: "math/failed.md" } }),
          finished("run-failed", 495),
        ],
      },
      {
        meta: { id: "conv-old", lastActivityAt: 200 },
        timeline: [
          tool({ runId: "run-old", toolUseId: "write-old", input: { file_path: "math/shared.md" } }),
          finished("run-old", 180),
          tool({ runId: "run-outside", toolUseId: "outside", input: { file_path: "C:\\Temp\\outside.md" } }),
          finished("run-outside", 190),
        ],
      },
    ];

    const entries = deriveArtifactsFromConversations(conversations, {
      books,
      workspaceRoot: "C:\\Users\\me\\Leemo",
    });

    expect(entries.map((entry) => entry.id)).toEqual([
      "conv-new:viz-file",
      "conv-new:write-new",
      "conv-old:outside",
    ]);
    expect(entries[0]).toMatchObject({
      kind: "visualization",
      path: "writing/overview.html",
      sourceConversationId: "conv-new",
      sourceRunId: "run-viz",
      createdAt: 490,
    });
    expect(entries[1]).toMatchObject({
      path: "math/shared.md",
      sourceConversationId: "conv-new",
      sourceRunId: "run-new",
    });
    expect(entries[2]).toMatchObject({
      path: "C:/Temp/outside.md",
      escaped: true,
      bookId: null,
    });
    expect(entries.some((entry) => entry.path === "math/failed.md")).toBe(false);
  });

  it("falls back to conversation activity time when an older timeline has no result timestamp", () => {
    const entries = deriveArtifactsFromConversations([{
      meta: { id: "legacy", lastActivityAt: 321 },
      timeline: [tool({ runId: "legacy-run", toolUseId: "legacy-write" })],
    }], { books, workspaceRoot: "C:\\Users\\me\\Leemo" });

    expect(entries[0]).toMatchObject({ createdAt: 321, sourceRunId: "legacy-run" });
  });

  it("restores a root document artifact into 默认工作区 from conversation scope", () => {
    const entries = deriveArtifactsFromConversations([{
      meta: { id: "root-doc", lastActivityAt: 321, bookId: null },
      timeline: [tool({
        name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.createWord,
        toolUseId: "doc-root",
        input: { file_path: "周报.docx" },
      })],
    }], { books, workspaceRoot: "C:\\Users\\me\\Leemo" });

    expect(entries).toEqual([
      expect.objectContaining({ path: "默认工作区/周报.docx", bookId: null }),
    ]);
  });

  it("restores a default-named Word edit copy without replacing the source in成果", () => {
    const entries = deriveArtifactsFromConversations([{
      meta: { id: "word-edit", lastActivityAt: 330, bookId: null },
      timeline: [tool({
        name: LEEMO_DOCUMENT_CREATE_TOOL_NAMES.editWord,
        toolUseId: "word-edit-copy",
        input: { file_path: "默认工作区/简历.docx", replacements: [{ find: "旧", replace: "新" }] },
      })],
    }], { books, workspaceRoot: "C:\\Users\\me\\Leemo" });
    expect(entries).toEqual([
      expect.objectContaining({ path: "默认工作区/简历-修改版.docx", title: "简历-修改版.docx" }),
    ]);
  });

  it("rebuilds files written by a subagent from its persisted activity tools", () => {
    const entries = deriveArtifactsFromConversations([{
      meta: { id: "conv-agent", lastActivityAt: 410 },
      timeline: [{
        kind: "activity",
        id: "activity-1",
        runId: "run-agent",
        parentToolUseId: "agent-1",
        childToolUseIds: ["child-write"],
        tools: [{
          toolUseId: "child-write",
          name: "Write",
          input: { file_path: "math/subagent.md" },
          status: "ok",
          summary: "written",
        }],
        transcript: [],
      }],
    }], { books, workspaceRoot: "C:\\Users\\me\\Leemo" });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "conv-agent:child-write",
        path: "math/subagent.md",
        sourceRunId: "run-agent",
      }),
    ]);
  });

  it("normalizes each restored artifact against its own workspace root", () => {
    const entries = deriveArtifactsFromConversations([
      {
        meta: { id: "conv-home", lastActivityAt: 100 },
        timeline: [tool({ toolUseId: "home-write", input: { file_path: "C:\\Users\\me\\Leemo\\README.md" } })],
      },
      {
        meta: { id: "conv-project", lastActivityAt: 200, workspaceId: "workspace-project" },
        timeline: [tool({ toolUseId: "project-write", input: { file_path: "D:\\Projects\\demo\\README.md" } })],
      },
    ], {
      books,
      workspaceRoot: "C:\\Users\\me\\Leemo",
      resolveWorkspaceRoot: (workspaceId) => workspaceId === "workspace-project"
        ? "D:\\Projects\\demo"
        : "C:\\Users\\me\\Leemo",
    });

    expect(entries).toEqual([
      expect.objectContaining({
        id: "conv-project:project-write",
        workspaceId: "workspace-project",
        path: "README.md",
        escaped: false,
      }),
      expect.objectContaining({
        id: "conv-home:home-write",
        path: "README.md",
        escaped: false,
      }),
    ]);
  });
});

describe("artifacts store", () => {
  const entry = (id: string, path: string, createdAt: number): ArtifactEntry => ({
    id, kind: "file", path, title: path.split("/").pop() ?? path, bookId: "math",
    sourceConversationId: "conv-1", sourceRunId: "run-1", createdAt, escaped: false,
  });

  it("starts empty and upserts the same id without duplicates", () => {
    const store = createArtifactsStore([entry("old", "math/old.md", 1)]);
    store.getState().registerArtifact(entry("new", "math/new.md", 2));
    store.getState().registerArtifact(entry("old", "math/old.md", 3));
    expect(store.getState().entries.map((e) => e.id)).toEqual(["old", "new"]);
    expect(store.getState().entries[0].createdAt).toBe(3);
  });

  it("replaces an older artifact for the same book/path while keeping newest-first order", () => {
    const store = createArtifactsStore([entry("old", "math/notes.md", 1), entry("other", "math/other.md", 0)]);
    store.getState().registerArtifact(entry("edit", "math/notes.md", 5));
    expect(store.getState().entries.map((e) => e.id)).toEqual(["edit", "other"]);
    store.getState().removeArtifact("edit");
    expect(store.getState().entries.map((e) => e.id)).toEqual(["other"]);
    store.getState().removeArtifact("missing");
    expect(store.getState().entries.map((e) => e.id)).toEqual(["other"]);
  });

  it("exposes loading, ready, and error hydration states while de-duplicating restored entries", () => {
    const store = createArtifactsStore();
    store.getState().beginHydration();
    expect(store.getState()).toMatchObject({ status: "loading", error: null });

    store.getState().hydrate([
      entry("older", "math/notes.md", 1),
      entry("newer", "math/notes.md", 2),
      entry("other", "math/other.md", 3),
    ]);
    expect(store.getState()).toMatchObject({ status: "ready", error: null });
    expect(store.getState().entries.map((item) => item.id)).toEqual(["other", "newer"]);

    store.getState().beginHydration();
    store.getState().failHydration("成果记录恢复失败");
    expect(store.getState()).toMatchObject({ status: "error", error: "成果记录恢复失败" });
  });

  it("does not collapse the same relative path across workspaces", () => {
    const store = createArtifactsStore();
    store.getState().registerArtifact({ ...entry("home", "README.md", 1), bookId: null });
    store.getState().registerArtifact({
      ...entry("project", "README.md", 2),
      bookId: null,
      workspaceId: "workspace-project",
    });

    expect(store.getState().entries.map((item) => item.id)).toEqual(["project", "home"]);
  });
});
