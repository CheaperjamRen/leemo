// smoke/websearch-vendor-native-live.mjs — 轮 4 卡 H3 的决定性验收：
// **内置 WebSearch 走的是厂商自己的搜索服务、花用户自己的额度，外部源一次没碰。**
//
// 打真网、花真钱（几分钱）。单测只能证明层序逻辑对；这里证明真 CLI + 真厂商端点
// + 真降级链串起来，且**不开代理**（无 VPN 是被测条件）。
//
// 四臂，前两臂钉"原生真的通了"，后两臂钉"边界真的守住了"：
//   ① DeepSeek 对话  → 期望 byLayer.passthrough≥1、external=0（层① 厂商原生）
//   ② GLM 对话       → 期望 byLayer.vendor≥1、external=0（层② GLM 自家搜索 API）
//   ③ 通义 + GLM/DeepSeek 都配好 → 期望 **byLayer.external≥1**
//        这一臂是**边界测试**（用户 7/27 拍板）：通义自己搜不了时，**不许**去花
//        GLM/DeepSeek 的额度，必须掉外部源。我原先做的"跨家借"就是在这里被否掉的。
//   ④ 只配通义一家   → 期望 byLayer.external≥1（兜底仍在，且日志说清走了第几层）
//
// 判据全是机械信号，**不看模型说得好不好**：
//   · init 的工具列表里有 WebSearch（没被禁）
//   · 模型真调了它
//   · shim 的 byLayer 增量落在**预期的那一层**（这是本卡的承重判据）
//   · tool_result 里有 Links: + 真 url
//
// 用法: node smoke/websearch-vendor-native-live.mjs
//       ARMS=1,2 node smoke/websearch-vendor-native-live.mjs   # 只跑指定臂
// 需要 .env 的 DEEPSEEK_API_KEY / GLM_API_KEY / DASHSCOPE_API_KEY。
// 先跑: npx esbuild src/host/{search-shim,web-search,vendor-search,search-plan,provider-catalog}.ts \
//         --bundle --platform=node --format=esm --outdir=dist-smoke --out-extension:.js=.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const SANDBOX = path.join(ROOT, ".leemo-workspace", "websearch-vendor-native");
fs.mkdirSync(SANDBOX, { recursive: true });

const bundled = (n) => pathToFileURL(path.join(ROOT, "dist-smoke", n)).href;
const shimMod = await import(bundled("search-shim.mjs"));
const searchMod = await import(bundled("web-search.mjs"));
const planMod = await import(bundled("search-plan.mjs"));
const catalogMod = await import(bundled("provider-catalog.mjs"));

/** 外部源被调用的次数 —— 层①② 成立时这个数必须保持 0。 */
let externalCalls = 0;

/**
 * 起一个 shim，catalog 由 env 决定（与生产同一条 buildCatalog 路径，不是手搓的
 * 假 catalog —— 那样会把 provider-catalog 里的实测数据绕过去）。
 */
async function startShim(env) {
  const catalog = catalogMod.buildCatalog(env);
  const configured = catalog.filter((e) => e.provider.apiKey).map((e) => e.provider.id);
  const shim = await shimMod.startSearchShim({
    resolveUpstream: (id) => {
      const e = catalog.find((x) => x.provider.id === id);
      return e ? { baseUrl: e.provider.baseUrl, apiKey: e.provider.apiKey } : undefined;
    },
    resolveSearchPlan: (id) => planMod.buildSearchPlan(catalog, id, fetch),
    runSearch: async (q) => {
      externalCalls++;
      const keys = {};
      if (process.env.TAVILY_API_KEY) keys.tavilyKey = process.env.TAVILY_API_KEY;
      const outcome = await searchMod.runSearchChain(q, searchMod.buildSourceChain(keys));
      console.log(`   [shim] 层③ 外部源=${outcome?.source ?? "全挂"} ${outcome?.hits.length ?? 0} 条`);
      return outcome ? outcome.hits : null;
    },
    logger: {
      info: (m) => console.log(`   [shim] ${m}`),
      warn: (m) => console.warn(`   [shim] ${m}`),
      error: (m) => console.error(`   [shim] ${m}`),
    },
  });
  return { shim, configured };
}

async function runArm(arm) {
  const env = {};
  for (const [k, v] of Object.entries(arm.env)) if (process.env[v]) env[v] = process.env[v];
  const missing = Object.entries(arm.env).filter(([, v]) => !process.env[v]);
  if (missing.length) return { label: arm.label, skipped: `缺 ${missing.map(([, v]) => v).join(",")}` };

  const { shim, configured } = await startShim(env);
  const rec = {
    label: arm.label,
    provider: arm.providerId,
    expectLayer: arm.expectLayer,
    boundaryArm: arm.boundaryArm === true,
    configured,
    exposedInInit: null,
    called: false,
    toolResults: [],
    answer: "",
    fatal: null,
  };
  const before = shim.stats();
  const extBefore = externalCalls;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300_000);
  try {
    const it = query({
      prompt: arm.prompt,
      options: {
        cwd: SANDBOX,
        abortController: ac,
        permissionMode: "bypassPermissions",
        settingSources: [],
        maxTurns: 8,
        // 与生产接线一致（buildConversationEnv 的 shim 模式）：占位 token、无代理。
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          APPDATA: process.env.APPDATA,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${shim.port}`,
          ANTHROPIC_AUTH_TOKEN: `leemo-search:${arm.providerId}`,
          ANTHROPIC_MODEL: arm.model,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        extraArgs: { settings: JSON.stringify({ skipWebFetchPreflight: true }) },
      },
    });
    for await (const msg of it) {
      if (msg.type === "system" && msg.subtype === "init") rec.exposedInInit = (msg.tools ?? []).includes("WebSearch");
      if (msg.type === "assistant") {
        for (const b of msg.message?.content ?? []) {
          if (b.type === "tool_use" && b.name === "WebSearch") rec.called = true;
          if (b.type === "text" && b.text) rec.answer += b.text;
        }
      }
      if (msg.type === "user") {
        for (const b of msg.message?.content ?? []) {
          if (b.type !== "tool_result") continue;
          const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          rec.toolResults.push({ isError: !!b.is_error, preview: String(body).slice(0, 800) });
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
    await shim.close();
  }
  const after = shim.stats();
  rec.byLayerDelta = {
    passthrough: after.byLayer.passthrough - before.byLayer.passthrough,
    vendor: after.byLayer.vendor - before.byLayer.vendor,
    external: after.byLayer.external - before.byLayer.external,
  };
  rec.failedDelta = after.searchesFailed - before.searchesFailed;
  rec.externalCallDelta = externalCalls - extBefore;
  rec.linksSeen = rec.toolResults.some((t) => /Links:\s*\[/.test(t.preview) && /"url"/.test(t.preview));
  rec.urlsInResult = [
    ...new Set([...rec.toolResults.map((t) => t.preview).join("\n").matchAll(/https?:\/\/[^\s"'\\<>)\]]+/g)].map((m) => m[0])),
  ].slice(0, 5);
  return rec;
}

const DS_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const GLM_MODEL = process.env.GLM_MODEL || "glm-5.2";
const QWEN_MODEL = process.env.QWEN_MODEL || "qwen3.7-flash";
const PROMPT = "搜索一下今天上海的天气，给我 2 条来源链接。必须实际搜索，不要凭印象回答。";

const ARMS = [
  {
    id: "1",
    label: "① DeepSeek → 层① 厂商端点原生透传",
    providerId: "deepseek",
    model: DS_MODEL,
    // 只给 DeepSeek 的 key ⇒ 排除"其实是借了别家"这种混淆
    env: { DEEPSEEK_API_KEY: "DEEPSEEK_API_KEY" },
    expectLayer: "passthrough",
    prompt: PROMPT,
  },
  {
    id: "2",
    label: "② GLM → 层② 厂商自己的搜索 API",
    providerId: "glm",
    model: GLM_MODEL,
    env: { GLM_API_KEY: "GLM_API_KEY" },
    expectLayer: "vendor",
    prompt: PROMPT,
  },
  {
    id: "3",
    label: "③ 边界：通义 + GLM/DeepSeek 都配好 → 仍走外部源，不花别家额度",
    providerId: "qwen",
    model: QWEN_MODEL,
    // 三家 key 都在场 —— 这才是边界测试成立的前提：有别家可借而**没去借**。
    env: {
      DASHSCOPE_API_KEY: "DASHSCOPE_API_KEY",
      GLM_API_KEY: "GLM_API_KEY",
      DEEPSEEK_API_KEY: "DEEPSEEK_API_KEY",
    },
    expectLayer: "external",
    boundaryArm: true,
    prompt: PROMPT,
  },
  {
    id: "4",
    label: "④ 只配通义一家 → 层③ 外部源兜底",
    providerId: "qwen",
    model: QWEN_MODEL,
    env: { DASHSCOPE_API_KEY: "DASHSCOPE_API_KEY" },
    expectLayer: "external",
    prompt: PROMPT,
  },
];

const only = process.env.ARMS?.split(",").map((s) => s.trim()).filter(Boolean);
const targets = only?.length ? ARMS.filter((a) => only.includes(a.id)) : ARMS;

const records = [];
for (const arm of targets) {
  console.log(`\n${"=".repeat(76)}\n${arm.label}\n${"=".repeat(76)}`);
  const rec = await runArm(arm);
  records.push(rec);
  if (rec.skipped) {
    console.log(`  SKIP ${rec.skipped}`);
    continue;
  }
  console.log(`  已配置的家              ${rec.configured.join(", ")}`);
  console.log(`  WebSearch 在 init       ${rec.exposedInInit}   模型是否调用 ${rec.called}`);
  console.log(
    `  byLayer 增量            透传=${rec.byLayerDelta.passthrough} 自家=${rec.byLayerDelta.vendor} ` +
      `外部=${rec.byLayerDelta.external} 全挂=${rec.failedDelta}`
  );
  console.log(`  外部源被调用次数        ${rec.externalCallDelta}（层①② 成立时应为 0）`);
  console.log(`  Links:+url              ${rec.linksSeen}`);
  console.log(`  结果里的 url            ${rec.urlsInResult.join(" | ").slice(0, 240)}`);
  if (rec.fatal) console.log(`  fatal                   ${rec.fatal}`);
  console.log(`  回答节选                ${redact(rec.answer).replace(/\s+/g, " ").slice(0, 260)}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `websearch-vendor-native-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, redact(JSON.stringify(records, null, 2)));

console.log(`\n${"=".repeat(76)}\n判定\n${"=".repeat(76)}`);
let pass = 0;
let ran = 0;
for (const r of records) {
  if (r.skipped) {
    console.log(`  ${r.label.padEnd(44)} SKIP`);
    continue;
  }
  ran++;
  let verdict;
  const got = r.byLayerDelta;
  if (r.fatal) verdict = `FAIL fatal ${r.fatal}`;
  else if (!r.exposedInInit) verdict = "FAIL WebSearch 被禁 / 未暴露";
  else if (!r.called) verdict = "FAIL 模型没调（判据不足）";
  else if (got[r.expectLayer] < 1) verdict = `FAIL 期望走层 ${r.expectLayer}，实际 ${JSON.stringify(got)}`;
  else if (r.expectLayer !== "external" && got.external > 0)
    verdict = `FAIL 碰了外部源 ${got.external} 次（本臂应为 0）`;
  // 边界臂（③）的额外判据：**本对话这一家之外的任何原生搜索都不许被调用**。
  // 通义走 external 是对的；若 vendor/passthrough 有增量，说明借了别家的额度。
  else if (r.boundaryArm && (got.vendor > 0 || got.passthrough > 0))
    verdict = `FAIL 越界：花了别家的额度（自家=${got.vendor} 透传=${got.passthrough}）`;
  else if (!r.linksSeen) verdict = "FAIL 无 Links/url（空壳）";
  else verdict = r.boundaryArm
    ? `PASS 边界守住：别家 key 在场但零调用，走 external ${got.external} 次`
    : `PASS 走层 ${r.expectLayer}，外部源 ${got.external} 次`;
  if (verdict.startsWith("PASS")) pass++;
  console.log(`  ${r.label.padEnd(44)} ${verdict}`);
}
console.log(`\n${pass}/${ran} PASS   结果 JSON: ${file}`);
process.exit(ran > 0 && pass === ran ? 0 : 1);
