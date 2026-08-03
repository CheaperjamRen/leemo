import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.resolve(
  process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1])
    ?? path.join(ROOT, "bundled-skills", "office", "release"),
);
const optional = process.argv.includes("--optional");
const names = ["docx", "pdf", "pptx", "xlsx"];
const forbiddenDirectories = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "node_modules",
]);

function fail(message) {
  throw new Error(`Office 技能包校验失败：${message}`);
}

function exactDirectoryNames(root, expected, label) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    fail(`${label} 必须且只能包含 ${expected.join("、")}，当前为 ${actual.join("、") || "空"}`);
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink() || !info.isDirectory()) fail(`${label}/${entry.name} 必须是真实目录`);
  }
}

function collectFiles(root) {
  const files = [];
  const walk = (directory, relativeRoot) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) fail(`不允许包含链接：${relative}`);
      if (info.isDirectory()) {
        const lower = entry.name.toLocaleLowerCase();
        if (forbiddenDirectories.has(lower) || lower.includes("staging")) {
          fail(`不允许包含缓存、依赖或 staging 目录：${relative}`);
        }
        walk(absolute, relative);
      } else if (info.isFile()) {
        if (entry.name.toLocaleLowerCase().endsWith(".pyc")) fail(`不允许包含 Python 缓存：${relative}`);
        files.push({ absolute, relative });
      } else {
        fail(`包含不支持的文件类型：${relative}`);
      }
    }
  };
  walk(root, "");
  return files.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
}

try {
  if (!fs.existsSync(bundleRoot)) {
    if (optional) {
      console.log(JSON.stringify({
        status: "not-included",
        bundleRoot,
        message: "未提供可选 Office 技能包；将构建 Leemo 基础文档能力。",
      }, null, 2));
      process.exit(0);
    }
    fail(`目录不存在：${bundleRoot}`);
  }
  if (fs.lstatSync(bundleRoot).isSymbolicLink()) fail("release 根目录不能是链接");
  exactDirectoryNames(bundleRoot, ["skills"], "release 目录");
  const skillRoot = path.join(bundleRoot, "skills");
  exactDirectoryNames(skillRoot, names, "skills 目录");

  for (const name of names) {
    const skillFile = path.join(skillRoot, name, "SKILL.md");
    if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile()) {
      fail(`${name} 缺少 SKILL.md`);
    }
  }

  const files = collectFiles(skillRoot);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const { absolute, relative } of files) {
    const data = fs.readFileSync(absolute);
    bytes += data.byteLength;
    hash.update(relative);
    hash.update("\0");
    hash.update(data);
    hash.update("\0");
  }

  console.log(JSON.stringify({
    bundleRoot,
    skillRoot,
    skills: names,
    files: files.length,
    bytes,
    sha256: hash.digest("hex"),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
