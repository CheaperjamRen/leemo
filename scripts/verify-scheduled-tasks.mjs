// Packaged r11 local scheduled-task acceptance. The core task is created via
// visible controls and executed by the real main-process clock against a
// loopback model. A second task is injected only as a deterministic restart
// fault condition so the test does not spend another full minute waiting.

import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  OUTPUT_DIR,
  MODEL_ID,
  configureLoopbackProvider,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
} from "./verify-memory-workspace.mjs";

const PREFIX = "leemo-e2e-r11-scheduled-";
const TASK_PROMPT = "R11_SCHEDULED_TASK：给我一份 10 分钟英语练习，只需回复验收标记。";
const MISSED_PROMPT = "R11_MISSED_TASK：整理今天的学习记录。";
const FINAL = "R11_SCHEDULED_OK";
const FACTS_PATH = path.join(OUTPUT_DIR, "r11-scheduled-tasks-facts.json");
const DESKTOP_SCREENSHOT = path.join(OUTPUT_DIR, "r11-scheduled-tasks.png");
const MISSED_SCREENSHOT = path.join(OUTPUT_DIR, "r11-scheduled-tasks-missed-720x640.png");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function streamHeaders(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function writeSuccess(response, model, text) {
  streamHeaders(response);
  const base = {
    id: "chatcmpl-leemo-r11-scheduled",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 14, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function streamRouter(response, body) {
  const serialized = JSON.stringify(Array.isArray(body.messages) ? body.messages : []);
  const model = typeof body.model === "string" ? body.model : MODEL_ID;
  writeSuccess(response, model, serialized.includes("R11_SCHEDULED_TASK") ? FINAL : "R11_SCHEDULED_PROBE_OK");
}

function localDateInput(timestamp) {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function localTimeInput(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function relativeOutput(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

async function openScheduledTasks(page) {
  await ensureWorkbench(page);
  await page.getByRole("button", { name: "定时任务", exact: true }).click();
  await page.getByRole("heading", { name: "定时任务", exact: true }).waitFor({ state: "visible" });
}

async function createVisibleTask(page) {
  const now = Date.now();
  const nextMinute = new Date(now);
  nextMinute.setSeconds(0, 0);
  nextMinute.setMinutes(nextMinute.getMinutes() + 1);
  const waitMs = nextMinute.getTime() - now;

  await page.getByLabel("要做什么").fill(TASK_PROMPT);
  await page.getByLabel("运行日期").fill(localDateInput(nextMinute.getTime()));
  await page.getByLabel("运行时间").fill(localTimeInput(nextMinute.getTime()));
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByText(/R11_SCHEDULED_TASK/)
    .waitFor({ state: "visible" });
  return { dueAt: nextMinute.getTime(), waitMs };
}

async function waitForAutomaticCompletion(page, timeoutMs) {
  const completed = page.getByLabel("最近运行").getByText("已完成", { exact: true }).first();
  await completed.waitFor({ state: "visible", timeout: timeoutMs });
  insist(await page.getByRole("heading", { name: "定时任务", exact: true }).isVisible(), "到点运行抢走了用户当前页面");
}

async function schedulerSnapshot(page) {
  return page.evaluate(async () => {
    const response = await window.leemoScheduler.invoke("list", undefined);
    if (!response.ok) throw new Error(response.error || "scheduler list failed");
    return response.response;
  });
}

async function injectRestartMiss(page) {
  return page.evaluate(async ({ prompt, runAt }) => {
    const response = await window.leemoScheduler.invoke("create", {
      prompt,
      workspaceId: "leemo-home",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      schedule: { kind: "once", runAt },
    });
    if (!response.ok) throw new Error(response.error || "scheduler create failed");
    return response.response;
  }, { prompt: MISSED_PROMPT, runAt: Date.now() + 350 });
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const form = document.querySelector('[aria-label="新建定时任务"], [aria-label="编辑定时任务"]');
    const mainRect = main?.getBoundingClientRect();
    const formRect = form?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      mainInsideViewport: mainRect
        ? mainRect.left >= -1 && mainRect.right <= window.innerWidth + 1
        : null,
      formInsideViewport: formRect
        ? formRect.left >= -1 && formRect.right <= window.innerWidth + 1
        : null,
    };
  });
}

async function run() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const harness = await createMemoryAcceptanceHarness({ prefix: PREFIX, streamRouter });
  const facts = { checks: {}, screenshots: {}, layouts: {}, rendererErrors: [] };
  try {
    let app = await harness.start("定时任务首次启动");
    await configureLoopbackProvider(app.page, harness.baseUrl);
    await openScheduledTasks(app.page);

    const timing = await createVisibleTask(app.page);
    facts.createdDueAt = timing.dueAt;
    facts.waitedForDueMs = timing.waitMs;
    facts.checks.visibleCreate = true;
    await waitForAutomaticCompletion(app.page, timing.waitMs + 45_000);
    facts.checks.automaticRun = true;
    facts.checks.didNotStealView = true;

    let snapshot = await schedulerSnapshot(app.page);
    const automaticTask = snapshot.tasks.find((task) => task.prompt === TASK_PROMPT);
    const automaticRun = snapshot.runs.find((candidate) => candidate.taskId === automaticTask?.id);
    insist(automaticTask?.conversationId, "自动任务没有绑定结果对话");
    insist(automaticRun?.status === "succeeded", `自动任务状态不是 succeeded：${automaticRun?.status}`);
    facts.checks.runRecorded = true;

    await app.page.setViewportSize({ width: 1440, height: 900 });
    await app.page.screenshot({ path: DESKTOP_SCREENSHOT, animations: "disabled" });
    facts.screenshots.desktop = relativeOutput(DESKTOP_SCREENSHOT);
    facts.layouts.desktop = await layoutFacts(app.page);

    await app.page.getByRole("button", { name: /打开 R11_SCHEDULED_TASK.*的任务对话/ }).click();
    await app.page.getByText(FINAL, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    facts.checks.resultConversationVisible = true;

    facts.rendererErrors.push(...app.rendererErrors);
    app = await harness.restart("定时任务重启恢复");
    await openScheduledTasks(app.page);
    snapshot = await schedulerSnapshot(app.page);
    insist(snapshot.tasks.some((task) => task.id === automaticTask.id), "重启后定时任务丢失");
    insist(snapshot.runs.some((candidate) => candidate.id === automaticRun.id && candidate.status === "succeeded"), "重启后运行记录丢失");
    facts.checks.restartRestored = true;
    await app.page.getByRole("button", { name: /打开 R11_SCHEDULED_TASK.*的任务对话/ }).click();
    await app.page.getByTestId("current-conversation-status").filter({ hasText: "已完成" })
      .waitFor({ state: "visible", timeout: 30_000 });
    facts.checks.terminalConversationPersisted = true;
    await openScheduledTasks(app.page);

    const injected = await injectRestartMiss(app.page);
    await sleep(100);
    facts.rendererErrors.push(...app.rendererErrors);
    app = await harness.restart("错过任务恢复");
    await openScheduledTasks(app.page);
    await app.page.getByText(/回来后有 1 次任务需要处理/).waitFor({ state: "visible", timeout: 30_000 });
    await app.page.getByRole("heading", { name: "R11_MISSED_TASK：整理今天的学习记录", exact: true })
      .waitFor({ state: "visible" });
    facts.checks.missedNeedsChoice = true;

    await app.page.setViewportSize({ width: 720, height: 640 });
    facts.layouts.compact = await layoutFacts(app.page);
    insist(facts.layouts.compact.horizontalOverflow === 0, `720x640 横向溢出 ${facts.layouts.compact.horizontalOverflow}px`);
    insist(facts.layouts.compact.mainInsideViewport === true, "720x640 主页面越出视口");
    await app.page.screenshot({ path: MISSED_SCREENSHOT, animations: "disabled" });
    facts.screenshots.missed = relativeOutput(MISSED_SCREENSHOT);

    await app.page.getByRole("button", { name: "跳过", exact: true }).click();
    await app.page.getByText(/回来后有 1 次任务需要处理/).waitFor({ state: "hidden" });
    snapshot = await schedulerSnapshot(app.page);
    const injectedRun = snapshot.runs.find((candidate) => candidate.taskId === injected.id);
    insist(injectedRun?.status === "skipped", `错过任务没有被跳过：${injectedRun?.status}`);
    facts.checks.skipPersisted = true;

    facts.rendererErrors = [...new Set([...facts.rendererErrors, ...app.rendererErrors])];
    insist(facts.rendererErrors.length === 0, `renderer 报错：${facts.rendererErrors.join(" | ")}`);
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[r11-scheduled] PASS ${Object.keys(facts.checks).length} checks`);
    console.log(`[r11-scheduled] facts ${relativeOutput(FACTS_PATH)}`);
  } finally {
    await harness.close();
  }
}

await run();
