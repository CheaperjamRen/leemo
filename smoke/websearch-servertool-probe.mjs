// smoke/websearch-servertool-probe.mjs — 内置 WebSearch 到底是怎么走的，以及
// **我们能不能自己在本地把它实现掉**（轮 4 卡 H 续，用户要求"去掉对 claude.ai
// 的依赖，让原生工具在国内可用"）。
//
// 从二进制里读到的事实（node_modules/.../claude.exe）：
//   ① CCR 代理路径 `MVu()`：`if (Hn()!=="firstParty") return false;` +
//      需要 CLAUDE_CODE_WEBSEARCH_USE_CCR_PROXY —— 要 Anthropic 一方登录，
//      且请求本身发往 Anthropic。对我们无用（正是要去掉的那条依赖）。
//   ② 默认路径 `izg()`：把 `{type:"web_search_20250305", name:"web_search",
//      max_uses:8}` 作为**服务端工具**塞进 /v1/messages 的 tools 数组，由**上游
//      端点**执行，结果以 `server_tool_use` + `web_search_tool_result` 两种
//      content block 回来（解析器 `szg` 读的就是这两个 type）。
//   ⇒ 所以"内置 WebSearch 能不能用"完全由上游端点是否实现该服务端工具决定。
//      DeepSeek 实现了、GLM/中转站没实现（空壳）。
//
// 本探针不打真上游，起一个**本地假 Anthropic 端点**，因此确定、免费、可复跑。
// 要回答四问：
//   Q1 我们当前配置（disallowedTools:["WebSearch"]）下，CC 到底还会不会把
//      web_search_20250305 发给上游？（发了=白付 token 且给兼容层添乱）
//   Q2 不禁用时发的确切形状是什么？
//   Q3 **本地端点自己合成 server_tool_use + web_search_tool_result，CC 认不认？**
//      认 → "网关自建服务端工具"这条路可行；不认 → 这条路直接不用考虑。
//   Q4 若认，SDK 向上抛的是什么消息形状？（决定 Leemo 的 events.ts 能不能把
//      "momo 搜了网"渲染成时间线上看得见的一张卡）
//
// 用法: node smoke/websearch-servertool-probe.mjs
// 不需要任何 API key、不需要网络、不花钱。
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX = path.join(ROOT, ".leemo-workspace", "websearch-servertool");
fs.mkdirSync(SANDBOX, { recursive: true });

/** 假上游收到的每个请求都记下来，供 Q1/Q2 判据。 */
const seen = [];

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * 合成一条"服务端工具搜索成功"的 assistant 消息。
 * 这正是 Q3 要验的东西：如果 CC 接受这套帧，我们的网关就能照这个形状自建。
 */
function writeServerToolStream(res, { query: q, results, tail }) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const srvId = "srvtoolu_leemo_probe_1";
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: "msg_leemo_probe",
      type: "message",
      role: "assistant",
      model: "probe-model",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  });
  // ① server_tool_use：模型"发起搜索"
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "server_tool_use", id: srvId, name: "web_search", input: {} },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: q }) },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  // ② web_search_tool_result：**搜索结果**（真实场景里由我们本地搜索源产出）
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: srvId,
      content: results.map((r) => ({
        type: "web_search_result",
        title: r.title,
        url: r.url,
        page_age: null,
        encrypted_content: "leemo-probe",
      })),
    },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 1 });
  // ③ 正文
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 2,
    content_block: { type: "text", text: "" },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 2,
    delta: { type: "text_delta", text: tail },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 2 });
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 40 },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

function writePlainStream(res, text) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: "msg_leemo_plain",
      type: "message",
      role: "assistant",
      model: "probe-model",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 1 },
    },
  });
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

/** 假 Anthropic 端点。serveServerTool=true 时第一条 /v1/messages 回搜索帧。 */
function startFakeUpstream({ serveServerTool }) {
  let served = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        /* 非 JSON（不该出现），忽略 */
      }
      seen.push({
        method: req.method,
        url: req.url,
        tools: (parsed?.tools ?? []).map((t) => ({ type: t.type, name: t.name })),
        toolCount: (parsed?.tools ?? []).length,
      });
      if (req.url?.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 100 }));
        return;
      }
      if (req.url?.includes("/v1/messages")) {
        if (serveServerTool && served === 0) {
          served++;
          writeServerToolStream(res, {
            query: "上海 天气 2026年7月27日",
            results: [
              { title: "上海天气预报-中国天气网", url: "https://www.weather.com.cn/weather/101020100.shtml" },
              { title: "上海市气象局", url: "https://sh.cma.gov.cn/" },
            ],
            tail: "根据搜索结果，今天上海多云，气温 29℃~35℃。",
          });
          return;
        }
        writePlainStream(res, "好的。");
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: req.url } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function runArm(label, { disallowWebSearch, serveServerTool }) {
  seen.length = 0;
  const { server, port } = await startFakeUpstream({ serveServerTool });
  const rec = {
    label,
    disallowWebSearch,
    serveServerTool,
    exposedInInit: null,
    sentServerToolToUpstream: null,
    upstreamToolTypes: [],
    sdkMessageKinds: [],
    serverToolBlocksSeenBySdk: [],
    toolResults: [],
    answer: "",
    fatal: null,
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  try {
    const it = query({
      prompt: "搜索一下今天上海的天气，告诉我气温。必须实际搜索。",
      options: {
        cwd: SANDBOX,
        abortController: ac,
        permissionMode: "bypassPermissions",
        settingSources: [],
        maxTurns: 4,
        ...(disallowWebSearch ? { disallowedTools: ["WebSearch"] } : {}),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USERPROFILE: process.env.USERPROFILE,
          APPDATA: process.env.APPDATA,
          LOCALAPPDATA: process.env.LOCALAPPDATA,
          SystemRoot: process.env.SystemRoot,
          TEMP: process.env.TEMP,
          ANTHROPIC_API_KEY: "probe-key-not-real",
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_MODEL: "probe-model",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
      },
    });
    for await (const msg of it) {
      rec.sdkMessageKinds.push(msg.type === "system" ? `system:${msg.subtype}` : msg.type);
      if (msg.type === "system" && msg.subtype === "init") {
        rec.exposedInInit = (msg.tools ?? []).includes("WebSearch");
      }
      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          // Q4：SDK 向上抛的块类型 —— 决定 Leemo events.ts 能不能渲染出来
          if (block.type === "server_tool_use" || block.type === "web_search_tool_result") {
            rec.serverToolBlocksSeenBySdk.push({
              type: block.type,
              name: block.name,
              contentLen: Array.isArray(block.content) ? block.content.length : undefined,
            });
          }
          if (block.type === "text" && block.text) rec.answer += block.text;
        }
      }
      if (msg.type === "user") {
        for (const block of msg.message?.content ?? []) {
          if (block.type !== "tool_result") continue;
          const b = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          rec.toolResults.push({ isError: !!block.is_error, preview: String(b).slice(0, 400) });
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
    server.close();
  }
  const msgReqs = seen.filter((s) => s.url?.includes("/v1/messages") && !s.url.includes("count_tokens"));
  rec.upstreamToolTypes = [...new Set(msgReqs.flatMap((r) => r.tools.map((t) => `${t.type ?? "(client)"}:${t.name}`)))];
  rec.sentServerToolToUpstream = msgReqs.some((r) =>
    r.tools.some((t) => typeof t.type === "string" && t.type.startsWith("web_search_"))
  );
  rec.upstreamRequestCount = msgReqs.length;
  return rec;
}

const arms = [
  ["A. 不禁用 + 上游不实现（复现空壳）", { disallowWebSearch: false, serveServerTool: false }],
  ["B. 不禁用 + **本地端点自建服务端工具**", { disallowWebSearch: false, serveServerTool: true }],
  ["C. 当前生产配置 disallowedTools:['WebSearch']", { disallowWebSearch: true, serveServerTool: false }],
];

const records = [];
for (const [label, cfg] of arms) {
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  const rec = await runArm(label, cfg);
  records.push(rec);
  console.log(`  WebSearch 在 init 工具列表        ${rec.exposedInInit}`);
  console.log(`  CC 是否把服务端工具发给上游        ${rec.sentServerToolToUpstream}`);
  console.log(`  上游收到的 tools（去重）          ${rec.upstreamToolTypes.join(", ") || "(空)"}`);
  console.log(`  /v1/messages 请求数              ${rec.upstreamRequestCount}`);
  console.log(
    `  SDK 抛出的服务端工具块            ${
      rec.serverToolBlocksSeenBySdk.length
        ? JSON.stringify(rec.serverToolBlocksSeenBySdk)
        : "(无)"
    }`
  );
  console.log(`  tool_result 条数                 ${rec.toolResults.length}`);
  for (const t of rec.toolResults.slice(0, 2)) {
    console.log(`     [${t.isError ? "ERROR" : "ok"}] ${t.preview.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  if (rec.fatal) console.log(`  fatal                          ${rec.fatal}`);
  console.log(`  回答节选                         ${rec.answer.replace(/\s+/g, " ").slice(0, 200)}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `websearch-servertool-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify(records, null, 2));
console.log(`\n结果 JSON: ${file}`);
