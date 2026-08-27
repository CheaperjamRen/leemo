// Packaged r11 Skills acceptance. Drives the visible catalog, slash menu and
// composer against an isolated Leemo.exe plus a loopback OpenAI-compatible
// model. It never reads the user's profile or spends external model quota.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractFile } from "@electron/asar";
import {
  ROOT,
  OUTPUT_DIR,
  MODEL_ID,
  configureLoopbackProvider,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
  newConversation,
  runVisiblePrompt,
} from "./verify-memory-workspace.mjs";

const PREFIX = "leemo-e2e-r11-skills-";
const FINAL = "R12_BUNDLED_SKILL_BODY_OK";
const BODY_MARKER = "Approach this as the design lead at a small studio";
const OFFICE_BODY_MARKERS = [
  "XLSX creation, editing, and analysis",
  "Zero Formula Errors",
  "CRITICAL: Use Formulas, Not Hardcoded Values",
];
const OFFICE_CARD_COMMANDS = [
  { query: "/Word", label: "Word 文档", command: "docx" },
  { query: "/Excel", label: "Excel 表格", command: "xlsx" },
  { query: "/演示", label: "演示文稿", command: "pptx" },
  { query: "/PDF", label: "PDF 文档", command: "pdf" },
];
const FACTS_PATH = path.join(OUTPUT_DIR, "r11-skills-facts.json");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 720, height: 640 },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function includesMarkers(serialized, markers) {
  const normalized = serialized.toLocaleLowerCase();
  return markers.every((marker) => normalized.includes(marker.toLocaleLowerCase()));
}

function streamHeaders(response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function writeSuccess(response, model, content) {
  streamHeaders(response);
  const base = {
    id: "chatcmpl-leemo-r11-skills",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 20, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function streamRouter(response, body, state) {
  const serialized = JSON.stringify(body);
  const model = typeof body.model === "string" ? body.model : MODEL_ID;
  if (serialized.includes("R11_OFFICE_BODY")) {
    const bodyLoaded = includesMarkers(serialized, OFFICE_BODY_MARKERS);
    state.officeBodyChecks ??= [];
    state.officeBodyChecks.push({ bodyLoaded });
    writeSuccess(response, model, "R11_OFFICE_BODY_OK");
    return;
  }
  if (serialized.includes("R12_BUNDLED_SKILL_BODY")) {
    const bodyLoaded = serialized.includes(BODY_MARKER);
    state.skillBodyChecks ??= [];
    state.skillBodyChecks.push({
      bodyLoaded,
      toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    });
    writeSuccess(response, model, FINAL);
    return;
  }
  writeSuccess(response, model, "R11_SKILLS_PROBE_OK");
}

function relativeOutput(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

function runtimeSkills(auditRoot) {
  const root = path.join(
    auditRoot,
    "user-data",
    "workspace",
    "data",
    "bundled-skills",
    "runtime",
    "leemo-library",
    "skills",
  );
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function waitForRuntimeSkills(auditRoot, predicate, label) {
  const deadline = Date.now() + 15_000;
  let current = [];
  while (Date.now() < deadline) {
    current = runtimeSkills(auditRoot);
    if (predicate(current)) return current;
    await sleep(80);
  }
  throw new Error(`${label}：运行时技能目录未同步，当前为 ${current.join("、")}`);
}

async function openSkills(page) {
  await ensureWorkbench(page);
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByRole("heading", { name: "技能", exact: true }).waitFor({ state: "visible" });
  await page.getByText(/个可用$/).waitFor({ state: "visible", timeout: 30_000 });
}

async function catalogNames(page) {
  return page.locator("h3").allTextContents().then((values) => values.map((value) => value.trim()).filter(Boolean));
}

async function slashNames(page, query = "/") {
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.fill(query);
  const menu = page.getByTestId("slash-menu");
  await menu.waitFor({ state: "visible" });
  const values = await menu.locator('[role="option"]').allTextContents();
  await composer.press("Escape");
  return values.map((value) => value.split(/\r?\n/, 1)[0].trim());
}

async function toggleSkill(page, name, enabled) {
  const input = page.getByRole("checkbox", { name: `让 momo 用 ${name}`, exact: true });
  await input.waitFor({ state: "attached" });
  if ((await input.isChecked()) !== enabled) await input.locator("..").click();
  await page.waitForFunction(
    ({ label, expected }) => document.querySelector(`input[aria-label="${label}"]`)?.checked === expected,
    { label: `让 momo 用 ${name}`, expected: enabled },
  );
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-testid="workbench-shell"]');
    const main = shell?.querySelector("main");
    const search = document.querySelector('input[aria-label="搜索技能"]');
    const shellRect = shell?.getBoundingClientRect();
    const mainRect = main?.getBoundingClientRect();
    const searchRect = search?.getBoundingClientRect();
    const inside = (rect) => rect
      ? rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1
      : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentHorizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      shellHorizontalOverflow: shell instanceof HTMLElement ? Math.max(0, shell.scrollWidth - shell.clientWidth) : null,
      shellInsideViewport: inside(shellRect),
      mainInsideViewport: inside(mainRect),
      searchInsideViewport: inside(searchRect),
      mainWidth: mainRect?.width ?? null,
    };
  });
}

async function captureViewports(page) {
  const screenshots = {};
  const layouts = {};
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const label = `${viewport.width}x${viewport.height}`;
    const facts = await layoutFacts(page);
    insist(facts.viewport.width === viewport.width && facts.viewport.height === viewport.height, `${label} 视口设置失败`);
    insist(facts.documentHorizontalOverflow === 0, `${label} 文档横向溢出 ${facts.documentHorizontalOverflow}px`);
    insist((facts.shellHorizontalOverflow ?? 0) <= 1, `${label} 工作台横向溢出 ${facts.shellHorizontalOverflow}px`);
    insist(facts.shellInsideViewport === true && facts.mainInsideViewport === true, `${label} 工作台越出视口`);
    insist(facts.searchInsideViewport === true, `${label} 搜索框没有完整展示`);
    const screenshot = path.join(OUTPUT_DIR, `r11-skills-${label}.png`);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    screenshots[label] = relativeOutput(screenshot);
    layouts[label] = facts;
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  return { screenshots, layouts };
}

function physicalPackageFacts() {
  const unpacked = path.join(ROOT, "dist-package", "win-unpacked");
  const stack = [unpacked];
  let files = 0;
  let bytes = 0;
  let looseBundledSkillFiles = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(target).size;
        const normalized = target.replaceAll("\\", "/");
        if (normalized.includes("/bundled-skills/default-enabled/") || normalized.includes("/bundled-skills/optional/")) {
          looseBundledSkillFiles += 1;
        }
      }
    }
  }
  const packageVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const installer = path.join(ROOT, "dist-package", `Leemo Setup ${packageVersion}.exe`);
  const asar = path.join(unpacked, "resources", "app.asar");
  return {
    unpackedPhysicalFiles: files,
    unpackedBytes: bytes,
    installerBytes: fs.statSync(installer).size,
    appAsarBytes: fs.statSync(asar).size,
    looseBundledSkillFiles,
  };
}

function runtimeCacheFacts(auditRoot) {
  const root = path.join(
    auditRoot,
    "user-data",
    "workspace",
    "data",
    "bundled-skills",
    "runtime",
    "leemo-library",
  );
  const stack = [root];
  let files = 0;
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(target).size;
      }
    }
  }
  return { root, files, bytes };
}

function workingSetBytes(pid) {
  try {
    const output = execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid}).WorkingSet64`,
    ], { encoding: "utf8", windowsHide: true });
    const value = Number(output.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function packagedOfficeBundleFacts() {
  const sourceRoot = path.join(ROOT, "bundled-skills", "office", "release", "skills");
  const appAsar = path.join(ROOT, "dist-package", "win-unpacked", "resources", "app.asar");
  if (!fs.existsSync(sourceRoot)) return { present: false, files: 0 };
  const files = [];
  const walk = (directory, relativeRoot = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push({ absolute, relative });
    }
  };
  walk(sourceRoot);
  files.sort((left, right) => left.relative.localeCompare(right.relative, "en"));

  const digest = (read) => {
    const hash = createHash("sha256");
    let bytes = 0;
    for (const file of files) {
      const data = read(file);
      bytes += data.byteLength;
      hash.update(file.relative);
      hash.update("\0");
      hash.update(data);
      hash.update("\0");
    }
    return { bytes, sha256: hash.digest("hex") };
  };
  const source = digest((file) => fs.readFileSync(file.absolute));
  const packaged = digest((file) => extractFile(
    appAsar,
    path.join("bundled-skills", "office", "release", "skills", ...file.relative.split("/")),
  ));
  return { present: true, files: files.length, source, packaged };
}

async function run() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const harness = await createMemoryAcceptanceHarness({ prefix: PREFIX, streamRouter });
  const facts = { checks: {}, screenshots: {}, layouts: {}, rendererErrors: [], runtime: {}, package: {} };
  try {
    let app = await harness.start("Skills 首次启动");
    facts.startupMs = { first: app.startupMs };
    await configureLoopbackProvider(app.page, harness.baseUrl);
    await openSkills(app.page);

    const names = await catalogNames(app.page);
    insist(names.length === 46, `技能目录没有完整展示 28 个内置技能、14 个开发方法和 4 个 Office 能力：${names.length}`);
    insist(new Set(names).size === 46, "技能目录存在重复显示名");
    for (const officeName of ["Word 文档", "Excel 表格", "演示文稿", "PDF 文档"]) {
      insist(names.includes(officeName), `缺少 Office 标配：${officeName}`);
    }
    const officeBundle = packagedOfficeBundleFacts();
    if (officeBundle.present) {
      insist(
        officeBundle.source.bytes === officeBundle.packaged.bytes
          && officeBundle.source.sha256 === officeBundle.packaged.sha256,
        "打包版 Office 技能树与打包前源包不一致",
      );
    }
    facts.package.officeBundle = officeBundle;
    insist(names.includes("前端设计"), "缺少默认精选前端设计");
    insist(names.includes("平面设计"), "缺少按需精选平面设计");
    insist(names.includes("IMA 知识库"), "缺少腾讯 IMA Skill");
    insist(!names.includes("claude-api"), "不应向用户暴露 claude-api");
    await app.page.getByText("9 个已启用", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await app.page.getByText("42 个可用", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    insist(await app.page.getByText("Anthropic 官方", { exact: true }).count() > 0, "没有展示 Anthropic 真实来源");
    insist(await app.page.getByText("腾讯官方", { exact: true }).count() === 1, "IMA 没有展示腾讯官方来源");
    insist(await app.page.getByText("社区精选", { exact: true }).count() > 0, "baoyu 没有展示社区精选来源");
    insist(!(await app.page.locator("body").innerText()).includes("leemo-library:"), "界面泄漏了内部插件前缀");
    facts.checks.catalog46 = true;
    facts.checks.defaultCount9 = true;
    facts.checks.realProvenance = true;
    facts.checks.claudeApiHidden = true;

    const initialRuntime = await waitForRuntimeSkills(
      harness.auditRoot,
      (items) => items.length === 28 && items.includes("frontend-design") && items.includes("canvas-design"),
      "完整精选技能运行缓存",
    );
    facts.runtime.initial = initialRuntime;
    facts.checks.runtimeLibraryComplete = true;

    const search = app.page.getByRole("searchbox", { name: "搜索技能" });
    await search.fill("IMA");
    insist((await catalogNames(app.page)).includes("IMA 知识库"), "搜索找不到 IMA 知识库");
    await search.fill("");
    await app.page.getByRole("button", { name: /^设计与创作\s/ }).click();
    insist((await catalogNames(app.page)).includes("前端设计"), "开放分类没有包含前端设计");
    await app.page.getByRole("button", { name: /^全部\s/ }).click();
    facts.checks.searchAndCategory = true;

    const visual = await captureViewports(app.page);
    facts.screenshots = visual.screenshots;
    facts.layouts = visual.layouts;
    facts.checks.fourViewports = true;

    await newConversation(app.page);
    const initialSlash = await slashNames(app.page);
    insist(initialSlash.some((name) => name.includes("前端设计")), "默认斜杠菜单没有前端设计");
    insist(!initialSlash.some((name) => name.includes("平面设计")), "默认关闭的平面设计出现在菜单");
    facts.checks.slashUsesEnabledSet = true;

    await runVisiblePrompt(
      app.page,
      "/frontend-design R12_BUNDLED_SKILL_BODY：只确认已加载技能正文，不要创建文件。",
      FINAL,
    );
    insist(harness.state.skillBodyChecks?.some((entry) => entry.bodyLoaded), "frontend-design 正文没有进入真实模型请求");
    facts.checks.skillBodyLoaded = true;

    if (officeBundle.present) {
      const composer = app.page.locator('textarea[aria-label="输入消息"]');
      for (const card of OFFICE_CARD_COMMANDS) {
        await composer.fill(card.query);
        const menu = app.page.getByTestId("slash-menu");
        await menu.waitFor({ state: "visible" });
        await menu.getByRole("option", { name: new RegExp(card.label) }).click();
        insist(
          await composer.inputValue() === `/${card.command} `,
          `${card.label} 卡片没有转换为可执行的 /${card.command} 命令`,
        );
        await composer.fill("");
      }
      facts.checks.officeFriendlyAliases = true;
      await runVisiblePrompt(
        app.page,
        "/xlsx R11_OFFICE_BODY：只确认已加载表格技能正文，不要创建文件。",
        "R11_OFFICE_BODY_OK",
      );
      insist(
        harness.state.officeBodyChecks?.some((entry) => entry.bodyLoaded),
        "Excel bundle 只显示了卡片，技能正文没有进入真实模型请求",
      );
      facts.checks.officeSkillBodyLoaded = true;
    } else {
      facts.checks.optionalOfficeBundleAbsent = true;
    }

    await openSkills(app.page);
    await toggleSkill(app.page, "前端设计", false);
    await toggleSkill(app.page, "平面设计", true);
    facts.checks.hotToggle = true;

    await newConversation(app.page);
    const toggledSlash = await slashNames(app.page);
    insist(!toggledSlash.some((name) => name.includes("前端设计")), "关闭后菜单仍有前端设计");
    insist(toggledSlash.some((name) => name.includes("平面设计")), "启用后菜单没有平面设计");
    facts.checks.menuHotSynced = true;
    facts.rendererErrors.push(...app.rendererErrors);

    app = await harness.restart("Skills 重启恢复");
    facts.startupMs.restart = app.startupMs;
    await openSkills(app.page);
    insist(!(await app.page.getByRole("checkbox", { name: "让 momo 用 前端设计" }).isChecked()), "重启后前端设计开关反弹");
    insist(await app.page.getByRole("checkbox", { name: "让 momo 用 平面设计" }).isChecked(), "重启后平面设计开关丢失");
    const restartedRuntime = await waitForRuntimeSkills(
      harness.auditRoot,
      (items) => JSON.stringify(items) === JSON.stringify(initialRuntime),
      "重启复用完整技能缓存",
    );
    facts.runtime.restarted = restartedRuntime;
    facts.checks.restartRestored = true;
    facts.workingSetBytes = workingSetBytes(app.child.pid);

    facts.package = {
      ...facts.package,
      ...physicalPackageFacts(),
    };
    facts.runtime.cache = runtimeCacheFacts(harness.auditRoot);
    insist(facts.runtime.cache.files > 500, "首次启动没有形成完整的本地技能缓存");
    insist(facts.package.looseBundledSkillFiles === 0, "发行目录出现了散装精选 Skill 文件");
    facts.checks.noLooseSkillFiles = true;
    facts.rendererErrors = [...new Set([...facts.rendererErrors, ...app.rendererErrors])];
    insist(facts.rendererErrors.length === 0, `renderer 报错：${facts.rendererErrors.join(" | ")}`);

    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[r11-skills] PASS ${Object.keys(facts.checks).length} checks`);
    console.log(`[r11-skills] facts ${relativeOutput(FACTS_PATH)}`);
  } finally {
    await harness.close();
  }
}

await run();
