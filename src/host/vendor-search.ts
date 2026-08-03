// Leemo — 厂商**自己的**搜索 API 适配器（轮 4 卡 H3，降级链的层②）。
//
// ── 为什么需要这一层 ──────────────────────────────────────────────────────
//
// CC 内置 WebSearch 的搜索动作由「上游端点实现 `web_search` 服务端工具」完成
// （机制实测见 src/host/search-shim.ts 顶部）。本轮逐家实测（
// smoke/probe-native-search-l1.mjs / -l2 / -stream，结果 JSON 在 smoke/results/）：
//
//   家        自家 anthropic 端点实现服务端工具？   自家独立搜索 API？
//   DeepSeek  ✅ JSON 10 url + SSE 10 url            —— 不需要
//             （usage.server_tool_use.web_search_requests=1 ⇒ 确实计用户额度）
//   Kimi      ✅ JSON 14 url + SSE 7 url             —— 不需要
//   GLM       ❌ 空壳（HTTP 200、零链接、模型自陈"我不能联网"）  ✅ 本文件
//   通义      ❌ 空壳                                 ❌ 四变量全废（见下）
//
// 所以 GLM 这类「兼容层没实现、但厂商自己有搜索服务」的家，只能把嵌套搜索请求
// **转译**到它自己的搜索 API 上 —— 仍然用用户自己的 key，花用户自己的额度，
// 不经任何第三方。这正是本文件的全部职责。
//
// ── 判据纪律 ──────────────────────────────────────────────────────────────
//
// 每个适配器的成功判据是**拿到可引用的 (title,url)**，不是 HTTP 200。卡 F 的硬
// 发现「200 会骗人」在这里反复应验：通义的 `enable_search` 回 200、正文带 `[1][3]`
// 角标、还报了具体气温，但全 JSON 深挖 8 层**零个 url**，且它引的是 7月22日 的
// 数据（实测当天是 7月27日）。那种响应喂给模型比搜不到更坏 —— 模型会照着编来源。
// 故通义**明确记为「未实证、走外部源兜底」**，不编一个端点填进去。
import { MAX_HITS, type SearchHit } from "./web-search";

/** 与 web-search.ts 同一条超时纪律（实测 GLM 609~1558ms，8s 宽松但不拖垮整链）。 */
const TIMEOUT_MS = 8000;

export interface VendorSearchOptions {
  apiKey: string;
  /** 搜索端点。由 catalog 给，不在这里硬编码 —— 用户改了 baseUrl 时要能跟着走。 */
  searchApiUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * GLM（智谱）`POST /api/paas/v4/web_search`。
 *
 * 实测（2026-07-27，用户自己的 GLM key，无代理直连）：
 *   · `search_engine:"search_std"` → 10 条 / 1558ms
 *   · `search_engine:"search_pro"` → 10 条 / 609ms
 *   · 两者都回**当天**的真新闻（"上海今起高温连续剧开播…周中直冲38"）
 *   · 响应形状 `{created,id,request_id,search_intent,search_result:[…]}`
 *   · 条目字段 `{title, link, content, media, publish_date, icon, refer}`
 *
 * **`link` 而不是 `url`** —— 这是最容易写错的一处：照 Anthropic/Tavily 的直觉写
 * `r.url` 会静默得到 0 条（字段不存在 ⇒ 全被 toHits 丢掉 ⇒ 看起来像"搜不到"）。
 *
 * 选 `search_std` 而非更快的 `search_pro`：std 是基础档、单价更低，而本用途只要
 * title+url+摘要，pro 的增强对我们没有增量价值。用户额度该省。
 *
 * 另两个候选已实测否掉，留档免得后人再试：
 *   · `chat/completions model=web-search-pro` → HTTP 500 `{"code":"500","message":"内部错误"}`
 *   · `chat/completions tools=[{type:"web_search"}]` → 能用（10 条）但要跑一整轮
 *     模型生成（8960ms + token 费），比独立端点贵一个数量级。
 */
export async function searchGlmNative(query: string, opts: VendorSearchOptions): Promise<SearchHit[]> {
  const key = opts.apiKey.trim();
  if (!key) throw new Error("glm-native: no api key");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await (opts.fetchFn ?? fetch)(opts.searchApiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ search_engine: "search_std", search_query: query, count: MAX_HITS }),
      signal: ac.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`glm-native HTTP ${res.status}`);

  const json = JSON.parse(text) as { search_result?: unknown };
  const raw = Array.isArray(json.search_result) ? json.search_result : [];
  const hits: SearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const url = typeof r.link === "string" ? r.link.trim() : "";
    if (!title || !url) continue; // 缺任一 ⇒ 模型无法引用，丢
    const snippet = typeof r.content === "string" ? r.content.trim() : "";
    // content 是全文摘要（实测 ~250 字符），照 web-search.ts 探针④ 的结论裁到
    // 摘要长度即可 —— 别把上下文炸了。
    hits.push({ title, url, snippet: snippet.slice(0, 400) });
  }
  return hits.slice(0, MAX_HITS);
}

// 曾经这里还有一个 `searchViaAnthropicServerTool` —— 把一家"兼容层实现了服务端工具"
// 的 provider 当纯搜索服务用，为的是让通义借 DeepSeek/Kimi 的搜索。**用户 7/27 否掉了
// 跨 provider 借额度**（见 search-plan.ts 顶部），那个函数唯一的用途随之消失，故删除
// 而不是留着 —— 留一个没人调的导出，下次有人会以为它是可用的路。
// 本对话这一家自己的透传由 search-shim 的层① 直接做（原样转发，还能保住厂商的
// encrypted_content），不需要这个包装。

/** 厂商适配器的标签。catalog 用它指名"这家走哪个适配器"，避免 id→行为 硬编码
 *  （B3 冻结时留的扩展轴：加数据不改契约）。 */
export type VendorSearchTag = "glm";

const ADAPTERS: Record<VendorSearchTag, (q: string, o: VendorSearchOptions) => Promise<SearchHit[]>> = {
  glm: searchGlmNative,
};

/** 按标签取适配器。未知标签返回 undefined（调用方跳过这一步，不抛）—— 一个
 *  拼错的标签不该让整条搜索链停摆。 */
export function vendorSearchAdapter(
  tag: string | undefined
): ((q: string, o: VendorSearchOptions) => Promise<SearchHit[]>) | undefined {
  if (!tag) return undefined;
  return ADAPTERS[tag as VendorSearchTag];
}
