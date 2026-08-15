// 轮 4「预览区通电」live 验收：对着 ~/Leemo 里四个**真文件**跑 readPreview，
// 证明"点文件显示真内容"这条链在真实 fs 上成立（单测用的是内存 fs）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPreview, workspaceRootFor } from "../dist-smoke/workspace.mjs";

const io = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
  readdir: (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
  stat: (p) => { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, size: s.size }; },
  readFile: (p) => fs.readFileSync(p, "utf8"),
  readBinary: (p, maxBytes) => {
    if (maxBytes === undefined) return fs.readFileSync(p);
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.allocUnsafe(maxBytes);
      const read = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, read);
    } finally { fs.closeSync(fd); }
  },
  copyFile: (a, b) => fs.copyFileSync(a, b),
  rename: (a, b) => fs.renameSync(a, b),
};

const root = workspaceRootFor(os.homedir());
const BK = "预览验收";
const cases = [
  { rel: `${BK}/笔记.md`, want: "text", check: (p) => p.text.includes("真的") && p.text.startsWith("# ") },
  { rel: `${BK}/日志.log`, want: "text", check: (p) => p.text.includes("不该变成标题") },
  { rel: `${BK}/数据.bin`, want: "unpreviewable", check: (p) => p.reason.includes("二进制") },
  { rel: `${BK}/说明书.pdf`, want: "binary", check: (p) => Buffer.from(p.base64, "base64").subarray(0, 5).toString() === "%PDF-" },
];

let fail = 0;
console.log(`root = ${root}\n`);
for (const c of cases) {
  let got, ok = false, note = "";
  try {
    got = readPreview(root, c.rel, io);
    ok = got.kind === c.want && c.check(got);
    note = got.kind === "text"
      ? `${got.size}B truncated=${got.truncated} head=${JSON.stringify(got.text.slice(0, 24))}`
      : got.kind === "binary"
        ? `${got.mimeType} ${got.size}B base64=${got.base64.length}ch magic=${Buffer.from(got.base64, "base64").subarray(0, 5).toString()}`
        : got.reason;
  } catch (e) { note = `THREW ${e.message}`; }
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.rel}  → ${got?.kind ?? "-"} (want ${c.want})\n      ${note}`);
}

// 越界与目录：安全边界也在真 fs 上验一次。
for (const [rel, wantMatch] of [["../secret.txt", /路径不合法/], [BK, /文件夹/]]) {
  let msg = "(no throw)";
  try { readPreview(root, rel, io); } catch (e) { msg = e.message; }
  const ok = wantMatch.test(msg);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  guard ${rel} → ${msg}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
