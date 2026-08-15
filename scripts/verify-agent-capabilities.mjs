// Real Electron acceptance for Claude Code capabilities exposed through Leemo.
// Runs complete user journeys instead of probing SDK pieces in isolation.
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const port = process.env.LEEMO_CDP_PORT || "9333";
const notebookId = process.env.LEEMO_CAPABILITY_NOTEBOOK || "诊断";
const workspaceRoot = path.join(process.env.USERPROFILE || process.env.HOME || "", "Leemo");
const notebookRoot = path.join(workspaceRoot, notebookId);
const archiveDir = path.join(notebookRoot, ".leemo", "conversations");
const fixtureRoot = path.join(notebookRoot, "leemo-tool-matrix");
const mcpFixturePath = path.resolve("tests/fixtures/mcp-stdio-server.mjs");
const customMcpName = "Echo Acceptance 7413";
const customMcpId = "echo-acceptance-7413";
const outputDir = path.resolve("docs/research/audit-shots");
const attachmentImagePath = path.join(outputDir, "custom-mcp-connected.png");
const factsPath = path.join(outputDir, "agent-capabilities-facts.json");
const resumeConversationId = process.env.LEEMO_CAPABILITY_CONVERSATION || "";
const reuseVerifiedRounds = process.env.LEEMO_CAPABILITY_REUSE_ROUNDS === "1";
const attachmentOnly = process.env.LEEMO_CAPABILITY_ATTACHMENT_ONLY === "1";
const planOnly = process.env.LEEMO_CAPABILITY_PLAN_ONLY === "1";
const planCaptureOnly = process.env.LEEMO_CAPABILITY_PLAN_CAPTURE_ONLY === "1";
const planTargetName = "leemo-plan-mode-acceptance-7413.txt";
const planTargetPath = path.join(notebookRoot, planTargetName);
fs.mkdirSync(outputDir, { recursive: true });

const setupPrompt = `这是 Leemo 原生工具验收。请在当前本子中新建 leemo-tool-matrix 目录，并且只使用 Write 工具创建以下 5 个文件，不要使用 PowerShell：
1. package.json：type=module，test 脚本为 node --test；
2. src/cart.js：导出 total(items)，故意写成只累加 price、不乘 quantity，并加注释 BUG_MARKER；
3. test/cart.test.js：用 node:test 断言 [{price:10,quantity:2},{price:5,quantity:1}] 的 total 等于 25；
4. notes.md：写“验收暗号 capability-7413”；
5. analysis.ipynb：合法的 nbformat 4 notebook，只有一个 markdown 单元格“待更新”。
创建完成后只简短汇报文件数量。`;

const codingPrompt = `请修复 leemo-tool-matrix，并严格按用户路径真实调用这些工具：
- Glob 列出目录文件；Grep 搜索 BUG_MARKER 和 capability-7413；Read 阅读实现与测试；
- TodoWrite 建立至少 3 步计划；
- Edit 修复 src/cart.js，不能用 Write 覆盖这个已有文件；
- NotebookEdit 把 analysis.ipynb 的 markdown 单元格改成“Leemo NotebookEdit 验收通过”；
- PowerShell 进入该目录执行 npm test；如果首次失败就读报错继续修到通过；
- 最后用 Write 新建 RESULT.md，写入测试通过与暗号。
不要跳过任何指定工具，完成后汇报测试结果。`;

const subagentPrompt = `必须使用 Task/Agent 工具派一个子 agent 独立检查 leemo-tool-matrix：读取 RESULT.md 和 package.json，并核对共有几个业务文件。子 agent 完成后汇总它的结论；不要自己替代子 agent。`;

const browserPrompt = `这是联网与浏览器用户路径验收：先必须使用 WebFetch 读取 https://example.com 并确认标题；再必须使用 Playwright MCP 的 browser_navigate 打开同一网址、browser_snapshot 读取页面、browser_take_screenshot 截图。最后告诉我标题和截图是否成功。`;
const taskPlanPrompt = `为了验证新版任务进度卡，请使用 TaskCreate 新建“核对测试结果”和“核对验收暗号”两项任务，再用 TaskUpdate 将两项依次设为进行中和已完成。必须真实调用工具，最后只回复“计划卡验收完成”。`;
const customMcpPrompt = `必须调用已启用的 ${customMcpName} MCP 的 echo 工具，把 mcp-echo-7413 原样传入 text；不要用其他工具代替。成功后只回复 echo 返回的内容。`;
const attachmentPrompt = `请查看我附上的图片，必须使用 Read 工具读取图片。图中设置页左侧当前高亮的标签是什么？只回答标签文字。`;
const planPrompt = `请直接在当前本子根目录创建 ${planTargetName}，内容写“plan-mode-7413”，并在完成后告诉我文件路径。`;

function archiveRecords() {
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, file: path.join(archiveDir, name), record: JSON.parse(fs.readFileSync(path.join(archiveDir, name), "utf8")) }));
}

function findRecord(conversationId) {
  const found = archiveRecords().find((entry) => entry.record.meta.id === conversationId);
  if (!found) throw new Error(`Missing notebook conversation archive: ${conversationId}`);
  return found;
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
    }, 180_000);
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
async function waitFor(expression, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(180);
  }
  throw new Error(`Timed out waiting for ${expression.slice(0, 160)}`);
}

async function typeAndSend(prompt) {
  const typed = await evaluate(`(() => {
    const field = document.querySelector('textarea[aria-label="输入消息"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(field, ${JSON.stringify(prompt)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!typed) throw new Error("Missing message composer");
  await waitFor(`!document.querySelector('button[aria-label="发送"]')?.disabled`);
  await evaluate(`document.querySelector('button[aria-label="发送"]').click()`);
}

async function setFieldValue(ariaLabel, value) {
  const changed = await evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(`[aria-label="${ariaLabel}"]`)});
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(field, ${JSON.stringify(value)});
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Missing field: ${ariaLabel}`);
}

async function openSettingsTab(label) {
  const opened = await evaluate(`(() => {
    if (!document.querySelector('[data-testid="settings-overlay"]')) {
      const button = [...document.querySelectorAll('button')].find((item) =>
        item.offsetParent !== null && (item.title === '设置' || item.getAttribute('aria-label') === '设置'));
      button?.click();
    }
    return true;
  })()`);
  if (!opened) throw new Error("Could not open settings");
  await waitFor(`Boolean(document.querySelector('[data-testid="settings-overlay"]'))`);
  const selected = await evaluate(`(() => {
    const tab = document.querySelector(${JSON.stringify(`#settings-tab-${label}`)});
    tab?.click();
    return Boolean(tab);
  })()`);
  if (!selected) throw new Error(`Missing settings tab: ${label}`);
}

async function closeSettings() {
  await evaluate(`document.querySelector('button[aria-label="关闭设置"]')?.click()`);
  await waitFor(`!document.querySelector('[data-testid="settings-overlay"]')`);
}

async function setPermissionMode(mode) {
  await openSettingsTab("permissions");
  const selected = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(`input[name="permissionMode"][value="${mode}"]`)});
    if (!(input instanceof HTMLInputElement)) return false;
    if (!input.checked) input.click();
    return input.checked;
  })()`);
  if (!selected) throw new Error(`Could not select permission mode: ${mode}`);
  await waitFor(`document.querySelector(${JSON.stringify(`input[name="permissionMode"][value="${mode}"]`)})?.checked === true`);
  // Settings persistence and bridge:updateContext are deliberately immediate,
  // but give both IPC writes one event-loop turn before creating the test chat.
  await sleep(350);
  await closeSettings();
}

async function clickMcpRowAction(serverName, action) {
  const clicked = await evaluate(`(() => {
    const label = [...document.querySelectorAll('span')].find((item) =>
      item.textContent?.trim() === ${JSON.stringify(serverName)});
    let row = label;
    while (row && ![...row.querySelectorAll('button')].some((button) =>
      button.textContent?.trim() === ${JSON.stringify(action)})) row = row.parentElement;
    const button = row && [...row.querySelectorAll('button')].find((item) =>
      item.offsetParent !== null && item.textContent?.trim() === ${JSON.stringify(action)});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Missing MCP action ${action} for ${serverName}`);
}

async function captureScreenshot(filename) {
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outputDir, filename), Buffer.from(screenshot.data, "base64"));
}

async function removeCustomMcpIfPresent() {
  const rowExistsExpression = `[...document.querySelectorAll('#settings-mcp span')].some((item) => item.textContent?.trim() === ${JSON.stringify(customMcpName)})`;
  const exists = await evaluate(rowExistsExpression);
  if (!exists) return false;
  await clickMcpRowAction(customMcpName, "删除");
  await clickMcpRowAction(customMcpName, "确认");
  await waitFor(`!(${rowExistsExpression})`);
  return true;
}

async function configureAndProbeCustomMcp() {
  await openSettingsTab("connectors");
  await removeCustomMcpIfPresent();
  const add = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.offsetParent !== null && item.textContent?.trim() === '添加 MCP');
    button?.click();
    return Boolean(button);
  })()`);
  if (!add) throw new Error("Missing Add MCP button");
  await waitFor(`Boolean(document.querySelector('[data-testid="mcp-server-form"]'))`);
  await setFieldValue("MCP 名称", customMcpName);
  await setFieldValue("MCP 说明", "Leemo 自定义 MCP 用户路径验收");
  await setFieldValue("MCP 启动命令", process.execPath);
  await setFieldValue("MCP 参数", mcpFixturePath);
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.offsetParent !== null && item.textContent?.trim() === '保存 MCP');
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(`document.body.innerText.includes(${JSON.stringify(customMcpName)}) && !document.querySelector('[data-testid="mcp-server-form"]')`);
  await clickMcpRowAction(customMcpName, "测试");
  const probeText = await waitFor(`(() => {
    const label = [...document.querySelectorAll('span')].find((item) => item.textContent?.trim() === ${JSON.stringify(customMcpName)});
    let row = label;
    while (row && !row.textContent?.includes('已连接')) row = row.parentElement;
    return row?.textContent?.includes('已连接 · 1 个工具') ? row.textContent.replace(/\\s+/g, ' ').trim() : '';
  })()`);
  await captureScreenshot("custom-mcp-connected.png");
  await closeSettings();
  return probeText;
}

async function finishRoundWithApprovals() {
  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 15_000);
  const approvals = [];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const running = Boolean(document.querySelector('button[aria-label="停止"]'));
      const buttons = [...document.querySelectorAll('button')].filter((item) => item.offsetParent !== null);
      const scoped = buttons.find((item) => item.textContent?.trim().startsWith('本对话允许'));
      const once = buttons.find((item) => item.textContent?.trim() === '允许一次');
      const target = scoped || once;
      if (!target) return { running, clicked: null };
      let card = target;
      for (let i = 0; i < 4 && card?.parentElement; i += 1) card = card.parentElement;
      const text = card?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 320) || '';
      target.click();
      return { running, clicked: { scope: scoped ? 'conversation' : 'once', text } };
    })()`);
    if (state.clicked && !approvals.some((item) => item.text === state.clicked.text)) approvals.push(state.clicked);
    if (!state.running) return approvals;
    await sleep(180);
  }
  throw new Error("Round stayed running for more than 180 seconds");
}

async function finishPlanRoundWithoutGrantingExecution() {
  await waitFor(`Boolean(document.querySelector('button[aria-label="停止"]'))`, 15_000);
  const deniedApprovals = [];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await evaluate(`(() => {
      const running = Boolean(document.querySelector('button[aria-label="停止"]'));
      const deny = [...document.querySelectorAll('button')].find((item) =>
        item.offsetParent !== null && item.textContent?.trim() === '拒绝');
      if (!deny) return { running, denied: null };
      let card = deny;
      for (let i = 0; i < 4 && card?.parentElement; i += 1) card = card.parentElement;
      const text = card?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 320) || '';
      deny.click();
      return { running, denied: text };
    })()`);
    if (state.denied && !deniedApprovals.includes(state.denied)) deniedApprovals.push(state.denied);
    if (!state.running) return deniedApprovals;
    await sleep(180);
  }
  throw new Error("Plan-mode round stayed running for more than 180 seconds");
}

function summarizeRound(record, before, prompt) {
  const appended = record.timeline.slice(before);
  const user = appended.findLast((item) => item.kind === "text" && item.role === "user" && item.text === prompt);
  if (!user) throw new Error(`Prompt was not persisted: ${prompt.slice(0, 60)}`);
  const items = appended.filter((item) => item.kind === "compact" || item.runId === user.runId);
  return {
    runId: user.runId,
    tools: items.filter((item) => item.kind === "tool").map((item) => ({ name: item.name, status: item.status, summary: item.summary })),
    plans: items.filter((item) => item.kind === "plan"),
    activities: items.filter((item) => item.kind === "activity"),
    approvals: items.filter((item) => item.kind === "approval"),
    replies: items.filter((item) => item.kind === "text" && item.role === "momo").map((item) => item.text),
    usage: items.findLast((item) => item.kind === "usage")?.usage ?? null,
    result: items.findLast((item) => item.kind === "result") ?? null,
  };
}

async function runExistingRound(conversationId, prompt) {
  const before = findRecord(conversationId).record.timeline.length;
  await typeAndSend(prompt);
  const clickedApprovals = await finishRoundWithApprovals();
  await sleep(800);
  return { ...summarizeRound(findRecord(conversationId).record, before, prompt), clickedApprovals };
}

function requireTool(round, pattern, label) {
  const matches = round.tools.filter((tool) => pattern.test(tool.name));
  if (matches.length === 0 || matches.some((tool) => tool.status !== "ok")) {
    throw new Error(`${label} did not complete successfully: ${JSON.stringify(round.tools)}`);
  }
  return matches;
}

async function selectConversationModel(modelId) {
  const opened = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('span')].find((item) =>
      item.offsetParent !== null && item.textContent?.trim().startsWith('🧠 '));
    trigger?.parentElement?.click();
    return Boolean(trigger);
  })()`);
  if (!opened) throw new Error("Missing conversation model picker");
  await waitFor(`[...document.querySelectorAll('button')].some((item) => item.offsetParent !== null && item.textContent?.includes(${JSON.stringify(modelId)}))`);
  const picked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.offsetParent !== null && item.textContent?.includes(${JSON.stringify(modelId)}));
    button?.click();
    return Boolean(button);
  })()`);
  if (!picked) throw new Error(`Missing model option: ${modelId}`);
  await waitFor(`[...document.querySelectorAll('span')].some((item) => item.textContent?.trim() === ${JSON.stringify(`🧠 ${modelId}`)})`);
}

async function attachFile(filePath) {
  const document = await send("DOM.getDocument", { depth: -1, pierce: true });
  const input = await send("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector: 'input[type="file"]',
  });
  if (!input.nodeId) throw new Error("Missing attachment file input");
  await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [filePath] });
  await waitFor(`document.body.innerText.includes(${JSON.stringify(path.basename(filePath))})`);
}

async function runAttachmentAcceptance() {
  if (!fs.existsSync(attachmentImagePath)) throw new Error(`Missing attachment fixture: ${attachmentImagePath}`);
  const beforeArchives = new Set(archiveRecords().map((entry) => entry.name));
  const created = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="新建对话"]');
    button?.click();
    return Boolean(button);
  })()`);
  if (!created) throw new Error("Missing new conversation button");
  await sleep(350);

  await selectConversationModel("qwen3.7-flash");
  await attachFile(attachmentImagePath);
  await typeAndSend(attachmentPrompt);
  const clickedApprovals = await finishRoundWithApprovals();
  await sleep(1_000);

  const added = archiveRecords().filter((entry) => !beforeArchives.has(entry.name));
  const archived = added.find((entry) => entry.record.timeline.some((item) =>
    item.kind === "text" && item.role === "user" && item.text === attachmentPrompt));
  if (!archived) throw new Error(`Attachment conversation archive was not created: ${added.length} candidates`);
  const round = { ...summarizeRound(archived.record, 0, attachmentPrompt), clickedApprovals };
  requireTool(round, /^Read$/, "attachment image Read");
  if (!round.replies.at(-1)?.includes("连接器")) {
    throw new Error(`Vision model did not identify the highlighted tab: ${JSON.stringify(round.replies)}`);
  }
  if (round.usage?.providerId !== "qwen" || round.usage?.modelId !== "qwen3.7-flash") {
    throw new Error(`Attachment round used the wrong provider/model: ${JSON.stringify(round.usage)}`);
  }

  const user = archived.record.timeline.findLast((item) =>
    item.kind === "text" && item.role === "user" && item.text === attachmentPrompt);
  const attachment = user?.attachments?.[0];
  if (!attachment || "path" in attachment || attachment.name !== path.basename(attachmentImagePath)) {
    throw new Error(`Persisted attachment metadata is unsafe or incomplete: ${JSON.stringify(attachment)}`);
  }

  await captureScreenshot("attachment-vision-user-path.png");
  const facts = {
    notebookId,
    conversationId: archived.record.meta.id,
    archive: path.relative(workspaceRoot, archived.file),
    selected: {
      providerId: archived.record.meta.providerId,
      modelId: archived.record.meta.modelId,
    },
    attachment,
    persistedAttachmentPath: false,
    round,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(outputDir, "attachment-vision-facts.json"),
    `${JSON.stringify(facts, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    conversationId: facts.conversationId,
    selected: facts.selected,
    attachment,
    tools: round.tools.map(({ name, status }) => ({ name, status })),
    reply: round.replies.at(-1),
    usage: round.usage,
    approvals: clickedApprovals,
  }, null, 2));
}

async function runPlanModeAcceptance() {
  if (fs.existsSync(planTargetPath)) {
    throw new Error(`Plan-mode sentinel already exists; refusing to hide a prior violation: ${planTargetPath}`);
  }

  let facts;
  let restored = false;
  try {
    await setPermissionMode("plan");
    const beforeArchives = new Set(archiveRecords().map((entry) => entry.name));
    const created = await evaluate(`(() => {
      const button = document.querySelector('button[aria-label="新建对话"]');
      button?.click();
      return Boolean(button);
    })()`);
    if (!created) throw new Error("Missing new conversation button");
    await sleep(350);

    await typeAndSend(planPrompt);
    const deniedApprovals = await finishPlanRoundWithoutGrantingExecution();
    await sleep(1_000);

    const added = archiveRecords().filter((entry) => !beforeArchives.has(entry.name));
    const archived = added.find((entry) => entry.record.timeline.some((item) =>
      item.kind === "text" && item.role === "user" && item.text === planPrompt));
    if (!archived) throw new Error(`Plan-mode conversation archive was not created: ${added.length} candidates`);
    const round = { ...summarizeRound(archived.record, 0, planPrompt), deniedApprovals };
    const successfulMutations = round.tools.filter((tool) =>
      /^(Write|Edit|NotebookEdit|Bash|PowerShell)$/.test(tool.name) && tool.status === "ok");
    if (fs.existsSync(planTargetPath)) {
      throw new Error(`Plan mode wrote the sentinel file: ${planTargetPath}`);
    }
    if (successfulMutations.length > 0) {
      throw new Error(`Plan mode completed mutating tools: ${JSON.stringify(successfulMutations)}`);
    }
    if (round.replies.length === 0 && round.tools.every((tool) => tool.name !== "ExitPlanMode")) {
      throw new Error(`Plan mode produced neither a plan reply nor ExitPlanMode: ${JSON.stringify(round)}`);
    }

    await captureScreenshot("plan-mode-readonly-user-path.png");
    facts = {
      notebookId,
      conversationId: archived.record.meta.id,
      archive: path.relative(workspaceRoot, archived.file),
      permissionMode: "plan",
      requestedFile: planTargetName,
      fileExistsAfterRound: false,
      successfulMutations,
      round,
      at: new Date().toISOString(),
    };
  } finally {
    await setPermissionMode("acceptEdits");
    restored = await evaluate(`(() => {
      const hint = document.body.innerText.includes('下轮起生效');
      return { mode: 'acceptEdits', contextHintVisible: hint };
    })()`);
  }

  facts.restored = restored;
  fs.writeFileSync(
    path.join(outputDir, "plan-mode-readonly-facts.json"),
    `${JSON.stringify(facts, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    conversationId: facts.conversationId,
    fileExistsAfterRound: facts.fileExistsAfterRound,
    tools: facts.round.tools.map(({ name, status }) => ({ name, status })),
    replies: facts.round.replies,
    deniedApprovals: facts.round.deniedApprovals,
    usage: facts.round.usage,
    restored: facts.restored,
  }, null, 2));
}

async function captureExistingPlanModeEvidence() {
  const planFactsPath = path.join(outputDir, "plan-mode-readonly-facts.json");
  if (!fs.existsSync(planFactsPath)) throw new Error(`Missing plan-mode facts: ${planFactsPath}`);
  const facts = JSON.parse(fs.readFileSync(planFactsPath, "utf8"));
  try {
    await setPermissionMode("plan");
    const visible = await waitFor(`Boolean(document.querySelector('button[aria-label="权限模式：计划模式"]'))`);
    if (!visible) throw new Error("Plan-mode footer status did not become visible");
    await captureScreenshot("plan-mode-readonly-user-path.png");
    facts.uiEvidence = {
      permissionLabel: "计划模式",
      actionablePermissionButton: true,
      capturedWithoutModelRound: true,
      at: new Date().toISOString(),
    };
  } finally {
    await setPermissionMode("acceptEdits");
  }
  fs.writeFileSync(planFactsPath, `${JSON.stringify(facts, null, 2)}\n`);
  console.log(JSON.stringify({
    conversationId: facts.conversationId,
    uiEvidence: facts.uiEvidence,
    restored: "acceptEdits",
  }, null, 2));
}

await send("Runtime.enable");
await send("Page.enable");

const selected = await evaluate(`(() => {
  const row = document.querySelector('[data-testid=${JSON.stringify(`notebook-row-${notebookId}`)}]');
  if (!row) return false;
  if (row.getAttribute('aria-pressed') !== 'true') row.click();
  return true;
})()`);
if (!selected) throw new Error(`Missing notebook row: ${notebookId}`);
await sleep(300);
if (attachmentOnly) {
  await runAttachmentAcceptance();
  socket.close();
  process.exit(0);
}
if (planOnly) {
  await runPlanModeAcceptance();
  socket.close();
  process.exit(0);
}
if (planCaptureOnly) {
  await captureExistingPlanModeEvidence();
  socket.close();
  process.exit(0);
}
let conversationId;
let archiveFile;
let setup;
let coding;
let taskPlan = null;

if (resumeConversationId) {
  const archived = findRecord(resumeConversationId);
  conversationId = resumeConversationId;
  archiveFile = archived.file;
  setup = { ...summarizeRound(archived.record, 0, setupPrompt), clickedApprovals: [] };
  coding = { ...summarizeRound(archived.record, 0, codingPrompt), clickedApprovals: [] };
  taskPlan = reuseVerifiedRounds
    ? { ...summarizeRound(archived.record, 0, taskPlanPrompt), clickedApprovals: [] }
    : await runExistingRound(conversationId, taskPlanPrompt);
  if (taskPlan.plans.length === 0 || !taskPlan.plans.some((plan) => plan.todos.length >= 2 && plan.todos.every((todo) => todo.status === "done"))) {
    throw new Error(`TaskCreate/TaskUpdate plan was not rendered: ${JSON.stringify(taskPlan)}`);
  }
} else {
  const beforeArchives = new Set(archiveRecords().map((entry) => entry.name));
  const created = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="新建对话"]');
    button?.click();
    return Boolean(button);
  })()`);
  if (!created) throw new Error("Missing new conversation button");
  await sleep(300);

  await typeAndSend(setupPrompt);
  const setupClickedApprovals = await finishRoundWithApprovals();
  await sleep(900);
  const added = archiveRecords().filter((entry) => !beforeArchives.has(entry.name));
  if (added.length !== 1) throw new Error(`Expected one new capability conversation, found ${added.length}`);
  conversationId = added[0].record.meta.id;
  archiveFile = added[0].file;
  setup = {
    ...summarizeRound(added[0].record, 0, setupPrompt),
    clickedApprovals: setupClickedApprovals,
  };
  requireTool(setup, /^Write$/, "Write setup");
  coding = await runExistingRound(conversationId, codingPrompt);
}

for (const [pattern, label] of [
  [/^Glob$/, "Glob"],
  [/^Grep$/, "Grep"],
  [/^Read$/, "Read"],
  [/^Edit$/, "Edit"],
  [/^NotebookEdit$/, "NotebookEdit"],
  [/^(PowerShell|Bash)$/, "PowerShell"],
  [/^Write$/, "Write result"],
]) requireTool(coding, pattern, label);
if (!resumeConversationId && coding.plans.length === 0) {
  throw new Error(`Task plan was not rendered: ${JSON.stringify(coding)}`);
}

const cart = fs.readFileSync(path.join(fixtureRoot, "src", "cart.js"), "utf8");
const resultFile = fs.readFileSync(path.join(fixtureRoot, "RESULT.md"), "utf8");
const notebook = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "analysis.ipynb"), "utf8"));
if (!/quantity/.test(cart) || !/capability-7413/.test(resultFile)) throw new Error("Coding result files are incomplete");
if (!JSON.stringify(notebook).includes("Leemo NotebookEdit 验收通过")) throw new Error("NotebookEdit result is missing");
if (!resumeConversationId && !coding.clickedApprovals.some((item) => item.scope === "conversation" && /PowerShell|执行命令/.test(item.text))) {
  throw new Error(`Normal command did not offer conversation approval: ${JSON.stringify(coding.clickedApprovals)}`);
}

const subagent = reuseVerifiedRounds
  ? { ...summarizeRound(findRecord(conversationId).record, 0, subagentPrompt), clickedApprovals: [] }
  : await runExistingRound(conversationId, subagentPrompt);
requireTool(subagent, /^(Task|Agent)$/, "subagent delegation");
if (subagent.activities.length !== 1 || subagent.activities[0].tools.length < 3) {
  throw new Error(`Subagent activity card is incomplete: ${JSON.stringify(subagent)}`);
}
if (subagent.replies.length < 2 || !subagent.replies.at(-1)?.includes("业务文件 5 个")) {
  throw new Error(`Subagent final result did not stay in its originating run: ${JSON.stringify(subagent)}`);
}

const browser = reuseVerifiedRounds
  ? { ...summarizeRound(findRecord(conversationId).record, 0, browserPrompt), clickedApprovals: [] }
  : await runExistingRound(conversationId, browserPrompt);
requireTool(browser, /^WebFetch$/, "WebFetch");
requireTool(browser, /mcp__playwright__browser_navigate$/, "browser navigate");
requireTool(browser, /mcp__playwright__browser_snapshot$/, "browser snapshot");
requireTool(browser, /mcp__playwright__browser_take_screenshot$/, "browser screenshot");
if (browser.clickedApprovals.some((item) => /browser_(navigate|snapshot|take_screenshot)/.test(item.text))) {
  throw new Error(`Read-only browser action requested approval: ${JSON.stringify(browser.clickedApprovals)}`);
}
const browserFinalReply = browser.replies.at(-1) ?? "";
if (browser.runId === subagent.runId || !/标题[^\n]*截图[^\n]*成功/s.test(browserFinalReply)) {
  throw new Error(`Browser result was attributed to the wrong round: ${JSON.stringify({
    runId: browser.runId,
    replies: browser.replies,
    tools: browser.tools.map(({ name, status }) => ({ name, status })),
  })}`);
}

const customMcpProbe = await configureAndProbeCustomMcp();
const customMcp = await runExistingRound(conversationId, customMcpPrompt);
requireTool(customMcp, new RegExp(`^mcp__${customMcpId}__echo$`), "custom MCP echo");
if (!customMcp.tools.some((tool) => tool.summary.includes("mcp-echo-7413"))) {
  throw new Error(`Custom MCP did not return the marker: ${JSON.stringify(customMcp)}`);
}
await captureScreenshot("custom-mcp-conversation.png");
await openSettingsTab("connectors");
if (!await removeCustomMcpIfPresent()) throw new Error("Custom MCP disappeared before cleanup");
await closeSettings();

await evaluate(`(() => {
  const button = document.querySelector('button[aria-label="展开分身详情"]');
  button?.click();
  return Boolean(button);
})()`);
await sleep(350);
await captureScreenshot("agent-capabilities-user-path.png");

const facts = {
  notebookId,
  conversationId,
  archive: path.relative(workspaceRoot, archiveFile),
  fixture: path.relative(workspaceRoot, fixtureRoot),
  setup,
  coding,
  taskPlan,
  filesystem: {
    cartUsesQuantity: /quantity/.test(cart),
    resultHasMarker: /capability-7413/.test(resultFile),
    notebookUpdated: JSON.stringify(notebook).includes("Leemo NotebookEdit 验收通过"),
  },
  subagent,
  browser,
  customMcp: {
    id: customMcpId,
    probe: customMcpProbe,
    round: customMcp,
    cleanedUp: true,
  },
  at: new Date().toISOString(),
};
fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`);
console.log(JSON.stringify({
  conversationId,
  setupTools: setup.tools.map((tool) => tool.name),
  codingTools: coding.tools.map((tool) => tool.name),
  codingApprovals: coding.clickedApprovals,
  filesystem: facts.filesystem,
  subagentTools: subagent.tools.map((tool) => tool.name),
  subagentActivities: subagent.activities.length,
  browserTools: browser.tools.map((tool) => tool.name),
  browserApprovals: browser.clickedApprovals,
  customMcpTool: customMcp.tools.map((tool) => tool.name),
  customMcpProbe,
}, null, 2));
socket.close();
