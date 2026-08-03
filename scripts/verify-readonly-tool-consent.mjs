// Real Electron UX acceptance: enabled built-in read-only tools execute as part
// of the user's request without asking for the same consent again. The prompt
// requests repeated WebSearch calls so this catches both first-use and repeat
// approval regressions while preserving approval for mutating/external tools.
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const port = process.env.LEEMO_CDP_PORT || "9333";
const workspaceRoot = path.join(process.env.USERPROFILE || process.env.HOME || "", "Leemo");
const outputDir = path.resolve(process.env.LEEMO_VERIFY_OUTPUT_DIR || "dist-verify/audit-shots");
const a2Facts = JSON.parse(fs.readFileSync(path.join(outputDir, "a2-workspace-conversation-facts.json"), "utf8"));
const conversationId = a2Facts.create.conversationId;
const prompts = [
  "联网权限体验验收第一轮：必须重新调用 WebSearch 查询今天东京的日落时间，只回复时间和来源。",
  "联网权限体验验收第二轮：必须重新调用 WebSearch 查询今天广州的空气质量，只回复等级和来源。",
];

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
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(expression, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${expression.slice(0, 140)}`);
}

await send("Runtime.enable");
await send("Page.enable");

// Old builds could persist a redundant permanent allow for read-only web tools.
// Remove only those obsolete entries so the UI run proves the policy itself.
const whitelistBefore = await evaluate(`window.leemoBridge.invoke('bridge:listWhitelist', undefined)`);
for (const entry of whitelistBefore.response ?? []) {
  if (entry.risk === "safe" && (entry.toolName === "WebSearch" || entry.toolName === "WebFetch")) {
    const response = await evaluate(`window.leemoBridge.invoke('bridge:revokeWhitelist', ${JSON.stringify(entry)})`);
    if (!response.ok) throw new Error(`Could not remove obsolete whitelist entry: ${JSON.stringify(response)}`);
  }
}
const whitelistAfterCleanup = await evaluate(`window.leemoBridge.invoke('bridge:listWhitelist', undefined)`);

await evaluate(`(() => {
  window.__leemoReadonlyConsentAudit = [];
  const scan = () => {
    const buttons = [...document.querySelectorAll('button')];
    for (const button of buttons) {
      if (!/^允许/.test(button.textContent?.trim() || '')) continue;
      let container = button;
      for (let i = 0; i < 5 && container?.parentElement; i += 1) container = container.parentElement;
      const text = container?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      if (!/momo 想/.test(text)) continue;
      const signature = text.slice(0, 240);
      if (!window.__leemoReadonlyConsentAudit.some((item) => item.signature === signature)) {
        window.__leemoReadonlyConsentAudit.push({ at: Date.now(), signature });
      }
    }
  };
  window.__leemoReadonlyConsentObserver?.disconnect();
  window.__leemoReadonlyConsentObserver = new MutationObserver(scan);
  window.__leemoReadonlyConsentObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scan();
  return true;
})()`);

async function runPrompt(prompt) {
  const before = findRecord().record.timeline.length;
  await evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="输入消息"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, ${JSON.stringify(prompt)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`!document.querySelector('button[aria-label="发送"]')?.disabled`);
  await evaluate(`document.querySelector('button[aria-label="发送"]').click()`);
  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 15_000);
  await waitFor(`!document.querySelector('button[aria-label="停止"]')`);
  await sleep(700);

  const record = findRecord().record;
  const appended = record.timeline.slice(before);
  const user = appended.find((item) => item.kind === "text" && item.role === "user" && item.text === prompt);
  if (!user) throw new Error(`Acceptance prompt was not persisted: ${prompt}`);
  const runItems = appended.filter((item) => item.kind === "compact" || item.runId === user.runId);
  const tools = runItems
    .filter((item) => item.kind === "tool")
    .map((item) => ({ name: item.name, status: item.status, summary: item.summary }));
  return {
    runId: user.runId,
    prompt,
    tools,
    approvals: runItems.filter((item) => item.kind === "approval"),
    replies: runItems.filter((item) => item.kind === "text" && item.role === "momo").map((item) => item.text),
  };
}

const rounds = [];
for (const prompt of prompts) rounds.push(await runPrompt(prompt));

const approvalUiEvents = await evaluate(`(() => {
  window.__leemoReadonlyConsentObserver?.disconnect();
  return window.__leemoReadonlyConsentAudit ?? [];
})()`);
const approvals = rounds.flatMap((round) => round.approvals);
const webSearches = rounds.flatMap((round) => round.tools.filter((tool) => /WebSearch|web_search/i.test(tool.name)));
const whitelistAfter = await evaluate(`window.leemoBridge.invoke('bridge:listWhitelist', undefined)`);

if (approvalUiEvents.length > 0 || approvals.length > 0) {
  throw new Error(`Read-only tools still requested approval: ${JSON.stringify({ approvalUiEvents, approvals })}`);
}
if (webSearches.length < prompts.length || webSearches.some((tool) => tool.status !== "ok")) {
  throw new Error(`Repeated WebSearch did not execute successfully: ${JSON.stringify(rounds)}`);
}
if ((whitelistAfter.response ?? []).some((entry) => entry.toolName === "WebSearch" || entry.toolName === "WebFetch")) {
  throw new Error(`Read-only tools unexpectedly wrote whitelist entries: ${JSON.stringify(whitelistAfter.response)}`);
}

const screenshot = await send("Page.captureScreenshot", { format: "png" });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "readonly-tools-no-repeat-consent.png"), Buffer.from(screenshot.data, "base64"));
const facts = {
  conversationId,
  rounds,
  webSearchCalls: webSearches.length,
  approvalUiEvents,
  archivedApprovalEvents: approvals,
  whitelistBefore: whitelistBefore.response ?? [],
  whitelistAfterCleanup: whitelistAfterCleanup.response ?? [],
  whitelistAfter: whitelistAfter.response ?? [],
  at: new Date().toISOString(),
};
fs.writeFileSync(path.join(outputDir, "readonly-tools-no-repeat-consent-facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
console.log(JSON.stringify(facts, null, 2));
socket.close();
