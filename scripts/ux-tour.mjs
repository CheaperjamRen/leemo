// UX tour — drives the running Leemo renderer through every screen and captures
// screenshots + DOM facts, so the design review is based on the real product
// rather than on the code's intentions. Read-only w.r.t. user data.
import fs from "node:fs";
import WebSocket from "ws";

const PORT = process.env.LEEMO_CDP_PORT || "9222";
const OUT = "docs/research/audit-shots";

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => (ws.once("open", res), ws.once("error", rej)));
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
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => pending.has(myId) && (pending.delete(myId), reject(new Error("timeout " + method))), 60000);
    });
  await send("Runtime.enable");
  await send("Page.enable");
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { send, evaluate, close } = await connect();

async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  console.log("  shot " + name);
}

/** Click the last visible element whose trimmed text contains needle. */
async function clickText(needle) {
  const r = await evaluate(`(() => {
    const needle = ${JSON.stringify(needle)};
    const all = [...document.querySelectorAll('button,a,[role=button],li>div,li,label')];
    const hit = all.reverse().find(e => (e.textContent||'').trim() === needle && e.offsetParent !== null)
      || all.find(e => (e.textContent||'').trim().includes(needle) && e.offsetParent !== null);
    if (!hit) return 'MISS';
    hit.scrollIntoView({block:'center'});
    hit.click();
    return 'OK';
  })()`);
  console.log(`  click ${needle} -> ${r}`);
  return r;
}

async function clickSel(sel, idx = 0) {
  const r = await evaluate(`(() => {
    const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.offsetParent!==null);
    const e=els[${idx}]; if(!e) return 'MISS'; e.click(); return 'OK';
  })()`);
  console.log(`  click ${sel}[${idx}] -> ${r}`);
  return r;
}

const facts = {};
async function record(key, expr) {
  try {
    facts[key] = await evaluate(expr);
  } catch (e) {
    facts[key] = "ERR " + e.message;
  }
}

// ---------- inventory of interactive elements per screen ----------
const INVENTORY = `(() => {
  const vis = e => e.offsetParent !== null;
  const btns = [...document.querySelectorAll('button')].filter(vis).map(b => ({
    t: (b.textContent||'').trim().slice(0,40),
    title: b.title||'',
    aria: b.getAttribute('aria-label')||'',
    disabled: b.disabled,
    // a button with no onclick React handler still has React props; approximate
    // "dead" by: no text change capability is unknowable, so we just report.
  }));
  const inputs = [...document.querySelectorAll('input,textarea,select')].filter(vis).map(i => ({
    tag:i.tagName, type:i.type||'', ph:i.placeholder||'', val:String(i.value||'').slice(0,30), disabled:i.disabled
  }));
  return JSON.stringify({
    heading: (document.querySelector('h1,h2')||{}).textContent||'',
    buttons: btns, inputs,
    buttonCount: btns.length, inputCount: inputs.length,
    textLen: document.body.innerText.length,
    text: document.body.innerText.slice(0, 3000)
  });
})()`;

async function screen(name, opener) {
  console.log("== " + name);
  if (opener) await opener();
  await sleep(700);
  await shot(name);
  await record(name, INVENTORY);
}

// 1. workbench chat (current)
await screen("10-workbench-chat");

// 2. settings
await screen("11-settings", async () => {
  await clickText("设置");
});

// scroll settings through its full height, capturing sections
const settingsScroll = await evaluate(`(() => {
  const sc=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+40 && getComputedStyle(e).overflowY!=='visible');
  return sc ? JSON.stringify({sh:sc.scrollHeight, ch:sc.clientHeight, cls:(sc.className||'').toString().slice(0,80)}) : 'none';
})()`);
console.log("  settings scroller: " + settingsScroll);
for (let i = 1; i <= 5; i++) {
  const more = await evaluate(`(() => {
    const sc=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+40 && getComputedStyle(e).overflowY!=='visible');
    if(!sc) return false;
    const before=sc.scrollTop; sc.scrollTop = before + sc.clientHeight*0.9;
    return sc.scrollTop > before;
  })()`);
  if (!more) break;
  await sleep(500);
  await shot(`11-settings-scroll${i}`);
}
await record("11-settings-full", `(() => JSON.stringify({text: document.body.innerText}))()`);

// 3. skills
await screen("12-skills", async () => {
  await clickText("技能");
});

// 4. artifacts
await screen("13-artifacts", async () => {
  await clickText("成果");
});

// 5. global search (top bar magnifier)
await screen("14-search", async () => {
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/搜索|search/i.test(x.title+x.getAttribute('aria-label')));
    if(b) { b.click(); return 'byTitle'; }
    return 'MISS';
  })()`);
});

// 6. notifications
await screen("15-notifications", async () => {
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/通知|铃|notification/i.test(x.title+x.getAttribute('aria-label')));
    if(b){b.click();return 'ok';} return 'MISS';
  })()`);
});

// 7. file tree toggle
await screen("16-filetree", async () => {
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/文件|file/i.test(x.title+x.getAttribute('aria-label')));
    if(b){b.click();return 'ok';} return 'MISS';
  })()`);
});

// 8. the "..." overflow menu top-right
await screen("17-overflow", async () => {
  await evaluate(`(() => {
    const bs=[...document.querySelectorAll('button')].filter(e=>e.offsetParent);
    const b=bs.find(x=>(x.textContent||'').trim()==='⋯'||(x.textContent||'').trim()==='...'|| /更多|more/i.test(x.title+x.getAttribute('aria-label')));
    if(b){b.click();return 'ok';} return 'MISS';
  })()`);
});

// 9. model picker in input area
await screen("18-modelpicker", async () => {
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/deepseek|模型|权限/.test(x.textContent||''));
    if(b){b.click();return 'ok';} return 'MISS';
  })()`);
});

// 10. buddy mode + history drawer
await screen("19-buddy", async () => {
  await clickText("搭子");
});
await screen("20-buddy-history", async () => {
  await clickSel("button", 0);
});

fs.writeFileSync("docs/research/audit-shots/facts.json", JSON.stringify(facts, null, 1));
console.log("wrote facts.json");
close();
