// 轮 4 实机验收（主控亲验）：连真 Electron 渲染进程的 CDP，驱动真界面。
//
// 为什么必须这一步：单测证明了 reducer/组件对着假 workspace 是对的，host 验收证明了
// readPreview 对着真文件是对的。中间还剩一段只有实机能证的：IPC 频道名对不对、
// preload 转发对不对、PDF.js 的 worker 在 Electron 里加不加载得起来。那一段正是
// 「看起来接好了其实没接」的常驻地。
import WebSocket from "ws";

const PORT = process.env.LEEMO_DEBUG_PORT || "9222";

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:5173"));
if (!page) throw new Error("找不到 Leemo 渲染进程");

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });

let seq = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

/**
 * Evaluate in the page and return the value (awaits promises).
 *
 * The helper prelude is re-sent on EVERY call on purpose. Vite's dev server does
 * a full page reload the first time it pre-bundles a newly-imported dep — and
 * opening a PDF is exactly that (pdfjs-dist is lazily imported). A reload wipes
 * anything installed on `window`, so a driver that injects helpers once dies
 * mid-run with "__leemo_q is not a function".
 */
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", {
    expression: `${HELPERS}\n(${expr})`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `expr` until it is truthy, or give up. */
async function until(expr, { tries = 40, gap = 250, label = expr } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await evaluate(expr);
    if (v) return v;
    await sleep(gap);
  }
  throw new Error(`等不到：${label}`);
}

const results = [];
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `\n      ${note}` : ""}`);
};

// DOM 助手：跑在页面里。用真的 .click() —— React 在 root 上监听，原生冒泡事件
// 走的就是用户点的那条路。
const HELPERS = `
window.__leemo_q = (sel) => document.querySelector(sel);
window.__leemo_byText = (text, sel = "*") =>
  [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text) || null;
window.__leemo_byLabel = (label) => {
  const l = [...document.querySelectorAll("input")].find((i) => i.getAttribute("aria-label") === label);
  return l || null;
};
window.__leemo_clickText = (text, sel = "button") => {
  const el = window.__leemo_byText(text, sel);
  if (!el) return false;
  el.click();
  return true;
};
true;
`;

try {
  await send("Runtime.enable");
  await send("Log.enable").catch(() => {});
  // 助手不再单独注入：evaluate 每次都会带上 prelude（见它的注释）。
  await evaluate(`typeof window.__leemo_q === 'function'`);

  // 从干净状态起跑：ui store 是内存态，上一次跑留下的模式/标签/设置页会让"点开
  // 文件"这些开关型操作反向生效（已经在工作台还去点模式键 = 切回搭子）。
  await send("Page.enable").catch(() => {});
  await send("Page.reload", { ignoreCache: false });
  await sleep(2500);
  await until(`!!document.querySelector('button')`, { label: "reload 后界面重挂" });

  await until(`!!document.querySelector('[data-testid],button')`, { label: "界面挂载" });
  const title = await evaluate(`document.title`);
  check("Electron 渲染进程活着", true, `title=${JSON.stringify(title)}`);

  // ── 验收②：预览区点文件显示真内容 ───────────────────────────────────────
  // 走真实路径：切工作台 → 开文件栏 → 展开本子 → 点文件 → 读 DOM。

  // 切工作台 → 开文件栏 → 展开本子。全部走幂等的那一份（下面 navigateToNotebook），
  // 因为这三步操作的都是"开关"，重复点会反向生效。
  await navigateToNotebook();

  const treeSeen = await evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('[data-testid^="dir-row-"],[data-testid^="file-row-"]')]
        .map(e => e.getAttribute('data-testid'));
      return JSON.stringify(rows.slice(0, 30));
    })()
  `);
  check("文件树读到了真 ~/Leemo", /预览验收/.test(treeSeen), `rows=${treeSeen}`);

  /**
   * 把「工作台 → 文件栏 → 展开本子」这三步做成可重放的一步。
   *
   * 需要重放是因为 vite 首次预打包一个新依赖时会整页 reload（打开 PDF 就会触发，
   * pdfjs-dist 是 lazy import 的）。reload 之后 ui store 是内存态 ⇒ 模式回搭子、
   * 预览标签清空、文件栏收起。不重放就会一直等一个永远不会出现的 canvas。
   */
  async function navigateToNotebook() {
    // 幂等：已经在工作台就别再点模式键（那是个来回切的开关，点一下会切回搭子）。
    await evaluate(`
      (() => {
        if (window.__leemo_q('[data-testid="preview-pane"]')) return 'already';
        const btn = [...document.querySelectorAll('button')]
          .find(b => /工作台/.test(b.textContent || '') || b.getAttribute('aria-label')?.includes('工作台'));
        if (btn) { btn.click(); return 'btn'; }
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true }));
        return 'kbd';
      })()
    `);
    await sleep(600);
    // 同样幂等：文件树已经在就别再点（那也是开关）。
    await evaluate(`
      (() => {
        if (window.__leemo_q('[data-testid^="dir-row-"]')) return 'already';
        const b = [...document.querySelectorAll('button')]
          .find(x => /文件/.test(x.getAttribute('aria-label') || '') || /^文件$/.test(x.textContent?.trim() || ''));
        if (b) { b.click(); return 'btn'; }
        return 'none';
      })()
    `);
    await sleep(500);
    await until(`!!window.__leemo_q('[data-testid="dir-row-预览验收"]')`, {
      label: "文件树里的「预览验收」",
      tries: 40,
    });
    // 展开也是开关：已经展开还点一下就收起来了，文件行随之消失。
    await evaluate(`
      (() => {
        if (window.__leemo_q('[data-testid="file-row-预览验收/说明书.pdf"]')) return 'already';
        window.__leemo_q('[data-testid="dir-row-预览验收"]')?.click();
        return 'clicked';
      })()
    `);
    await sleep(400);
    await until(`!!window.__leemo_q('[data-testid="file-row-预览验收/说明书.pdf"]')`, {
      label: "本子展开后的文件行",
      tries: 40,
    });
  }

  /** 点一个文件 → 等预览区出现某个 testid → 回读文本。 */
  async function openAndRead(relPath, wantTestId) {
    const clicked = await evaluate(
      `!!window.__leemo_q(${JSON.stringify(`[data-testid="file-row-${relPath}"]`)})?.click() || !!window.__leemo_q(${JSON.stringify(`[data-testid="file-row-${relPath}"]`)})`,
    );
    if (!clicked) return { clicked: false };
    await until(`!!window.__leemo_q('[data-testid="${wantTestId}"]')`, {
      label: `${relPath} → ${wantTestId}`,
      tries: 60,
    });
    const text = await evaluate(
      `window.__leemo_q('[data-testid="${wantTestId}"]')?.innerText?.slice(0, 200) ?? ''`,
    );
    return { clicked: true, text };
  }

  // md：markdown 真渲染
  const md = await openAndRead("预览验收/笔记.md", "preview-markdown");
  check(
    "预览区 · md 显示真内容且按 markdown 渲染",
    md.clicked && /真的/.test(md.text || "") && !/内容加载中/.test(md.text || ""),
    `text=${JSON.stringify((md.text || "").slice(0, 80))}`,
  );
  const mdHeading = await evaluate(
    `!!window.__leemo_q('[data-testid="preview-markdown"] h1')`,
  );
  check("预览区 · md 的 # 变成真 <h1>（不是字面井号）", mdHeading);

  // 纯文本：不该被当 markdown 解析
  const log = await openAndRead("预览验收/日志.log", "preview-plaintext");
  check(
    "预览区 · 纯文本原样显示，井号没被解析成标题",
    log.clicked && /不该变成标题/.test(log.text || ""),
    `text=${JSON.stringify((log.text || "").slice(0, 80))}`,
  );

  // 二进制：明确的不预览态
  const bin = await openAndRead("预览验收/数据.bin", "preview-unpreviewable");
  check(
    "预览区 · 二进制给明确的不预览态（不是空白）",
    bin.clicked && /二进制/.test(bin.text || ""),
    `text=${JSON.stringify((bin.text || "").slice(0, 80))}`,
  );

  // PDF：PDF.js + TextLayer 真选区。
  //
  // 最多两轮：第一轮很可能被 vite 的依赖预打包 reload 打断（pdfjs-dist 首次被
  // import），reload 之后重放导航再点一次；这时依赖已经打好，不会再 reload。
  let pdfSettled = false;
  for (let attempt = 1; attempt <= 3 && !pdfSettled; attempt++) {
    await navigateToNotebook();
    await evaluate(`window.__leemo_q('[data-testid="file-row-预览验收/说明书.pdf"]')?.click() ?? null`);
    for (let i = 0; i < 60; i++) {
      const state = await evaluate(`
        (() => {
          // 等 span 而不是等 canvas：canvas 先画完，TextLayer 是随后 await 的，
          // 一见 canvas 就采样会在两者之间抢跑，把"还没铺完"读成"铺不出来"。
          if (document.querySelector('[data-testid="pdf-view"] .textLayer span')) return 'canvas';
          if (window.__leemo_q('[data-testid="pdf-error"]')) return 'error';
          if (window.__leemo_q('[data-testid="pdf-view"]')) return 'mounted';
          if (window.__leemo_q('[data-testid="preview-pdf-loading"]')) return 'chunk';
          // 预览标签整个不见了 ⇒ 页面被 reload 过，这一轮白跑，重放导航。
          if (!window.__leemo_q('[data-testid="preview-pane"]')) return 'reloaded';
          return 'waiting';
        })()
      `);
      if (state === "canvas" || state === "error") { pdfSettled = true; break; }
      if (state === "reloaded") { console.log(`      (第 ${attempt} 轮被 vite reload 打断，重放导航)`); break; }
      await sleep(500);
    }
  }
  if (!pdfSettled) throw new Error("PDF 三轮都没稳定到 canvas 或 error");
  const pdfState = await evaluate(`
    (() => {
      const err = window.__leemo_q('[data-testid="pdf-error"]');
      if (err) return JSON.stringify({ error: err.innerText.slice(0, 200) });
      const canvases = document.querySelectorAll('[data-testid="pdf-view"] canvas').length;
      const layers = document.querySelectorAll('[data-testid="pdf-view"] .textLayer').length;
      const spans = document.querySelectorAll('[data-testid="pdf-view"] .textLayer span').length;
      const sample = [...document.querySelectorAll('[data-testid="pdf-view"] .textLayer span')]
        .slice(0, 6).map(s => s.textContent).join('');
      return JSON.stringify({ canvases, layers, spans, sample });
    })()
  `);
  const pdf = JSON.parse(pdfState);
  check(
    "预览区 · PDF 用 PDF.js 渲染出来了",
    !pdf.error && pdf.canvases > 0,
    pdfState,
  );
  check(
    "预览区 · TextLayer 铺出真文字节点（能选中，不是图片）",
    !pdf.error && pdf.spans > 0,
    `spans=${pdf.spans} sample=${JSON.stringify(pdf.sample || "")}`,
  );

  // 选区真能拿到（SelectionMenu 的前提 —— iframe 阅读器就是在这里失效的）
  const selText = await evaluate(`
    (() => {
      const spans = [...document.querySelectorAll('[data-testid="pdf-view"] .textLayer span')].slice(0, 3);
      if (!spans.length) return '';
      const r = document.createRange();
      r.setStartBefore(spans[0]);
      r.setEndAfter(spans[spans.length - 1]);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return sel.toString().slice(0, 60);
    })()
  `);
  check(
    "预览区 · PDF 文字真能被 window.getSelection() 选中（[问一下] 的前提）",
    !!selText && selText.trim().length > 0,
    `selection=${JSON.stringify(selText)}`,
  );

  // ── 验收①：三层开关能独立控制 ───────────────────────────────────────────
  await evaluate(`window.getSelection()?.removeAllRanges()`);
  const openedSettings = await evaluate(`
    (() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => /设置/.test(x.getAttribute('aria-label') || '') || /^设置$/.test(x.textContent?.trim() || ''));
      if (b) { b.click(); return true; }
      return false;
    })()
  `);
  await sleep(700);
  await until(`!!window.__leemo_byLabel('联网功能')`, { label: "设置页联网段", tries: 40 });

  const readToggles = `JSON.stringify({
    web: window.__leemo_byLabel('联网功能')?.checked,
    search: window.__leemo_byLabel('联网搜索 WebSearch')?.checked,
    fetch: window.__leemo_byLabel('联网抓取 WebFetch')?.checked,
    searchDisabled: window.__leemo_byLabel('联网搜索 WebSearch')?.disabled,
    fetchDisabled: window.__leemo_byLabel('联网抓取 WebFetch')?.disabled,
  })`;

  const t0 = JSON.parse(await evaluate(readToggles));
  check(
    "设置页 · 三层开关都在；统筹关时二级不可点",
    t0.web === false && t0.searchDisabled === true && t0.fetchDisabled === true,
    JSON.stringify(t0),
  );

  const notes = await evaluate(`
    (() => {
      const txt = document.body.innerText;
      return JSON.stringify({
        web: txt.includes('总开关'),
        search: txt.includes('关闭后 momo 再也不能自主搜索'),
        fetch: txt.includes('关闭后 momo 再也访问不了网页'),
      });
    })()
  `);
  check("设置页 · 每个开关都带说明文案", Object.values(JSON.parse(notes)).every(Boolean), notes);

  await evaluate(`window.__leemo_byLabel('联网功能').click()`);
  await sleep(300);
  const t1 = JSON.parse(await evaluate(readToggles));
  check(
    "设置页 · 打开统筹 ⇒ 两个二级都生效且可点",
    t1.web === true && t1.search === true && t1.fetch === true && t1.searchDisabled === false,
    JSON.stringify(t1),
  );

  await evaluate(`window.__leemo_byLabel('联网抓取 WebFetch').click()`);
  await sleep(300);
  const t2 = JSON.parse(await evaluate(readToggles));
  check(
    "设置页 · 关抓取不动搜索（二级独立）",
    t2.fetch === false && t2.search === true,
    JSON.stringify(t2),
  );

  await evaluate(`window.__leemo_byLabel('联网功能').click()`);
  await sleep(300);
  const t3 = JSON.parse(await evaluate(readToggles));
  await evaluate(`window.__leemo_byLabel('联网功能').click()`);
  await sleep(300);
  const t4 = JSON.parse(await evaluate(readToggles));
  check(
    "设置页 · 统筹关=两个都关；再打开原样回来（掩码不是清值）",
    t3.search === false && t3.fetch === false && t4.search === true && t4.fetch === false,
    `off=${JSON.stringify(t3)} back=${JSON.stringify(t4)}`,
  );

  console.log("\n=== 控制台错误检查 ===");
  const errs = await evaluate(`JSON.stringify(window.__leemo_errors || [])`);
  console.log(errs === "[]" ? "(无捕获)" : errs);
} finally {
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  if (fails.length) console.log(`FAILED: ${fails.map((f) => f.name).join(" / ")}`);
  ws.close();
  process.exitCode = fails.length ? 1 : 0;
}
