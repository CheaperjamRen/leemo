// Packaged search acceptance. The model is a loopback OpenAI-compatible mock,
// but the Leemo MCP and AnySearch request are real. A disposable credential is
// used only to prove safeStorage behavior; paid providers are never called.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OUTPUT_DIR,
  ROOT,
  configureLoopbackProvider,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
  newConversation,
  openSettingsTab,
} from "./verify-memory-workspace.mjs";

const FACTS_PATH = path.join(OUTPUT_DIR, "search-r11-packaged-facts.json");
const TEST_KEY = "leemo-r11-disposable-search-key";
const WEB_TOOL = "mcp__leemo-web-search__web_search";
const ACADEMIC_TOOL = "mcp__leemo-academic-search__academic_search";
const PROMPTS = {
  off: "R11_SEARCH_OFF：请确认当前不能联网，不要调用搜索工具。",
  error: "R11_SEARCH_ERROR：请调用联网搜索，用空查询验证错误反馈。",
  success: "R11_SEARCH_SUCCESS：请使用联网搜索查询 Leemo R11 搜索验收。",
};
const FINAL = {
  off: "R11_SEARCH_OFF_OK",
  error: "R11_SEARCH_ERROR_HANDLED",
  success: "R11_SEARCH_LIVE_OK",
};
const VIEWPORTS = [
  { id: "1440x900", width: 1440, height: 900 },
  { id: "1280x720", width: 1280, height: 720 },
  { id: "1024x768", width: 1024, height: 768 },
  { id: "720x640", width: 720, height: 640 },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function readProcessTreeMetrics(rootPid) {
  const command = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, WorkingSetSize
$ids = [System.Collections.Generic.HashSet[int]]::new()
[void]$ids.Add(${rootPid})
do {
  $before = $ids.Count
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ParentProcessId)) { [void]$ids.Add([int]$process.ProcessId) }
  }
} while ($ids.Count -gt $before)
$rows = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
[pscustomobject]@{
  processCount = $rows.Count
  workingSetBytes = [long](($rows | Measure-Object -Property WorkingSetSize -Sum).Sum)
} | ConvertTo-Json -Compress
`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    encoding: "utf8",
  });
  return JSON.parse(output.trim());
}

function directoryStats(root) {
  const pending = [root];
  let files = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(fullPath).size;
      }
    }
  }
  return { files, bytes };
}

function packageMetrics() {
  const unpackedRoot = path.join(ROOT, "dist-package", "win-unpacked");
  const installer = path.join(ROOT, "dist-package", "Leemo Setup 0.0.1.exe");
  const appAsar = path.join(unpackedRoot, "resources", "app.asar");
  const rendererPath = fs.readdirSync(path.join(unpackedRoot, "resources"), { withFileTypes: true });
  const rendererChunk = fs.readdirSync(path.join(ROOT, "dist", "assets"))
    .find((name) => /^index-[^/]+\.js$/i.test(name));
  return {
    unpacked: directoryStats(unpackedRoot),
    installerBytes: fs.statSync(installer).size,
    appAsarBytes: fs.statSync(appAsar).size,
    rendererBytes: rendererChunk === undefined
      ? null
      : fs.statSync(path.join(ROOT, "dist", "assets", rendererChunk)).size,
    resourcesEntries: rendererPath.length,
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
    id: `chatcmpl-r11-search-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 16, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function writeToolCall(response, model, toolName, args, sequence) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-r11-search-tool-${sequence}`,
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
          id: `call_r11_search_${sequence}`,
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

function toolResultRequest(lastMessage) {
  const serialized = JSON.stringify(lastMessage ?? {});
  return lastMessage?.role === "tool" || serialized.includes("tool_call_id") || serialized.includes("tool_result");
}

function latestUserMarker(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const serialized = JSON.stringify(message);
    return Object.entries(PROMPTS).find(([, prompt]) => serialized.includes(prompt.split("：")[0]))?.[0] ?? null;
  }
  return null;
}

function routeStream(response, body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastMessage = messages.at(-1);
  const lastSerialized = JSON.stringify(lastMessage ?? {});
  const marker = latestUserMarker(messages);
  const tools = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
    : [];
  const model = typeof body.model === "string" ? body.model : "mock-r11-search";
  const hasToolResult = toolResultRequest(lastMessage);
  state.searchRequests ??= [];

  const finish = (kind, marker) => {
    state.searchRequests.push({ kind, tools, hasToolResult, lastSerialized });
    writeSuccess(response, model, marker);
  };
  const callSearch = (query, kind) => {
    if (!tools.includes(WEB_TOOL)) {
      state.routerFailures ??= [];
      state.routerFailures.push({ kind, reason: "missing-web-tool", tools });
      finish(`${kind}-missing-tool`, FINAL[kind]);
      return;
    }
    state.toolCalls.push({ expected: WEB_TOOL, toolName: WEB_TOOL, args: { query } });
    state.searchRequests.push({ kind, tools, hasToolResult: false, lastSerialized: "" });
    writeToolCall(response, model, WEB_TOOL, { query }, state.toolCalls.length);
  };

  if (marker === "off") {
    state.offTools = tools;
    state.offToolLeak = tools.includes(WEB_TOOL) || tools.includes(ACADEMIC_TOOL);
    finish("off", FINAL.off);
    return;
  }
  if (marker === "error") {
    if (!hasToolResult) callSearch("", "error");
    else {
      if (!lastSerialized.includes("empty query")) {
        state.routerFailures ??= [];
        state.routerFailures.push({ kind: "error-result", reason: "missing-empty-query-error" });
      }
      finish("error-result", FINAL.error);
    }
    return;
  }
  if (marker === "success") {
    if (!hasToolResult) callSearch("OpenAI ChatGPT official", "success");
    else {
      const source = /搜索结果（来源：([^，]+)，(\d+) 条）/.exec(lastSerialized);
      if (source) {
        state.liveSearch = { source: source[1], hits: Number(source[2]) };
        finish("success-result", `${FINAL.success} source=${source[1]} hits=${source[2]}`);
      } else {
        state.routerFailures ??= [];
        state.routerFailures.push({ kind: "success-result", reason: "missing-search-result-summary" });
        finish("success-result-invalid", FINAL.success);
      }
    }
    return;
  }
  writeSuccess(response, model, "R11_SEARCH_MOCK_READY");
}

async function eventually(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(100);
  }
  throw new Error(message);
}

async function closeSettings(page) {
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByTestId("settings-window").waitFor({ state: "hidden" });
}

async function configureDisposableDoubao(page) {
  await openSettingsTab(page, "连接器");
  const row = page.getByRole("button", { name: "配置 豆包搜索", exact: true });
  await row.click();
  const input = page.getByLabel("豆包搜索 API Key", { exact: true });
  await input.fill(TEST_KEY);
  await page.getByRole("button", { name: "保存 豆包搜索", exact: true }).click();
  await eventually(async () => (await input.inputValue()) === "", "保存成功后未清空凭据草稿");
  await eventually(async () => (await row.textContent())?.includes("已配置"), "豆包状态没有变成已配置");
  insist(!(await page.locator("body").innerText()).includes(TEST_KEY), "凭据出现在 DOM 文本中");
  await row.click();
}

async function clearDisposableDoubao(page) {
  await openSettingsTab(page, "连接器");
  const row = page.getByRole("button", { name: "配置 豆包搜索", exact: true });
  await row.click();
  const input = page.getByLabel("豆包搜索 API Key", { exact: true });
  insist(await input.inputValue() === "", "重启后回填了已保存的搜索凭据");
  await page.getByRole("button", { name: "清除 豆包搜索 配置", exact: true }).click();
  await page.getByText("确定清除 豆包搜索？", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "确认清除", exact: true }).click();
  await eventually(async () => (await row.textContent())?.includes("可选"), "清除后状态没有恢复为可选");
  await row.click();
}

async function setMasterWeb(page, enabled) {
  await openSettingsTab(page, "连接器");
  const master = page.getByLabel("允许联网", { exact: true });
  if (await master.isChecked() !== enabled) await master.click();
  await eventually(() => master.isChecked().then((value) => value === enabled), "联网总开关没有切换");
  await closeSettings(page);
}

async function runPromptWithoutApproval(page, prompt, marker, timeoutMs = 90_000) {
  const composer = page.locator('textarea[aria-label="输入消息"]');
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const deadline = Date.now() + timeoutMs;
  let approvalSeen = false;
  while (Date.now() < deadline) {
    const approval = page.getByRole("button", { name: "允许一次", exact: true });
    approvalSeen ||= await approval.isVisible().catch(() => false);
    if (approvalSeen) throw new Error(`只读搜索重复请求权限：${prompt}`);
    if (await page.getByText(marker, { exact: false }).last().isVisible().catch(() => false)) {
      await page.getByTestId("current-conversation-status").filter({ hasText: "已完成" }).waitFor({ state: "visible" });
      return { approvalSeen };
    }
    if (await page.getByText("任务没有完成", { exact: true }).isVisible().catch(() => false)) {
      throw new Error(`用户路径失败：${(await page.locator("body").innerText()).slice(-1_500)}`);
    }
    await sleep(150);
  }
  throw new Error(`等待用户路径结果超时：${marker}`);
}

async function loadRound(page, prompt) {
  await sleep(350);
  return page.evaluate(async (expectedPrompt) => {
    const response = await window.leemoPersist?.invoke("loadAll", undefined);
    if (!response?.ok) return null;
    for (const conversation of response.response?.conversations ?? []) {
      const user = conversation.timeline.findLast(
        (item) => item.kind === "text" && item.role === "user" && item.text === expectedPrompt,
      );
      if (!user) continue;
      const items = conversation.timeline.filter(
        (item) => item.kind === "compact" || item.runId === user.runId,
      );
      return {
        conversationId: conversation.meta.id,
        tools: items.filter((item) => item.kind === "tool")
          .map((item) => ({
            name: item.name,
            status: item.status,
            ...(item.status === "error" ? { summary: item.summary ?? "" } : {}),
          })),
        result: items.findLast((item) => item.kind === "result") ?? null,
      };
    }
    return null;
  }, prompt);
}

async function collectLayout(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await openSettingsTab(page, "连接器");
  const facts = await page.evaluate(() => {
    const settings = document.querySelector('[data-testid="settings-window"]');
    const panel = document.querySelector('[role="tabpanel"]');
    const webHeading = [...document.querySelectorAll("h2")].find((node) => node.textContent?.trim() === "联网与浏览");
    const mcpHeading = [...document.querySelectorAll("h2")].find((node) => node.textContent?.trim() === "MCP 与浏览器");
    if (!settings || !panel || !webHeading || !mcpHeading) return null;
    const settingsRect = settings.getBoundingClientRect();
    const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    const overflow = [...settings.querySelectorAll("*")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === "visible")
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ").slice(0, 2).join(".")}`)
      .slice(0, 8);
    return {
      settingsInsideViewport: inside(settingsRect),
      panelScrollWidth: panel.scrollWidth,
      panelClientWidth: panel.clientWidth,
      sourceGroups: [...settings.querySelectorAll('[role="group"]')]
        .map((element) => element.getAttribute("aria-label"))
        .filter(Boolean),
      webBeforeMcp: Boolean(webHeading.compareDocumentPosition(mcpHeading) & Node.DOCUMENT_POSITION_FOLLOWING),
      horizontalOverflow: overflow,
    };
  });
  insist(facts, `${viewport.id} 无法读取设置布局`);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `search-r11-${viewport.id}.png`),
    animations: "disabled",
  });
  await closeSettings(page);
  const composer = await page.evaluate(() => {
    const textarea = document.querySelector('textarea[aria-label="输入消息"]');
    const sendButton = document.querySelector('button[aria-label="发送"]');
    const surface = textarea?.parentElement;
    const region = surface?.parentElement;
    if (!textarea || !sendButton || !surface || !region) return null;
    const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    return {
      textareaInsideViewport: inside(textarea.getBoundingClientRect()),
      surfaceInsideViewport: inside(surface.getBoundingClientRect()),
      regionInsideViewport: inside(region.getBoundingClientRect()),
      sendInsideViewport: inside(sendButton.getBoundingClientRect()),
    };
  });
  return { ...facts, composer };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const harness = await createMemoryAcceptanceHarness({
  prefix: "leemo-e2e-r11-search-",
  streamRouter: routeStream,
  launchArgs: ["--disable-gpu"],
});
const facts = {
  checkedAt: new Date().toISOString(),
  isolatedUserData: true,
  firstStartupMs: 0,
  restartStartupMs: 0,
  configuredWithoutEcho: false,
  disabledStatePersisted: false,
  keyNotEchoedAfterRestart: false,
  clearedAfterRestart: false,
  searchOff: null,
  searchError: null,
  searchSuccess: null,
  liveSearch: null,
  readOnlyApprovalEvents: 0,
  idleProcessTree: null,
  package: null,
  viewports: {},
  rendererErrors: [],
};

try {
  let app = await harness.start("搜索验收首次启动");
  facts.firstStartupMs = app.startupMs;
  await configureLoopbackProvider(app.page, harness.baseUrl);
  await ensureWorkbench(app.page);
  await configureDisposableDoubao(app.page);
  facts.configuredWithoutEcho = true;
  await setMasterWeb(app.page, false);

  app = await harness.restart("搜索验收重启");
  facts.restartStartupMs = app.startupMs;
  await ensureWorkbench(app.page);
  await openSettingsTab(app.page, "连接器");
  const master = app.page.getByLabel("允许联网", { exact: true });
  const search = app.page.getByLabel("联网搜索", { exact: true });
  const fetchPage = app.page.getByLabel("读取网页", { exact: true });
  facts.disabledStatePersisted = !(await master.isChecked())
    && !(await search.isChecked())
    && !(await fetchPage.isChecked())
    && await search.isDisabled()
    && await fetchPage.isDisabled();
  insist(facts.disabledStatePersisted, "联网关闭状态或子能力禁用态没有跨重启保持");
  await closeSettings(app.page);

  await newConversation(app.page);
  const off = await runPromptWithoutApproval(app.page, PROMPTS.off, FINAL.off);
  facts.readOnlyApprovalEvents += Number(off.approvalSeen);
  facts.searchOff = await loadRound(app.page, PROMPTS.off);
  insist(!harness.state.offToolLeak, `关闭联网后仍把搜索工具交给模型：${(harness.state.offTools ?? []).join(", ")}`);
  insist(facts.searchOff?.tools.every((tool) => !/web_search|academic_search/i.test(tool.name)), "关闭联网后时间线仍有搜索工具");

  await clearDisposableDoubao(app.page);
  facts.keyNotEchoedAfterRestart = true;
  facts.clearedAfterRestart = true;
  await setMasterWeb(app.page, true);

  const failed = await runPromptWithoutApproval(app.page, PROMPTS.error, FINAL.error);
  facts.readOnlyApprovalEvents += Number(failed.approvalSeen);
  facts.searchError = await loadRound(app.page, PROMPTS.error);
  insist(facts.searchError?.tools.some((tool) => tool.name === WEB_TOOL && tool.status === "error"), "空查询没有形成可见搜索错误");

  const succeeded = await runPromptWithoutApproval(app.page, PROMPTS.success, FINAL.success, 120_000);
  facts.readOnlyApprovalEvents += Number(succeeded.approvalSeen);
  facts.searchSuccess = await loadRound(app.page, PROMPTS.success);
  insist(facts.searchSuccess?.tools.some((tool) => tool.name === WEB_TOOL && tool.status === "ok"), "同一对话后续搜索没有恢复成功");
  facts.liveSearch = harness.state.liveSearch ?? null;
  insist(facts.liveSearch?.hits > 0, "打包搜索没有得到真实结果");
  insist((harness.state.routerFailures ?? []).length === 0, `模型网关验收异常：${JSON.stringify(harness.state.routerFailures)}`);
  insist(facts.readOnlyApprovalEvents === 0, "只读搜索重复请求权限");

  await app.page.screenshot({ path: path.join(OUTPUT_DIR, "search-r11-user-path.png"), animations: "disabled" });
  for (const viewport of VIEWPORTS) {
    facts.viewports[viewport.id] = await collectLayout(app.page, viewport);
  }
  for (const [viewport, result] of Object.entries(facts.viewports)) {
    insist(result.settingsInsideViewport, `${viewport} 设置窗超出视口`);
    insist(result.panelScrollWidth <= result.panelClientWidth + 1, `${viewport} 设置内容横向溢出`);
    insist(result.horizontalOverflow.length === 0, `${viewport} 子元素横向溢出：${result.horizontalOverflow.join(", ")}`);
    insist(result.webBeforeMcp, `${viewport} 联网设置没有排在 MCP 之前`);
    for (const group of ["默认来源", "中文增强", "更多来源", "学术检索"]) {
      insist(result.sourceGroups.includes(group), `${viewport} 缺少来源分组：${group}`);
    }
    insist(Object.values(result.composer ?? {}).every(Boolean), `${viewport} 长对话输入区被裁切`);
  }

  facts.idleProcessTree = readProcessTreeMetrics(app.child.pid);
  insist(
    facts.idleProcessTree.processCount > 0 && facts.idleProcessTree.workingSetBytes < 2 * 1024 * 1024 * 1024,
    `打包进程树内存异常：${JSON.stringify(facts.idleProcessTree)}`,
  );
  facts.package = packageMetrics();
  insist(facts.package.unpacked.files > 0 && facts.package.appAsarBytes > 0, "打包产物统计缺失");

  facts.rendererErrors = app.rendererErrors;
  insist(facts.rendererErrors.length === 0, `renderer 报错：${facts.rendererErrors.join(" | ")}`);
  const output = JSON.stringify(facts, null, 2);
  insist(!output.includes(TEST_KEY), "验收 facts 泄露了临时凭据");
  insist(!app.logs.join("").includes(TEST_KEY), "主进程日志泄露了临时凭据");
  fs.writeFileSync(FACTS_PATH, `${output}\n`, "utf8");
  process.stdout.write(`${output}\n`);
} catch (error) {
  const logs = harness.current?.logs?.join("")?.trim();
  if (logs) console.error(`[r11-search] packaged host log:\n${logs.slice(-8_000)}`);
  throw error;
} finally {
  await harness.close();
}
