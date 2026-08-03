import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createArxivSearchClient,
  parseArxivAtom,
} from "../../src/host/arxiv-search";

const XML = readFileSync(new URL("../fixtures/search/arxiv-success.xml", import.meta.url), "utf8");

function xmlResponse(xml = XML, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return xml; },
  } as unknown as Response;
}

describe("parseArxivAtom", () => {
  it("解析默认/显式命名空间、多作者、分类、日期、PDF 与实体", () => {
    const papers = parseArxivAtom(XML);
    expect(papers).toHaveLength(2);
    expect(papers[0]).toEqual({
      id: "2401.12345v2",
      title: "Active Recall & Spaced Repetition",
      url: "https://arxiv.org/abs/2401.12345v2",
      abstract: "We compare <retrieval> practice with passive review.",
      authors: ["Alice Example", "Bob Example"],
      publishedAt: "2026-07-29T01:02:03Z",
      updatedAt: "2026-07-30T12:34:56Z",
      categories: ["cs.HC", "cs.AI"],
      pdfUrl: "https://arxiv.org/pdf/2401.12345v2",
    });
    expect(papers[1]).toEqual({
      id: "2402.00001",
      title: "Minimal Paper",
      url: "https://arxiv.org/abs/2402.00001",
      abstract: "Short abstract.",
      authors: ["Carol Example"],
      categories: [],
    });
  });

  it("拒绝 DTD/ENTITY，不让公开 XML 变成本地文件读取入口", () => {
    expect(() => parseArxivAtom(
      '<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><feed>&xxe;</feed>',
    )).toThrow(/DTD|ENTITY/);
  });

  it("坏 XML 明确失败，不返回看似合法的空结果", () => {
    expect(() => parseArxivAtom("<feed><entry></feed>")).toThrow("XML");
  });
});

describe("createArxivSearchClient", () => {
  it("请求官方 Atom API，并把 query 与结果上限编码进参数", async () => {
    const fetchSpy = vi.fn(async () => xmlResponse());
    const client = createArxivSearchClient({
      fetchFn: fetchSpy as unknown as typeof fetch,
      now: () => 100_000,
    });
    const result = await client.search("active recall");
    const [rawUrl, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://export.arxiv.org/api/query");
    expect(url.searchParams.get("search_query")).toBe("all:active recall");
    expect(url.searchParams.get("start")).toBe("0");
    expect(url.searchParams.get("max_results")).toBe("8");
    expect(url.searchParams.get("sortBy")).toBe("relevance");
    expect(url.searchParams.get("sortOrder")).toBe("descending");
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("Leemo");
    expect(result.cached).toBe(false);
    expect(result.papers).toHaveLength(2);
  });

  it("相同标准化查询十分钟内命中缓存，不重复访问公共服务", async () => {
    let now = 100_000;
    const fetchFn = vi.fn(async () => xmlResponse()) as unknown as typeof fetch;
    const client = createArxivSearchClient({ fetchFn, now: () => now });
    await client.search(" Active   Recall ");
    now += 9 * 60_000;
    const cached = await client.search("active recall");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cached.cached).toBe(true);
  });

  it("不同查询串行执行，连续请求至少间隔三秒", async () => {
    let now = 100_000;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const fetchFn = vi.fn(async () => xmlResponse()) as unknown as typeof fetch;
    const client = createArxivSearchClient({ fetchFn, now: () => now, sleep });
    const first = client.search("first");
    const second = client.search("second");
    await Promise.all([first, second]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3_000);
  });

  it("失败不写缓存，同一查询恢复后会重新请求", async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(xmlResponse()) as unknown as typeof fetch;
    const client = createArxivSearchClient({
      fetchFn,
      now: () => 100_000,
      minIntervalMs: 0,
    });
    await expect(client.search("retry me")).rejects.toThrow("学术检索");
    await expect(client.search("retry me")).resolves.toMatchObject({ cached: false });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("最多返回八篇，避免摘要把上下文撑爆", async () => {
    const entry = '<entry><id>https://arxiv.org/abs/1</id><title>T</title><summary>S</summary><link rel="alternate" href="https://arxiv.org/abs/1" /></entry>';
    const many = `<feed xmlns="http://www.w3.org/2005/Atom">${entry.repeat(12)}</feed>`;
    const client = createArxivSearchClient({
      fetchFn: vi.fn(async () => xmlResponse(many)) as unknown as typeof fetch,
      now: () => 100_000,
    });
    expect((await client.search("many")).papers).toHaveLength(8);
  });
});
