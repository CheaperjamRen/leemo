// Restart + migration acceptance for the packaged r10 memory layer.
// The imported harness launches Leemo with --leemo-e2e-root=<temp> and serves
// its zero-cost model only on 127.0.0.1, so this script never opens or mutates
// the user's real home, userData, workspace, or paid provider.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OUTPUT_DIR,
  ROOT,
  TEST_KEY,
  configureLoopbackProvider,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
  listMemory,
  newConversation,
  runVisiblePrompt,
  scopeFiles,
  selectNotebook,
} from "./verify-memory-workspace.mjs";

const NOTEBOOK_A = "春招";
const NOTEBOOK_B = "课程";
const OLD_FACT = "用户目前在海城大学读书";
const CURRENT_FACT = "用户已从海城大学毕业，目前在星河科技工作";
const NOTEBOOK_FACT = "春招本子的目标是完成三次模拟面试";
const FACTS_PATH = path.join(OUTPUT_DIR, "r10-memory-restart-facts.json");
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, "r10-memory-restart.png");

const PROMPTS = {
  rememberOld: `R10_RESTART_REMEMBER_OLD：请长期记住：${OLD_FACT}。`,
  rememberNew: `R10_RESTART_REMEMBER_NEW：这件事变了，请更新长期记忆：${CURRENT_FACT}。`,
  notebookA: `R10_RESTART_NOTEBOOK_A：请作为当前本子约定记住：${NOTEBOOK_FACT}。`,
  artifact: "R10_RESTART_ARTIFACT：请把一份普通研究笔记写成 restart-research-note.md，不要把文档正文当作长期记忆。",
  recallCurrent: "R10_RESTART_RECALL_CURRENT：重启后核对我现在是在读书还是在工作。",
  globalInNotebook: "R10_RESTART_GLOBAL_IN_NOTEBOOK：在本子里核对我的全局学习工作状态。",
  notebookLeak: "R10_RESTART_NOTEBOOK_LEAK：核对当前本子的模拟面试目标；找不到就如实说找不到。",
};

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function seedFile(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

function allTextFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...allTextFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function idleProcessFacts(rootPid) {
  const raw = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name | ConvertTo-Json -Compress",
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
  const tree = processes
    .filter((process) => included.has(process.ProcessId))
    .map((process) => ({
      name: process.Name,
      pid: process.ProcessId,
      parentPid: process.ParentProcessId,
      workingSetBytes: Number(process.WorkingSetSize),
    }));
  insist(tree.some((process) => process.pid === rootPid), `没有找到 Leemo 根进程 ${rootPid}`);
  return {
    processCount: tree.length,
    totalWorkingSetBytes: tree.reduce((sum, process) => sum + process.workingSetBytes, 0),
    processes: tree,
  };
}

async function seedLegacyCopy(workspaceRoot) {
  fs.mkdirSync(path.join(workspaceRoot, NOTEBOOK_A), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, NOTEBOOK_B), { recursive: true });
  seedFile(
    path.join(workspaceRoot, "memory", "profile.md"),
    "# 旧资料\n\n- 用户习惯先看结论。\n",
  );
  seedFile(
    path.join(workspaceRoot, "memory", "research-ai-memory.md"),
    "# 普通研究文档\n\n这是一份产物，不是用户画像。\n",
  );
}

async function runRestartAcceptance() {
  const harness = await createMemoryAcceptanceHarness({
    prefix: "leemo-e2e-r10-memory-restart-",
    seedWorkspace: seedLegacyCopy,
  });
  try {
    let app = await harness.start("迁移与写入阶段");
    let { page } = app;
    const firstStartupMs = app.startupMs;
    const firstRendererErrors = app.rendererErrors;
    await configureLoopbackProvider(page, harness.baseUrl);
    await ensureWorkbench(page);

    await selectNotebook(page, null);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.rememberOld, "R10_RESTART_OLD_SAVED");
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.rememberNew, "R10_RESTART_NEW_SAVED");

    await selectNotebook(page, NOTEBOOK_A);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.notebookA, "R10_RESTART_NOTEBOOK_SAVED");

    await selectNotebook(page, null);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.artifact, "R10_RESTART_ARTIFACT_OK");
    const researchArtifact = path.join(harness.workspaceRoot, "默认工作区", "restart-research-note.md");
    insist(fs.existsSync(researchArtifact), "重启前普通研究文档没有进入默认工作区");

    const beforeRestart = await listMemory(page, [
      { type: "global" },
      { type: "notebook", notebookId: NOTEBOOK_A },
    ], true);
    insist(beforeRestart.some((record) => record.statement === OLD_FACT && record.status === "superseded"), "旧值没有被标记为已替代");
    insist(beforeRestart.some((record) => record.statement === CURRENT_FACT && record.status === "current"), "新值没有成为当前记忆");
    insist(beforeRestart.some((record) => record.statement === NOTEBOOK_FACT && record.status === "current"), "本子记忆没有落盘");

    app = await harness.restart("重启读取阶段");
    page = app.page;
    const restartStartupMs = app.startupMs;
    await ensureWorkbench(page);
    await page.waitForTimeout(1_000);
    const idleProcesses = idleProcessFacts(app.child.pid);

    await selectNotebook(page, null);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.recallCurrent, "R10_RESTART_CURRENT_OK");

    await selectNotebook(page, NOTEBOOK_A);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.globalInNotebook, "R10_RESTART_GLOBAL_OK");

    await selectNotebook(page, NOTEBOOK_B);
    await newConversation(page);
    await runVisiblePrompt(page, PROMPTS.notebookLeak, "R10_RESTART_NOTEBOOK_ISOLATED");

    const afterRestart = await listMemory(page, [
      { type: "global" },
      { type: "notebook", notebookId: NOTEBOOK_A },
      { type: "notebook", notebookId: NOTEBOOK_B },
    ], true);
    const currentGlobal = afterRestart.filter((record) => record.scope.type === "global" && record.status === "current");
    insist(currentGlobal.some((record) => record.statement === CURRENT_FACT), "重启后当前全局记忆丢失");
    insist(!currentGlobal.some((record) => record.statement === OLD_FACT), "重启后旧值重新变成当前值");
    insist(!afterRestart.some((record) => record.scope.type === "notebook" && record.scope.notebookId === NOTEBOOK_B && record.statement === NOTEBOOK_FACT), "本子记忆泄露到另一本子");

    const manifestPath = path.join(harness.workspaceRoot, ".leemo", "migrations", "memory-v1.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    insist(manifest.completed === true, "旧记忆迁移没有完整完成");
    insist(manifest.archived.some((move) => move.from.endsWith(path.join("memory", "profile.md")) && fs.existsSync(move.to)), "旧记忆归档缺少可追溯映射");
    insist(manifest.movedArtifacts.some((move) => move.from.endsWith(path.join("memory", "research-ai-memory.md")) && fs.existsSync(move.to)), "普通研究文档迁移缺少可追溯映射");
    insist(fs.existsSync(path.join(harness.workspaceRoot, "默认工作区", "research-ai-memory.md")), "旧普通文档没有进入默认工作区");

    const globalRuntimeFiles = scopeFiles(harness.workspaceRoot, { type: "global" });
    const notebookRuntimeFiles = scopeFiles(harness.workspaceRoot, { type: "notebook", notebookId: NOTEBOOK_A });
    insist(JSON.stringify(globalRuntimeFiles) === JSON.stringify(["MEMORY.md", "ledger.jsonl"]), `全局运行文件失控：${globalRuntimeFiles.join(",")}`);
    insist(JSON.stringify(notebookRuntimeFiles) === JSON.stringify(["MEMORY.md", "ledger.jsonl"]), `本子运行文件失控：${notebookRuntimeFiles.join(",")}`);
    const governedText = allTextFiles(harness.workspaceRoot)
      .filter((file) => /[\\/]\.leemo[\\/]memory[\\/]/.test(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    insist(!governedText.includes(TEST_KEY), "治理记忆文件含测试 API Key");
    insist(harness.state.requests.every((request) => request.authorizationOk), "本机请求缺少隔离测试鉴权");
    const rendererErrors = [...firstRendererErrors, ...app.rendererErrors];
    insist(rendererErrors.length === 0, `renderer 控制台出现错误：${rendererErrors.join(" | ")}`);

    await page.screenshot({ path: SCREENSHOT_PATH, animations: "disabled" });
    const facts = {
      checkedAt: new Date().toISOString(),
      isolatedRoot: harness.auditRoot,
      externalApiCalls: 0,
      oldValueSuperseded: true,
      currentValueSurvivedRestart: true,
      globalMemoryAvailableInsideNotebook: true,
      notebookMemoryIsolated: true,
      ordinaryResearchArtifact: path.relative(harness.workspaceRoot, researchArtifact),
      legacyArtifactMovedToDefaultWorkspace: true,
      migrationManifest: path.relative(harness.workspaceRoot, manifestPath),
      migrationArchivedMappings: manifest.archived.length,
      migrationArtifactMappings: manifest.movedArtifacts.length,
      globalRuntimeFiles,
      notebookRuntimeFiles,
      screenshot: path.relative(ROOT, SCREENSHOT_PATH).replaceAll(path.sep, "/"),
      startupMs: { first: firstStartupMs, restart: restartStartupMs },
      idleProcesses,
      rendererConsoleErrors: rendererErrors.length,
      mockRequests: harness.state.requests.length,
    };
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(facts, null, 2));
    return facts;
  } catch (error) {
    const logs = harness.current?.logs?.join("")?.trim();
    if (logs) console.error(`[r10-memory-restart] packaged host log:\n${logs.slice(-8_000)}`);
    throw error;
  } finally {
    await harness.close();
  }
}

await runRestartAcceptance();
