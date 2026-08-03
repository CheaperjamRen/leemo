// smoke/probe-native-search-l2.mjs — 轮 4 卡 H3 探针②：层① 不成立的那两家
// （GLM / 通义），有没有**自己的**搜索机制可以转译过去。
//
// 探针① 已定：DeepSeek + Kimi 的 anthropic 兼容层真的实现了 web_search 服务端工具
// （10/14 个真 url，DeepSeek 还回了 usage.server_tool_use.web_search_requests=1）。
// GLM 与通义是**空壳** —— HTTP 200、零链接、模型自陈"我不能联网"。
//
// 所以这两家只剩一条路：调它们**自己**的搜索能力，仍然用用户自己的 key（= 用户额度）。
// 下面每个候选都是一次真实请求，判据是**能不能拿到可引用的 (title,url)**，
// 不是 HTTP 200 —— 卡 F 的硬发现「200 会骗人」在这里同样适用。
//
// 候选（**全部待实证**，不是事实）：
//   GLM  A: POST /api/paas/v4/web_search            独立搜索端点（search_engine=search_std）
//   GLM  B: POST /api/paas/v4/chat/completions      model=web-search-pro（搜索专用模型）
//   GLM  C: POST /api/paas/v4/chat/completions      tools:[{type:"web_search"}]
//   通义 D: POST /compatible-mode/v1/chat/completions  enable_search + search_options
//   通义 E: POST /api/v1/services/aigc/text-generation/generation  parameters.enable_search
//
// 用法: node smoke/probe-native-search-l2.mjs      （需 .env 的 GLM_API_KEY / DASHSCOPE_API_KEY）
// 默认不走代理 —— 本卡目标就是「国内直连、无 VPN 可用」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const QUERY = "上海 今天 天气";
const GLM_KEY = process.env.GLM_API_KEY?.trim();
const QWEN_KEY = process.env.DASHSCOPE_API_KEY?.trim();

/** 在任意深度的 JSON 里找 (title,url) 对 —— 各家字段名不一样（link/url、
 *  title/name），先别猜形状，把**能引用的东西**捞出来再谈映射。 */
function harvestHits(node, out = [], depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const it of node) harvestHits(it, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;
  const o = node;
  const url = [o.url, o.link, o.href, o.web_url].find((v) => typeof v === "string" && /^https?:\/\//.test(v));
  const title = [o.title, o.name, o.site_name, o.media].find((v) => typeof v === "string" && v.trim());
  if (url) out.push({ title: title ?? "", url, snippetLen: (o.content ?? o.snippet ?? o.summary ?? "").length ?? 0, keys: Object.keys(o).slice(0, 12) });
  for (const v of Object.values(o)) harvestHits(v, out, depth + 1);
  return out;
}

async function attempt(label, url, { headers, body, method = "POST" }) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await res.text();
    const ms = Date.now() - t0;
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* keep raw */
    }
    const hits = json ? harvestHits(json) : [];
    // 去重（同一 url 可能在 choices 与 search_info 里各出现一次）
    const seen = new Set();
    const uniq = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
    return {
      label,
      url,
      httpStatus: res.status,
      ms,
      topKeys: json ? Object.keys(json).slice(0, 14) : null,
      hitCount: uniq.length,
      hits: uniq.slice(0, 6),
      rawPreview: raw.slice(0, 500),
      // 承重判据：拿到 ≥1 条带 url 的可引用条目
      works: uniq.length > 0,
    };
  } catch (e) {
    return { label, url, ms: Date.now() - t0, fatal: `${e.name}: ${e.message}`, works: false };
  }
}

const records = [];

if (!GLM_KEY) console.log("GLM  SKIP — .env 无 GLM_API_KEY");
else {
  const H = { authorization: `Bearer ${GLM_KEY}` };
  // A: 独立搜索端点。若成立这是最干净的一条 —— 纯搜索、无模型生成、最省钱。
  records.push(
    await attempt("GLM-A /paas/v4/web_search (search_std)", "https://open.bigmodel.cn/api/paas/v4/web_search", {
      headers: H,
      body: { search_engine: "search_std", search_query: QUERY, count: 8 },
    })
  );
  // A2: 同端点换引擎名 —— 文档里出现过多个引擎标识，哪个真存在只能试。
  records.push(
    await attempt("GLM-A2 /paas/v4/web_search (search_pro)", "https://open.bigmodel.cn/api/paas/v4/web_search", {
      headers: H,
      body: { search_engine: "search_pro", search_query: QUERY, count: 8 },
    })
  );
  // B: 搜索专用模型走 chat/completions。
  records.push(
    await attempt("GLM-B chat/completions model=web-search-pro", "https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      headers: H,
      body: { model: "web-search-pro", messages: [{ role: "user", content: QUERY }] },
    })
  );
  // C: 普通对话模型 + web_search 工具。
  records.push(
    await attempt("GLM-C chat/completions tools=[web_search]", "https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      headers: H,
      body: {
        model: process.env.GLM_MODEL || "glm-5.2",
        messages: [{ role: "user", content: QUERY }],
        tools: [{ type: "web_search", web_search: { enable: true, search_query: QUERY, search_result: true } }],
      },
    })
  );
}

if (!QWEN_KEY) console.log("通义 SKIP — .env 无 DASHSCOPE_API_KEY");
else {
  const H = { authorization: `Bearer ${QWEN_KEY}` };
  // D: OpenAI 兼容模式 + enable_search。forced_search 逼它必搜，enable_source 要来源。
  records.push(
    await attempt("QWEN-D compatible-mode enable_search", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      headers: H,
      body: {
        model: process.env.QWEN_MODEL || "qwen3.7-flash",
        messages: [{ role: "user", content: QUERY }],
        enable_search: true,
        search_options: { forced_search: true, enable_source: true, enable_citation: true, search_strategy: "standard" },
      },
    })
  );
  // E: DashScope 原生协议（参数在 parameters 里，形状与 D 不同）。
  records.push(
    await attempt("QWEN-E dashscope native enable_search", "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
      headers: H,
      body: {
        model: process.env.QWEN_MODEL || "qwen3.7-flash",
        input: { messages: [{ role: "user", content: QUERY }] },
        parameters: {
          enable_search: true,
          search_options: { forced_search: true, enable_source: true, enable_citation: true },
          result_format: "message",
        },
      },
    })
  );
}

for (const r of records) {
  const tag = r.label.padEnd(44);
  if (r.fatal) {
    console.log(`${tag} FATAL ${r.fatal}`);
    continue;
  }
  console.log(`${tag} HTTP ${r.httpStatus} ${String(r.ms).padStart(6)}ms hits=${r.hitCount} => ${r.works ? "✅" : "❌"}`);
  console.log(`${" ".repeat(46)} topKeys=${JSON.stringify(r.topKeys)}`);
  if (r.works) {
    for (const h of r.hits.slice(0, 3)) {
      console.log(`${" ".repeat(46)} · ${String(h.title).slice(0, 40)} — ${h.url.slice(0, 70)} (snippet ${h.snippetLen}) keys=${h.keys.join(",")}`);
    }
  } else {
    console.log(`${" ".repeat(46)} raw=${r.rawPreview.replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

console.log(`\n${"=".repeat(76)}\n层② 结论（承重判据 = 拿到可引用的 title+url）\n${"=".repeat(76)}`);
for (const fam of ["GLM", "QWEN"]) {
  const rs = records.filter((r) => r.label.startsWith(fam));
  const ok = rs.filter((r) => r.works);
  console.log(`  ${fam.padEnd(6)} ${ok.length ? `✅ ${ok.length} 条候选可用 → 首选 ${ok[0].label}（${ok[0].hitCount} 条）` : "❌ 全部候选失败 ⇒ 记「未实证、走兜底」"}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `native-search-l2-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));
console.log(`\n结果 JSON: ${file}`);
