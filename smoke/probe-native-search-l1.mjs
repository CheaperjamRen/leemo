// smoke/probe-native-search-l1.mjs — 轮 4 卡 H3 探针①：**透传**这一层到底哪几家成立。
//
// 问的问题只有一个：把 CC 内置 WebSearch 的那次「嵌套服务端工具请求」**原样**发给
// 用户自己配的厂商 anthropic 端点，这家会不会真的替我们搜？
//
// 形状取自实测（smoke/websearch-nested-probe.mjs，本地假上游抓到的真实 body）：
//   POST {baseUrl}/v1/messages?beta=true
//   { model, max_tokens, tools:[{type:"web_search_20250305",name:"web_search",max_uses:N}],
//     messages:[{role:"user",content:[{type:"text",text:"Perform a web search for the query: <q>"}]}] }
//
// 判据是**四层机械信号**，不是"有没有报错"（台账反复点名的"空壳"就是不报错的那种）：
//   ① HTTP 状态 —— 400/422 = 这家诚实地不认这个工具类型
//   ② 响应 content 里有没有 `web_search_tool_result` block
//   ③ 该 block 的 content 是不是**非空数组**、里头有几条带 `url`
//   ④ 有没有 `server_tool_use` block（证明是它自己发起的搜索，不是模型编的文本）
// 只有 ②③ 同时成立才算这家能走透传。②有③空 = 空壳，必须记成失败。
//
// 顺带记 `usage.server_tool_use.web_search_requests` —— 那是"计入用户额度"的直接证据。
//
// 用法: node smoke/probe-native-search-l1.mjs           # 四家全跑
//       PROBE_ONLY=glm,kimi node smoke/probe-native-search-l1.mjs
// 需要 .env 里的四把 key。**默认不走代理**（本卡目标就是"国内直连可用"）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const QUERY = "上海 今天 天气";

/** 四家 = provider-catalog.ts 的预置表（baseUrl 必须与生产代码同源，否则探针白测）。 */
const VENDORS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/anthropic", keyEnv: "DEEPSEEK_API_KEY", model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" },
  { id: "glm", name: "GLM（智谱）", baseUrl: "https://open.bigmodel.cn/api/anthropic", keyEnv: "GLM_API_KEY", model: process.env.GLM_MODEL || "glm-5.2" },
  { id: "kimi", name: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/anthropic", keyEnv: "KIMI_API_KEY", model: process.env.KIMI_MODEL || "kimi-k2.5" },
  { id: "qwen", name: "通义千问（百炼）", baseUrl: process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/apps/anthropic", keyEnv: "DASHSCOPE_API_KEY", model: process.env.QWEN_MODEL || "qwen3.7-flash" },
];

/** CC 真实发出的那个 body。max_uses 照实测的 8。 */
function nestedSearchBody(model) {
  return {
    model,
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    messages: [
      { role: "user", content: [{ type: "text", text: `Perform a web search for the query: ${QUERY}` }] },
    ],
  };
}

/** 从一条完整 Message 里抽机械信号。刻意不看模型说了什么。 */
function judge(json) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const types = blocks.map((b) => b?.type);
  const srvUse = blocks.filter((b) => b?.type === "server_tool_use");
  const results = blocks.filter((b) => b?.type === "web_search_tool_result");
  let urls = [];
  let errorBlock = null;
  for (const r of results) {
    const c = r?.content;
    if (Array.isArray(c)) {
      for (const item of c) if (typeof item?.url === "string" && item.url) urls.push(item.url);
    } else if (c && typeof c === "object") {
      errorBlock = c; // {type:"web_search_tool_result_error", error_code}
    }
  }
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  return {
    blockTypes: types,
    hasServerToolUse: srvUse.length > 0,
    hasResultBlock: results.length > 0,
    urlCount: urls.length,
    urls: urls.slice(0, 5),
    errorBlock,
    text: text.slice(0, 400),
    serverToolUsage: json?.usage?.server_tool_use ?? null,
    stopReason: json?.stop_reason ?? null,
    // 承重判据：有结果块 **且** 至少一条带 url。只有块没 url ⇒ 空壳。
    passthroughWorks: results.length > 0 && urls.length > 0,
  };
}

async function probeVendor(v, { beta }) {
  const key = process.env[v.keyEnv]?.trim();
  if (!key) return { id: v.id, skipped: "no key in .env" };
  const url = `${v.baseUrl.replace(/\/+$/, "")}/v1/messages${beta ? "?beta=true" : ""}`;
  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    authorization: `Bearer ${key}`,
    "anthropic-version": "2023-06-01",
  };
  if (beta) headers["anthropic-beta"] = "web-search-2025-03-05";

  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(nestedSearchBody(v.model)),
      signal: AbortSignal.timeout(90_000),
    });
    const raw = await res.text();
    const ms = Date.now() - t0;
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {
      /* 非 JSON：原样留在 rawPreview 里 */
    }
    return {
      id: v.id,
      name: v.name,
      model: v.model,
      url,
      beta,
      httpStatus: res.status,
      ms,
      rawPreview: raw.slice(0, 600),
      apiError: json?.type === "error" ? json.error : null,
      ...(json && json.type !== "error" ? judge(json) : { passthroughWorks: false }),
    };
  } catch (e) {
    return { id: v.id, name: v.name, url, beta, ms: Date.now() - t0, fatal: `${e.name}: ${e.message}`, passthroughWorks: false };
  }
}

const only = process.env.PROBE_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const targets = only?.length ? VENDORS.filter((v) => only.includes(v.id)) : VENDORS;

const records = [];
for (const v of targets) {
  // 两臂：带 ?beta=true + anthropic-beta 头（CC 的真实做法）vs 裸请求。
  // 有的兼容层只在 beta 通道上认服务端工具，有的反而被 beta 头噎住 —— 都得试。
  for (const beta of [true, false]) {
    const r = await probeVendor(v, { beta });
    records.push(r);
    const tag = `${v.id}${beta ? " [beta]" : " [plain]"}`.padEnd(20);
    if (r.skipped) {
      console.log(`${tag} SKIP  ${r.skipped}`);
      continue;
    }
    if (r.fatal) {
      console.log(`${tag} FATAL ${r.fatal}`);
      continue;
    }
    console.log(
      `${tag} HTTP ${r.httpStatus} ${String(r.ms).padStart(6)}ms  ` +
        `blocks=[${(r.blockTypes ?? []).join(",")}] srvUse=${r.hasServerToolUse ?? false} ` +
        `resultBlock=${r.hasResultBlock ?? false} urls=${r.urlCount ?? 0} ` +
        `=> ${r.passthroughWorks ? "✅ 透传可用" : "❌ 不可用"}`
    );
    if (r.apiError) console.log(`${" ".repeat(20)} apiError: ${JSON.stringify(r.apiError).slice(0, 260)}`);
    if (r.errorBlock) console.log(`${" ".repeat(20)} errorBlock: ${JSON.stringify(r.errorBlock).slice(0, 200)}`);
    if (r.urlCount) console.log(`${" ".repeat(20)} urls: ${r.urls.join(" | ").slice(0, 300)}`);
    if (r.serverToolUsage) console.log(`${" ".repeat(20)} usage.server_tool_use: ${JSON.stringify(r.serverToolUsage)}`);
    if (!r.passthroughWorks && r.text) console.log(`${" ".repeat(20)} 模型说: ${r.text.replace(/\s+/g, " ").slice(0, 220)}`);
  }
}

console.log(`\n${"=".repeat(76)}\n层① 透传结论（承重判据 = 有 web_search_tool_result 且带 url）\n${"=".repeat(76)}`);
for (const v of targets) {
  const rs = records.filter((r) => r.id === v.id && !r.skipped);
  const ok = rs.find((r) => r.passthroughWorks);
  console.log(
    `  ${v.name.padEnd(18)} ${ok ? `✅ 走层① 可用（${ok.beta ? "beta" : "plain"} 通道，${ok.urlCount} 个 url）` : `❌ 层① 不成立 ⇒ 需层②/③`}`
  );
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `native-search-l1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));
console.log(`\n结果 JSON: ${file}`);
