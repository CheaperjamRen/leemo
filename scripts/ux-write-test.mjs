// Live test of the user's #1 complaint: "写文件还写不了".
// Sends a real write request in a fresh conversation and records, second by
// second, what the UI actually shows — anchored to a one-shot nonce so no
// previous run's state can be mistaken for this one's.
import fs from "node:fs";
import WebSocket from "ws";

const PORT = process.env.LEEMO_CDP_PORT || "9222";
const NONCE = "WT" + Date.now().toString(36).toUpperCase();
const REL = `诊断/写文件测试-${NONCE}.md`;

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
    setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error("timeout " + method))), 90000);
  });
await send("Runtime.enable");
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`docs/research/audit-shots/${name}.png`, Buffer.from(r.data, "base64"));
};

console.log("NONCE=" + NONCE);

// 1. new conversation (buddy mode, like a real user's first move)
await ev(`(() => {
  const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>(x.textContent||'').trim()==='搭子');
  if(b) b.click();
})()`);
await sleep(600);
// close any overlay
await ev(`(() => { const x=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).filter(b=>/关闭|✕|×/.test(b.textContent+b.title+b.getAttribute('aria-label'))); x.forEach(b=>b.click()); })()`);
await sleep(400);

// 2. type the request
const prompt = `请在工作区里新建文件 ${REL}，内容只写一行：${NONCE}。写完告诉我。`;
await ev(`(() => {
  const ta=document.querySelector('textarea');
  ta.focus();
  const setter=Object.getOwnPropertyDescriptor(ta.constructor.prototype,'value').set;
  setter.call(ta, ${JSON.stringify(prompt)});
  ta.dispatchEvent(new Event('input',{bubbles:true}));
  return ta.value.length;
})()`);
await sleep(300);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
console.log("sent");

// 3. poll the UI every 2s for 90s, recording what a user would see
const PROBE = `(() => {
  const t = document.body.innerText;
  const approvalBtns = [...document.querySelectorAll('button')].filter(b=>b.offsetParent && /允许一次|总是允许|永久允许|拒绝|不允许/.test(b.textContent||''));
  const fold = [...document.querySelectorAll('[data-testid=process-fold]')];
  return JSON.stringify({
    caret: !!document.querySelector('.leemo-caret'),
    approvalCount: approvalBtns.length,
    approvalLabels: approvalBtns.map(b=>(b.textContent||'').trim()).slice(0,6),
    approvalVisible: approvalBtns.length ? (r=>r.top>0&&r.bottom<innerHeight)(approvalBtns[0].getBoundingClientRect()) : null,
    folds: fold.length,
    foldExpanded: fold.map(f=>(f.textContent||'').includes('收起')),
    hasNonce: t.includes(${JSON.stringify(NONCE)}),
    stopBtn: [...document.querySelectorAll('button')].some(b=>b.offsetParent && /停止/.test(b.textContent||'')),
    err: /没跑完|失败|错误|error|拒绝/i.test(t),
    tail: t.slice(-420)
  });
})()`;

const log = [];
for (let i = 0; i < 45; i++) {
  await sleep(2000);
  let s;
  try { s = JSON.parse(await ev(PROBE)); } catch (e) { s = { err: "probe " + e.message }; }
  log.push({ t: (i + 1) * 2, ...s });
  const line = `t=${(i + 1) * 2}s caret=${s.caret} approvals=${s.approvalCount}${s.approvalVisible === false ? "(OFFSCREEN)" : ""} folds=${s.folds}/${JSON.stringify(s.foldExpanded)} stop=${s.stopBtn}`;
  console.log(line);
  if (s.approvalCount > 0) { await shot(`30-write-approval-t${(i + 1) * 2}`); }
  if (!s.caret && !s.stopBtn && i > 3) { console.log("run appears finished"); break; }
}
await shot("31-write-final");
fs.writeFileSync("docs/research/audit-shots/write-test.json", JSON.stringify({ nonce: NONCE, rel: REL, log }, null, 1));
console.log("TAIL:\n" + (log[log.length - 1]?.tail || ""));
ws.close();
