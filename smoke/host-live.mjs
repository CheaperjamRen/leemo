// smoke/host-live.mjs — Host 竖切 Live 验收（卡 A6）
//
// 用法: node smoke/host-live.mjs  （主控亲跑，不自动执行）
// DeepSeek 国内直连，不设代理。
// 跑前确保 .env 含 DEEPSEEK_API_KEY。
//
// 场景：spawn src/host/dev.ts → 等端口行 → ws 连接 →
//   listProviders / createConversation / send（诱发 Read+Write 工具轮）→
//   收 approvalRequest 自动 allow-once → 收流至 run.finished →
//   断言 text.delta>0 / approvalRequests≥1 / answer.txt 含暗号 / usage.final 存在
// 结果 JSON 落 smoke/results/。退出码 0=PASS / 2=FAIL / 1=fatal。

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { loadEnv, redact } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const DEV_ENTRY = path.join("src", "host", "dev.ts");
const CODEWORD = "MOMO-9271";

function redactHard(s) {
  let out = redact(String(s));
  out = out.replace(/\b(sk|Bearer)[-_ ][A-Za-z0-9_\-]{8,}/g, "[REDACTED]");
  return out;
}

function saveResult(data) {
  const dir = path.join(ROOT, "smoke", "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `host-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, redactHard(JSON.stringify(data, null, 2)));
  return file;
}

function startHostSubprocess() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, DEV_ENTRY], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", port = null, settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error(`host dev 90s 内未打印端口；stderr=${redactHard(stderr).slice(-400)}`));
    }, 90_000);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      const m = stdout.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (m && !settled) {
        port = Number(m[1]);
        settled = true;
        clearTimeout(timer);
        resolve({ child, port });
      }
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`host dev 提前退出 code=${code}；stderr=${redactHard(stderr).slice(-800)}`));
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

function stopHost(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {}
}

async function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function main() {
  loadEnv();

  const results = {
    mode: "host-live",
    startedAt: new Date().toISOString(),
    criteria: {},
  };

  console.log("[host-live] spawning src/host/dev.ts…");
  const { child, port } = await startHostSubprocess();
  console.log(`[host-live] host up on ws://127.0.0.1:${port}`);

  try {
    const ws = await wsConnect(port);
    let nextId = 1;
    const pending = new Map();
    const pushes = [];

    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p(msg); }
      } else if (msg.channel) {
        pushes.push(msg);
      }
    });

    function invoke(channel, req) {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, channel, req }));
      });
    }

    // listProviders
    const listResp = await invoke("bridge:listProviders", null);
    results.criteria.c1_listProviders = {
      pass: listResp.ok && Array.isArray(listResp.response) && listResp.response.length > 0,
      providers: listResp.response?.map((p) => p.id),
    };

    // createConversation
    const createResp = await invoke("bridge:createConversation", {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
    const cid = createResp.response?.conversationId;
    results.criteria.c2_createConversation = { pass: Boolean(cid), conversationId: cid };

    // Pre-plant notes.md in sandbox
    const sandboxDir = path.join(ROOT, ".leemo-workspace", "sandbox");
    fs.mkdirSync(sandboxDir, { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, "notes.md"), `# 便签\n- 暗号：${CODEWORD}\n`);

    // send — fire and collect events
    const sendResp = await invoke("bridge:send", {
      conversationId: cid,
      prompt: `读取 notes.md，把其中的暗号原样写入 answer.txt（只写暗号本身）。`,
    });
    results.criteria.c3_sendAck = { pass: sendResp.ok };

    // Drain events for up to 120s, auto-approve all approvalRequests
    let finished = false;
    const events = [];
    const approvalRequests = [];
    const deadline = Date.now() + 120_000;

    while (!finished && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      // Process newly arrived pushes
      while (pushes.length > 0) {
        const push = pushes.shift();
        if (push.channel === "bridge:event") {
          const ev = push.payload?.event;
          if (ev) {
            events.push(ev);
            if (ev.type === "run.finished") finished = true;
          }
        } else if (push.channel === "bridge:approvalRequest") {
          approvalRequests.push(push.payload);
          // Auto allow-once
          await invoke("bridge:approvalDecision", { id: push.payload.id, decision: "allow-once" });
        }
      }
    }

    const textDeltas = events.filter((e) => e.type === "text.delta").length;
    const hasUsage = events.some((e) => e.type === "usage.final");
    let answerTxt = "";
    try { answerTxt = fs.readFileSync(path.join(sandboxDir, "answer.txt"), "utf8").trim(); } catch {}

    results.criteria.c4_textDeltas = { pass: textDeltas > 0, count: textDeltas };
    results.criteria.c5_approvalRequests = { pass: approvalRequests.length >= 1, count: approvalRequests.length };
    results.criteria.c6_answerFile = { pass: answerTxt.includes(CODEWORD), answerTxt: answerTxt.slice(0, 80) };
    results.criteria.c7_usageFinal = { pass: hasUsage };
    results.criteria.c8_runFinished = { pass: finished };

    ws.close();
  } finally {
    stopHost(child);
  }

  results.finishedAt = new Date().toISOString();
  const core = ["c1_listProviders", "c2_createConversation", "c3_sendAck", "c4_textDeltas", "c5_approvalRequests", "c6_answerFile", "c7_usageFinal", "c8_runFinished"];
  const passed = core.filter((k) => results.criteria[k]?.pass).length;
  results.summary = {
    corePassed: `${passed}/${core.length}`,
    verdict: passed === core.length ? "host-live PASS" : "FAIL",
  };

  const file = saveResult(results);
  console.log("\n[host-live] === core matrix ===");
  for (const k of core) console.log(`  ${results.criteria[k]?.pass ? "PASS" : "FAIL"}  ${k}`);
  console.log(`[host-live] ${passed}/${core.length} → ${file}`);
  return passed === core.length ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("[host-live] fatal: " + redactHard(e instanceof Error ? e.stack || e.message : String(e)));
    process.exit(1);
  });
