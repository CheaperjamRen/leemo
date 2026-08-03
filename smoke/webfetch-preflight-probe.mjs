// smoke/webfetch-preflight-probe.mjs — 轮 4 卡 H 续：内置 WebFetch 能不能在
// **不开 VPN** 的国内网络下用起来。
//
// 起因（用户要求）：只要用户配好国内模型的 API key，就该能直接用 CC 原生
// WebSearch/WebFetch，不该再教他配 VPN 或 MCP。上一轮的结论是"WebFetch 三家全
// 通，但要开 VPN"，那对真实用户等于不可用。
//
// 已在二进制里读到的根因（node_modules/.../claude.exe，`checkDomainBlocklist`）：
//   GET https://api.anthropic.com/api/web/domain_info?domain=<host>
//   200 + can_fetch:true → allowed；非 200 → check_failed → 抛
//   DomainCheckFailedError("Unable to verify if domain X is safe to fetch…")
// 本机实测该 URL 返回 **403 forbidden "Request not allowed"**（Cloudflare LAX
// 边缘）—— 不是连不上、也不是缺 key（这个 GET 本身不带鉴权），是被按网络/地区
// 拒了。于是国内直连必然 check_failed。
//
// 同一段代码里有开关：`if (!Wi().skipWebFetchPreflight) switch (await
// checkDomainBlocklist(host)) {…}` —— 置真则整段预检跳过，抓取全程在本地
// （axios GET + turndown 转 markdown），只有"把 markdown 交给模型总结"那一步走
// 用户自己的 ANTHROPIC_BASE_URL。
//
// 这个探针要回答三问：
//   ① 不设开关、不开 VPN：是否复现 DomainCheckFailedError（确认根因）
//   ② 经 SDK `extraArgs: {settings: JSON.stringify({skipWebFetchPreflight:true})}`
//      （CLI 的 --settings 吃"文件路径或 JSON 字符串"，属 flag 层，不受
//      managedSettings 的 restrictive-only 过滤）能否让开关真生效
//   ③ 抓国内站（用户真实场景）是否也通
//
// 用法: node smoke/webfetch-preflight-probe.mjs
// 需要 .env 里的 DEEPSEEK_API_KEY。**刻意不设任何代理环境变量**——这正是被测条件。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(ROOT, ".env"));

const SANDBOX = path.join(ROOT, ".leemo-workspace", "webfetch-preflight");
fs.mkdirSync(SANDBOX, { recursive: true });

const dsKey = process.env.DEEPSEEK_API_KEY;
if (!dsKey) {
  console.error("DEEPSEEK_API_KEY 未配置 —— 这是被测的国内模型端点，必须有");
  process.exit(1);
}
const dsModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

/** 只给这一轮该有的东西；**绝不设 http_proxy/https_proxy** —— 无代理是被测条件。 */
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
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: dsKey,
    ANTHROPIC_MODEL: dsModel,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

async function runArm(label, { url, settings, expectMarker }) {
  const rec = {
    label,
    url,
    settingsPassed: settings ?? null,
    exposedInInit: null,
    called: false,
    toolResults: [],
    preflightErrorSeen: false,
    answer: "",
    fatal: null,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 180_000);
  try {
    const it = query({
      prompt: `用 WebFetch 抓取 ${url} ，把页面里的标题原文告诉我。必须实际抓取，不要凭印象回答。`,
      options: {
        cwd: SANDBOX,
        env: envFor(),
        abortController: ac,
        permissionMode: "bypassPermissions",
        settingSources: [],
        maxTurns: 8,
        ...(settings ? { extraArgs: { settings: JSON.stringify(settings) } } : {}),
      },
    });
    for await (const msg of it) {
      if (msg.type === "system" && msg.subtype === "init") {
        rec.exposedInInit = (msg.tools ?? []).includes("WebFetch");
      }
      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "tool_use" && block.name === "WebFetch") rec.called = true;
          if (block.type === "text" && block.text) rec.answer += block.text;
        }
      }
      if (msg.type === "user") {
        for (const block of msg.message?.content ?? []) {
          if (block.type !== "tool_result") continue;
          const body =
            typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          const s = String(body);
          // 根因的机械信号：二进制里 DomainCheckFailedError 的原文。
          if (/[Uu]nable to verify if domain|safe to fetch/.test(s)) rec.preflightErrorSeen = true;
          rec.toolResults.push({ isError: !!block.is_error, preview: s.slice(0, 600) });
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
  // 成功判据按工具分开（上一轮踩过：拿 WebSearch 的 Links: 卡 WebFetch）。
  // WebFetch 的成功长相 = 拿回页面内容，故断言页面里**真实存在**的标记词。
  const ok = rec.toolResults.filter((t) => !t.isError);
  rec.gotContent = ok.some((t) => t.preview.length > 10);
  rec.markerHit = expectMarker ? new RegExp(expectMarker, "i").test(rec.answer) : null;
  return rec;
}

// 三臂。①②是同一条 URL 的对照（唯一变量 = 开关），③换国内站验真实场景。
const arms = [
  ["① 不设开关 / 无代理（复现根因）", { url: "https://example.com", expectMarker: "Example Domain" }],
  [
    "② 设 skipWebFetchPreflight / 无代理",
    {
      url: "https://example.com",
      settings: { skipWebFetchPreflight: true },
      expectMarker: "Example Domain",
    },
  ],
  [
    "③ 设开关 / 无代理 / 抓国内站",
    {
      url: "https://www.runoob.com/",
      settings: { skipWebFetchPreflight: true },
      expectMarker: "菜鸟教程|runoob",
    },
  ],
];

const only = (process.env.ARMS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const selected = only.length ? arms.filter(([l]) => only.some((o) => l.includes(o))) : arms;

const records = [];
for (const [label, cfg] of selected) {
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  const rec = await runArm(label, cfg);
  records.push(rec);
  console.log(`  URL              ${rec.url}`);
  console.log(`  --settings       ${rec.settingsPassed ? JSON.stringify(rec.settingsPassed) : "(未传)"}`);
  console.log(`  WebFetch 在工具列表 ${rec.exposedInInit}`);
  console.log(`  模型是否调用       ${rec.called}`);
  console.log(
    `  tool_result      ${rec.toolResults.length} 条，报错 ${rec.toolResults.filter((r) => r.isError).length} 条`
  );
  for (const r of rec.toolResults.slice(0, 2)) {
    console.log(`     [${r.isError ? "ERROR" : "ok"}] ${redact(r.preview).replace(/\s+/g, " ").slice(0, 240)}`);
  }
  console.log(`  预检报错出现       ${rec.preflightErrorSeen}`);
  console.log(`  拿到内容           ${rec.gotContent}   标记命中 ${rec.markerHit}`);
  if (rec.fatal) console.log(`  fatal            ${rec.fatal}`);
  console.log(`  回答节选           ${redact(rec.answer).replace(/\s+/g, " ").slice(0, 240)}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `webfetch-preflight-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));

console.log(`\n${"=".repeat(72)}\n汇总\n${"=".repeat(72)}`);
for (const r of records) {
  const verdict = r.fatal
    ? `fatal ${r.fatal}`
    : !r.called
      ? "模型没调（判据不足）"
      : r.preflightErrorSeen
        ? "预检失败（回连 api.anthropic.com 被拒）⇒ 不可用"
        : r.markerHit
          ? "抓到真内容且标记命中 ⇒ 可用"
          : r.gotContent
            ? "有内容但标记未命中（存疑，看节选）"
            : "无内容 ⇒ 不可用";
  console.log(`  ${r.label.padEnd(36)} ${verdict}`);
}
console.log(`\n结果 JSON: ${file}`);
