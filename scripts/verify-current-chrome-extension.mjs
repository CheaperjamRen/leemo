// Zero-model-cost acceptance for the optional "current Chrome" path. It opens
// one local proof page in the user's Chrome, waits for the official Playwright
// Extension to connect to that exact tab, then verifies read, type, click and
// MCP restart behavior without inspecting any other browser page.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMemoryAcceptanceHarness } from "./verify-memory-workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXE = path.resolve(process.argv[2] ?? path.join(ROOT, "dist-package", "win-unpacked", "Leemo.exe"));
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "current-chrome-extension-facts.json");
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-current-chrome-"));
const SETTINGS_ONLY = process.env.LEEMO_CURRENT_CHROME_SETTINGS_ONLY === "1";
const CLI = path.join(
  path.dirname(EXE),
  "resources", "app.asar", "node_modules", "@playwright", "mcp", "cli.js",
);
const PROOF_TITLE = `Leemo Current Chrome Proof ${path.basename(TEMP_ROOT).slice(-6)}`;
const PROOF_VALUE = "Leemo current Chrome path verified";

function insist(value, message) {
  if (!value) throw new Error(message);
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function chromeExecutable() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function textContent(result) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function snapshotRef(snapshotText, fragment) {
  const line = snapshotText.split(/\r?\n/).find((candidate) => candidate.includes(fragment));
  return line?.match(/\[ref=([^\]]+)\]/)?.[1];
}

function createSession(suffix) {
  const extensionToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim();
  const transport = new StdioClientTransport({
    command: EXE,
    args: [
      CLI,
      "--extension",
      "--output-dir", path.join(TEMP_ROOT, "output"),
      "--caps", "vision,pdf,devtools",
    ],
    env: {
      ...getDefaultEnvironment(),
      ELECTRON_RUN_AS_NODE: "1",
      ...(extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: extensionToken } : {}),
    },
    cwd: TEMP_ROOT,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 8_000) stderr += String(chunk);
  });
  return {
    client: new Client({ name: `leemo-current-chrome-${suffix}`, version: "1.0.0" }),
    transport,
    stderr: () => stderr,
  };
}

async function closeSession(session) {
  await session.client.close().catch(() => session.transport.close().catch(() => {}));
}

async function openBrowserSettings(page) {
  if (!(await page.getByTestId("settings-window").count())) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByTestId("settings-window").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "连接器", exact: true }).click();
  await page.locator("#settings-browser").waitFor({ state: "visible" });
}

insist(process.platform === "win32", "Current Chrome acceptance currently targets Windows");
insist(fs.existsSync(EXE), `Packaged Leemo executable is missing: ${EXE}`);
insist(
  fs.existsSync(path.join(path.dirname(EXE), "resources", "app.asar")),
  `Packaged Leemo app.asar is missing beside ${EXE}`,
);
const chrome = chromeExecutable();
insist(chrome, "Google Chrome is not installed");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><title>${PROOF_TITLE}</title></head>
    <body style="font-family:system-ui;padding:48px;background:#f5f6f7;color:#202124">
      <main style="max-width:720px;margin:auto;background:white;border:1px solid #ddd;padding:32px">
        <p>Leemo acceptance</p>
        <h1>${PROOF_TITLE}</h1>
        <label>Proof note <input aria-label="Proof note" style="display:block;width:100%;margin:12px 0;padding:8px"></label>
        <button type="button" style="padding:8px 14px">Save proof</button>
        <p id="status">No proof saved</p>
      </main>
      <script>
        const input = document.querySelector('input');
        const status = document.querySelector('#status');
        const restored = localStorage.getItem('leemo-current-chrome-proof');
        if (restored) {
          input.value = restored;
          status.textContent = 'Proof restored: ' + restored;
        }
        document.querySelector('button').addEventListener('click', () => {
          localStorage.setItem('leemo-current-chrome-proof', input.value);
          status.textContent = 'Proof saved: ' + input.value;
        });
      </script>
    </body></html>`);
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Local acceptance server did not bind a TCP port");
const pageUrl = `http://127.0.0.1:${address.port}/`;

if (!SETTINGS_ONLY) {
  await new Promise((resolve, reject) => {
    execFile(chrome, [pageUrl], (error) => error ? reject(error) : resolve());
  });
}

let session;
let harness;
let toolNames = [];
try {
  if (!SETTINGS_ONLY) {
    console.log(`[current-chrome] Select the "${PROOF_TITLE}" tab in the Playwright Extension connection page.`);
    session = createSession("first");
    await withTimeout(session.client.connect(session.transport), 45_000, "MCP initialize");
    const listed = await withTimeout(session.client.listTools(), 30_000, "MCP tools/list");
    toolNames = listed.tools.map((tool) => tool.name);
    for (const required of ["browser_tabs", "browser_navigate", "browser_snapshot", "browser_type", "browser_click"]) {
      insist(toolNames.includes(required), `Current Chrome MCP is missing ${required}`);
    }

    const tabs = await withTimeout(
      session.client.callTool({ name: "browser_tabs", arguments: { action: "list" } }),
      120_000,
      "browser_tabs",
    );
    insist(!tabs.isError, "Playwright Extension did not connect to Chrome");
    const snapshot = await withTimeout(
      session.client.callTool({ name: "browser_snapshot", arguments: {} }),
      30_000,
      "browser_snapshot",
    );
    const snapshotText = textContent(snapshot);
    insist(
      snapshotText.includes(PROOF_TITLE),
      `The selected Chrome tab is not the local ${PROOF_TITLE} page; no page action was performed`,
    );
    const inputRef = snapshotRef(snapshotText, 'textbox "Proof note"');
    const saveRef = snapshotRef(snapshotText, 'button "Save proof"');
    insist(inputRef && saveRef, "Current Chrome snapshot did not expose the local proof controls");

    await withTimeout(session.client.callTool({
      name: "browser_type",
      arguments: { element: "Proof note", target: inputRef, text: PROOF_VALUE },
    }), 30_000, "browser_type");
    await withTimeout(session.client.callTool({
      name: "browser_click",
      arguments: { element: "Save proof", target: saveRef },
    }), 30_000, "browser_click");
    const savedProof = await withTimeout(
      session.client.callTool({ name: "browser_snapshot", arguments: {} }),
      30_000,
      "browser_snapshot after save",
    );
    insist(textContent(savedProof).includes(`Proof saved: ${PROOF_VALUE}`), "Current Chrome click did not save the proof");

    await closeSession(session);
    session = undefined;
    await new Promise((resolve) => setTimeout(resolve, 700));

    console.log(`[current-chrome] Reconnect the same "${PROOF_TITLE}" tab if Chrome asks again.`);
    session = createSession("restart");
    await withTimeout(session.client.connect(session.transport), 45_000, "MCP restart initialize");
    const restartedTabs = await withTimeout(
      session.client.callTool({ name: "browser_tabs", arguments: { action: "list" } }),
      120_000,
      "browser_tabs after restart",
    );
    insist(!restartedTabs.isError, "Playwright Extension did not reconnect after MCP restart");
    await withTimeout(
      session.client.callTool({ name: "browser_navigate", arguments: { url: pageUrl } }),
      30_000,
      "local proof reload after restart",
    );
    const restored = await withTimeout(
      session.client.callTool({ name: "browser_snapshot", arguments: {} }),
      30_000,
      "browser_snapshot after restart",
    );
    const restoredText = textContent(restored);
    insist(
      restoredText.includes(`Proof restored: ${PROOF_VALUE}`),
      `The selected Chrome tab did not preserve its state across the MCP restart:\n${restoredText.slice(-1_000)}`,
    );

    await closeSession(session);
    session = undefined;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  harness = await createMemoryAcceptanceHarness({ prefix: "leemo-e2e-current-chrome-" });
  let app = await harness.start("当前 Chrome 首次配置");
  const saved = await app.page.evaluate(async () => window.leemoBridge.invoke("bridge:saveMcpServer", {
    id: "playwright",
    name: "浏览器自动化",
    transport: "stdio",
    enabled: true,
    browserMode: "extension",
  }));
  insist(saved.ok && saved.response.browserMode === "extension", "Packaged Leemo did not save Current Chrome mode");
  const listedAfterSave = await app.page.evaluate(async () => window.leemoBridge.invoke("bridge:listMcpServers", undefined));
  const savedBrowser = listedAfterSave.ok
    ? listedAfterSave.response.find((server) => server.id === "playwright")
    : undefined;
  insist(savedBrowser?.browserMode === "extension", "Packaged Leemo did not read back its saved Current Chrome mode");

  app = await harness.restart("当前 Chrome 重启恢复");
  await openBrowserSettings(app.page);
  const restoredMode = await app.page.getByRole("button", { name: "当前 Chrome", exact: true }).getAttribute("aria-pressed");
  insist(restoredMode === "true", "Leemo did not restore Current Chrome after the app restarted");

  const previousFacts = SETTINGS_ONLY && fs.existsSync(FACTS_PATH)
    ? JSON.parse(fs.readFileSync(FACTS_PATH, "utf8"))
    : {};
  const facts = {
    ...previousFacts,
    checkedAt: new Date().toISOString(),
    ...(!SETTINGS_ONLY ? {
      modelCalls: 0,
      packagedExecutable: path.relative(ROOT, EXE).replaceAll(path.sep, "/"),
      packagedCli: path.relative(ROOT, CLI).replaceAll(path.sep, "/"),
      extensionTokenUsed: Boolean(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim()),
      toolCount: toolNames.length,
      selectedOnlyLocalProofTab: true,
      snapshotReadProof: true,
      routineFormActions: ["browser_type", "browser_click"],
      formSaved: true,
      tabStateRestoredAfterMcpRestart: true,
    } : {}),
    settingsJourney: {
      selectedCurrentChrome: true,
      restoredAfterAppRestart: true,
    },
  };
  fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  console.error("[current-chrome] FAIL", error);
  if (session?.stderr().trim()) console.error(session.stderr().trim());
  process.exitCode = 1;
} finally {
  if (session) await closeSession(session);
  if (harness) await harness.close();
  await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(TEMP_ROOT);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("leemo-current-chrome-")) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* process cleanup can lag */ }
  }
}
