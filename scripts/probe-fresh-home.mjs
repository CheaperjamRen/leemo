// 轮 5：为什么"重定向 HOME 起打包 App"起不来 —— 把退出码和输出都抓出来。
//
// 验收⑤ 要的是"~/Leemo 在打包后被正确创建"。main.ts 用的是
// `workspaceRootFor(app.getPath("home"))`，而 Windows 上 Electron 的 home 来自
// `os.homedir()` = `%USERPROFILE%`。所以想验"全新一台机器"只能改这个环境变量。
// 上一版三个变量一起改（USERPROFILE + HOME + APPDATA），结果进程连一行输出都没有。
// 这里逐个试，看是哪个变量把它弄死的。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EXE = process.argv[2];
if (!EXE || !fs.existsSync(EXE)) {
  console.error("用法: node scripts/probe-fresh-home.mjs <Leemo.exe>");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function armWithArgs(name, mkEnv, mkArgs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-"));
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), "la-"));
  const env = mkEnv({ ...process.env }, home, appdata);
  const args = mkArgs ? mkArgs(home, appdata) : [];
  const child = spawn(EXE, args, { cwd: home, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
  let out = "";
  child.stdout.on("data", (b) => (out += b.toString()));
  child.stderr.on("data", (b) => (out += b.toString()));
  let exited = null;
  child.on("exit", (code, sig) => (exited = { code, sig }));

  const root = path.join(home, "Leemo");
  for (let i = 0; i < 25; i++) {
    if (fs.existsSync(path.join(root, "CLAUDE.md"))) break;
    if (exited) break;
    await sleep(1000);
  }
  const created = fs.existsSync(root);
  const listing = created ? fs.readdirSync(root).join(", ") : "(无)";
  console.log(`\n--- ${name} ---`);
  console.log(`  ~/Leemo 建了吗: ${created ? "是" : "否"}  内容: ${listing}`);
  console.log(`  userData(${path.basename(appdata)}/Leemo): ${fs.existsSync(path.join(appdata, "Leemo")) ? "有" : "无"}`);
  console.log(`  进程退出: ${exited ? `code=${exited.code} sig=${exited.sig}` : "仍在运行"}`);
  // 关键判据：主进程自己说它把 workspace/memory 解到了哪儿。
  const wsLine = (out.match(/\[leemo:main\] workspace: .*/) || [])[0] ?? "(没有 workspace 日志行)";
  const mbLine = (out.match(/\[leemo:main\] memory bank: .*/) || [])[0] ?? "(没有 memory bank 日志行)";
  console.log(`  ${wsLine}`);
  console.log(`  ${mbLine}`);
  console.log(`  我期待的 home = ${home}`);
  console.log(`  输出(前 900 字):\n${out.slice(0, 900).split("\n").map((l) => `    ${l}`).join("\n") || "    (空)"}`);

  if (!exited) {
    try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { child.kill(); }
    await sleep(2000);
  }
  for (const d of [home, appdata]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 占用 */ }
  }
  return created;
}

/** 不带额外参数的常见情形。 */
const arm = (name, mkEnv) => armWithArgs(name, mkEnv, undefined);

// ① 只改 USERPROFILE/HOME（userData 仍在真 APPDATA —— 会和真库共用，仅用于定位问题）
if (process.argv[3] !== "only2") {
  await arm("① 只重定向 USERPROFILE + HOME", (e, home) => ({ ...e, USERPROFILE: home, HOME: home }));
}

// ② USERPROFILE/HOME + 用 --user-data-dir 隔离 userData（Electron 原生开关，比改 APPDATA 稳）
await armWithArgs(
  "② USERPROFILE + HOME，userData 用 --user-data-dir",
  (e, home) => ({ ...e, USERPROFILE: home, HOME: home }),
  (home) => [`--user-data-dir=${path.join(home, "_ud")}`],
);

// ③ 三个都改（上一版的做法）
if (process.argv[3] !== "only2") {
  await arm("③ USERPROFILE + HOME + APPDATA（上一版）", (e, home, appdata) => ({
    ...e, USERPROFILE: home, HOME: home, HOMEPATH: home, APPDATA: appdata,
  }));
}
