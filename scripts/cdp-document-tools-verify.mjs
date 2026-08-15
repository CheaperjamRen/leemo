// Packaged r11 local-document acceptance. Every document action starts from the
// visible composer and is fulfilled by the real in-process MCP inside an
// isolated Leemo.exe. The loopback model only selects deterministic tools.

import fs from "node:fs";
import path from "node:path";
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

const PREFIX = "leemo-e2e-r11-documents-";
const FACTS_PATH = path.join(OUTPUT_DIR, "r11-document-tools-facts.json");
const FAILURE_PATH = path.join(OUTPUT_DIR, "r11-document-tools-failure.json");
const ERROR_SCREENSHOT = path.join(OUTPUT_DIR, "r11-document-error-720x640.png");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 720, height: 640 },
];

const TOOLS = {
  read: "mcp__leemo-documents__read_document",
  editWord: "mcp__leemo-documents__edit_word_document",
  word: "mcp__leemo-documents__create_word_document",
  presentation: "mcp__leemo-documents__create_presentation",
  spreadsheet: "mcp__leemo-documents__create_spreadsheet",
};
const OFFICE_SKILL_MARKERS = {
  word: [
    "DOCX creation, editing, and analysis",
    "A .docx file is a ZIP archive containing XML files.",
    "CRITICAL: Tables need dual widths",
  ],
  presentation: [
    "# PPTX Skill",
    "## Editing Workflow",
    "## QA (Required)",
  ],
  spreadsheet: [
    "XLSX creation, editing, and analysis",
    "Zero Formula Errors",
    "CRITICAL: Use Formulas, Not Hardcoded Values",
  ],
  readPdf: [
    "# PDF Processing Guide",
    "pypdf - Basic Operations",
    "pdfplumber - Text and Table Extraction",
  ],
};

const SCENARIOS = {
  word: { marker: "R11_DOC_WORD", final: "R11_DOC_WORD_OK" },
  readWord: { marker: "R11_DOC_READ_WORD", final: "R11_DOC_READ_WORD_OK" },
  editWordAmbiguous: { marker: "R11_DOC_EDIT_WORD_AMBIGUOUS", final: "R11_DOC_EDIT_WORD_AMBIGUOUS_BLOCKED" },
  editWord: { marker: "R11_DOC_EDIT_WORD", final: "R11_DOC_EDIT_WORD_OK" },
  readEditedWord: { marker: "R11_DOC_READ_EDITED_WORD", final: "R11_DOC_READ_EDITED_WORD_OK" },
  presentation: { marker: "R11_DOC_PRESENTATION", final: "R11_DOC_PRESENTATION_OK" },
  readPresentation: { marker: "R11_DOC_READ_PRESENTATION", final: "R11_DOC_READ_PRESENTATION_OK" },
  spreadsheet: { marker: "R11_DOC_SPREADSHEET", final: "R11_DOC_SPREADSHEET_OK" },
  readSpreadsheet: { marker: "R11_DOC_READ_SPREADSHEET", final: "R11_DOC_READ_SPREADSHEET_OK" },
  readPdf: { marker: "R11_DOC_READ_PDF", final: "R11_DOC_READ_PDF_OK" },
  duplicate: { marker: "R11_DOC_DUPLICATE", final: "R11_DOC_DUPLICATE_BLOCKED" },
  corrupt: { marker: "R11_DOC_CORRUPT", final: "R11_DOC_CORRUPT_ERROR_OK" },
  traversal: { marker: "R11_DOC_TRAVERSAL", final: "R11_DOC_TRAVERSAL_BLOCKED" },
  recovery: { marker: "R11_DOC_RECOVERY", final: "R11_DOC_RECOVERY_OK" },
};

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

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function writeSuccess(response, model, content) {
  streamHeaders(response);
  const base = {
    id: "chatcmpl-leemo-r11-documents",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1_000),
    model,
  };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  send({ ...base, choices: [], usage: { prompt_tokens: 18, completion_tokens: 4 } });
  response.end("data: [DONE]\n\n");
}

function writeToolCall(response, model, toolName, args, sequence) {
  streamHeaders(response);
  const base = {
    id: `chatcmpl-leemo-r11-document-tool-${sequence}`,
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
          id: `call_leemo_r11_document_${sequence}`,
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

function hasToolResult(lastMessage) {
  const serialized = JSON.stringify(lastMessage ?? {});
  return lastMessage?.role === "tool" || serialized.includes("tool_call_id") || serialized.includes("tool_result");
}

function scenarioIn(serialized) {
  return Object.entries(SCENARIOS).find(([, scenario]) => serialized.includes(scenario.marker));
}

function toolNames(body) {
  return Array.isArray(body.tools)
    ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
    : [];
}

function streamRouter(response, body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serialized = JSON.stringify(messages);
  const lastMessage = messages.at(-1);
  const lastSerialized = JSON.stringify(lastMessage ?? {});
  const model = typeof body.model === "string" ? body.model : MODEL_ID;
  const selected = scenarioIn(serialized);
  if (!selected) {
    writeSuccess(response, model, "R11_DOCUMENT_PROBE_OK");
    return;
  }

  const [id, scenario] = selected;
  const available = toolNames(body);
  const call = (expected, args) => {
    const toolName = available.find((name) => name === expected);
    if (!toolName) {
      writeJson(response, 400, { error: { message: `Required tool missing: ${expected}` } });
      return;
    }
    state.toolCalls.push({ expected, toolName, args });
    writeToolCall(response, model, toolName, args, state.toolCalls.length);
  };

  if (!hasToolResult(lastMessage)) {
    const skillMarkers = OFFICE_SKILL_MARKERS[id];
    if (skillMarkers) {
      state.documentChecks ??= {};
      state.documentChecks.officeSkillBodies ??= {};
      state.documentChecks.nativeDocumentGuidance ??= {};
      state.documentChecks.officeSkillBodies[id] = includesMarkers(serialized, skillMarkers);
      state.documentChecks.nativeDocumentGuidance[id] = includesMarkers(serialized, [
        "Prefer Leemo tools",
        "Optional commands may be unavailable",
      ]);
    }
    if (id === "word") call(TOOLS.word, {
      file_path: "英语周报.docx",
      title: "英语周报",
      subtitle: "R11 本地文档验收",
      sections: [{ heading: "进展", paragraphs: ["完成三次写作练习。"], bullets: ["主动回忆", "即时纠错"] }],
      overwrite: false,
    });
    else if (id === "readWord") call(TOOLS.read, { file_path: "默认工作区/英语周报.docx" });
    else if (id === "editWordAmbiguous") call(TOOLS.editWord, {
      file_path: "默认工作区/英语周报.docx",
      output_path: "默认工作区/英语周报-歧义失败.docx",
      replacements: [{ find: "三次", replace: "五次", expectedMatches: 2 }],
    });
    else if (id === "editWord") call(TOOLS.editWord, {
      file_path: "默认工作区/英语周报.docx",
      replacements: [{ find: "三次", replace: "五次" }],
    });
    else if (id === "readEditedWord") call(TOOLS.read, { file_path: "默认工作区/英语周报-修改版.docx" });
    else if (id === "presentation") call(TOOLS.presentation, {
      file_path: "面试复盘.pptx",
      title: "面试复盘",
      subtitle: "证据优先",
      slides: [{ title: "主要发现", bullets: ["回答缺少量化", "补充 STAR 证据"] }],
      overwrite: false,
    });
    else if (id === "readPresentation") call(TOOLS.read, { file_path: "默认工作区/面试复盘.pptx" });
    else if (id === "spreadsheet") call(TOOLS.spreadsheet, {
      file_path: "学习计划.xlsx",
      sheets: [{ name: "本周", rows: [["任务", "完成"], ["英语写作", true], ["主动回忆", false]] }],
      overwrite: false,
    });
    else if (id === "readSpreadsheet") call(TOOLS.read, { file_path: "默认工作区/学习计划.xlsx" });
    else if (id === "readPdf") call(TOOLS.read, { file_path: "默认工作区/英语材料.pdf" });
    else if (id === "duplicate") call(TOOLS.word, {
      file_path: "英语周报.docx",
      title: "不应覆盖",
      sections: [{ paragraphs: ["不应写入"], bullets: [] }],
      overwrite: false,
    });
    else if (id === "corrupt") call(TOOLS.read, { file_path: "默认工作区/损坏.pdf" });
    else if (id === "traversal") call(TOOLS.read, { file_path: "../工作区外.pdf" });
    else if (id === "recovery") call(TOOLS.spreadsheet, {
      file_path: "恢复.xlsx",
      sheets: [{ name: "结果", rows: [["状态"], ["成功"]] }],
      overwrite: false,
    });
    return;
  }

  state.documentChecks ??= {};
  state.documentResults ??= {};
  state.documentResults[id] = lastMessage;
  if (id === "readWord") state.documentChecks.wordRead = lastSerialized.includes("三次写作练习");
  if (id === "editWordAmbiguous") {
    state.documentChecks.wordEditAmbiguityBlocked = lastSerialized.includes("实际找到 1 处")
      && lastSerialized.includes("文件没有修改");
  }
  if (id === "editWord") state.documentChecks.wordEditCreated = lastSerialized.includes("已修改 Word 文档副本");
  if (id === "readEditedWord") state.documentChecks.wordEditRead = lastSerialized.includes("五次写作练习");
  if (id === "readPresentation") state.documentChecks.presentationRead = lastSerialized.includes("补充 STAR 证据");
  if (id === "readSpreadsheet") state.documentChecks.spreadsheetRead = lastSerialized.includes("英语写作");
  if (id === "readPdf") state.documentChecks.pdfRead = lastSerialized.includes("LEEMO_PDF_VALID_CONTENT");
  if (id === "duplicate") state.documentChecks.duplicateBlocked = lastSerialized.includes("已经存在");
  if (id === "corrupt") state.documentChecks.corruptExplained = lastSerialized.includes("无法解析");
  if (id === "traversal") {
    state.documentChecks.traversalBlocked = lastSerialized.includes("工作区")
      && (lastSerialized.includes("拒绝") || lastSerialized.includes("不在当前工作区"));
  }
  writeSuccess(response, model, scenario.final);
}

function simplePdf(text) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 16 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

function relativeOutput(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

async function runScenario(page, scenario, request) {
  await newConversation(page);
  await runVisiblePrompt(page, `${scenario.marker}：${request}`, scenario.final);
}

async function runSkillScenario(page, scenario, command, request) {
  await newConversation(page);
  await runVisiblePrompt(page, `/${command} ${scenario.marker}：${request}`, scenario.final);
}

async function chatLayout(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-testid="workbench-shell"]');
    const composer = document.querySelector('textarea[aria-label="输入消息"]');
    const main = shell?.querySelector("main");
    const rect = (element) => element?.getBoundingClientRect();
    const inside = (value) => value
      ? value.left >= -1 && value.right <= window.innerWidth + 1 && value.top >= -1 && value.bottom <= window.innerHeight + 1
      : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      mainInsideViewport: inside(rect(main)),
      composerInsideViewport: inside(rect(composer)),
    };
  });
}

async function artifactLayout(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-testid="workbench-shell"]');
    const main = shell?.querySelector("main");
    const rect = main?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      mainHorizontalOverflow: main instanceof HTMLElement ? Math.max(0, main.scrollWidth - main.clientWidth) : null,
      mainInsideViewport: rect
        ? rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.top >= -1 && rect.bottom <= window.innerHeight + 1
        : null,
    };
  });
}

async function persistedToolInputs(page) {
  return page.evaluate(async () => {
    const response = await window.leemoPersist.invoke("loadAll", undefined);
    if (!response.ok) throw new Error(response.error || "loadAll failed");
    return response.response.conversations.flatMap((conversation) => conversation.timeline)
      .filter((item) => item.kind === "tool" && item.name.startsWith("mcp__leemo-documents__"))
      .map((item) => ({ name: item.name, input: item.input, status: item.status, summary: item.summary }));
  });
}

async function run() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const harness = await createMemoryAcceptanceHarness({
    prefix: PREFIX,
    streamRouter,
    seedWorkspace: async (workspaceRoot) => {
      const defaultWorkspace = path.join(workspaceRoot, "默认工作区");
      fs.mkdirSync(defaultWorkspace, { recursive: true });
      fs.writeFileSync(path.join(defaultWorkspace, "英语材料.pdf"), simplePdf("LEEMO_PDF_VALID_CONTENT"));
      fs.writeFileSync(path.join(defaultWorkspace, "损坏.pdf"), "not a pdf", "utf8");
    },
  });
  const facts = { checks: {}, files: {}, screenshots: {}, layouts: {}, rendererErrors: [] };
  try {
    let app = await harness.start("文档工具首次启动");
    await configureLoopbackProvider(app.page, harness.baseUrl);
    await ensureWorkbench(app.page);

    await runSkillScenario(app.page, SCENARIOS.word, "docx", "新建一份英语周报 Word，不要覆盖已有文件。");
    const word = path.join(harness.workspaceRoot, "默认工作区", "英语周报.docx");
    insist(fs.existsSync(word) && fs.statSync(word).size > 1_000, "Word 没有真实落盘");
    insist(harness.state.documentChecks?.officeSkillBodies?.word, "Word Skill 正文没有进入创建文件的模型请求");
    insist(harness.state.documentChecks?.nativeDocumentGuidance?.word, "Word 请求没有收到优先使用 Leemo 随包文档工具的约束");
    facts.files.word = { path: path.relative(harness.workspaceRoot, word), bytes: fs.statSync(word).size };
    await runScenario(app.page, SCENARIOS.readWord, "重新读取刚才的 Word，并核对进展内容。");

    const originalWordBeforeEdit = fs.readFileSync(word);
    const ambiguousCopy = path.join(harness.workspaceRoot, "默认工作区", "英语周报-歧义失败.docx");
    await runScenario(app.page, SCENARIOS.editWordAmbiguous, "预期原文出现两次；不一致时必须停止，不要生成副本。");
    insist(harness.state.documentChecks?.wordEditAmbiguityBlocked, "Word 歧义修改没有返回命中数量说明");
    insist(!fs.existsSync(ambiguousCopy), "Word 歧义修改留下了失败副本");

    await runScenario(app.page, SCENARIOS.editWord, "把 Word 里的三次写作练习精确改为五次，另存副本，不要覆盖原稿。");
    const editedWord = path.join(harness.workspaceRoot, "默认工作区", "英语周报-修改版.docx");
    insist(harness.state.documentChecks?.wordEditCreated, "Word 修改没有返回轻量成功回执");
    insist(fs.existsSync(editedWord) && fs.statSync(editedWord).size > 1_000, "Word 修改副本没有真实落盘");
    insist(fs.readFileSync(word).equals(originalWordBeforeEdit), "Word 精确修改改变了原稿字节");
    facts.files.editedWord = { path: path.relative(harness.workspaceRoot, editedWord), bytes: fs.statSync(editedWord).size };
    await runScenario(app.page, SCENARIOS.readEditedWord, "读取 Word 修改副本并核对修改内容。");
    insist(harness.state.documentChecks?.wordEditRead, "打包态无法读回 Word 修改副本");
    facts.checks.wordEditCopyPreservedSource = true;
    facts.checks.wordEditAmbiguityLeftNoFile = true;

    await runSkillScenario(app.page, SCENARIOS.presentation, "pptx", "新建一份面试复盘演示文稿。");
    const presentation = path.join(harness.workspaceRoot, "默认工作区", "面试复盘.pptx");
    insist(fs.existsSync(presentation) && fs.statSync(presentation).size > 1_000, "PPTX 没有真实落盘");
    insist(harness.state.documentChecks?.officeSkillBodies?.presentation, "PPTX Skill 正文没有进入创建文件的模型请求");
    insist(harness.state.documentChecks?.nativeDocumentGuidance?.presentation, "PPTX 请求没有收到优先使用 Leemo 随包文档工具的约束");
    facts.files.presentation = { path: path.relative(harness.workspaceRoot, presentation), bytes: fs.statSync(presentation).size };
    await runScenario(app.page, SCENARIOS.readPresentation, "重新读取刚才的演示文稿并核对要点。");

    await runSkillScenario(app.page, SCENARIOS.spreadsheet, "xlsx", "新建一份学习计划 Excel。");
    const spreadsheet = path.join(harness.workspaceRoot, "默认工作区", "学习计划.xlsx");
    insist(fs.existsSync(spreadsheet) && fs.statSync(spreadsheet).size > 500, "XLSX 没有真实落盘");
    insist(harness.state.documentChecks?.officeSkillBodies?.spreadsheet, "Excel Skill 正文没有进入创建文件的模型请求");
    insist(harness.state.documentChecks?.nativeDocumentGuidance?.spreadsheet, "Excel 请求没有收到优先使用 Leemo 随包文档工具的约束");
    facts.files.spreadsheet = { path: path.relative(harness.workspaceRoot, spreadsheet), bytes: fs.statSync(spreadsheet).size };
    await runScenario(app.page, SCENARIOS.readSpreadsheet, "重新读取刚才的 Excel 并核对任务。");
    await runSkillScenario(app.page, SCENARIOS.readPdf, "pdf", "读取工作区里的英语材料 PDF。");
    insist(harness.state.documentChecks?.officeSkillBodies?.readPdf, "PDF Skill 正文没有进入读取文件的模型请求");
    insist(harness.state.documentChecks?.nativeDocumentGuidance?.readPdf, "PDF 请求没有收到优先使用 Leemo 随包文档工具的约束");

    insist(harness.state.documentChecks?.wordRead, "打包态无法读回生成的 Word");
    insist(harness.state.documentChecks?.presentationRead, "打包态无法读回生成的 PPTX");
    insist(harness.state.documentChecks?.spreadsheetRead, "打包态无法读回生成的 XLSX");
    insist(harness.state.documentChecks?.pdfRead, "打包态无法读取真实 PDF");
    facts.checks.fourFormatsRead = true;
    facts.checks.threeFormatsCreated = true;
    facts.checks.fourOfficeSkillBodiesLoaded = true;
    facts.checks.xlsxSkillUsedPackagedTool = true;

    const originalWord = fs.readFileSync(word);
    await runScenario(app.page, SCENARIOS.duplicate, "再次创建同名 Word，必须拒绝静默覆盖。");
    insist(harness.state.documentChecks?.duplicateBlocked, "同名文件没有返回可理解的拒绝原因");
    insist(fs.readFileSync(word).equals(originalWord), "重复创建破坏了原 Word");
    facts.checks.duplicatePreservedSource = true;

    await app.page.setViewportSize({ width: 720, height: 640 });
    const errorLayout = await chatLayout(app.page);
    insist(errorLayout.horizontalOverflow === 0, `错误态横向溢出 ${errorLayout.horizontalOverflow}px`);
    insist(errorLayout.mainInsideViewport === true && errorLayout.composerInsideViewport === true, "错误态输入框没有完整展示");
    await app.page.screenshot({ path: ERROR_SCREENSHOT, animations: "disabled" });
    facts.layouts.errorCompact = errorLayout;
    facts.screenshots.errorCompact = relativeOutput(ERROR_SCREENSHOT);
    await app.page.setViewportSize({ width: 1440, height: 900 });

    await runScenario(app.page, SCENARIOS.corrupt, "读取损坏 PDF，说明失败但不要泄露内部堆栈。");
    insist(harness.state.documentChecks?.corruptExplained, "损坏文档没有返回人话错误");
    await runScenario(app.page, SCENARIOS.traversal, "尝试读取工作区外文件，必须拒绝。");
    insist(harness.state.documentChecks?.traversalBlocked, "工作区边界没有生效");
    facts.checks.failuresActionable = true;

    await runScenario(app.page, SCENARIOS.recovery, "失败后新建恢复表格，证明文档引擎仍可用。");
    const recovery = path.join(harness.workspaceRoot, "默认工作区", "恢复.xlsx");
    insist(fs.existsSync(recovery) && fs.statSync(recovery).size > 500, "失败后没有恢复成功");
    facts.files.recovery = { path: path.relative(harness.workspaceRoot, recovery), bytes: fs.statSync(recovery).size };
    facts.checks.recoveredAfterFailure = true;
    facts.persistedToolInputs = await persistedToolInputs(app.page);
    facts.rendererErrors.push(...app.rendererErrors);

    app = await harness.restart("文档工具重启恢复");
    await ensureWorkbench(app.page);
    await app.page.getByRole("button", { name: "成果", exact: true }).click();
    await app.page.getByRole("heading", { name: "成果", exact: true }).waitFor({ state: "visible" });
    for (const title of ["英语周报.docx", "英语周报-修改版.docx", "面试复盘.pptx", "学习计划.xlsx", "恢复.xlsx"]) {
      await app.page.getByText(title, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    }
    const artifactsText = await app.page.locator("main").innerText();
    insist(artifactsText.includes("默认工作区/英语周报.docx"), "成果页没有展示真实默认工作区路径");
    facts.checks.artifactsRestored = true;

    for (const viewport of VIEWPORTS) {
      await app.page.setViewportSize(viewport);
      await app.page.waitForTimeout(100);
      const label = `${viewport.width}x${viewport.height}`;
      const layout = await artifactLayout(app.page);
      insist(layout.horizontalOverflow === 0, `${label} 成果页横向溢出 ${layout.horizontalOverflow}px`);
      insist((layout.mainHorizontalOverflow ?? 0) <= 1, `${label} 成果主区横向溢出 ${layout.mainHorizontalOverflow}px`);
      insist(layout.mainInsideViewport === true, `${label} 成果主区越出视口`);
      const screenshot = path.join(OUTPUT_DIR, `r11-document-artifacts-${label}.png`);
      await app.page.screenshot({ path: screenshot, animations: "disabled" });
      facts.layouts[label] = layout;
      facts.screenshots[label] = relativeOutput(screenshot);
    }
    facts.checks.fourViewports = true;
    facts.rendererErrors = [...new Set([...facts.rendererErrors, ...app.rendererErrors])];
    insist(facts.rendererErrors.length === 0, `renderer 报错：${facts.rendererErrors.join(" | ")}`);

    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[r11-documents] PASS ${Object.keys(facts.checks).length} checks`);
    console.log(`[r11-documents] facts ${relativeOutput(FACTS_PATH)}`);
  } catch (error) {
    fs.writeFileSync(FAILURE_PATH, `${JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      checks: harness.state.documentChecks ?? {},
      results: harness.state.documentResults ?? {},
      toolCalls: harness.state.toolCalls,
      requests: harness.state.requests.map((request) => ({
        path: request.path,
        model: request.model,
        stream: request.stream,
        messages: request.messages,
      })),
    }, null, 2)}\n`, "utf8");
    console.error(`[r11-documents] failure evidence ${relativeOutput(FAILURE_PATH)}`);
    throw error;
  } finally {
    await harness.close();
  }
}

await run();
