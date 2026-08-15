// Visible momo identity + governed-memory acceptance.
//
// Usage: LEEMO_DEBUG_PORT=9222 npm run electron:dev  (another terminal)
//        node scripts/cdp-momo-verify.mjs
//
// This script deliberately does not seed CLAUDE.md or any memory file. It asks
// through the composer, observes the lightweight receipt, then starts a fresh
// conversation and verifies recall. Exit code 0=PASS / 3=FAIL.

import fs from "node:fs";
import WebSocket from "ws";

const CDP = `http://127.0.0.1:${process.env.LEEMO_DEBUG_PORT ?? 9222}`;
const FACT = "我的猫叫拿铁，领养纪念日是 4 月 17 日";
const REMEMBER_PROMPT = `请长期记住这件事：${FACT}。记好后简短回复。`;
const RECALL_PROMPT = "你是谁？我养的猫叫什么，领养纪念日是哪天？请直接回答。";
const SCREENSHOT = "docs/sdd/evidence-momo-memory.png";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connect() {
  const targets = await (await fetch(`${CDP}/json`)).json();
  const page = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
  if (!page) throw new Error("找不到 renderer target（electron:dev 起了吗？）");
  const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  let nextId = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result.value;
  };
  const screenshot = async (target) => {
    const response = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(target, Buffer.from(response.data, "base64"));
  };
  await send("Runtime.enable");
  await send("Page.enable");
  return { evaluate, screenshot, close: () => socket.close() };
}

async function newConversation(evaluate) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.offsetParent !== null && item.getAttribute('aria-label') === '新建对话');
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error("找不到新建对话按钮");
  await sleep(300);
}

async function submit(evaluate, prompt) {
  const typed = await evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="输入消息"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, ${JSON.stringify(prompt)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!typed) throw new Error("输入框不可用");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const sent = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="发送"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (sent) return;
    await sleep(100);
  }
  throw new Error("发送按钮不可用");
}

async function waitForRun(evaluate, prompt, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    await evaluate(`(() => {
      const approvals = [...document.querySelectorAll('button')]
        .filter((item) => item.offsetParent !== null && item.textContent?.trim() === '允许一次');
      approvals.forEach((item) => item.click());
      return approvals.length;
    })()`);
    const outcome = await evaluate(`(async () => {
      const snapshot = await window.leemoPersist.invoke('loadAll', undefined);
      const conversation = snapshot?.response?.conversations?.find((candidate) =>
        candidate.timeline?.some((item) => item.kind === 'text' && item.role === 'user' && item.text === ${JSON.stringify(prompt)})
      );
      if (!conversation) return null;
      const result = conversation.timeline.findLast((item) => item.kind === 'result');
      if (!result) return null;
      const reply = conversation.timeline
        .filter((item) => item.kind === 'text' && item.role === 'momo')
        .map((item) => item.text)
        .join('');
      return { isError: result.isError, interrupted: result.interrupted, reply };
    })()`);
    if (outcome) return outcome;
  }
  throw new Error(`等待回合完成超时：${prompt}`);
}

const { evaluate, screenshot, close } = await connect();
try {
  await newConversation(evaluate);
  await submit(evaluate, REMEMBER_PROMPT);
  const remembered = await waitForRun(evaluate, REMEMBER_PROMPT);
  const receipt = await evaluate(`(() => {
    const receipts = [...document.querySelectorAll('[data-memory-receipt]')].filter((item) => item.offsetParent !== null);
    return receipts.at(-1)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  })()`);
  const ledger = await evaluate(`(async () => {
    const response = await window.leemoBridge.invoke('bridge:listMemory', { scopes: [{ type: 'global' }] });
    return response?.response ?? [];
  })()`);

  await newConversation(evaluate);
  await submit(evaluate, RECALL_PROMPT);
  const recalled = await waitForRun(evaluate, RECALL_PROMPT);
  await screenshot(SCREENSHOT);

  const reply = recalled.reply ?? "";
  const facts = {
    rememberRunFinished: !remembered.isError && !remembered.interrupted,
    receiptVisible: receipt.includes("记住了：") && receipt.includes("拿铁"),
    governedRecordPresent: Array.isArray(ledger) && ledger.some((record) => record.statement?.includes("拿铁")),
    recalledName: reply.includes("拿铁"),
    recalledDate: /4\s*月\s*17\s*日/.test(reply),
    selfIdentifiesAsMomo: /momo|默默/i.test(reply),
    claimsClaude: /(我(就)?是|我叫|I am|I'?m)\s*Claude/i.test(reply),
    screenshot: SCREENSHOT,
  };
  console.log(JSON.stringify(facts, null, 2));
  const pass = Object.entries(facts)
    .filter(([key]) => !["claimsClaude", "screenshot"].includes(key))
    .every(([, value]) => value === true)
    && facts.claimsClaude === false;
  console.log(pass ? "PASS" : "FAIL");
  process.exitCode = pass ? 0 : 3;
} finally {
  close();
}
