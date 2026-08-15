import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");
const executable = path.join(
  root,
  "bundled-runtime",
  "windows-mcp",
  "release",
  "Sbroenne.WindowsMcp.exe",
);

const children = new Set<ReturnType<typeof spawn>>();

afterEach(() => {
  for (const child of children) child.kill();
  children.clear();
});

describe.runIf(process.platform === "win32")("随包 Windows 操作运行时", () => {
  it("使用 Per-Monitor DPI 坐标，避免高缩放窗口截图只剩左上角", () => {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    children.add(child);
    expect(child.pid).toBeTypeOf("number");

    const probe = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LeemoDpiProbe {
  [DllImport("shcore.dll")]
  public static extern int GetProcessDpiAwareness(IntPtr process, out int awareness);
}
'@
$process = Get-Process -Id ${child.pid}
$awareness = -1
$result = [LeemoDpiProbe]::GetProcessDpiAwareness($process.Handle, [ref]$awareness)
if ($result -ne 0) { throw "GetProcessDpiAwareness failed: $result" }
Write-Output $awareness
`;

    const awareness = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", probe],
      { encoding: "utf8" },
    ).trim();

    // PROCESS_PER_MONITOR_DPI_AWARE = 2 in PROCESS_DPI_AWARENESS.
    expect(awareness).toBe("2");
  });
});
