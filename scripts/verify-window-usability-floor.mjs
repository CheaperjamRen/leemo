import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OUTPUT_DIR,
  createMemoryAcceptanceHarness,
  ensureWorkbench,
} from "./verify-memory-workspace.mjs";

const PREFIX = "leemo-e2e-window-floor-";
const SCREENSHOT = path.join(OUTPUT_DIR, "window-floor-preview-960x680.png");
const RESTORED_SCREENSHOT = path.join(OUTPUT_DIR, "window-floor-restored-960x680.png");
const WIDE_SCREENSHOT = path.join(OUTPUT_DIR, "window-floor-side-by-side-1440x900.png");
const FACTS_PATH = path.join(OUTPUT_DIR, "window-floor-facts.json");

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function nearlyEqual(left, right, tolerance = 1) {
  return Math.abs(left - right) <= tolerance;
}

function sameRect(left, right, tolerance = 1) {
  return left && right
    && nearlyEqual(left.left, right.left, tolerance)
    && nearlyEqual(left.top, right.top, tolerance)
    && nearlyEqual(left.right, right.right, tolerance)
    && nearlyEqual(left.bottom, right.bottom, tolerance)
    && nearlyEqual(left.width, right.width, tolerance)
    && nearlyEqual(left.height, right.height, tolerance);
}

function resizeNativeWindow(processId, width, height) {
  insist(Number.isInteger(processId) && processId > 0, "无法取得 Leemo 主进程 PID");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class LeemoWindowProbe {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(
    IntPtr hWnd,
    IntPtr hWndInsertAfter,
    int X,
    int Y,
    int cx,
    int cy,
    uint uFlags
  );

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  public static IntPtr FindLargestTopLevelWindow(uint expectedProcessId) {
    IntPtr best = IntPtr.Zero;
    long bestArea = -1;
    EnumWindows((hWnd, _) => {
      uint ownerProcessId;
      GetWindowThreadProcessId(hWnd, out ownerProcessId);
      if (ownerProcessId != expectedProcessId) return true;
      RECT rect;
      if (!GetWindowRect(hWnd, out rect)) return true;
      long width = Math.Max(0, rect.Right - rect.Left);
      long height = Math.Max(0, rect.Bottom - rect.Top);
      long area = width * height;
      if (area > bestArea) {
        best = hWnd;
        bestArea = area;
      }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
'@

$targetProcessId = ${processId}
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$handle = [IntPtr]::Zero
do {
  Get-Process -Id $targetProcessId -ErrorAction Stop | Out-Null
  $handle = [LeemoWindowProbe]::FindLargestTopLevelWindow($targetProcessId)
  if ($handle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 50
} while ([DateTime]::UtcNow -lt $deadline)

if ($handle -eq [IntPtr]::Zero) {
  throw "Leemo 主窗口句柄在 10 秒内仍不可用"
}

$SWP_NOMOVE = 0x0002
$SWP_NOZORDER = 0x0004
if (-not [LeemoWindowProbe]::SetWindowPos(
  $handle,
  [IntPtr]::Zero,
  0,
  0,
  ${width},
  ${height},
  $SWP_NOMOVE -bor $SWP_NOZORDER
)) {
  throw "SetWindowPos failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

Start-Sleep -Milliseconds 150
$rect = New-Object LeemoWindowProbe+RECT
if (-not [LeemoWindowProbe]::GetWindowRect($handle, [ref]$rect)) {
  throw "GetWindowRect failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

[pscustomobject]@{
  left = $rect.Left
  top = $rect.Top
  width = $rect.Right - $rect.Left
  height = $rect.Bottom - $rect.Top
} | ConvertTo-Json -Compress
`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  return JSON.parse(output);
}

async function layout(page) {
  return page.evaluate(() => {
    const preview = document.querySelector('[data-testid="file-surface"]');
    const surface = document.querySelector('[data-testid="workbench-content-surface"]');
    const conversation = document.querySelector('[data-testid="conversation-surface"]');
    const composer = document.querySelector('[data-testid="workbench-composer-column"]');
    const rect = (element) => element?.getBoundingClientRect();
    const previewRect = rect(preview);
    const surfaceRect = rect(surface);
    const conversationRect = rect(conversation);
    const composerRect = rect(composer);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      surface: surfaceRect ? {
        left: surfaceRect.left,
        top: surfaceRect.top,
        right: surfaceRect.right,
        bottom: surfaceRect.bottom,
        width: surfaceRect.width,
        height: surfaceRect.height,
      } : null,
      preview: previewRect ? {
        left: previewRect.left,
        top: previewRect.top,
        right: previewRect.right,
        bottom: previewRect.bottom,
        width: previewRect.width,
        height: previewRect.height,
        fullyVisible: previewRect.left >= -1
          && previewRect.top >= -1
          && previewRect.right <= innerWidth + 1
          && previewRect.bottom <= innerHeight + 1,
        focused: document.activeElement === preview || preview.contains(document.activeElement),
      } : null,
      conversation: conversationRect ? {
        left: conversationRect.left,
        top: conversationRect.top,
        right: conversationRect.right,
        bottom: conversationRect.bottom,
        width: conversationRect.width,
        height: conversationRect.height,
        inert: conversation.hasAttribute("inert"),
        ariaHidden: conversation.getAttribute("aria-hidden"),
      } : null,
      composer: composerRect ? {
        left: composerRect.left,
        top: composerRect.top,
        right: composerRect.right,
        bottom: composerRect.bottom,
        width: composerRect.width,
        height: composerRect.height,
        fullyVisible: composerRect.left >= -1
          && composerRect.top >= -1
          && composerRect.right <= innerWidth + 1
          && composerRect.bottom <= innerHeight + 1,
        containsFocus: composer.contains(document.activeElement),
      } : null,
    };
  });
}

async function run() {
  const harness = await createMemoryAcceptanceHarness({ prefix: PREFIX });
  const facts = { checks: {}, layouts: {}, rendererErrors: [] };
  try {
    fs.mkdirSync(harness.workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(harness.workspaceRoot, "窄窗.md"), "# 窄窗预览\n\n内容保持完整。\n", "utf8");
    fs.writeFileSync(path.join(harness.workspaceRoot, "第二份.md"), "# 第二份预览\n\n切换文件后仍可继续操作。\n", "utf8");
    const app = await harness.start("窗口可用性底线");
    await ensureWorkbench(app.page);

    const wideRequestedBounds = { width: 1440, height: 900 };
    const wideNativeBounds = resizeNativeWindow(app.child.pid, wideRequestedBounds.width, wideRequestedBounds.height);
    insist(
      wideNativeBounds.width === wideRequestedBounds.width && wideNativeBounds.height === wideRequestedBounds.height,
      "Windows 没有把 Leemo 主窗口调整到宽窗验收尺寸",
    );
    await app.page.waitForFunction(() => innerWidth >= 1024);
    const wideBaseline = await layout(app.page);
    facts.wideRequestedBounds = wideRequestedBounds;
    facts.wideNativeBounds = wideNativeBounds;
    facts.layouts.wideBaseline = wideBaseline;

    await app.page.getByRole("button", { name: "文件", exact: true }).click();
    await app.page.getByTestId("file-row-窄窗.md").click();
    const preview = app.page.getByTestId("preview-pane-column");
    await preview.waitFor({ state: "visible" });
    await app.page.getByRole("heading", { name: "窄窗预览" }).waitFor({ state: "visible" });
    const widePreviewLayout = await layout(app.page);
    facts.layouts.widePreview = widePreviewLayout;
    await app.page.screenshot({ path: WIDE_SCREENSHOT, animations: "disabled" });
    insist(widePreviewLayout.viewport.width >= 1024, "宽窗误入窄窗预览布局");
    insist(widePreviewLayout.horizontalOverflow === 0, "宽窗打开预览后页面横向溢出");
    insist(widePreviewLayout.preview?.fullyVisible, "宽窗预览没有完整显示");
    insist(
      widePreviewLayout.surface
        && widePreviewLayout.preview.width < widePreviewLayout.surface.width - 100
        && nearlyEqual(widePreviewLayout.preview.top, widePreviewLayout.surface.top)
        && nearlyEqual(widePreviewLayout.preview.right, widePreviewLayout.surface.right)
        && nearlyEqual(widePreviewLayout.preview.bottom, widePreviewLayout.surface.bottom)
        && widePreviewLayout.conversation
        && widePreviewLayout.preview.left >= widePreviewLayout.conversation.right
        && widePreviewLayout.preview.left - widePreviewLayout.conversation.right <= 12,
      "宽窗预览没有保持对话、分隔手柄与文件并排",
    );
    insist(
      widePreviewLayout.conversation?.inert === false && widePreviewLayout.conversation.ariaHidden === null,
      "宽窗并排预览不应冻结底层对话",
    );
    facts.checks.widePreviewRemainsSideBySide = true;
    const wideToolBackdrop = app.page.getByTestId("workbench-tool-backdrop");
    if (await wideToolBackdrop.isVisible().catch(() => false)) await wideToolBackdrop.click();
    await app.page.getByRole("button", { name: "关闭 窄窗.md" }).click();

    const requestedBounds = { width: 640, height: 480 };
    const nativeBounds = resizeNativeWindow(app.child.pid, requestedBounds.width, requestedBounds.height);
    insist(
      nativeBounds.width >= 960 && nativeBounds.width <= 980
        && nativeBounds.height >= 680 && nativeBounds.height <= 700,
      `Leemo 没有把过小窗口约束在 960x680：${JSON.stringify(nativeBounds)}`,
    );
    await app.page.waitForFunction(() => innerWidth < 1024);
    facts.requestedBounds = requestedBounds;
    facts.nativeBounds = nativeBounds;
    facts.checks.nativeWindowClampsTo800x640 = true;
    const narrowBaseline = await layout(app.page);
    facts.layouts.narrowBaseline = narrowBaseline;

    await app.page.getByRole("button", { name: "文件", exact: true }).click();
    await app.page.getByTestId("file-row-窄窗.md").click();
    await preview.waitFor({ state: "visible" });
    await app.page.getByRole("heading", { name: "窄窗预览" }).waitFor({ state: "visible" });
    const previewLayout = await layout(app.page);
    facts.layouts.preview = previewLayout;
    await app.page.screenshot({ path: SCREENSHOT, animations: "disabled" });
    console.log(`[window-floor] preview layout ${JSON.stringify(previewLayout)}`);
    insist(previewLayout.viewport.width < 1024, "窄窗没有进入单主界面布局");
    insist(previewLayout.horizontalOverflow === 0, "打开预览后页面横向溢出");
    insist(previewLayout.preview?.fullyVisible, "窄窗预览没有完整覆盖主内容区");
    insist(
      previewLayout.preview
        && previewLayout.surface
        && nearlyEqual(previewLayout.preview.left, previewLayout.surface.left)
        && nearlyEqual(previewLayout.preview.right, previewLayout.surface.right)
        && nearlyEqual(previewLayout.preview.bottom, previewLayout.surface.bottom)
        && previewLayout.preview.top >= previewLayout.surface.top
        && previewLayout.preview.top - previewLayout.surface.top <= 48,
      "窄窗文件表面没有在工作表面内完整显示",
    );
    insist(sameRect(previewLayout.preview, previewLayout.conversation), "窄窗文件与对话表面没有复用同一画布");
    insist(
      previewLayout.conversation?.inert === true && previewLayout.conversation.ariaHidden === "true",
      "窄窗预览没有冻结被遮住的对话内容",
    );
    insist(previewLayout.preview?.focused === true, "窄窗预览打开后没有取得焦点");
    facts.checks.previewUsesSingleMainSurface = true;
    facts.checks.narrowPreviewOwnsInteraction = true;

    await app.page.getByRole("button", { name: "文件", exact: true }).click();
    await app.page.getByTestId("file-row-第二份.md").click();
    await app.page.getByRole("heading", { name: "第二份预览" }).waitFor({ state: "visible" });
    const switchedPreview = await layout(app.page);
    insist(switchedPreview.preview?.focused === true, "窄窗切换文件后焦点没有回到活动预览");
    insist(
      switchedPreview.conversation?.inert === true && switchedPreview.conversation.ariaHidden === "true",
      "窄窗切换文件后底层对话失去交互隔离",
    );
    facts.layouts.switchedPreview = switchedPreview;
    facts.checks.previewSwitchKeepsFocus = true;

    await app.page.getByRole("button", { name: "关闭 第二份.md" }).click();
    await app.page.getByRole("heading", { name: "窄窗预览" }).waitFor({ state: "visible" });
    insist((await layout(app.page)).preview?.focused === true, "关闭活动标签后焦点没有留在剩余预览");
    await app.page.getByRole("button", { name: "关闭 窄窗.md" }).click();
    const restored = await layout(app.page);
    await app.page.screenshot({ path: RESTORED_SCREENSHOT, animations: "disabled" });
    insist(restored.horizontalOverflow === 0, "关闭预览后页面横向溢出");
    insist(restored.preview === null, "关闭标签后预览仍占用主内容区");
    insist(restored.composer?.fullyVisible, "关闭预览后输入框没有完整显示");
    insist(sameRect(restored.composer, narrowBaseline.composer), "关闭预览后输入框没有恢复原始几何位置");
    insist(restored.composer?.containsFocus === true, "关闭预览后焦点没有回到可继续输入的位置");
    facts.layouts.restored = restored;
    facts.checks.composerRestoresAfterClose = true;
    facts.rendererErrors = app.rendererErrors;
    insist(facts.rendererErrors.length === 0, `renderer error: ${facts.rendererErrors.join(" | ")}`);
    fs.writeFileSync(FACTS_PATH, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    console.log(`[window-floor] PASS ${Object.keys(facts.checks).length} checks`);
  } finally {
    await harness.close();
  }
}

await run();
