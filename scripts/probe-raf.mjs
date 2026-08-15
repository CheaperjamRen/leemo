// pdfjs 的 display 渲染是用 requestAnimationFrame 驱动分块绘制的。窗口被遮挡/隐藏
// 时 Chromium 会停掉 rAF ⇒ page.render 永远不 resolve、也不报错。这一格就是判它。
import WebSocket from "ws";
const PORT = process.env.LEEMO_DEBUG_PORT || "9222";
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:5173"));
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let seq = 0; const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) return `THREW: ${r.exceptionDetails.exception?.description}`;
  return r.result.value;
};
await send("Runtime.enable");
console.log(await ev(`
  (async () => {
    const t0 = performance.now();
    const frames = await new Promise((resolve) => {
      let n = 0;
      const tick = () => { n++; if (n < 5) requestAnimationFrame(tick); else resolve(n); };
      requestAnimationFrame(tick);
      setTimeout(() => resolve(n), 3000);
    });
    return JSON.stringify({
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
      rafFrames: frames,
      elapsedMs: Math.round(performance.now() - t0),
      verdict: frames >= 5 ? 'rAF 正常 ⇒ 卡住另有原因' : 'rAF 不触发 ⇒ page.render 必然永远不返回（窗口被遮挡/隐藏）',
    });
  })()
`));
ws.close();
