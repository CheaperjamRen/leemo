import { describe, expect, it, vi } from "vitest";
import {
  createAcademicSearchMcp,
  LEEMO_ACADEMIC_SEARCH_TOOL,
} from "../../src/bridge/academic-search-mcp";

const OUTCOME = {
  query: "active recall",
  cached: false,
  fetchedAt: 100,
  papers: [{
    id: "2401.12345v2",
    title: "Active Recall",
    url: "https://arxiv.org/abs/2401.12345v2",
    abstract: "A useful abstract.",
    authors: ["Alice", "Bob"],
    publishedAt: "2026-07-29T01:02:03Z",
    categories: ["cs.HC"],
    pdfUrl: "https://arxiv.org/pdf/2401.12345v2",
  }],
};

describe("createAcademicSearchMcp", () => {
  it("暴露稳定限定名和可插入 SDK 的进程内 server", () => {
    expect(LEEMO_ACADEMIC_SEARCH_TOOL)
      .toBe("mcp__leemo-academic-search__academic_search");
    expect(createAcademicSearchMcp({ search: async () => OUTCOME }).server).toBeTruthy();
  });

  it("把论文元数据格式成可引用文本，不丢摘要和 PDF", async () => {
    const mcp = createAcademicSearchMcp({ search: async () => OUTCOME });
    const result = await mcp.runAcademicSearch("active recall");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Active Recall");
    expect(result.text).toContain("https://arxiv.org/abs/2401.12345v2");
    expect(result.text).toContain("https://arxiv.org/pdf/2401.12345v2");
    expect(result.text).toContain("Alice、Bob");
    expect(result.text).toContain("A useful abstract.");
  });

  it("空查询不访问服务", async () => {
    const search = vi.fn(async () => OUTCOME);
    const result = await createAcademicSearchMcp({ search }).runAcademicSearch("  ");
    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it("零结果不是伪失败，明确告诉模型没有匹配论文", async () => {
    const result = await createAcademicSearchMcp({
      search: async (query) => ({ query, cached: false, fetchedAt: 100, papers: [] }),
    }).runAcademicSearch("unfindable");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("没有找到匹配论文");
  });

  it("服务失败要求模型照实说明并改用普通搜索，不凭记忆编论文", async () => {
    const result = await createAcademicSearchMcp({
      search: async () => { throw new Error("offline raw detail"); },
    }).runAcademicSearch("q");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("学术检索失败");
    expect(result.text).toContain("普通联网搜索");
    expect(result.text).toMatch(/不要.*编造/);
    expect(result.text).not.toContain("offline raw detail");
  });

  it("超长摘要会被裁剪，避免单篇论文撑爆上下文", async () => {
    const result = await createAcademicSearchMcp({
      search: async () => ({
        ...OUTCOME,
        papers: [{ ...OUTCOME.papers[0], abstract: "x".repeat(5_000) }],
      }),
    }).runAcademicSearch("q");
    expect(result.text.length).toBeLessThan(2_500);
    expect(result.text).toContain("…");
  });
});
