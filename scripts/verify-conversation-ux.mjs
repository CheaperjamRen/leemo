// Reproducible, zero-model-cost acceptance for conversation presentation.
// Electron supplies real persisted Markdown/source history; browser fixture
// supplies a fresh full interaction so timestamps and buddy density are real.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outputDir = path.resolve("docs/research/audit-shots");
const factsPath = path.join(outputDir, "conversation-ux-facts.json");
fs.mkdirSync(outputDir, { recursive: true });

function insist(value, message) {
  if (!value) throw new Error(message);
}

async function screenshot(page, name) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.writeFileSync(path.join(outputDir, name), Buffer.from(result.data, "base64"));
  } finally {
    await session.detach();
  }
}

let fixtureBrowser;
try {
  const electronBrowser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const electronPage = electronBrowser.contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith("http://localhost:5173"));
  insist(electronPage, "Electron renderer is not available on CDP 9333");
  await electronPage.bringToFront();
  await electronPage.reload({ waitUntil: "domcontentloaded" });

  const sidebar = electronPage.locator("aside").first();
  const strandedRename = sidebar.getByRole("textbox", { name: "对话标题" });
  if (await strandedRename.count()) await strandedRename.press("Escape");
  const capabilityTitle = sidebar.getByRole("button", {
    name: /原生工具能力验收|这是 Leemo 原生工具验收/,
  }).first();
  await capabilityTitle.click();

  const capabilityTable = electronPage.locator("table").filter({ hasText: "WebFetch" }).last();
  await capabilityTable.waitFor({ state: "visible" });
  await capabilityTable.scrollIntoViewIfNeeded();
  const tableHeaders = await capabilityTable.locator("th").allTextContents();
  insist(tableHeaders.some((text) => text.trim() === "工具"), "GFM table did not render semantic headers");
  await screenshot(electronPage, "conversation-ux-gfm-table.png");

  const tableTurn = capabilityTable.locator("xpath=ancestor::div[contains(@class,'leemo-rise')]").first();
  const usageButton = tableTurn.getByRole("button", { name: /查看用量|收起用量/ });
  await usageButton.waitFor({ state: "visible" });
  if ((await usageButton.getAttribute("aria-label")) === "收起用量") await usageButton.click();
  await tableTurn.getByRole("button", { name: "查看用量" }).waitFor({ state: "visible" });
  insist(!(await tableTurn.getByText(/输入\s+\d/).count()), "Usage details were expanded by default");
  await usageButton.click();
  await tableTurn.getByText(/输入\s+\d/).waitFor({ state: "visible" });
  await screenshot(electronPage, "conversation-ux-usage-expanded.png");

  const currentTitle = await capabilityTitle.getAttribute("aria-label");
  if (currentTitle !== "原生工具能力验收") {
    const row = capabilityTitle.locator("xpath=..");
    await row.getByRole("button", { name: "重命名对话" }).click();
    const titleInput = sidebar.getByRole("textbox", { name: "对话标题" });
    await titleInput.fill("原生工具能力验收");
    await titleInput.press("Enter");
    await sidebar.getByRole("button", { name: "原生工具能力验收", exact: true }).waitFor();
    await electronPage.waitForTimeout(400);
  }

  const sourceConversation = sidebar.getByRole("button", {
    name: /诺贝尔物理学奖得主/,
  }).first();
  await sourceConversation.click();
  const sourceLink = electronPage.locator('a[href*="nobelprize.org"]').first();
  await sourceLink.waitFor({ state: "visible" });
  await electronPage.evaluate(() => {
    document.querySelector('a[href*="nobelprize.org"]')?.scrollIntoView({ block: "center" });
  });
  await electronPage.waitForTimeout(150);
  const sourcePresentation = await electronPage.locator('a[href*="nobelprize.org"]').first().evaluate((link) => ({
    className: link.className,
    inlineDecoration: link.style.textDecorationLine,
    target: link.getAttribute("target"),
    rel: link.getAttribute("rel"),
    decoration: getComputedStyle(link).textDecorationLine,
    textDecoration: getComputedStyle(link).textDecoration,
  }));
  console.log("[conversation-ux] source presentation", sourcePresentation);
  insist(sourcePresentation.target === "_blank", "Source link does not leave Leemo in place");
  insist(sourcePresentation.rel?.includes("noopener"), "Source link is missing opener isolation");
  insist(
    sourcePresentation.decoration.includes("underline") || sourcePresentation.inlineDecoration === "underline",
    "Source link is not visibly linked",
  );
  await screenshot(electronPage, "conversation-ux-source-links.png");

  fixtureBrowser = await chromium.launch({ channel: "chrome", headless: true });
  const fixturePage = await fixtureBrowser.newPage({ viewport: { width: 1280, height: 860 } });
  await fixturePage.goto("http://localhost:5173", { waitUntil: "networkidle" });
  await fixturePage.getByPlaceholder("输入消息…").fill("请帮我整理这份课程笔记");
  await fixturePage.getByRole("button", { name: "发送" }).click();

  // Buddy density stays concise, except a real pending approval must surface.
  await fixturePage.waitForTimeout(1_500);
  console.log("[conversation-ux] buddy fixture after send\n", (await fixturePage.locator("body").innerText()).slice(-2_000));
  insist(!(await fixturePage.getByText("帮我规划今天", { exact: true }).count()), "Starter chips remained after the task began");
  await screenshot(fixturePage, "conversation-ux-buddy-after-send.png");
  await fixturePage.getByText(/momo 想执行命令/).waitFor({ state: "visible" });
  await fixturePage.getByText("授权范围：仅这条命令；不会跨对话永久放行", { exact: true }).waitFor({ state: "visible" });
  await fixturePage.getByRole("button", { name: "本对话允许此命令", exact: true }).waitFor({ state: "visible" });
  insist(
    !(await fixturePage.getByRole("button", { name: "始终允许此类操作", exact: true }).count()),
    "Shell approval still exposes a permanent grant",
  );
  await screenshot(fixturePage, "conversation-ux-buddy-approval.png");

  // The same running turn must read like an execution console in workbench,
  // not the old generic "process" heading. Switching modes must not lose the
  // pending decision or create a second conversation.
  await fixturePage.getByRole("button", { name: "切换到工作台", exact: true }).click();
  await fixturePage.locator('[data-shell="workbench"]').waitFor({ state: "visible" });
  await fixturePage.waitForTimeout(600);
  const activeWorkbenchFold = fixturePage.getByTestId("process-fold").last();
  await activeWorkbenchFold.getByText("正在更新计划", { exact: true }).waitFor({ state: "visible" });
  await fixturePage.getByText("授权范围：仅这条命令；不会跨对话永久放行", { exact: true }).waitFor({ state: "visible" });
  await screenshot(fixturePage, "conversation-ux-workbench-active.png");
  await fixturePage.getByRole("button", { name: "搭子", exact: true }).click();
  await fixturePage.locator('[data-shell="workbench"]').waitFor({ state: "detached" });
  await fixturePage.locator('header[aria-label="模式切换"], nav[aria-label="模式切换"]').first().waitFor({ state: "visible" });
  await fixturePage.getByRole("button", { name: "允许一次" }).click();
  await fixturePage.getByText("要把这份笔记放进哪个章节？").waitFor({ state: "visible" });
  const answerOption = fixturePage.getByRole("button", { name: "遍历", exact: true });
  await answerOption.click();
  const submitAnswer = fixturePage.getByRole("button", { name: "提交", exact: true });
  console.log("[conversation-ux] ask state", {
    pressed: await answerOption.getAttribute("aria-pressed"),
    disabled: await submitAnswer.isDisabled(),
  });
  await screenshot(fixturePage, "conversation-ux-buddy-question-answered.png");
  await submitAnswer.click();
  await fixturePage.getByText(/草稿好了。第五章主线/).last().waitFor({ state: "visible" });

  const processFold = fixturePage.getByTestId("process-fold").filter({
    hasText: /momo (?:刚把过程收好了|梳理过步骤|和小助手核对过)/,
  }).first();
  insist(
    await processFold.getByText(/momo (?:刚把过程收好了|梳理过步骤|和小助手核对过)/).count(),
    "Buddy process summary is not human-readable",
  );
  insist(!(await processFold.getByText(/正在/).count()), "Finished buddy turn still claims that work is running");
  insist(!(await processFold.getByText("momo 的干活过程", { exact: true }).count()), "Buddy mode still exposes the workbench process heading");
  insist(!(await fixturePage.getByText("当前任务", { exact: true }).count()), "Finished turn still shows a current task plan");
  const buddyArchiveFold = fixturePage.getByTestId("process-fold").filter({ hasText: "momo 收好确认记录" }).first();
  await buddyArchiveFold.getByText("momo 收好确认记录", { exact: true }).waitFor({ state: "visible" });
  await buddyArchiveFold.locator("button").first().click();
  await buddyArchiveFold.getByText(/你选了：遍历/).waitFor({ state: "visible" });
  await buddyArchiveFold.locator("button").first().click();
  const visibleTimes = await fixturePage.locator("time:visible").allTextContents();
  insist(visibleTimes.filter((text) => /^\d{2}:\d{2}$/.test(text.trim())).length >= 2, "Fresh turn is missing user/result timestamps");
  await fixturePage.getByText(/8\.2 秒/).waitFor({ state: "visible" });
  const fixtureUsage = fixturePage.getByRole("button", { name: "查看用量" }).last();
  insist(!(await fixturePage.getByText(/输入 2\.4k/).count()), "Fixture usage is not folded initially");
  await fixtureUsage.click();
  await fixturePage.getByText(/输入 2\.4k/).waitFor({ state: "visible" });
  await screenshot(fixturePage, "conversation-ux-buddy-finished.png");

  await fixturePage.getByRole("button", { name: "切换到工作台", exact: true }).click();
  await fixturePage.locator('[data-shell="workbench"]').waitFor({ state: "visible" });
  await fixturePage.waitForTimeout(600);
  const finishedWorkbenchFold = fixturePage.getByTestId("process-fold").filter({ hasText: "上下文已整理" }).first();
  await finishedWorkbenchFold.getByText("上下文已整理", { exact: true }).waitFor({ state: "visible" });
  const workbenchArchive = fixturePage.getByTestId("process-fold").filter({ hasText: "确认记录已归档" }).first();
  const archiveLabel = workbenchArchive.getByText("确认记录已归档", { exact: true });
  await archiveLabel.waitFor({ state: "visible" });
  const finalAnswer = fixturePage.getByText(/草稿好了。第五章主线/).last();
  const archiveBeforeFinal = await archiveLabel.evaluate((archive, finalNode) => (
    Boolean(archive.compareDocumentPosition(finalNode) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), await finalAnswer.elementHandle());
  insist(archiveBeforeFinal, "Resolved interaction archive still appears after the final answer");
  await screenshot(fixturePage, "conversation-ux-workbench-finished.png");

  const facts = {
    checkedAt: new Date().toISOString(),
    modelCalls: 0,
    liveElectron: {
      gfmHeaders: tableHeaders.map((text) => text.trim()),
      usageFoldedThenExpanded: true,
      conversationRenamed: true,
      sourceLink: sourcePresentation,
    },
    buddyFixture: {
      pendingApprovalVisible: true,
      starterChipsHiddenAfterStart: true,
      shellScopeVisible: true,
      shellPermanentGrantHidden: true,
      compactProcessSummary: true,
      pinnedPlanHiddenAfterFinish: true,
      resolvedInteractionsArchived: true,
      timestamps: visibleTimes.map((text) => text.trim()),
      durationVisible: true,
      usageFoldedThenExpanded: true,
    },
    workbenchFixture: {
      activeSummary: "正在更新计划",
      finishedSummary: "上下文已整理",
      interactionArchive: "确认记录已归档",
      interactionArchiveBeforeFinal: archiveBeforeFinal,
      pendingApprovalSurvivedModeSwitch: true,
    },
  };
  fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
  await fixtureBrowser.close();
  process.exit(0);
} catch (error) {
  if (fixtureBrowser) await fixtureBrowser.close().catch(() => {});
  console.error(error);
  process.exit(1);
}
