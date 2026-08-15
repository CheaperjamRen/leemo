// Packaged native-visualization acceptance. The visible composer talks to a
// loopback OpenAI-compatible model that only selects Leemo's production MCP.

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

const PREFIX = "leemo-e2e-native-visualization-";
const TOOL = "mcp__leemo-visualization__create_visualization";
const MARKER = "NATIVE_VISUALIZATION_TIMELINE";
const FINAL = "NATIVE_VISUALIZATION_OK";
const REQUESTED_FILE = "英语学习/本周进度";
const RELATIVE_FILE = "默认工作区/英语学习/本周进度.html";
const FACTS_PATH = path.join(OUTPUT_DIR, "native-visualization-facts.json");
const CARD_SCREENSHOT = path.join(OUTPUT_DIR, "native-visualization-card-1024x720.png");
const PREVIEW_SCREENSHOT = path.join(OUTPUT_DIR, "native-visualization-preview-1024x720.png");
const SCRIPT_PROBE = "window.__LEEMO_VISUALIZATION_SCRIPT_PROBE__=1";
const NETWORK_PROBE = "http://127.0.0.1:9/leemo-visualization-network-probe";
const WRAP_PROBE = "W".repeat(160);
const HEADER_WRAP_PROBE = "H".repeat(160);

function insist(condition, message) {
  if (!condition) throw new Error(message);
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
    id: "chatcmpl-native-visualization",
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

function writeToolCall(response, model, args) {
  streamHeaders(response);
  const base = {
    id: "chatcmpl-native-visualization-tool",
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
          id: "call_native_visualization",
          type: "function",
          function: { name: TOOL, arguments: JSON.stringify(args) },
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

function streamRouter(response, body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const serialized = JSON.stringify(messages);
  const lastMessage = messages.at(-1);
  const model = typeof body.model === "string" ? body.model : MODEL_ID;
  if (!serialized.includes(MARKER)) {
    writeSuccess(response, model, "NATIVE_VISUALIZATION_PROBE_OK");
    return;
  }
  if (hasToolResult(lastMessage)) {
    state.toolResult = lastMessage;
    writeSuccess(response, model, FINAL);
    return;
  }

  const available = Array.isArray(body.tools)
    ? body.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string")
    : [];
  if (!available.includes(TOOL)) {
    writeJson(response, 400, { error: { message: `Required tool missing: ${TOOL}` } });
    return;
  }
  const args = {
    file_path: REQUESTED_FILE,
    title: "英语学习进度",
    subtitle: `一周内从输入走向主动输出 / ${HEADER_WRAP_PROBE}`,
    visualization: {
      kind: "timeline",
      events: [
        { date: "周一", label: "建立基线", detail: "完成词汇与听力摸底" },
        { date: "周三", label: `<script>${SCRIPT_PROBE}</script>`, detail: "脚本只应作为文字展示" },
        { date: "周四", label: WRAP_PROBE, detail: "合法的连续长文本必须完整换行" },
        { date: "周日", label: `<img src=\"${NETWORK_PROBE}\">`, detail: "网络地址不得产生请求" },
      ],
    },
    overwrite: false,
  };
  state.toolCalls.push({ name: TOOL, args });
  writeToolCall(response, model, args);
}

function relativeOutput(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, "/");
}

async function cardLayout(page) {
  return page.evaluate(() => {
    const card = document.querySelector('section[aria-label="可视化成果：英语学习进度"]');
    const composer = document.querySelector('textarea[aria-label="输入消息"]');
    const rect = card?.getBoundingClientRect();
    const composerRect = composer?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      cardVisible: Boolean(rect && rect.width >= 320 && rect.left >= 0 && rect.right <= window.innerWidth),
      composerVisible: Boolean(composerRect && composerRect.top >= 0 && composerRect.bottom <= window.innerHeight),
      nativeIframeCount: card?.querySelectorAll("iframe").length ?? -1,
    };
  });
}

async function run() {
  insist(process.platform === "win32", "该验收针对 Windows 打包应用");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const harness = await createMemoryAcceptanceHarness({ prefix: PREFIX, streamRouter });
  const facts = { checks: {}, files: {}, screenshots: {}, layout: {}, rendererErrors: [] };
  try {
    let app = await harness.start("原生可视化首次启动");
    await configureLoopbackProvider(app.page, harness.baseUrl);
    await ensureWorkbench(app.page);
    await newConversation(app.page);
    await runVisiblePrompt(
      app.page,
      `${MARKER}：创建一份本周英语学习进度时间线，并把它保存到工作区。`,
      FINAL,
    );

    const output = path.join(harness.workspaceRoot, ...RELATIVE_FILE.split("/"));
    insist(fs.existsSync(output), `可视化文件没有落盘：${output}`);
    const html = fs.readFileSync(output, "utf8");
    insist(html.includes("Content-Security-Policy"), "可视化文件缺少 CSP");
    insist(html.includes("script-src 'none'"), "可视化文件没有禁用脚本");
    insist(!html.includes(`<script>${SCRIPT_PROBE}</script>`), "脚本探针被写成了可执行节点");
    insist(!html.includes(`<img src=\"${NETWORK_PROBE}\">`), "网络探针被写成了真实图片节点");
    insist(html.includes("&lt;script&gt;"), "脚本探针没有作为转义文本保留");
    facts.files.visualization = {
      requestedPath: REQUESTED_FILE,
      path: RELATIVE_FILE,
      bytes: fs.statSync(output).size,
    };
    facts.checks.productionToolCalled = harness.state.toolCalls.some((call) => call.name === TOOL);
    facts.checks.fileIsStaticAndEscaped = true;

    await app.page.setViewportSize({ width: 1024, height: 720 });
    await app.page.getByRole("heading", { name: "英语学习进度", exact: true }).waitFor({ state: "visible" });
    const layout = await cardLayout(app.page);
    insist(layout.horizontalOverflow === 0, `1024x720 横向溢出 ${layout.horizontalOverflow}px`);
    insist(layout.cardVisible && layout.composerVisible, "1024x720 卡片或输入框不完整");
    insist(layout.nativeIframeCount === 0, "对话里的可视化卡片仍然依赖 iframe");
    await app.page.locator('section[aria-label="可视化成果：英语学习进度"]')
      .getByText(RELATIVE_FILE, { exact: true })
      .waitFor({ state: "visible" });
    facts.layout.card1024x720 = layout;
    facts.checks.nativeCardAt1024 = true;
    await app.page.screenshot({ path: CARD_SCREENSHOT, animations: "disabled" });
    facts.screenshots.card = relativeOutput(CARD_SCREENSHOT);

    await app.page.getByRole("button", { name: "在预览中打开", exact: true }).click();
    const preview = app.page.locator('iframe[title="本周进度.html"]');
    await preview.waitFor({ state: "visible" });
    const previewHandle = await preview.elementHandle();
    const previewFrame = await previewHandle?.contentFrame();
    insist(previewFrame, "可视化预览 iframe 没有加载");
    const previewFacts = await previewFrame.evaluate(({ scriptProbe, networkProbe, wrapProbe, headerWrapProbe }) => {
      const wrapNode = [...document.querySelectorAll("strong")]
        .find((element) => element.textContent === wrapProbe);
      const wrapRange = document.createRange();
      if (wrapNode) wrapRange.selectNodeContents(wrapNode);
      const wrapRects = wrapNode ? [...wrapRange.getClientRects()] : [];
      const surfaceRect = document.querySelector(".surface")?.getBoundingClientRect();
      const wrapContainer = wrapNode?.closest(".timeline-content");
      const headerNode = document.querySelector("header p");
      const headerRange = document.createRange();
      if (headerNode) headerRange.selectNodeContents(headerNode);
      const headerRects = headerNode ? [...headerRange.getClientRects()] : [];
      const mainRect = document.querySelector("main")?.getBoundingClientRect();
      return {
        bodyText: document.body.innerText,
        scriptRan: Boolean(window.__LEEMO_VISUALIZATION_SCRIPT_PROBE__),
        networkRequested: performance.getEntriesByType("resource")
          .some((entry) => entry.name.includes(networkProbe)),
        containsLiteralProbe: document.body.innerText.includes(scriptProbe),
        wrapProbePresent: Boolean(wrapNode),
        wrapLineCount: wrapRects.length,
        wrapWithinSurface: Boolean(surfaceRect) && wrapRects.every((rect) => (
          rect.left >= surfaceRect.left - 1 && rect.right <= surfaceRect.right + 1
        )),
        wrapContainerOverflow: wrapContainer instanceof HTMLElement
          ? Math.max(0, wrapContainer.scrollWidth - wrapContainer.clientWidth)
          : null,
        overflowWrap: wrapNode ? getComputedStyle(wrapNode).overflowWrap : null,
        headerWrapProbePresent: Boolean(headerNode?.textContent?.includes(headerWrapProbe)),
        headerWrapLineCount: headerRects.length,
        headerWrapWithinMain: Boolean(mainRect) && headerRects.every((rect) => (
          rect.left >= mainRect.left - 1 && rect.right <= mainRect.right + 1
        )),
        headerContainerOverflow: headerNode instanceof HTMLElement
          ? Math.max(0, headerNode.scrollWidth - headerNode.clientWidth)
          : null,
        headerOverflowWrap: headerNode ? getComputedStyle(headerNode).overflowWrap : null,
      };
    }, {
      scriptProbe: SCRIPT_PROBE,
      networkProbe: NETWORK_PROBE,
      wrapProbe: WRAP_PROBE,
      headerWrapProbe: HEADER_WRAP_PROBE,
    });
    insist(!previewFacts.scriptRan, "预览执行了脚本探针");
    insist(!previewFacts.networkRequested, "预览发出了网络探针请求");
    insist(previewFacts.containsLiteralProbe, "预览没有保留安全的文字内容");
    insist(previewFacts.wrapProbePresent, "预览缺少连续长文本探针");
    insist(previewFacts.overflowWrap === "anywhere", "预览没有启用连续长文本换行");
    insist(previewFacts.wrapLineCount > 1, "连续长文本没有实际换行");
    insist(previewFacts.wrapWithinSurface, "连续长文本被预览容器裁切");
    insist(previewFacts.wrapContainerOverflow === 0, "连续长文本撑破了时间线容器");
    insist(previewFacts.headerWrapProbePresent, "预览缺少标题区连续长文本探针");
    insist(previewFacts.headerOverflowWrap === "anywhere", "预览标题区没有启用连续长文本换行");
    insist(previewFacts.headerWrapLineCount > 1, "标题区连续长文本没有实际换行");
    insist(previewFacts.headerWrapWithinMain, "标题区连续长文本被预览容器裁切");
    insist(previewFacts.headerContainerOverflow === 0, "标题区连续长文本撑破了预览容器");
    facts.checks.previewWrapsContinuousText = true;
    const previewLayout = await app.page.evaluate(() => {
      const conversation = document.querySelector('[data-testid="conversation-column"]');
      return {
        pageHorizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        conversationHorizontalOverflow: conversation instanceof HTMLElement
          ? Math.max(0, conversation.scrollWidth - conversation.clientWidth)
          : null,
      };
    });
    insist(previewLayout.pageHorizontalOverflow === 0, "打开预览后页面出现横向溢出");
    insist(previewLayout.conversationHorizontalOverflow === 0, "打开预览后对话列出现横向溢出");
    facts.layout.preview1024x720 = previewLayout;
    facts.checks.previewIsScriptAndNetworkFree = true;
    await app.page.screenshot({ path: PREVIEW_SCREENSHOT, animations: "disabled" });
    facts.screenshots.preview = relativeOutput(PREVIEW_SCREENSHOT);

    await app.page.getByRole("button", { name: "成果", exact: true }).click();
    await app.page.getByRole("heading", { name: "成果", exact: true }).waitFor({ state: "visible" });
    await app.page.getByTestId("artifact-card").getByText("本周进度.html", { exact: true }).waitFor({ state: "visible" });
    const artifactText = await app.page.locator("main").innerText();
    insist(artifactText.includes(RELATIVE_FILE), "成果页没有展示实际落盘路径");
    facts.checks.artifactIndexed = true;
    facts.rendererErrors.push(...app.rendererErrors);

    app = await harness.restart("原生可视化重启恢复");
    await ensureWorkbench(app.page);
    await app.page.getByRole("button", { name: "成果", exact: true }).click();
    await app.page.getByTestId("artifact-card").getByText("本周进度.html", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    insist(fs.existsSync(output), "重启后可视化文件消失");
    facts.checks.restartRestoredArtifact = true;
    facts.rendererErrors = [...new Set([...facts.rendererErrors, ...app.rendererErrors])];
    insist(facts.rendererErrors.length === 0, `renderer 报错：${facts.rendererErrors.join(" | ")}`);

    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[native-visualization] PASS ${Object.keys(facts.checks).length} checks`);
    console.log(`[native-visualization] facts ${relativeOutput(FACTS_PATH)}`);
  } finally {
    await harness.close();
  }
}

await run();
