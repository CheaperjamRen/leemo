// Does flipping 联网功能 ON affect the conversation the user is already in?
// The persona context (incl. webSearchEnabled) is only sent at
// bridge:createConversation, so this asks in the EXISTING conversation first.
import fs from "node:fs";
import WebSocket from "ws";
const PORT = process.env.LEEMO_CDP_PORT || "9222";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
let id = 0; const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error("timeout"))), 120000); });
await send("Runtime.enable");
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`docs/research/audit-shots/${n}.png`, Buffer.from(r.data, "base64")); };

const which = process.argv[2] || "existing";  // existing | new
// close overlays
await ev(`(() => { document.querySelectorAll('button').forEach(b=>{ if(b.offsetParent && /关闭/.test(b.title+(b.getAttribute('aria-label')||''))) b.click(); }); })()`);
await sleep(500);
await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>(x.textContent||'').trim()==='搭子'); if(b)b.click(); })()`);
await sleep(600);

if (which === "new") {
  const r = await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>/开始新对话|新对话/.test((x.textContent||'').trim()));
    if(b){b.click();return 'clicked';}
    const h=[...document.querySelectorAll('button')].find(x=>/历史/.test(x.title||''));
    if(h){h.click();return 'openedDrawer';} return 'MISS'; })()`);
  console.log("new-conv: " + r);
  await sleep(900);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>/开始新对话/.test((x.textContent||'').trim())); if(b)b.click(); })()`);
  await sleep(1200);
}

const Q = "现在联网搜一下 2026 年诺贝尔物理学奖得主是谁，必须用搜索工具，给出来源链接。";
await ev(`(() => { const ta=document.querySelector('textarea'); ta.focus();
  Object.getOwnPropertyDescriptor(ta.constructor.prototype,'value').set.call(ta, ${JSON.stringify(Q)});
  ta.dispatchEvent(new Event('input',{bubbles:true})); return ta.value.length; })()`);
await sleep(300);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
console.log("asked (" + which + ")");

const PROBE = `(() => { const t=document.body.innerText;
  return JSON.stringify({ caret: !!document.querySelector('.leemo-caret'),
    searchTool: /WebSearch|web_search|搜索网页|联网搜索中|Search/.test(t),
    approvals: [...document.querySelectorAll('button')].filter(b=>b.offsetParent&&/允许一次/.test(b.textContent||'')).length,
    tail: t.slice(-500) }); })()`;
const log = [];
for (let i = 0; i < 30; i++) {
  await sleep(2500);
  let s; try { s = JSON.parse(await ev(PROBE)); } catch (e) { s = { e: e.message }; }
  log.push({ t: (i + 1) * 2.5, ...s });
  console.log(`t=${(i + 1) * 2.5}s caret=${s.caret} searchTool=${s.searchTool} approvals=${s.approvals}`);
  if (s.approvals > 0) { await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/允许一次/.test(x.textContent||'')); if(b)b.click(); })()`); }
  if (!s.caret && i > 3) break;
}
await shot(`41-search-${which}`);
fs.writeFileSync(`docs/research/audit-shots/search-live-${which}.json`, JSON.stringify(log, null, 1));
console.log("TAIL:\n" + (log[log.length - 1]?.tail || ""));
ws.close();
