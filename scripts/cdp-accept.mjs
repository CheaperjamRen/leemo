import WebSocket from "ws";
import fs from "node:fs";

const CDP = "http://127.0.0.1:9222";
const OUT = process.argv[2] || "docs/sdd/evidence-electron-ipc.png";
async function target() {
  const r = await (await fetch(`${CDP}/json`)).json();
  return r.find((t) => t.type === "page" && t.url.includes("localhost:5173")).webSocketDebuggerUrl;
}
const ws = new WebSocket(await target());
let id = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.on("open", r));
function send(method, params = {}) {
  const myId = ++id;
  return new Promise((res) => { pending.set(myId, { resolve: res }); ws.send(JSON.stringify({ id: myId, method, params })); });
}
await send("Runtime.enable");
await send("Page.enable");
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}

const PROMPT = "请用一句话介绍你自己，并在结尾说出你的名字。";
// Type via React-compatible input event, then CLICK the send button.
const act = await ev(`(() => {
  const ta = document.querySelector('textarea[aria-label="输入消息"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(PROMPT)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const btn = document.querySelector('button[aria-label="发送"]');
  if (!btn) return { ok:false, reason:"no send button (busy?)" };
  btn.click();
  return { ok:true };
})()`);
console.log("ACT", JSON.stringify(act));

const deadline = Date.now() + 60000;
let rendered = "";
while (Date.now() < deadline) {
  const snap = await ev(`(() => {
    const main = document.querySelector('main') || document.body;
    const txt = main.innerText || "";
    return { len: txt.length, txt };
  })()`);
  // Look for momo's reply signature landing in the DOM.
  if (snap.txt && (snap.txt.includes("momo") || snap.txt.includes("默默") || snap.txt.includes("搭子，"))) {
    // Give a moment for the stream to finish, then capture.
    await new Promise((r) => setTimeout(r, 4000));
    rendered = (await ev(`(document.querySelector('main')||document.body).innerText`));
    break;
  }
  await new Promise((r) => setTimeout(r, 700));
}
console.log("RENDERED_IN_DOM", JSON.stringify((rendered || "").slice(0, 600)));

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
console.log("SCREENSHOT_SAVED", OUT);
ws.close();
