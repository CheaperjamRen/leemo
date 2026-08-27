// Packaged r11 external-project acceptance. Every filesystem operand lives
// under one validated --leemo-e2e-root; the model is a loopback mock and the
// visible "打开文件夹" action uses the guarded E2E picker candidate.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  ROOT,
  OUTPUT_DIR,
  MODEL_ID,
  configureLoopbackProvider,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
  listMemory,
  newConversation,
  openSettingsTab,
  runVisiblePrompt,
} from "./verify-memory-workspace.mjs";

const PREFIX = "leemo-e2e-r11-external-";
const PROJECT_DIR_NAME = "毕业设计项目";
const ARTIFACT_NAME = "项目进展.md";
const ARTIFACT_CONTENT = "# 本周进展\n\n- 梳理研究问题和文献框架\n- 完成访谈提纲初稿\n- 整理下一轮验证计划\n";
const ARTIFACT_TASK_MARKER = "请在当前毕业设计项目根目录新建一份项目进展.md";
const REFERENCED_FILE_NAME = "课程计划.md";
const REFERENCED_FILE_ORIGINAL = "# 课程计划\n\n先阅读论文。\n";
const REFERENCED_FILE_UPDATED = "# 课程计划\n\n先阅读论文，再整理三条核心结论。\n";
const REFERENCED_EDIT_TASK_MARKER = "请先读取我引用的课程计划";
const PROJECT_MEMORY = "毕业设计项目使用 pnpm，并优先保持离线可运行";
const FACTS_PATH = path.join(OUTPUT_DIR, "r11-external-workspace-facts.json");
const PROJECT_SCREENSHOT = path.join(OUTPUT_DIR, "r11-external-workspace.png");
const REFERENCED_EDIT_SCREENSHOT = path.join(OUTPUT_DIR, "r11-external-referenced-edit.png");
const MEMORY_SCREENSHOT = path.join(OUTPUT_DIR, "r11-external-memory-720x640.png");
const MISSING_SCREENSHOT = path.join(OUTPUT_DIR, "r11-external-missing-folder.png");

const PROMPTS = {
  artifact: `${ARTIFACT_TASK_MARKER}，记录本周完成的研究梳理、访谈提纲和下一轮验证计划。`,
  editReference: `${REFERENCED_EDIT_TASK_MARKER}，再把第二段改成“先阅读论文，再整理三条核心结论。”，最后重新读取确认。`,
  remember: `R11_TASK_REMEMBER：请记住当前项目约定：${PROJECT_MEMORY}。完成后简短回复。`,
  continue: "R11_TASK_CONTINUE：这是重启恢复测试，请只回复 R11_CONTINUE_OK。",
};

const FINAL = {
  artifact: "已经把本周进展整理到 项目进展.md，并保存在当前项目根目录。",
  editReference: "课程计划已更新，并重新读取确认。",
  remember: "R11_MEMORY_OK",
  continue: "R11_CONTINUE_OK",
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function idleProcessFacts(rootPid) {
  const raw = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const snapshot = JSON.parse(raw);
  const processes = Array.isArray(snapshot) ? snapshot : [snapshot];
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (!included.has(process.ProcessId) && included.has(process.ParentProcessId)) {
        included.add(process.ProcessId);
        changed = true;
      }
    }
  }
  const tree = processes.filter((process) => included.has(process.ProcessId));
  insist(tree.some((process) => process.ProcessId === rootPid), `没有找到 Leemo 根进程 ${rootPid}`);
  return {
    processCount: tree.length,
    workingSetBytes: tree.reduce((sum, process) => sum + Number(process.WorkingSetSize), 0),
  };
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
    id: "chatcmpl-leemo-r11-external",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 18, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function writeToolCall(response, model, toolName, args, sequence) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-leemo-r11-tool-${sequence}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({
    ...base,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: `call_leemo_r11_${sequence}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: null,
    }],
  });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  response.end("data: [DONE]\n\n");
}

function latestTask(serialized) {
  const latest = [ARTIFACT_TASK_MARKER, REFERENCED_EDIT_TASK_MARKER, "R11_TASK_REMEMBER", "R11_TASK_CONTINUE"]
    .map((marker) => ({ marker, index: serialized.lastIndexOf(marker) }))
    .sort((left, right) => right.index - left.index)[0];
  return latest && latest.index >= 0 ? latest.marker : undefined;
}

function streamRouter(response, body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serialized = JSON.stringify(messages);
  const last = messages.at(-1);
  const lastSerialized = JSON.stringify(last ?? {});
  const hasToolResult = last?.role === "tool"
    || lastSerialized.includes("tool_call_id")
    || lastSerialized.includes("tool_result");
  const tools = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
    : [];
  const model = typeof body.model === "string" ? body.model : MODEL_ID;
  const call = (kind, args) => {
    const toolName = kind === "remember"
      ? tools.find((name) => name === "mcp__leemo-memory__remember" || /(?:^|__)remember$/i.test(name))
      : tools.find((name) => name === kind || new RegExp(`(?:^|__)${kind}$`, "i").test(name));
    insist(toolName, `本机 mock 没收到 ${kind} 工具`);
    state.toolCalls.push({ expected: kind, toolName, args });
    writeToolCall(response, model, toolName, args, state.toolCalls.length);
  };

  switch (latestTask(serialized)) {
    case ARTIFACT_TASK_MARKER:
      if (!hasToolResult) call("Write", { file_path: ARTIFACT_NAME, content: ARTIFACT_CONTENT });
      else writeSuccess(response, model, FINAL.artifact);
      return;
    case REFERENCED_EDIT_TASK_MARKER: {
      const stage = state.referencedEditStage ?? 0;
      if (stage === 0) {
        insist(serialized.includes("LEEMO_ATTACHMENTS_JSON"), "引用文件没有进入模型上下文");
        insist(serialized.includes(`\\\"workspacePath\\\": \\\"${REFERENCED_FILE_NAME}\\\"`), "引用文件没有保留当前本子相对路径");
        state.referencedEditMetadataObserved = true;
        state.referencedEditStage = 1;
        call("Read", { file_path: REFERENCED_FILE_NAME });
      } else if (stage === 1) {
        insist(lastSerialized.includes("先阅读论文。"), "模型没有读到引用文件原文");
        state.referencedEditStage = 2;
        call("Edit", {
          file_path: REFERENCED_FILE_NAME,
          old_string: "先阅读论文。",
          new_string: "先阅读论文，再整理三条核心结论。",
        });
      } else if (stage === 2) {
        state.referencedEditStage = 3;
        call("Read", { file_path: REFERENCED_FILE_NAME });
      } else {
        insist(lastSerialized.includes("先阅读论文，再整理三条核心结论。"), "模型没有读回修改后的文件内容");
        state.referencedEditReadBack = true;
        writeSuccess(response, model, FINAL.editReference);
      }
      return;
    }
    case "R11_TASK_REMEMBER":
      if (!hasToolResult) call("remember", {
        topic: "项目约定",
        statement: PROJECT_MEMORY,
        kind: "state",
      });
      else writeSuccess(response, model, FINAL.remember);
      return;
    case "R11_TASK_CONTINUE":
      writeSuccess(response, model, FINAL.continue);
      return;
    default:
      writeSuccess(response, model, "R11_LOCAL_PROBE_OK");
  }
}

async function workspaceList(page) {
  return page.evaluate(async () => {
    const response = await window.leemoWorkspace.invoke("listWorkspaces", undefined);
    if (!response.ok) throw new Error(response.error || "listWorkspaces failed");
    return response.response;
  });
}

async function openControlledWorkspace(page) {
  await page.getByRole("button", { name: /^选择本子，当前 / }).click();
  await page.getByRole("menuitem", { name: "打开已有文件夹", exact: true }).click();
  await page.getByRole("button", { name: `选择本子，当前 ${PROJECT_DIR_NAME}` }).waitFor({ state: "visible" });
  await page.getByText(/已作为本子打开/).waitFor({ state: "visible" });
}

async function switchWorkspace(page, name) {
  await page.getByRole("button", { name: /^选择本子，当前 / }).click();
  await page.getByRole("menuitem", { name: `打开本子 ${name}` }).click();
  await page.getByRole("button", { name: `选择本子，当前 ${name}` }).waitFor({ state: "visible" });
}

async function ensureFileTree(page) {
  if (!await page.getByTestId("file-tree").isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "文件", exact: true }).click();
  }
  await page.getByTestId("file-tree").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "刷新文件树", exact: true }).click();
}

async function layoutFacts(page) {
  return page.evaluate(() => {
    const textarea = document.querySelector('textarea[aria-label="输入消息"]');
    const settings = document.querySelector('[data-testid="settings-window"]');
    const textareaRect = textarea?.getBoundingClientRect();
    const settingsRect = settings?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      composerInsideViewport: textareaRect
        ? textareaRect.left >= -1 && textareaRect.right <= window.innerWidth + 1
          && textareaRect.top >= -1 && textareaRect.bottom <= window.innerHeight + 1
        : null,
      settingsInsideViewport: settingsRect
        ? settingsRect.left >= -1 && settingsRect.right <= window.innerWidth + 1
          && settingsRect.top >= -1 && settingsRect.bottom <= window.innerHeight + 1
        : null,
    };
  });
}

async function captureViewportMatrix(page) {
  const results = [];
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [720, 640]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const facts = await layoutFacts(page);
    insist(facts.horizontalOverflow === 0, `${width}x${height} 横向溢出 ${facts.horizontalOverflow}px`);
    insist(facts.composerInsideViewport === true, `${width}x${height} 输入框没有完整展示`);
    results.push(facts);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  return results;
}

function readConversationArchives(projectRoot) {
  const directory = path.join(projectRoot, ".leemo", "conversations");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
}

function relativeOutput(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

async function run() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let firstLaunch = true;
  const harness = await createMemoryAcceptanceHarness({
    prefix: PREFIX,
    streamRouter,
    launchArgs: (auditRoot) => {
      const projectRoot = path.join(auditRoot, PROJECT_DIR_NAME);
      if (!firstLaunch) return [];
      firstLaunch = false;
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, REFERENCED_FILE_NAME), REFERENCED_FILE_ORIGINAL, "utf8");
      return [`--leemo-e2e-workspace=${projectRoot}`];
    },
  });
  const projectRoot = path.join(harness.auditRoot, PROJECT_DIR_NAME);
  const missingRoot = path.join(harness.auditRoot, `${PROJECT_DIR_NAME}-暂时移开`);
  const facts = { checks: {}, screenshots: {}, viewports: [], rendererErrors: [] };

  try {
    let app = await harness.start("首次启动");
    await configureLoopbackProvider(app.page, harness.baseUrl);
    await ensureWorkbench(app.page);
    await openControlledWorkspace(app.page);
    const external = (await workspaceList(app.page)).find((entry) => entry.kind === "external");
    insist(external?.available === true, "受控 picker 没有登记可用的外部项目");
    facts.workspaceId = external.id;

    await newConversation(app.page);
    await runVisiblePrompt(app.page, PROMPTS.artifact, FINAL.artifact);
    const artifactPath = path.join(projectRoot, ARTIFACT_NAME);
    insist(fs.readFileSync(artifactPath, "utf8") === ARTIFACT_CONTENT, "产物没有直接写到外部项目根目录");
    insist(!fs.existsSync(path.join(harness.workspaceRoot, "默认工作区", ARTIFACT_NAME)), "外部项目产物串进默认工作区");

    await ensureFileTree(app.page);
    await app.page.getByTestId(`file-row-${ARTIFACT_NAME}`).click();
    await app.page.getByRole("heading", { name: "本周进展", exact: true }).waitFor({ state: "visible" });
    await app.page.getByRole("button", { name: `选择本子，当前 ${PROJECT_DIR_NAME}` }).waitFor({ state: "visible" });
    await app.page.screenshot({ path: PROJECT_SCREENSHOT, animations: "disabled" });
    facts.screenshots.project = relativeOutput(PROJECT_SCREENSHOT);

    await newConversation(app.page);
    const composer = app.page.locator('textarea[aria-label="输入消息"]');
    await composer.fill(`${PROMPTS.editReference} @课程`);
    const mentionMenu = app.page.getByRole("listbox", { name: "引用工作区文件" });
    await mentionMenu.waitFor({ state: "visible" });
    await app.page.getByRole("option", { name: new RegExp(REFERENCED_FILE_NAME.replace(".", "\\.")) }).click();
    await app.page.getByRole("button", { name: `移除引用 ${REFERENCED_FILE_NAME}` }).waitFor({ state: "visible" });
    await runVisiblePrompt(app.page, PROMPTS.editReference, FINAL.editReference);
    const referencedFilePath = path.join(projectRoot, REFERENCED_FILE_NAME);
    insist(fs.readFileSync(referencedFilePath, "utf8") === REFERENCED_FILE_UPDATED, "引用文件没有按要求原位修改");
    insist(harness.state.referencedEditReadBack === true, "模型没有在修改后重新读取文件");
    const fileReceipt = app.page.locator("[data-file-delivery-receipt]").last();
    await fileReceipt.waitFor({ state: "visible" });
    insist((await fileReceipt.innerText()).includes("本轮交付 1 个文件"), "完成回执没有说清单文件交付数量");
    insist((await fileReceipt.innerText()).includes("修改"), "完成回执没有说清文件修改状态");
    await fileReceipt.getByRole("button", { name: `预览 ${REFERENCED_FILE_NAME}` }).click();
    await app.page.getByText("先阅读论文，再整理三条核心结论。", { exact: true }).waitFor({ state: "visible" });
    await app.page.keyboard.press("Escape");
    await app.page.screenshot({ path: REFERENCED_EDIT_SCREENSHOT, animations: "disabled" });
    facts.screenshots.referencedEdit = relativeOutput(REFERENCED_EDIT_SCREENSHOT);

    await newConversation(app.page);
    await runVisiblePrompt(app.page, PROMPTS.remember, FINAL.remember);
    await app.page.locator("[data-memory-receipt]").last().waitFor({ state: "visible" });
    const projectMemories = await listMemory(app.page, [{ type: "workspace", workspaceId: external.id }]);
    const globalMemories = await listMemory(app.page, [{ type: "global" }]);
    insist(projectMemories.some((record) => record.statement === PROJECT_MEMORY), "项目约定没有写入项目记忆");
    insist(!globalMemories.some((record) => record.statement === PROJECT_MEMORY), "项目约定污染了全局用户画像");

    await app.page.setViewportSize({ width: 720, height: 640 });
    await openSettingsTab(app.page, "个性化");
    await app.page.getByRole("button", { name: "只看本子记忆" }).click();
    const selectedDirectory = await app.page.getByRole("combobox", { name: "要打开的记忆目录" }).inputValue();
    insist(selectedDirectory === `workspace:${external.id}`, "项目筛选没有联动到当前项目目录");
    const projectMemory = app.page.getByText(PROJECT_MEMORY, { exact: true });
    await projectMemory.waitFor({ state: "visible" });
    await app.page.getByText(PROJECT_DIR_NAME, { exact: true }).first().waitFor({ state: "visible" });
    await projectMemory.scrollIntoViewIfNeeded();
    await app.page.waitForTimeout(80);
    const memoryLayout = await layoutFacts(app.page);
    insist(memoryLayout.horizontalOverflow === 0 && memoryLayout.settingsInsideViewport === true, "最小窗口项目记忆设置越界");
    await app.page.screenshot({ path: MEMORY_SCREENSHOT, animations: "disabled" });
    facts.screenshots.memory = relativeOutput(MEMORY_SCREENSHOT);
    await app.page.getByRole("button", { name: "关闭设置", exact: true }).click();
    facts.viewports = await captureViewportMatrix(app.page);

    const archivesBeforeRestart = readConversationArchives(projectRoot);
    insist(archivesBeforeRestart.length >= 3, "外部项目没有生成便携对话归档");
    insist(archivesBeforeRestart.every((entry) => entry.meta.workspaceId === external.id), "归档缺少项目归属");
    insist(!JSON.stringify(archivesBeforeRestart).includes(projectRoot), "便携对话归档泄露了本机绝对路径");
    const ledgerPath = path.join(projectRoot, ".leemo", "memory", "ledger.jsonl");
    insist(fs.readFileSync(ledgerPath, "utf8").includes(PROJECT_MEMORY), "项目记忆账本未落盘");

    facts.rendererErrors.push(...app.rendererErrors);
    app = await harness.restart("正常重启");
    await ensureWorkbench(app.page);
    await switchWorkspace(app.page, PROJECT_DIR_NAME);
    insist((await app.page.locator('aside [data-conversation-id]').count()) >= 3, "重启后本子对话没有恢复");
    insist(fs.readFileSync(path.join(projectRoot, REFERENCED_FILE_NAME), "utf8") === REFERENCED_FILE_UPDATED, "重启后引用文件修改丢失");
    await runVisiblePrompt(app.page, PROMPTS.continue, FINAL.continue);
    facts.checks.restartContinued = true;

    facts.rendererErrors.push(...app.rendererErrors);
    await harness.stop();
    fs.renameSync(projectRoot, missingRoot);
    app = await harness.start("目录暂时不可用");
    await ensureWorkbench(app.page);
    const unavailable = (await workspaceList(app.page)).find((entry) => entry.id === external.id);
    insist(unavailable?.available === false, "目录移开后没有标记为不可用");
    await app.page.getByRole("button", { name: /^选择本子，当前 / }).click();
    await app.page.getByText("找不到文件夹", { exact: true }).waitFor({ state: "visible" });
    await app.page.screenshot({ path: MISSING_SCREENSHOT, animations: "disabled" });
    facts.screenshots.missing = relativeOutput(MISSING_SCREENSHOT);

    facts.rendererErrors.push(...app.rendererErrors);
    await harness.stop();
    fs.renameSync(missingRoot, projectRoot);
    app = await harness.start("目录恢复");
    await ensureWorkbench(app.page);
    await switchWorkspace(app.page, PROJECT_DIR_NAME);
    insist((await app.page.locator('aside [data-conversation-id]').count()) >= 3, "目录恢复后本子对话没有回来");
    const restoredEntries = (await workspaceList(app.page)).filter((entry) => entry.id === external.id);
    insist(restoredEntries.length === 1 && restoredEntries[0].available, "目录恢复后没有复用原项目 id");
    const restoredMemory = await listMemory(app.page, [{ type: "workspace", workspaceId: external.id }]);
    insist(restoredMemory.some((record) => record.statement === PROJECT_MEMORY), "目录恢复后项目记忆没有回来");

    await app.page.getByRole("button", { name: /^选择本子，当前 / }).click();
    await app.page.getByRole("button", { name: `从本子列表移除 ${PROJECT_DIR_NAME}` }).click();
    await app.page.getByRole("button", { name: "选择本子，当前 Leemo 工作台" }).waitFor({ state: "visible" });
    insist(fs.existsSync(projectRoot), "移除最近记录删除了用户项目目录");
    insist(fs.existsSync(path.join(projectRoot, ".leemo")), "移除最近记录删除了项目里的 Leemo 数据");
    insist(!(await workspaceList(app.page)).some((entry) => entry.id === external.id), "最近项目记录没有移除");

    const referencedEditToolSequence = harness.state.toolCalls
      .filter((call) => call.args?.file_path === REFERENCED_FILE_NAME)
      .map((call) => call.expected);
    insist(JSON.stringify(referencedEditToolSequence) === JSON.stringify(["Read", "Edit", "Read"]), "引用文件工具顺序不是 Read → Edit → Read");
    insist(harness.state.referencedEditMetadataObserved === true, "模型请求没有经过引用元数据校验");
    facts.externalApiCalls = 0;
    facts.modelCostUsd = 0;
    facts.referencedEditToolSequence = referencedEditToolSequence;
    facts.checks = {
      controlledPicker: true,
      artifactAtProjectRoot: true,
      artifactVisibleInTreeAndPreview: true,
      referencedFileReadEditedAndReadBack: true,
      fileChangeReceiptOpenedPreview: true,
      referencedEditSurvivedRestart: true,
      portableArchiveContainsNoAbsolutePath: true,
      portableConversationArchive: true,
      projectMemoryIsolated: true,
      restartContinued: true,
      unavailableStateVisible: true,
      restoredWithoutSecondId: true,
      forgetKeptDirectory: true,
    };
    facts.workspaceId = external.id;
    facts.projectArchiveCount = readConversationArchives(projectRoot).length;
    facts.startupMs = app.startupMs;
    await app.page.waitForTimeout(1_000);
    facts.idleProcessTree = idleProcessFacts(app.child.pid);
    insist(
      facts.idleProcessTree.workingSetBytes > 0 && facts.idleProcessTree.workingSetBytes < 2 * 1024 * 1024 * 1024,
      `空闲进程树内存异常：${facts.idleProcessTree.workingSetBytes}`,
    );
    facts.rendererErrors.push(...app.rendererErrors);
    insist(facts.rendererErrors.length === 0, `renderer 有错误：${facts.rendererErrors.join(" | ")}`);
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[r11-external] PASS ${Object.keys(facts.checks).length} checks`);
    console.log(`[r11-external] facts ${relativeOutput(FACTS_PATH)}`);
  } catch (error) {
    const logs = harness.current?.logs?.join("")?.trim();
    if (logs) console.error(`[r11-external] packaged host log:\n${logs.slice(-8_000)}`);
    throw error;
  } finally {
    await harness.close();
    await sleep(50);
  }
}

await run();
