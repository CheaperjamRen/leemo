import { describe, expect, it, vi } from "vitest";
import { createRelationshipHistoryMcp } from "../../src/bridge/relationship-history-mcp";

describe("createRelationshipHistoryMcp", () => {
  it("returns bounded relationship excerpts through one read-only tool", async () => {
    const search = vi.fn(async () => [{
      conversationId: "buddy-old",
      runId: "run-1",
      role: "user" as const,
      text: "我说过秋招简历需要突出实验设计。",
      createdAt: 100,
    }]);
    const mcp = createRelationshipHistoryMcp({ search });

    await expect(mcp.runSearch({ query: "秋招简历", limit: 3 })).resolves.toEqual({
      isError: false,
      text: "找到 1 条相关记录。",
      hits: [{
        conversationId: "buddy-old",
        runId: "run-1",
        role: "user",
        text: "我说过秋招简历需要突出实验设计。",
        createdAt: 100,
      }],
    });
    expect(search).toHaveBeenCalledWith({ query: "秋招简历", limit: 3 });
    expect(mcp.server).toBeTruthy();
  });

  it("fails closed when the local history search is unavailable", async () => {
    const mcp = createRelationshipHistoryMcp({
      search: async () => { throw new Error("db unavailable"); },
    });
    await expect(mcp.runSearch({ query: "以前说过什么" })).resolves.toEqual({
      isError: true,
      text: "暂时无法读取更早的聊天记录。",
    });
  });
});
