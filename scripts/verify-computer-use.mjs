import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "bundled-runtime", "windows-mcp", "release", "Sbroenne.WindowsMcp.exe");
const fixture = path.join(root, "scripts", "fixtures", "computer-use-acceptance.ps1");
const expectedText = "Leemo 电脑操作验收";
const client = new Client({ name: "leemo-computer-acceptance", version: "1.0.0" });
const transport = new StdioClientTransport({ command: executable, args: [], stderr: "pipe" });
let launchedPid;

function parsedText(result, operation) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  let payload;
  try {
    payload = JSON.parse(text ?? "{}");
  } catch {
    throw new Error(`${operation} returned unreadable data`);
  }
  if (result.isError || payload.success === false) {
    throw new Error(`${operation} failed: ${payload.error ?? text ?? "unknown error"}`);
  }
  return payload;
}

async function call(name, args) {
  return parsedText(await client.callTool({ name, arguments: args }), name);
}

try {
  await client.connect(transport);
  const launched = await call("app", {
    programPath: "powershell.exe",
    arguments: `-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${fixture}"`,
    waitForWindow: true,
    timeoutMs: 5_000,
  });
  const handle = launched.window?.handle;
  launchedPid = launched.window?.pid;
  if (typeof handle !== "string" || typeof launchedPid !== "number") {
    throw new Error("Acceptance app did not return an exact window handle and pid");
  }

  const snapshot = await call("ui_snapshot", { windowHandle: handle, maxDepth: 4 });
  await call("ui_wait", {
    windowHandle: handle,
    mode: "appear",
    automationId: "AcceptanceInput",
    controlType: "Edit",
    timeoutMs: 5_000,
  });
  await call("ui_type", {
    windowHandle: handle,
    automationId: "AcceptanceInput",
    text: expectedText,
    clearFirst: true,
  });
  const read = await call("ui_read", { windowHandle: handle, automationId: "AcceptanceInput" });
  if (read.text !== expectedText) {
    throw new Error(`Notepad verification mismatch: ${JSON.stringify(read.text)}`);
  }
  await call("ui_click", { windowHandle: handle, automationId: "AcceptanceConfirm", controlType: "Button" });
  const confirmed = await call("ui_read", { windowHandle: handle, automationId: "AcceptanceResult" });
  if (confirmed.text !== "Accepted") {
    throw new Error(`Click verification mismatch: ${JSON.stringify(confirmed.text)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    app: "Leemo Computer Acceptance",
    observedElements: snapshot.elementCount,
    typedAndRead: read.text,
    clickedAndRead: confirmed.text,
    verifiedActions: ["observe", "wait", "type", "read", "click"],
  }));
} finally {
  if (typeof launchedPid === "number") {
    try {
      process.kill(launchedPid);
    } catch {
      // The exact acceptance process may already have exited.
    }
  }
  await client.close().catch(() => transport.close().catch(() => {}));
}
