import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXPECTED_REPOSITORY = "https://github.com/obra/superpowers.git";
export const EXPECTED_REVISION = "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9";
export const EXPECTED_VERSION = "6.2.0";
export const EXPECTED_LICENSE_SHA256 = "a37e0e9697144819e1d965176ac4ae5bc3fa02d11e7812036bbcadf6dafe2400";
export const EXPECTED_SKILLS = [
  "brainstorming", "dispatching-parallel-agents", "executing-plans",
  "finishing-a-development-branch", "receiving-code-review",
  "requesting-code-review", "subagent-driven-development",
  "systematic-debugging", "test-driven-development", "using-git-worktrees",
  "using-superpowers", "verification-before-completion", "writing-plans",
  "writing-skills",
];
const EXECUTABLE_FILES = new Set([
  "skills/brainstorming/scripts/start-server.sh",
  "skills/brainstorming/scripts/stop-server.sh",
  "skills/subagent-driven-development/scripts/review-package",
  "skills/subagent-driven-development/scripts/sdd-workspace",
  "skills/subagent-driven-development/scripts/task-brief",
  "skills/systematic-debugging/find-polluter.sh",
  "skills/writing-skills/render-graphs.js",
]);
const FORBIDDEN_DIRECTORIES = new Set([
  ".cache", ".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", "__pycache__", "node_modules",
]);

function fail(message) {
  throw new Error(`Superpowers 离线包校验失败：${message}`);
}

function sameNames(actual, expected) {
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function readRealDirectory(directory, label) {
  if (!fs.existsSync(directory)) fail(`${label} 不存在。`);
  const info = fs.lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) fail(`${label} 必须是真实目录。`);
  return fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function collectPayloadFiles(root) {
  const files = [];
  const license = path.join(root, "LICENSE.upstream");
  const licenseInfo = fs.lstatSync(license);
  if (licenseInfo.isSymbolicLink() || !licenseInfo.isFile()) fail("LICENSE.upstream 必须是真实文件。");
  files.push({ absolute: license, path: "LICENSE.upstream", bytes: licenseInfo.size });

  const visit = (directory, relative) => {
    for (const entry of readRealDirectory(directory, relative || "skills")) {
      const absolute = path.join(directory, entry.name);
      const next = `${relative}/${entry.name}`;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) fail(`不允许符号链接：${next}`);
      if (entry.isDirectory()) {
        if (FORBIDDEN_DIRECTORIES.has(entry.name.toLocaleLowerCase()) || entry.name.toLocaleLowerCase().includes("staging")) {
          fail(`不允许缓存、依赖或 staging 目录：${next}`);
        }
        visit(absolute, next);
      } else if (entry.isFile()) {
        if (entry.name.toLocaleLowerCase().endsWith(".pyc")) fail(`不允许 Python 缓存：${next}`);
        files.push({ absolute, path: next, bytes: info.size });
      } else {
        fail(`不支持的文件类型：${next}`);
      }
    }
  };
  visit(path.join(root, "skills"), "skills");
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function readManifest(root) {
  const file = path.join(root, "manifest.json");
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) fail("manifest.json 必须是真实文件。");
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("manifest.json 根节点必须是对象。");
    return manifest;
  } catch (error) {
    fail(`manifest.json 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

function verifyManifestIdentity(manifest) {
  const expected = {
    schemaVersion: 1,
    repository: EXPECTED_REPOSITORY,
    revision: EXPECTED_REVISION,
    version: EXPECTED_VERSION,
    author: "Jesse Vincent",
    license: "MIT",
    licenseFile: "LICENSE.upstream",
  };
  for (const [field, value] of Object.entries(expected)) {
    if (manifest[field] !== value) fail(`manifest ${field} 漂移。`);
  }
  if (!Array.isArray(manifest.skills) || !sameNames(manifest.skills, EXPECTED_SKILLS)) {
    fail("manifest skills 必须是固定的 14 项身份集合且按字母序排列。");
  }
  if (!Array.isArray(manifest.files)) fail("manifest files 必须是数组。");
}

function verifyFiles(manifest, actualFiles) {
  const actualPaths = actualFiles.map((file) => file.path);
  const manifestPaths = manifest.files.map((file) => file?.path);
  if (!sameNames(manifestPaths, [...manifestPaths].sort((left, right) => String(left).localeCompare(String(right), "en")))) {
    fail("manifest files 必须按 path 排序。");
  }
  if (!sameNames(manifestPaths, actualPaths)) fail("manifest 文件清单与 release payload 不一致。");

  for (let index = 0; index < actualFiles.length; index += 1) {
    const actual = actualFiles[index];
    const entry = manifest.files[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`manifest 缺少 ${actual.path} 的条目。`);
    const data = fs.readFileSync(actual.absolute);
    const expectedMode = EXECUTABLE_FILES.has(actual.path) ? "100755" : "100644";
    if (entry.bytes !== actual.bytes) fail(`${actual.path} 的 bytes 漂移。`);
    if (entry.sha256 !== createHash("sha256").update(data).digest("hex")) fail(`${actual.path} 的 sha256 漂移。`);
    if (entry.mode !== expectedMode) fail(`${actual.path} 的 mode 必须是 ${expectedMode}。`);
    if (Object.keys(entry).sort().join(",") !== "bytes,mode,path,sha256") fail(`${actual.path} 的 manifest 条目字段无效。`);
  }
}

export function verifySuperpowersBundle(bundleRoot = path.join(REPO_ROOT, "bundled-skills", "superpowers", "release")) {
  const root = path.resolve(bundleRoot);
  const entries = readRealDirectory(root, "release 根目录").map((entry) => entry.name);
  if (!sameNames(entries, ["LICENSE.upstream", "manifest.json", "skills"])) {
    fail(`release 根目录必须且只能包含 LICENSE.upstream、manifest.json、skills；当前为 ${entries.join("、") || "空"}。`);
  }

  const skillEntries = readRealDirectory(path.join(root, "skills"), "skills 目录");
  const skillNames = skillEntries.map((entry) => entry.name);
  if (!sameNames(skillNames, EXPECTED_SKILLS)) {
    fail(`skills 目录必须且只能包含固定 14 项；当前为 ${skillNames.join("、") || "空"}。`);
  }
  for (const entry of skillEntries) {
    const skillRoot = path.join(root, "skills", entry.name);
    if (!entry.isDirectory() || fs.lstatSync(skillRoot).isSymbolicLink()) fail(`Skill 必须是真实目录：${entry.name}`);
    const skillFile = path.join(skillRoot, "SKILL.md");
    if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile() || fs.lstatSync(skillFile).isSymbolicLink()) {
      fail(`${entry.name} 缺少真实 SKILL.md。`);
    }
  }

  const manifest = readManifest(root);
  verifyManifestIdentity(manifest);
  const license = fs.readFileSync(path.join(root, "LICENSE.upstream"));
  if (createHash("sha256").update(license).digest("hex") !== EXPECTED_LICENSE_SHA256) {
    fail("LICENSE.upstream 不是固定上游 MIT LICENSE。");
  }
  const files = collectPayloadFiles(root);
  verifyFiles(manifest, files);

  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const data = fs.readFileSync(file.absolute);
    bytes += data.byteLength;
    hash.update(file.path);
    hash.update("\0");
    hash.update(data);
    hash.update("\0");
  }
  return {
    bundleRoot: root,
    repository: manifest.repository,
    revision: manifest.revision,
    version: manifest.version,
    skillCount: skillNames.length,
    skills: skillNames,
    files: files.length,
    bytes,
    sha256: hash.digest("hex"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(verifySuperpowersBundle(process.argv[2]), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
