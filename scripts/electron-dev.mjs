// electron:dev orchestrator — starts vite, builds the main/preload bundles,
// then launches Electron pointed at the vite dev server. Ties the three
// lifetimes together: killing this process (or Electron exiting) tears down vite.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const RENDERER_URL = process.env.LEEMO_RENDERER_URL || "http://localhost:5173";
const VITE_PORT = Number(new URL(RENDERER_URL).port || 5173);

/** Run a command, inheriting stdio, and resolve on exit. */
function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });
}

/** Poll the vite dev server until it answers, so Electron never loads a blank
 *  page before the bundler is up. */
async function waitForVite(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite dev server did not come up at ${url} within ${timeoutMs}ms`);
}

const children = [];
function killAll(code = 0) {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}
process.on("SIGINT", () => killAll(0));
process.on("SIGTERM", () => killAll(0));

async function main() {
  // 1. vite dev server
  const vite = run("npm", ["run", "dev", "--", "--port", String(VITE_PORT), "--strictPort"]);
  children.push(vite);

  // 2. build main + preload bundles
  await import("./build-main.mjs");

  // 3. wait for vite, then launch Electron
  await waitForVite(RENDERER_URL);
  const electronArgs = [path.join(root, "dist-electron", "main.mjs")];
  // Opt-in remote debugging so acceptance can attach a CDP driver (主控 亲验).
  if (process.env.LEEMO_DEBUG_PORT) {
    electronArgs.unshift(`--remote-debugging-port=${process.env.LEEMO_DEBUG_PORT}`);
  }
  // Extra Chromium switches, space-separated. ACCEPTANCE USE:
  //   --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows
  // Chromium marks a fully-covered window `visibilityState:"hidden"` and then
  // stops requestAnimationFrame — and pdfjs drives display rendering off rAF, so
  // `page.render()` never resolves and never errors. A CDP acceptance run that
  // does not have the window in front reads that as "PDF renders blank", which
  // is an environment artefact, not a defect. These switches remove the
  // ambiguity without changing anything about the product.
  if (process.env.LEEMO_DEBUG_FLAGS) {
    electronArgs.unshift(...process.env.LEEMO_DEBUG_FLAGS.split(/\s+/).filter(Boolean));
  }
  const electron = spawn(electronPath, electronArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, LEEMO_RENDERER_URL: RENDERER_URL },
  });
  children.push(electron);
  electron.on("exit", (code) => killAll(code ?? 0));
}

main().catch((e) => {
  console.error("[electron:dev]", e);
  killAll(1);
});
