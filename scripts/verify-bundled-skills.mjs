import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleRoot = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, "bundled-skills"));
const GROUPS = [
  { directory: "default-enabled", reportKey: "defaultEnabled" },
  { directory: "optional", reportKey: "optional" },
];
const FORBIDDEN_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function parseFrontmatter(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") fail(`${file} 缺少有效的 SKILL.md frontmatter。`);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) fail(`${file} 的 SKILL.md frontmatter 未闭合。`);
  const fields = {};
  const frontmatter = lines.slice(1, end);
  for (let index = 0; index < frontmatter.length; index += 1) {
    const line = frontmatter[index];
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    const block = /^([|>])[-+]?$/u.exec(value);
    if (block) {
      const parts = [];
      let indent;
      while (index + 1 < frontmatter.length) {
        const next = frontmatter[index + 1];
        if (!next.trim()) {
          parts.push("");
          index += 1;
          continue;
        }
        const nextIndent = /^\s*/u.exec(next)?.[0].length ?? 0;
        if (nextIndent === 0) break;
        indent ??= nextIndent;
        parts.push(next.slice(Math.min(indent, nextIndent)));
        index += 1;
      }
      value = block[1] === "|" ? parts.join("\n").trim() : parts.join(" ").replace(/\s+/gu, " ").trim();
    }
    const quoted = /^(['"])(.*)\1$/u.exec(value);
    fields[key] = quoted ? quoted[2] : value;
  }
  const name = typeof fields.name === "string" ? fields.name.trim() : "";
  const description = typeof fields.description === "string" ? fields.description.trim() : "";
  if (!name || name.length > 64 || name.includes(":")) fail(`${file} 的 Skill name 无效。`);
  if (!description || description.length > 2_000) fail(`${file} 的 Skill description 无效。`);
  return { name, description };
}

function readCatalog() {
  const file = path.join(bundleRoot, "catalog.json");
  if (!fs.existsSync(file)) return { file: undefined, skills: {} };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("bundled-skills/catalog.json 不是有效 JSON。");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("catalog.json 根节点必须是对象。");
  if (!parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
    fail("catalog.json 的 skills 必须是对象。");
  }
  return { file, skills: parsed.skills };
}

function collectSkillFiles(skillRoot, skillDirectory) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(bundleRoot, absolute).replaceAll(path.sep, "/");
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) fail(`${skillDirectory} 包含符号链接：${relative}`);
      if (entry.isDirectory()) {
        if (FORBIDDEN_DIRECTORIES.has(entry.name)) fail(`${skillDirectory} 包含禁止目录：${entry.name}`);
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) fail(`${skillDirectory} 包含不支持的文件类型：${relative}`);
      if (entry.name.toLocaleLowerCase().endsWith(".pyc")) fail(`${skillDirectory} 包含 Python 缓存：${relative}`);
      if (info.size > MAX_FILE_BYTES) fail(`${skillDirectory} 包含超过 10 MiB 的单文件：${relative}`);
      files.push({ absolute, relative, bytes: info.size });
    }
  };
  visit(skillRoot);
  return files;
}

function verify() {
  if (!fs.existsSync(bundleRoot) || !fs.statSync(bundleRoot).isDirectory()) {
    fail(`内置技能库不存在：${bundleRoot}`);
  }
  const catalog = readCatalog();
  const directoryKeys = new Set();
  const triggerKeys = new Set();
  const displayNames = new Set();
  const skills = [];
  const files = [];
  const groups = { defaultEnabled: 0, optional: 0 };

  for (const group of GROUPS) {
    const groupRoot = path.join(bundleRoot, group.directory);
    if (!fs.existsSync(groupRoot) || !fs.statSync(groupRoot).isDirectory()) {
      fail(`bundled-skills/${group.directory} 不存在。`);
    }
    const entries = fs.readdirSync(groupRoot, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (!entry.isDirectory()) fail(`${group.directory} 只能放 Skill 文件夹：${entry.name}`);
      if (FORBIDDEN_DIRECTORIES.has(entry.name)) fail(`${group.directory} 包含禁止目录：${entry.name}`);
      const directoryKey = entry.name.toLocaleLowerCase();
      if (directoryKeys.has(directoryKey)) fail(`内置 Skill 目录名重复：${entry.name}`);
      directoryKeys.add(directoryKey);
      const skillRoot = path.join(groupRoot, entry.name);
      const skillFile = path.join(skillRoot, "SKILL.md");
      if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) fail(`${group.directory}/${entry.name} 缺少 SKILL.md。`);
      const header = parseFrontmatter(skillFile);
      const triggerKey = header.name.toLocaleLowerCase();
      if (triggerKeys.has(triggerKey)) fail(`内置 Skill 触发名重复：${header.name}`);
      triggerKeys.add(triggerKey);

      const metadata = catalog.skills[entry.name];
      if (metadata !== undefined && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
        fail(`catalog.json 中 ${entry.name} 的配置必须是对象。`);
      }
      if (metadata?.displayName !== undefined && typeof metadata.displayName !== "string") {
        fail(`catalog.json 中 ${entry.name} 的 displayName 必须是字符串。`);
      }
      const displayName = typeof metadata?.displayName === "string"
        ? metadata.displayName.trim()
        : header.name;
      if (!displayName || displayName.length > 64 || displayName.includes(":") || /[\u0000-\u001f]/u.test(displayName)) {
        fail(`${entry.name} 的展示名称无效。`);
      }
      const displayKey = displayName.toLocaleLowerCase();
      if (displayNames.has(displayKey)) fail(`内置 Skill 展示名称重复：${displayName}`);
      displayNames.add(displayKey);
      if (metadata?.description !== undefined) {
        if (
          typeof metadata.description !== "string"
          || !metadata.description.trim()
          || metadata.description.trim().length > 240
          || /[\u0000-\u0009\u000b-\u001f]/u.test(metadata.description)
        ) {
          fail(`catalog.json 中 ${entry.name} 的 description 无效。`);
        }
      }
      skills.push(entry.name);
      groups[group.reportKey] += 1;
      files.push(...collectSkillFiles(skillRoot, entry.name));
    }
  }

  for (const directory of Object.keys(catalog.skills)) {
    if (!directoryKeys.has(directory.toLocaleLowerCase())) fail(`catalog.json 引用了不存在的目录：${directory}`);
  }
  if (catalog.file) {
    const info = fs.statSync(catalog.file);
    files.push({
      absolute: catalog.file,
      relative: "catalog.json",
      bytes: info.size,
    });
  }

  files.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const data = fs.readFileSync(file.absolute);
    bytes += file.bytes;
    hash.update(file.relative);
    hash.update("\0");
    hash.update(data);
    hash.update("\0");
  }
  return {
    bundleRoot,
    groups,
    skillCount: skills.length,
    skills: skills.sort((left, right) => left.localeCompare(right, "en")),
    files: files.length,
    bytes,
    sha256: hash.digest("hex"),
  };
}

try {
  console.log(JSON.stringify(verify(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
