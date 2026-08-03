import { describe, it, expect, vi } from "vitest";
import { searchGlmNative, vendorSearchAdapter } from "../../src/host/vendor-search";

/** GLM `/paas/v4/web_search` 的真实响应形状 —— 字段名抄自实测
 *  （smoke/probe-native-search-l2.mjs 的结果 JSON），不是我编的。
 *  承重点：URL 在 **`link`** 里，不是 `url`。 */
function glmResponse(overrides: Record<string, unknown>[] = []) {
  return {
    created: 1785127870,
    id: "20260727125109b9901df3f7ad434a",
    request_id: "20260727125109b9901df3f7ad434a",
    search_intent: [{ intent: "SEARCH_ALWAYS", keywords: "上海 今天 天气", query: "上海 今天 天气" }],
    search_result:
      overrides.length > 0
        ? overrides
        : [
            {
              title: "上海今起“高温连续剧”开播",
              link: "https://new.qq.com/rain/a/20260727A05CIS00",
              content: "今日天气上海今天在副热带高压控制下，继续晴热天气。",
              media: "腾讯新闻",
              publish_date: "2026-07-27",
              icon: "",
              refer: "ref_1",
            },
            {
              title: "上海天气",
              link: "http://sh.weather.com.cn/index.shtml",
              content: "上海市气象局官方",
              media: "中国天气网",
              publish_date: "",
              icon: "",
              refer: "ref_2",
            },
          ],
  };
}

/** 假 fetch。**签名必须带上 (url, init)** —— 写成零参 `vi.fn(async () => …)` 时
 *  mock.calls 的类型是 `[]`，断言请求形状那几条会在 tsc 下炸（vitest 却能过）。 */
function jsonFetch(payload: unknown, init: { status?: number; contentType?: string } = {}) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { "content-type": init.contentType ?? "application/json" },
    })
  );
}

describe("searchGlmNative —— 层② GLM 自家搜索 API", () => {
  const OPTS = { apiKey: "sk-glm-test", searchApiUrl: "https://open.bigmodel.cn/api/paas/v4/web_search" };

  it("从 search_result 映射出 title/url/snippet", async () => {
    const fetchFn = jsonFetch(glmResponse());
    const hits = await searchGlmNative("上海 今天 天气", { ...OPTS, fetchFn });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: "上海今起“高温连续剧”开播",
      url: "https://new.qq.com/rain/a/20260727A05CIS00",
    });
    expect(hits[0]!.snippet).toContain("副热带高压");
  });

  it("URL 取的是 `link` 而不是 `url` —— 写错就静默 0 条", async () => {
    // 这条是承重测试。照 Anthropic/Tavily 的直觉写 r.url 会让每一条都缺 url 被丢掉，
    // 结果长得像"这家搜不到"，而不是像 bug。
    const fetchFn = jsonFetch(
      glmResponse([{ title: "有 url 字段但没有 link", url: "https://wrong-field.example.com", content: "x" }])
    );
    const hits = await searchGlmNative("q", { ...OPTS, fetchFn });
    expect(hits).toHaveLength(0);
  });

  it("走 search_std（基础档，单价更低）并带上用户的 key", async () => {
    const fetchFn = jsonFetch(glmResponse());
    await searchGlmNative("测试", { ...OPTS, fetchFn });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPTS.searchApiUrl);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-glm-test");
    expect(JSON.parse(String(init.body))).toMatchObject({ search_engine: "search_std", search_query: "测试" });
  });

  it("非 2xx 抛错（判据只看状态码，不解析各家不同的错误体）", async () => {
    const fetchFn = jsonFetch({ error: { code: "401" } }, { status: 401 });
    await expect(searchGlmNative("q", { ...OPTS, fetchFn })).rejects.toThrow(/HTTP 401/);
  });

  it("缺 title 或缺 link 的条目丢掉（模型无法引用）", async () => {
    const fetchFn = jsonFetch(
      glmResponse([
        { title: "", link: "https://a.example.com", content: "无标题" },
        { title: "无链接", link: "", content: "x" },
        { title: "好的", link: "https://good.example.com", content: "y" },
      ])
    );
    const hits = await searchGlmNative("q", { ...OPTS, fetchFn });
    expect(hits.map((h) => h.url)).toEqual(["https://good.example.com"]);
  });

  it("空 key 直接抛，不发请求", async () => {
    const fetchFn = jsonFetch(glmResponse());
    await expect(searchGlmNative("q", { ...OPTS, apiKey: "  ", fetchFn })).rejects.toThrow(/no api key/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("search_result 缺失/非数组 ⇒ 0 条而不是崩", async () => {
    const fetchFn = jsonFetch({ created: 1, id: "x" });
    await expect(searchGlmNative("q", { ...OPTS, fetchFn })).resolves.toEqual([]);
  });
});

describe("vendorSearchAdapter", () => {
  it("认得 glm", () => {
    expect(vendorSearchAdapter("glm")).toBe(searchGlmNative);
  });

  it("未知/缺失标签返回 undefined 而不是抛 —— 一个拼错的标签不该让整条链停摆", () => {
    expect(vendorSearchAdapter("nope")).toBeUndefined();
    expect(vendorSearchAdapter(undefined)).toBeUndefined();
  });
});
