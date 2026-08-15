// 轮 5 打包：在**不打包**的前提下先验 file:// 加载能不能挂上界面。
//
// 为什么值得单独有这个探针：打包一次要 8 分钟（241MB 原生 CLI + 7z -mx9），而
// `base:"./"` 这类产物路径问题只需要"用 file:// 打开 dist/index.html"就能判。
// main.ts 在 LEEMO_RENDERER_URL 缺省时走的正是 loadFile(dist/index.html)，
// 与打包态同一条路 —— 所以这里能提前抓到空白屏。
import { spawn } from "node:child_process";
import electronPath from "electron";
import path from "node:path";
import WebSocket from "ws";

const PORT = 9351;
const root = path.dirname(new URL(import.meta.url).pathname.slice(1)) + "/..";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(
  electronPath,
  [
    `--remote-debugging-port=${PORT}`,
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    path.join(root, "dist-electron", "main.mjs"),
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LEEMO_RENDERER_URL: "" } },
);
let mainLog = "";
child.stdout.on("data", (b) => (mainLog += b.toString()));
child.stderr.on("data", (b) => (mainLog += b.toString()));

let page;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === "page");
    if (page) break;
  } catch { /* 还没起 */ }
  await sleep(500);
}
if (!page) {
  console.log("FAIL  CDP 没出现 page");
  console.log(mainLog.split("\n").slice(0, 15).join("\n"));
  process.exit(1);
}
console.log(`page url = ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
let seq = 0;
const pending = new Map();
const failed = [];
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === "Network.loadingFailed") failed.push(`${m.params.type} ${m.params.errorText}`);
  if (m.method === "Log.entryAdded" && m.params.entry?.level === "error") {
    failed.push(`${m.params.entry.source}: ${(m.params.entry.text || "").slice(0, 100)}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
await send("Runtime.enable");
await send("Log.enable").catch(() => {});
await send("Network.enable").catch(() => {});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.value;
};

let mounted = { n: -1, text: 0 };
for (let i = 0; i < 40; i++) {
  mounted = await ev(`(()=>{const r=document.getElementById('root');return {n:r?r.children.length:-1,text:(document.body.innerText||'').trim().length};})()`);
  if ((mounted?.n ?? 0) > 0) break;
  await sleep(500);
}
const ta = await ev(`!!document.querySelector('textarea[aria-label="输入消息"]')`);
const ok = (mounted?.n ?? 0) > 0 && ta === true;
console.log(`${ok ? "PASS" : "FAIL"}  file:// 下界面挂上来  #root子节点=${mounted?.n} body文本=${mounted?.text} 输入框=${ta}`);
if (failed.length) console.log(`      加载失败: ${failed.slice(0, 5).join(" | ")}`);
else console.log("      无资源加载失败");

try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { child.kill(); }
await sleep(1500);
process.exit(ok ? 0 : 1);
