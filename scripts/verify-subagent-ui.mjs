// Zero-model-cost acceptance for subagent presentation and the per-turn helper
// control. Starts an isolated browser fixture, exercises the full interaction,
// and writes screenshots/facts only to the ignored visual-output directory.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.LEEMO_SUBAGENT_UI_PORT ?? 5196);
const rendererUrl = `http://127.0.0.1:${port}`;
const outputDir = path.join(root, "dist-visual-rc", "subagent-ui");
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
fs.mkdirSync(outputDir, { recursive: true });

function insist(value, message) {
  if (!value) throw new Error(message);
}

async function waitForVite(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not become ready at ${rendererUrl}`);
}

async function finishFixtureTurn(page) {
  const later = page.getByRole("button", { name: "稍后配置", exact: true });
  if (await later.count()) await later.click();
  await page.getByPlaceholder("输入消息…").fill("请帮我整理这份课程笔记");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "允许一次", exact: true }).click();
  await page.getByText("要把这份笔记放进哪个章节？", { exact: true }).waitFor();
  await page.getByRole("button", { name: "遍历", exact: true }).click();
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByText(/草稿好了。第五章主线/).last().waitFor();
}

async function activityGeometry(page) {
  return page.evaluate(() => {
    const button = document.querySelector('button[aria-label="收起助手详情"]');
    const card = button?.parentElement;
    if (!button || !card) return null;
    const rect = card.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      insideViewport: rect.left >= -1 && rect.right <= innerWidth + 1,
      pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      taskTruncatesInsteadOfOverflowing: button.scrollWidth <= button.clientWidth + 1,
    };
  });
}

const vite = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let viteOutput = "";
vite.stdout.on("data", (chunk) => { viteOutput += String(chunk); });
vite.stderr.on("data", (chunk) => { viteOutput += String(chunk); });

let browser;
try {
  await waitForVite();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(rendererUrl, { waitUntil: "networkidle" });
  await finishFixtureTurn(page);

  const buddyProcessFold = page.getByTestId("process-fold").filter({ hasText: "momo 和小助手核对过" }).first();
  await buddyProcessFold.locator("button").first().click();
  await page.getByText("调研助手", { exact: true }).waitFor();
  await page.getByText("核对章节结构和易错点", { exact: true }).waitFor();
  insist(!(await page.getByText("先核对目录，再交叉检查例题。", { exact: true }).count()), "Buddy thinking leaked before helper details opened");

  await page.getByRole("button", { name: "展开助手详情", exact: true }).click();
  await page.getByText(/遍历与平衡树是两处高频易错点/).waitFor();
  insist(!(await page.getByText("先核对目录，再交叉检查例题。", { exact: true }).count()), "Buddy thinking leaked into the first helper expansion");
  await page.screenshot({ path: path.join(outputDir, "buddy-helper-summary.png") });

  await page.getByRole("button", { name: "展开助手思考过程", exact: true }).click();
  await page.getByText("先核对目录，再交叉检查例题。", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, "buddy-helper-thinking.png") });

  await page.getByRole("button", { name: "切换到工作台", exact: true }).click();
  await page.locator('[data-shell="workbench"]').waitFor();

  const processFold = page.getByTestId("process-fold").filter({ hasText: "上下文已整理" }).first();
  await processFold.locator("button").first().click();
  await page.getByText("调研助手", { exact: true }).waitFor();
  await page.getByText("核对章节结构和易错点", { exact: true }).waitFor();
  insist(!(await page.getByText("先核对目录，再交叉检查例题。", { exact: true }).count()), "Thinking leaked before helper details opened");

  await page.getByRole("button", { name: "展开助手详情", exact: true }).click();
  await page.getByText(/遍历与平衡树是两处高频易错点/).waitFor();
  insist(!(await page.getByText("先核对目录，再交叉检查例题。", { exact: true }).count()), "Thinking leaked into the first helper expansion");
  await page.screenshot({ path: path.join(outputDir, "desktop-helper-summary.png") });

  const thinkingToggle = page.getByRole("button", { name: "展开助手思考过程", exact: true });
  await thinkingToggle.click();
  await page.getByText("先核对目录，再交叉检查例题。", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(outputDir, "desktop-helper-thinking.png") });

  const helperToggle = page.getByRole("button", { name: "本轮自动召集助手", exact: true });
  await helperToggle.click();
  await page.getByRole("button", { name: "本轮不使用助手", exact: true }).waitFor();

  await page.setViewportSize({ width: 720, height: 640 });
  await page.getByText("调研助手", { exact: true }).scrollIntoViewIfNeeded();
  const narrowGeometry = await activityGeometry(page);
  insist(narrowGeometry?.insideViewport, "Narrow helper card escaped the viewport");
  insist(!narrowGeometry?.pageHorizontalOverflow, "Narrow helper card caused page overflow");
  insist(narrowGeometry?.taskTruncatesInsteadOfOverflowing, "Narrow helper header text overflowed");
  await page.screenshot({ path: path.join(outputDir, "narrow-helper-thinking.png") });

  const facts = {
    checkedAt: new Date().toISOString(),
    modelCalls: 0,
    defaultPresentation: "role-task-status",
    buddyPresentationVerified: true,
    workbenchPresentationVerified: true,
    resultVisibleOnFirstExpansion: true,
    thinkingNestedAndOptional: true,
    perTurnHelperControlVisible: true,
    narrowGeometry,
  };
  fs.writeFileSync(path.join(outputDir, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  if (vite.exitCode !== null) console.error(viteOutput.trim());
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  vite.kill();
}
