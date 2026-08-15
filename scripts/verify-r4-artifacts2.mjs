// 验收③ 收尾：放行审批条 → 等文件落盘 → 看成果页出条目。
//
// 上一版卡住的原因值得记：审批按钮的真实文案是「允许一次」，我的驱动找的是
// 「允许这次」。也就是说 host/审批链一切正常，是**驱动**猜错了标签 —— 又一次
// 「判据要来自真界面，不能来自我以为的界面」。
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
  if (r.exceptionDetails) throw new Error(`THREW: ${r.exceptionDetails.exception?.description}`);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, note = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `\n      ${note}` : ""}`); };

await send("Runtime.enable");

const TARGET = path.join(os.homedir(), "Leemo", "预览验收", "成果验收.md");

// 放行所有排队的审批条（真实文案：允许一次 / 记住此决定 / 拒绝）。
let approvals = 0;
for (let i = 0; i < 40; i++) {
  const r = await ev(`
    (() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => /^允许一次$/.test((x.textContent || '').trim()));
      if (b) { b.click(); return 'approved'; }
      return 'none';
    })()
  `);
  if (r === "approved") { approvals++; console.log(`      放行第 ${approvals} 条审批`); await sleep(1500); continue; }
  if (fs.existsSync(TARGET)) break;
  await sleep(1000);
}
check("审批条能被放行（真实文案「允许一次」）", approvals > 0, `放行 ${approvals} 条`);

// 等文件落盘。
let landed = false;
for (let i = 0; i < 90; i++) {
  if (fs.existsSync(TARGET)) { landed = true; console.log(`      t+${i}s 文件落盘`); break; }
  const r = await ev(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => /^允许一次$/.test((x.textContent || '').trim()));
      if (b) { b.click(); return 'approved-more'; }
      return 'wait';
    })()
  `);
  if (r === "approved-more") console.log(`      又放行一条`);
  await sleep(1000);
}
check("真对话产出了文件（磁盘为准 —— 一物三址的「磁盘」那一址）", landed,
  landed ? `${TARGET}\n      内容=${JSON.stringify(fs.readFileSync(TARGET, "utf8").slice(0, 60))}` : "没落盘");

// 给渲染进程时间把 tool.finished 折进 timeline 并登记成果。
await sleep(3000);

// 切成果页。
await ev(`
  (() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '成果');
    if (b) b.click();
    return 1;
  })()
`);
await sleep(1500);

const arts = await ev(`
  (() => {
    const cards = [...document.querySelectorAll('[data-testid="artifact-card"]')];
    return JSON.stringify({
      count: cards.length,
      texts: cards.slice(0, 6).map(c => (c.innerText || '').replace(/\\n+/g, ' | ').slice(0, 160)),
      groups: [...document.querySelectorAll('.book-group h2')].map(h => h.textContent),
    }, null, 1);
  })()
`);
const a = JSON.parse(arts);
check("成果页出现真成果条目（此前永远是空页）", a.count > 0, arts);
check("条目指向刚写的那个文件，并归到了本子里", a.texts.some((t) => t.includes("成果验收.md")),
  `groups=${JSON.stringify(a.groups)}`);

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
if (fails.length) console.log(`FAILED: ${fails.map((f) => f.n).join(" / ")}`);
ws.close();
process.exitCode = fails.length ? 1 : 0;
