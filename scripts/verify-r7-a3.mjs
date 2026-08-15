// 轮 7 A3 live acceptance — the exact user path that failed before:
//   ① 联网默认关，在当前对话问搜索题 → momo 说不能搜
//   ② 打开设置页的「联网功能」（不新建对话！）
//   ③ 在同一个对话再问 → 必须真的搜到
//   ④ 界面明说「下轮起生效」
//   ⑤ 重启后设置还在（落盘）
// 判据锚到「这一次输入」：每问带一次性口令，只认本轮回复。
import fs from "node:fs";
import WebSocket from "ws";

const PORT = process.env.LEEMO_CDP_PORT || "9222";
const NONCE = "A3" + Date.now().toString(36).toUpperCase();
const results = [];
const pass = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((r, j) => (ws.once("open", r), ws.once("error", j)));
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => pending.has(i) && (pending.delete(i), reject(new Error("timeout " + method))), 150000);
    });
  await send("Runtime.enable");
  await send("Page.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, ev, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { send, ev, close } = await connect();
const shot = async (n) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`docs/research/audit-shots/${n}.png`, Buffer.from(r.data, "base64"));
};

/** Ask in the CURRENT conversation and return this turn's momo text only. */
async function ask(question, budgetMs = 150000) {
  const before = await ev(`document.querySelectorAll('[data-testid="process-fold"]').length`);
  await ev(`(() => {
    const ta=document.querySelector('textarea'); ta.focus();
    Object.getOwnPropertyDescriptor(ta.constructor.prototype,'value').set.call(ta, ${JSON.stringify(question)});
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await sleep(250);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const deadline = Date.now() + budgetMs;
  let streaming = false;
  while (Date.now() < deadline) {
    await sleep(2500);
    const s = await ev(`(() => JSON.stringify({
      caret: !!document.querySelector('.leemo-caret'),
      folds: document.querySelectorAll('[data-testid="process-fold"]').length,
      appr: [...document.querySelectorAll('button')].some(b=>b.offsetParent && /允许一次/.test(b.textContent||'')),
    }))()`);
    const st = JSON.parse(s);
    if (st.appr) {
      await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent&&/允许一次/.test(x.textContent||'')); if(b)b.click(); })()`);
      continue;
    }
    if (st.caret) streaming = true;
    if (streaming && !st.caret && st.folds > before) break;
    if (!st.caret && st.folds > before) break;
  }
  // The last momo bubble's text = this turn's answer.
  return await ev(`(() => {
    const t = document.body.innerText;
    return t.slice(t.lastIndexOf(${JSON.stringify(question)}) + ${question.length});
  })()`);
}

// ── setup: 工作台态，新开一个干净对话 ─────────────────────────────────────
//
// 用工作台而不是搭子态：**搭子态没有设置入口**（台账 C10，10 号 §1.7 要求补），
// 所以在搭子态里根本走不到"打开设置"这一步。C10 修好后这里可以改回搭子态。
await ev(`(() => { document.querySelectorAll('button').forEach(b=>{ if(b.offsetParent && /关闭/.test(b.title+(b.getAttribute('aria-label')||''))) b.click(); }); })()`);
await sleep(400);
// Switch to workbench and CONFIRM it landed. Retried because settings hydration
// (轮 7 A3) restores the persisted `mode` asynchronously after mount: an early
// click gets overwritten by hydrate. Clicking until the 设置 entry is actually
// present is the honest way to wait for "the UI has settled".
let inWorkbench = false;
for (let i = 0; i < 12 && !inWorkbench; i++) {
  await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>(x.textContent||'').trim()==='工作台'); if(b)b.click(); })()`);
  await sleep(700);
  inWorkbench = await ev(`[...document.querySelectorAll('button')].some(b=>b.offsetParent && /设置/.test((b.textContent||'').trim()))`);
}
if (!inWorkbench) {
  pass("setup 切到工作台（设置入口只在工作台，见 C10）", false, "设置入口始终没出现");
  fs.writeFileSync("docs/research/audit-shots/verify-r7-a3.json", JSON.stringify({ nonce: NONCE, results }, null, 1));
  close();
  process.exit(1);
}
// Workbench has a dedicated icon button (`aria-label="新建对话"`). The old
// probe looked for BuddyShell's drawer copy 「开始新对话」, found nothing, and
// silently reused the same SDK session across every run. That polluted the
// supposedly clean conversation with many earlier "search is disabled" turns
// and manufactured a false failure in the on-direction check.
const newConversation = await ev(`(() => {
  const b=[...document.querySelectorAll('button')].find(x =>
    x.offsetParent && (x.getAttribute('aria-label') === '新建对话' || x.title === '新对话')
  );
  if (!b) return 'NO_NEW_CONVERSATION_BUTTON';
  b.click();
  return 'clicked';
})()`);
if (newConversation !== "clicked") {
  pass("setup 新建干净对话", false, newConversation);
  fs.writeFileSync("docs/research/audit-shots/verify-r7-a3.json", JSON.stringify({ nonce: NONCE, results }, null, 1));
  close();
  process.exit(1);
}
await sleep(1200);

// ── ⓿ 先把前置条件做实：联网必须是关的 ─────────────────────────────────────
//
// 不能假设"默认就是关的"：A3 生效后设置会**落盘**，上一次跑完这个脚本就把
// webEnabled=true 存下来了，于是下一次启动它本来就是开的 —— ① 会因为 A3 真的
// 工作而失败。这正是持久化带来的新前置条件，脚本必须自己建立，而不是靠运气。
async function setWeb(on) {
  await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>/设置/.test((x.textContent||'').trim())); if(b)b.click(); })()`);
  await sleep(1100);
  // 三层开关（轮 4）：生效值 = 统筹「联网功能」AND 子项「联网搜索」。只翻统筹是
  // 不够的 —— 关掉时两层一起失效（所以只翻统筹就能关），打开时子项还停在它自己
  // 的值上（默认关），于是"打开了却搜不了"。这不是产品缺陷，是这个设计的语义；
  // 判据必须照着语义走，先开统筹再开子项。
  const r = await ev(`(() => {
    const find=(re)=>[...document.querySelectorAll('input[type=checkbox]')]
      .find(cb=>re.test(cb.closest('label')?.textContent||''));
    const master=find(/联网功能/);
    if(!master) return 'NO_SWITCH';
    master.scrollIntoView({block:'center'});
    const wasMaster=master.checked;
    if(master.checked !== ${on ? "true" : "false"}) master.click();
    return 'master was=' + wasMaster + ' now=' + master.checked;
  })()`);
  await sleep(600);
  // 子项在统筹关着时是 disabled 的，所以必须等统筹先开、重渲染之后再点。
  const sub = on
    ? await ev(`(() => {
        const s=[...document.querySelectorAll('input[type=checkbox]')]
          .find(cb=>/联网搜索/.test(cb.closest('label')?.textContent||''));
        if(!s) return ' | NO_SUB';
        if(s.disabled) return ' | sub disabled';
        const was=s.checked;
        if(!s.checked) s.click();
        return ' | sub was=' + was + ' now=' + s.checked;
      })()`)
    : "";
  await sleep(900);
  const hintNow = await ev(`(() => { const el=document.querySelector('[data-testid="context-hint"]'); return el ? el.textContent.trim() : 'NONE'; })()`);
  await ev(`(() => { const b=[...document.querySelectorAll('button')].filter(e=>e.offsetParent).find(x=>/关闭/.test(x.title+(x.getAttribute('aria-label')||''))); if(b)b.click(); })()`);
  await sleep(700);
  return { r: r + sub, hintNow };
}
const off = await setWeb(false);
pass("⓿ 前置条件：联网已关", !/NO_SWITCH/.test(off.r) && /master was=\w+ now=false/.test(off.r), off.r);

// ── ① 默认关：当前对话问搜索题，应当明说不能搜 ─────────────────────────────
// 「没有联网能力 / 不能联网 / 工具集里没有」都是同一个意思。上一版只写了
// `不能联网`，于是 momo 说「我确实没有联网能力」时被判成"能搜了" —— 一个假通过。
// 判据宁可宽一点：漏判成"还不能搜"只是白修一次，漏判成"能搜了"会把缺陷放过去。
const DENIES_NET = /不能联网|没办法搜|没有联网|无法联网|访问是关|工具集里没有|不具备联网|离线/;
const q1 = `联网搜一下今天的天气，口令 ${NONCE}-A。如果你现在没有联网能力，就直接说"我不能联网"。`;
const a1 = await ask(q1);
const deniedFirst = DENIES_NET.test(a1);
pass("① 默认关 → momo 明说不能联网（不假装）", deniedFirst, a1.slice(0, 90).replace(/\s+/g, " "));

// ── ② 打开设置页的「联网功能」——不新建对话 ───────────────────────────────
const on = await setWeb(true);
const flipped = on.r;
const hint = on.hintNow;
await shot("60-a3-hint");
pass("④ 界面明说生效时机", /下一轮起生效|已保存/.test(hint), `switch=${flipped} hint="${hint}"`);
pass("④b 提示点名了活对话数（不是空口号）", /个对话下一轮起生效/.test(hint), hint);

// ── ③ 同一个对话再问 —— 修复前这里会说"这轮对话里我的网络访问是关的" ────────
const q2 = `现在联网搜一下：2026 年图灵奖得主是谁？口令 ${NONCE}-B。必须用搜索工具并给出来源链接。`;
const a2 = await ask(q2);
const stillDenied = DENIES_NET.test(a2);

// 判据订正：查的是「这轮消息对应的 WebSearch 工具真的跑完并拿回真 URL」，不是
// 「过程卡此刻有没有展开」。DOM 只呈现当前折叠状态，曾把一次已经成功的搜索误判
// 成失败；SQLite 时间线才是应用实际记录的工具事件，也是重启后用户会恢复的事实源。
const evidence = await ev(`(async () => {
  const r = await window.leemoPersist.invoke("loadAll", undefined);
  const conversations = r?.response?.conversations ?? [];
  const marker = ${JSON.stringify(NONCE + "-B")};
  for (const conversation of conversations) {
    const timeline = conversation.timeline ?? [];
    const user = [...timeline].reverse().find(
      item => item.kind === "text" && item.role === "user" && item.text?.includes(marker),
    );
    if (!user) continue;
    const tools = timeline.filter(
      item => item.kind === "tool" && item.runId === user.runId && item.name === "WebSearch",
    );
    const finished = [...tools].reverse().find(item => item.status === "ok");
    const urls = String(finished?.summary ?? "").match(/https?:\\/\\/[^\\s\"',}\\]]+/g) ?? [];
    return JSON.stringify({
      conversationId: conversation.meta?.id,
      runId: user.runId,
      ranWebSearch: Boolean(finished),
      urls: urls.slice(0, 3),
    });
  }
  return JSON.stringify({ ranWebSearch: false, urls: [], reason: "marker-not-persisted" });
})()`);
const evd = JSON.parse(evidence);
const hasLink = evd.ranWebSearch && evd.urls.length > 0;
pass("③ 同一对话下一轮真的能搜（核心）", !stillDenied, stillDenied ? a2.slice(0, 120).replace(/\s+/g, " ") : "未再声称不能联网");
pass(
  "③b WebSearch 真的跑了并拿回真 URL（工具原始返回为证）",
  hasLink,
  `ranWebSearch=${evd.ranWebSearch} urls=${evd.urls.length} ${evd.urls[0] ?? ""}`,
);
await shot("61-a3-same-conversation-search");

// ── ⑤ 落盘：直接读 SQLite 侧的证据（重启验证由外层脚本做）────────────────
const persisted = await ev(`(async () => {
  const r = await window.leemoPersist.invoke("loadAll", undefined);
  const s = r?.response?.settings ?? {};
  return JSON.stringify({ webEnabled: s.webEnabled, keys: Object.keys(s).length });
})()`);
const p = JSON.parse(persisted);
pass("⑤ 设置已写进 SQLite（重启不丢的前提）", p.webEnabled === true, `webEnabled=${p.webEnabled} keys=${p.keys}`);

fs.writeFileSync("docs/research/audit-shots/verify-r7-a3.json", JSON.stringify({ nonce: NONCE, results, a1, a2 }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
close();
process.exit(failed.length ? 1 : 0);
