// Zero-model-cost acceptance for the browser-automation product surface and
// AskUserCard geometry. The live Electron renderer proves the real bridge can
// start Playwright; a clean browser fixture provides deterministic screenshots
// without capturing the developer's conversation history.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(ROOT, "docs", "research", "audit-shots");
const factsPath = path.join(outputDir, "browser-automation-ui-facts.json");
const cdpPort = process.env.LEEMO_CDP_PORT || "19231";
const rendererUrl = process.env.LEEMO_RENDERER_URL || "http://localhost:5173";
const viewports = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "720x640", width: 720, height: 640 },
];

fs.mkdirSync(outputDir, { recursive: true });

function insist(value, message) {
  if (!value) throw new Error(message);
}

async function dismissOnboarding(page) {
  const later = page.getByRole("button", { name: "稍后配置", exact: true });
  if (await later.count()) await later.click();
}

async function openConnectors(page) {
  await dismissOnboarding(page);
  if (!(await page.getByTestId("settings-window").count())) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "连接器", exact: true }).click();
  await page.locator("#settings-browser").waitFor({ state: "visible" });
}

async function closeSettings(page) {
  const close = page.getByRole("button", { name: "关闭设置", exact: true });
  if (await close.count()) await close.click();
}

async function inspectBrowserLayout(page) {
  return page.evaluate(() => {
    const settings = document.querySelector('[data-testid="settings-window"]');
    const panel = settings?.querySelector('[role="tabpanel"]');
    const section = document.querySelector("#settings-browser");
    const managed = section?.querySelector('button[aria-label="Leemo 浏览器"]');
    const extension = section?.querySelector('button[aria-label="当前 Chrome"]');
    if (!settings || !panel || !section || !managed || !extension) return null;
    const settingsRect = settings.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const managedRect = managed.getBoundingClientRect();
    const extensionRect = extension.getBoundingClientRect();
    const insideHorizontally = (inner, outer) => (
      inner.left >= outer.left - 1 && inner.right <= outer.right + 1
    );
    const overflowing = [...section.querySelectorAll("*")]
      .filter((element) => element.offsetParent !== null)
      .filter((element) => !["SVG", "PATH"].includes(element.tagName))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && !insideHorizontally(rect, panelRect);
      })
      .map((element) => ({
        tag: element.tagName,
        text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      }));
    return {
      settingsInsideViewport: settingsRect.left >= -1
        && settingsRect.right <= innerWidth + 1
        && settingsRect.top >= -1
        && settingsRect.bottom <= innerHeight + 1,
      panelHorizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
      sectionInsidePanel: insideHorizontally(sectionRect, panelRect),
      modeWidths: [managedRect.width, extensionRect.width],
      modeCardsAligned: Math.abs(managedRect.width - extensionRect.width) <= 1,
      browserSectionUsesProductLanguage: !section.textContent?.includes("MCP"),
      customConnectorHeadingVisible: Boolean(
        [...panel.querySelectorAll("h2")].find((item) => item.textContent?.includes("其他连接器")),
      ),
      overflowing,
    };
  });
}

async function inspectAskUser(page) {
  const question = page.getByText("要把这份笔记放进哪个章节？", { exact: true });
  const questionBlock = question.locator("xpath=..");
  const card = questionBlock.locator("xpath=..");
  const options = questionBlock.locator('button[aria-pressed]');
  await card.scrollIntoViewIfNeeded();
  return options.evaluateAll((buttons) => {
    const rects = buttons.map((button) => button.getBoundingClientRect());
    const widths = rects.map((rect) => rect.width);
    let scrollParent = buttons[0]?.parentElement;
    while (scrollParent && !["auto", "scroll"].includes(getComputedStyle(scrollParent).overflowY)) {
      scrollParent = scrollParent.parentElement;
    }
    const scrollRect = scrollParent?.getBoundingClientRect();
    const cardRect = buttons[0]?.closest('[class*="border-[var(--leemo-amber-line)]"]')?.getBoundingClientRect();
    return {
      count: buttons.length,
      widths,
      equalWidth: widths.length > 0 && Math.max(...widths) - Math.min(...widths) <= 1,
      alignedLeft: rects.length > 0 && Math.max(...rects.map((rect) => rect.left)) - Math.min(...rects.map((rect) => rect.left)) <= 1,
      alignedRight: rects.length > 0 && Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.right)) <= 1,
      noTextOverflow: buttons.every((button) => button.scrollWidth <= button.clientWidth + 1),
      cardFullyVisible: Boolean(scrollRect && cardRect
        && cardRect.top >= scrollRect.top - 1
        && cardRect.bottom <= scrollRect.bottom + 1),
    };
  });
}

async function inspectWorkbenchComposer(page) {
  const composer = page.getByTestId("workbench-composer-column");
  const conversation = page.getByTestId("conversation-column");
  await composer.waitFor({ state: "visible" });
  return page.evaluate(() => {
    const composerNode = document.querySelector('[data-testid="workbench-composer-column"]');
    const conversationNode = document.querySelector('[data-testid="conversation-column"]');
    const input = composerNode?.querySelector('textarea[aria-label="输入消息"]');
    if (!composerNode || !conversationNode || !input) return null;
    const composerRect = composerNode.getBoundingClientRect();
    const conversationRect = conversationNode.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    return {
      composerWidth: composerRect.width,
      conversationWidth: conversationRect.width,
      maxWidthRespected: composerRect.width <= 881,
      centered: Math.abs(
        (composerRect.left + composerRect.right) / 2
        - (conversationRect.left + conversationRect.right) / 2,
      ) <= 1,
      inputInsideViewport: inputRect.left >= -1 && inputRect.right <= innerWidth + 1,
      pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

let fixtureBrowser;
const facts = {
  checkedAt: new Date().toISOString(),
  modelCalls: 0,
  liveElectron: {},
  fixture: { settings: {}, askUser: {}, workbenchComposer: {} },
};

try {
  // Real host route: the button performs initialize + tools/list against the
  // bundled Playwright MCP and then closes it. No model call or webpage action.
  const electronBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const electronPage = electronBrowser.contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith(rendererUrl));
  insist(electronPage, `Electron renderer is not available on CDP ${cdpPort}`);
  await openConnectors(electronPage);
  const selectedMode = await electronPage.locator('#settings-browser button[aria-pressed="true"]').getAttribute("aria-label");
  const testButton = electronPage.getByRole("button", { name: "检查浏览器", exact: true });
  await testButton.click();
  const ready = electronPage.getByText(/浏览器已就绪 · \d+ 项能力/);
  await ready.waitFor({ state: "visible", timeout: 60_000 });
  const readyText = (await ready.textContent())?.trim() || "";
  const toolCount = Number(readyText.match(/(\d+) 项能力/)?.[1] || 0);
  insist(toolCount >= 3, `Browser tool probe returned only ${toolCount} tools`);
  facts.liveElectron = { selectedMode, readyText, toolCount };
  await closeSettings(electronPage);

  fixtureBrowser = await chromium.launch({ channel: "chrome", headless: true });
  const fixturePage = await fixtureBrowser.newPage();
  for (const viewport of viewports) {
    await fixturePage.setViewportSize({ width: viewport.width, height: viewport.height });
    await fixturePage.goto(rendererUrl, { waitUntil: "networkidle" });
    await openConnectors(fixturePage);
    await fixturePage.locator("#settings-browser").scrollIntoViewIfNeeded();
    const layout = await inspectBrowserLayout(fixturePage);
    insist(layout, `${viewport.id}: browser settings did not render`);
    await fixturePage.screenshot({
      path: path.join(outputDir, `browser-automation-settings-${viewport.id}.png`),
    });
    facts.fixture.settings[viewport.id] = layout;
    await closeSettings(fixturePage);
  }

  await fixturePage.setViewportSize({ width: 1280, height: 860 });
  await fixturePage.goto(rendererUrl, { waitUntil: "networkidle" });
  await fixturePage.getByPlaceholder("输入消息…").fill("请帮我整理这份课程笔记");
  await fixturePage.getByRole("button", { name: "发送", exact: true }).click();
  await fixturePage.getByText(/momo 想执行命令/).waitFor({ state: "visible" });
  await fixturePage.getByRole("button", { name: "允许一次", exact: true }).click();
  await fixturePage.getByText("要把这份笔记放进哪个章节？", { exact: true }).waitFor({ state: "visible" });

  for (const viewport of [
    { id: "1280x860", width: 1280, height: 860 },
    { id: "720x640", width: 720, height: 640 },
  ]) {
    await fixturePage.setViewportSize({ width: viewport.width, height: viewport.height });
    const geometry = await inspectAskUser(fixturePage);
    await fixturePage.screenshot({
      path: path.join(outputDir, `ask-user-equal-options-${viewport.id}.png`),
    });
    facts.fixture.askUser[viewport.id] = geometry;
  }

  await fixturePage.getByRole("button", { name: "工作台", exact: true }).click();
  await fixturePage.locator('[data-shell="workbench"]').waitFor({ state: "visible" });
  for (const viewport of [
    { id: "1920x1080", width: 1920, height: 1080 },
    { id: "1440x900", width: 1440, height: 900 },
    { id: "720x640", width: 720, height: 640 },
  ]) {
    await fixturePage.setViewportSize({ width: viewport.width, height: viewport.height });
    const geometry = await inspectWorkbenchComposer(fixturePage);
    insist(geometry, `${viewport.id}: workbench composer did not render`);
    await fixturePage.screenshot({
      path: path.join(outputDir, `workbench-composer-${viewport.id}.png`),
    });
    facts.fixture.workbenchComposer[viewport.id] = geometry;
  }

  const failures = [];
  for (const [viewport, layout] of Object.entries(facts.fixture.settings)) {
    if (!layout.settingsInsideViewport) failures.push(`${viewport}: settings window escapes viewport`);
    if (layout.panelHorizontalOverflow || !layout.sectionInsidePanel || layout.overflowing.length > 0) {
      failures.push(`${viewport}: browser settings has horizontal overflow`);
    }
    if (!layout.modeCardsAligned) failures.push(`${viewport}: browser mode cards are not aligned`);
    if (!layout.browserSectionUsesProductLanguage) failures.push(`${viewport}: browser section exposes MCP implementation language`);
    if (!layout.customConnectorHeadingVisible) failures.push(`${viewport}: custom connector section is missing`);
  }
  for (const [viewport, geometry] of Object.entries(facts.fixture.askUser)) {
    if (geometry.count < 2 || !geometry.equalWidth || !geometry.alignedLeft || !geometry.alignedRight) {
      failures.push(`${viewport}: AskUser options are not equal-width and aligned`);
    }
    if (!geometry.noTextOverflow) failures.push(`${viewport}: AskUser option text overflows`);
    if (!geometry.cardFullyVisible) failures.push(`${viewport}: AskUser card cannot be brought fully into the timeline viewport`);
  }
  for (const [viewport, geometry] of Object.entries(facts.fixture.workbenchComposer)) {
    if (!geometry.maxWidthRespected || !geometry.centered) {
      failures.push(`${viewport}: workbench composer is not centered in a restrained column`);
    }
    if (!geometry.inputInsideViewport || geometry.pageHorizontalOverflow) {
      failures.push(`${viewport}: workbench composer causes horizontal overflow`);
    }
  }
  if (failures.length > 0) throw new Error(`Browser/UI acceptance failed:\n- ${failures.join("\n- ")}`);

  fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} finally {
  if (fixtureBrowser) await fixtureBrowser.close();
}
