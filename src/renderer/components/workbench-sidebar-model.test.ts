import { describe, expect, it } from "vitest";
import type { ConversationMeta } from "../stores/conversations";
import { deriveWorkbenchSidebarModel } from "./workbench-sidebar-model";

function conversation(id: string, overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id,
    title: id,
    titleManuallyUpdated: true,
    source: "workbench",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    createdAt: 1,
    lastActivityAt: 1,
    unread: false,
    workspaceId: "leemo-home",
    bookId: null,
    pinned: false,
    archived: false,
    ...overrides,
  };
}

describe("workbench sidebar model", () => {
  it("puts active pinned conversations in one cross-scope section and removes duplicates", () => {
    const model = deriveWorkbenchSidebarModel({
      conversations: {
        global: conversation("global", { pinned: true, lastActivityAt: 20 }),
        book: conversation("book", { pinned: true, bookId: "求职", lastActivityAt: 30 }),
        normal: conversation("normal", { bookId: "求职", lastActivityAt: 40 }),
        archived: conversation("archived", { pinned: true, archived: true, lastActivityAt: 50 }),
      },
      order: ["global", "book", "normal", "archived"],
    });

    expect(model.pinned).toEqual([
      { id: "book", scopeKey: "notebook:求职" },
      { id: "global", scopeKey: "global" },
    ]);
    expect(model.byScope["notebook:求职"]).toEqual(["normal"]);
    expect(model.byScope.global).toEqual([]);
    expect(JSON.stringify(model)).not.toContain("archived");
  });

  it("sorts ordinary conversations by recent activity and ignores stale order ids", () => {
    const model = deriveWorkbenchSidebarModel({
      conversations: {
        older: conversation("older", { lastActivityAt: 10 }),
        newer: conversation("newer", { lastActivityAt: 20 }),
        project: conversation("project", {
          workspaceId: "workspace-project",
          lastActivityAt: 30,
        }),
      },
      order: ["missing", "older", "project", "newer"],
    });

    expect(model.byScope.global).toEqual(["newer", "older"]);
    expect(model.byScope["workspace:workspace-project"]).toEqual(["project"]);
    expect(model.pinned).toEqual([]);
  });

  it("uses the conversation id as a deterministic tie breaker", () => {
    const model = deriveWorkbenchSidebarModel({
      conversations: {
        beta: conversation("beta", { pinned: true, lastActivityAt: 10 }),
        alpha: conversation("alpha", { pinned: true, lastActivityAt: 10 }),
      },
      order: ["beta", "alpha"],
    });

    expect(model.pinned.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
  });

  it("hides conversations whose owning notebook or workspace is archived", () => {
    const model = deriveWorkbenchSidebarModel({
      conversations: {
        active: conversation("active", { pinned: true, bookId: "求职" }),
        hidden: conversation("hidden", { pinned: true, bookId: "已归档本子" }),
      },
      order: ["active", "hidden"],
      visibleScopeKeys: new Set(["global", "notebook:求职"]),
    });

    expect(model.pinned).toEqual([{ id: "active", scopeKey: "notebook:求职" }]);
    expect(JSON.stringify(model)).not.toContain("hidden");
  });
});
