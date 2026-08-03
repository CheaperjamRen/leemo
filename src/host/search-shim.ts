// Leemo 搜索 shim —— 让 **CC 内置的 WebSearch** 在国内网络、任意 provider 下
// 真的能用，而不必教用户配 VPN 或 MCP（轮 4 卡 H2）。
//
// ── 它解决的到底是什么问题 ────────────────────────────────────────────────
//
// 内置 WebSearch 不是"CC 自己去搜"，也不是"由对话那次 API 调用顺便搜"。实测
// （smoke/websearch-nested-probe.mjs，本地假上游，确定可复跑）流程是：
//
//   ① CC 把 `WebSearch` 当**客户端工具**发给上游（tools[] 里无 type 的普通函数
//      工具，和 Read/Write 并列）。
//   ② 模型调用它 → CC 在**本地**执行该工具，做法是**另发一次** `/v1/messages
//      ?beta=true` 请求，body 里只有一个工具：`{type:"web_search_20250305",
//      name:"web_search", max_uses:8}`，messages 只有一条
//      `"Perform a web search for the query: <用户的查询>"`。
//   ③ CC 从那次响应里挑 `server_tool_use` / `web_search_tool_result` 两种 block，
//      渲染成 `Links:[{title,url}]` 交回模型。
//
// 也就是说：**搜索是由"上游端点实现服务端工具"完成的**。
//
// 关键发现：**那次嵌套请求发往 `ANTHROPIC_BASE_URL`，也就是我们自己能决定的
// 地址**，不是硬编码的 api.anthropic.com。所以我们可以把它接下来。
//
// ── 三层降级链（轮 4 卡 H3）────────────────────────────────────────────────
//
// 卡 H2 把这个"接下来"做成了**无条件**用外部源（AnySearch/Tavily）答掉，于是
// "原生"只剩工具名，而且对 DeepSeek 是**功能倒退** —— 它本来就会自己搜。
// 用户的产品要求很明确：外部源是最后的兜底，一定要打通厂商自己的搜索、花用户
// 自己的额度。于是改成按层降级（逐家实测见 smoke/probe-native-search-l1.mjs、
// -l2.mjs、-qwen.mjs、-stream.mjs，结果 JSON 在 smoke/results/）：
//
//   层① 透传   请求原样转发给用户配的那家 → 判是真结果还是空壳
//              ✅ DeepSeek（10 url，usage.web_search_requests=1）
//              ✅ Kimi（14 url；台账 §⑧ 从没测过它，本轮新发现）
//   层② 自家搜索 API   兼容层没实现、但**这一家自己**有独立搜索服务 ⇒ 转译
//              ✅ GLM `/paas/v4/web_search`（10 条 / 609~1558ms）
//   层③ 外部源  AnySearch → Tavily。这一家原生搜索确实没有/挂了才走。
//
// **只有这一家自己的两条路，没有第三家。**（用户 7/27 拍板，见 SearchPlan 上的注释：
// 用户选了这个 API 就是只想花这个 API 的额度，自动去花另一家的钱是越界，宁可掉外部
// 服务。我原先做的"跨家借"那一层已按此删除，且在类型上不再存在。）
//
// 层① 排第一是因为只有它能把厂商原生的引用元数据（encrypted_content 等）完整交给
// CC；全程不必开 VPN、不必装 MCP、不碰 claude.ai。
//
// ── 这个 shim 的职责边界（刻意窄）──────────────────────────────────────────
//
// 除了"那一种嵌套搜索请求"，其它请求一概**原样透传**：不解析、不改写、不缓冲
// 响应。它不是网关（不做协议翻译），只是一根认得出搜索请求的哑管道。
//
// 顺带一个安全升级：走 shim 后 SDK 子进程里的 token 是占位符
// `leemo-search:<id>`，provider 真 key 只存在于本进程的注册表里 —— 比原先的
// 直连接线（真 key 进子进程 env，子进程能跑 bash ⇒ printenv 可读）更严。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SearchHit } from "./web-search";

/** SDK 子进程里出现的占位 token 前缀。与网关的 `leemo-gw:` 刻意不同 —— 一个
 *  token 走错了注册表要立刻 401，而不是在另一边被将错就错地解析掉。 */
export const SEARCH_SHIM_PREFIX = "leemo-search:";

/** 一个被 shim 代理的上游。apiKey 是真 key，只在本进程内存在。 */
export interface SearchShimUpstream {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader?: "authorization" | "x-api-key";
  headers?: Record<string, string>;
}

export interface SearchShimLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** 层②：**本对话这一家自己的**搜索 API。 */
export interface VendorSearchCandidate {
  /** provider id，仅用于日志与 live 验收。不进模型上下文。 */
  id: string;
  /** null = 这次没搜到/挂了，降级到层③。 */
  search(query: string): Promise<SearchHit[] | null>;
}

/**
 * 一次嵌套搜索请求的降级计划。由 bridge-host 从**活的** catalog 现算。
 *
 * shim 刻意不认识 catalog：它只按计划逐层试。这样"哪家能搜"是可测的数据，
 * "怎么降级"是可测的逻辑，两者不缠在一起。
 *
 * ── 为什么 `vendorSearch` 是**单个**而不是列表（用户 7/27 拍板的边界）─────────
 *
 * 我原本做成了候选列表，好让"这家不能搜时借另一家已配置的 provider"。用户否掉了：
 * **用户选了这个 API 就是只想用这个 API 的额度**，自动去花另一家的钱是越界 ——
 * 比掉到外部服务更坏，因为那笔钱他没同意花。宁可掉 Tavily/AnySearch。
 *
 * 所以这里刻意做成单个槽位而不是"列表但只放一个"：**跨家候选在类型上就不存在**，
 * 将来谁想加回来必须先改契约，而不是往数组里 push 一个。
 */
export interface SearchPlan {
  /** 层①：把嵌套请求**原样**转发给这个上游。undefined ⇒ 跳过层①。 */
  passthrough?: SearchShimUpstream;
  /** 层②：本对话这一家自己的搜索 API。undefined ⇒ 它没有。 */
  vendorSearch?: VendorSearchCandidate;
}

export interface SearchShimDeps {
  /** 占位 token → 真上游。返回 undefined ⇒ 401（token 不认识）。 */
  resolveUpstream(id: string): SearchShimUpstream | undefined;
  /** 现算这次搜索的降级计划。省略 ⇒ 只有层③外部源（卡 H2 的旧行为）。 */
  resolveSearchPlan?(id: string): SearchPlan;
  /** 层③：外部源（AnySearch→Tavily）。返回 null = 全挂（要让模型知道"搜索失败
   *  了"，而不是收到一个空列表当成"网上没有"）。 */
  runSearch(query: string): Promise<SearchHit[] | null>;
  fetchFn?: typeof fetch;
  logger?: SearchShimLogger;
}

/** 每一层各答成了几次 —— live 验收靠它证明"真的走的是厂商原生那条路"。 */
export interface SearchLayerStats {
  /** 层①：厂商自己的端点答的（响应原样回给 CC）。 */
  passthrough: number;
  /** 层②：本对话这一家自己的搜索 API。 */
  vendor: number;
  /** 层③：外部源。只在这一家原生搜索确实没有/挂了时才该增长。 */
  external: number;
}

export interface SearchShimHandle {
  port: number;
  /** 本 shim 收到过几次嵌套搜索请求 —— live 验收要能证明"真的走了这条路"。 */
  stats(): {
    searchesAnswered: number;
    searchesFailed: number;
    passedThrough: number;
    byLayer: SearchLayerStats;
  };
  close(): Promise<void>;
}

const NOOP_LOGGER: SearchShimLogger = { info: () => {}, warn: () => {}, error: () => {} };

// ── 纯核：判定与提取 ───────────────────────────────────────────────────────

/** 请求体里我们关心的那几个字段。刻意不建完整的 Anthropic 请求类型 —— 这个
 *  文件只透传，不理解对话。 */
interface PeekedBody {
  model?: unknown;
  stream?: unknown;
  tools?: unknown;
  messages?: unknown;
}

/**
 * 这是不是 CC 的"嵌套服务端工具搜索"请求？
 *
 * 判据：tools 非空，且**每一个** tool 都带 `type` 且以 `web_search_` 开头。
 * 为什么这样就够严：普通对话请求一定带一长串**客户端**工具（实测 26 个，全都
 * 没有 `type` 字段）；而这个嵌套请求实测 `tools` 长度恰为 1、客户端工具 0 个。
 * 两者形状上不可能混淆。
 *
 * 为什么不去匹配 `web_search_20250305` 这个具体版本号：Anthropic 已经在出
 * `web_search_20260209`（见 CLI 内置 skill 文档里的 API-drift 表），钉死版本号
 * 等于给自己埋一个"某天静默不生效"的雷。前缀匹配对新版本天然成立。
 */
export function isNestedSearchRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const tools = (body as PeekedBody).tools;
  if (!Array.isArray(tools) || tools.length === 0) return false;
  return tools.every((t) => {
    const type = (t as { type?: unknown } | null)?.type;
    return typeof type === "string" && type.startsWith("web_search_");
  });
}

/** CC 给搜索子 agent 的固定开场白。用于剥掉它、只留用户真正的查询。 */
const QUERY_PREFIX = /^\s*perform a web search for the query:\s*/i;

/**
 * 从嵌套请求里取出查询词。
 *
 * 取的是**最后一条 user 消息的文本**，而不是工具输入 —— 实测查询就放在那里
 * （`messages:[{role:"user",content:[{type:"text",text:"Perform a web search
 * for the query: 上海 今天 天气"}]}]`），服务端工具的 input 由上游自己填。
 *
 * 前缀剥不掉时**返回整段文本**而不是失败：CC 改一句话术不该让搜索停摆，多带
 * 几个词的查询远好过没有查询。
 */
export function extractSearchQuery(body: unknown): string {
  const messages = (body as PeekedBody | null)?.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown } | null;
    if (!m || m.role !== "user") continue;
    const text = collectText(m.content);
    if (text) return text.replace(QUERY_PREFIX, "").trim();
  }
  return "";
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown } | null;
    if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n").trim();
}

/** 服务端工具声明上的域名过滤器。模型传了就得守 —— 这是工具契约的一部分。 */
export interface DomainFilters {
  allowedDomains?: string[];
  blockedDomains?: string[];
}

export function extractDomainFilters(body: unknown): DomainFilters {
  const tools = (body as PeekedBody | null)?.tools;
  if (!Array.isArray(tools)) return {};
  const out: DomainFilters = {};
  for (const t of tools) {
    const tool = t as { allowed_domains?: unknown; blocked_domains?: unknown } | null;
    const allowed = strings(tool?.allowed_domains);
    const blocked = strings(tool?.blocked_domains);
    if (allowed.length) out.allowedDomains = [...(out.allowedDomains ?? []), ...allowed];
    if (blocked.length) out.blockedDomains = [...(out.blockedDomains ?? []), ...blocked];
  }
  return out;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
}

/** 域名是否匹配某个模式。`example.com` 命中 `www.example.com`（子域），
 *  但不命中 `notexample.com` —— 后者是常见的匹配错误。 */
function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const p = pattern.toLowerCase().replace(/^www\./, "").replace(/^\*\./, "");
  return h === p || h.endsWith(`.${p}`);
}

/** 按 allowed/blocked 过滤。allowed 存在时是白名单（不在名单内一律丢）。 */
export function filterHitsByDomain(hits: SearchHit[], filters: DomainFilters): SearchHit[] {
  const { allowedDomains, blockedDomains } = filters;
  if (!allowedDomains?.length && !blockedDomains?.length) return hits;
  return hits.filter((h) => {
    let host: string;
    try {
      host = new URL(h.url).hostname;
    } catch {
      return false; // URL 解析不了的条目在有过滤要求时一律不要
    }
    if (blockedDomains?.some((p) => hostMatches(host, p))) return false;
    if (allowedDomains?.length) return allowedDomains.some((p) => hostMatches(host, p));
    return true;
  });
}

// ── 纯核：判上游的嵌套搜索应答是真结果还是空壳 ─────────────────────────────
//
// 这是整张卡的承重判据。台账反复点名的失败形态是**空壳**：HTTP 200、不标 error、
// `web_search_tool_result` 里装着模型自己写的话、零链接。只看状态码或 is_error
// 会把它判成"可用"，然后模型照着编造来源 —— 比报错危险得多。
//
// 实测形状（smoke/probe-native-search-l1.mjs / -stream.mjs，2026-07-27）：
//   DeepSeek/Kimi 真结果 → content:[thinking?, server_tool_use,
//                            web_search_tool_result{content:[{url,…}×N]}, text]
//   GLM/通义 空壳        → content:[text]，零 server_tool_use、零结果块

export interface NestedVerdict {
  /** 承重判据：有 `web_search_tool_result` 且其 content 数组里有带 url 的条目。 */
  ok: boolean;
  urlCount: number;
  hasResultBlock: boolean;
  hasServerToolUse: boolean;
  /** 上游明确回了 `web_search_tool_result_error`。这是**暂时性**失败（限流/额度），
   *  与"这家结构上就没实现"必须分开 —— 后者才该被记住并永久降级。 */
  errored: boolean;
}

function emptyVerdict(): NestedVerdict {
  return { ok: false, urlCount: 0, hasResultBlock: false, hasServerToolUse: false, errored: false };
}

/** 扫一串 content block（JSON 响应的 content，或 SSE 里收集到的 block）。 */
function judgeBlocks(blocks: unknown[]): NestedVerdict {
  const v = emptyVerdict();
  for (const block of blocks) {
    const b = block as { type?: unknown; content?: unknown } | null;
    if (!b || typeof b.type !== "string") continue;
    if (b.type === "server_tool_use") v.hasServerToolUse = true;
    if (b.type !== "web_search_tool_result") continue;
    v.hasResultBlock = true;
    const c = b.content;
    if (Array.isArray(c)) {
      for (const item of c) {
        const url = (item as { url?: unknown } | null)?.url;
        if (typeof url === "string" && url.trim()) v.urlCount++;
      }
    } else if (c && typeof c === "object") {
      // 非数组 content ⇒ 只可能是 web_search_tool_result_error。
      v.errored = true;
    }
  }
  v.ok = v.hasResultBlock && v.urlCount > 0;
  return v;
}

/** 非流式：一条完整 Message。 */
export function judgeNestedJson(json: unknown): NestedVerdict {
  if (!json || typeof json !== "object") return emptyVerdict();
  const o = json as { type?: unknown; content?: unknown };
  // API 级错误（`{type:"error",…}`）是暂时性的，不能拿它给这家判死刑。
  if (o.type === "error") return { ...emptyVerdict(), errored: true };
  return judgeBlocks(Array.isArray(o.content) ? o.content : []);
}

/**
 * 流式：从 SSE 原文里把 `content_block_start` 的 content_block 收集出来再判。
 *
 * 为什么必须单独判流式：CC 真实发出的嵌套请求带 `stream:true`，而 shim 走原样
 * 透传 ⇒ **真正会跑的是这条路**。一家在 JSON 模式实现了服务端工具、在 SSE 模式
 * 没实现，只测 JSON 就会漏。（本轮两家的 SSE 臂都单独实测过。）
 */
export function judgeNestedSse(raw: string): NestedVerdict {
  const blocks: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let ev: unknown;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue; // 半截帧/心跳，跳过
    }
    const cb = (ev as { content_block?: unknown } | null)?.content_block;
    if (cb && typeof cb === "object") blocks.push(cb);
  }
  return judgeBlocks(blocks);
}

/** 按 content-type 分派。认不出就当 SSE 扫一遍再当 JSON 试 —— 两种都不匹配时
 *  返回空判决（= 不可用但不算"结构上没实现"，留给上层决定）。 */
export function judgeNestedResponse(contentType: string | null, raw: string): NestedVerdict {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/event-stream")) return judgeNestedSse(raw);
  if (ct.includes("json")) {
    try {
      return judgeNestedJson(JSON.parse(raw));
    } catch {
      return emptyVerdict();
    }
  }
  // content-type 缺失/古怪：两种都试，任一成立就算。
  const asSse = judgeNestedSse(raw);
  if (asSse.ok) return asSse;
  try {
    return judgeNestedJson(JSON.parse(raw));
  } catch {
    return asSse;
  }
}

// ── 纯核：合成 CC 认得的应答 ───────────────────────────────────────────────

const SERVER_TOOL_USE_ID = "srvtoolu_leemo_search";

/** `web_search_tool_result` 的 content。hits 为 null（搜索全挂）时给**错误
 *  对象**而不是空数组 —— CC 的解析器对非数组 content 会渲染成
 *  `Web search error: <code>` 交给模型，那正是我们要的"照实说没搜到"。
 *  给空数组则会变成"搜到了 0 条"，模型很容易据此自己编。 */
function toolResultContent(hits: SearchHit[] | null): unknown {
  if (hits === null) {
    return { type: "web_search_tool_result_error", error_code: "unavailable" };
  }
  return hits.map((h) => ({
    type: "web_search_result",
    title: h.title,
    url: h.url,
    page_age: null,
    // CC 只读 title/url（解析器 szg 逐字段挑），但真 Anthropic 响应里有这个
    // 字段，保留一个占位值以免哪天有校验。
    encrypted_content: "leemo-local-search",
  }));
}

function contentBlocks(query: string, hits: SearchHit[] | null): unknown[] {
  return [
    { type: "server_tool_use", id: SERVER_TOOL_USE_ID, name: "web_search", input: { query } },
    { type: "web_search_tool_result", tool_use_id: SERVER_TOOL_USE_ID, content: toolResultContent(hits) },
  ];
}

/** 非流式应答：一条完整 Message。 */
export function buildSearchMessage(query: string, hits: SearchHit[] | null, model: string): unknown {
  return {
    id: "msg_leemo_search",
    type: "message",
    role: "assistant",
    model,
    content: contentBlocks(query, hits),
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * 流式应答：完整的一串 SSE 帧。
 *
 * 帧序照真 Anthropic 流：message_start → 每个 block 的 start/(delta)/stop →
 * message_delta → message_stop。`server_tool_use` 的 input 走
 * `input_json_delta`（实测 CC 接受这一形状，且这就是真上游的做法）。
 */
export function buildSearchSse(query: string, hits: SearchHit[] | null, model: string): string {
  const blocks = contentBlocks(query, hits) as { type: string; [k: string]: unknown }[];
  let out = sseFrame("message_start", {
    type: "message_start",
    message: {
      id: "msg_leemo_search",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  blocks.forEach((block, index) => {
    if (block.type === "server_tool_use") {
      out += sseFrame("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "server_tool_use", id: block.id, name: block.name, input: {} },
      });
      out += sseFrame("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    } else {
      out += sseFrame("content_block_start", {
        type: "content_block_start",
        index,
        content_block: block,
      });
    }
    out += sseFrame("content_block_stop", { type: "content_block_stop", index });
  });
  out += sseFrame("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 0 },
  });
  out += sseFrame("message_stop", { type: "message_stop" });
  return out;
}

// ── 纯核：三态接线选择 ─────────────────────────────────────────────────────

export interface SearchWiring {
  /** 放行 CC 内置 `WebSearch`（由本 shim 供货）。 */
  allowNativeWebSearch: boolean;
  /** 注册 Leemo 自建搜索 MCP —— **仅** shim 起不来时的兜底。 */
  registerMcp: boolean;
}

/**
 * 抽成纯函数只为一件事：把「**永远只有一条搜索路径**」这条不变量穷举掉。
 * 在 bridge-host 里它是几个 if，穷举不了；两条路径同时开着的后果是模型在两个
 * 搜索工具之间乱挑，而那种 bug 在单测里几乎抓不到。
 */
export function chooseSearchWiring(input: {
  enabled: boolean;
  /** shim 在跑 **且这条对话真的经过它**。openai 家走网关（要协议翻译），shim 不
   *  在它们的路径上 —— 网关会把服务端工具**剥掉**，于是嵌套搜索请求退化成普通
   *  聊天，模型自己编一段当"搜索结果"，正是台账里点名过的**空壳**。所以那些家
   *  必须继续用自建 MCP，而不是"内置工具反正也放行了"。 */
  shimServesThisConversation: boolean;
}): SearchWiring {
  if (!input.enabled) return { allowNativeWebSearch: false, registerMcp: false };
  return input.shimServesThisConversation
    ? { allowNativeWebSearch: true, registerMcp: false }
    : { allowNativeWebSearch: false, registerMcp: true };
}

// ── 薄壳：HTTP 服务 ───────────────────────────────────────────────────────

/** 从 Authorization: Bearer 或 x-api-key 里取占位 id（两个头 SDK 都可能用，
 *  照网关 parseProviderId 的同一条规矩）。 */
export function parseShimToken(headers: Record<string, string | string[] | undefined>): string | undefined {
  const candidates: string[] = [];
  const auth = headers["authorization"];
  const xkey = headers["x-api-key"];
  if (typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    candidates.push(m ? m[1]!.trim() : auth.trim());
  }
  if (typeof xkey === "string") candidates.push(xkey.trim());
  for (const c of candidates) {
    if (c.startsWith(SEARCH_SHIM_PREFIX)) {
      const id = c.slice(SEARCH_SHIM_PREFIX.length).trim();
      if (id) return id;
    }
  }
  return undefined;
}

/** 转发给上游的头：原样带上，但**换掉鉴权**、去掉逐跳头。 */
export function buildUpstreamHeaders(
  incoming: Record<string, string | string[] | undefined>,
  apiKey: string,
  customHeaders?: Record<string, string>,
  apiKeyHeader: "authorization" | "x-api-key" = "authorization",
): Record<string, string> {
  const out: Record<string, string> = {};
  const blocked = new Set(["host", "content-length", "connection", "transfer-encoding"]);
  for (const [k, v] of Object.entries(incoming)) {
    const key = k.toLowerCase();
    // host: 必须由 fetch 按目标重算。content-length: 我们重新序列化了 body。
    // connection/transfer-encoding: 逐跳头，转发是错的。
    // authorization/x-api-key: 占位符不能出门，下面换成真 key。
    if (blocked.has(key) || key === "authorization" || key === "x-api-key") {
      continue;
    }
    if (typeof v === "string") out[key] = v;
    else if (Array.isArray(v)) out[key] = v.join(", ");
  }
  // Advanced relay headers are part of the provider configuration, not merely
  // a setup-probe option. They override ordinary SDK headers, but never the
  // selected credential header or transport-owned framing headers.
  for (const [k, v] of Object.entries(customHeaders ?? {})) {
    const key = k.toLowerCase();
    if (blocked.has(key) || key === apiKeyHeader) continue;
    out[key] = v;
  }
  if (apiKey) {
    out[apiKeyHeader] = apiKeyHeader === "x-api-key" ? apiKey : `Bearer ${apiKey}`;
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function sendError(res: ServerResponse, status: number, type: string, message: string): void {
  sendJson(res, status, { type: "error", error: { type, message } });
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 请求路径拼到上游 base 后面。base 尾斜杠与 path 首斜杠都规整掉，避免 `//v1`。 */
export function joinUpstreamUrl(baseUrl: string, requestUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = requestUrl.startsWith("/") ? requestUrl : `/${requestUrl}`;
  return `${base}${path}`;
}

export async function startSearchShim(deps: SearchShimDeps): Promise<SearchShimHandle> {
  const logger = deps.logger ?? NOOP_LOGGER;
  const fetchFn = deps.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const stats = {
    searchesAnswered: 0,
    searchesFailed: 0,
    passedThrough: 0,
    byLayer: { passthrough: 0, vendor: 0, external: 0 } as SearchLayerStats,
  };

  /**
   * 哪些上游被实测证明「结构上没实现服务端工具」—— 记住它，别每轮都白花一次
   * 模型生成去换一个空壳（实测 GLM 空壳一次要 3~9s + token 费）。
   *
   * 只在**结构性**失败时写入（有响应、能解析、但零链接）。网络错误、非 2xx、
   * 上游明确回 `web_search_tool_result_error` 都不写 —— 那些是暂时性的，把它们
   * 记成"这家不行"会让一次限流永久废掉用户的原生搜索。
   *
   * 进程内有效即可：重启后重新探一次，正好覆盖"厂商上线了搜索"这种变化。
   */
  const knownShell = new Set<string>();

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      logger.error(`unhandled shim error: ${errMessage(e)}`);
      if (!res.headersSent) sendError(res, 500, "api_error", "internal search shim error");
      else if (!res.writableEnded) res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = parseShimToken(req.headers);
    if (!id) {
      sendError(res, 401, "authentication_error", "missing or malformed search shim token");
      return;
    }
    const upstream = deps.resolveUpstream(id);
    if (!upstream) {
      sendError(res, 401, "authentication_error", "unknown search shim token");
      return;
    }

    const raw = await readBody(req);
    let parsed: unknown = undefined;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        // 非 JSON body（不该出现在这条路上）——不理解就不干预，照常透传。
      }
    }

    if (parsed !== undefined && isNestedSearchRequest(parsed)) {
      await answerSearch(parsed as PeekedBody, res, id, req);
      return;
    }

    stats.passedThrough++;
    await passThrough(req, res, raw, upstream);
  }

  /**
   * 层①：把嵌套搜索请求**原样**转发给厂商自己的端点，然后判它是真结果还是空壳。
   *
   * 与 `passThrough()` 的关键区别：这里必须**缓冲**响应才能判。对普通对话那是
   * 不可接受的（首字延迟、内存），但嵌套搜索响应实测只有 68KB（DeepSeek）/
   * 154KB（Kimi），且它本来就要整条读完才有意义 —— 模型看不到中间过程。
   *
   * 判为真结果 ⇒ 原样回给 CC（**连 `encrypted_content` 一起**，那是引用功能要用
   * 的，我们自己合成的假值给不了）。判为空壳 ⇒ 返回 null，让上层继续降级。
   */
  async function tryPassthrough(
    upstream: SearchShimUpstream,
    req: IncomingMessage,
    raw: Buffer,
    upstreamId: string
  ): Promise<{ status: number; contentType: string; body: string } | null> {
    const url = joinUpstreamUrl(upstream.baseUrl, req.url ?? "/v1/messages");
    let up: Response;
    let text: string;
    try {
      up = await fetchFn(url, {
        method: req.method ?? "POST",
        headers: buildUpstreamHeaders(
          req.headers,
          upstream.apiKey,
          upstream.headers,
          upstream.apiKeyHeader,
        ),
        ...(raw.length > 0 ? { body: raw } : {}),
      });
      text = await up.text();
    } catch (e) {
      // 网络层失败 = 暂时性，不记 knownShell。
      logger.warn(`层① 透传失败（网络）: ${errMessage(e)}`);
      return null;
    }
    if (!up.ok) {
      logger.warn(`层① 透传失败（HTTP ${up.status}）`);
      return null; // 非 2xx 同样是暂时性的（限流/欠费），不判死刑
    }

    const contentType = up.headers.get("content-type") ?? "";
    const verdict = judgeNestedResponse(contentType, text);
    if (verdict.ok) {
      return { status: up.status, contentType: contentType || "application/json; charset=utf-8", body: text };
    }
    if (verdict.errored) {
      logger.warn(`层① 上游回了搜索错误块（暂时性，不降级 ${upstreamId}）`);
      return null;
    }
    // 结构性空壳：有响应、能解析、但零链接。记住它。
    if (!knownShell.has(upstreamId)) {
      knownShell.add(upstreamId);
      logger.info(
        `层① ${upstreamId} 判定为空壳（resultBlock=${verdict.hasResultBlock} urls=0）⇒ 本进程后续跳过层①`
      );
    }
    return null;
  }

  async function answerSearch(
    body: PeekedBody,
    res: ServerResponse,
    upstreamId: string,
    req: IncomingMessage
  ): Promise<void> {
    const query = extractSearchQuery(body);
    const model = typeof body.model === "string" ? body.model : "leemo-search";
    const wantStream = body.stream === true;
    const plan = deps.resolveSearchPlan?.(upstreamId) ?? {};
    const filters = extractDomainFilters(body);

    // ── 层①：厂商自己的端点 ────────────────────────────────────────────────
    // 只有它能把厂商原生的引用元数据（encrypted_content 等）完整交给 CC，所以
    // 排第一。域名过滤器交给上游遵守 —— 那是工具契约的一部分，原样转发即可。
    if (query && plan.passthrough && !knownShell.has(upstreamId)) {
      const relayed = await tryPassthrough(
        plan.passthrough,
        req,
        Buffer.from(JSON.stringify(body), "utf8"),
        upstreamId
      );
      if (relayed) {
        stats.searchesAnswered++;
        stats.byLayer.passthrough++;
        logger.info(`web_search 层① 厂商原生（${upstreamId}）— q=${query.slice(0, 60)}`);
        res.writeHead(relayed.status, { "content-type": relayed.contentType });
        res.end(relayed.body);
        return;
      }
    }

    // ── 层②：**这一家自己的**搜索 API ────────────────────────────────────
    let hits: SearchHit[] | null = null;
    let servedBy: string | undefined;
    let layer: keyof SearchLayerStats | undefined;

    const cand = plan.vendorSearch;
    if (query && cand) {
      try {
        const found = await cand.search(query);
        if (!found || found.length === 0) {
          logger.warn(`层② ${cand.id} 无结果，降级到外部源`);
        } else {
          const filtered = filterHitsByDomain(found, filters);
          if (filtered.length === 0) {
            logger.warn(`层② ${cand.id} 结果被域名过滤清空，降级到外部源`);
          } else {
            hits = filtered;
            servedBy = cand.id;
            layer = "vendor";
          }
        }
      } catch (e) {
        logger.warn(`层② ${cand.id} 失败: ${errMessage(e)}`);
      }
    }

    // ── 层③：外部源（AnySearch→Tavily）。这一家自己的两条路都不成立才到这里。
    // **刻意不去看别家有没有 key** —— 花别人的额度是用户明确否掉的越界行为。
    if (query && hits === null) {
      try {
        const found = await deps.runSearch(query);
        if (found && found.length > 0) {
          const filtered = filterHitsByDomain(found, filters);
          // 过滤后空了不是"成功搜到 0 条"：模型给的域名限制没命中任何结果，
          // 报失败比报空列表诚实（空列表会被当成"网上没有"）。
          if (filtered.length > 0) {
            hits = filtered;
            servedBy = "external";
            layer = "external";
          }
        }
      } catch (e) {
        logger.error(`层③ 外部源失败: ${errMessage(e)}`);
      }
    }

    if (hits === null) {
      stats.searchesFailed++;
      logger.error(`web_search 三层全挂 — q=${query.slice(0, 60)} ⇒ 回错误块（不是空数组）`);
    } else {
      stats.searchesAnswered++;
      stats.byLayer[layer!]++;
      const tag = layer === "vendor" ? "层② 厂商搜索 API" : "层③ 外部源";
      logger.info(`web_search ${tag}（${servedBy}）${hits.length} hit(s) — ${wantStream ? "sse" : "json"} — q=${query.slice(0, 60)}`);
    }

    if (!wantStream) {
      sendJson(res, 200, buildSearchMessage(query, hits, model));
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.end(buildSearchSse(query, hits, model));
  }

  async function passThrough(
    req: IncomingMessage,
    res: ServerResponse,
    raw: Buffer,
    upstream: SearchShimUpstream
  ): Promise<void> {
    const ac = new AbortController();
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientGone = true;
        ac.abort();
      }
    });

    const url = joinUpstreamUrl(upstream.baseUrl, req.url ?? "/");
    let up: Response;
    try {
      up = await fetchFn(url, {
        method: req.method ?? "POST",
        headers: buildUpstreamHeaders(
          req.headers,
          upstream.apiKey,
          upstream.headers,
          upstream.apiKeyHeader,
        ),
        ...(raw.length > 0 ? { body: raw } : {}),
        signal: ac.signal,
        // Node 的 fetch 对带 body 的请求默认要求 duplex 'half' 语义；raw 是
        // Buffer（非流），不需要设 duplex。
      });
    } catch (e) {
      if (clientGone || ac.signal.aborted) return;
      logger.error(`upstream fetch failed: ${errMessage(e)}`);
      if (!res.headersSent) sendError(res, 502, "api_error", "upstream request failed");
      return;
    }

    // 响应头原样回（content-encoding 除外：fetch 已经解过压，再声明就会让
    // 客户端二次解压失败）。
    const headers: Record<string, string> = {};
    up.headers.forEach((v, k) => {
      const key = k.toLowerCase();
      if (["content-encoding", "content-length", "connection", "transfer-encoding"].includes(key)) return;
      headers[k] = v;
    });
    res.writeHead(up.status, headers);

    if (!up.body) {
      res.end();
      return;
    }
    try {
      // pipeline 天然处理背压与断连清理 —— 不用手写 drain 循环（网关那边为此
      // 修过一次挂死的 drain promise，这里从结构上避开）。
      await pipeline(Readable.fromWeb(up.body as Parameters<typeof Readable.fromWeb>[0]), res);
    } catch (e) {
      if (!clientGone) logger.error(`stream pump error: ${errMessage(e)}`);
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* 已经断了，无所谓 */
        }
      }
    }
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  logger.info(`search shim listening on 127.0.0.1:${port}`);

  return {
    port,
    // byLayer 必须**深拷一层**：浅拷会把活的计数器对象交出去，于是调用方拿两次
    // 快照做前后差时两边指向同一个对象，差值恒为 0。live 验收脚本正是这么用的，
    // 它第一次跑就撞上了 —— 而单测只看单次绝对值，抓不到。
    stats: () => ({ ...stats, byLayer: { ...stats.byLayer } }),
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
