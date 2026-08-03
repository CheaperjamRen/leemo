// Real-filesystem smoke test for the Workspace Manager (轮 3 卡 G).
// Runs the same code main.ts wires up, against a THROWAWAY root under the OS
// temp dir — never the user's ~/Leemo. Verifies the parts the unit tests could
// only fake: that real mkdir/copy/rename/readdir actually behave as assumed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureWorkspace, listNotebooks, createNotebook, readTree,
  dropFiles, moveFile, readNotebookMemory, migrateLegacyInbox,
  DEFAULT_WORKSPACE_DIR, LEGACY_INBOX_DIR,
} from "../dist-smoke/workspace.mjs";

const io = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  mkdirp: (p) => fs.mkdirSync(p, { recursive: true }),
  readdir: (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
  stat: (p) => { const s = fs.statSync(p); return { mtimeMs: s.mtimeMs, size: s.size }; },
  readFile: (p) => fs.readFileSync(p, "utf8"),
  writeFile: (p, contents) => fs.writeFileSync(p, contents, "utf8"),
  readBinary: (p, maxBytes) => {
    const bytes = fs.readFileSync(p);
    return maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes);
  },
  copyFile: (a, b) => fs.copyFileSync(a, b),
  rename: (a, b) => fs.renameSync(a, b),
  removeEmptyDir: (dir) => fs.rmdirSync(dir),
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-smoke-"));
const ok = [];
const bad = [];
const check = (name, cond, detail = "") => (cond ? ok : bad).push(`${name}${detail ? " — " + detail : ""}`);

try {
  fs.mkdirSync(path.join(root, LEGACY_INBOX_DIR));
  fs.writeFileSync(path.join(root, LEGACY_INBOX_DIR, "旧文件.md"), "legacy-byte-proof", "utf8");
  const migration = migrateLegacyInbox(root, io);
  check("旧 Inbox 整目录迁移", migration.renamedLegacyRoot && !fs.existsSync(path.join(root, LEGACY_INBOX_DIR)));
  check(
    "迁移保留文件字节",
    fs.readFileSync(path.join(root, DEFAULT_WORKSPACE_DIR, "旧文件.md"), "utf8") === "legacy-byte-proof",
  );

  ensureWorkspace(root, io);
  check("默认工作区存在", fs.existsSync(path.join(root, DEFAULT_WORKSPACE_DIR)));

  const book = createNotebook(root, "高等数学", io);
  check("建本子=真建目录", fs.existsSync(path.join(root, "高等数学")), book.dir);

  const listed = listNotebooks(root, io);
  check("列本子只列目录", listed.length === 1 && listed[0].id === "高等数学",
    JSON.stringify(listed.map((b) => b.id)));

  // A dropped OS file.
  const src = path.join(root, "..", `smoke-讲义-${process.pid}.pdf`);
  fs.writeFileSync(src, "pdf");
  const placed = dropFiles(root, { sources: [src], notebookId: "高等数学" }, io);
  check("拖入落进本子", fs.existsSync(path.join(root, "高等数学", "smoke-讲义-" + process.pid + ".pdf")),
    placed[0].path);
  check("拖入=复制(原文件还在)", fs.existsSync(src));

  // Default-workspace fallback + move out of it.
  const src2 = path.join(root, "..", `smoke-散件-${process.pid}.jpg`);
  fs.writeFileSync(src2, "jpg");
  const inbox = dropFiles(root, { sources: [src2], notebookId: null }, io);
  check("无本子→落默认工作区", inbox[0].path.startsWith(DEFAULT_WORKSPACE_DIR + "/"), inbox[0].path);

  const moved = moveFile(root, { path: inbox[0].path, notebookId: "高等数学" }, io);
  check("移入本子=真移动", fs.existsSync(path.join(root, moved.path.replace("/", path.sep)))
    && !fs.existsSync(path.join(root, DEFAULT_WORKSPACE_DIR, inbox[0].name)), moved.path);

  // Notebook-level CLAUDE.md → prompt layer ⑨ input.
  fs.writeFileSync(path.join(root, "高等数学", "CLAUDE.md"), "本子约定：公式写 LaTeX。");
  const mem = readNotebookMemory(root, "高等数学", io);
  check("本子级 CLAUDE.md 读到", mem?.text === "本子约定：公式写 LaTeX。");

  const tree = readTree(root, io);
  const bookNode = tree.find((n) => n.name === "高等数学");
  check("文件树首段=本子 id", bookNode?.path === "高等数学" && bookNode.bookId === "高等数学");
  check("树里能看到落进去的文件", (bookNode?.children ?? []).some((c) => c.name.startsWith("smoke-讲义")));
  check(".leemo/.claude/memory 不进树", !tree.some((n) => n.name === ".leemo" || n.name === ".claude" || n.name === "memory"));

  // Escape attempts must fail closed.
  let refused = 0;
  for (const bad of ["../evil", "a/b", "..", "C:\\tmp"]) {
    try { createNotebook(root, bad, io); } catch { refused++; }
  }
  check("越界本子名全部拒绝", refused === 4, `${refused}/4`);

  let moveRefused = 0;
  for (const p of ["../secrets.txt", "/etc/passwd", "..\\..\\x"]) {
    try { moveFile(root, { path: p, notebookId: "高等数学" }, io); } catch { moveRefused++; }
  }
  check("越界路径全部拒绝", moveRefused === 3, `${moveRefused}/3`);

  fs.rmSync(src, { force: true });
  fs.rmSync(src2, { force: true });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS:");
for (const o of ok) console.log("  ✓ " + o);
if (bad.length) {
  console.log("FAIL:");
  for (const b of bad) console.log("  ✗ " + b);
}
console.log(`\n${ok.length}/${ok.length + bad.length} 通过 (临时根已删除，未碰用户 ~/Leemo)`);
process.exit(bad.length ? 1 : 0);
