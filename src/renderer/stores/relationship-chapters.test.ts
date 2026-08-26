import { describe, expect, it } from "vitest";
import type { ConversationMeta } from "./conversations";
import type { TimelineItem } from "./message-model";
import {
  canReuseEmptyRelationshipChapter,
  relationshipRunCountFromEnd,
  deriveRelationshipChapters,
  projectRelationshipTimelineWindow,
} from "./relationship-chapters";

function conversation(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "buddy-1",
    title: "和 momo 的对话",
    titleManuallyUpdated: false,
    bookId: null,
    workspaceId: "leemo-home",
    source: "buddy",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    createdAt: 1,
    lastActivityAt: 1,
    unread: false,
    ...overrides,
  };
}

const text = (runId: string, value = "聊点什么"): TimelineItem => ({
  kind: "text",
  id: `text-${runId}`,
  runId,
  role: "user",
  text: value,
  streaming: false,
});

describe("relationship chapters", () => {
  it("keeps only global Buddy conversations and places the active chapter last", () => {
    const conversations = {
      older: conversation({ id: "older", createdAt: 10 }),
      active: conversation({ id: "active", createdAt: 20 }),
      newestInactive: conversation({ id: "newest-inactive", createdAt: 30 }),
      workbench: conversation({ id: "workbench", source: "workbench", createdAt: 40 }),
      notebook: conversation({ id: "notebook", bookId: "math", createdAt: 50 }),
      archived: conversation({ id: "archived", archived: true, createdAt: 60 }),
    };

    const chapters = deriveRelationshipChapters({
      conversations,
      timelines: {
        older: [text("r-old")],
        active: [text("r-active")],
        "newest-inactive": [text("r-new")],
      },
      activeId: "active",
    });

    expect(chapters.map((chapter) => chapter.conversation.id)).toEqual([
      "older",
      "newest-inactive",
      "active",
    ]);
    expect(chapters.at(-1)).toMatchObject({ active: true, firstRunId: "r-active", hasActivity: true });
  });

  it("treats context bookkeeping as an empty reusable chapter", () => {
    const chapter = deriveRelationshipChapters({
      conversations: { active: conversation({ id: "active" }) },
      timelines: {
        active: [
          {
            kind: "context",
            id: "context-1",
            runId: "r-context",
            currentTokens: 1_000,
            maxTokens: 200_000,
            rawMaxTokens: 200_000,
            isAutoCompactEnabled: true,
            model: "deepseek-v4-flash",
          },
          { kind: "compact", id: "compact-1", trigger: "manual", preTokens: 1_000, postTokens: 200 },
        ],
      },
      activeId: "active",
    }).at(0);

    expect(chapter).toMatchObject({ hasActivity: false });
    expect(chapter).not.toHaveProperty("firstRunId");
    expect(canReuseEmptyRelationshipChapter(chapter)).toBe(true);
  });

  it("does not reuse a chapter after visible conversation activity", () => {
    const chapters = deriveRelationshipChapters({
      conversations: {
        text: conversation({ id: "text" }),
        tool: conversation({ id: "tool" }),
        result: conversation({ id: "result" }),
      },
      timelines: {
        text: [text("r-text")],
        tool: [{ kind: "tool", id: "tool-1", runId: "r-tool", toolUseId: "t1", name: "Read", input: {}, status: "running" }],
        result: [{ kind: "result", id: "result-1", runId: "r-result", isError: false, interrupted: false, finalText: "完成", pathAudit: { claimed: [] } }],
      },
      activeId: "text",
    });

    expect(chapters).toHaveLength(3);
    expect(chapters.every((chapter) => chapter.hasActivity)).toBe(true);
    expect(canReuseEmptyRelationshipChapter(chapters.find((chapter) => chapter.active))).toBe(false);
  });

  it("requires the reusable empty chapter to be the active relationship chapter", () => {
    const chapters = deriveRelationshipChapters({
      conversations: {
        emptyOld: conversation({ id: "empty-old", createdAt: 1 }),
        active: conversation({ id: "active", createdAt: 2 }),
      },
      timelines: { "empty-old": [], active: [text("r-active")] },
      activeId: "active",
    });

    expect(chapters).toHaveLength(2);
    expect(canReuseEmptyRelationshipChapter(chapters.find((chapter) => chapter.conversation.id === "empty-old"))).toBe(false);
  });

  it("在合并章节前只从尾部读取最近窗口，流式更新不会遍历 5000 轮旧历史", () => {
    const source = Array.from({ length: 5_000 }, (_, index) => text(`run-${index}`));
    let indexedReads = 0;
    const guarded = new Proxy(source, {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property))) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const chapters = deriveRelationshipChapters({
      conversations: { active: conversation({ id: "active" }) },
      timelines: { active: guarded },
      activeId: "active",
    });
    indexedReads = 0;

    const projected = projectRelationshipTimelineWindow(chapters, 40);

    expect(projected.items).toHaveLength(40);
    expect(projected.items[0]).toMatchObject({ runId: "run-4960" });
    expect(projected.items.at(-1)).toMatchObject({ runId: "run-4999" });
    expect(projected.hasOlder).toBe(true);
    expect(indexedReads).toBeLessThanOrEqual(42);
  });

  it("按需扩大窗口时仍保留加载更早路径和章节边界", () => {
    const chapters = deriveRelationshipChapters({
      conversations: {
        old: conversation({ id: "old", title: "旧话题", createdAt: 1 }),
        active: conversation({ id: "active", title: "当前话题", createdAt: 2 }),
      },
      timelines: {
        old: Array.from({ length: 60 }, (_, index) => text(`old-${index}`)),
        active: Array.from({ length: 40 }, (_, index) => text(`active-${index}`)),
      },
      activeId: "active",
    });

    const firstPage = projectRelationshipTimelineWindow(chapters, 40);
    const secondPage = projectRelationshipTimelineWindow(chapters, 80);

    expect(firstPage.items[0]).toMatchObject({ runId: "active-0" });
    expect(firstPage.hasOlder).toBe(true);
    expect(secondPage.items[0]).toMatchObject({ runId: "old-20" });
    expect(secondPage.hasOlder).toBe(true);
    expect(secondPage.chapterMarkers).toEqual([
      expect.objectContaining({ beforeRunId: "active-0", title: "当前话题" }),
    ]);
    expect(relationshipRunCountFromEnd(chapters, "old-20")).toBe(80);
  });
});
