// 轮 4 卡 H3 —— 四层降级链与「空壳」判据的测试。
//
// 与 search-shim.test.ts 分文件：那一份钉的是 H2 的形状（判定/提取/合成/透传），
// 这一份钉的是**降级选择**。混在一起会让"哪条测试在保护哪个不变量"看不出来。
import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import {
  judgeNestedJson,
  judgeNestedSse,
  judgeNestedResponse,
  startSearchShim,
  SEARCH_SHIM_PREFIX,
  type SearchPlan,
  type SearchShimHandle,
} from "../../src/host/search-shim";
import type { SearchHit } from "../../src/host/web-search";

// ── 固件：真实响应形状（全部抄自实测，见 smoke/results/native-search-*.json）──

/** DeepSeek/Kimi 的真结果（非流式）。 */
function realJson(urls = ["https://www.nmc.cn/publish/forecast/ASH/shanghai.html"]) {
  return {
    type: "message",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "搜一下" },
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "上海 今天 天气" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_1",
        content: urls.map((url, i) => ({
          type: "web_search_result",
          title: `结果 ${i + 1}`,
          url,
          page_age: null,
          encrypted_content: `vendor-encrypted-${i}`,
        })),
      },
      { type: "text", text: "今天上海 35℃。" },
    ],
    usage: { server_tool_use: { web_search_requests: 1 } },
  };
}

/** GLM/通义 的空壳：HTTP 200、不标 error、零链接、装着模型自己写的话。 */
function shellJson() {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "我无法为您执行实时的网络搜索。作为大语言模型，我没有直接访问互联网的能力。" }],
    usage: { server_tool_use: { web_search_requests: 0 } },
  };
}

function sseOf(blocks: unknown[]): string {
  let out = `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { content: [] } })}\n\n`;
  blocks.forEach((b, index) => {
    out += `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index, content_block: b })}\n\n`;
    out += `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index })}\n\n`;
  });
  out += `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
  return out;
}

const HITS: SearchHit[] = [{ title: "外部源结果", url: "https://external.example.com", snippet: "s" }];
const VENDOR_HITS: SearchHit[] = [{ title: "厂商结果", url: "https://vendor.example.com", snippet: "v" }];
// 刻意没有 DONOR_HITS 这类固件：**shim 侧不存在"别家供货"这个概念**（用户 7/27
// 拍板，见 SearchPlan 的注释）。计划里只有 passthrough + 单个 vendorSearch。

function nestedBody(over: Record<string, unknown> = {}) {
  return {
    model: "deepseek-v4-flash",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    messages: [{ role: "user", content: [{ type: "text", text: "Perform a web search for the query: 上海 今天 天气" }] }],
    ...over,
  };
}

interface FakeUpstream {
  url: string
  bodies: string[];
  close(): Promise<void>;
}

/** 假上游。`respond` 决定它演真结果还是空壳。 */
async function startUpstream(
  respond: (res: http.ServerResponse) => void
): Promise<FakeUpstream> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      bodies.push(body);
      respond(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/anthropic`,
    bodies,
    close: () => new Promise<void>((ok, no) => server.close((e) => (e ? no(e) : ok()))),
  };
}

const sendJson = (obj: unknown) => (res: http.ServerResponse) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

async function postNested(shim: SearchShimHandle, body: Record<string, unknown> = nestedBody()) {
  return fetch(`http://127.0.0.1:${shim.port}/v1/messages?beta=true`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek` },
    body: JSON.stringify(body),
  });
}

// ── 纯核判据 ───────────────────────────────────────────────────────────────

describe("judgeNestedJson —— 空壳判据（承重）", () => {
  it("真结果：有 result block + 带 url 的条目 ⇒ ok", () => {
    expect(judgeNestedJson(realJson(["https://a.example.com", "https://b.example.com"]))).toMatchObject({
      ok: true,
      urlCount: 2,
      hasResultBlock: true,
      hasServerToolUse: true,
    });
  });

  it("空壳：HTTP 200、不标 error、只有 text ⇒ 不 ok，且**不算 errored**（要被记住并降级）", () => {
    expect(judgeNestedJson(shellJson())).toMatchObject({
      ok: false,
      urlCount: 0,
      hasResultBlock: false,
      errored: false,
    });
  });

  it("有 result block 但 content 是空数组 ⇒ 空壳（「搜到 0 条」会让模型据此编造）", () => {
    expect(
      judgeNestedJson({ content: [{ type: "web_search_tool_result", content: [] }] })
    ).toMatchObject({ ok: false, hasResultBlock: true, urlCount: 0, errored: false });
  });

  it("条目缺 url / url 是空串 ⇒ 不计数", () => {
    expect(
      judgeNestedJson({
        content: [
          {
            type: "web_search_tool_result",
            content: [{ type: "web_search_result", title: "无链接" }, { type: "web_search_result", url: "  " }],
          },
        ],
      })
    ).toMatchObject({ ok: false, urlCount: 0 });
  });

  it("上游回搜索错误块 ⇒ errored=true（暂时性，**不该**把这家永久降级）", () => {
    expect(
      judgeNestedJson({
        content: [
          {
            type: "web_search_tool_result",
            content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
          },
        ],
      })
    ).toMatchObject({ ok: false, errored: true });
  });

  it("API 级错误（{type:\"error\"}）⇒ errored=true，同样不判死刑", () => {
    expect(judgeNestedJson({ type: "error", error: { type: "rate_limit_error" } })).toMatchObject({
      ok: false,
      errored: true,
    });
  });

  it("垃圾输入不炸", () => {
    for (const bad of [null, undefined, "text", 42, [], {}]) {
      expect(judgeNestedJson(bad)).toMatchObject({ ok: false });
    }
  });
});

describe("judgeNestedSse —— 流式臂必须单独判", () => {
  it("真结果的 SSE ⇒ ok", () => {
    const raw = sseOf([
      { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", title: "T", url: "https://a.example.com" }],
      },
    ]);
    expect(judgeNestedSse(raw)).toMatchObject({ ok: true, urlCount: 1 });
  });

  it("空壳的 SSE（只有 text block）⇒ 不 ok", () => {
    expect(judgeNestedSse(sseOf([{ type: "text", text: "我不能联网" }]))).toMatchObject({
      ok: false,
      urlCount: 0,
      errored: false,
    });
  });

  it("半截帧/心跳/[DONE] 不影响判定", () => {
    const raw =
      `: keepalive\n\n` +
      `data: {"broken\n\n` +
      `data: [DONE]\n\n` +
      sseOf([
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", title: "T", url: "https://a.example.com" }],
        },
      ]);
    expect(judgeNestedSse(raw)).toMatchObject({ ok: true, urlCount: 1 });
  });

  it("空输入 ⇒ 不 ok", () => {
    expect(judgeNestedSse("")).toMatchObject({ ok: false });
  });
});

describe("judgeNestedResponse —— 按 content-type 分派", () => {
  it("event-stream 走 SSE 判据", () => {
    const raw = sseOf([
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.example.com" }] },
    ]);
    expect(judgeNestedResponse("text/event-stream; charset=utf-8", raw).ok).toBe(true);
  });

  it("json 走 JSON 判据", () => {
    expect(judgeNestedResponse("application/json", JSON.stringify(realJson())).ok).toBe(true);
    expect(judgeNestedResponse("application/json", JSON.stringify(shellJson())).ok).toBe(false);
  });

  it("json 声明但正文不是 JSON ⇒ 不 ok 而不是抛", () => {
    expect(judgeNestedResponse("application/json", "<html>502</html>").ok).toBe(false);
  });

  it("content-type 缺失时两种都试", () => {
    expect(judgeNestedResponse(null, JSON.stringify(realJson())).ok).toBe(true);
    const raw = sseOf([
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.example.com" }] },
    ]);
    expect(judgeNestedResponse(null, raw).ok).toBe(true);
  });
});

// ── 层链端到端 ─────────────────────────────────────────────────────────────

describe("四层降级链", () => {
  it("层①：厂商真结果 ⇒ 原样回给 CC，外部源一次没碰", async () => {
    const upstream = await startUpstream(sendJson(realJson(["https://real.example.com"])));
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
      }),
      runSearch,
    });
    try {
      const res = await postNested(shim);
      const json = (await res.json()) as { content: { type: string; content?: { url?: string; encrypted_content?: string }[] }[] };
      const block = json.content.find((b) => b.type === "web_search_tool_result")!;
      expect(block.content![0]!.url).toBe("https://real.example.com");
      // 承重：厂商的引用元数据原样保留（我们自己合成的假值给不了这个）
      expect(block.content![0]!.encrypted_content).toBe("vendor-encrypted-0");
      expect(runSearch).not.toHaveBeenCalled();
      expect(shim.stats().byLayer).toEqual({ passthrough: 1, vendor: 0, external: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("层① 空壳 ⇒ 落层②（厂商自己的搜索 API），外部源仍未碰", async () => {
    const upstream = await startUpstream(sendJson(shellJson()));
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
        vendorSearch: { id: "glm", search: async () => VENDOR_HITS },
      }),
      runSearch,
    });
    try {
      const res = await postNested(shim);
      const json = (await res.json()) as { content: { type: string; content?: { url?: string }[] }[] };
      expect(json.content.find((b) => b.type === "web_search_tool_result")!.content![0]!.url).toBe(
        "https://vendor.example.com"
      );
      expect(runSearch).not.toHaveBeenCalled();
      expect(shim.stats().byLayer).toMatchObject({ passthrough: 0, vendor: 1, external: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("层② 无结果 ⇒ 落层③ 外部源（**不去借别家**，那是用户否掉的越界）", async () => {
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/unused", apiKey: "k" }),
      resolveSearchPlan: (): SearchPlan => ({
        vendorSearch: { id: "glm", search: async () => [] },
      }),
      runSearch,
    });
    try {
      const res = await postNested(shim);
      const json = (await res.json()) as { content: { type: string; content?: { url?: string }[] }[] };
      expect(json.content.find((b) => b.type === "web_search_tool_result")!.content![0]!.url).toBe(
        "https://external.example.com"
      );
      expect(runSearch).toHaveBeenCalledOnce();
      expect(shim.stats().byLayer).toMatchObject({ vendor: 0, external: 1 });
    } finally {
      await shim.close();
    }
  });

  it("层② 抛异常 ⇒ 落外部源，不 500", async () => {
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/unused", apiKey: "k" }),
      resolveSearchPlan: (): SearchPlan => ({
        vendorSearch: {
          id: "glm",
          search: async () => {
            throw new Error("glm-native HTTP 429");
          },
        },
      }),
      runSearch,
    });
    try {
      const res = await postNested(shim);
      expect(res.status).toBe(200);
      expect(runSearch).toHaveBeenCalledOnce();
      expect(shim.stats().byLayer).toMatchObject({ external: 1 });
    } finally {
      await shim.close();
    }
  });

  it("层①② 全不成立 ⇒ 才落层③ 外部源（兜底仍在）", async () => {
    const upstream = await startUpstream(sendJson(shellJson()));
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
        vendorSearch: { id: "glm", search: async () => null },
      }),
      runSearch,
    });
    try {
      const res = await postNested(shim);
      const json = (await res.json()) as { content: { type: string; content?: { url?: string }[] }[] };
      expect(json.content.find((b) => b.type === "web_search_tool_result")!.content![0]!.url).toBe(
        "https://external.example.com"
      );
      expect(runSearch).toHaveBeenCalledOnce();
      expect(shim.stats().byLayer).toMatchObject({ external: 1 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("四层全挂 ⇒ 回错误块（**不是空数组**），stats 记 failed", async () => {
    const upstream = await startUpstream(sendJson(shellJson()));
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
        vendorSearch: { id: "glm", search: async () => null },
      }),
      runSearch: async () => null,
    });
    try {
      const res = await postNested(shim);
      expect(res.status).toBe(200);
      const json = (await res.json()) as { content: { content?: unknown }[] };
      expect(json.content[1]!.content).toMatchObject({ type: "web_search_tool_result_error" });
      expect(shim.stats()).toMatchObject({ searchesFailed: 1, searchesAnswered: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("无 resolveSearchPlan ⇒ 只有层④（H2 旧行为不回归）", async () => {
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/unused", apiKey: "k" }),
      runSearch,
    });
    try {
      await postNested(shim);
      expect(runSearch).toHaveBeenCalledOnce();
      expect(shim.stats().byLayer).toMatchObject({ external: 1, passthrough: 0 });
    } finally {
      await shim.close();
    }
  });
});

describe("硬边界：这一家不能搜就掉外部源，不花别家的额度", () => {
  it("层①空壳 + 无 vendorSearch ⇒ 直落外部源（哪怕别家配得再全）", async () => {
    // 通义那种情形。计划由 buildSearchPlan 保证只含自己那家；这里从 shim 侧再钉一遍：
    // 即便 plan 只有一个失败的 passthrough，shim 也只会往外部源走，不会去问"还有谁"。
    const upstream = await startUpstream(sendJson(shellJson()));
    const runSearch = vi.fn(async () => HITS);
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({ passthrough: { baseUrl: upstream.url, apiKey: "sk-real" } }),
      runSearch,
    });
    try {
      const res = await postNested(shim);
      const json = (await res.json()) as { content: { type: string; content?: { url?: string }[] }[] };
      expect(json.content.find((b) => b.type === "web_search_tool_result")!.content![0]!.url).toBe(
        "https://external.example.com"
      );
      expect(shim.stats().byLayer).toEqual({ passthrough: 0, vendor: 0, external: 1 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("byLayer 只有三格 —— 没有任何「跨家」计数可言", async () => {
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/unused", apiKey: "k" }),
      runSearch: async () => HITS,
    });
    try {
      expect(Object.keys(shim.stats().byLayer).sort()).toEqual(["external", "passthrough", "vendor"]);
    } finally {
      await shim.close();
    }
  });
});

describe("stats() 是快照，不是活引用", () => {
  it("两次 stats() 之间的 byLayer 差值真的反映这期间发生的事", async () => {
    // 回归测试：stats() 曾经浅拷 => byLayer 交出去的是活对象，前后差恒为 0。
    // live 验收脚本（smoke/websearch-vendor-native-live.mjs）就是靠这个差值判定
    // "走的是哪一层"，浅拷会让每一臂都误报 FAIL，而单测看单次绝对值抓不到。
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/unused", apiKey: "k" }),
      resolveSearchPlan: (): SearchPlan => ({
        vendorSearch: { id: "glm", search: async () => VENDOR_HITS },
      }),
      runSearch: async () => HITS,
    });
    try {
      const before = shim.stats();
      await postNested(shim);
      const after = shim.stats();
      expect(after.byLayer.vendor - before.byLayer.vendor).toBe(1);
      expect(before.byLayer.vendor).toBe(0); // 旧快照不该被后来的搜索改写
      expect(after.byLayer).not.toBe(before.byLayer);
    } finally {
      await shim.close();
    }
  });
});

describe("空壳记忆 —— 别每轮白花一次模型生成", () => {
  it("同一上游第二次请求直接跳过层①（上游只被打一次）", async () => {
    const upstream = await startUpstream(sendJson(shellJson()));
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
        vendorSearch: { id: "glm", search: async () => VENDOR_HITS },
      }),
      runSearch: async () => HITS,
    });
    try {
      await postNested(shim);
      await postNested(shim);
      await postNested(shim);
      // 第一次探到空壳并记住 ⇒ 后两次不再打上游
      expect(upstream.bodies).toHaveLength(1);
      expect(shim.stats().byLayer).toMatchObject({ vendor: 3, passthrough: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("**暂时性**失败不记忆：上游回搜索错误块 ⇒ 下一轮仍会重试层①", async () => {
    // 这条是承重测试。把一次限流记成"这家不行"会永久废掉用户的原生搜索。
    let turn = 0;
    const upstream = await startUpstream((res) => {
      turn++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          turn === 1
            ? {
                type: "message",
                content: [
                  {
                    type: "web_search_tool_result",
                    content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
                  },
                ],
              }
            : realJson(["https://recovered.example.com"])
        )
      );
    });
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
        vendorSearch: { id: "glm", search: async () => VENDOR_HITS },
      }),
      runSearch: async () => HITS,
    });
    try {
      await postNested(shim); // 限流 → 落层②
      const second = await postNested(shim); // 恢复 → 层① 该重新可用
      const json = (await second.json()) as { content: { type: string; content?: { url?: string }[] }[] };
      expect(json.content.find((b) => b.type === "web_search_tool_result")!.content![0]!.url).toBe(
        "https://recovered.example.com"
      );
      expect(upstream.bodies).toHaveLength(2);
      expect(shim.stats().byLayer).toMatchObject({ passthrough: 1, vendor: 1 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("非 2xx 也不记忆（欠费/限流恢复后要能自己回来）", async () => {
    let turn = 0;
    const upstream = await startUpstream((res) => {
      turn++;
      if (turn === 1) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(realJson(["https://recovered.example.com"])));
    });
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
      }),
      runSearch: async () => HITS,
    });
    try {
      await postNested(shim);
      await postNested(shim);
      expect(shim.stats().byLayer).toMatchObject({ passthrough: 1, external: 1 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("上游连不上（网络层）不记忆，也不 500", async () => {
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/dead", apiKey: "k" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: "http://127.0.0.1:1/dead", apiKey: "k" },
      }),
      runSearch: async () => HITS,
    });
    try {
      const res = await postNested(shim);
      expect(res.status).toBe(200);
      expect(shim.stats().byLayer).toMatchObject({ external: 1 });
    } finally {
      await shim.close();
    }
  });
});

describe("层① 与流式 / 域名过滤的交互", () => {
  it("CC 要 SSE 而层① 成立 ⇒ 上游的 SSE 原样回（content-type 也照抄）", async () => {
    const sseBody = sseOf([
      { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", title: "T", url: "https://streamed.example.com" }],
      },
    ]);
    const upstream = await startUpstream((res) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end(sseBody);
    });
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
      }),
      runSearch: async () => HITS,
    });
    try {
      const res = await postNested(shim, nestedBody({ stream: true }));
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(await res.text()).toContain("https://streamed.example.com");
      expect(shim.stats().byLayer).toMatchObject({ passthrough: 1 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("层① 的流式空壳同样被判出来 ⇒ 落层②，且我们自己合成 SSE 回去", async () => {
    const upstream = await startUpstream((res) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end(sseOf([{ type: "text", text: "我不能联网搜索" }]));
    });
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan: (): SearchPlan => ({
        passthrough: { baseUrl: upstream.url, apiKey: "sk-real" },
        vendorSearch: { id: "glm", search: async () => VENDOR_HITS },
      }),
      runSearch: async () => HITS,
    });
    try {
      const res = await postNested(shim, nestedBody({ stream: true }));
      const text = await res.text();
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(text).toContain("event: message_start");
      expect(text).toContain("https://vendor.example.com");
      expect(shim.stats().byLayer).toMatchObject({ vendor: 1 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });

  it("层② 的结果照样守域名过滤器；全被过滤掉就降级到外部源", async () => {
    const body = nestedBody({
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 8,
          allowed_domains: ["external.example.com"],
        },
      ],
    });
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: "http://127.0.0.1:1/unused", apiKey: "k" }),
      resolveSearchPlan: (): SearchPlan => ({
        vendorSearch: { id: "glm", search: async () => VENDOR_HITS }, // vendor.example.com ⇒ 被过滤掉
      }),
      runSearch: async () => HITS,
    });
    try {
      const res = await postNested(shim, body);
      const json = (await res.json()) as { content: { type: string; content?: { url?: string }[] }[] };
      const urls = json.content.find((b) => b.type === "web_search_tool_result")!.content!.map((c) => c.url);
      expect(urls).toEqual(["https://external.example.com"]);
      expect(shim.stats().byLayer).toMatchObject({ vendor: 0, external: 1 });
    } finally {
      await shim.close();
    }
  });

  it("普通对话请求不受影响：仍原样透传、不触发任何一层", async () => {
    const upstream = await startUpstream(sendJson({ ok: true }));
    const resolveSearchPlan = vi.fn((): SearchPlan => ({}));
    const shim = await startSearchShim({
      resolveUpstream: () => ({ baseUrl: upstream.url, apiKey: "sk-real" }),
      resolveSearchPlan,
      runSearch: async () => HITS,
    });
    try {
      await fetch(`http://127.0.0.1:${shim.port}/v1/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${SEARCH_SHIM_PREFIX}deepseek` },
        body: JSON.stringify({
          model: "m",
          tools: [{ name: "Read" }, { name: "WebSearch" }],
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(resolveSearchPlan).not.toHaveBeenCalled();
      expect(shim.stats()).toMatchObject({ passedThrough: 1, searchesAnswered: 0 });
    } finally {
      await shim.close();
      await upstream.close();
    }
  });
});
