import { describe, it, expect, vi } from "vitest";
import {
  chooseSearchWiring,
  isNestedSearchRequest,
  extractSearchQuery,
  extractDomainFilters,
  filterHitsByDomain,
  buildSearchMessage,
  buildSearchSse,
  parseShimToken,
  buildUpstreamHeaders,
  joinUpstreamUrl,
  startSearchShim,
  SEARCH_SHIM_PREFIX,
} from "../../src/host/search-shim";
import type { SearchHit } from "../../src/host/web-search";

/** CC 真的发出的那个嵌套请求（形状抄自 smoke/websearch-nested-probe.mjs 的实测
 *  记录，不是我编的）。 */
function nestedSearchBody(over: Record<string, unknown> = {}) {
  return {
    model: "deepseek-v4-flash",
    max_tokens: 1024,
    stream: true,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Perform a web search for the query: 上海 今天 天气" }],
      },
    ],
    ...over,
  };
}

/** 一次普通对话请求：一长串**客户端**工具（无 type 字段）。 */
function normalConversationBody() {
  return {
    model: "deepseek-v4-flash",
    stream: true,
    tools: [
      { name: "Read", input_schema: { type: "object" } },
      { name: "Write", input_schema: { type: "object" } },
      { name: "WebSearch", input_schema: { type: "object" } },
    ],
    messages: [{ role: "user", content: "帮我看看这个文件" }],
  };
}

const HITS: SearchHit[] = [
  { title: "上海天气预报-中国天气网", url: "https://www.weather.com.cn/weather/101020100.shtml", snippet: "多云 29~35℃" },
  { title: "上海市气象局", url: "https://sh.cma.gov.cn/", snippet: "今日天气" },
];

describe("isNestedSearchRequest —— 认出 CC 的嵌套搜索请求", () => {
  it("认得实测形状（tools 恰一个 web_search_* 服务端工具）", () => {
    expect(isNestedSearchRequest(nestedSearchBody())).toBe(true);
  });

  it("不误伤普通对话请求（客户端工具无 type 字段，其中还有个叫 WebSearch 的）", () => {
    // 这条是防误判的承重测试：普通请求里**就是**有个名叫 WebSearch 的客户端
    // 工具，如果判据写成"名字里有 web_search"就会把整场对话劫走。
    expect(isNestedSearchRequest(normalConversationBody())).toBe(false);
  });

  it("tools 为空/缺失一律不是（count_tokens、无工具的子请求都走这条）", () => {
    expect(isNestedSearchRequest({ messages: [] })).toBe(false);
    expect(isNestedSearchRequest({ tools: [] })).toBe(false);
  });

  it("混了客户端工具就不算（只有纯搜索请求才劫）", () => {
    expect(
      isNestedSearchRequest({
        tools: [{ type: "web_search_20250305", name: "web_search" }, { name: "Read" }],
      })
    ).toBe(false);
  });

  it("按前缀匹配，不钉版本号 —— 新版 web_search_20260209 照样认", () => {
    // CLI 内置文档里已经写了 web_search_20260209 的存在。钉死旧版本号等于给
    // 自己埋一个"某天静默失效"的雷。
    expect(
      isNestedSearchRequest({ tools: [{ type: "web_search_20260209", name: "web_search" }], messages: [] })
    ).toBe(true);
  });

  it("非对象输入不炸", () => {
    expect(isNestedSearchRequest(null)).toBe(false);
    expect(isNestedSearchRequest("nope")).toBe(false);
    expect(isNestedSearchRequest(undefined)).toBe(false);
  });
});

describe("extractSearchQuery", () => {
  it("剥掉 CC 的固定开场白，只留用户的查询", () => {
    expect(extractSearchQuery(nestedSearchBody())).toBe("上海 今天 天气");
  });

  it("content 是裸字符串时也能取", () => {
    expect(
      extractSearchQuery({
        messages: [{ role: "user", content: "Perform a web search for the query: vitest 4 release" }],
      })
    ).toBe("vitest 4 release");
  });

  it("话术变了就返回整段文本，不是失败 —— CC 改一句话不该让搜索停摆", () => {
    expect(
      extractSearchQuery({ messages: [{ role: "user", content: "Search the web for: 泰勒展开" }] })
    ).toBe("Search the web for: 泰勒展开");
  });

  it("取最后一条 user 消息", () => {
    expect(
      extractSearchQuery({
        messages: [
          { role: "user", content: "旧的" },
          { role: "assistant", content: "嗯" },
          { role: "user", content: "Perform a web search for the query: 新的" },
        ],
      })
    ).toBe("新的");
  });

  it("没有 user 消息时给空串（调用方据此判失败，不发空查询）", () => {
    expect(extractSearchQuery({ messages: [{ role: "assistant", content: "hi" }] })).toBe("");
    expect(extractSearchQuery({})).toBe("");
  });
});

describe("域名过滤 —— 模型传了 allowed/blocked 就得守", () => {
  it("从服务端工具声明里取出两张名单", () => {
    expect(
      extractDomainFilters({
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            allowed_domains: ["gov.cn"],
            blocked_domains: ["spam.example"],
          },
        ],
      })
    ).toEqual({ allowedDomains: ["gov.cn"], blockedDomains: ["spam.example"] });
  });

  it("没有名单时返回空对象（过滤器为空 ⇒ 原样放行）", () => {
    expect(extractDomainFilters(nestedSearchBody())).toEqual({});
    expect(filterHitsByDomain(HITS, {})).toEqual(HITS);
  });

  it("allowed 是白名单：不在名单内一律丢", () => {
    const out = filterHitsByDomain(HITS, { allowedDomains: ["cma.gov.cn"] });
    expect(out.map((h) => h.url)).toEqual(["https://sh.cma.gov.cn/"]);
  });

  it("子域命中父域，但 notexample.com 不命中 example.com（常见匹配错误）", () => {
    const hits: SearchHit[] = [
      { title: "a", url: "https://www.example.com/x", snippet: "" },
      { title: "b", url: "https://notexample.com/y", snippet: "" },
    ];
    const out = filterHitsByDomain(hits, { allowedDomains: ["example.com"] });
    expect(out.map((h) => h.url)).toEqual(["https://www.example.com/x"]);
  });

  it("blocked 优先于 allowed", () => {
    const out = filterHitsByDomain(HITS, {
      allowedDomains: ["weather.com.cn", "cma.gov.cn"],
      blockedDomains: ["weather.com.cn"],
    });
    expect(out.map((h) => h.url)).toEqual(["https://sh.cma.gov.cn/"]);
  });

  it("有过滤要求时，URL 解析不了的条目丢掉（宁缺勿滥）", () => {
    const hits: SearchHit[] = [{ title: "坏", url: "not a url", snippet: "" }];
    expect(filterHitsByDomain(hits, { allowedDomains: ["x.com"] })).toEqual([]);
  });
});

describe("合成应答 —— CC 的解析器只认这两种 block", () => {
  it("非流式：server_tool_use + web_search_tool_result，每条带 title/url", () => {
    const msg = buildSearchMessage("上海 天气", HITS, "deepseek-v4-flash") as {
      content: { type: string; content?: unknown }[];
      stop_reason: string;
      model: string;
    };
    expect(msg.content.map((b) => b.type)).toEqual(["server_tool_use", "web_search_tool_result"]);
    expect(msg.stop_reason).toBe("end_turn");
    expect(msg.model).toBe("deepseek-v4-flash");
    const results = msg.content[1]!.content as { type: string; title: string; url: string }[];
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      type: "web_search_result",
      title: "上海天气预报-中国天气网",
      url: "https://www.weather.com.cn/weather/101020100.shtml",
    });
  });

  it("搜索全挂时给 web_search_tool_result_error，不给空数组", () => {
    // 承重取舍：空数组会被 CC 渲染成"搜到了 0 条"，模型很容易据此自己编；
    // 错误对象会被渲染成 `Web search error: <code>`，模型才知道该照实说。
    const msg = buildSearchMessage("q", null, "m") as { content: { content?: unknown }[] };
    expect(msg.content[1]!.content).toEqual({
      type: "web_search_tool_result_error",
      error_code: "unavailable",
    });
    expect(Array.isArray(msg.content[1]!.content)).toBe(false);
  });

  it("流式：帧序 = message_start → block start/delta/stop ×2 → message_delta → message_stop", () => {
    const sse = buildSearchSse("上海 天气", HITS, "m");
    const events = [...sse.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    expect(events).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("流式帧里带得动中文与真 URL，且每帧都是合法 JSON", () => {
    const sse = buildSearchSse("上海 天气", HITS, "m");
    const datas = [...sse.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1]!));
    expect(datas).toHaveLength(8);
    const resultFrame = datas.find(
      (d) => d.content_block?.type === "web_search_tool_result"
    ) as { content_block: { content: { url: string }[] } };
    expect(resultFrame.content_block.content.map((r) => r.url)).toEqual([
      "https://www.weather.com.cn/weather/101020100.shtml",
      "https://sh.cma.gov.cn/",
    ]);
    const queryFrame = datas.find((d) => d.delta?.type === "input_json_delta") as {
      delta: { partial_json: string };
    };
    expect(JSON.parse(queryFrame.delta.partial_json)).toEqual({ query: "上海 天气" });
  });
});

describe("token 与头处理", () => {
  it("Authorization: Bearer 与 x-api-key 两种都认（SDK 两个都可能用）", () => {
    expect(parseShimToken({ authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek` })).toBe("deepseek");
    expect(parseShimToken({ "x-api-key": `${SEARCH_SHIM_PREFIX}glm` })).toBe("glm");
  });

  it("不是 shim 占位符就返回 undefined（真 key 误送到这儿也不会被当 id）", () => {
    expect(parseShimToken({ authorization: "Bearer sk-real-key-value" })).toBeUndefined();
    expect(parseShimToken({ authorization: "Bearer leemo-gw:relay2" })).toBeUndefined();
    expect(parseShimToken({})).toBeUndefined();
  });

  it("转发头：换掉鉴权、去掉逐跳头、保留 anthropic-version/beta", () => {
    const out = buildUpstreamHeaders(
      {
        host: "127.0.0.1:1234",
        "content-length": "999",
        connection: "keep-alive",
        authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek`,
        "x-api-key": `${SEARCH_SHIM_PREFIX}deepseek`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "fine-grained-tool-streaming-2025-05-14",
        "user-agent": "claude-cli/2.1.210",
      },
      "test-key-real-key"
    );
    expect(out.host).toBeUndefined();
    expect(out["content-length"]).toBeUndefined();
    expect(out.connection).toBeUndefined();
    expect(out["anthropic-version"]).toBe("2023-06-01");
    expect(out["anthropic-beta"]).toBe("fine-grained-tool-streaming-2025-05-14");
    expect(out["user-agent"]).toBe("claude-cli/2.1.210");
    expect(out.authorization).toBe("Bearer test-key-real-key");
    expect(out["x-api-key"]).toBeUndefined();
  });

  it("把高级自定义头带到真实上游，但不允许它覆盖主凭据", () => {
    const out = buildUpstreamHeaders(
      { authorization: `Bearer ${SEARCH_SHIM_PREFIX}custom` },
      "sk-provider-key",
      {
        Authorization: "Bearer wrong-custom-value",
        "X-Tenant": "workspace-7",
        Host: "malicious.example",
      },
    );

    expect(out.authorization).toBe("Bearer sk-provider-key");
    expect(out["x-tenant"]).toBe("workspace-7");
    expect(out.host).toBeUndefined();
  });

  it("按 provider 声明把套餐凭据放进 x-api-key，而不是猜测为 Bearer", () => {
    const out = buildUpstreamHeaders(
      { authorization: `Bearer ${SEARCH_SHIM_PREFIX}minimax-token-plan` },
      "sk-plan-key",
      undefined,
      "x-api-key",
    );

    expect(out["x-api-key"]).toBe("sk-plan-key");
    expect(out.authorization).toBeUndefined();
  });

  it("占位符绝不出门 —— 转发头里搜不到 leemo-search:", () => {
    const out = buildUpstreamHeaders({ authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` }, "sk-real");
    expect(JSON.stringify(out)).not.toContain(SEARCH_SHIM_PREFIX);
  });

  it("拼上游 URL 不出双斜杠", () => {
    expect(joinUpstreamUrl("https://api.deepseek.com/anthropic/", "/v1/messages?beta=true")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages?beta=true"
    );
    expect(joinUpstreamUrl("https://api.deepseek.com/anthropic", "v1/messages")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages"
    );
  });
});

describe("chooseSearchWiring —— 三态穷举，永远只有一条搜索路径", () => {
  const cases: {
    enabled: boolean;
    served: boolean;
    native: boolean;
    mcp: boolean;
    why: string;
  }[] = [
    { enabled: false, served: false, native: false, mcp: false, why: "联网关：一个搜索工具都不给" },
    { enabled: false, served: true, native: false, mcp: false, why: "联网关时 shim 在也不给（开关说了不能搜）" },
    { enabled: true, served: true, native: true, mcp: false, why: "联网开 + 本对话走 shim：走内置，不要 MCP" },
    { enabled: true, served: false, native: false, mcp: true, why: "联网开 + 本对话不走 shim：退回 MCP 兜底" },
  ];

  for (const c of cases) {
    it(`enabled=${c.enabled} served=${c.served} → ${c.why}`, () => {
      expect(
        chooseSearchWiring({ enabled: c.enabled, shimServesThisConversation: c.served })
      ).toEqual({ allowNativeWebSearch: c.native, registerMcp: c.mcp });
    });
  }

  it("四种组合里没有一种同时开两条路（这才是这个函数存在的理由）", () => {
    for (const enabled of [true, false]) {
      for (const served of [true, false]) {
        const w = chooseSearchWiring({ enabled, shimServesThisConversation: served });
        expect(w.allowNativeWebSearch && w.registerMcp).toBe(false);
      }
    }
  });

  it("联网开时一定有恰好一条路（不会两条都关，否则 momo 说能搜却搜不了）", () => {
    for (const served of [true, false]) {
      const w = chooseSearchWiring({ enabled: true, shimServesThisConversation: served });
      expect(Number(w.allowNativeWebSearch) + Number(w.registerMcp)).toBe(1);
    }
  });

  it("「不走 shim」永不放行内置 WebSearch —— 网关剥掉服务端工具后它只会给空壳", () => {
    // 这条单独写，因为它是我自己引进又抓到的 bug：shim 是 host 级的，但 openai
    // 家的对话走网关、不经过 shim。只判"shim 起来了"就会在那些家放行内置工具。
    const w = chooseSearchWiring({ enabled: true, shimServesThisConversation: false });
    expect(w.allowNativeWebSearch).toBe(false);
    expect(w.registerMcp).toBe(true);
  });
});

// ── 真 socket 集成 ────────────────────────────────────────────────────────
// 纯函数绿不等于服务能跑。透传是这张卡最容易静默坏掉的一层（它挡在**所有**
// 对话前面），所以这一组起真 HTTP server、真假上游、真 fetch。

interface FakeUpstream {
  url: string;
  hits: { method: string; path: string; auth?: string; xkey?: string; tenant?: string; body: string }[];
  close(): Promise<void>;
}

async function startFakeUpstream(
  respond?: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void
): Promise<FakeUpstream> {
  const http = await import("node:http");
  const hits: FakeUpstream["hits"] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({
        method: req.method ?? "",
        path: req.url ?? "",
        auth: typeof req.headers.authorization === "string" ? req.headers.authorization : undefined,
        xkey: typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined,
        tenant: typeof req.headers["x-tenant"] === "string" ? req.headers["x-tenant"] : undefined,
        body,
      });
      if (respond) return respond(req, res);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: body.length }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/anthropic`,
    hits,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

describe("startSearchShim —— 真 socket", () => {
  it("普通 Anthropic 对话也会透传 provider 自定义头并使用声明的认证头", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => ({
        baseUrl: upstream.url,
        apiKey: "test-key-plan",
        apiKeyHeader: "x-api-key",
        headers: { "X-Tenant": "workspace-7" },
      }),
      runSearch: async () => HITS,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SEARCH_SHIM_PREFIX}plan` },
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hello" }] }),
      });
      expect(res.status).toBe(200);
      expect(upstream.hits).toHaveLength(1);
      expect(upstream.hits[0]).toMatchObject({
        auth: undefined,
        xkey: "test-key-plan",
        tenant: "workspace-7",
      });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("嵌套搜索请求：本地答掉，**上游一次都没被碰过**", async () => {
    const upstream = await startFakeUpstream();
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages?beta=true`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek` },
        body: JSON.stringify(nestedSearchBody({ stream: false })),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { content: { type: string }[] };
      expect(json.content.map((b) => b.type)).toEqual(["server_tool_use", "web_search_tool_result"]);
      expect(runSearch).toHaveBeenCalledWith("上海 今天 天气");
      // 承重断言：搜索**不该**产生任何上游流量。若哪天判据失效、请求被透传，
      // 上游会收到一条 —— 这条断言就会红。
      expect(upstream.hits).toHaveLength(0);
      expect(shim.stats()).toMatchObject({ searchesAnswered: 1, passedThrough: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("stream:true 时回 SSE，stream 缺省时回 JSON", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch: async () => HITS,
    });
    try {
      const streamed = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: JSON.stringify(nestedSearchBody({ stream: true })),
      });
      expect(streamed.headers.get("content-type")).toContain("text/event-stream");
      expect(await streamed.text()).toContain("event: message_start");

      const plain = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: JSON.stringify(nestedSearchBody({ stream: false })),
      });
      expect(plain.headers.get("content-type")).toContain("application/json");
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("搜索全挂：回错误 block（不是空数组），stats 记 failed", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch: async () => null,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: JSON.stringify(nestedSearchBody({ stream: false })),
      });
      const json = (await res.json()) as { content: { content?: unknown }[] };
      expect(json.content[1]!.content).toMatchObject({ type: "web_search_tool_result_error" });
      expect(shim.stats()).toMatchObject({ searchesFailed: 1, searchesAnswered: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("搜索源抛异常也不 500 —— 降级成「搜索失败」这一种可解释的结果", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch: async () => {
        throw new Error("anysearch HTTP 500");
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: JSON.stringify(nestedSearchBody({ stream: false })),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { content: { content?: unknown }[] };
      expect(json.content[1]!.content).toMatchObject({ type: "web_search_tool_result_error" });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("普通对话请求：原样透传（方法/路径/body 逐字节），响应回得来", async () => {
    const upstream = await startFakeUpstream();
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch,
    });
    try {
      const body = JSON.stringify(normalConversationBody());
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages?beta=true`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek` },
        body,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, echo: body.length });
      expect(upstream.hits).toHaveLength(1);
      expect(upstream.hits[0]).toMatchObject({ method: "POST", path: "/anthropic/v1/messages?beta=true" });
      expect(upstream.hits[0]!.body).toBe(body);
      // 对话请求绝不该触发搜索
      expect(runSearch).not.toHaveBeenCalled();
      expect(shim.stats()).toMatchObject({ passedThrough: 1, searchesAnswered: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("上游收到的是**真 key**，占位符不出门", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real-key-value" }),
      runSearch: async () => HITS,
    });
    try {
      await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek` },
        body: JSON.stringify(normalConversationBody()),
      });
      expect(upstream.hits[0]!.auth).toBe("Bearer test-key-real-key-value");
      expect(upstream.hits[0]!.xkey).toBeUndefined();
      expect(JSON.stringify(upstream.hits[0])).not.toContain(SEARCH_SHIM_PREFIX);
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("透传时 SSE 不被缓冲 —— 上游先吐的帧先到", async () => {
    // 这条钉住"哑管道"这个性质。若哪天有人把响应改成先 await text() 再回，
    // 流式打字机效果就会退化成"一次性蹦出来"，而单测通常抓不到。
    const upstream = await startFakeUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: first\ndata: {}\n\n");
      setTimeout(() => {
        res.write("event: second\ndata: {}\n\n");
        res.end();
      }, 120);
    });
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch: async () => HITS,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: JSON.stringify(normalConversationBody()),
      });
      const reader = res.body!.getReader();
      const t0 = Date.now();
      const first = new TextDecoder().decode((await reader.read()).value);
      const firstAt = Date.now() - t0;
      expect(first).toContain("event: first");
      // 第一帧必须在上游那 120ms 的第二帧之前就到手。
      expect(firstAt).toBeLessThan(100);
      await reader.cancel();
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("token 不认识 → 401，且不产生上游流量", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => undefined,
      runSearch: async () => HITS,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}nope` },
        body: JSON.stringify(normalConversationBody()),
      });
      expect(res.status).toBe(401);
      expect(upstream.hits).toHaveLength(0);
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("缺 token → 401（不把无鉴权请求盲转上游）", async () => {
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/never", apiKey: "sk" }),
      runSearch: async () => HITS,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        body: JSON.stringify(normalConversationBody()),
      });
      expect(res.status).toBe(401);
    } finally {
      await shim.close();
    }
  });

  it("上游连不上 → 502，不挂死", async () => {
    const shim = await startSearchShim({
      // 端口 1 上不会有人监听
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/anthropic", apiKey: "test-key" }),
      runSearch: async () => HITS,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: JSON.stringify(normalConversationBody()),
      });
      expect(res.status).toBe(502);
    } finally {
      await shim.close();
    }
  });

  it("非 JSON body 不劫、照常透传（count_tokens 等非对话路径也走这儿）", async () => {
    const upstream = await startFakeUpstream();
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "test-key-real" }),
      runSearch: async () => HITS,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${shim.port}/v1/messages/count_tokens`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}x` },
        body: "not json at all",
      });
      expect(res.status).toBe(200);
      expect(upstream.hits[0]!.path).toBe("/anthropic/v1/messages/count_tokens");
      expect(upstream.hits[0]!.body).toBe("not json at all");
    } finally {
      await shim.close();
      await upstream.close();
    }
  });
});
