// 轮 5 打包实机验收：对**打包产物**（不是 dev）跑真界面 + 真对话。
//
// 用法：
//   node scripts/verify-r5-packaged.mjs <Leemo.exe 的绝对路径> [arm]
//   arm = bootstrap | encrypted | freshuserdata（默认全跑）
//
// 为什么要分两趟跑（bootstrap → encrypted），这是本卡最要紧的判据：
//   趟①（bootstrap）cwd=仓库根，.env 在，key 由 .env 迁进 safeStorage 加密件；
//   趟②（encrypted）cwd=临时目录（**没有 .env**）且把 *_API_KEY 环境变量全清掉，
//        还能真流式 ⇒ key 只可能来自加密件。
// 一趟跑完就宣布"safeStorage 在打包后能用"是不成立的：那时 .env 还在，即使加密
// 件根本没生效，对话照样通 —— 那种"验过了"什么都没验到。
import { spawn } from "node:child_process";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EXE = process.argv[2];
const ONLY = process.argv[3];
if (!EXE || !fs.existsSync(EXE)) {
  console.error(`用法: node scripts/verify-r5-packaged.mjs <Leemo.exe 路径> [arm]\n给的是: ${EXE}`);
  process.exit(2);
}
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const PORT = Number(process.env.LEEMO_DEBUG_PORT || 9333);
// 窗口被完全遮挡时 Chromium 停掉 rAF，渲染类判据会假失败（轮 4 教训）。
const FLAGS = [
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
];
const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const USERDATA = path.join(APPDATA, "Leemo");
const SECRETS = path.join(USERDATA, "leemo-secrets.enc");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 一次性口令：拼进问句，保证"本轮问句"在库里独一无二（对话会被复用，见 findRun）。 */
const NONCE = `v${Date.now().toString(36).slice(-5)}`;
const results = [];
function check(n, ok, note = "") {
  results.push({ n, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `\n      ${note}` : ""}`);
}

/** 起打包好的 exe，收集 stdout（主进程日志是判据来源之一）。 */
function launch({ cwd, env, port }) {
  const child = spawn(EXE, [`--remote-debugging-port=${port}`, ...FLAGS], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  let log = "";
  child.stdout.on("data", (b) => (log += b.toString()));
  child.stderr.on("data", (b) => (log += b.toString()));
  return { child, log: () => log };
}

/** 等 CDP 起来并连上打包渲染端（url 是 file://，不再是 localhost:5173）。 */
async function connect(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let page;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === "page" && /index\.html|^file:/.test(t.url));
      if (page) break;
    } catch {
      /* 还没起 */
    }
    await sleep(500);
  }
  if (!page) {
    // 光说"没出现 page"没法查。把候选 target 和主进程输出一起带出去。
    let seen = "(取不到 /json/list)";
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      seen = JSON.stringify(list.map((t) => ({ type: t.type, url: (t.url || "").slice(0, 80) })));
    } catch (e) {
      seen = `/json/list 不可达: ${e.message}`;
    }
    throw new Error(`CDP 没在 ${timeoutMs}ms 内出现可用 page；现有 targets=${seen}`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  let seq = 0;
  const pending = new Map();
  const consoleErrors = [];
  const failedLoads = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description).join(" "));
    }
    if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? "exception");
    }
    // 加载失败的资源。这一格是本轮的教训：`base:"/"` 打出来的产物在 file:// 下
    // JS/CSS 双双 404，而**控制台一条错误都没有** —— 只有网络层看得见。
    if (m.method === "Network.loadingFailed") {
      failedLoads.push(`${m.params.type} ${m.params.errorText}`);
    }
    if (m.method === "Log.entryAdded" && m.params.entry?.level === "error") {
      const e = m.params.entry;
      failedLoads.push(`${e.source}: ${(e.text || "").slice(0, 120)}${e.url ? ` <${e.url}>` : ""}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  // Log + Network 一起开：空白屏的真凶（404 的 module script）只在这两个域里露头。
  await send("Log.enable").catch(() => {});
  await send("Network.enable").catch(() => {});
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(`THREW: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  return { ev, url: page.url, consoleErrors, failedLoads, close: () => ws.close() };
}

/** 等界面真的挂上来。CDP 的 page target 在 index.html **开始加载**时就出现了，
 *  而打包态冷启动要读 110MB asar、开 SQLite、跑 loadAll —— 比 dev 慢。上一版在
 *  target 出现约 2s 后就断言"没有输入框"，那是驱动太急，不是 App 没起来。
 *  失败时把真实 DOM 摘要打出来，好让下一次的判据来自真界面。 */
async function waitForUi(ev, maxSec = 45) {
  for (let i = 0; i < maxSec; i++) {
    const ok = await ev(`!!document.querySelector('textarea[aria-label="输入消息"]')`);
    if (ok) return { ok: true, sec: i };
    await sleep(1000);
  }
  const dump = await ev(
    `(()=>{const q=(s)=>[...document.querySelectorAll(s)];return JSON.stringify({` +
      `title:document.title,readyState:document.readyState,` +
      `rootChildren:document.getElementById('root')?.children.length ?? -1,` +
      `textareas:q('textarea').map(t=>t.getAttribute('aria-label')||'(no-label)'),` +
      `buttons:q('button').slice(0,12).map(b=>(b.textContent||'').trim()).filter(Boolean),` +
      `bodyText:(document.body.innerText||'').slice(0,300)})})()`,
  );
  return { ok: false, dump };
}

/** momo 的回复在 timeline 里是 `{kind:"text", role:"momo"}` —— **不是**
 *  `kind:"assistant"`（那个 kind 根本不存在，见 stores/message-model.ts）。
 *  上一版按 assistant 取，于是永远取到空串：回复显示为 ""、"逐字增长" 永远 false，
 *  而 result 一出现就算过 —— 一个什么都没验到的 PASS。 */
function replyTextOf(conv, runId) {
  const items = (conv?.timeline ?? []).filter((t) => t.runId === runId);
  const stream = items
    .filter((t) => t.kind === "text" && t.role === "momo")
    .map((t) => t.text ?? "")
    .join("");
  if (stream) return stream;
  const res = items.find((t) => t.kind === "result");
  return res?.finalText ?? "";
}

/** 找到"本轮"那个 run：时间线里 text===msg 的**最后一条**用户消息，取它的 runId。
 *
 *  为什么必须到 runId 这一层：搭子态会**复用同一个对话**，于是上一趟的问答和本轮的
 *  问答躺在同一条 timeline 里。只锚定"含本轮问句的对话"是不够的 —— 我按对话取
 *  momo 文本和 result，拿到的是**上一趟**的回复（证据就是回复内容答的是上一个问题），
 *  1 秒就"通过"。而 store 给每次发送打 `run-${++runSeq}`，这一轮折进来的每条都带同
 *  一个 runId，rehydrate 时 runSeq 还会从已有最大值往后接 —— 正是我要的锚。 */
function findRun(all, msg) {
  for (const c of all) {
    const items = c.timeline ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      const t = items[i];
      if (t.kind === "text" && t.role === "user" && t.text === msg) {
        return { conv: c, runId: t.runId };
      }
    }
  }
  return undefined;
}

/** 发一句话，等真流式出结果。返回 {finished,isError,reply,streamed}。
 *
 *  两条判据纪律（都是被自己坑过之后加的）：
 *  ① **必须是新对话**。`loadAll` 按 last_activity_at DESC 排，`conversations[0]`
 *     很可能是上一趟留下的旧对话，而它早就有 result —— 于是 5 秒就"通过"了，新消息
 *     其实压根没跑完。所以先记下已有的 id 集合，只认新出现的那个。
 *  ② **回复非空**。isError=false 但一个字都没有，不该算真流式出结果。 */
async function sendAndWait(ev, msg, maxSec = 150) {
  const ui = await waitForUi(ev);
  if (!ui.ok) return { finished: false, why: `界面没挂上来；真实 DOM=${ui.dump}` };
  if (ui.sec > 0) console.log(`      界面在 t+${ui.sec}s 挂上来`);
  const before = await ev(
    `(async()=>{const r=await window.leemoPersist.invoke('loadAll',undefined);` +
      `return (r?.response?.conversations??[]).length;})()`,
  );
  console.log(`      发送前库里已有 ${before} 个对话（只认包含本轮问句的那个）`);
  const typed = await ev(
    `(()=>{const ta=document.querySelector('textarea[aria-label="输入消息"]');if(!ta)return{ok:false,why:"no textarea"};` +
      `const s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;` +
      `s.call(ta,${JSON.stringify(msg)});ta.dispatchEvent(new Event('input',{bubbles:true}));` +
      `const b=document.querySelector('button[aria-label="发送"]');if(!b)return{ok:false,why:"no send button"};b.click();return{ok:true};})()`,
  );
  if (!typed?.ok) return { finished: false, why: typed?.why ?? "send failed" };
  // 真流式的两个独立信号，任一为真就算看见了：
  //  ① 文本在长（相邻两次采样长度递增）
  //  ② 时间线里出现过 `streaming: true` 的 momo 文本条（store 自己标的状态）
  // ⚠️ 采样间隔 400ms，不是 1s：一条三十字的回复在 1s 采样下常常"一下就齐了"，
  //    于是 ① 永远是 false —— 那是我采样太慢，不是它没流式。② 则是直接读状态，
  //    不依赖采样运气。
  const TICK_MS = 400;
  const ticks = Math.ceil((maxSec * 1000) / TICK_MS);
  let grew = false;
  let sawStreamingFlag = false;
  let lastLen = 0;
  let sawNew = false;
  // ③ DOM 信号，也是**用户真正看见的那个**：`.leemo-caret` 只在 item.streaming 为
  //    真时渲染（TextBubble.tsx），所以它出现过就等于"逐字光标真的在闪"。
  //    为什么必须看 DOM：持久化是**防抖**的，而且每次 store 变化都会重置计时器
  //    （persistence/sync.ts 的 cancelPending），于是流式期间**一次都不落盘** ——
  //    从 loadAll 里永远看不到进行中的状态。①② 结构上就测不到，不是运气问题。
  let caretSeen = false;
  let domGrew = false;
  let lastDomLen = 0;
  for (let i = 0; i < ticks; i++) {
    await sleep(TICK_MS);
    // 审批条每秒看一次就够，别每 400ms 扫一遍 DOM。
    if (i % 3 === 0) {
      const approved = await ev(
        `(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='允许一次');b.forEach(x=>x.click());return b.length;})()`,
      );
      if (approved) console.log(`      放行 ${approved} 条审批`);
    }
    // 先采 DOM（便宜、且是流式的唯一可观测处），再读库。
    const dom = await ev(
      `(()=>({caret:!!document.querySelector('.leemo-caret'),` +
        `len:(document.querySelector('main')?.innerText||'').length}))()`,
    );
    if (dom?.caret) caretSeen = true;
    if ((dom?.len ?? 0) > lastDomLen && lastDomLen > 0) domGrew = true;
    lastDomLen = dom?.len ?? lastDomLen;
    const s = await ev(`window.leemoPersist.invoke('loadAll',undefined)`);
    const all = s?.response?.conversations ?? [];
    // 锚到 **本轮那个 run**（见 findRun 的头注：对话会被复用，只锚对话会读到上一趟）。
    const hit = findRun(all, msg);
    if (!hit) continue;
    const { conv: c, runId } = hit;
    if (!sawNew) {
      sawNew = true;
      console.log(
        `      本轮问句已落库 (conv=${String(c.meta?.id ?? "?").slice(0, 8)}… run=${runId})`,
      );
    }
    const txt = replyTextOf(c, runId);
    if (txt.length > lastLen && lastLen > 0) grew = true;
    lastLen = txt.length;
    if (
      (c.timeline ?? []).some(
        (t) => t.runId === runId && t.kind === "text" && t.role === "momo" && t.streaming === true,
      )
    ) {
      sawStreamingFlag = true;
    }
    // result 也必须是**这一轮**的 —— 旧 run 的 result 早就在时间线里躺着。
    const res = (c.timeline ?? []).find((t) => t.kind === "result" && t.runId === runId);
    if (res) {
      const final = txt || res.finalText || "";
      return {
        finished: true,
        isError: res.isError,
        reply: final.slice(0, 200),
        nonEmpty: final.trim().length > 0,
        grew,
        sawStreamingFlag,
        caretSeen,
        domGrew,
        streamed: grew || sawStreamingFlag || caretSeen || domGrew,
        runId,
        sec: (((i + 1) * TICK_MS) / 1000).toFixed(1),
      };
    }
  }
  return {
    finished: false,
    why: sawNew ? `${maxSec}s 内这轮对话没出 result` : `${maxSec}s 内问句没落库（没找到含本轮问句的对话）`,
    reply: "",
  };
}

async function killTree(child) {
  try {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    child.kill();
  }
  await sleep(2500);
}

// ── 趟① bootstrap：cwd=仓库根，.env 在 ⇒ key 应迁进加密件 ────────────────
if (!ONLY || ONLY === "bootstrap") {
  console.log("\n=== 趟① bootstrap（cwd=仓库根，.env 可见）===");
  const hadSecrets = fs.existsSync(SECRETS);
  const { child, log } = launch({ cwd: REPO, env: { ...process.env }, port: PORT });
  try {
    const { ev, url, consoleErrors, failedLoads } = await connect(PORT);
    check("打包产物能起窗、渲染端从 file:// 加载", /^file:/.test(url), url);
    const asarPath = await ev(`1`); // 连通性
    check("渲染端可执行脚本（preload 在 asar 里也能用）", asarPath === 1);
    // ★ 本轮抓到的真 bug 的守门格：React 真挂到 #root 上了吗。
    //   `base:"/"` 时这里永远是 0 —— 纯白窗口，而 readyState 是 complete、控制台没错。
    //   ⚠️ 必须**等**，不能只采样一次：CDP 的 page target 在 index.html 开始加载时就
    //   出现，冷启动要读 110MB asar + 开 SQLite。采样一次会随机失败（同一个包我这儿
    //   一次 0、一次 1），那种红是驱动太急，不是产品白屏。
    let mounted = { n: -1, text: 0 };
    for (let i = 0; i < 45; i++) {
      mounted = await ev(
        `(()=>{const r=document.getElementById('root');return {n:r?r.children.length:-1,` +
          `text:(document.body.innerText||'').trim().length};})()`,
      );
      if ((mounted?.n ?? 0) > 0 && (mounted?.text ?? 0) > 0) break;
      await sleep(1000);
    }
    check("渲染端真挂上来了（不是空白屏 —— 02 §十九 禁空白屏）",
      (mounted?.n ?? 0) > 0 && (mounted?.text ?? 0) > 0,
      `#root 子节点=${mounted?.n} body 文本长度=${mounted?.text}` +
        (failedLoads.length ? `\n      加载失败: ${failedLoads.slice(0, 4).join(" | ")}` : ""));
    const bridgeOk = await ev(`typeof window.leemoPersist?.invoke === 'function'`);
    check("preload 暴露的 IPC 面在打包后仍在", bridgeOk === true);
    // 轮 4 的教训做成自证：窗口被遮挡时 Chromium 停掉 rAF，于是任何"画不出来又
    // 不报错"的结论都不可信。先钉住这一格，后面的判据才有意义。
    const raf = await ev(
      `new Promise(r=>{let n=0;const t=setTimeout(()=>r({frames:n,vis:document.visibilityState}),1000);` +
        `const tick=()=>{n++;if(n<60)requestAnimationFrame(tick);else{clearTimeout(t);r({frames:n,vis:document.visibilityState});}};requestAnimationFrame(tick);})`,
    );
    check("rAF 活着（否则一切渲染类判据都不可信 —— 轮 4 踩过）",
      (raf?.frames ?? 0) > 0, `frames=${raf?.frames} visibility=${raf?.vis}`);
    // 问一句够长的，好让"逐字增长"看得见（三个字的回复可能一个 partial 就到齐了）。
    // 带一次性口令：这样问句在库里**独一无二**，锚点绝不可能落到上一趟那条上。
    const r = await sendAndWait(ev, `用大约三十个字介绍一下你自己，不要用工具。(${NONCE})`);
    check("搭子态发一句话 → 真出结果（原生 CLI 被 spawn 成功）",
      r.finished && !r.isError && r.nonEmpty === true,
      r.finished
        ? `t+${r.sec}s run=${r.runId} isError=${r.isError} 回复非空=${r.nonEmpty}\n      回复=${JSON.stringify(r.reply.slice(0, 90))}`
        : r.why);
    // 流式单独成一格：它和"能不能出结果"是两件事，混在一格里会让人分不清哪个红了。
    check("真流式（界面上逐字光标闪过 / 文本在长）",
      r.finished === true && r.streamed === true,
      r.finished
        ? `逐字光标(.leemo-caret)=${r.caretSeen} 界面文本递增=${r.domGrew}` +
          `（库里测不到是必然的：持久化防抖，流式期间不落盘 → 库内递增=${r.grew} streaming标记=${r.sawStreamingFlag}）`
        : "（上一格没跑完）");
    check("控制台无错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    check("没有资源加载失败（file:// 下的 404 只在网络层露头）",
      failedLoads.length === 0, failedLoads.slice(0, 4).join(" | "));
    // 判据放在**文件系统**上，不放在 stdout 上：stdout 万一没捕获到，
    // 用正则去匹配一个空串会得到一个"通过"，那种通过什么都没验到。
    const resources = path.join(path.dirname(EXE), "resources");
    const unpackedCli = path.join(
      resources, "app.asar.unpacked", "node_modules",
      "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe",
    );
    check("原生 CLI 真落在 app.asar.unpacked 下（asar 里的 spawn 不了）",
      fs.existsSync(unpackedCli),
      fs.existsSync(unpackedCli)
        ? `${unpackedCli}\n      ${(fs.statSync(unpackedCli).size / 1024 / 1024).toFixed(0)}MB`
        : `缺失: ${unpackedCli}`);
    const l = log();
    const cliLine = (l.match(/\[leemo:main\] cli binary: .*/) || [])[0];
    if (cliLine) {
      check("主进程日志确认它用的就是 unpacked 那份", /unpacked/.test(cliLine), cliLine);
    } else {
      console.log("      (stdout 未捕获到 cli binary 日志行 —— 判据已由文件系统 + 真流式承担)");
    }
    check("加密件已在 userData 落盘", fs.existsSync(SECRETS),
      `${SECRETS}${hadSecrets ? "（本趟之前已存在）" : "（本趟新建）"}`);
    const src = (l.match(/secrets source=\w+/) || [])[0] || "(stdout 未捕获)";
    console.log(`      主进程日志: ${src}`);
  } finally {
    await killTree(child);
  }
}

// ── 趟② encrypted：无 .env、无 *_API_KEY 环境变量 ⇒ key 只能来自加密件 ────
if (!ONLY || ONLY === "encrypted") {
  console.log("\n=== 趟② encrypted（cwd=临时目录，无 .env，环境变量清空）===");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-pkg-"));
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/API_KEY|BASE_URL|_MODEL$|DASHSCOPE|DEEPSEEK|GLM|KIMI|RELAY/.test(k)) delete env[k];
  }
  check("趟② 环境里确实没有任何 key 变量", !Object.keys(env).some((k) => /API_KEY/.test(k)));
  check("趟② cwd 里确实没有 .env", !fs.existsSync(path.join(tmp, ".env")), tmp);
  const { child, log } = launch({ cwd: tmp, env, port: PORT + 1 });
  try {
    const { ev, consoleErrors } = await connect(PORT + 1);
    const r = await sendAndWait(ev, `用大约二十个字说说今天适合做什么，不要用工具。(${NONCE})`);
    check("**只靠 safeStorage 加密件**就能真出结果（打包后加密件可用）",
      r.finished && !r.isError && r.nonEmpty === true,
      r.finished
        ? `t+${r.sec}s run=${r.runId} isError=${r.isError} 回复非空=${r.nonEmpty} 流式=${r.streamed}\n      回复=${JSON.stringify(r.reply.slice(0, 90))}`
        : r.why);
    check("趟② 控制台无错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    const src = (log().match(/secrets source=\w+/) || [])[0] || "(stdout 未捕获)";
    console.log(`      主进程日志: ${src}`);
  } finally {
    await killTree(child);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 占用 */ }
  }
}

// ── 趟③ 全新 userData（= 一个新用户的第一次启动）+ 工作区被 ensure ──────────
//
// ⚠️ 这一趟**不能**靠改环境变量伪造一个全新的 `~/Leemo`。实测（scripts/probe-fresh-home.mjs
// 留仓）：把 USERPROFILE/HOME 指到临时目录之后，打包 App 依然报
// `workspace: C:\Users\<真名>\Leemo` —— Windows 上 Electron 的 `app.getPath("home")`
// 来自系统 profile API，不看环境变量。而三个变量一起改会让进程直接崩
// （exit code 0x80000003）。所以"首次创建 ~/Leemo"这一格在 Windows 上无法用环境
// 变量模拟，除非去搬用户真实的 ~/Leemo —— 那是他的本子，不动。
//
// 能真验、也值得验的是这两件（一个新用户第一次打开就走这条路）：
//  ① `--user-data-dir` 指到空目录 ⇒ 零配置启动不崩、`secrets source=none`、
//     新建 leemo.db。这是"干净机器首次运行"的 userData 那一半，是真的。
//  ② 打包态确实解到并 ensure 了正确的 `~/Leemo` 结构（五件齐全）。
if (!ONLY || ONLY === "freshuserdata") {
  console.log("\n=== 趟③ 全新 userData（新用户第一次启动）+ ~/Leemo 结构 ===");
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-ud-"));
  const child = spawn(EXE, [`--user-data-dir=${ud}`, ...FLAGS], {
    cwd: ud,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  let out = "";
  child.stdout.on("data", (b) => (out += b.toString()));
  child.stderr.on("data", (b) => (out += b.toString()));
  let exited = null;
  child.on("exit", (code) => (exited = code));
  try {
    for (let i = 0; i < 40; i++) {
      if (/workspace: /.test(out) || exited !== null) break;
      await sleep(1000);
    }
    check("零配置 + 全新 userData 启动不崩", exited === null, `exit=${exited}`);
    check("全新 userData 里建了 SQLite 库", fs.existsSync(path.join(ud, "leemo.db")),
      path.join(ud, "leemo.db"));
    const srcLine = (out.match(/secrets source=\w+/) || [])[0] ?? "(无)";
    check("全新 userData 上 secrets source=none（没有 key 也不崩，提示去设置页配）",
      /source=none/.test(srcLine), srcLine);
    // ~/Leemo 结构：以主进程日志里它自己报的路径为准，再去文件系统上核。
    const wsLine = (out.match(/\[leemo:main\] workspace: (.+?) \(/) || [])[1];
    check("打包态解到 ~/Leemo 并报出本子数", Boolean(wsLine), wsLine ?? "(没有 workspace 日志行)");
    if (wsLine) {
      for (const [name, rel] of [
        ["默认工作区（无本子产物兜底）", "默认工作区"],
        ["CLAUDE.md（记忆库）", "CLAUDE.md"],
        ["memory/（层⑥ 绝对路径落点）", "memory"],
        [".claude/（Skills 插件，方案 G）", ".claude"],
      ]) {
        check(`~/Leemo/${name} 在`, fs.existsSync(path.join(wsLine, rel)));
      }
      console.log(`      ~/Leemo 内容: ${fs.readdirSync(wsLine).join(", ")}`);
    }
    console.log("      注：\"从空目录首次创建 ~/Leemo\" 未在打包态实测 —— Windows 上");
    console.log("      app.getPath('home') 不认环境变量（见 scripts/probe-fresh-home.mjs），");
    console.log("      要真验得动用户真实的 ~/Leemo。创建逻辑本身由 ensureWorkspace/");
    console.log("      ensureMemoryBank 的单测覆盖（注入 IO，不碰真文件系统）。");
  } finally {
    await killTree(child);
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* 占用 */ }
  }
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${bad.length ? "FAIL" : "PASS"} ${results.length - bad.length}/${results.length}`);
if (bad.length) console.log(bad.map((b) => `  - ${b.n}`).join("\n"));
process.exit(bad.length ? 1 : 0);
