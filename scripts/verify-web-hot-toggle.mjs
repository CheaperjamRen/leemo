// Real Electron A3/B1 acceptance: turn web off for one round, then on for the
// next round of the SAME live host conversation and inspect durable tool traces.
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const port = process.env.LEEMO_CDP_PORT || "9333";
const workspaceRoot = path.join(process.env.USERPROFILE || process.env.HOME || "", "Leemo");
const outputDir = path.resolve(process.env.LEEMO_VERIFY_OUTPUT_DIR || "dist-verify/audit-shots");
const a2Facts = JSON.parse(fs.readFileSync(path.join(outputDir, "a2-workspace-conversation-facts.json"), "utf8"));
const conversationId = a2Facts.create.conversationId;
const offPrompt = "联网验收第一步：现在不要猜，请说明你当前是否能使用联网搜索。";
const onPrompt = "联网验收第二步：请务必使用联网搜索，查询今天北京的天气，并用一句话回答。";

function findRecord() {
  const candidates = [path.join(workspaceRoot, ".leemo", "conversations")];
  for (const entry of fs.readdirSync(workspaceRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      candidates.push(path.join(workspaceRoot, entry.name, ".leemo", "conversations"));
    }
  }
  for (const directory of candidates) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).filter((item) => item.endsWith(".json"))) {
      const file = path.join(directory, name);
      const record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (record.meta.id === conversationId) return { file, record };
    }
  }
  throw new Error(`Missing conversation archive: ${conversationId}`);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
if (!page) throw new Error(`No Electron renderer target on CDP port ${port}`);
const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

let nextId = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 120_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(expression, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${expression.slice(0, 140)}`);
}
async function capture(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(shot.data, "base64"));
}

async function setWebEnabled(enabled) {
  await evaluate(`(() => {
    if (!document.querySelector('[data-testid="settings-window"]')) {
      const button = [...document.querySelectorAll('button')].find((item) => item.title === '设置' || item.getAttribute('aria-label') === '设置');
      button?.click();
    }
    return true;
  })()`);
  await waitFor(`Boolean(document.querySelector('[data-testid="settings-window"]'))`);
  await evaluate(`(() => {
    const search = document.querySelector('input[aria-label="搜索设置"]');
    if (search?.value) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  })()`);
  await sleep(100);
  await evaluate(`(() => {
    const tab = document.querySelector('[role="tab"][aria-label="连接器"]');
    tab?.click();
    return Boolean(tab);
  })()`);
  const desired = Boolean(enabled);
  await waitFor(`Boolean(document.querySelector('input[aria-label="允许联网"]'))`);
  await evaluate(`(() => {
    const checkbox = document.querySelector('input[aria-label="允许联网"]');
    if (checkbox.checked !== ${JSON.stringify(desired)}) checkbox.click();
    return checkbox.checked;
  })()`);
  await waitFor(`document.querySelector('input[aria-label="允许联网"]')?.checked === ${JSON.stringify(desired)}`);
  await sleep(800);
  const hint = await evaluate(`document.querySelector('[data-testid="context-hint"]')?.textContent?.trim() || null`);
  await evaluate(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
  await waitFor(`!document.querySelector('[data-testid="settings-window"]')`);
  return hint;
}

async function sendRound(prompt) {
  const before = findRecord().record.timeline.length;
  await evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="输入消息"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, ${JSON.stringify(prompt)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`(() => !document.querySelector('button[aria-label="发送"]')?.disabled)()`);
  await evaluate(`document.querySelector('button[aria-label="发送"]').click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 15_000);
  await waitFor(`!document.querySelector('button[aria-label="停止"]')`);
  await sleep(900);
  const record = findRecord().record;
  const appended = record.timeline.slice(before);
  const user = appended.find((item) => item.kind === "text" && item.role === "user" && item.text === prompt);
  if (!user) throw new Error(`Round was not persisted: ${prompt}`);
  const runItems = appended.filter((item) => item.kind === "compact" || item.runId === user.runId);
  return {
    runId: user.runId,
    tools: runItems.filter((item) => item.kind === "tool").map((item) => ({ name: item.name, status: item.status, summary: item.summary })),
    replies: runItems.filter((item) => item.kind === "text" && item.role === "momo").map((item) => item.text),
    result: runItems.findLast((item) => item.kind === "result") ?? null,
  };
}

await send("Runtime.enable");
await send("Page.enable");
const offHint = await setWebEnabled(false);
const off = await sendRound(offPrompt);
const onHint = await setWebEnabled(true);
const on = await sendRound(onPrompt);
await capture("a3-web-hot-toggle.png");

const offUsedWeb = off.tools.some((tool) => /websearch|web_search/i.test(tool.name));
const onWebTools = on.tools.filter((tool) => /websearch|web_search/i.test(tool.name));
if (offUsedWeb) throw new Error(`Web search ran while disabled: ${JSON.stringify(off.tools)}`);
if (onWebTools.length === 0 || onWebTools.some((tool) => tool.status !== "ok")) {
  throw new Error(`Web search did not recover after enabling: ${JSON.stringify(on)}`);
}

const facts = {
  conversationId,
  off: { hint: offHint, ...off },
  on: { hint: onHint, ...on },
  settingRestored: true,
  at: new Date().toISOString(),
};
fs.writeFileSync(path.join(outputDir, "a3-web-hot-toggle-facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
console.log(JSON.stringify(facts, null, 2));
socket.close();
