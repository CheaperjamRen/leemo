import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, ".tmp-visual-audit", "global-pending-overview");
const URL = process.env.LEEMO_RENDERER_URL ?? "http://127.0.0.1:5199/";
const CHROME = process.env.LEEMO_CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const now = new Date();
const todayAt = (hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0).getTime();

function task(id, title, notebookId, plannedAt, updatedAt = now.getTime()) {
  return {
    id,
    title,
    details: "",
    status: "open",
    plannedAt,
    dueAt: null,
    reminderAt: null,
    reminderOffsetMinutes: null,
    recurrence: null,
    notebookId,
    noteId: null,
    revision: 1,
    createdAt: updatedAt - 86_400_000,
    updatedAt,
    completedAt: null,
  };
}

function conversation(id, title, bookId, userText, finalText, updatedAt = now.getTime()) {
  return {
    meta: {
      id,
      title,
      titleManuallyUpdated: true,
      bookId,
      workspaceId: "leemo-home",
      source: "workbench",
      providerId: "deepseek",
      modelId: "deepseek-chat",
      createdAt: updatedAt - 86_400_000,
      lastActivityAt: updatedAt,
      unread: false,
      pinned: false,
      archived: false,
      lastOpenedAt: updatedAt,
    },
    timeline: [
      { kind: "text", id: `${id}-user`, runId: `${id}-run`, role: "user", text: userText, streaming: false, createdAt: updatedAt - 2_000 },
      { kind: "result", id: `${id}-result`, runId: `${id}-run`, isError: false, interrupted: false, finalText, pathAudit: { claimed: [] }, createdAt: updatedAt },
    ],
  };
}

const tasks = [
  task("story", "把 Leemo 的产品故事打磨成 PRD", "Leemo 产品", todayAt(8)),
  task("resume", "照着 AI 产品岗位优化简历", "求职准备", todayAt(9), now.getTime() - 3_600_000),
  task("workbuddy", "整理 WorkBuddy 产品洞察", "Leemo 产品", todayAt(10), now.getTime() - 7_200_000),
  task("later", "复盘科研 Skill 的下一轮改进", "研究与洞察", null, now.getTime() - 18_000_000),
];

const notes = [
  { id: "note-ai-native", title: "AI 原生不等于 AI 必须一直说话", markdown: "沉默本身也是能力。", revision: 1, createdAt: now.getTime() - 8_000_000, updatedAt: now.getTime() - 3_000_000 },
  { id: "note-flow", title: "准备高分工作流故事", markdown: "先保留人的判断，再让 AI 介入。", revision: 1, createdAt: now.getTime() - 16_000_000, updatedAt: now.getTime() - 7_000_000 },
  { id: "note-ui", title: "开始界面应该尊重人的操作习惯", markdown: "工具优先，AI 按需。", revision: 1, createdAt: now.getTime() - 26_000_000, updatedAt: now.getTime() - 11_000_000 },
];

const conversations = [
  conversation("conv-story", "梳理 Leemo 产品哲学", "Leemo 产品", "把产品哲学收敛成 PRD", "已形成一版定位和约束。"),
  conversation("conv-resume", "AI 产品简历优化", "求职准备", "优化简历里的 Leemo 项目故事", "已整理第一版项目叙事。", now.getTime() - 3_600_000),
  conversation("conv-workbuddy", "WorkBuddy 产品洞察", "Leemo 产品", "对比 Codex 与 WorkBuddy", "竞品证据仍需补充。", now.getTime() - 7_200_000),
  conversation("conv-uncertain", "零散研究线索", null, "这条线索还没想清楚", "先保留。", now.getTime() - 10_800_000),
];

const globalPendingOverview = {
  version: 1,
  snapshot: {
    version: 1,
    id: "visual-snapshot",
    generatedAt: todayAt(9) + 12 * 60_000,
    trigger: "manual",
    providerId: "deepseek",
    modelId: "deepseek-chat",
    items: [
      { id: "line-story", anchorSourceId: "task:story", sourceIds: ["task:story", "conversation:conv-story"], title: "Leemo 产品哲学与开始界面", progressSummary: "定位已经收敛，仍需完成一份可执行 PRD。", nextStep: "把四条产品原则写成验收标准", projectLabel: "Leemo 产品", priority: "now" },
      { id: "line-resume", anchorSourceId: "task:resume", sourceIds: ["task:resume", "conversation:conv-resume"], title: "AI 产品简历优化", progressSummary: "项目叙事已有初稿，还需要压缩并补证据。", nextStep: "重写 Leemo 项目经历", projectLabel: "求职准备", priority: "now" },
      { id: "line-workbuddy", anchorSourceId: "task:workbuddy", sourceIds: ["task:workbuddy", "conversation:conv-workbuddy"], title: "WorkBuddy 产品洞察", progressSummary: "比较框架已建立，证据仍不完整。", nextStep: "补三条真实用户路径对比", projectLabel: "Leemo 产品", priority: "soon" },
      { id: "line-research", anchorSourceId: "task:later", sourceIds: ["task:later"], title: "科研 Skill 后续改进", progressSummary: "已进入后续事项，不影响当前发布。", projectLabel: "研究与洞察", priority: "later" },
    ],
    uncertainSourceIds: ["conversation:conv-uncertain"],
  },
  overrides: [],
};

const persisted = {
  conversations,
  wikiEntries: [],
  settings: {
    surface: "start",
    mode: "buddy",
    onboardingCompleted: true,
    defaultProviderId: "deepseek",
    defaultModelId: "deepseek-chat",
    globalOverviewAutoEnabled: false,
    globalOverviewAutoTime: "09:00",
  },
  globalPendingOverview,
};

async function installDesktopFixture(page) {
  await page.addInitScript(({ persistedState, taskRows, noteRows }) => {
    const clone = (value) => structuredClone(value);
    Object.defineProperty(window, "leemoPersist", {
      configurable: true,
      value: {
        invoke: async (op) => op === "loadAll"
          ? { ok: true, response: clone(persistedState) }
          : { ok: true, response: undefined },
      },
    });
    Object.defineProperty(window, "leemoTasks", {
      configurable: true,
      value: {
        invoke: async (op, payload) => {
          if (op === "listTasks") return { ok: true, response: clone(taskRows) };
          if (op === "updateTask") {
            const current = taskRows.find((item) => item.id === payload.id);
            return { ok: true, response: { ...current, ...payload, revision: (current?.revision ?? 0) + 1 } };
          }
          return { ok: true, response: undefined };
        },
        onChanged: () => () => {},
      },
    });
    Object.defineProperty(window, "leemoCapture", {
      configurable: true,
      value: {
        invoke: async (op) => {
          if (op === "listNotes") return { ok: true, response: clone(noteRows) };
          if (op === "listArchivedNotes") return { ok: true, response: [] };
          return { ok: true, response: undefined };
        },
        onChanged: () => () => {},
      },
    });
  }, { persistedState: persisted, taskRows: tasks, noteRows: notes });
}

async function waitForStart(page) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "开始", level: 1 }).waitFor();
  await page.getByText("Leemo 产品哲学与开始界面").waitFor();
}

async function screenshot(page, filename) {
  const target = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: target, animations: "disabled" });
  return path.relative(ROOT, target).replaceAll(path.sep, "/");
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const consoleErrors = [];
const results = { screenshots: {}, checks: {}, consoleErrors };

try {
  const wide = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  wide.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) consoleErrors.push(message.text());
  });
  await installDesktopFixture(wide);
  await waitForStart(wide);
  results.screenshots.populated = await screenshot(wide, "start-populated-1440x900.png");
  results.checks.noComposer = await wide.getByLabel("输入消息").count() === 0;
  results.checks.fourCards = await wide.locator(".leemo-start-card").count() === 4;
  results.checks.noVerticalScroll = await wide.evaluate(() => document.documentElement.scrollHeight === document.documentElement.clientHeight);

  await wide.getByRole("button", { name: "重新梳理" }).click();
  await wide.getByText("上次梳理仍可用，本次更新没有完成。").waitFor();
  results.screenshots.failed = await screenshot(wide, "start-failed-keeps-snapshot-1440x900.png");
  results.checks.failureKeepsRows = await wide.getByText("Leemo 产品哲学与开始界面").count() === 1;

  await wide.getByRole("button", { name: /查看完整看板/ }).click();
  await wide.getByRole("heading", { name: "求职准备", level: 2 }).waitFor();
  results.screenshots.board = await screenshot(wide, "start-full-board-1440x900.png");
  results.checks.uncertainCollapsed = await wide.getByText("尚不确定的来源（1）").evaluate((node) => !node.closest("details")?.open);
  await wide.getByRole("button", { name: "打开来源 待办：照着 AI 产品岗位优化简历" }).click();
  results.checks.sourceOpensTask = await wide.getByRole("heading", { name: "待办", level: 1 }).count() === 1;

  await wide.reload({ waitUntil: "networkidle" });
  await wide.getByText("Leemo 产品哲学与开始界面").waitFor();
  results.checks.restartRestoresSnapshot = true;
  await wide.close();

  const narrow = await browser.newPage({ viewport: { width: 960, height: 680 }, deviceScaleFactor: 1 });
  await installDesktopFixture(narrow);
  await waitForStart(narrow);
  results.screenshots.narrow = await screenshot(narrow, "start-populated-960x680.png");
  await narrow.getByRole("button", { name: "展开侧栏" }).click();
  results.screenshots.narrowOverlay = await screenshot(narrow, "start-overlay-960x680.png");
  results.checks.sidebarOverlay = await narrow.locator(".leemo-start-sidebar.is-mobile-open").count() === 1;
  results.checks.noHorizontalScroll = await narrow.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
  await narrow.close();
} finally {
  await browser.close();
}

const reportPath = path.join(OUTPUT_DIR, "verification.json");
await fs.writeFile(reportPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ report: path.relative(ROOT, reportPath).replaceAll(path.sep, "/"), ...results }, null, 2));

if (consoleErrors.length > 0 || Object.values(results.checks).some((value) => value !== true)) process.exitCode = 1;
