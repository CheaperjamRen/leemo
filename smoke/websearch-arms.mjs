// smoke/websearch-arms.mjs — 对照实验：CC 内置 WebSearch / WebFetch 在第三方
// anthropic 端点下到底能不能用（轮 4 卡 H 补验）。
//
// 为什么要做：06 §4.1 断言"CC 内置 WebSearch 是 Anthropic 服务端工具，第三方
// 端点失效，必须自建"，卡 H 据此**无条件禁用**了 WebSearch/WebFetch。但用户
// 记忆是"接 DeepSeek API 时在 Claude Code 里能用原生 web search"。两者冲突，
// 而卡 H 从未实证过这一条 —— 循 comate/07 纪律：涉及 SDK 行为先实证。
//
// 判据（每臂都记）：
//   ① init 消息的 tools 数组里有没有 WebSearch / WebFetch（SDK 是否暴露）
//   ② 模型是否真去调它（tool_use）
//   ③ 调用返回的是结果还是错误，错误原文是什么
//   ④ 最终回答里有没有真·时效信息（能编的东西不算证据）
//
// 用法: node smoke/websearch-arms.mjs
// 需要 .env 里的 DEEPSEEK_API_KEY；有 ANTHROPIC_API_KEY 则自动加官方对照臂。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(ROOT, ".env"));

const SANDBOX = path.join(ROOT, ".leemo-workspace", "websearch-arms");
fs.mkdirSync(SANDBOX, { recursive: true });

/** 需要联网才能答对的问题：模型的训练数据里不可能有 2026-07-27 的天气。 */
const SEARCH_Q =
  "搜索一下今天（2026年7月27日）上海的天气，直接告诉我气温和天气状况。必须实际搜索，不要凭印象回答。";
/** 抓一个内容稳定、易判真假的 URL。 */
const FETCH_Q =
  "用 WebFetch 抓取 https://example.com 并把页面里的标题原文告诉我。必须实际抓取。";

function envFor({ baseUrl, apiKey, model }) {
  // 只给这一轮该有的东西：不 spread process.env，避免把别家 key 带进子进程。
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
  if (model) env.ANTHROPIC_MODEL = model;
  // 中转站那一臂需要走用户的私人 VPN（CLAUDE.md 已记：niubiapi 从本网络会 403
  // 掉 Node fetch，PowerShell 能过）。国内直连的家不要设，否则反而绕远。
  if (process.env.ARM_PROXY === "1") {
    env.NODE_USE_ENV_PROXY = "1";
    env.https_proxy = "http://127.0.0.1:10801";
    env.http_proxy = "http://127.0.0.1:10801";
    env.no_proxy = "127.0.0.1,localhost";
  }
  return env;
}

/** 跑一臂，返回观测记录。allowed = 只放行这一个工具，逼模型要么用它要么明说不行。 */
async function runArm(label, { baseUrl, apiKey, model, prompt, tool }) {
  const rec = {
    label,
    endpoint: baseUrl ?? "(默认 api.anthropic.com)",
    model: model ?? "(默认)",
    toolUnderTest: tool,
    exposedInInit: null,
    initToolCount: null,
    called: false,
    toolResults: [],
    errors: [],
    answer: "",
    fatal: null,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  try {
    const it = query({
      prompt,
      options: {
        cwd: SANDBOX,
        env: envFor({ baseUrl, apiKey, model }),
        abortController: ac,
        permissionMode: "bypassPermissions", // 对照实验不测审批，别让审批挡住工具
        settingSources: [],
        // 12 而非 6：首轮 C 臂（GLM）把轮次烧在反复失败的 WebFetch 上，
        // 结果以 error_max_turns 收场、拿不到 WebSearch 本身的判据。
        maxTurns: Number(process.env.ARM_MAX_TURNS ?? 12),
        // 关键：不禁用任何工具。卡 H 的 disallowedTools 正是要验证的对象。
      },
    });
    for await (const msg of it) {
      if (msg.type === "system" && msg.subtype === "init") {
        const tools = msg.tools ?? [];
        rec.initToolCount = tools.length;
        rec.exposedInInit = tools.includes(tool);
        rec.allTools = tools;
      }
      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_use" && block.name === tool) {
            rec.called = true;
            rec.toolInput = JSON.stringify(block.input).slice(0, 300);
          }
          if (block.type === "text" && block.text) rec.answer += block.text;
        }
      }
      if (msg.type === "user") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_result") {
            const body =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            rec.toolResults.push({
              isError: !!block.is_error,
              preview: String(body).slice(0, 500),
            });
            if (block.is_error) rec.errors.push(String(body).slice(0, 500));
          }
        }
      }
      if (msg.type === "result") {
        rec.resultSubtype = msg.subtype;
        rec.isError = !!msg.is_error;
        if (msg.result) rec.answer ||= String(msg.result);
      }
    }
  } catch (e) {
    rec.fatal = `${e.name}: ${e.message}`;
  } finally {
    clearTimeout(timer);
  }
  return rec;
}

const arms = [];
const dsKey = process.env.DEEPSEEK_API_KEY;
if (!dsKey) {
  console.error("DEEPSEEK_API_KEY 未配置 —— 这是主对照臂，必须有");
  process.exit(1);
}
const dsModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

arms.push([
  "A. DeepSeek 端点 × 内置 WebSearch",
  { baseUrl: "https://api.deepseek.com/anthropic", apiKey: dsKey, model: dsModel, prompt: SEARCH_Q, tool: "WebSearch" },
]);
arms.push([
  "B. DeepSeek 端点 × 内置 WebFetch",
  { baseUrl: "https://api.deepseek.com/anthropic", apiKey: dsKey, model: dsModel, prompt: FETCH_Q, tool: "WebFetch" },
]);

// 第二个第三方家：如果 WebSearch 在 DeepSeek 上失效而在这里能用，说明差别不在
// "第三方 vs 官方"，而在某个具体端点的实现 —— 那 06 §4.1 的因果就更站不住。
const glmKey = process.env.GLM_API_KEY;
if (glmKey) {
  arms.push([
    "C. GLM 端点 × 内置 WebSearch（第二个第三方家）",
    {
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKey: glmKey,
      model: process.env.GLM_MODEL || "glm-5.2",
      prompt: SEARCH_Q,
      tool: "WebSearch",
    },
  ]);
}

// 中转站走原生 anthropic 协议、转售真 Claude 模型 —— 最接近"官方端点"的对照，
// 在没有官方 key 的情况下用它补上这一格。
const relayKey = process.env.RELAY_API_KEY;
const relayBase = process.env.RELAY_BASE_URL;
if (relayKey && relayBase) {
  arms.push([
    "D. 中转站（原生 anthropic 协议 + 真 Claude 模型）× 内置 WebSearch",
    {
      baseUrl: relayBase,
      apiKey: relayKey,
      model: process.env.RELAY_MODEL,
      prompt: SEARCH_Q,
      tool: "WebSearch",
    },
  ]);
}

// 官方端点这一格没有 key，补不上 —— 结论里必须标明，不能假装验过。
const anthKey = process.env.ANTHROPIC_OFFICIAL_KEY;
if (anthKey) {
  arms.push(["E. 官方端点 × 内置 WebSearch（真对照）", { apiKey: anthKey, prompt: SEARCH_Q, tool: "WebSearch" }]);
} else {
  console.log("⚠️ 未设 ANTHROPIC_OFFICIAL_KEY ⇒ 无法跑官方端点对照臂。结论里会标明这个缺口。\n");
}

// 只跑指定臂：`ARMS=C,D node smoke/websearch-arms.mjs`。
// 首轮 C 因 maxTurns 用尽、D 因中转站 Cloudflare 拦 Node fetch 而没得出判据，
// 补跑时 C 需要更多轮次（它把轮次烧在失败的 WebFetch 上了），D 需要 VPN 三件套
// （CLAUDE.md 记的已知坑：niubiapi 从本网络会 403 掉 Node fetch）。
const only = (process.env.ARMS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const selected = only.length
  ? arms.filter(([label]) => only.includes(label.trim()[0].toUpperCase()))
  : arms;
if (only.length) console.log(`只跑臂: ${selected.map((a) => a[0].trim()[0]).join(",")}\n`);

const records = [];
for (const [label, cfg] of selected) {
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  const rec = await runArm(label, cfg);
  records.push(rec);
  console.log(`  端点          ${rec.endpoint}`);
  console.log(`  init 工具数    ${rec.initToolCount}`);
  console.log(`  ${rec.toolUnderTest} 在工具列表里  ${rec.exposedInInit}`);
  console.log(`  模型是否调用它  ${rec.called}${rec.toolInput ? ` input=${rec.toolInput.slice(0, 120)}` : ""}`);
  console.log(`  tool_result   ${rec.toolResults.length} 条，其中报错 ${rec.toolResults.filter((r) => r.isError).length} 条`);
  for (const r of rec.toolResults.slice(0, 2)) {
    console.log(`     [${r.isError ? "ERROR" : "ok"}] ${redact(r.preview).replace(/\s+/g, " ").slice(0, 220)}`);
  }
  if (rec.fatal) console.log(`  fatal         ${rec.fatal}`);
  console.log(`  result        subtype=${rec.resultSubtype} isError=${rec.isError}`);
  console.log(`  回答节选       ${redact(rec.answer).replace(/\s+/g, " ").slice(0, 260)}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `websearch-arms-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));

console.log(`\n${"=".repeat(72)}\n汇总\n${"=".repeat(72)}`);
for (const r of records) {
  // ⚠️ 判据不能只看 is_error。首轮我就是那么写的，于是把 GLM/中转站的**空壳
  // 返回**判成了"可用" —— 它们不标 error、却一个链接都没有，`tool_result` 里
  // 装的是模型自己写的话（被 CC 包成 "Web search results for query:…" 的样子）。
  // 那正是我在 Bing 那儿点名过的"长得像结果的垃圾"，探针自己踩了进去。
  //
  // 真结果的机械信号：`Links: [{"title":…,"url":…}]`。DeepSeek 有（5 个 url），
  // GLM 与中转站都是 0。搜索工具的价值全在"给出可引用的来源"，没链接就是没用。
  // ⚠️ 判据踩过两次坑，两次都记在这儿：
  //
  // 坑① 只看 is_error ⇒ 把 GLM/中转站的**空壳返回**判成"可用"。它们不标 error、
  //      却一个链接都没有，`tool_result` 里装的是模型自己写的话（被 CC 包成
  //      "Web search results for query:…" + REMINDER 样板的样子）。那正是我在
  //      Bing 那儿点名过的"长得像结果的垃圾"，探针自己踩了进去。
  //
  // 坑② 拿 WebSearch 专属的 `Links:` 信号去卡 WebFetch ⇒ 把真成功判成空壳。
  //      WebFetch 的成功长相是"页面内容"（如 `The page title is "Example
  //      Domain".`），本来就没有 Links 数组。判据必须按工具分开。
  const ok = r.toolResults.filter((t) => !t.isError);
  const verdict = r.fatal
    ? `fatal ${r.fatal}`
    : !r.exposedInInit
      ? "SDK 未暴露该工具"
      : !r.called
        ? "暴露了但模型没调（判据不足）"
        : r.toolUnderTest === "WebSearch"
          ? // 搜索的价值全在"给出可引用的来源"，没链接就是没用。
            ok.some((t) => /Links:\s*\[/.test(String(t.preview)) && /"url":/.test(String(t.preview)))
              ? "调了 → 真结果（有 Links 数组，可用）"
              : ok.length
                ? "调了 → 空壳（不标 error 但零链接 ⇒ 兼容层没实现，最危险的一种）"
                : "调了 → 报错（失效）"
          : // WebFetch：拿回页面内容就算成功；报错多为域名预检回连 claude.ai 失败。
            ok.some((t) => String(t.preview).trim().length > 10)
            ? "调了 → 拿到页面内容（可用）"
            : "调了 → 报错（多为域名安全预检需回连 claude.ai）";
  console.log(`  ${r.label.padEnd(34)} ${verdict}`);
}
console.log(`\n结果 JSON: ${file}`);
