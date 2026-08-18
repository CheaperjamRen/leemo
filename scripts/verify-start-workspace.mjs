import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = path.join(ROOT, "dist-electron", "main.mjs");
const require = createRequire(import.meta.url);
const electronExecutable = path.join(path.dirname(require.resolve("electron/package.json")), "dist", "electron.exe");
const packagedExecutable = process.env.LEEMO_PACKAGED_EXE
  ? path.resolve(process.env.LEEMO_PACKAGED_EXE)
  : null;
const port = Number(process.env.LEEMO_START_CDP_PORT ?? 9362);
const tempParent = fs.realpathSync(os.tmpdir());
const auditRoot = fs.mkdtempSync(path.join(tempParent, "leemo-e2e-start-workspace-"));
const outputDir = path.join(ROOT, ".tmp-visual-audit", "start-note-library");
const screenshot1440 = path.join(outputDir, "start-documents-1440x900.png");
const screenshotObjects1440 = path.join(outputDir, "start-documents-objects-1440x900.png");
const screenshotSource1440 = path.join(outputDir, "start-documents-source-1440x900.png");
const screenshot960 = path.join(outputDir, "start-documents-960x680.png");
const factsPath = path.join(outputDir, "start-workspace-facts.json");
const sourceDir = path.join(auditRoot, "source-files");
const externalFile = path.join(sourceDir, "面试资料.pdf");
const copiedFile = path.join(sourceDir, "作品集补充.txt");

function insist(value, message) {
  if (!value) throw new Error(message);
}

function killTree(child) {
  if (!child?.pid) return;
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

async function waitForCdp(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Electron 调试端口没有就绪：${lastError instanceof Error ? lastError.message : "timeout"}`);
}

function launch() {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, LEEMO_RENDERER_URL: _rendererUrl, ...cleanEnv } = process.env;
  const executable = packagedExecutable ?? electronExecutable;
  const applicationArgs = packagedExecutable ? [] : [MAIN];
  return spawn(executable, [
    `--remote-debugging-port=${port}`,
    "--disable-gpu",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows",
    ...applicationArgs,
    `--leemo-e2e-root=${auditRoot}`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function connect() {
  await waitForCdp();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url() && !page.url().startsWith("devtools://")) return { browser, page };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await browser.close();
  throw new Error("没有找到 Leemo 主窗口。");
}

async function instrumentModelCalls(page) {
  await page.waitForFunction(() => Boolean(window.leemoCapture && window.leemoBridge));
  await page.evaluate(() => {
    window.__leemoStartModelCalls = [];
    const original = window.leemoBridge.invoke.bind(window.leemoBridge);
    window.leemoBridge.invoke = (channel, payload) => {
      if (channel === "bridge:createConversation" || channel === "bridge:send") {
        window.__leemoStartModelCalls.push(channel);
      }
      return original(channel, payload);
    };
  });
}

async function invokeCapture(page, op, payload) {
  const result = await page.evaluate(async ({ operation, value }) => window.leemoCapture.invoke(operation, value), { operation: op, value: payload });
  insist(result.ok, `${op} 失败：${result.error ?? "unknown"}`);
  return result.response;
}

async function openDocuments(page) {
  const button = page.getByRole("button", { name: "我的文档", exact: true });
  const box = await button.boundingBox();
  if (!box || box.x + box.width <= 0 || box.x >= (await page.viewportSize()).width) {
    const navigation = page.getByRole("button", { name: /展开侧栏|打开开始导航/ });
    if (await navigation.count()) await navigation.click();
  }
  await button.click();
  await page.getByTestId("start-documents-view").waitFor();
}

async function openDocument(page, title) {
  await page.getByTestId("note-tree-root-drop").getByRole("button", { name: title, exact: true }).click();
  const titleInput = page.getByRole("textbox", { name: "文档标题" });
  await titleInput.waitFor();
  insist(await titleInput.inputValue() === title, `打开了错误的文档：${await titleInput.inputValue()}`);
}

async function ensureEditMode(page) {
  const editor = page.getByRole("textbox", { name: "便签正文" });
  if (await editor.count() === 0) await page.getByRole("button", { name: "编辑文档" }).click();
  await editor.waitFor();
  return editor;
}

async function seedAndExercise(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => Boolean(window.leemoPersist));
  const captureStorageRoot = path.join(auditRoot, "capture-storage");
  fs.mkdirSync(captureStorageRoot, { recursive: true });
  const prepared = await page.evaluate((storageRoot) => window.leemoPersist.invoke("saveSettings", {
    surface: "start",
    mode: "buddy",
    onboardingCompleted: true,
    globalOverviewAutoEnabled: false,
    captureStorageRoot: storageRoot,
  }), captureStorageRoot);
  insist(prepared.ok, `无法准备隔离验收设置：${prepared.error ?? "unknown"}`);
  await page.reload();
  await page.getByRole("heading", { name: "开始", exact: true }).waitFor();
  await instrumentModelCalls(page);
  await invokeCapture(page, "migrateStorageRoot", { newRoot: captureStorageRoot });
  await openDocuments(page);

  await page.getByRole("button", { name: "新建文档" }).first().click();
  await page.getByRole("textbox", { name: "文档标题" }).fill("求职主线与独立思考");
  await page.getByRole("button", { name: "编辑 Markdown 源码" }).click();
  const sourceEditor = page.getByRole("textbox", { name: "Markdown 源码" });
  await sourceEditor.fill([
    "# 这周真正要推进的事情",
    "",
    "这是一份只属于用户的安静工作文档。它可以容纳尚未成熟的判断，也不会因为记录了一句话就自动调用模型。",
    "",
    "## 主线",
    "",
    "- [ ] 打磨 Leemo 的产品故事与 PRD",
    "- [ ] 把简历按 AI 产品岗位重新组织",
    "- [ ] 梳理 WorkBuddy、Codex 与 Kimi 的真实工作流差异",
    "- [x] 已确认先由用户思考，再按需调用 AI",
    "",
    "> 先让自己的想法多活一会儿，再决定什么时候让 AI 介入。",
    "",
    "> [!IMPORTANT]",
    "> 这份文档先服务于人的判断，AI 只在用户明确需要时介入。",
    "",
    "公式 $\\sqrt{d_k}$ 与 ==待复核证据== 都应显示为对象。",
    "",
    "```ts",
    "const aiIntervenes = userRequested;",
    "```",
    "",
    "| 工作对象 | 当前状态 |",
    "| --- | :---: |",
    "| 产品故事 | 进行中 |",
    "",
    "## 观察",
    "",
    "记录本身不等于探索。降低输入后的即时反馈，才能保护注意力连续性。",
  ].join("\n"));
  await page.getByRole("button", { name: "编辑文档" }).click();
  const editor = await ensureEditMode(page);
  await page.getByRole("heading", { name: "这周真正要推进的事情" }).waitFor();
  await page.getByTestId("markdown-editor-callout").waitFor();
  await page.locator(".katex").first().waitFor();
  await page.locator(".capture-editor__highlight").waitFor();
  await page.locator(".capture-editor__code").waitFor();
  await page.getByRole("textbox", { name: "表头 1" }).waitFor();
  const renderedText = String(await editor.textContent());
  insist(!renderedText.includes("# 这周真正要推进的事情"), "所见即所得模式仍暴露标题源码");
  insist(!renderedText.includes("[!IMPORTANT]"), "所见即所得模式仍暴露高亮块源码");
  await page.getByRole("button", { name: "保存文档" }).click();
  await page.getByText("已保存", { exact: true }).waitFor();

  let notes = await invokeCapture(page, "listNotes");
  const parent = notes.find((note) => note.title === "求职主线与独立思考");
  insist(parent, "没有找到刚创建的父文档");
  const child = await invokeCapture(page, "createNote", { title: "产品故事证据", markdown: "# 证据\n\n保留可验证的用户路径与截图。" });
  const sibling = await invokeCapture(page, "createNote", { title: "临时灵感", markdown: "稍后再判断，不立即展开。" });
  await page.waitForTimeout(250);

  const childRow = page.getByRole("treeitem", { name: "产品故事证据" });
  const parentRow = page.getByRole("treeitem", { name: "求职主线与独立思考" });
  await childRow.dragTo(parentRow);
  await page.waitForFunction(async ({ id, expectedParent }) => {
    const result = await window.leemoCapture.invoke("listNotes");
    return result.ok && result.response.some((note) => note.id === id && note.parentId === expectedParent);
  }, { id: child.id, expectedParent: parent.id });

  notes = await invokeCapture(page, "listNotes");
  const latestParent = notes.find((note) => note.id === parent.id);
  await invokeCapture(page, "updateNote", {
    id: parent.id,
    expectedRevision: latestParent.revision,
    title: latestParent.title,
    markdown: `${latestParent.markdown}\n\n相关证据：[产品故事证据](leemo-note://${child.id})`,
  });
  await page.waitForTimeout(250);
  await openDocument(page, "求职主线与独立思考");
  await page.getByRole("link", { name: "产品故事证据" }).click();
  await page.getByRole("textbox", { name: "文档标题" }).waitFor();
  insist(await page.getByRole("textbox", { name: "文档标题" }).inputValue() === "产品故事证据", "本地引用没有打开目标文档");
  await page.getByLabel("被这些文档引用").getByRole("button", { name: "求职主线与独立思考", exact: true }).click();
  insist(await page.getByRole("textbox", { name: "文档标题" }).inputValue() === "求职主线与独立思考", "反向引用没有返回来源文档");

  await page.getByRole("button", { name: "从便签创建待办" }).click();
  const taskPanel = page.getByRole("region", { name: "创建待办预览" });
  await taskPanel.getByRole("button", { name: /创建 \d+ 条待办/ }).click();
  await page.getByText(/已创建 \d+ 条待办 · 便签原文保留/).waitFor();

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(externalFile, "%PDF-1.4\n% isolated fixture\n", "utf8");
  fs.writeFileSync(copiedFile, "isolated fixture", "utf8");
  notes = await invokeCapture(page, "listNotes");
  const beforeReference = notes.find((note) => note.id === parent.id);
  await invokeCapture(page, "attachExternalFile", { noteId: parent.id, expectedRevision: beforeReference.revision, path: externalFile });
  await page.waitForTimeout(250);
  await openDocument(page, "求职主线与独立思考");
  await page.getByText("面试资料.pdf", { exact: true }).waitFor();
  notes = await invokeCapture(page, "listNotes");
  const beforeCopy = notes.find((note) => note.id === parent.id);
  await invokeCapture(page, "attachFileCopy", { noteId: parent.id, expectedRevision: beforeCopy.revision, path: copiedFile });
  await page.waitForTimeout(250);
  await openDocument(page, "求职主线与独立思考");
  await page.getByText("作品集补充.txt", { exact: true }).waitFor();

  await ensureEditMode(page);
  await page.locator(".leemo-document-scroll").evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  const geometry1440 = await page.evaluate(() => {
    const workspace = document.querySelector(".leemo-document-workspace")?.getBoundingClientRect();
    const explorer = document.querySelector(".leemo-note-explorer")?.getBoundingClientRect();
    const canvas = document.querySelector(".leemo-document-canvas")?.getBoundingClientRect();
    const editor = document.querySelector('[aria-label="便签正文"]')?.getBoundingClientRect();
    return { workspace, explorer, canvas, editor, bodyScrollWidth: document.body.scrollWidth, bodyClientWidth: document.body.clientWidth };
  });
  insist(geometry1440.workspace.width >= 1_000, `1440 下文档工作面过窄：${geometry1440.workspace.width}`);
  insist(geometry1440.editor.height >= 500, `编辑首屏过矮：${geometry1440.editor.height}`);
  insist(geometry1440.bodyScrollWidth <= geometry1440.bodyClientWidth + 1, "1440 页面出现水平滚动");
  await page.screenshot({ path: screenshot1440, animations: "disabled" });
  await page.getByRole("textbox", { name: "表头 1" }).scrollIntoViewIfNeeded();
  const richEditorVisualContract = await page.evaluate(() => {
    const scroll = document.querySelector(".leemo-document-scroll");
    const toolbar = document.querySelector(".leemo-document-editor-wrap .capture-editor__toolbar");
    const unchecked = document.querySelector(".capture-editor__list-item--unchecked");
    const checked = document.querySelector(".capture-editor__list-item--checked");
    scroll.scrollTo({ top: 320, left: 0 });
    const scrollRect = scroll.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      toolbarPosition: getComputedStyle(toolbar).position,
      toolbarPinned: Math.abs(toolbarRect.top - scrollRect.top) <= 2,
      uncheckedRadius: getComputedStyle(unchecked, "::before").borderRadius,
      checkedContent: getComputedStyle(checked, "::before").content,
    };
  });
  insist(richEditorVisualContract.toolbarPosition === "sticky" && richEditorVisualContract.toolbarPinned, "长文滚动后格式栏没有保持可达");
  insist(richEditorVisualContract.uncheckedRadius === "4px", `清单仍显示为单选圆点：${richEditorVisualContract.uncheckedRadius}`);
  insist(richEditorVisualContract.checkedContent.includes("✓"), "已完成清单没有显示勾选状态");
  await page.screenshot({ path: screenshotObjects1440, animations: "disabled" });
  await page.getByRole("button", { name: "编辑 Markdown 源码" }).click();
  const visibleSourceEditor = page.getByRole("textbox", { name: "Markdown 源码" });
  await visibleSourceEditor.waitFor();
  await page.locator(".leemo-document-scroll").evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  await visibleSourceEditor.evaluate((element) => { element.scrollTop = 0; });
  const sourceEditorVisualContract = await visibleSourceEditor.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    hasInnerScroll: element.scrollHeight > element.clientHeight + 1,
  }));
  insist(sourceEditorVisualContract.overflowY === "hidden" && !sourceEditorVisualContract.hasInnerScroll, "Markdown 源码仍有嵌套滚动条");
  await page.screenshot({ path: screenshotSource1440, animations: "disabled" });
  await page.getByRole("button", { name: "编辑文档" }).click();
  await ensureEditMode(page);

  await page.getByRole("button", { name: "归档文档" }).click();
  await page.getByRole("dialog", { name: "归档父便签" }).getByRole("button", { name: "连同子便签一起处理" }).click();
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await openDocument(page, "求职主线与独立思考");
  await page.getByRole("button", { name: "恢复文档" }).click();
  await page.getByTestId("start-documents-view").waitFor();

  await openDocument(page, "求职主线与独立思考");
  await page.getByRole("button", { name: "移到回收站" }).click();
  await page.getByRole("dialog", { name: "删除父便签" }).getByRole("button", { name: "连同子便签一起处理" }).click();
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await page.getByRole("button", { name: "恢复便签 求职主线与独立思考" }).click();
  await page.getByText("回收站是空的。", { exact: true }).waitFor();
  await openDocuments(page);
  await openDocument(page, "求职主线与独立思考");
  const restored = await invokeCapture(page, "listNotes");
  insist(restored.some((note) => note.id === child.id && note.parentId === parent.id), "归档/回收站恢复后父子结构丢失");
  insist(restored.some((note) => note.id === sibling.id), "无关文档在树操作中丢失");

  const modelCalls = await page.evaluate(() => window.__leemoStartModelCalls ?? []);
  insist(modelCalls.length === 0, `静态 Start 操作意外调用模型：${modelCalls.join(", ")}`);
  return { parentId: parent.id, childId: child.id, geometry1440, modelCalls, richEditorVisualContract, sourceEditorVisualContract };
}

async function verifyRestart(page, ids) {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.getByRole("heading", { name: "开始", exact: true }).waitFor();
  await instrumentModelCalls(page);
  await openDocuments(page);
  await openDocument(page, "求职主线与独立思考");
  await ensureEditMode(page);
  await page.locator(".leemo-document-scroll").evaluate((element) => element.scrollTo({ top: 0, left: 0 }));
  await page.getByText("作品集补充.txt", { exact: true }).waitFor();
  const state = await page.evaluate(async ({ parentId, childId }) => {
    const notes = await window.leemoCapture.invoke("listNotes");
    return {
      parent: notes.response.find((note) => note.id === parentId),
      child: notes.response.find((note) => note.id === childId),
      geometry: {
        workspace: document.querySelector(".leemo-document-workspace")?.getBoundingClientRect(),
        explorer: document.querySelector(".leemo-note-explorer")?.getBoundingClientRect(),
        editor: document.querySelector('[aria-label="便签正文"]')?.getBoundingClientRect(),
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      },
      modelCalls: window.__leemoStartModelCalls ?? [],
    };
  }, ids);
  insist(state.parent && state.child, "重启后文档丢失");
  insist(state.child.parentId === ids.parentId, "重启后父子结构丢失");
  insist(state.geometry.workspace.width >= 620, `960 下文档工作面过窄：${state.geometry.workspace.width}`);
  insist(state.geometry.editor.height >= 360, `960 下编辑区过矮：${state.geometry.editor.height}`);
  insist(state.geometry.bodyScrollWidth <= state.geometry.bodyClientWidth + 1, "960 页面出现水平滚动");
  insist(state.modelCalls.length === 0, "重启后静态打开意外调用模型");
  await page.screenshot({ path: screenshot960, animations: "disabled" });
  return state;
}

let child;
let restarted;
let connected;
const rendererErrors = [];
try {
  insist(packagedExecutable ? fs.existsSync(packagedExecutable) : fs.existsSync(MAIN), packagedExecutable
    ? `缺少打包版可执行文件：${packagedExecutable}`
    : "缺少 dist-electron/main.mjs，请先运行 npm run build:main");
  fs.mkdirSync(outputDir, { recursive: true });
  child = launch();
  connected = await connect();
  connected.page.on("console", (message) => { if (message.type() === "error") rendererErrors.push(message.text()); });
  connected.page.on("pageerror", (error) => rendererErrors.push(error.message));
  const first = await seedAndExercise(connected.page);
  await connected.browser.close();
  connected = undefined;
  killTree(child);
  child = undefined;
  await new Promise((resolve) => setTimeout(resolve, 700));

  restarted = launch();
  connected = await connect();
  connected.page.on("console", (message) => { if (message.type() === "error") rendererErrors.push(message.text()); });
  connected.page.on("pageerror", (error) => rendererErrors.push(error.message));
  const restart = await verifyRestart(connected.page, first);
  insist(rendererErrors.length === 0, `renderer 控制台错误：${rendererErrors.join(" | ")}`);

  const facts = {
    pass: true,
    checkedAt: new Date().toISOString(),
    runtime: packagedExecutable ? "packaged" : "development-build",
    isolatedRoot: auditRoot,
    screenshots: [
      path.relative(ROOT, screenshot1440).replaceAll(path.sep, "/"),
      path.relative(ROOT, screenshotObjects1440).replaceAll(path.sep, "/"),
      path.relative(ROOT, screenshotSource1440).replaceAll(path.sep, "/"),
      path.relative(ROOT, screenshot960).replaceAll(path.sep, "/"),
    ],
    zeroModelCalls: true,
    restartRecovered: true,
    treeRecovered: true,
    attachmentsRecovered: true,
    linkedTodoCreated: true,
    richMarkdownObjects: true,
    sourceModeSwitch: true,
    editorVisualContract: {
      ...first.richEditorVisualContract,
      ...first.sourceEditorVisualContract,
    },
    geometry1440: first.geometry1440,
    geometry960: restart.geometry,
    rendererConsoleErrors: 0,
  };
  fs.writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  const logs = [child, restarted].flatMap((process) => process?.logs ?? []);
  if (logs.length > 0) console.error(logs.join("\n"));
  throw error;
} finally {
  if (connected) await connected.browser.close().catch(() => undefined);
  killTree(restarted ?? child);
  const resolved = path.resolve(auditRoot);
  const expectedPrefix = `${tempParent}${path.sep}leemo-e2e-start-workspace-`;
  if (resolved.startsWith(expectedPrefix)) fs.rmSync(resolved, { recursive: true, force: true });
}
