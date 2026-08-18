import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_REPOSITORY,
  EXPECTED_REVISION,
  EXPECTED_SKILLS,
  EXPECTED_VERSION,
  verifySuperpowersBundle,
} from "./verify-superpowers-bundle.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`Superpowers 离线包刷新失败：${message}`);
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument !== "--source" && argument !== "--revision" && argument !== "--bundle-parent") fail(`不支持的参数：${argument}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} 缺少值。`);
    options[argument === "--bundle-parent" ? "bundleParent" : argument.slice(2)] = value;
    index += 1;
  }
  if (!options.source || !options.revision) fail("必须提供 --source 和 --revision。");
  return options;
}

function git(source, args) {
  const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
  if (result.status !== 0) fail(`git ${args.join(" ")} 失败：${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout.trim();
}

function gitBlob(source, object) {
  const result = spawnSync("git", ["-C", source, "cat-file", "blob", object]);
  if (result.status !== 0) fail(`git cat-file blob ${object} 失败。`);
  return result.stdout;
}

function verifySource(source, revision) {
  if (revision !== EXPECTED_REVISION) fail(`revision 必须固定为 ${EXPECTED_REVISION}。`);
  if (!fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink() || !fs.lstatSync(source).isDirectory()) {
    fail("--source 必须是真实 Git checkout 目录。");
  }
  if (git(source, ["status", "--porcelain=v1"])) fail("上游 checkout 必须干净。");
  if (git(source, ["rev-parse", "HEAD"]) !== revision) fail("上游 HEAD 与 --revision 不匹配。");
  if (git(source, ["remote", "get-url", "origin"]) !== EXPECTED_REPOSITORY) fail("上游 origin 不匹配。");
  if (git(source, ["describe", "--tags", "--exact-match", "HEAD"]) !== `v${EXPECTED_VERSION}`) fail("上游 tag 与 v6.2.0 不匹配。");
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
  } catch {
    fail("上游 package.json 无法读取。");
  }
  if (packageJson.version !== EXPECTED_VERSION) fail("上游 package.json version 不匹配。");
  const license = fs.readFileSync(path.join(source, "LICENSE"));
  if (!license.toString("utf8").includes("MIT License")) fail("上游 LICENSE 不是 MIT。");
}

function sourceFiles(source) {
  const rows = git(source, ["ls-files", "-s", "--", "skills"]).split(/\r?\n/u).filter(Boolean);
  const files = rows.map((row) => {
    const match = /^(100644|100755) ([0-9a-f]{40}) 0\t(skills\/[^/]+\/.+)$/u.exec(row);
    if (!match) fail(`上游 tracked 文件无效：${row}`);
    const [, mode, object, relative] = match;
    const skill = relative.split("/")[1];
    if (!EXPECTED_SKILLS.includes(skill)) fail(`上游包含不在固定清单内的 Skill：${skill}`);
    const absolute = path.join(source, ...relative.split("/"));
    const info = fs.lstatSync(absolute);
    if (info.isSymbolicLink() || !info.isFile()) fail(`上游包含链接或非普通文件：${relative}`);
    return { relative, absolute, mode, object };
  }).sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const names = [...new Set(files.map((file) => file.relative.split("/")[1]))];
  if (names.length !== EXPECTED_SKILLS.length || names.some((name, index) => name !== EXPECTED_SKILLS[index])) {
    fail("上游 Skill 身份集合不完整或漂移。");
  }
  if (files.length !== 50) fail(`上游必须包含完整 50-file Skill 树，当前为 ${files.length}。`);
  return files;
}

function copyPayload(source, staging) {
  const files = sourceFiles(source);
  const manifestFiles = [];
  const license = gitBlob(source, "HEAD:LICENSE");
  const licenseTarget = path.join(staging, "LICENSE.upstream");
  fs.writeFileSync(licenseTarget, license);
  manifestFiles.push({
    path: "LICENSE.upstream",
    bytes: license.byteLength,
    sha256: createHash("sha256").update(license).digest("hex"),
    mode: "100644",
  });
  for (const file of files) {
    const target = path.join(staging, ...file.relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, gitBlob(source, file.object));
    fs.chmodSync(target, Number.parseInt(file.mode.slice(-3), 8));
    const data = fs.readFileSync(target);
    manifestFiles.push({ path: file.relative, bytes: data.byteLength, sha256: createHash("sha256").update(data).digest("hex"), mode: file.mode });
  }
  manifestFiles.sort((left, right) => left.path.localeCompare(right.path, "en"));
  fs.writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    repository: EXPECTED_REPOSITORY,
    revision: EXPECTED_REVISION,
    version: EXPECTED_VERSION,
    author: "Jesse Vincent",
    license: "MIT",
    licenseFile: "LICENSE.upstream",
    skills: EXPECTED_SKILLS,
    files: manifestFiles,
  }, null, 2)}\n`, "utf8");
}

function replaceRelease(staging, release, backup) {
  let backedUp = false;
  try {
    if (fs.existsSync(release)) {
      fs.renameSync(release, backup);
      backedUp = true;
    }
    fs.renameSync(staging, release);
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(release) && backedUp && fs.existsSync(backup)) fs.renameSync(backup, release);
    throw error;
  }
}

function sameVolume(left, right) {
  return path.parse(path.resolve(left)).root.toLocaleLowerCase() === path.parse(path.resolve(right)).root.toLocaleLowerCase();
}

function externalStagingRoot(bundleParent) {
  const temporary = os.tmpdir();
  return sameVolume(bundleParent, temporary) ? temporary : path.parse(bundleParent).root;
}

export function refreshSuperpowersBundle({ source, revision, bundleParent = path.join(REPO_ROOT, "bundled-skills", "superpowers") }) {
  const sourceRoot = path.resolve(source);
  verifySource(sourceRoot, revision);
  const releaseParent = path.resolve(bundleParent);
  const release = path.join(releaseParent, "release");
  const stagingRoot = externalStagingRoot(releaseParent);
  const staging = path.join(stagingRoot, `.leemo-superpowers-staging-${process.pid}-${randomUUID()}`);
  const backup = path.join(stagingRoot, `.leemo-superpowers-backup-${process.pid}-${randomUUID()}`);
  fs.mkdirSync(releaseParent, { recursive: true });
  let replaced = false;
  try {
    fs.mkdirSync(staging);
    copyPayload(sourceRoot, staging);
    verifySuperpowersBundle(staging);
    replaceRelease(staging, release, backup);
    replaced = true;
    return verifySuperpowersBundle(release);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (replaced && fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    console.log(JSON.stringify(refreshSuperpowersBundle(options), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
