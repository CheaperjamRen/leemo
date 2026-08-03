import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { SkillPackageFile } from "./skill-security";
import { parseSkillFrontmatterFields } from "./skill-frontmatter";

export interface SkillPackageLimits {
  maxArchiveBytes: number;
  maxExpandedBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  maxDepth: number;
}

export interface SkillPackageCandidate {
  name: string;
  description: string;
  category?: string;
  categoryLabel?: string;
  root: string;
  files: SkillPackageFile[];
}

export interface LoadedSkillPackage {
  candidates: SkillPackageCandidate[];
}

const DEFAULT_LIMITS: SkillPackageLimits = {
  maxArchiveBytes: 10 * 1024 * 1024,
  maxExpandedBytes: 5 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 200,
  maxDepth: 12,
};

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);

function limitsWith(overrides: Partial<SkillPackageLimits> | undefined): SkillPackageLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

function safeRelativePath(input: string, limits: SkillPackageLimits): string {
  const path = input.replace(/\\/g, "/");
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (
    !path
    || path.startsWith("/")
    || /^[a-z]:/i.test(path)
    || path.includes("\0")
    || /[\u0000-\u001f]/u.test(path)
    || segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))
    || segments.length > limits.maxDepth
  ) {
    throw new Error(`Skill 包含不安全路径：${input}`);
  }
  if (segments.some((segment) => SKIPPED_DIRECTORIES.has(segment))) {
    throw new Error(`Skill 包含不应打包的目录：${input}`);
  }
  const normalized = segments.join("/");
  if (normalized.length > 240) throw new Error(`Skill 路径过长：${input}`);
  return normalized;
}

function optionalFrontmatterValue(value: string | undefined, maxLength: number): string | undefined {
  const clean = value?.trim();
  if (!clean || clean.length > maxLength || /[\u0000-\u001f]/u.test(clean)) return undefined;
  return clean;
}

function parseFrontmatter(raw: string): {
  name: string;
  description: string;
  category?: string;
  categoryLabel?: string;
} | undefined {
  const fields = parseSkillFrontmatterFields(raw);
  if (!fields) return undefined;
  const name = fields.name?.trim();
  const description = fields.description?.trim();
  if (!name || !description || name.includes(":") || name.length > 64) return undefined;
  const category = optionalFrontmatterValue(fields.category, 48);
  const categoryLabel = optionalFrontmatterValue(fields["category-label"] ?? fields.category_label, 32);
  return {
    name,
    description,
    ...(category ? { category } : {}),
    ...(categoryLabel ? { categoryLabel } : {}),
  };
}

function assembleCandidates(files: readonly SkillPackageFile[]): LoadedSkillPackage {
  const skillFiles = files
    .filter((file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"))
    .sort((left, right) => left.path.localeCompare(right.path));
  const roots = skillFiles.map((file) => file.path === "SKILL.md" ? "" : file.path.slice(0, -"/SKILL.md".length));
  const candidates: SkillPackageCandidate[] = [];

  for (let index = 0; index < skillFiles.length; index += 1) {
    const header = parseFrontmatter(skillFiles[index].contents.toString("utf8"));
    if (!header) continue;
    const root = roots[index];
    const prefix = root ? `${root}/` : "";
    const nestedRoots = roots.filter((candidateRoot) => candidateRoot !== root && candidateRoot.startsWith(prefix));
    const owned = files
      .filter((file) => {
        if (root && !file.path.startsWith(prefix)) return false;
        const relative = root ? file.path.slice(prefix.length) : file.path;
        return !nestedRoots.some((nestedRoot) => {
          const nestedRelative = root ? nestedRoot.slice(prefix.length) : nestedRoot;
          return relative === nestedRelative || relative.startsWith(`${nestedRelative}/`);
        });
      })
      .map((file) => ({
        path: root ? file.path.slice(prefix.length) : file.path,
        contents: Buffer.from(file.contents),
      }))
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    candidates.push({ ...header, root, files: owned });
  }

  if (candidates.length === 0) {
    throw new Error("没有找到符合 Agent Skills 规范的 SKILL.md。");
  }
  return { candidates };
}

export function loadSkillFiles(
  sourceFiles: readonly SkillPackageFile[],
  overrides?: Partial<SkillPackageLimits>,
): LoadedSkillPackage {
  const limits = limitsWith(overrides);
  if (sourceFiles.length > limits.maxFiles) throw new Error(`Skill 超过 ${limits.maxFiles} 个文件。`);
  const seen = new Set<string>();
  let totalBytes = 0;
  const files = sourceFiles.map((file) => {
    const path = safeRelativePath(file.path, limits);
    const collisionKey = path.toLocaleLowerCase();
    if (seen.has(collisionKey)) throw new Error(`Skill 包含重复路径：${file.path}`);
    seen.add(collisionKey);
    if (file.contents.byteLength > limits.maxFileBytes) throw new Error(`Skill 单个文件过大：${file.path}`);
    totalBytes += file.contents.byteLength;
    if (totalBytes > limits.maxExpandedBytes) throw new Error("Skill 内容超过允许大小。");
    return { path, contents: Buffer.from(file.contents) };
  });
  return assembleCandidates(files);
}

interface ZipEntry {
  path: string;
  expandedBytes: number;
  directory: boolean;
}

function zipEntries(archive: Buffer, limits: SkillPackageLimits): ZipEntry[] {
  if (archive.length > limits.maxArchiveBytes) throw new Error("Skill 压缩包超过下载大小限制。");
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = archive.lastIndexOf(eocdSignature);
  if (eocd < 0 || eocd + 22 > archive.length) throw new Error("Skill 压缩包结构不完整。");
  const count = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("暂不支持 ZIP64 Skill 压缩包。");
  }
  if (count > limits.maxFiles) throw new Error(`Skill 超过 ${limits.maxFiles} 个文件。`);
  if (centralOffset + centralSize > archive.length) throw new Error("Skill 压缩包目录越界。");

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let expanded = 0;
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Skill 压缩包目录损坏。");
    }
    const madeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const expandedBytes = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > archive.length) throw new Error("Skill 压缩包文件名越界。");
    if ((flags & 1) !== 0) throw new Error("不支持加密的 Skill 压缩包。");
    if (method !== 0 && method !== 8) throw new Error("Skill 压缩包使用了不支持的压缩方式。");

    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const directory = rawName.endsWith("/");
    const normalized = safeRelativePath(rawName.replace(/\/+$/u, ""), limits);
    const hostSystem = madeBy >>> 8;
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if ((hostSystem === 3 && unixType === 0xa000) || (externalAttributes & 0x400) !== 0) {
      throw new Error(`Skill 压缩包包含符号链接：${rawName}`);
    }
    const collisionKey = normalized.toLocaleLowerCase();
    if (seen.has(collisionKey)) throw new Error(`Skill 压缩包包含重复路径：${rawName}`);
    seen.add(collisionKey);
    if (!directory && expandedBytes > limits.maxFileBytes) throw new Error(`Skill 单个文件过大：${rawName}`);
    expanded += directory ? 0 : expandedBytes;
    if (expanded > limits.maxExpandedBytes) throw new Error("Skill 解压后超过允许大小。");
    entries.push({ path: normalized, expandedBytes, directory });
    offset = end;
  }
  return entries;
}

export function loadSkillArchive(
  archive: Buffer,
  overrides?: Partial<SkillPackageLimits>,
): LoadedSkillPackage {
  const limits = limitsWith(overrides);
  const entries = zipEntries(archive, limits);
  const unpacked = unzipSync(archive);
  const files: SkillPackageFile[] = [];
  for (const entry of entries) {
    if (entry.directory) continue;
    const raw = unpacked[entry.path] ?? unpacked[`${entry.path}/`];
    if (!raw || raw.byteLength !== entry.expandedBytes) {
      throw new Error(`Skill 解压结果与目录不一致：${entry.path}`);
    }
    files.push({ path: entry.path, contents: Buffer.from(raw) });
  }
  return loadSkillFiles(files, limits);
}

export function loadSkillDirectory(
  source: string,
  overrides?: Partial<SkillPackageLimits>,
): LoadedSkillPackage {
  const limits = limitsWith(overrides);
  const root = resolve(source);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error("Skill 来源不能是符号链接。");
  const base = rootStat.isFile() ? dirname(root) : root;
  if (rootStat.isFile() && basename(root).toLowerCase() !== "skill.md") {
    throw new Error("请选择 SKILL.md、Skill 文件夹或包含多个 Skills 的文件夹。");
  }

  const files: SkillPackageFile[] = [];
  let totalBytes = 0;
  const visit = (directory: string, relativeRoot: string, depth: number): void => {
    if (depth > limits.maxDepth) throw new Error("Skill 文件夹层级过深。");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolute = resolve(directory, entry.name);
      const relative = safeRelativePath(relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name, limits);
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Skill 文件夹包含符号链接：${relative}`);
      if (info.isDirectory()) {
        visit(absolute, relative, depth + 1);
        continue;
      }
      if (!info.isFile()) throw new Error(`Skill 文件夹包含不支持的文件类型：${relative}`);
      if (info.size > limits.maxFileBytes) throw new Error(`Skill 单个文件过大：${relative}`);
      files.push({ path: relative, contents: readFileSync(absolute) });
      totalBytes += statSync(absolute).size;
      if (files.length > limits.maxFiles) throw new Error(`Skill 超过 ${limits.maxFiles} 个文件。`);
      if (totalBytes > limits.maxExpandedBytes) throw new Error("Skill 文件夹超过允许大小。");
    }
  };
  visit(base, "", 0);
  return loadSkillFiles(files, limits);
}
