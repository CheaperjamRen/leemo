// smoke/websearch-native-live.mjs — 轮 4 卡 H2 的决定性验收：
// **CC 内置的 WebSearch/WebFetch 在国内网络、不开 VPN、不装 MCP 的条件下真能用。**
//
// 这一条打真网、花真钱（几分钱），但它是唯一能证明"用户真的不用配 VPN"的东西。
// 单测只能证明帧的形状对；这里证明真 DeepSeek + 真 AnySearch + 真 CLI 串起来。
//
// 判据全是机械信号，**不看模型说得好不好**：
//   ① init 的工具列表里有 WebSearch（没被禁）
//   ② 模型真调了它
//   ③ shim 的 stats 显示嵌套搜索请求**真的被本地接下来了**（searchesAnswered≥1）
//      —— 这条最关键：它排除"其实是上游 DeepSeek 自己搜的"这种混淆
//   ④ tool_result 里有 Links: + 真 url，且 url 与 shim 这一轮实际返回的域名对得上
//   ⑤ WebFetch 那一臂：无预检报错 + 拿到页面真内容
//
// 用法: node smoke/websearch-native-live.mjs
// 需要 .env 的 DEEPSEEK_API_KEY。**刻意不设任何代理变量** —— 无代理是被测条件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(ROOT, ".env"));

const SANDBOX = path.join(ROOT, ".leemo-workspace", "websearch-native-live");
fs.mkdirSync(SANDBOX, { recursive: true });

const dsKey = process.env.DEEPSEEK_API_KEY;
if (!dsKey) {
  console.error("DEEPSEEK_API_KEY 未配置 —— 这是被测的国内模型端点，必须有");
  process.exit(1);
}
const dsModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

// 走真实现：shim + 搜索链都从 dist-smoke 的打包产物来（同 smoke:workspace 先例）。
// Windows: 动态 import 必须给 file:// URL，裸绝对路径会被当成 "e:" 协议而报
// ERR_UNSUPPORTED_ESM_URL_SCHEME。
const bundled = (name) => pathToFileURL(path.join(ROOT, "dist-smoke", name)).href;
const shimMod = await import(bundled("search-shim.mjs"));
const searchMod = await import(bundled("web-search.mjs"));

/** 本轮 shim 实际返回过的 URL —— 用来验"模型引用的确实是我们供的货"。 */
const served = [];

const shim = await shimMod.startSearchShim({
  resolveUpstream: (id) =>
    id === "deepseek"
      ? { baseUrl: "https://api.deepseek.com/anthropic", apiKey: dsKey }
      : undefined,
  runSearch: async (q) => {
    const keys = {};
    if (process.env.TAVILY_API_KEY) keys.tavilyKey = process.env.TAVILY_API_KEY;
    const outcome = await searchMod.runSearchChain(q, searchMod.buildSourceChain(keys));
    if (!outcome) return null;
    served.push(...outcome.hits.map((h) => h.url));
    console.log(`   [shim] 搜索源=${outcome.source} 命中 ${outcome.hits.length} 条`);
    return outcome.hits;
  },
  logger: {
    info: (m) => console.log(`   [shim] ${m}`),
    warn: (m) => console.warn(`   [shim] ${m}`),
    error: (m) => console.error(`   [shim] ${m}`),
  },
});

/** 无代理、占位 token —— 与生产接线一致（buildConversationEnv 的 shim 模式）。 */
function envFor() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${shim.port}`,
    ANTHROPIC_AUTH_TOKEN: "leemo-search:deepseek",
    ANTHROPIC_MODEL: dsModel,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

async function runArm(label, { prompt, tool }) {
  const rec = { label, tool, exposedInInit: null, called: false, toolResults: [], answer: "", fatal: null };
  const before = shim.stats();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 240_000);
  try {
    const it = query({
      prompt,
      options: {
        cwd: SANDBOX,
        env: envFor(),
        abortController: ac,
        permissionMode: "bypassPermissions",
        settingSources: [],
        maxTurns: 8,
        // 与生产一致：内置 WebSearch 放行 + 关掉 WebFetch 的 claude.ai 预检。
        extraArgs: { settings: JSON.stringify({ skipWebFetchPreflight: true }) },
      },
    });
    for await (const msg of it) {
      if (msg.type === "system" && msg.subtype === "init") {
        rec.exposedInInit = (msg.tools ?? []).includes(tool);
      }
      if (msg.type === "assistant") {
        for (const b of msg.message?.content ?? []) {
          if (b.type === "tool_use" && b.name === tool) rec.called = true;
          if (b.type === "text" && b.text) rec.answer += b.text;
        }
      }
      if (msg.type === "user") {
        for (const b of msg.message?.content ?? []) {
          if (b.type !== "tool_result") continue;
          const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          rec.toolResults.push({ isError: !!b.is_error, preview: String(body).slice(0, 700) });
        }
      }
      if (msg.type === "result") {
        rec.resultSubtype = msg.subtype;
        if (msg.result) rec.answer ||= String(msg.result);
      }
    }
  } catch (e) {
    rec.fatal = `${e.name}: ${e.message}`;
  } finally {
    clearTimeout(timer);
  }
  const after = shim.stats();
  rec.shimDelta = {
    answered: after.searchesAnswered - before.searchesAnswered,
    failed: after.searchesFailed - before.searchesFailed,
    passedThrough: after.passedThrough - before.passedThrough,
  };
  rec.preflightErrorSeen = rec.toolResults.some((t) => /safe to fetch|[Uu]nable to verify if domain/.test(t.preview));
  rec.linksSeen = rec.toolResults.some((t) => /Links:\s*\[/.test(t.preview) && /"url"/.test(t.preview));
  // ④ 的后半：模型看到的 url 里，至少有一个是本轮 shim 真供出去的。
  rec.servedUrlEchoed = served.some((u) => rec.toolResults.some((t) => t.preview.includes(u)));
  return rec;
}

const arms = [
  [
    "① 内置 WebSearch（经本地 shim 供货）",
    {
      tool: "WebSearch",
      prompt:
        "搜索一下 Vitest 4 有哪些新特性，给我 2 条来源链接。必须实际搜索，不要凭印象回答。",
    },
  ],
  [
    "② 内置 WebSearch × 中文数学（主场景）",
    { tool: "WebSearch", prompt: "搜索「高等数学 泰勒展开 例题」，给我 2 条来源链接。必须实际搜索。" },
  ],
  [
    "③ 内置 WebFetch（无 claude.ai 预检）",
    { tool: "WebFetch", prompt: "用 WebFetch 抓取 https://example.com ，把页面标题原文告诉我。必须实际抓取。" },
  ],
];

const records = [];
try {
  for (const [label, cfg] of arms) {
    console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
    const rec = await runArm(label, cfg);
    records.push(rec);
    console.log(`  ${rec.tool} 在 init 工具列表   ${rec.exposedInInit}`);
    console.log(`  模型是否调用             ${rec.called}`);
    console.log(`  shim 本臂增量            answered=${rec.shimDelta.answered} failed=${rec.shimDelta.failed} 透传=${rec.shimDelta.passedThrough}`);
    console.log(`  tool_result              ${rec.toolResults.length} 条，报错 ${rec.toolResults.filter((t) => t.isError).length} 条`);
    for (const t of rec.toolResults.slice(0, 2)) {
      console.log(`     [${t.isError ? "ERROR" : "ok"}] ${redact(t.preview).replace(/\s+/g, " ").slice(0, 300)}`);
    }
    console.log(`  Links:+url               ${rec.linksSeen}   shim 供的 url 被回传 ${rec.servedUrlEchoed}`);
    console.log(`  预检报错出现             ${rec.preflightErrorSeen}`);
    if (rec.fatal) console.log(`  fatal                    ${rec.fatal}`);
    console.log(`  回答节选                 ${redact(rec.answer).replace(/\s+/g, " ").slice(0, 300)}`);
  }
} finally {
  await shim.close();
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `websearch-native-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify({ records, servedUrls: served }, null, 2)));

console.log(`\n${"=".repeat(72)}\n判定\n${"=".repeat(72)}`);
let pass = 0;
for (const r of records) {
  let verdict;
  if (r.fatal) verdict = `FAIL fatal ${r.fatal}`;
  else if (!r.exposedInInit) verdict = "FAIL 工具被禁 / 未暴露";
  else if (!r.called) verdict = "FAIL 模型没调（判据不足）";
  else if (r.tool === "WebSearch") {
    if (r.shimDelta.answered < 1) verdict = "FAIL shim 没接到嵌套搜索请求（说明不是我们供的货）";
    else if (!r.linksSeen) verdict = "FAIL 无 Links/url（空壳）";
    else if (!r.servedUrlEchoed) verdict = "FAIL Links 里没有本轮 shim 供出去的 url";
    else verdict = "PASS 本地供货 → 真链接到达模型";
  } else if (r.preflightErrorSeen) verdict = "FAIL 预检仍在回连 claude.ai";
  else if (!r.toolResults.some((t) => !t.isError && t.preview.length > 10)) verdict = "FAIL 没拿到内容";
  else verdict = "PASS 无预检、拿到真内容";
  if (verdict.startsWith("PASS")) pass++;
  console.log(`  ${r.label.padEnd(34)} ${verdict}`);
}
console.log(`\n${pass}/${records.length} PASS   结果 JSON: ${file}`);
process.exit(pass === records.length ? 0 : 1);
