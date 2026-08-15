// Leemo 主进程 —— 联网搜索纯逻辑（06 §四）。
//
// 为什么自建而不是装第三方搜索 MCP：失败降级、防幻觉话术、fallback 链这三件
// 事必须在我们手里。第三方 MCP 挂了或改了行为，我们既控不住也测不到。
//
// 几条真实探针结论直接约束了这里的设计：
//   ① AnySearch 只吃 POST /v1/search（GET 全 404，Phase 0 因此误判"无此 API"）。
//   ② 带 key 反而更差（3 条 vs 匿名 10 条、内容跑偏）⇒ 有 key 的源只能追加、不前插。
//   ③ 服务端不认 exclude_content/count/top_k ⇒ content 只能客户端裁。
//   ④ content 占 87.9% 体积 ⇒ 必须裁，否则一次搜索吃掉几万 token。
//   ⑤ 各家错误体结构不同 ⇒ 判据是「非 2xx 就换下一家」，不解析错误体。

/** 交给模型的一条结果。故意只有三个字段：多一个 content 就是几万 token。 */
export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** 一个搜索源。name 只用于诊断与台账，不进模型上下文。 */
export interface SearchSource {
  name: string;
  search(query: string): Promise<SearchHit[]>;
}

export interface SearchSourceKeys {
  anysearchKey?: string;
  doubaoKey?: string;
  metasoKey?: string;
  tavilyKey?: string;
  bochaKey?: string;
  googleKey?: string;
  googleCx?: string;
  exaKey?: string;
  braveKey?: string;
  serpapiKey?: string;
  serperKey?: string;
  firecrawlKey?: string;
}

/** 单源一次尝试的结果，用于诊断"为什么走到了兜底"。 */
export interface SearchAttempt {
  name: string;
  ok: boolean;
  error?: string;
}

export interface SearchOutcome {
  source: string;
  hits: SearchHit[];
  attempts: SearchAttempt[];
}

/** 交给模型的条数上限。探针④：10 条裁掉 content 后约 15KB/40 条，
 *  即单次 ~4KB，安全；这里再留一道闸，防将来某家返回几十条。 */
export const MAX_HITS = 8;

/** 单源超时。探针④实测新查询中位 1868ms，最慢 1997ms；8s 足够宽松，
 *  又不会让一家挂死拖垮整条链。 */
const TIMEOUT_MS = 8000;

type FetchFn = typeof fetch;

export interface SourceOptions {
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

const globalFetch: FetchFn = (...args) => fetch(...args);

/** 带超时的 fetch。AbortController 保证挂死的源不会永久占住这一轮。 */
async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; text: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ac.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

/** 只保留能引用的三字段；缺 title 或缺 url 的直接丢（模型无法引用）。 */
function toHits(raw: unknown): SearchHit[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!title || !url) continue;
    const snippet = typeof r.snippet === "string" ? r.snippet.trim() : "";
    out.push({ title, url, snippet });
  }
  return out;
}

/**
 * AnySearch（免 key 默认源）。形状来自用户提供并经探针③实测：
 * `POST /v1/search {query, tag?, params?}` → `{code:0, data:{results:[…]}}`。
 * key 可选；探针②实测带 key 结果反而更差，故这里即便有 key 也不改排序。
 */
export async function searchAnySearch(
  query: string,
  opts: SourceOptions & { apiKey?: string } = {}
): Promise<SearchHit[]> {
  const fetchFn = opts.fetchFn ?? globalFetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // 文档 L177 明确：无 key 时也要带这个头，服务端据此走匿名档。
    "X-Anysearch-Client": "leemo",
  };
  const key = opts.apiKey?.trim();
  if (key) headers.authorization = `Bearer ${key}`;

  const res = await fetchWithTimeout(
    fetchFn,
    "https://api.anysearch.com/v1/search",
    { method: "POST", headers, body: JSON.stringify({ query }) },
    opts.timeoutMs ?? TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`anysearch HTTP ${res.status}`);

  const json = JSON.parse(res.text) as { code?: number; message?: string; data?: { results?: unknown } };
  // 这家 HTTP 200 也可能带业务错误码，两道都要查。
  if (json.code !== 0) throw new Error(`anysearch code ${json.code}: ${json.message ?? "unknown"}`);
  return toHits(json.data?.results);
}

// ── DDG lite（兜底源，抓 HTML）─────────────────────────────────────────────
// 这是抓页不是 API：DDG 改版会静默失效。所以解析器单独导出、离线可测，且
// 「解不出东西」一律抛错 —— 返回空数组会被链当成"这家没结果"继续往下走，
// 表面一样，但"改版了"这条诊断信息就永久丢失了。

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** DDG lite 把外链包成 `//duckduckgo.com/l/?uddg=<encoded>&rut=…`，还原成真 URL。 */
function unwrapDdgUrl(href: string): string {
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) {
    try {
      return decodeURIComponent(m[1]!);
    } catch {
      /* 解不开就退回原样，下面的 http 前缀检查会兜住 */
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

/** 解析 DDG lite 的结果页。导出以便离线钉住格式。 */
export function parseDdgLite(html: string): SearchHit[] {
  // 反爬页要当失败，不能当"没结果"。
  if (/anomalous traffic|unusual traffic|are you a robot|captcha/i.test(html)) {
    throw new Error("ddg-lite blocked (anti-scraping page)");
  }

  const links = [...html.matchAll(/<a\b[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    stripTags(m[1]!)
  );

  const hits: SearchHit[] = [];
  links.forEach((m, i) => {
    const hrefMatch = /href="([^"]+)"/i.exec(m[0]);
    if (!hrefMatch) return;
    const url = unwrapDdgUrl(decodeEntities(hrefMatch[1]!));
    const title = stripTags(m[1]!);
    if (!title || !/^https?:\/\//i.test(url)) return;
    hits.push({ title, url, snippet: snippets[i] ?? "" });
  });

  // 一条都没解出 ⇒ 要么改版、要么真被挡了，两种都得炸出来。
  if (hits.length === 0) throw new Error("ddg-lite parse failed (0 hits — layout may have changed)");
  return hits;
}

export async function searchDdgLite(query: string, opts: SourceOptions = {}): Promise<SearchHit[]> {
  const fetchFn = opts.fetchFn ?? globalFetch;
  const res = await fetchWithTimeout(
    fetchFn,
    `https://duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    {
      method: "GET",
      // lite 端点对 UA 敏感：不给就可能直接吃反爬页。
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    },
    opts.timeoutMs ?? TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`ddg-lite HTTP ${res.status}`);
  return parseDdgLite(res.text);
}

// ── 需要 key 的源 ─────────────────────────────────────────────────────────
// 探针⑤实测：Tavily 401 是 {detail:{error}}，博查 401 是 {code,message}，两家
// 结构不同。所以一律只看 HTTP 状态码，不解析错误体。

export function classifySearchHttpError(source: string, status: number): string {
  if (status === 401 || status === 403) return `${source}：认证失败（HTTP ${status}）`;
  if (status === 402 || status === 429) {
    return `${source}：请求过快或额度不足（HTTP ${status}）`;
  }
  return `${source}：服务暂不可用（HTTP ${status}）`;
}

async function fetchSearchJson(
  source: string,
  url: string,
  init: RequestInit,
  opts: SourceOptions,
): Promise<Record<string, unknown>> {
  let res: Awaited<ReturnType<typeof fetchWithTimeout>>;
  try {
    res = await fetchWithTimeout(
      opts.fetchFn ?? globalFetch,
      url,
      init,
      opts.timeoutMs ?? TIMEOUT_MS,
    );
  } catch {
    throw new Error(`${source}：服务暂不可用（网络错误或超时）`);
  }
  if (!res.ok) throw new Error(classifySearchHttpError(source, res.status));
  try {
    const parsed = JSON.parse(res.text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("shape");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${source}：响应格式错误`);
  }
}

function requireSearchKey(source: string, value: string): string {
  const key = value.trim();
  if (!key) throw new Error(`${source}：未配置凭据`);
  return key;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string" && item.trim());
      if (typeof first === "string") return first.trim();
    }
  }
  return "";
}

/** 火山引擎豆包搜索 Custom 版。只保留 WebResults 的引用字段。 */
export async function searchDoubao(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "豆包搜索";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://open.feedcoopapi.com/search_api/web_search",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        Query: query,
        SearchType: "web",
        Count: MAX_HITS,
        Filter: { NeedContent: true, NeedUrl: true },
      }),
    },
    opts,
  );
  const metadata = json.ResponseMetadata as Record<string, unknown> | undefined;
  const upstreamError = metadata?.Error as Record<string, unknown> | undefined;
  if (upstreamError) {
    const code = typeof upstreamError.CodeN === "number" ? upstreamError.CodeN : undefined;
    if (code === 10401 || code === 10403) throw new Error(`${source}：认证失败`);
    if (code === 10406 || code === 10409 || code === 10410 || code === 10412) {
      throw new Error(`${source}：额度不足或套餐不可用`);
    }
    if (code === 700429) throw new Error(`${source}：请求过快或额度不足`);
    throw new Error(`${source}：服务返回业务错误`);
  }
  const result = json.Result as Record<string, unknown> | undefined;
  const webResults = Array.isArray(result?.WebResults) ? result.WebResults : [];
  return toHits(webResults.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.Title, url: row.Url, snippet: row.Snippet };
  })).slice(0, MAX_HITS);
}

/** 秘塔非流式搜索。生成答案 data.text 不进入普通搜索上下文。 */
export async function searchMetaso(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "秘塔搜索";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://metaso.cn/api/open/search/v2",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ question: query, stream: false, lang: "zh", needHighlight: false }),
    },
    opts,
  );
  if (json.errCode !== 0) throw new Error(`${source}：服务返回业务错误`);
  const data = json.data as Record<string, unknown> | undefined;
  const references = Array.isArray(data?.references) ? data.references : [];
  return toHits(references.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.title, url: row.url, snippet: row.snippet };
  })).slice(0, MAX_HITS);
}

/** Google Custom Search compatibility adapter for users with an existing key + CX. */
export async function searchGoogle(
  query: string,
  opts: SourceOptions & { apiKey: string; engineId: string },
): Promise<SearchHit[]> {
  const source = "Google 搜索";
  const key = requireSearchKey(source, opts.apiKey);
  const engineId = requireSearchKey(source, opts.engineId);
  const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", engineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(MAX_HITS));
  const json = await fetchSearchJson(source, url.toString(), { method: "GET" }, opts);
  if (json.error) throw new Error(`${source}：服务返回业务错误`);
  const items = Array.isArray(json.items) ? json.items : [];
  return toHits(items.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.title, url: row.link, snippet: row.snippet };
  })).slice(0, MAX_HITS);
}

/** Exa Search API. highlights 是面向模型裁过的摘录，不请求整页正文。 */
export async function searchExa(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "Exa";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://api.exa.ai/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query,
        type: "fast",
        numResults: MAX_HITS,
        contents: { highlights: true },
      }),
    },
    opts,
  );
  const results = Array.isArray(json.results) ? json.results : [];
  return toHits(results.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      title: row.title,
      url: row.url,
      snippet: firstText(row.highlights, row.summary, row.text),
    };
  })).slice(0, MAX_HITS);
}

/** Brave 独立网页索引。 */
export async function searchBrave(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "Brave Search";
  const key = requireSearchKey(source, opts.apiKey);
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(MAX_HITS));
  const json = await fetchSearchJson(
    source,
    url.toString(),
    {
      method: "GET",
      headers: { accept: "application/json", "X-Subscription-Token": key },
    },
    opts,
  );
  const web = json.web as Record<string, unknown> | undefined;
  const results = Array.isArray(web?.results) ? web.results : [];
  return toHits(results.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.title, url: row.url, snippet: row.description };
  })).slice(0, MAX_HITS);
}

/** SerpAPI 的 Google 引擎兼容端点。API Key 按官方要求放 query 参数。 */
export async function searchSerpApi(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "SerpAPI";
  const key = requireSearchKey(source, opts.apiKey);
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(MAX_HITS));
  url.searchParams.set("api_key", key);
  const json = await fetchSearchJson(source, url.toString(), { method: "GET" }, opts);
  if (json.error) throw new Error(`${source}：服务返回业务错误`);
  const results = Array.isArray(json.organic_results) ? json.organic_results : [];
  return toHits(results.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.title, url: row.link, snippet: row.snippet };
  })).slice(0, MAX_HITS);
}

/** Serper 的轻量 Google Search API。 */
export async function searchSerper(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "Serper";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://google.serper.dev/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: query, num: MAX_HITS }),
    },
    opts,
  );
  const results = Array.isArray(json.organic) ? json.organic : [];
  return toHits(results.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.title, url: row.link, snippet: row.snippet };
  })).slice(0, MAX_HITS);
}

/** Firecrawl v2 Search。普通搜索只取元数据，不追加抓取正文的付费步骤。 */
export async function searchFirecrawl(
  query: string,
  opts: SourceOptions & { apiKey: string },
): Promise<SearchHit[]> {
  const source = "Firecrawl";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://api.firecrawl.dev/v2/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit: MAX_HITS, sources: ["web"] }),
    },
    opts,
  );
  if (json.success !== true) throw new Error(`${source}：服务返回业务错误`);
  const data = json.data as Record<string, unknown> | undefined;
  const results = Array.isArray(data?.web) ? data.web : [];
  return toHits(results.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return { title: row.title, url: row.url, snippet: row.description };
  })).slice(0, MAX_HITS);
}

export async function searchTavily(
  query: string,
  opts: SourceOptions & { apiKey: string }
): Promise<SearchHit[]> {
  const source = "Tavily";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: MAX_HITS }),
    },
    opts,
  );
  // Tavily 用 content 装摘要，映射成我们的 snippet（并顺手丢掉全文字段）。
  const mapped = Array.isArray(json.results)
    ? json.results.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return { title: o.title, url: o.url, snippet: o.content };
      })
    : [];
  return toHits(mapped);
}

export async function searchBocha(
  query: string,
  opts: SourceOptions & { apiKey: string }
): Promise<SearchHit[]> {
  const source = "博查";
  const key = requireSearchKey(source, opts.apiKey);
  const json = await fetchSearchJson(
    source,
    "https://api.bochaai.com/v1/web-search",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, count: MAX_HITS }),
    },
    opts,
  );
  const data = json.data as Record<string, unknown> | undefined;
  const webPages = data?.webPages as Record<string, unknown> | undefined;
  const mapped = Array.isArray(webPages?.value)
    ? (webPages.value as unknown[]).map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return { title: o.name, url: o.url, snippet: o.snippet };
      })
    : [];
  return toHits(mapped);
}

/**
 * 组链。顺序全是实测产物，不是拍脑袋：
 *   AnySearch（免 key，中英文各 8~10 条 / ~1.9s）→ 用户配 key 的源（兜底）
 *
 * 两个取舍值得写下来，因为都推翻了"想当然"：
 *
 * ① **有 key 的源不前插。** 探针②实测某把 AnySearch key 只回 3 条且内容跑偏
 *    （问 5.6 的 notes 回 4.6 的 wiki），"付费一定更好"是错的。免 key 源打头，
 *    一把坏 key 就不会拖垮默认体验。
 *
 * ② **DDG lite 不在默认链里。** 用户机器上 DDG/Brave/Startpage 全是 TCP
 *    CONNECT_TIMEOUT（DNS 正常，连接层不通，同一类封锁）。留着它就是一个
 *    永远不会触发的"兜底"——比没有兜底更骗人：我测的时候绿、用户真需要时黑。
 *    `searchDdgLite`/`parseDdgLite` 仍然导出且有测试，网络条件变了可以接回来。
 *    Bing Search API 已于 2025-08-11 完全退役，设置页保留来源说明，但不能
 *    假装仍有可调用端点，因此不会进入这条运行链。
 */
export function buildSourceChain(keys: SearchSourceKeys, opts: SourceOptions = {}): SearchSource[] {
  const chain: SearchSource[] = [
    { name: "anysearch", search: (q) => searchAnySearch(q, { ...opts, apiKey: keys.anysearchKey }) },
  ];
  const doubao = keys.doubaoKey?.trim();
  if (doubao) chain.push({ name: "doubao", search: (q) => searchDoubao(q, { ...opts, apiKey: doubao }) });
  const metaso = keys.metasoKey?.trim();
  if (metaso) chain.push({ name: "metaso", search: (q) => searchMetaso(q, { ...opts, apiKey: metaso }) });
  const tavily = keys.tavilyKey?.trim();
  if (tavily) chain.push({ name: "tavily", search: (q) => searchTavily(q, { ...opts, apiKey: tavily }) });
  const bocha = keys.bochaKey?.trim();
  if (bocha) chain.push({ name: "bocha", search: (q) => searchBocha(q, { ...opts, apiKey: bocha }) });
  const google = keys.googleKey?.trim();
  const googleCx = keys.googleCx?.trim();
  if (google && googleCx) {
    chain.push({
      name: "google",
      search: (q) => searchGoogle(q, { ...opts, apiKey: google, engineId: googleCx }),
    });
  }
  const exa = keys.exaKey?.trim();
  if (exa) chain.push({ name: "exa", search: (q) => searchExa(q, { ...opts, apiKey: exa }) });
  const brave = keys.braveKey?.trim();
  if (brave) chain.push({ name: "brave", search: (q) => searchBrave(q, { ...opts, apiKey: brave }) });
  const serpapi = keys.serpapiKey?.trim();
  if (serpapi) {
    chain.push({ name: "serpapi", search: (q) => searchSerpApi(q, { ...opts, apiKey: serpapi }) });
  }
  const serper = keys.serperKey?.trim();
  if (serper) chain.push({ name: "serper", search: (q) => searchSerper(q, { ...opts, apiKey: serper }) });
  const firecrawl = keys.firecrawlKey?.trim();
  if (firecrawl) {
    chain.push({ name: "firecrawl", search: (q) => searchFirecrawl(q, { ...opts, apiKey: firecrawl }) });
  }
  return chain;
}

/**
 * 顺着链找第一个有结果的源。零结果视为失败继续往下 —— 一家返回空不等于
 * "网上没有"。全挂返回 null（不抛）：调用方要能对用户说真话"搜索失败了"，
 * 而不是崩掉，更不是编一个答案。
 */
export async function runSearchChain(
  query: string,
  sources: SearchSource[]
): Promise<SearchOutcome | null> {
  const attempts: SearchAttempt[] = [];
  for (const src of sources) {
    try {
      const hits = await src.search(query);
      if (hits.length > 0) {
        attempts.push({ name: src.name, ok: true });
        return { source: src.name, hits: hits.slice(0, MAX_HITS), attempts };
      }
      attempts.push({ name: src.name, ok: false, error: "0 results" });
    } catch (e: unknown) {
      attempts.push({ name: src.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return null;
}

/** 渲染成交给模型的文本。每条必带 URL —— 模型要能引用来源。 */
export function formatHits(hits: SearchHit[], source: string): string {
  const lines = hits.slice(0, MAX_HITS).map((h, i) => {
    const snippet = h.snippet ? `\n   ${h.snippet}` : "";
    return `${i + 1}. ${h.title}\n   ${h.url}${snippet}`;
  });
  return `搜索结果（来源：${source}，${lines.length} 条）：\n\n${lines.join("\n\n")}`;
}
