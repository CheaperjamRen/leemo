// scripts/cdp-restart-verify.mjs — 启动轮 2 卡 C 实机验收（重启后续聊）
//
// 病灶：对话 id 由 host 铸造、Map 纯内存，重启后 renderer hydrate 出的老 cid
// host 一个都不认识 → 点历史对话发消息静默失败（bridge-host `unknown
// conversation: <cid>`）。修复不只是「发得出去」：momo 必须真的记得重启前那段。
//
// 本脚本自己拉起 / 杀掉 / 再拉起 Electron，全程 CDP 驱动真实 UI：
//   ① 起 app → 新对话 → 告诉 momo 一个仓库里绝对搜不到的事实（随机口令）
//   ② 整个 Electron 进程被 taskkill /T /F 干掉（host 内存 Map 随之消失）
//   ③ 重新拉起 → 在工作台侧栏「点」那条历史对话 → 发消息
//   ④ 消息发得出去（无 unknown conversation）
//   ⑤ momo 复述出重启前那个口令  ← 本卡验收核心，只测 ④ 不算过
//
// 用法（默认用独立 user-data-dir + 5174/9333 端口，绝不打扰已在跑的实例）：
//   node scripts/cdp-restart-verify.mjs
//
// 退出码 0=PASS / 3=FAIL。证据截图落在 docs/sdd/。

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import electronPath from "electron";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITE_PORT = Number(process.env.LEEMO_VERIFY_VITE_PORT ?? 5174);
const CDP_PORT = Number(process.env.LEEMO_VERIFY_CDP_PORT ?? 9333);
const RENDERER_URL = `http://localhost:${VITE_PORT}`;
// A dedicated userData keeps this run's SQLite away from whatever instance the
// user already has open. The SDK session store (.leemo-workspace) is shared on
// purpose — resume must be proven against the real one.
const USER_DATA_DIR =
  process.env.LEEMO_VERIFY_USER_DATA ?? path.join(os.tmpdir(), "leemo-restart-verify");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// process plumbing
// ---------------------------------------------------------------------------

const children = [];

function startVite() {
  const p = spawn("npm", ["run", "dev", "--", "--port", String(VITE_PORT), "--strictPort"], {
    cwd: ROOT,
    shell: process.platform === "win32",
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(p);
  return p;
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function startElectron(label) {
  console.log(`\n[verify] ── 启动 Electron (${label}) ──`);
  const p = spawn(
    electronPath,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${USER_DATA_DIR}`,
      path.join(ROOT, "dist-electron", "main.mjs"),
    ],
    {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, LEEMO_RENDERER_URL: RENDERER_URL },
    },
  );
  children.push(p);
  return p;
}

/** Kill the whole Electron tree. On Windows child renderer/GPU processes
 *  survive a plain SIGTERM, and a surviving main process would keep the host's
 *  in-memory Map alive — which is exactly what this test must destroy.
 *
 *  Graceful FIRST, force only as a backstop: a /F kill never lets Chromium
 *  flush `Local State`, which holds the OSCrypt key safeStorage encrypted the
 *  secrets store with — the next launch then cannot decrypt its own file. The
 *  graceful path is also the normal user gesture (close the window, reopen the
 *  app) and destroys the host registry just as completely. */
function forceKill(proc) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }
}

async function killTree(proc, { graceful = true } = {}) {
  if (!proc || proc.exitCode !== null) return;
  const exited = new Promise((r) => proc.once("exit", r));
  if (graceful && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T"], { stdio: "ignore" });
  } else if (graceful) {
    proc.kill("SIGTERM");
  } else {
    forceKill(proc);
  }
  const settled = await Promise.race([exited.then(() => true), sleep(10_000).then(() => false)]);
  if (!settled) {
    console.log("[verify] 优雅退出超时，改用 /F 强杀");
    forceKill(proc);
    await Promise.race([exited, sleep(5_000)]);
  }
}

function cleanup() {
  for (const c of children) if (c.exitCode === null) forceKill(c);
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

async function connect() {
  const deadline = Date.now() + 60_000;
  let page;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
      page = targets.find((t) => t.type === "page" && t.url.includes(`localhost:${VITE_PORT}`));
      if (page) break;
    } catch {
      /* devtools endpoint not up yet */
    }
    await sleep(400);
  }
  if (!page) throw new Error("找不到 renderer target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m.result);
      pending.delete(m.id);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });
  await new Promise((r) => ws.on("open", r));
  const send = (method, params = {}) => {
    const myId = ++id;
    return new Promise((res) => {
      pending.set(myId, { resolve: res });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  };
  await send("Runtime.enable");
  await send("Page.enable");

  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result.value;
  };
  const shot = async (file) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r?.data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      console.log(`[verify] 截图 → ${file}`);
    }
  };
  return { ev, shot, consoleErrors, close: () => ws.close() };
}

/** Type into the real textarea and click the real 发送 button (React-safe
 *  value setter so onChange actually fires). */
const say = (ev, text) =>
  ev(
    `(()=>{const ta=document.querySelector('textarea[aria-label="输入消息"]');` +
      `if(!ta) return {ok:false,why:'no textarea'};` +
      `const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;` +
      `s.call(ta,${JSON.stringify(text)});ta.dispatchEvent(new Event('input',{bubbles:true}));` +
      `const b=document.querySelector('button[aria-label="发送"]');` +
      `if(!b) return {ok:false,why:'no send button'};b.click();return {ok:true};})()`,
  );

const loadAll = (ev) => ev(`window.leemoPersist.invoke('loadAll',undefined)`);

/** Approve anything that pops an approval bar — an unattended run must not
 *  deadlock on a permission prompt. */
const autoApprove = (ev) =>
  ev(
    `(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>['允许一次','允许'].includes(b.textContent.trim()));` +
      `bs.forEach(b=>b.click());return bs.length;})()`,
  );

/** Wait until the conversation has `want` result items (one per finished run). */
async function waitForRuns(ev, want, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await autoApprove(ev);
    const snap = await loadAll(ev);
    const conv = snap?.response?.conversations?.[0];
    const results = (conv?.timeline ?? []).filter((t) => t.kind === "result");
    if (results.length >= want) return { conv, results };
    await sleep(1500);
  }
  const snap = await loadAll(ev);
  return { conv: snap?.response?.conversations?.[0], results: [], timedOut: true };
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

// A fact that CANNOT be looked up: random token, nowhere in the repo, no tool
// or web search can recover it. Only a genuinely resumed session knows it.
const TOKEN = `QX${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const SECRET_FACT = `记住一件事：我家仓鼠的名字叫「${TOKEN}」，它只吃蓝色的南瓜子。请只回一句“记住了”，不要用任何工具。`;
const RECALL_QUESTION = `我刚才告诉你我家仓鼠叫什么名字？直接说那个名字，别用任何工具。`;

const results = {};

async function main() {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  console.log(`[verify] userData = ${USER_DATA_DIR}`);
  console.log(`[verify] 口令 TOKEN = ${TOKEN}`);

  // 0. build main/preload + start vite (dev asset server; not part of the app
  //    process under test).
  console.log("[verify] 构建 main/preload …");
  await import("./build-main.mjs");
  startVite();
  await waitForUrl(RENDERER_URL);

  // ── ① 重启前：新对话 + 说一句只有这轮会话知道的事实 ──────────────────────
  let app = startElectron("phase 1");
  let cdp = await connect();
  await sleep(2500);

  // 工作台态：侧栏才有真实历史对话列表（搭子态的抽屉目前仍是 fixture）。
  await cdp.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='工作台');if(b)b.click();return !!b;})()`);
  await sleep(600);
  const created = await cdp.ev(
    `(()=>{const b=document.querySelector('button[aria-label="新建对话"]');if(!b) return false;b.click();return true;})()`,
  );
  await sleep(1200);
  console.log("[verify] 新建对话按钮点击:", created);

  const said = await say(cdp.ev, SECRET_FACT);
  console.log("[verify] 发出事实:", JSON.stringify(said));
  const phase1 = await waitForRuns(cdp.ev, 1);
  results.phase1Answered = !phase1.timedOut;
  results.phase1Text = phase1.results?.[0]?.finalText ?? "";
  await cdp.shot("docs/sdd/evidence-cardC-1-before-restart.png");

  const beforeSnap = await loadAll(cdp.ev);
  const beforeConv = beforeSnap?.response?.conversations?.[0];
  results.conversationId = beforeConv?.meta?.id;
  results.sessionIdPersisted = beforeConv?.meta?.sessionId ?? null;
  console.log("[verify] 持久化 cid =", results.conversationId);
  console.log("[verify] 持久化 sessionId =", results.sessionIdPersisted);

  // ── ② 整个 Electron 进程重启 ────────────────────────────────────────────
  cdp.close();
  await killTree(app);
  await sleep(2500);
  console.log("[verify] ── Electron 已被 taskkill /T /F，host 内存注册表随之消失 ──");

  app = startElectron("phase 2");
  cdp = await connect();
  await sleep(3000);

  // ── ③ 点那条历史对话 → 发消息 ───────────────────────────────────────────
  await cdp.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='工作台');if(b)b.click();return !!b;})()`);
  await sleep(800);
  // hydrate 之后侧栏应当列出那条对话；点它（真实用户路径 switchActive）。
  const picked = await cdp.ev(
    `(()=>{const store=[...document.querySelectorAll('aside button')].filter(b=>b.querySelector('span'));` +
      `if(!store.length) return {ok:false,why:'空侧栏'};store[0].click();` +
      `return {ok:true,title:store[0].textContent.trim()};})()`,
  );
  results.pickedHistory = picked;
  console.log("[verify] 点击历史对话:", JSON.stringify(picked));
  await sleep(800);
  await cdp.shot("docs/sdd/evidence-cardC-2-after-restart-list.png");

  const said2 = await say(cdp.ev, RECALL_QUESTION);
  console.log("[verify] 重启后发问:", JSON.stringify(said2));
  const phase2 = await waitForRuns(cdp.ev, 2);
  results.phase2Answered = !phase2.timedOut;

  const finalSnap = await loadAll(cdp.ev);
  const finalConv = finalSnap?.response?.conversations?.[0];
  const timeline = finalConv?.timeline ?? [];
  const lastResult = [...timeline].reverse().find((t) => t.kind === "result");
  results.recallText = lastResult?.finalText ?? "";
  results.timelineErrors = timeline
    .filter((t) => t.kind === "result" && t.isError)
    .map((t) => t.finalText);

  // ④ 发得出去：cid 没变、没有 unknown conversation
  results.cidUnchanged = finalConv?.meta?.id === results.conversationId;
  const unknownConv = [
    ...cdp.consoleErrors,
    ...timeline.map((t) => JSON.stringify(t)),
  ].join("\n");
  results.noUnknownConversation = !/unknown conversation/i.test(unknownConv);
  results.messageWentOut = timeline.filter((t) => t.kind === "result").length >= 2;

  // ⑤ momo 真记得（本卡核心）
  results.momoRemembers = results.recallText.includes(TOKEN);
  results.sessionIdAfter = finalConv?.meta?.sessionId ?? null;

  await cdp.shot("docs/sdd/evidence-cardC-3-momo-remembers.png");
  cdp.close();
  await killTree(app);
}

try {
  await main();
} catch (e) {
  console.error("[verify] 崩了:", e);
  results.crashed = String(e);
} finally {
  cleanup();
}

console.log("\n=== 卡 C 实机验收结果 ===");
console.log("口令 TOKEN                  :", TOKEN);
console.log("① 重启前 momo 应答          :", results.phase1Answered, `｜「${(results.phase1Text || "").slice(0, 40)}」`);
console.log("   持久化 conversationId    :", results.conversationId);
console.log("   持久化 sessionId         :", results.sessionIdPersisted);
console.log("③ 重启后点到历史对话        :", JSON.stringify(results.pickedHistory));
console.log("④ 消息发得出去              :", results.messageWentOut);
console.log("   cid 未变（未新开对话）    :", results.cidUnchanged);
console.log("   无 unknown conversation  :", results.noUnknownConversation);
console.log("   时间线错误               :", results.timelineErrors?.length ? results.timelineErrors : "无");
console.log("⑤ momo 复述口令（核心）     :", results.momoRemembers);
console.log("   momo 原话                :", `「${(results.recallText || "").slice(0, 120)}」`);
console.log("   重启后 sessionId         :", results.sessionIdAfter);

const pass =
  results.phase1Answered &&
  Boolean(results.sessionIdPersisted) &&
  results.messageWentOut &&
  results.cidUnchanged &&
  results.noUnknownConversation &&
  results.momoRemembers;
console.log(`\n${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 3);
