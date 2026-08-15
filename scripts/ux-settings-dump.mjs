// Dump the settings overlay: every section, every control, whether it is wired.
import fs from "node:fs";
import WebSocket from "ws";
const PORT = process.env.LEEMO_CDP_PORT || "9222";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error("timeout"))), 60000);
  });
await send("Runtime.enable");
await send("Page.enable");
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// make sure we are in workbench, then open settings
await ev(`(() => {
  const w=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='工作台');
  if(w) w.click(); return !!w;
})()`);
await sleep(700);
await ev(`(() => {
  const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent).find(x=>/设置/.test((x.textContent||'').trim()));
  if(b) b.click(); return b ? (b.textContent||'').trim() : 'MISS';
})()`);
await sleep(900);

// find the overlay: the scroll container above the '设置' heading
const panelInfo = await ev(`(() => {
  const h=[...document.querySelectorAll('h1,h2,h3')].find(e=>/^设置$/.test((e.textContent||'').trim()));
  if(!h) return 'NO_HEADING';
  let p=h;
  // climb until we find the scroll container
  while(p && p!==document.body){
    const cs=getComputedStyle(p);
    if(p.scrollHeight>p.clientHeight+20 && cs.overflowY!=='visible') break;
    p=p.parentElement;
  }
  window.__panel = p;
  const r=p.getBoundingClientRect();
  return JSON.stringify({cls:(p.className||'').toString(), w:Math.round(r.width), x:Math.round(r.x), sh:p.scrollHeight, ch:p.clientHeight});
})()`);
console.log("PANEL " + panelInfo);

const dump = await ev(`(() => {
  const p = window.__panel; if(!p) return 'NO_PANEL';
  const vis = e => e.offsetParent !== null;
  const sections = [...p.querySelectorAll('h2,h3,h4')].map(h=>({lvl:h.tagName,t:(h.textContent||'').trim()}));
  const ctrls = [...p.querySelectorAll('button,input,textarea,select,[role=switch],[role=checkbox]')].filter(vis).map(e=>{
    const r=e.getBoundingClientRect();
    return {tag:e.tagName, type:e.type||'', text:(e.textContent||'').trim().slice(0,36), ph:e.placeholder||'',
      checked: e.type==='checkbox'? e.checked : undefined, disabled: !!e.disabled,
      y:Math.round(r.y + p.scrollTop)};
  });
  return JSON.stringify({sections, ctrls, fullText: p.innerText}, null, 1);
})()`);
fs.writeFileSync("docs/research/audit-shots/settings-dump.json", dump);
const parsed = JSON.parse(dump);
console.log("SECTIONS: " + JSON.stringify(parsed.sections));
console.log("CONTROL COUNT: " + parsed.ctrls.length);
console.log("\n=== FULL TEXT ===\n" + parsed.fullText);

// screenshot each scroll page of the panel
for (let i = 0; i < 8; i++) {
  const moved = await ev(`(() => {
    const p=window.__panel; if(!p) return false;
    const before=p.scrollTop; p.scrollTop = before + p.clientHeight*0.88;
    return p.scrollTop > before + 5;
  })()`);
  await sleep(450);
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`docs/research/audit-shots/set-page${i}.png`, Buffer.from(r.data, "base64"));
  if (!moved) break;
}
console.log("done");
ws.close();
