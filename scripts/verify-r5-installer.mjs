// 轮 5 验收②：**真的用 NSIS 安装包装一遍**，跑装出来的那个 App，再卸干净。
//
// 为什么不能拿 win-unpacked 顶替这一格：win-unpacked 是打包的中间产物，用户拿到的
// 是安装器。安装器还多做几件会出错的事 —— 解 7z 载荷、摊 app.asar.unpacked、写
// 快捷方式、注册卸载项。只验 win-unpacked 就等于没验"用户装完能不能用"。
//
// 复用 verify-r5-packaged.mjs 的 bootstrap 趟（真界面 + 真流式），不另写一份驱动：
// 判据只该有一处定义。
//
// 用法：node scripts/verify-r5-installer.mjs [安装包路径]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), "..");
const SETUP = process.argv[2] || path.join(REPO, "dist-package", "Leemo Setup 0.0.1.exe");
if (!fs.existsSync(SETUP)) {
  console.error(`找不到安装包: ${SETUP}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : undefined;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});
const results = [];
const check = (n, ok, note = "") => {
  results.push({ n, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${note ? `\n      ${note}` : ""}`);
};

// 装到一个全新目录。perMachine:false ⇒ 每用户安装，不需要 UAC。
// /S = 静默；/D= 必须是最后一个参数且**不能加引号**（NSIS 的规矩）。
const target = path.join(os.tmpdir(), `LeemoInstall-${Date.now()}`);
console.log(`=== 静默安装到 ${target} ===`);
const t0 = Date.now();
const inst = spawnSync(SETUP, ["/S", `/D=${target}`], { stdio: "inherit", windowsHide: false });
check("安装器退出码为 0", inst.status === 0, `status=${inst.status} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`);

const exe = path.join(target, "Leemo.exe");
for (let i = 0; i < 60; i++) {
  if (fs.existsSync(exe)) break;
  await sleep(1000);
}
check("装出了 Leemo.exe", fs.existsSync(exe), exe);

// 安装产物的形状：原生 CLI 必须也被摊到 asar 外（安装器解包时最容易丢的就是它）
const unpackedCli = path.join(
  target, "resources", "app.asar.unpacked", "node_modules",
  "@anthropic-ai", "claude-agent-sdk-win32-x64", "claude.exe",
);
check("安装产物里原生 CLI 在 app.asar.unpacked 下", fs.existsSync(unpackedCli),
  fs.existsSync(unpackedCli)
    ? `${(fs.statSync(unpackedCli).size / 1024 / 1024).toFixed(0)}MB`
    : `缺失: ${unpackedCli}`);
const asar = path.join(target, "resources", "app.asar");
check("安装产物里有 app.asar", fs.existsSync(asar),
  fs.existsSync(asar) ? `${(fs.statSync(asar).size / 1024 / 1024).toFixed(0)}MB` : "缺失");

if (fs.existsSync(target)) {
  const stat = spawnSync("powershell", [
    "-NoProfile", "-Command",
    `$s=(Get-ChildItem '${target}' -Recurse -File -EA SilentlyContinue | Measure-Object -Sum Length); Write-Output "$($s.Count) files, $([math]::Round($s.Sum/1MB,1)) MB"`,
  ], { encoding: "utf8" });
  console.log(`      安装目录: ${(stat.stdout || "").trim()}`);
}

// 真界面 + 真流式：复用 bootstrap 趟，对着**装出来的** exe 跑。
if (fs.existsSync(exe)) {
  console.log(`\n=== 对装出来的 App 跑 bootstrap 趟（真界面 + 真流式）===`);
  // The developer app commonly owns 9333. Give the installed app a fresh CDP
  // port so the verifier cannot accidentally attach to localhost:5173 and
  // report the wrong process as an installer failure.
  const debugPort = await findFreePort();
  const r = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "verify-r5-packaged.mjs"), exe, "bootstrap"],
    {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, LEEMO_DEBUG_PORT: String(debugPort) },
      timeout: 8 * 60 * 1000,
    },
  );
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
  const passes = (out.match(/^PASS /gm) || []).length;
  const fails = (out.match(/^FAIL /gm) || []).length;
  check("装出来的 App：bootstrap 趟全绿（含真流式对话）", fails === 0 && passes > 0,
    `PASS=${passes} FAIL=${fails}`);
}

// 卸干净。卸载器由 electron-builder 生成在安装目录里。
const uninst = ["Uninstall Leemo.exe", "Uninstall leemo.exe"]
  .map((n) => path.join(target, n))
  .find((p) => fs.existsSync(p));
console.log(`\n=== 卸载 ===`);
if (uninst) {
  spawnSync("taskkill", ["/IM", "Leemo.exe", "/T", "/F"], { stdio: "ignore" });
  await sleep(2000);
  const u = spawnSync(uninst, ["/S"], { stdio: "inherit" });
  // NSIS 的卸载器会把自己复制到临时目录再退出，父进程的退出码不代表卸完了 —— 等目录消失。
  for (let i = 0; i < 60; i++) {
    if (!fs.existsSync(exe)) break;
    await sleep(1000);
  }
  check("卸载后主程序被移除", !fs.existsSync(exe), `uninstaller status=${u.status}`);
  if (fs.existsSync(target)) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* 残留 */ }
  }
  check("安装目录已清干净", !fs.existsSync(target), target);
} else {
  check("找到卸载器", false, `没有在 ${target} 里找到 Uninstall*.exe`);
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${bad.length ? "FAIL" : "PASS"} ${results.length - bad.length}/${results.length}`);
if (bad.length) console.log(bad.map((b) => `  - ${b.n}`).join("\n"));
process.exit(bad.length ? 1 : 0);
