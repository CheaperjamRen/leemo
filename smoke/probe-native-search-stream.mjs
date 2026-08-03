// smoke/probe-native-search-stream.mjs — 轮 4 卡 H3 探针④：层① 的**流式**臂。
//
// 为什么非跑不可：探针① 用的是非流式请求，而 shim 走的是**原样透传** —— CC 真实
// 发出的嵌套请求带 `stream:true`。一家在 JSON 模式实现了服务端工具、在 SSE 模式
// 没实现（或 block 形状不同），透传就会静默退化成空壳。那正是本项目反复踩的坑：
// 判据要落在**真正会跑的那条路**上，不是形状相近的另一条。
//
// 判据（机械信号，逐帧扫 SSE 原文）：
//   ① 有 `content_block_start` 且 content_block.type === "server_tool_use"
//   ② 有 `web_search_tool_result` block，且其 content 数组里有带 url 的条目
// 两条都成立 ⇒ 这家的流式透传可用。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const QUERY = "上海 今天 天气";

const VENDORS = [
  { id: "deepseek", baseUrl: "https://api.deepseek.com/anthropic", keyEnv: "DEEPSEEK_API_KEY", model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" },
  { id: "kimi", baseUrl: "https://api.moonshot.cn/anthropic", keyEnv: "KIMI_API_KEY", model: process.env.KIMI_MODEL || "kimi-k2.5" },
];

/** 扫 SSE 原文，把我们关心的两种 block 抠出来。 */
function judgeSse(raw) {
  const urls = [];
  let hasServerToolUse = false;
  let hasResultBlock = false;
  const blockTypes = new Set();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch {
      continue;
    }
    const cb = ev?.content_block;
    if (cb?.type) {
      blockTypes.add(cb.type);
      if (cb.type === "server_tool_use") hasServerToolUse = true;
      if (cb.type === "web_search_tool_result") {
        hasResultBlock = true;
        const c = cb.content;
        if (Array.isArray(c)) for (const it of c) if (typeof it?.url === "string") urls.push(it.url);
      }
    }
  }
  return {
    blockTypes: [...blockTypes],
    hasServerToolUse,
    hasResultBlock,
    urlCount: urls.length,
    urls: urls.slice(0, 5),
    streamPassthroughWorks: hasResultBlock && urls.length > 0,
  };
}

const records = [];
for (const v of VENDORS) {
  const key = process.env[v.keyEnv]?.trim();
  if (!key) {
    console.log(`${v.id.padEnd(10)} SKIP — 无 ${v.keyEnv}`);
    continue;
  }
  const url = `${v.baseUrl}/v1/messages?beta=true`;
  const t0 = Date.now();
  let rec;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        authorization: `Bearer ${key}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
      },
      body: JSON.stringify({
        model: v.model,
        max_tokens: 1024,
        stream: true,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
        messages: [{ role: "user", content: [{ type: "text", text: `Perform a web search for the query: ${QUERY}` }] }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    rec = { id: v.id, httpStatus: res.status, ms: Date.now() - t0, bytes: raw.length, ...judgeSse(raw), rawPreview: raw.slice(0, 300) };
  } catch (e) {
    rec = { id: v.id, ms: Date.now() - t0, fatal: `${e.name}: ${e.message}`, streamPassthroughWorks: false };
  }
  records.push(rec);
  if (rec.fatal) {
    console.log(`${v.id.padEnd(10)} FATAL ${rec.fatal}`);
    continue;
  }
  console.log(
    `${v.id.padEnd(10)} HTTP ${rec.httpStatus} ${String(rec.ms).padStart(6)}ms ${String(rec.bytes).padStart(7)}B ` +
      `blocks=[${rec.blockTypes.join(",")}] srvUse=${rec.hasServerToolUse} resultBlock=${rec.hasResultBlock} urls=${rec.urlCount} ` +
      `=> ${rec.streamPassthroughWorks ? "✅ 流式透传可用" : "❌"}`
  );
  if (rec.urlCount) console.log(`${" ".repeat(11)}${rec.urls.join(" | ").slice(0, 300)}`);
  if (!rec.streamPassthroughWorks) console.log(`${" ".repeat(11)}raw=${rec.rawPreview?.replace(/\s+/g, " ").slice(0, 260)}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `native-search-stream-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));
console.log(`\n结果 JSON: ${file}`);
