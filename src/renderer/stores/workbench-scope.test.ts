import { describe, expect, it } from "vitest";
import { HOME_WORKSPACE_ID } from "./workspaces";
import {
  fileTabKey,
  scopeKeyForConversation,
  scopeKeyForSelection,
  sanitizeScopeSessions,
  type ScopeConversationRef,
} from "./workbench-scope";

describe("scopeKeyForSelection", () => {
  it("uses stable scope ids instead of display names or paths", () => {
    expect(scopeKeyForSelection({ kind: "global" })).toBe("global");
    expect(scopeKeyForSelection({ kind: "notebook", id: "高等数学" })).toBe("notebook:高等数学");
    expect(scopeKeyForSelection({ kind: "workspace", id: "workspace-2" })).toBe("workspace:workspace-2");
  });

  it("maps the existing workspace plus notebook selection to the user scopes", () => {
    expect(scopeKeyForSelection({ workspaceId: HOME_WORKSPACE_ID, notebookId: "高等数学" })).toBe(
      "notebook:高等数学",
    );
    expect(scopeKeyForSelection({ workspaceId: HOME_WORKSPACE_ID, notebookId: null })).toBe("global");
    expect(scopeKeyForSelection({ workspaceId: "workspace-2", notebookId: null })).toBe("workspace:workspace-2");
  });

  it("falls back to global for an incomplete selection", () => {
    expect(scopeKeyForSelection({ kind: "notebook", id: "   " })).toBe("global");
    expect(scopeKeyForSelection({ kind: "workspace", id: "" })).toBe("global");
    expect(scopeKeyForSelection({ kind: "workspace", id: HOME_WORKSPACE_ID })).toBe("global");
    expect(scopeKeyForSelection(null)).toBe("global");
  });
});

describe("scopeKeyForConversation", () => {
  it("derives the same stable scopes from persisted conversation ownership", () => {
    expect(scopeKeyForConversation({ workspaceId: HOME_WORKSPACE_ID, bookId: null })).toBe("global");
    expect(scopeKeyForConversation({ workspaceId: "workspace-2", bookId: null })).toBe("workspace:workspace-2");
    expect(scopeKeyForConversation({ workspaceId: HOME_WORKSPACE_ID, bookId: "高等数学" })).toBe(
      "notebook:高等数学",
    );
    expect(scopeKeyForConversation({ bookId: "legacy-book" })).toBe("notebook:legacy-book");
  });
});

describe("sanitizeScopeSessions", () => {
  const conversations: ScopeConversationRef[] = [
    { id: "math-1", workspaceId: HOME_WORKSPACE_ID, bookId: "高等数学" },
    { id: "global-1", workspaceId: HOME_WORKSPACE_ID, bookId: null },
    { id: "external-1", workspaceId: "workspace-2", bookId: null },
    // Same title and id shape in a different scope must not leak into another
    // scope's recent work set.
    { id: "same-title", workspaceId: "workspace-2", bookId: null },
  ];

  it("keeps valid sessions, filters stale or cross-scope conversations, and caps five tabs", () => {
    const raw = {
      "notebook:高等数学": {
        openConversationIds: ["math-1", "stale", "math-1", "global-1", "same-title", "math-2", "math-3"],
        activeConversationId: "global-1",
        fileTabs: [
          { workspaceId: HOME_WORKSPACE_ID, path: "notes.md", title: "笔记", kind: "markdown" },
          { workspaceId: HOME_WORKSPACE_ID, path: "notes.md", title: "重复", kind: "markdown" },
          { workspaceId: HOME_WORKSPACE_ID, path: "bad.bin", title: "坏类型", kind: "zip" },
        ],
        activeFileKey: fileTabKey({ workspaceId: HOME_WORKSPACE_ID, path: "notes.md" }),
        surfacePreference: "split",
        splitRatio: 0.42,
      },
    };

    expect(sanitizeScopeSessions(raw, conversations)).toEqual({
      "notebook:高等数学": {
        openConversationIds: ["math-1"],
        activeConversationId: null,
        fileTabs: [{ workspaceId: HOME_WORKSPACE_ID, path: "notes.md", title: "笔记", kind: "markdown" }],
        activeFileKey: `${HOME_WORKSPACE_ID}\u0000notes.md`,
        surfacePreference: "split",
        splitRatio: 0.42,
      },
    });
  });

  it("drops only malformed scope entries and defaults partial valid entries", () => {
    const raw = {
      global: {
        openConversationIds: ["global-1"],
        surfacePreference: "unknown",
        splitRatio: 99,
        ignored: "drop me",
      },
      "workspace:workspace-2": {
        openConversationIds: "not-an-array",
        fileTabs: [{ workspaceId: "workspace-2", path: "todo.md", title: "待办", kind: "markdown" }],
        activeFileKey: "other\u0000missing.md",
        surfacePreference: "file",
        splitRatio: 0.01,
      },
      "notebook:": { openConversationIds: ["global-1"] },
      broken: null,
    };

    expect(sanitizeScopeSessions(raw, conversations)).toEqual({
      global: {
        openConversationIds: ["global-1"],
        activeConversationId: null,
        fileTabs: [],
        activeFileKey: null,
        surfacePreference: "conversation",
        splitRatio: 0.75,
      },
      "workspace:workspace-2": {
        openConversationIds: [],
        activeConversationId: null,
        fileTabs: [{ workspaceId: "workspace-2", path: "todo.md", title: "待办", kind: "markdown" }],
        activeFileKey: null,
        surfacePreference: "file",
        splitRatio: 0.25,
      },
    });
  });

  it("accepts a missing or malformed persisted value without throwing", () => {
    expect(sanitizeScopeSessions(undefined, conversations)).toEqual({});
    expect(sanitizeScopeSessions(["not-a-map"], conversations)).toEqual({});
    expect(sanitizeScopeSessions({ global: "not-a-session" }, conversations)).toEqual({});
    expect(() => sanitizeScopeSessions({ global: {} }, null as never)).not.toThrow();
  });
});
