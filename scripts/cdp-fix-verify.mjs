// scripts/cdp-fix-verify.mjs — 三 bug 修复实机验收（主控亲跑）
//
// 用法: LEEMO_DEBUG_PORT=9222 npm run electron:dev（另开终端）
//       node scripts/cdp-fix-verify.mjs
//
// ① 审批条位置：卡片出现在「干活过程」折叠区内、紧贴触发它的工具卡，
//    而不是 push 到整个回合末尾（旧行为=置底且丑，用户常错过直到权限流超时）。
// ② 文件真能写：点允许后工具真执行，不再显示「被拒绝」。
// ③ 打断能停：任务途中点停止，挂在审批上的回合能真的结束。
//
// 退出码 0=PASS / 3=FAIL。

import WebSocket from "ws";
import fs from "node:fs";

const CDP = `http://127.0.0.1:${process.env.LEEMO_DEBUG_PORT ?? 9222}`;

async function connect() {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:5173"));
  if (!page) throw new Error("找不到 renderer target（electron:dev 起了吗？）");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
  });
  await new Promise((r) => ws.on("open", r));
  const send = (method, params = {}) => {
    const myId = ++id;
    return new Promise((res) => { pending.set(myId, { resolve: res }); ws.send(JSON.stringify({ id: myId, method, params })); });
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description };
    return r.result.value;
  };
  const shot = async (f) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r?.data) fs.writeFileSync(f, Buffer.from(r.data, "base64"));
  };
  return { ev, shot };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (ev, text) =>
  ev(`(()=>{const ta=document.querySelector('textarea[aria-label="输入消息"]');` +
     `const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;` +
     `s.call(ta,${JSON.stringify(text)});ta.dispatchEvent(new Event('input',{bubbles:true}));` +
     `document.querySelector('button[aria-label="发送"]').click();return 1;})()`);

const { ev, shot } = await connect();
const results = {};

// --- ① + ② 审批条位置 & 文件真能写 -----------------------------------------
const STAMP = `fix-verify-${Date.now()}`;
await say(ev, `请把这一行写进 ${process.env.USERPROFILE ?? "C:\\\\Users\\\\Rengar"}\\\\Leemo\\\\memory\\\\bookmarks.md：${STAMP}`);

let anchored = null;
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  // 审批卡一出现就量它的位置，然后才批准。
  if (anchored === null) {
    const probe = await ev(`(()=>{
      const cards=[...document.querySelectorAll('p')].filter(el=>/^momo 想/.test(el.textContent||''));
      if(!cards.length) return null;
      const fold=document.querySelector('[data-testid="process-fold"]');
      return { insideFold: !!(fold&&fold.contains(cards[0])), count: cards.length };
    })()`);
    if (probe) { anchored = probe; await shot("docs/sdd/evidence-fix-approval-inline.png"); }
  }
  await ev(`(()=>{[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='允许一次').forEach(b=>b.click());})()`);
  const s = await ev(`window.leemoPersist.invoke('loadAll',undefined)`);
  if (s?.response?.conversations?.[0]?.timeline?.some((t) => t.kind === "result")) break;
}

results.approvalInsideFold = anchored?.insideFold ?? false;
results.approvalCardCount = anchored?.count ?? 0;
results.noDuplicateCard = anchored?.count === 1;

const snap = await ev(`window.leemoPersist.invoke('loadAll',undefined)`);
const conv = snap?.response?.conversations?.[0];
const tools = (conv?.timeline ?? []).filter((t) => t.kind === "tool");
results.toolStatuses = tools.map((t) => `${t.name}:${t.status}`);
results.noPermissionAbort = !tools.some((t) => /permission stream closed|AbortError/i.test(t.summary ?? ""));

const bookmarks = `${process.env.USERPROFILE}\\Leemo\\memory\\bookmarks.md`;
results.fileWritten = fs.existsSync(bookmarks) && fs.readFileSync(bookmarks, "utf8").includes(STAMP);

// --- ③ 打断 ---------------------------------------------------------------
await sleep(1500);
await say(ev, "请把 1 到 200 每个数字都写一行详细解释，全部写完不要停。");
await sleep(4000);
const t0 = Date.now();
await ev(`(()=>{const b=document.querySelector('button[aria-label="停止"]');if(b){b.click();return 1;}` +
         `const alt=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='停止');if(alt){alt.click();return 2;}return 0;})()`);
let stopped = false;
for (let i = 0; i < 25; i++) {
  await sleep(1000);
  const runId = await ev(`(()=>{return null;})()`); // placeholder to keep the eval cadence
  const s = await ev(`window.leemoPersist.invoke('loadAll',undefined)`);
  const c = s?.response?.conversations?.[0];
  const rs = (c?.timeline ?? []).filter((t) => t.kind === "result");
  if (rs.length >= 2) { stopped = true; break; }
  void runId;
}
results.interruptStopped = stopped;
results.interruptSeconds = Math.round((Date.now() - t0) / 1000);
await shot("docs/sdd/evidence-fix-interrupt.png");

console.log("\n=== 结果 ===");
console.log("① 审批条在干活过程折叠区内（非置底）:", results.approvalInsideFold);
console.log("① 同一审批只渲染一张卡（不重叠）:", results.noDuplicateCard, `(count=${results.approvalCardCount})`);
console.log("② 工具状态:", results.toolStatuses.join(", ") || "(无工具调用)");
console.log("② 无权限流超时/AbortError:", results.noPermissionAbort);
console.log("② 文件真写入（含本轮标记）:", results.fileWritten);
console.log(`③ 打断生效: ${results.interruptStopped}（${results.interruptSeconds}s 内结束）`);

const pass = results.approvalInsideFold && results.noDuplicateCard && results.noPermissionAbort && results.fileWritten && results.interruptStopped;
console.log(`\n${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 3);
