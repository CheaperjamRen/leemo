import { describe, expect, it } from "vitest";
import type { UserTask } from "../../tasks";
import type { ArtifactEntry } from "../stores/artifacts";
import type { ConversationMeta } from "../stores/conversations";
import type { TimelineItem } from "../stores/message-model";
import { buildGlobalOverviewFactPack } from "./facts";

const NOW = Date.UTC(2026, 7, 18, 12, 0, 0);
const DAY = 86_400_000;

function task(overrides: Partial<UserTask> = {}): UserTask {
  return {
    id: "task-open-old",
    title: "把 Leemo 产品故事写成 PRD",
    details: "保留人的注意力与独立思考",
    status: "open",
    plannedAt: null,
    dueAt: null,
    reminderAt: null,
    reminderOffsetMinutes: null,
    recurrence: null,
    notebookId: "Leemo 产品",
    noteId: null,
    revision: 1,
    createdAt: NOW - 100 * DAY,
    updatedAt: NOW - 40 * DAY,
    completedAt: null,
    ...overrides,
  };
}

function meta(id: string, overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id,
    title: id,
    titleManuallyUpdated: true,
    bookId: "Leemo 产品",
    workspaceId: "leemo-home",
    source: "workbench",
    providerId: "deepseek",
    modelId: "deepseek-v4-flash",
    createdAt: NOW - 50 * DAY,
    lastActivityAt: NOW - DAY,
    unread: false,
    pinned: false,
    archived: false,
    lastOpenedAt: NOW - DAY,
    ...overrides,
  };
}

function text(id: string, role: "user" | "momo", value: string, createdAt = NOW - DAY): TimelineItem {
  return { kind: "text", id, runId: "run-1", role, text: value, streaming: false, createdAt };
}

function result(overrides: Partial<Extract<TimelineItem, { kind: "result" }>> = {}): TimelineItem {
  return {
    kind: "result",
    id: "result-1",
    runId: "run-1",
    isError: false,
    interrupted: false,
    finalText: "已经产出一版产品定位摘要。",
    pathAudit: { claimed: [] },
    createdAt: NOW - DAY,
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactEntry> = {}): ArtifactEntry {
  return {
    id: "artifact-1",
    kind: "file",
    path: "Leemo 产品/产品哲学.md",
    title: "产品哲学.md",
    bookId: "Leemo 产品",
    sourceConversationId: "recent-work",
    sourceRunId: "run-1",
    createdAt: NOW - DAY,
    escaped: false,
    workspaceId: "leemo-home",
    ...overrides,
  };
}

describe("buildGlobalOverviewFactPack", () => {
  it("keeps old open Todos, excludes completed/deleted Todos, and preserves stable relations", () => {
    const pack = buildGlobalOverviewFactPack({
      now: NOW,
      tasks: [
        task(),
        task({ id: "task-done", status: "done", completedAt: NOW - DAY }),
        task({ id: "task-deleted", deletedAt: NOW - DAY }),
        task({ id: "task-note", noteId: "note-7", notebookId: "求职准备", updatedAt: NOW }),
      ],
      conversations: {},
      timelines: {},
      runIds: {},
      artifacts: [],
    });

    expect(pack.facts.map((fact) => fact.id)).toEqual(["task:task-note", "task:task-open-old"]);
    expect(pack.facts.find((fact) => fact.id === "task:task-note")).toMatchObject({
      projectLabel: "求职准备",
      relatedIds: ["note:note-7"],
    });
  });

  it("includes bounded work evidence and artifacts but excludes ordinary Buddy chat and archived history", () => {
    const conversations: Record<string, ConversationMeta> = {
      "recent-work": meta("recent-work", { title: "梳理 Leemo 产品哲学" }),
      "waiting-old": meta("waiting-old", { title: "等待我补材料", lastActivityAt: NOW - 45 * DAY }),
      "buddy-chat": meta("buddy-chat", { title: "随便聊聊", source: "buddy" }),
      archived: meta("archived", { archived: true }),
      "old-finished": meta("old-finished", { lastActivityAt: NOW - 45 * DAY }),
    };
    const timelines: Record<string, TimelineItem[]> = {
      "recent-work": [
        text("u-work", "user", "把产品哲学收敛成一份规格"),
        { kind: "thinking", id: "secret-thinking", runId: "run-1", text: "raw thinking transcript", streaming: false },
        {
          kind: "overview",
          id: "overview-1",
          runId: "run-1",
          toolUseId: "overview-tool",
          overview: { summary: "正在收敛产品哲学", nextStep: "形成设计规格" },
          createdAt: NOW - DAY,
        },
        result(),
      ],
      "waiting-old": [text("u-old", "user", "等我补充面试材料", NOW - 45 * DAY)],
      "buddy-chat": [text("u-chat", "user", "今天吃什么"), text("a-chat", "momo", "可以吃面")],
      archived: [text("u-archived", "user", "归档任务")],
      "old-finished": [text("u-finished", "user", "旧任务", NOW - 45 * DAY), result({ createdAt: NOW - 45 * DAY })],
    };

    const pack = buildGlobalOverviewFactPack({
      now: NOW,
      tasks: [],
      conversations,
      timelines,
      runIds: { "recent-work": null, "waiting-old": null, "buddy-chat": null, archived: null, "old-finished": null },
      pendingConversationIds: new Set(["waiting-old"]),
      artifacts: [artifact(), artifact({ id: "chat-artifact", sourceConversationId: "buddy-chat", title: "闲聊.txt" })],
    });

    expect(pack.facts.map((fact) => fact.id)).toEqual([
      "conversation:waiting-old",
      "conversation:recent-work",
      "artifact:artifact-1",
    ]);
    expect(pack.facts.find((fact) => fact.id === "conversation:waiting-old")?.state).toBe("waiting-user");
    expect(pack.facts.find((fact) => fact.id === "conversation:recent-work")?.evidence).toEqual([
      "用户：把产品哲学收敛成一份规格",
      "概览：正在收敛产品哲学",
      "下一步：形成设计规格",
      "回执：已经产出一版产品定位摘要。",
    ]);
    expect(JSON.stringify(pack)).not.toContain("raw thinking transcript");
    expect(JSON.stringify(pack)).not.toContain("今天吃什么");
    expect(JSON.stringify(pack)).not.toContain("闲聊.txt");
  });

  it("clips long evidence and never exceeds the global fact budget", () => {
    const conversations = Object.fromEntries(Array.from({ length: 80 }, (_, index) => {
      const id = `work-${index}`;
      return [id, meta(id, { lastActivityAt: NOW - index })];
    }));
    const timelines = Object.fromEntries(Object.keys(conversations).map((id) => [
      id,
      [text(`u-${id}`, "user", "长".repeat(400))],
    ]));

    const pack = buildGlobalOverviewFactPack({
      now: NOW,
      tasks: [],
      conversations,
      timelines,
      runIds: {},
      artifacts: [],
    });

    expect(pack.facts).toHaveLength(48);
    expect(pack.facts.every((fact) => fact.evidence.every((value) => Array.from(value).length <= 240))).toBe(true);
  });

  it("projects an active run as its own truthful source instead of only mentioning an unusable related id", () => {
    const pack = buildGlobalOverviewFactPack({
      now: NOW,
      tasks: [],
      conversations: { "recent-work": meta("recent-work", { title: "继续打磨开始页" }) },
      timelines: { "recent-work": [text("u-run", "user", "把开始页接通并目验")] },
      runIds: { "recent-work": "run-active" },
      artifacts: [],
    });

    expect(pack.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "run:run-active",
        kind: "run",
        state: "running",
        relatedIds: ["conversation:recent-work"],
      }),
    ]));
  });
});
