// Real Electron A2 acceptance. `create` sends one minimal model turn from a
// visible notebook; `verify` runs after restart and proves renderer hydration.
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const phase = process.argv[2] ?? "create";
if (phase !== "create" && phase !== "verify") throw new Error(`Unknown phase: ${phase}`);

const port = process.env.LEEMO_CDP_PORT || "9333";
const notebookId = process.env.LEEMO_A2_NOTEBOOK || "诊断";
const prompt = "只回复：A2 归档验收通过";
let workspaceRoot;
let archiveDir;
const outputDir = path.resolve("docs/research/audit-shots");
const factsPath = path.join(outputDir, "a2-workspace-conversation-facts.json");
fs.mkdirSync(outputDir, { recursive: true });

function archiveRecords() {
  if (!archiveDir) throw new Error("Workspace root has not been resolved from Leemo");
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, record: JSON.parse(fs.readFileSync(path.join(archiveDir, name), "utf8")) }));
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
    }, 90_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(expression, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await evaluate(expression);
    if (result) return result;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for: ${expression.slice(0, 160)}`);
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outputDir, name), Buffer.from(result.data, "base64"));
}

await send("Runtime.enable");
await send("Page.enable");
workspaceRoot = await evaluate(`(async () => {
  const result = await window.leemoWorkspace.invoke('listNotebooks', undefined);
  if (!result?.ok) throw new Error(result?.error || 'listNotebooks failed');
  return result.response.root;
})()`);
if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) throw new Error(`Leemo returned an invalid workspace root: ${workspaceRoot}`);
archiveDir = path.join(workspaceRoot, notebookId, ".leemo", "conversations");
const facts = fs.existsSync(factsPath) ? JSON.parse(fs.readFileSync(factsPath, "utf8")) : {};

if (phase === "create") {
  const before = new Set(archiveRecords().map((entry) => entry.name));
  const selected = await evaluate(`(() => {
    const row = document.querySelector('[data-testid=${JSON.stringify(`notebook-row-${notebookId}`)}]');
    if (!row) return { ok: false, reason: 'missing notebook row' };
    if (row.getAttribute('aria-pressed') !== 'true') row.click();
    return { ok: true, selected: row.getAttribute('aria-pressed') === 'true' };
  })()`);
  if (!selected.ok) throw new Error(selected.reason);
  await sleep(250);

  const created = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="新建对话"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!created) throw new Error("Missing new conversation button");
  await sleep(350);

  const typed = await evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="输入消息"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, ${JSON.stringify(prompt)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!typed) throw new Error("Missing message composer");
  await waitFor(`(() => !document.querySelector('button[aria-label="发送"]')?.disabled)()`);
  await evaluate(`document.querySelector('button[aria-label="发送"]').click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 15_000);
  await waitFor(`!document.querySelector('button[aria-label="停止"]')`, 90_000);
  await sleep(800);

  const after = archiveRecords();
  const added = after.filter((entry) => !before.has(entry.name));
  if (added.length !== 1) throw new Error(`Expected one new notebook record, found ${added.length}`);
  const { name, record } = added[0];
  const texts = record.timeline.filter((item) => item.kind === "text").map((item) => ({ role: item.role, text: item.text }));
  const result = record.timeline.findLast((item) => item.kind === "result");
  if (record.meta.bookId !== notebookId || !texts.some((item) => item.role === "user" && item.text === prompt)) {
    throw new Error(`Wrong portable record: ${JSON.stringify({ bookId: record.meta.bookId, texts })}`);
  }
  await capture("a2-notebook-conversation-created.png");
  facts.create = {
    notebookId,
    archive: path.join(notebookId, ".leemo", "conversations", name),
    conversationId: record.meta.id,
    sessionPersisted: typeof record.meta.sessionId === "string" && record.meta.sessionId.length > 0,
    textMessages: texts,
    result: result ? { interrupted: result.interrupted, isError: result.isError } : null,
    timelineItems: record.timeline.length,
    at: new Date().toISOString(),
  };
} else {
  const conversationId = facts.create?.conversationId;
  if (!conversationId) throw new Error("Run create phase first");
  const record = archiveRecords().find((entry) => entry.record.meta.id === conversationId);
  if (!record) throw new Error(`Missing portable conversation after restart: ${conversationId}`);
  const visible = await waitFor(`(() => {
    const body = document.body.innerText;
    return body.includes(${JSON.stringify(prompt)}) ? { prompt: true, title: body.includes('A2 归档验收') } : false;
  })()`, 30_000);
  await capture("a2-notebook-conversation-after-restart.png");
  facts.verify = {
    notebookId,
    conversationId,
    portableRecordPresent: true,
    visibleAfterRestart: visible,
    at: new Date().toISOString(),
  };
}

fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`);
console.log(JSON.stringify(facts[phase], null, 2));
socket.close();
