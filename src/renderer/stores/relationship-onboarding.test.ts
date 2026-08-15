import { describe, expect, it } from "vitest";
import type { ConversationMeta } from "./conversations";
import {
  RELATIONSHIP_CONVERSATION_TITLE,
  buildRelationshipOnboardingPrompt,
  findRelationshipConversation,
} from "./relationship-onboarding";

function conversation(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "conv-1",
    title: RELATIONSHIP_CONVERSATION_TITLE,
    titleManuallyUpdated: true,
    bookId: null,
    workspaceId: "leemo-home",
    source: "buddy",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    createdAt: 1,
    lastActivityAt: 2,
    unread: false,
    ...overrides,
  };
}

describe("momo relationship onboarding", () => {
  it("builds one hidden kickoff that preserves the approved relationship contract", () => {
    const prompt = buildRelationshipOnboardingPrompt();

    expect(prompt).toMatch(/^\/meet-momo\b/u);
    expect(prompt).toContain("每次只问一个");
    expect(prompt).toContain("整份理解");
    expect(prompt).toContain("用户确认后");
    expect(prompt).toContain("可以拒绝回答");
    expect(prompt).toContain("已有的认识");
    expect(prompt).toContain("由浅入深");
    expect(prompt).toContain("不必覆盖所有维度");
    expect(prompt).not.toMatch(/Claude Code|MCP|leemo-library|环境变量/u);
  });

  it("reuses the persisted conversation even after the user renames it", () => {
    const renamed = conversation({ id: "remembered", title: "我们聊过的事" });
    const legacy = conversation({ id: "legacy", lastActivityAt: 99 });

    expect(findRelationshipConversation({ remembered: renamed, legacy }, "remembered")?.id)
      .toBe("remembered");
  });

  it("falls back to the newest valid legacy ritual and ignores notebook or archived conversations", () => {
    const result = findRelationshipConversation({
      old: conversation({ id: "old", lastActivityAt: 3 }),
      newest: conversation({ id: "newest", lastActivityAt: 10 }),
      notebook: conversation({ id: "notebook", bookId: "math", lastActivityAt: 20 }),
      archived: conversation({ id: "archived", archived: true, lastActivityAt: 30 }),
    }, null);

    expect(result?.id).toBe("newest");
  });
});
