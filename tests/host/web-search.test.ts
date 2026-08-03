// 轮 4 卡 H：自建搜索纯逻辑。注入 fetch，全部离线可测。
// 固件形状照探针③实测：{code:0, data:{results:[{title,url,snippet,content}]}}
import { describe, it, expect, vi } from "vitest";
import {
  searchAnySearch,
  searchDoubao,
  searchMetaso,
  searchGoogle,
  classifySearchHttpError,
  parseDdgLite,
  runSearchChain,
  buildSourceChain,
  formatHits,
  MAX_HITS,
  type SearchHit,
} from "../../src/host/web-search";
import { readFileSync } from "node:fs";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/search/${name}`, import.meta.url), "utf8"));
}

function okJson(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  })) as unknown as typeof fetch;
}

describe("searchAnySearch", () => {
  it("POST /v1/search，带 query —— 探针①的教训：这个路由不吃 GET", async () => {
    const f = okJson({
      code: 0,
      data: { results: [{ title: "T", url: "https://e.com/1", snippet: "S" }] },
    });
    await searchAnySearch("泰勒展开", { fetchFn: f });
    const [url, init] = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe("https://api.anysearch.com/v1/search");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ query: "泰勒展开" });
  });

  it("裁掉 content —— 它占 87.9% 体积，原样进模型一次搜索吃掉几万 token", async () => {
    const big = { title: "T", url: "https://e.com/1", snippet: "S", content: "x".repeat(5000) };
    const hits = await searchAnySearch("q", { fetchFn: okJson({ code: 0, data: { results: [big] } }) });
    expect(hits).toEqual([{ title: "T", url: "https://e.com/1", snippet: "S" }]);
    expect(JSON.stringify(hits)).not.toContain("xxxx");
  });

  it("非 2xx 抛 —— 判据是「非 2xx 就换下一家」，不解析错误体（各家结构都不同）", async () => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 401,
      async text() {
        return '{"detail":{"error":"Unauthorized"}}';
      },
    })) as unknown as typeof fetch;
    await expect(searchAnySearch("q", { fetchFn: f })).rejects.toThrow(/401/);
  });

  it("HTTP 200 但 code≠0 也算失败（这家用业务码报错）", async () => {
    const f = okJson({ code: 40001, message: "bad request" });
    await expect(searchAnySearch("q", { fetchFn: f })).rejects.toThrow();
  });

  it("丢掉缺 url 或缺 title 的条目 —— 没链接模型就无法引用", async () => {
    const f = okJson({
      code: 0,
      data: {
        results: [
          { title: "有", url: "https://e.com/1", snippet: "s" },
          { title: "缺链接", snippet: "s" },
          { url: "https://e.com/3", snippet: "s" },
        ],
      },
    });
    const hits = await searchAnySearch("q", { fetchFn: f });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe("有");
  });
});

describe("searchDoubao", () => {
  it("调用豆包 Custom 官方端点并只映射可引用的三字段", async () => {
    const f = okJson(fixture("doubao-success.json"));
    const hits = await searchDoubao("今天的 AI 新闻", { apiKey: "doubao-test-key", fetchFn: f });
    const [url, init] = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://open.feedcoopapi.com/search_api/web_search");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer doubao-test-key");
    expect(JSON.parse(init.body)).toEqual({
      Query: "今天的 AI 新闻",
      SearchType: "web",
      Count: MAX_HITS,
      Filter: { NeedContent: true, NeedUrl: true },
    });
    expect(hits).toEqual([
      { title: "豆包结果", url: "https://example.com/doubao", snippet: "可核验摘要" },
    ]);
    expect(JSON.stringify(hits)).not.toContain("不应进入模型的全文");
  });

  it("HTTP 200 的业务错误也失败，且不回显上游正文", async () => {
    const f = okJson({
      ResponseMetadata: { Error: { CodeN: 10406, Code: "QuotaExceeded", Message: "contains secret body" } },
    });
    await expect(searchDoubao("q", { apiKey: "secret-key", fetchFn: f }))
      .rejects.toThrow("额度");
    await expect(searchDoubao("q", { apiKey: "secret-key", fetchFn: f }))
      .rejects.not.toThrow(/secret-key|contains secret body/);
  });
});

describe("searchMetaso", () => {
  it("调用秘塔非流式接口，只把 references 变成命中，不夹带生成答案", async () => {
    const f = okJson(fixture("metaso-success.json"));
    const hits = await searchMetaso("检索方法", { apiKey: "metaso-test-key", fetchFn: f });
    const [url, init] = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://metaso.cn/api/open/search/v2");
    expect(init.headers.authorization).toBe("Bearer metaso-test-key");
    expect(JSON.parse(init.body)).toEqual({
      question: "检索方法",
      stream: false,
      lang: "zh",
      needHighlight: false,
    });
    expect(hits).toEqual([
      { title: "秘塔来源", url: "https://example.com/metaso", snippet: "来源摘要" },
    ]);
    expect(JSON.stringify(hits)).not.toContain("上游生成的整段答案");
  });

  it("业务错误码不伪装成零结果", async () => {
    await expect(searchMetaso("q", {
      apiKey: "metaso-key",
      fetchFn: okJson({ errCode: 1003, errMsg: "invalid secret metaso-key" }),
    })).rejects.toThrow("秘塔搜索");
  });
});

describe("searchGoogle", () => {
  it("用 Key + CX 调官方 GET，并映射 items 的纯文本字段", async () => {
    const f = okJson(fixture("google-success.json"));
    const hits = await searchGoogle("a b", {
      apiKey: "google-test-key",
      engineId: "cx:test",
      fetchFn: f,
    });
    const [rawUrl, init] = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      { method: string },
    ];
    const url = new URL(rawUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://customsearch.googleapis.com/customsearch/v1");
    expect(url.searchParams.get("key")).toBe("google-test-key");
    expect(url.searchParams.get("cx")).toBe("cx:test");
    expect(url.searchParams.get("q")).toBe("a b");
    expect(url.searchParams.get("num")).toBe(String(MAX_HITS));
    expect(init.method).toBe("GET");
    expect(hits).toEqual([
      { title: "Google result", url: "https://example.com/google", snippet: "Plain snippet" },
    ]);
  });
});

describe("search provider failures", () => {
  it.each([
    [401, "认证失败"],
    [403, "认证失败"],
    [429, "请求过快或额度不足"],
    [500, "服务暂不可用"],
  ])("把 HTTP %i 归成人话诊断", (status, expected) => {
    expect(classifySearchHttpError("豆包搜索", status)).toContain(expected);
  });

  it.each([
    ["doubao", (f: typeof fetch) => searchDoubao("q", { apiKey: "provider-secret", fetchFn: f })],
    ["metaso", (f: typeof fetch) => searchMetaso("q", { apiKey: "provider-secret", fetchFn: f })],
    ["google", (f: typeof fetch) => searchGoogle("q", { apiKey: "provider-secret", engineId: "cx-secret", fetchFn: f })],
  ])("%s 的 HTTP 错误不泄露 Key、完整 URL 或响应正文", async (_source, run) => {
    const f = vi.fn(async () => ({
      ok: false,
      status: 401,
      async text() { return "provider-secret cx-secret https://secret.example/path"; },
    })) as unknown as typeof fetch;
    let message = "";
    try {
      await run(f);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("认证失败");
    expect(message).not.toMatch(/provider-secret|cx-secret|secret\.example/);
  });

  it.each([
    ["doubao", (f: typeof fetch) => searchDoubao("q", { apiKey: "key", fetchFn: f })],
    ["metaso", (f: typeof fetch) => searchMetaso("q", { apiKey: "key", fetchFn: f })],
    ["google", (f: typeof fetch) => searchGoogle("q", { apiKey: "key", engineId: "cx", fetchFn: f })],
  ])("%s 收到损坏 JSON 时给稳定诊断", async (_source, run) => {
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() { return "{not-json"; },
    })) as unknown as typeof fetch;
    await expect(run(f)).rejects.toThrow("响应格式错误");
  });

  it("网络超时不会把底层错误里的凭据或请求细节带进诊断", async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("provider-secret https://secret.example/request"));
        });
      })) as unknown as typeof fetch;

    let message = "";
    try {
      await searchDoubao("q", { apiKey: "provider-secret", fetchFn: f, timeoutMs: 1 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("服务暂不可用");
    expect(message).not.toMatch(/provider-secret|secret\.example/);
  });

  it("合法零结果保持空数组，让 fallback 链继续下一家", async () => {
    await expect(searchDoubao("q", {
      apiKey: "key",
      fetchFn: okJson({ ResponseMetadata: {}, Result: { ResultCount: 0, WebResults: [] } }),
    })).resolves.toEqual([]);
    await expect(searchMetaso("q", {
      apiKey: "key",
      fetchFn: okJson({ errCode: 0, data: { references: [], text: "不能当命中" } }),
    })).resolves.toEqual([]);
    await expect(searchGoogle("q", {
      apiKey: "key",
      engineId: "cx",
      fetchFn: okJson({ items: [] }),
    })).resolves.toEqual([]);
  });
});

// DDG lite 是兜底源：抓 HTML 不是 API，DDG 改版会静默失效。所以解析器必须
// 离线可测（固件照实测结构），且「被反爬挡住」要当失败抛，不能返回空数组 ——
// 空数组会被链当成"这家没结果"而继续往下走，看起来一样，但诊断信息全丢了。
const DDG_HTML = `<html><body><table>
<tr><td>1.</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x" class="result-link">First &amp; Best</a></td></tr>
<tr><td></td><td class="result-snippet">Snippet about &lt;things&gt;</td></tr>
<tr><td>2.</td><td><a rel="nofollow" href="https://plain.example.org/b" class="result-link">Plain URL</a></td></tr>
<tr><td></td><td class="result-snippet">Second snippet</td></tr>
</table></body></html>`;

describe("parseDdgLite", () => {
  it("解出条目，并把 DDG 的重定向包装还原成真 URL", () => {
    const hits = parseDdgLite(DDG_HTML);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      title: "First & Best",
      url: "https://example.com/a",
      snippet: "Snippet about <things>",
    });
    expect(hits[1]!.url).toBe("https://plain.example.org/b");
  });

  it("HTML 实体解码（&amp; / &lt; 不能漏进标题和摘要）", () => {
    const hits = parseDdgLite(DDG_HTML);
    expect(hits[0]!.title).not.toContain("&amp;");
    expect(hits[0]!.snippet).not.toContain("&lt;");
  });

  it("反爬页当失败抛，不是返回空数组 —— 空数组会把诊断信息吞掉", () => {
    expect(() => parseDdgLite("<html><body>anomalous traffic detected</body></html>")).toThrow();
  });

  it("解不出任何条目也抛（改版即失效，要能立刻看出来）", () => {
    expect(() => parseDdgLite("<html><body><p>nothing here</p></body></html>")).toThrow();
  });
});

const HIT: SearchHit = { title: "T", url: "https://e.com/1", snippet: "S" };

describe("runSearchChain", () => {
  it("第一家成功就停，不打后面的（省时间也省配额）", async () => {
    const b = vi.fn(async () => [HIT]);
    const r = await runSearchChain("q", [
      { name: "a", search: async () => [HIT] },
      { name: "b", search: b },
    ]);
    expect(r?.source).toBe("a");
    expect(b).not.toHaveBeenCalled();
  });

  it("抛异常就换下一家", async () => {
    const r = await runSearchChain("q", [
      { name: "a", search: async () => { throw new Error("401"); } },
      { name: "b", search: async () => [HIT] },
    ]);
    expect(r?.source).toBe("b");
    expect(r?.hits).toEqual([HIT]);
  });

  it("零结果也算失败、继续往下 —— 一家返回空不等于「网上没有」", async () => {
    const r = await runSearchChain("q", [
      { name: "a", search: async () => [] },
      { name: "b", search: async () => [HIT] },
    ]);
    expect(r?.source).toBe("b");
  });

  it("全挂返回 null 而不是抛 —— 调用方要能说真话「搜索失败了」，而不是崩掉", async () => {
    const r = await runSearchChain("q", [
      { name: "a", search: async () => { throw new Error("x"); } },
      { name: "b", search: async () => { throw new Error("y"); } },
    ]);
    expect(r).toBeNull();
  });

  it("记下每家的失败原因，便于诊断", async () => {
    const r = await runSearchChain("q", [
      { name: "a", search: async () => { throw new Error("boom"); } },
      { name: "b", search: async () => [HIT] },
    ]);
    expect(r?.attempts.find((a) => a.name === "a")?.error).toMatch(/boom/);
  });
});

describe("buildSourceChain", () => {
  it("没配任何 key 也能搜 —— 免 key 的 AnySearch 打头", () => {
    const names = buildSourceChain({}).map((s) => s.name);
    expect(names[0]).toBe("anysearch");
  });

  it("DDG lite 不进默认链 —— 用户机器上 DDG/Brave/Startpage 全是 TCP CONNECT_TIMEOUT，留着就是永不触发的假兜底（测时绿、真用时黑，比没有更骗人）", () => {
    expect(buildSourceChain({}).map((s) => s.name)).not.toContain("ddg-lite");
    expect(buildSourceChain({ tavilyKey: "tvly-x" }).map((s) => s.name)).not.toContain("ddg-lite");
  });

  it("配了 Tavily 就有真兜底（API 不是抓页，不会因对方改版静默失效）", () => {
    const names = buildSourceChain({ tavilyKey: "tvly-x" }).map((s) => s.name);
    expect(names).toEqual(["anysearch", "tavily"]);
  });

  it("配了 key 的源追加在 AnySearch 之后，不前插 —— 探针②实测带 key 反而更差（3 条 vs 10 条、内容跑偏），不能想当然认为付费更好", () => {
    const names = buildSourceChain({ tavilyKey: "tvly-x", bochaKey: "sk-y" }).map((s) => s.name);
    expect(names[0]).toBe("anysearch");
    expect(names).toContain("tavily");
    expect(names).toContain("bocha");
    expect(names.indexOf("tavily")).toBeGreaterThan(names.indexOf("anysearch"));
  });

  it("空串/纯空白的 key 视为没配，不进链", () => {
    const names = buildSourceChain({
      doubaoKey: " ", metasoKey: "", tavilyKey: "   ", bochaKey: "", googleKey: "x", googleCx: "",
    }).map((s) => s.name);
    expect(names).not.toContain("doubao");
    expect(names).not.toContain("metaso");
    expect(names).not.toContain("tavily");
    expect(names).not.toContain("bocha");
    expect(names).not.toContain("google");
  });

  it("新来源按中文增强优先、Google 最后接入，且只加入完整配置", () => {
    const names = buildSourceChain({
      doubaoKey: "doubao",
      metasoKey: "metaso",
      tavilyKey: "tavily",
      bochaKey: "bocha",
      googleKey: "google",
      googleCx: "cx",
    }).map((s) => s.name);
    expect(names).toEqual(["anysearch", "doubao", "metaso", "tavily", "bocha", "google"]);
  });
});

describe("formatHits", () => {
  it("每条都带 URL —— 模型要能引用来源，不能只给正文", () => {
    const out = formatHits([HIT], "anysearch");
    expect(out).toContain("https://e.com/1");
    expect(out).toContain("T");
  });

  it("超过 MAX_HITS 就截断 —— 上下文预算兜底", () => {
    const many = Array.from({ length: MAX_HITS + 5 }, (_, i) => ({
      title: `T${i}`,
      url: `https://e.com/${i}`,
      snippet: "S",
    }));
    const out = formatHits(many, "anysearch");
    expect(out).toContain(`https://e.com/${MAX_HITS - 1}`);
    expect(out).not.toContain(`https://e.com/${MAX_HITS}`);
  });
});
