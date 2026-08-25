import { describe, expect, it } from "vitest";
import type { ArtifactEntry } from "./artifacts";
import type { ConversationMeta } from "./conversations";
import type { TimelineItem } from "./message-model";
import {
  buildDailyReviewPrompt,
  dailyReviewTitle,
  findTodayDailyReviewConversation,
  hasDailyReviewToday,
} from "./daily-review";

const NOW = new Date(2026, 7, 5, 20, 30).getTime();

function meta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "conv-today",
    title: "求职准备",
    titleManuallyUpdated: false,
    bookId: null,
    workspaceId: "leemo-home",
    source: "buddy",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    createdAt: NOW - 2_000,
    lastActivityAt: NOW - 1_000,
    unread: false,
    ...overrides,
  };
}

function text(role: "user" | "momo", value: string, createdAt: number): TimelineItem {
  return { kind: "text", id: `${role}-${createdAt}`, runId: "run-1", role, text: value, streaming: false, createdAt };
}

const artifact: ArtifactEntry = {
  id: "artifact-1",
  kind: "file",
  path: "默认工作区/简历-v2.docx",
  title: "简历-v2.docx",
  bookId: null,
  sourceConversationId: "conv-today",
  sourceRunId: "run-1",
  createdAt: NOW - 3_000,
  escaped: false,
  workspaceId: "leemo-home",
};

describe("daily review digest", () => {
  it("summarizes today's real records and excludes an older conversation", () => {
    const prompt = buildDailyReviewPrompt({
      now: NOW,
      conversations: {
        today: meta({ id: "today", title: "求职准备" }),
        old: meta({ id: "old", title: "昨天的闲聊", lastActivityAt: NOW - 86_400_000 }),
      },
      order: ["today", "old"],
      timelines: {
        today: [
          text("user", "帮我把项目经历写得更具体", NOW - 8_000),
          text("momo", "我整理成了三条可量化的经历", NOW - 6_000),
        ],
        old: [text("user", "昨天不应该出现在今天回顾", NOW - 86_400_000)],
      },
      artifacts: [artifact],
      scheduledTasks: [],
      scheduledRuns: [],
    });

    expect(prompt).toContain("求职准备");
    expect(prompt).toContain("帮我把项目经历写得更具体");
    expect(prompt).toContain("简历-v2.docx");
    expect(prompt).not.toContain("昨天不应该出现在今天回顾");
    expect(prompt).toContain("不要把这次回顾自动写入长期记忆");
  });

  it("keeps the digest bounded and never includes raw thinking", () => {
    const long = "x".repeat(4_000);
    const prompt = buildDailyReviewPrompt({
      now: NOW,
      conversations: { today: meta() },
      order: ["today"],
      timelines: { today: [text("user", long, NOW - 2_000), { kind: "thinking", id: "think", runId: "run-1", text: "内部思考不应进入回顾", streaming: false }] },
      artifacts: [],
      scheduledTasks: [],
      scheduledRuns: [],
    });

    expect(prompt.length).toBeLessThan(2_500);
    expect(prompt).not.toContain("内部思考不应进入回顾");
  });

  it("states when there is no local record instead of inviting invention", () => {
    const prompt = buildDailyReviewPrompt({
      now: NOW,
      conversations: {},
      order: [],
      timelines: {},
      artifacts: [],
      scheduledTasks: [],
      scheduledRuns: [],
    });

    expect(prompt).toContain("今天暂无可读取的本地记录");
    expect(prompt).toContain("不要编造经历、产物或任务");
  });

  it("does not call a future scheduled task pending today", () => {
    const prompt = buildDailyReviewPrompt({
      now: NOW,
      conversations: {},
      order: [],
      timelines: {},
      artifacts: [],
      scheduledTasks: [{
        id: "tomorrow",
        name: "明天交周报",
        prompt: "整理周报",
        schedule: { kind: "once", runAt: NOW + 86_400_000 },
        timezone: "Asia/Tokyo",
        nextRunAt: NOW + 86_400_000,
        workspaceId: "leemo-home",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      }],
      scheduledRuns: [],
    });

    expect(prompt).not.toContain("明天交周报");
  });

  it("reuses only today's unfiled daily-review conversation", () => {
    const title = dailyReviewTitle(NOW);
    const found = findTodayDailyReviewConversation([
      meta({ id: "book-review", title, bookId: "学习" }),
      meta({ id: "old-review", title: dailyReviewTitle(NOW - 86_400_000) }),
      meta({ id: "today-review", title }),
    ], NOW);

    expect(found?.id).toBe("today-review");
  });

  it("recognizes today's review episode inside the durable momo relationship", () => {
    expect(hasDailyReviewToday([
      text("user", "回顾今天", NOW - 2_000),
      text("momo", "今天主要推进了简历。", NOW - 1_000),
    ], NOW)).toBe(true);
    expect(hasDailyReviewToday([
      text("user", "回顾今天", NOW - 86_400_000),
    ], NOW)).toBe(false);
  });
});
