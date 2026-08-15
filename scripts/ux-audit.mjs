// UX audit driver — attaches CDP to a running Leemo Electron renderer,
// takes screenshots and probes DOM/UX facts. Read-only: never mutates user data
// beyond typing into the app like a user would (which is the point).
//
// Usage:
//   node scripts/ux-audit.mjs shot <outfile.png> [--full] [--viewport=<w>x<h>]
//   node scripts/ux-audit.mjs eval "<js expression>"
//   node scripts/ux-audit.mjs click "<css selector>" | "text=<substring>"
//   node scripts/ux-audit.mjs type "<css selector>" "<text>"
//   node scripts/ux-audit.mjs keys "<key>"          # Enter / Escape / etc
import fs from "node:fs";
import WebSocket from "ws";

const PORT = process.env.LEEMO_CDP_PORT || "9222";

async function target() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  if (!page) throw new Error("no renderer page found");
  return page;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const waiter = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(waiter.timer);
        msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + (r.exceptionDetails.exception?.description || ""));
    return r.result.value;
  }
}

async function connect() {
  const t = await target();
  const ws = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return { cdp, ws };
}

const [cmd, ...args] = process.argv.slice(2);

const { cdp, ws } = await connect();

try {
  if (cmd === "shot") {
    const out = args[0] || "shot.png";
    const full = args.includes("--full");
    const viewportArg = args.find((arg) => arg.startsWith("--viewport="));
    if (viewportArg) {
      const match = /^--viewport=(\d+)x(\d+)$/.exec(viewportArg);
      if (!match) throw new Error("viewport must use --viewport=<width>x<height>");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: Number(match[1]),
        height: Number(match[2]),
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const params = { format: "png", captureBeyondViewport: full };
    const r = await cdp.send("Page.captureScreenshot", params);
    fs.writeFileSync(out, Buffer.from(r.data, "base64"));
    console.log("wrote " + out);
  } else if (cmd === "eval") {
    const v = await cdp.evaluate(args.join(" "));
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  } else if (cmd === "click") {
    const sel = args[0];
    const v = await cdp.evaluate(`(() => {
      const sel = ${JSON.stringify(sel)};
      let el;
      if (sel.startsWith('text=')) {
        const needle = sel.slice(5);
        const all = [...document.querySelectorAll('button,a,[role=button],li,div,span,label')];
        el = all.reverse().find(e => (e.textContent||'').trim().includes(needle) && e.offsetParent !== null);
      } else el = document.querySelector(sel);
      if (!el) return 'NOT_FOUND';
      el.scrollIntoView({block:'center'});
      el.click();
      return 'clicked: ' + (el.tagName + ' ' + (el.className||'')).slice(0,120);
    })()`);
    console.log(v);
  } else if (cmd === "type") {
    const [sel, ...rest] = args;
    const text = rest.join(" ");
    const v = await cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'NOT_FOUND';
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype,'value')?.set;
      setter ? setter.call(el, ${JSON.stringify(text)}) : (el.value = ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      return 'typed into ' + el.tagName;
    })()`);
    console.log(v);
  } else if (cmd === "keys") {
    const key = args[0];
    const map = {
      Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
      Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    };
    const k = map[key] || { key, code: key };
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...k });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
    console.log("key " + key);
  } else {
    console.log("unknown cmd");
  }
} finally {
  try {
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  } finally {
    ws.close();
  }
}
