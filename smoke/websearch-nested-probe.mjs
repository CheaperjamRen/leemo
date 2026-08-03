// smoke/websearch-nested-probe.mjs — 决定性探针：内置 WebSearch 被模型调用后，
// CC 在**本地**干了什么，那个"服务端工具"请求发到哪儿去。
//
// 上一个探针（websearch-servertool-probe.mjs）推翻了我读二进制得出的第一个结论：
// `WebSearch` 是以**客户端工具**（tools[] 里无 type 字段的普通函数工具）发给上游的，
// 不是 `{type:"web_search_20250305"}`。所以搜索**不是**由对话所在的那次 API 调用
// 顺便完成的 —— CC 自己在本地实现了 WebSearch 工具，被调用时另发一次请求。
//
// 那么关键就是：**那次嵌套请求发到哪个 base URL？**
//   若发到用户配置的 ANTHROPIC_BASE_URL ⇒ 它在我们能碰到的路径上，
//     我们可以在本地把它答掉（自己搜、自己合成 server_tool_use +
//     web_search_tool_result），于是内置 WebSearch 在**任何** provider 上都能用，
//     且完全不碰 claude.ai。这是用户要的那条路。
//   若硬编码发往 api.anthropic.com ⇒ 国内必死，只能自建 MCP。
//
// 判据全是机械信号，不看模型说什么：
//   ① 嵌套请求是否到达本地假上游（到了几条、路径是什么）
//   ② 该请求的 tools[] 里有没有 type 以 `web_search_` 开头的条目
//   ③ 我们合成的 server_tool_use + web_search_tool_result 回去后，
//      模型收到的 tool_result 里有没有 `Links:` + 真 url（= CC 的解析器认了）
//
// 用法: node smoke/websearch-nested-probe.mjs
// 不需要 API key、不需要网络、不花钱。
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX = path.join(ROOT, ".leemo-workspace", "websearch-nested");
fs.mkdirSync(SANDBOX, { recursive: true });

const LEEMO_RESULTS = [
  { title: "上海天气预报-中国天气网", url: "https://www.weather.com.cn/weather/101020100.shtml" },
  { title: "上海市气象局 - 今日天气", url: "https://sh.cma.gov.cn/" },
  { title: "AnySearch 命中的第三条", url: "https://example.org/sh-weather" },
];

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function openStream(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}
function msgStart(res, id) {
  sse(res, "message_start", {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "probe-model",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  });
}
function msgEnd(res, stopReason) {
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 30 },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

/** 第一条主对话请求：模型决定调用客户端工具 WebSearch。 */
function streamToolUse(res) {
  openStream(res);
  msgStart(res, "msg_main_1");
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "我来搜一下。" },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_probe_ws_1", name: "WebSearch", input: {} },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: {
      type: "input_json_delta",
      partial_json: JSON.stringify({ query: "上海 今天 天气 2026年7月27日" }),
    },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 1 });
  msgEnd(res, "tool_use");
}

/**
 * 嵌套的"服务端工具"请求的应答 —— 这正是我们将来要在网关/本地 shim 里自建的东西。
 * 结果来自 LEEMO_RESULTS（真实场景 = AnySearch/Tavily 的返回）。
 */
function streamServerToolAnswer(res) {
  openStream(res);
  msgStart(res, "msg_nested_1");
  const srvId = "srvtoolu_leemo_1";
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "server_tool_use", id: srvId, name: "web_search", input: {} },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "上海 今天 天气" }) },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "web_search_tool_result",
      tool_use_id: srvId,
      content: LEEMO_RESULTS.map((r) => ({
        type: "web_search_result",
        title: r.title,
        url: r.url,
        page_age: null,
        encrypted_content: "leemo",
      })),
    },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 1 });
  msgEnd(res, "end_turn");
}

/** 收尾：模型基于搜索结果作答。 */
function streamFinal(res) {
  openStream(res);
  msgStart(res, "msg_main_2");
  sse(res, "content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  sse(res, "content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "text_delta",
      text: "根据 weather.com.cn 的结果，今天上海多云，29℃~35℃。",
    },
  });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  msgEnd(res, "end_turn");
}

const seen = [];

function startFakeUpstream({ answerNested }) {
  let mainTurn = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        /* ignore */
      }
      const tools = parsed?.tools ?? [];
      const serverTools = tools.filter((t) => typeof t?.type === "string" && t.type.startsWith("web_search_"));
      const isNestedSearch = serverTools.length > 0;
      seen.push({
        url: req.url,
        model: parsed?.model,
        isNestedSearch,
        serverToolTypes: serverTools.map((t) => `${t.type}/${t.name}/max_uses=${t.max_uses}`),
        toolCount: tools.length,
        clientToolNames: tools.filter((t) => !t?.type).map((t) => t.name),
        // 嵌套请求带的 messages 形状 —— 决定我们本地实现从哪儿取 query
        messages: (parsed?.messages ?? []).map((m) => ({
          role: m.role,
          content:
            typeof m.content === "string"
              ? m.content.slice(0, 300)
              : (m.content ?? []).map((b) => ({
                  type: b.type,
                  text: typeof b.text === "string" ? b.text.slice(0, 300) : undefined,
                  name: b.name,
                })),
        })),
        systemPreview:
          typeof parsed?.system === "string"
            ? parsed.system.slice(0, 200)
            : Array.isArray(parsed?.system)
              ? parsed.system.map((s) => String(s?.text ?? "").slice(0, 200))
              : undefined,
      });

      if (req.url?.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: 100 }));
        return;
      }
      if (!req.url?.includes("/v1/messages")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "not_found", message: req.url } }));
        return;
      }
      if (isNestedSearch) {
        if (answerNested) streamServerToolAnswer(res);
        else {
          // 模拟 GLM 那种"不实现服务端工具"的兼容层：照常聊天，零链接 = 空壳
          openStream(res);
          msgStart(res, "msg_nested_shell");
          sse(res, "content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          });
          sse(res, "content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "我没有搜索工具，不过我猜今天天气不错。" },
          });
          sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
          msgEnd(res, "end_turn");
        }
        return;
      }
      mainTurn++;
      if (mainTurn === 1) streamToolUse(res);
      else streamFinal(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function runArm(label, { answerNested }) {
  seen.length = 0;
  const { server, port } = await startFakeUpstream({ answerNested });
  const rec = { label, answerNested, toolResults: [], answer: "", fatal: null };
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
      if (msg.type === "user") {
        for (const block of msg.message?.content ?? []) {
          if (block.type !== "tool_result") continue;
          const b = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          rec.toolResults.push({ isError: !!block.is_error, body: String(b) });
        }
      }
      if (msg.type === "assistant") {
        for (const block of msg.message?.content ?? []) {
          if (block.type === "text" && block.text) rec.answer += block.text;
        }
      }
      if (msg.type === "result") rec.resultSubtype = msg.subtype;
    }
  } catch (e) {
    rec.fatal = `${e.name}: ${e.message}`;
  } finally {
    clearTimeout(timer);
    server.close();
  }
  rec.requests = [...seen];
  rec.nestedRequests = seen.filter((s) => s.isNestedSearch);
  // 成功判据：CC 的解析器把我们的合成块变成了带真 url 的 Links
  rec.linksInToolResult = rec.toolResults.some(
    (t) => /Links:\s*\[/.test(t.body) && /"url"\s*:/.test(t.body)
  );
  rec.urlsEchoed = LEEMO_RESULTS.filter((r) => rec.toolResults.some((t) => t.body.includes(r.url))).length;
  return rec;
}

const arms = [
  ["D. 嵌套请求由本地端点答掉（模拟我们自建）", { answerNested: true }],
  ["E. 嵌套请求上游不实现（复现 GLM 空壳）", { answerNested: false }],
];

const records = [];
for (const [label, cfg] of arms) {
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  const rec = await runArm(label, cfg);
  records.push(rec);
  console.log(`  到达本地假上游的请求总数        ${rec.requests.length}`);
  console.log(`  其中"带服务端工具"的嵌套请求    ${rec.nestedRequests.length}`);
  for (const n of rec.nestedRequests) {
    console.log(`     url=${n.url} model=${n.model}`);
    console.log(`     serverTools=${n.serverToolTypes.join(" | ")}`);
    console.log(`     tools 总数=${n.toolCount} 客户端工具=${n.clientToolNames.length ? n.clientToolNames.join(",") : "(无)"}`);
    console.log(`     messages=${JSON.stringify(n.messages).slice(0, 300)}`);
    console.log(`     system=${JSON.stringify(n.systemPreview ?? null).slice(0, 200)}`);
  }
  console.log(`  tool_result 条数               ${rec.toolResults.length}`);
  for (const t of rec.toolResults.slice(0, 2)) {
    console.log(`     [${t.isError ? "ERROR" : "ok"}] ${t.body.replace(/\s+/g, " ").slice(0, 320)}`);
  }
  console.log(`  Links: + url 出现（解析器认了） ${rec.linksInToolResult}`);
  console.log(`  我们的 URL 被回传条数           ${rec.urlsEchoed}/${LEEMO_RESULTS.length}`);
  if (rec.fatal) console.log(`  fatal                         ${rec.fatal}`);
  console.log(`  回答节选                       ${rec.answer.replace(/\s+/g, " ").slice(0, 200)}`);
}

const dir = path.join(ROOT, "smoke", "results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `websearch-nested-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, JSON.stringify(records, null, 2));

console.log(`\n${"=".repeat(72)}\n结论\n${"=".repeat(72)}`);
for (const r of records) {
  console.log(
    `  ${r.label.padEnd(40)} 嵌套请求=${r.nestedRequests.length} Links=${r.linksInToolResult} URL回传=${r.urlsEchoed}`
  );
}
console.log(`\n结果 JSON: ${file}`);
