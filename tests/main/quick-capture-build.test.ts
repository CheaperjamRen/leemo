import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("quick capture renderer and preload build", () => {
  it("builds a separate sandboxed preload for the quick capture window", () => {
    const buildScript = read("scripts/build-main.mjs");
    expect(buildScript).toContain("src/main/quick-capture-preload.ts");
    expect(buildScript).toContain("quick-capture-preload.cjs");
  });

  it("uses an independent HTML entry instead of mounting the full Leemo app", () => {
    const viteConfig = read("vite.config.ts");
    expect(viteConfig).toContain("quick-capture.html");
    expect(read("quick-capture.html")).toContain("/src/renderer/quick-capture/main.tsx");
  });

  it("keeps the quick preload narrow", () => {
    const preload = read("src/main/quick-capture-preload.ts");
    expect(preload).toContain('exposeInMainWorld("leemoQuickCapture"');
    expect(preload).not.toContain('exposeInMainWorld("leemoBridge"');
    expect(preload).not.toContain('exposeInMainWorld("leemoPersist"');
    expect(preload).not.toContain('exposeInMainWorld("leemoWorkspace"');
    expect(preload).not.toContain('exposeInMainWorld("leemoScheduler"');
    expect(preload).not.toContain('exposeInMainWorld("leemoLearning"');
  });

  it("exposes the full capture client only to the main renderer", () => {
    expect(read("src/main/preload.ts")).toContain('exposeInMainWorld("leemoCapture"');
  });

  it("wires managed capture storage and momo to the shared SQLite-backed services", () => {
    const main = read("src/main/main.ts");
    expect(main).toContain("createCaptureStorage()");
    expect(main).toContain("getStorageRoot: () => captureStorageRoot");
    expect(main).toContain("setStorageRoot: persistCaptureStorageRoot");
    expect(main).toContain("captures: captureAdmin");
    expect(main).toContain("tasks: taskAdmin");
    expect(main).toContain('ipcMain.handle("leemo:capture"');
    expect(main).toContain('ipcMain.handle("leemo:trash"');
    expect(main).toContain("createTrashIpcDispatcher({ captures: captureAdmin, tasks: taskAdmin })");
    expect(main).toContain("captureAdmin.purgeExpired()");
    expect(main).toContain("taskAdmin.purgeExpired()");
    expect(main).toContain("event.sender === win?.webContents");
    expect(main).toContain("event.sender === quickCaptureWindow?.webContents");
    expect(main).toContain('webContents.send("leemo:capture:changed"');
  });

  it("keeps storage-root choice native and the quick preload limited to post-commit attachment capture", () => {
    const main = read("src/main/main.ts");
    expect(main).toContain('ipcMain.handle("leemo:choose-capture-storage-root"');
    expect(read("src/main/preload.ts")).toContain("chooseCaptureStorageRoot");
    const quickPreload = read("src/main/quick-capture-preload.ts");
    expect(quickPreload).toContain("attachImageBytes");
    expect(quickPreload).toContain("attachDroppedFile");
    expect(quickPreload).not.toContain("attachExternalFile");
    expect(quickPreload).not.toContain("attachFileCopy");
  });

  it("loads the independent quick renderer and applies persisted desktop settings", () => {
    const main = read("src/main/main.ts");
    expect(main).toContain('preload: path.join(HERE, "quick-capture-preload.cjs")');
    expect(main).toContain('"quick-capture.html"');
    expect(main).toContain("continueInBackgroundSetting(initialSettings)");
    expect(main).toContain("quickCaptureShortcutSetting(initialSettings)");
    expect(main).toContain("quickCaptureController.start()");
    expect(main).toMatch(/quickCaptureController\?\.bindMainWindow\(guardedWindow\)/u);
  });

  it("keeps desktop configuration transactional and preserves background window semantics", () => {
    const main = read("src/main/main.ts");
    expect(main).toContain('ipcMain.handle("leemo:desktop"');
    expect(main).toMatch(/quickCaptureController\?\.updateShortcut/u);
    expect(main).toMatch(/persistence!\.saveSettings\(nextSettings\)/u);
    expect(main).toContain("if (continueInBackground || process.platform === \"darwin\") return");
    expect(main).toContain("quickCaptureController?.dispose()");
  });
});
