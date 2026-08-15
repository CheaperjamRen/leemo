// Live test of complaint #2: "联网搜索根本不起效".
// Turns the 联网功能 master switch ON via the real UI, then asks momo to search
// and records whether a search tool actually runs.
import fs from "node:fs";
import WebSocket from "ws";
const PORT = process.env.LEEMO_CDP_PORT || "9222";
const NONCE = "ST" + Date.now().toString(36).toUpperCase();
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
  setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error("timeout"))), 90000); });
await send("Runtime.enable");
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`docs/research/audit-shots/${n}.png`, Buffer.from(r.data, "base64")); };

// 0. close all overlays first (they stack — a real bug we already found)
await ev(`(() => { document.querySelectorAll('button').forEach(b=>{ if(b.offsetParent && /关闭/.test(b.title+b.getAttribute('aria-label'))) b.click(); }); })()`);
await sleep(500);

// 1. open settings, find the 联网功能 checkbox, report + flip it ON
const before = await ev(`(() => {
  const labels=[...document.querySelectorAll('label,div')].filter(e=>e.offsetParent);
  const row=labels.find(e=>/^联网功能/.test((e.textContent||'').trim()));
  const cb=row?row.querySelector('input[type=checkbox]'):null;
  return JSON.stringify({foundRow:!!row, checked: cb?cb.checked:null});
})()`);
console.log("before(settings closed): " + before);

await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>/设置/.test((x.textContent||'').trim())); if(b) b.click(); })()`);
await sleep(900);
const state = await ev(`(() => {
  const boxes=[...document.querySelectorAll('input[type=checkbox]')].filter(e=>e.offsetParent);
  const info=boxes.map(cb=>{ const row=cb.closest('label')||cb.parentElement?.parentElement;
    return {label:(row?.textContent||'').trim().slice(0,26), checked:cb.checked, disabled:cb.disabled}; });
  return JSON.stringify(info);
})()`);
console.log("checkboxes: " + state);

const flipped = await ev(`(() => {
  const boxes=[...document.querySelectorAll('input[type=checkbox]')].filter(e=>e.offsetParent);
  const target=boxes.find(cb=>{ const row=cb.closest('label')||cb.parentElement?.parentElement;
    return /联网功能/.test(row?.textContent||''); });
  if(!target) return 'NO_MASTER_SWITCH';
  if(!target.checked) target.click();
  return 'now=' + target.checked;
})()`);
console.log("master switch: " + flipped);
await sleep(700);
await shot("40-web-on");
const after = await ev(`(() => {
  const boxes=[...document.querySelectorAll('input[type=checkbox]')].filter(e=>e.offsetParent);
  return JSON.stringify(boxes.map(cb=>{ const row=cb.closest('label')||cb.parentElement?.parentElement;
    return {l:(row?.textContent||'').trim().slice(0,22), c:cb.checked, d:cb.disabled}; }));
})()`);
console.log("after: " + after);
fs.writeFileSync("docs/research/audit-shots/search-switch.json", JSON.stringify({ before, state, flipped, after }, null, 1));
ws.close();
