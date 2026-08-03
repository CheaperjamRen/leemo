// scripts/electron-skills-harness.mjs — 卡 E 实机验收用的隔离实例。
//
// 和 electron:dev 的区别只有三点，都是为了"不打扰用户已经开着的那个实例"：
//   • vite 端口 5199（默认 5173 归用户）
//   • CDP 端口 9333（默认 9222 归用户）
//   • --user-data-dir 指向临时目录 → 独立 SQLite / 独立密钥库（首跑从 .env 迁移）
//
// 用法: node scripts/electron-skills-harness.mjs
//       另开终端: LEEMO_DEBUG_PORT=9333 LEEMO_VITE_PORT=5199 node scripts/cdp-skills-verify.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const VITE_PORT = process.env.LEEMO_VITE_PORT ?? "5199";
const DEBUG_PORT = process.env.LEEMO_DEBUG_PORT ?? "9333";
const RENDERER_URL = `http://localhost:${VITE_PORT}`;
const USER_DATA = path.join(os.tmpdir(), "leemo-skills-harness");

fs.mkdirSync(USER_DATA, { recursive: true });

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

async function waitForVite(url, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite did not come up at ${url}`);
}

const vite = spawn("npm", ["run", "dev", "--", "--port", VITE_PORT, "--strictPort"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
children.push(vite);

await import("./build-main.mjs");
await waitForVite(RENDERER_URL);

console.log(`[harness] userData: ${USER_DATA}`);
console.log(`[harness] renderer: ${RENDERER_URL} | CDP: ${DEBUG_PORT}`);

const electron = spawn(
  electronPath,
  [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    path.join(root, "dist-electron", "main.mjs"),
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, LEEMO_RENDERER_URL: RENDERER_URL } },
);
children.push(electron);
electron.on("exit", (code) => killAll(code ?? 0));
