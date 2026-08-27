// Prove that the Browser MCP works from the packaged file layout, without a
// model call or external network access. The packaged Leemo executable re-enters
// itself as Node, starts Playwright MCP from app.asar, launches the installed
// Chrome/Edge with a temporary profile, fills and submits a local form, then
// restarts the whole MCP process and proves the same browser identity restored
// the saved state. This stays offline and spends no model tokens.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXE_ARG = process.argv[2];
const EXE = EXE_ARG ? path.resolve(EXE_ARG) : undefined;
if (!EXE || !fs.existsSync(EXE)) {
  console.error(`Usage: node scripts/verify-packaged-browser-mcp.mjs <Leemo.exe>\nReceived: ${EXE_ARG ?? "(none)"}`);
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const OUTPUT_DIR = path.join(ROOT, "docs", "research", "audit-shots");
const FACTS_PATH = path.join(OUTPUT_DIR, "packaged-browser-mcp-facts.json");
const SCREENSHOT_PATH = path.join(OUTPUT_DIR, "packaged-browser-mcp.png");
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-packaged-browser-mcp-"));
const CLI = path.join(
  path.dirname(EXE),
  "resources", "app.asar", "node_modules", "@playwright", "mcp", "cli.js",
);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function insist(value, message) {
  if (!value) throw new Error(message);
}

function browserChannel() {
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.some((candidate) => fs.existsSync(candidate)) ? "chrome" : "msedge";
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

const persistedProof = "Leemo persistent browser proof";
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><title>Leemo packaged Browser MCP</title></head>
    <body style="font-family:system-ui;padding:48px;background:#f5f6f7;color:#202124">
      <main style="max-width:720px;margin:auto;background:white;border:1px solid #ddd;padding:32px">
        <p style="color:#d9480f">Leemo acceptance</p>
        <h1>Packaged Browser MCP is working</h1>
        <p id="proof">Local page reached through the real MCP browser.</p>
        <label>Application note <input aria-label="Application note" style="display:block;width:100%;margin:12px 0;padding:8px"></label>
        <button type="button" style="padding:8px 14px">Save draft</button>
        <p id="status">No draft saved</p>
      </main>
      <script>
        const input = document.querySelector('input');
        const status = document.querySelector('#status');
        const restored = localStorage.getItem('leemo-browser-proof');
        if (restored) {
          input.value = restored;
          status.textContent = 'Draft restored: ' + restored;
        }
        document.querySelector('button').addEventListener('click', () => {
          localStorage.setItem('leemo-browser-proof', input.value);
          status.textContent = 'Draft saved: ' + input.value;
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

const channel = browserChannel();
function createSession(suffix) {
  const transport = new StdioClientTransport({
    command: EXE,
    args: [
      CLI,
      "--browser", channel,
      "--headless",
      "--user-data-dir", path.join(TEMP_ROOT, "profile"),
      "--output-dir", path.join(TEMP_ROOT, "output"),
      "--caps", "vision,pdf,devtools",
      "--viewport-size", "1280x800",
    ],
    env: { ...getDefaultEnvironment(), ELECTRON_RUN_AS_NODE: "1" },
    cwd: TEMP_ROOT,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 8_000) stderr += String(chunk);
  });
  const client = new Client({ name: `leemo-packaged-browser-acceptance-${suffix}`, version: "1.0.0" });
  return { client, transport, stderr: () => stderr };
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

async function closeSession(session) {
  await session.client.callTool({ name: "browser_close", arguments: {} }).catch(() => {});
  await session.client.close().catch(() => session.transport.close().catch(() => {}));
}

let session;

try {
  session = createSession("first");
  await withTimeout(session.client.connect(session.transport), 45_000, "MCP initialize");
  const listed = await withTimeout(session.client.listTools(), 30_000, "MCP tools/list");
  const toolNames = listed.tools.map((tool) => tool.name);
  for (const required of ["browser_navigate", "browser_snapshot", "browser_type", "browser_click", "browser_take_screenshot"]) {
    insist(toolNames.includes(required), `Packaged Browser MCP is missing ${required}`);
  }

  const navigate = await withTimeout(
    session.client.callTool({ name: "browser_navigate", arguments: { url: pageUrl } }),
    60_000,
    "browser_navigate",
  );
  const snapshot = await withTimeout(
    session.client.callTool({ name: "browser_snapshot", arguments: {} }),
    30_000,
    "browser_snapshot",
  );
  const snapshotText = textContent(snapshot);
  const visibleText = `${textContent(navigate)}\n${snapshotText}`;
  insist(visibleText.includes("Packaged Browser MCP is working"), "Browser MCP did not read the local page");
  const inputRef = snapshotRef(snapshotText, 'textbox "Application note"');
  const saveRef = snapshotRef(snapshotText, 'button "Save draft"');
  insist(inputRef, "Browser snapshot did not expose the application-note textbox ref");
  insist(saveRef, "Browser snapshot did not expose the save button ref");

  const typed = await withTimeout(session.client.callTool({
    name: "browser_type",
    arguments: { element: "Application note", target: inputRef, text: persistedProof },
  }), 30_000, "browser_type");
  const clicked = await withTimeout(session.client.callTool({
    name: "browser_click",
    arguments: { element: "Save draft", target: saveRef },
  }), 30_000, "browser_click");
  const savedSnapshot = await withTimeout(
    session.client.callTool({ name: "browser_snapshot", arguments: {} }),
    30_000,
    "browser_snapshot after save",
  );
  const savedSnapshotText = textContent(savedSnapshot);
  insist(
    savedSnapshotText.includes(`Draft saved: ${persistedProof}`),
    [
      "Browser click did not save the draft",
      `browser_type: ${textContent(typed) || "(no text response)"}`,
      `browser_click: ${textContent(clicked) || "(no text response)"}`,
      `snapshot: ${savedSnapshotText || "(empty)"}`,
    ].join("\n\n"),
  );

  await closeSession(session);
  session = undefined;
  await new Promise((resolve) => setTimeout(resolve, 700));

  session = createSession("restart");
  await withTimeout(session.client.connect(session.transport), 45_000, "MCP restart initialize");
  await withTimeout(
    session.client.callTool({ name: "browser_navigate", arguments: { url: pageUrl } }),
    60_000,
    "browser_navigate after restart",
  );
  const restoredSnapshot = await withTimeout(
    session.client.callTool({ name: "browser_snapshot", arguments: {} }),
    30_000,
    "browser_snapshot after restart",
  );
  insist(
    textContent(restoredSnapshot).includes(`Draft restored: ${persistedProof}`),
    "Browser profile did not restore state after the MCP process restarted",
  );

  const shot = await withTimeout(
    session.client.callTool({ name: "browser_take_screenshot", arguments: { type: "png" } }),
    30_000,
    "browser_take_screenshot",
  );
  const image = (shot.content ?? []).find((item) => item.type === "image");
  insist(image?.data, "Browser MCP returned no screenshot image");
  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(image.data, "base64"));

  const facts = {
    checkedAt: new Date().toISOString(),
    modelCalls: 0,
    executable: EXE,
    cliInsideAsar: CLI,
    browser: channel,
    tools: toolNames,
    initialized: true,
    localNavigation: true,
    routineFormActions: ["browser_type", "browser_click"],
    formSaved: true,
    profileRestoredAfterMcpRestart: true,
    snapshotReadProof: true,
    screenshot: path.basename(SCREENSHOT_PATH),
  };
  fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(facts, null, 2));
} catch (error) {
  console.error("[packaged-browser-mcp] FAIL", error);
  if (session?.stderr().trim()) console.error(session.stderr().trim());
  process.exitCode = 1;
} finally {
  if (session) await closeSession(session);
  await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(TEMP_ROOT);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("leemo-packaged-browser-mcp-")) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* browser profile release can lag */ }
  }
}
