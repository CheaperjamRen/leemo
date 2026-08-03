// smoke/probe-native-search-qwen.mjs — 轮 4 卡 H3 探针③：通义单独加试。
//
// 探针② 里通义的 `enable_search` 回了 HTTP 200，正文带 `[1][3]` 角标、还报了具体
// 气温 —— **但全 JSON 深挖 8 层零个 url**。这正是台账点名的失败形态：看着像搜过，
// 拿不到可引用来源。而且它说"7月22日"，今天是 7月27日 ⇒ 连时效都不对。
//
// 所以要把「是不是我参数给错了」和「这家真给不了 url」分开。四个变量各自单独动：
//   F: 换稳定模型名 qwen-plus（3.7 系可能忽略 search_options）
//   G: qwen-plus 裸 enable_search（不给 search_options，看 search_info 是否自带）
//   H: 流式（search_info 有可能只在 chunk 里出现，非流式被吃掉）
//   I: qwen-max 走同一形状（确认是不是模型档位问题）
//
// 判据不变：**拿到 ≥1 条 (title,url)** 才算通。只看 HTTP 200 会骗人（卡 F）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const QUERY = "上海 今天 天气";
const KEY = process.env.DASHSCOPE_API_KEY?.trim();
const URL_CC = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

function harvestUrls(text) {
  return [...new Set([...String(text).matchAll(/https?:\/\/[^\s"'\\<>)\]]+/g)].map((m) => m[0]))];
}

async function attempt(label, body, { stream = false } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL_CC, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ ...body, ...(stream ? { stream: true } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    const ms = Date.now() - t0;
    // 流式与非流式统一按"整段文本里有没有 search_info / url"判 —— 不同形状同一判据。
    const hasSearchInfo = /"search_info"/.test(raw);
    const urls = harvestUrls(raw).filter((u) => !u.includes("aliyun.com/zh/model-studio"));
    let topKeys = null;
    if (!stream) {
      try {
        topKeys = Object.keys(JSON.parse(raw)).slice(0, 14);
      } catch {
        /* ignore */
      }
    }
    return {
      label,
      httpStatus: res.status,
      ms,
      stream,
      topKeys,
      hasSearchInfo,
      urlCount: urls.length,
      urls: urls.slice(0, 6),
      rawPreview: raw.slice(0, 400),
      works: urls.length > 0,
    };
  } catch (e) {
    return { label, ms: Date.now() - t0, fatal: `${e.name}: ${e.message}`, works: false };
  }
}

const SEARCH_OPTS = { forced_search: true, enable_source: true, enable_citation: true, search_strategy: "standard" };
const records = [];

if (!KEY) {
  console.log("SKIP — .env 无 DASHSCOPE_API_KEY");
} else {
  records.push(
    await attempt("F qwen-plus + search_options", {
      model: "qwen-plus",
      messages: [{ role: "user", content: QUERY }],
      enable_search: true,
      search_options: SEARCH_OPTS,
    })
  );
  records.push(
    await attempt("G qwen-plus 裸 enable_search", {
      model: "qwen-plus",
      messages: [{ role: "user", content: QUERY }],
      enable_search: true,
    })
  );
  records.push(
    await attempt(
      "H qwen-plus 流式 + search_options",
      { model: "qwen-plus", messages: [{ role: "user", content: QUERY }], enable_search: true, search_options: SEARCH_OPTS },
      { stream: true }
    )
  );
  records.push(
    await attempt("I qwen-max + search_options", {
      model: "qwen-max",
      messages: [{ role: "user", content: QUERY }],
      enable_search: true,
      search_options: SEARCH_OPTS,
    })
  );
}

for (const r of records) {
  const tag = r.label.padEnd(32);
  if (r.fatal) {
    console.log(`${tag} FATAL ${r.fatal}`);
    continue;
  }
  console.log(
    `${tag} HTTP ${r.httpStatus} ${String(r.ms).padStart(6)}ms search_info=${r.hasSearchInfo} urls=${r.urlCount} => ${r.works ? "✅" : "❌"}`
  );
  if (r.topKeys) console.log(`${" ".repeat(34)} topKeys=${JSON.stringify(r.topKeys)}`);
  if (r.works) console.log(`${" ".repeat(34)} ${r.urls.join(" | ").slice(0, 320)}`);
  else console.log(`${" ".repeat(34)} raw=${r.rawPreview.replace(/\s+/g, " ").slice(0, 260)}`);
}

const anyOk = records.some((r) => r.works);
console.log(`\n${"=".repeat(76)}`);
console.log(anyOk ? "通义 ✅ 有可引用 url 的路子" : "通义 ❌ 四个变量全试过仍拿不到可引用 url ⇒ 记「未实证、走跨家/兜底」");
console.log("=".repeat(76));

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `native-search-qwen-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));
console.log(`\n结果 JSON: ${file}`);
