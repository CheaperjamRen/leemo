// Packaged r11 visual release gate. It uses an isolated user/workspace root
// and a loopback provider, so screenshots never read real data or spend quota.

import fs from "node:fs";
import path from "node:path";
import {
  OUTPUT_DIR,
  ROOT,
  configureLoopbackProvider,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
  openSettingsTab,
  PROMPTS,
  runVisiblePrompt,
} from "./verify-memory-workspace.mjs";

const PREFIX = "leemo-e2e-r11-visual-";
const FACTS_PATH = path.join(OUTPUT_DIR, "r11-visual-pass-facts.json");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 720, height: 640 },
];
const SCREENSHOT_VIEWPORTS = new Set(["1440x900", "720x640"]);

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeOutput(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

async function chooseMode(page, name) {
  const button = page.getByRole("button", { name: `切换到${name}`, exact: true });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

async function openWorkbenchPage(page, name) {
  await ensureWorkbench(page);
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("heading", { name, exact: true }).waitFor({ state: "visible" });
}

async function surfaceFacts(page, targetSelector, requireComposer) {
  return page.evaluate(({ selector, composerRequired }) => {
    const target = document.querySelector(selector);
    const composer = document.querySelector('textarea[aria-label="输入消息"]')?.closest(".leemo-input-shadow");
    const visible = (element) => element instanceof HTMLElement && element.offsetParent !== null;
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const targetRect = rect(target);
    const composerRect = rect(composer);
    const clippedControls = [...document.querySelectorAll("button, input, textarea, select, a[href], [role='tab']")]
      .filter(visible)
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.left < -1 || box.right > window.innerWidth + 1))
      .slice(0, 12)
      .map(({ element, box }) => ({
        tag: element.tagName,
        label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 60) || "",
        left: box.left,
        right: box.right,
      }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentHorizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      targetHorizontalOverflow: target instanceof HTMLElement
        ? Math.max(0, target.scrollWidth - target.clientWidth)
        : null,
      targetInsideViewport: targetRect
        ? targetRect.left >= -1 && targetRect.right <= window.innerWidth + 1
        : null,
      composerRequired,
      composerInsideViewport: composerRect
        ? composerRect.left >= -1
          && composerRect.right <= window.innerWidth + 1
          && composerRect.top >= -1
          && composerRect.bottom <= window.innerHeight + 1
        : null,
      gradientElements: [...document.querySelectorAll("*")]
        .filter((element) => visible(element) && getComputedStyle(element).backgroundImage.includes("gradient"))
        .length,
      clippedControls,
      contextTitleVisible: Boolean(document.querySelector('[data-testid="workbench-context-title"]')),
      headings: [...document.querySelectorAll("h1, h2")]
        .filter(visible)
        .map((element) => element.textContent?.trim() || "")
        .filter(Boolean)
        .slice(0, 12),
    };
  }, { selector: targetSelector, composerRequired: requireComposer });
}

async function captureSurface(
  page,
  facts,
  name,
  targetSelector,
  { composer = false, noContextTitle = false, maxGradients } = {},
) {
  facts.layouts[name] = {};
  facts.screenshots[name] = {};
  for (const viewport of VIEWPORTS) {
    const label = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const layout = await surfaceFacts(page, targetSelector, composer);
    insist(layout.viewport.width === viewport.width && layout.viewport.height === viewport.height, `${name} ${label} 视口设置失败`);
    insist(layout.documentHorizontalOverflow === 0, `${name} ${label} 文档横向溢出 ${layout.documentHorizontalOverflow}px`);
    insist((layout.targetHorizontalOverflow ?? 0) <= 1, `${name} ${label} 主容器横向溢出 ${layout.targetHorizontalOverflow}px`);
    insist(layout.targetInsideViewport !== false, `${name} ${label} 主容器越出视口`);
    if (Number.isFinite(maxGradients)) {
      insist(
        layout.gradientElements <= maxGradients,
        `${name} ${label} 渐变元素 ${layout.gradientElements} 个，超过允许的 ${maxGradients} 个`,
      );
    }
    insist(layout.clippedControls.length === 0, `${name} ${label} 有控件被横向裁切：${JSON.stringify(layout.clippedControls)}`);
    if (composer) insist(layout.composerInsideViewport === true, `${name} ${label} 输入框没有完整展示`);
    if (noContextTitle) insist(layout.contextTitleVisible === false, `${name} ${label} 顶栏重复显示页面标题`);
    facts.layouts[name][label] = layout;
    if (SCREENSHOT_VIEWPORTS.has(label)) {
      const screenshot = path.join(OUTPUT_DIR, `r11-visual-${name}-${label}.png`);
      await page.screenshot({ path: screenshot, animations: "disabled" });
      facts.screenshots[name][label] = relativeOutput(screenshot);
    }
  }
}

async function run() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const harness = await createMemoryAcceptanceHarness({
    prefix: PREFIX,
    readySelector: '[data-testid="topbar-primary-controls"]',
  });
  const facts = {
    checkedAt: new Date().toISOString(),
    checks: {},
    layouts: {},
    screenshots: {},
    rendererErrors: [],
  };

  try {
    const app = await harness.start("视觉发布门禁");
    facts.startupMs = app.startupMs;
    await configureLoopbackProvider(app.page, harness.baseUrl);

    await chooseMode(app.page, "搭子");
    await captureSurface(app.page, facts, "buddy", "main", { composer: true, maxGradients: 1 });

    await chooseMode(app.page, "工作台");
    await app.page.getByTestId("workbench-shell").waitFor({ state: "visible" });
    await captureSurface(app.page, facts, "workbench", "main", { composer: true });

    await runVisiblePrompt(app.page, PROMPTS.globalArtifact, "R10_GLOBAL_ARTIFACT_OK");
    await captureSurface(app.page, facts, "workbench-completed", "main", { composer: true });
    await app.page.getByTestId("process-fold-toggle").last().click();
    await captureSurface(app.page, facts, "workbench-tool-expanded", "main", { composer: true });
    await app.page.getByRole("button", { name: "展开工具详情", exact: true }).last().click();
    await captureSurface(app.page, facts, "workbench-tool-raw", "main", { composer: true });

    await openWorkbenchPage(app.page, "技能");
    // The curated bundle size is product data, not a visual contract. Wait for
    // hydration without pinning this release gate to yesterday's skill count.
    await app.page.getByText(/^\d+ 个可用$/).waitFor({ state: "visible", timeout: 30_000 });
    await captureSurface(app.page, facts, "skills", "main", { noContextTitle: true });

    await openWorkbenchPage(app.page, "定时任务");
    await captureSurface(app.page, facts, "scheduled", "main", { noContextTitle: true });

    const activityRail = app.page.getByTestId("workbench-activity-rail");
    await activityRail.getByRole("button", { name: "搜索", exact: true }).click();
    await app.page.getByTestId("embedded-search-page").waitFor({ state: "visible" });
    await captureSurface(app.page, facts, "search", '[data-testid="workbench-tool-panel"]');
    await activityRail.getByRole("button", { name: "搜索", exact: true }).click();

    await openSettingsTab(app.page, "模型");
    await app.page.getByTestId("provider-workbench").waitFor({ state: "visible" });
    await captureSurface(app.page, facts, "settings-models", '[data-testid="settings-window"]');
    await app.page.getByRole("button", { name: "关闭设置", exact: true }).click();

    facts.rendererErrors = [...new Set(app.rendererErrors)];
    insist(facts.rendererErrors.length === 0, `renderer 报错：${facts.rendererErrors.join(" | ")}`);
    facts.checks.nineCoreStates = Object.keys(facts.layouts).length === 9;
    facts.checks.fourViewports = Object.values(facts.layouts).every((entry) => Object.keys(entry).length === 4);
    facts.checks.noHorizontalOverflow = true;
    facts.checks.composersVisible = true;
    facts.checks.gradientInventoryRecorded = true;
    facts.checks.noDuplicateToolPageTitles = true;

    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[r11-visual] PASS ${Object.keys(facts.checks).length} checks`);
    console.log(`[r11-visual] facts ${relativeOutput(FACTS_PATH)}`);
  } finally {
    await harness.close();
  }
}

await run();
