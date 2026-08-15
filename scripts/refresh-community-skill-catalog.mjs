import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { scanSkillPackage } from "../src/host/skill-security.ts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_APPROVED_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_APPROVED_ARCHIVE_ENTRIES = 4_096;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedCatalogPath = path.join(root, "src", "host", "community-skill-catalog.generated.ts");

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} 必须是非空字符串`);
  return value;
}

function assertRelativeRepositoryPath(value, field, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) fail(`${field} 必须是${allowEmpty ? "字符串" : "非空字符串"}`);
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..")) {
    fail(`${field} 包含不安全路径`);
  }
  return value;
}

function normalizedRepositoryPath(value) {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "");
}

function isStrictDescendant(parent, child) {
  const normalizedParent = normalizedRepositoryPath(parent);
  const normalizedChild = normalizedRepositoryPath(child);
  return normalizedChild.length > 0
    && (normalizedParent.length === 0 || normalizedChild.startsWith(`${normalizedParent}/`));
}

function pathsOverlap(left, right) {
  const normalizedLeft = normalizedRepositoryPath(left).toLocaleLowerCase();
  const normalizedRight = normalizedRepositoryPath(right).toLocaleLowerCase();
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}

/** Validates the review trail that accounts for each competitor candidate. */
export function validateCandidates(candidates) {
  if (!Array.isArray(candidates)) fail("候选列表必须是数组");
  const seen = new Set();
  for (const candidate of candidates) {
    if (!isRecord(candidate)) fail("候选记录必须是对象");
    if (!["colaos", "newmax", "workbuddy"].includes(candidate.competitor)) fail("候选 competitor 无效");
    requiredString(candidate.externalId, "externalId");
    requiredString(candidate.name, "name");
    requiredString(candidate.reason, "reason");
    if (!["included", "duplicate", "not-a-skill", "private", "license-unknown", "origin-unresolved", "runtime-blocked"].includes(candidate.resolution)) {
      fail("候选 resolution 无效");
    }
    if (candidate.resolution === "included" && (typeof candidate.catalogId !== "string" || candidate.catalogId.trim().length === 0)) {
      fail("included 候选必须提供 catalogId");
    }
    if (candidate.resolution === "runtime-blocked") {
      if (candidate.catalogId !== undefined) fail("runtime-blocked 候选不能提供 catalogId");
      if (candidate.installability !== undefined && candidate.installability !== "blocked-family-bundle") {
        fail("runtime-blocked 候选的 installability 必须是 blocked-family-bundle");
      }
    }
    const key = `${candidate.competitor}:${candidate.externalId}`;
    if (seen.has(key)) fail(`候选记录重复：${key}`);
    seen.add(key);
  }
  return candidates;
}

/** Validates the pinned upstream repositories before any network request is made. */
export function validateSources(sources) {
  if (!Array.isArray(sources)) fail("来源列表必须是数组");
  const repositories = new Set();
  const entryPaths = new Set();
  const ids = new Set();
  const displayNames = new Set();
  const registerDisplayName = (value, field) => {
    const displayName = requiredString(value, field).trim();
    const key = displayName.toLocaleLowerCase();
    if (displayNames.has(key)) fail(`展示名称重复：${displayName}`);
    displayNames.add(key);
  };
  for (const source of sources) {
    if (!isRecord(source)) fail("来源记录必须是对象");
    const repository = requiredString(source.repository, "repository");
    if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) fail("repository 必须是 owner/repository");
    const revision = requiredString(source.revision, "revision");
    if (!/^[a-f0-9]{40}$/iu.test(revision)) fail("revision 必须是固定 commit SHA");
    requiredString(source.license, "license");
    assertRelativeRepositoryPath(source.licensePath, "licensePath");
    if (source.setupMessage !== undefined) {
      const setupMessage = requiredString(source.setupMessage, "source.setupMessage");
      if (setupMessage.length > 500 || /[\u0000-\u001f]/u.test(setupMessage)) fail("source.setupMessage 无效");
    }
    if (repositories.has(repository)) fail(`来源仓库重复：${repository}`);
    repositories.add(repository);
    if (!Array.isArray(source.entries)) fail("entries 必须是数组");
    for (const entry of source.entries) {
      if (!isRecord(entry)) fail("Skill 条目必须是对象");
      for (const field of ["id", "name", "description", "category", "categoryLabel", "author"]) requiredString(entry[field], field);
      if (entry.setupMessage !== undefined) {
        const setupMessage = requiredString(entry.setupMessage, "setupMessage");
        if (setupMessage.length > 500 || /[\u0000-\u001f]/u.test(setupMessage)) fail("setupMessage 无效");
      }
      registerDisplayName(entry.displayName, "displayName");
      assertRelativeRepositoryPath(entry.upstreamPath, "upstreamPath", true);
      if (entry.kind !== undefined && !["skill", "family"].includes(entry.kind)) fail("kind 必须是 skill 或 family");
      if (typeof entry.featured !== "boolean") fail("featured 必须是布尔值");
      if (entry.kind === "family") {
        if (!Array.isArray(entry.members) || entry.members.length === 0) fail(`family 必须声明 members：${entry.id}`);
        if (!Array.isArray(entry.sharedPaths)) fail(`family 必须声明 sharedPaths：${entry.id}`);
        const memberIds = new Set();
        const memberPaths = new Set();
        for (const member of entry.members) {
          if (!isRecord(member)) fail(`family 成员必须是对象：${entry.id}`);
          for (const field of ["id", "name", "description"]) requiredString(member[field], `member.${field}`);
          registerDisplayName(member.displayName, "member.displayName");
          if (member.category !== undefined) requiredString(member.category, "member.category");
          if (member.categoryLabel !== undefined) requiredString(member.categoryLabel, "member.categoryLabel");
          assertRelativeRepositoryPath(member.upstreamPath, "member.upstreamPath");
          if (!isStrictDescendant(entry.upstreamPath, member.upstreamPath)) {
            fail(`family 成员路径越界：${member.upstreamPath} (${entry.id})`);
          }
          const memberId = member.id.toLocaleLowerCase();
          const memberPath = normalizedRepositoryPath(member.upstreamPath).toLocaleLowerCase();
          if (memberIds.has(memberId) || memberPaths.has(memberPath)) fail(`family 成员重复：${member.id} (${entry.id})`);
          memberIds.add(memberId);
          memberPaths.add(memberPath);
        }
        const sharedPaths = new Set();
        for (const sharedPath of entry.sharedPaths) {
          assertRelativeRepositoryPath(sharedPath, "sharedPaths");
          if (!isStrictDescendant(entry.upstreamPath, sharedPath)) fail(`family 共享路径越界：${sharedPath} (${entry.id})`);
          const normalizedSharedPath = normalizedRepositoryPath(sharedPath).toLocaleLowerCase();
          if (sharedPaths.has(normalizedSharedPath)) fail(`family 共享路径重复：${sharedPath} (${entry.id})`);
          if (entry.members.some((member) => pathsOverlap(member.upstreamPath, sharedPath))) {
            fail(`family 共享路径与成员路径重叠：${sharedPath} (${entry.id})`);
          }
          sharedPaths.add(normalizedSharedPath);
        }
      } else if (entry.members !== undefined || entry.sharedPaths !== undefined) {
        fail(`普通 Skill 不能声明 family 字段：${entry.id}`);
      }
      const entryPath = `${repository}:${entry.upstreamPath}`;
      if (entryPaths.has(entryPath)) fail(`来源路径重复：${entryPath}`);
      if (ids.has(entry.id)) fail(`catalogId 重复：${entry.id}`);
      entryPaths.add(entryPath);
      ids.add(entry.id);
    }
  }
  return sources;
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  fail("ZIP 缺少有效的中央目录结束记录");
}

function readCentralDirectoryEntries(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  if (view.byteLength < 22) fail("ZIP 归档损坏");
  const endOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) fail("不支持分卷 ZIP");
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) fail("不支持 ZIP64 归档");
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryOffset > endOffset || centralDirectoryEnd !== endOffset) fail("ZIP 中央目录边界损坏");

  const entries = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== 0x02014b50) fail("ZIP 中央目录记录损坏");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > centralDirectoryEnd) fail("ZIP 中央目录记录越界");
    const mode = view.getUint32(offset + 38, true) >>> 16;
    const rawName = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({
      rawName,
      mode,
      uncompressedSize: view.getUint32(offset + 24, true),
    });
    offset = end;
  }
  if (offset !== centralDirectoryEnd) fail("ZIP 中央目录条目数量不匹配");
  if (entries.length === 0) fail("ZIP 缺少文件记录");
  return entries;
}

function assertSafeArchivePath(name, mode) {
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) fail(`不安全路径：${name}`);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((part) => part === "." || part === "..")) fail(`不安全路径：${name}`);
  if (segments.some((part) => ["node_modules", "cache", ".cache", "__pycache__"].includes(part.toLowerCase()))) {
    fail(`不允许缓存或依赖路径：${name}`);
  }
  if ((mode & 0o170000) === 0o120000) fail(`不允许符号链接：${name}`);
  return normalized;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Builds a portable manifest for one approved repository archive. The archive
 * is passed in so callers can test and reproduce the result without network IO.
 */
export function buildManifestFromArchive(archive, source) {
  validateSources([source]);
  if (!(archive instanceof Uint8Array)) fail("ZIP 归档必须是 Uint8Array");
  const rawEntries = readCentralDirectoryEntries(archive);
  const namedEntries = rawEntries.map((entry) => ({ ...entry, name: entry.rawName.replaceAll("\\", "/") }));
  const licenseSuffix = `/${source.licensePath.replaceAll("\\", "/")}`;
  const licenseEntry = namedEntries.find(({ name }) => {
    if (!name.endsWith(licenseSuffix)) return false;
    const candidateRoot = name.slice(0, -licenseSuffix.length);
    return Boolean(candidateRoot) && !candidateRoot.includes("/");
  });
  const licenseName = licenseEntry?.name;
  if (!licenseName) fail(`找不到许可证：${source.licensePath}`);
  const archiveRoot = licenseName.slice(0, -licenseSuffix.length);
  const approvedPaths = source.entries.flatMap((entry) => entry.kind === "family"
    ? [...entry.sharedPaths, ...entry.members.map((member) => member.upstreamPath)]
    : [entry.upstreamPath]);
  const matchesApprovedPath = (name, approvedPath) => {
    const selected = approvedPath ? `${archiveRoot}/${approvedPath}` : archiveRoot;
    return name === selected || name.startsWith(`${selected}/`);
  };
  const safeEntries = namedEntries
    .filter(({ name }) => name === licenseName || approvedPaths.some((approvedPath) => matchesApprovedPath(name, approvedPath)))
    .map(({ rawName, name, mode, uncompressedSize }) => {
      const safeName = assertSafeArchivePath(rawName, mode);
      if (uncompressedSize > MAX_FILE_BYTES) fail(`文件超过 10 MiB：${safeName}`);
      return { rawName, name: safeName, uncompressedSize };
    });
  const nonEmptyDirectory = safeEntries.find(({ name, uncompressedSize }) => name.endsWith("/") && uncompressedSize !== 0);
  if (nonEmptyDirectory) {
    fail(`目录记录包含非零载荷：${nonEmptyDirectory.name}`);
  }
  if (safeEntries.length > MAX_APPROVED_ARCHIVE_ENTRIES) {
    fail(`批准 ZIP 条目数量超过 ${MAX_APPROVED_ARCHIVE_ENTRIES}：${safeEntries.length}`);
  }
  const totalUncompressedBytes = safeEntries.reduce((total, entry) => total + entry.uncompressedSize, 0);
  if (totalUncompressedBytes > MAX_APPROVED_ARCHIVE_BYTES) {
    fail(`批准文件总解压大小超过 16 MiB：${totalUncompressedBytes} bytes`);
  }
  const extractedNames = new Set(safeEntries
    .map(({ rawName }) => rawName));
  const files = unzipSync(archive, { filter: ({ name }) => extractedNames.has(name) });
  const licenseContents = files[licenseEntry.rawName];
  if (!licenseContents) fail(`找不到许可证：${source.licensePath}`);

  const entries = source.entries.map((entry) => {
    const family = entry.kind === "family";
    const selectedPaths = family
      ? [...entry.sharedPaths, ...entry.members.map((member) => member.upstreamPath)]
      : [entry.upstreamPath];
    const prefix = entry.upstreamPath ? `${archiveRoot}/${entry.upstreamPath}/` : `${archiveRoot}/`;
    if (family) {
      for (const member of entry.members) {
        const skillPath = `${archiveRoot}/${member.upstreamPath}/SKILL.md`;
        if (!safeEntries.some(({ name }) => name === skillPath)) {
          fail(`family 成员缺少 SKILL.md：${member.id} (${entry.id})`);
        }
      }
    }
    const selectedFiles = safeEntries
      .filter(({ name }) => (
        name !== licenseName
        && !name.endsWith("/")
        && selectedPaths.some((selectedPath) => matchesApprovedPath(name, selectedPath))
      ))
      .map(({ rawName, name }) => {
        const contents = files[rawName];
        if (!contents) fail(`无法读取归档文件：${name}`);
        const relativePath = name.slice(prefix.length);
        if (relativePath.toLowerCase() === "license.upstream") fail(`保留目标冲突：LICENSE.upstream (${entry.id})`);
        return {
          path: relativePath,
          sourcePath: name.slice(`${archiveRoot}/`.length),
          contents: Buffer.from(contents),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    if (!family && !selectedFiles.some((file) => file.path === "SKILL.md")) fail(`Skill 缺少 SKILL.md：${entry.id}`);
    const scan = scanSkillPackage([
      ...selectedFiles.map(({ path, contents }) => ({ path, contents })),
      { path: "LICENSE.upstream", contents: Buffer.from(licenseContents) },
    ]);
    if (scan.status !== "scanned") {
      const rules = [...new Set(scan.findings.map((finding) => finding.rule))].join(", ");
      fail(`社区 Skill 安全预审未通过：${entry.id}${rules ? ` (${rules})` : ""}`);
    }
    const manifestFiles = selectedFiles.map(({ path: filePath, sourcePath, contents }) => ({
      path: filePath,
      ...(entry.upstreamPath ? {} : { sourcePath }),
      bytes: contents.byteLength,
      sha256: sha256(contents),
    }));
    const finalFiles = [...manifestFiles, {
      path: "LICENSE.upstream",
      sourcePath: source.licensePath,
      bytes: licenseContents.byteLength,
      sha256: sha256(licenseContents),
    }].sort((left, right) => left.path.localeCompare(right.path));
    const uniquePaths = new Set();
    for (const file of finalFiles) {
      const key = file.path.toLowerCase();
      if (uniquePaths.has(key)) fail(`Skill 文件路径重复：${file.path} (${entry.id})`);
      uniquePaths.add(key);
    }
    const { members, sharedPaths, ...catalogEntry } = entry;
    const setupMessage = entry.setupMessage ?? source.setupMessage;
    return {
      ...catalogEntry,
      ...(setupMessage ? { setupMessage } : {}),
      ...(family ? {
        kind: "family",
        memberCount: members.length,
        members: members.map(({ id, name, displayName, description, upstreamPath, category, categoryLabel }) => ({
          id,
          name,
          displayName,
          description,
          upstreamPath,
          ...(category === undefined ? {} : { category }),
          ...(categoryLabel === undefined ? {} : { categoryLabel }),
        })),
      } : {}),
      repository: source.repository,
      revision: source.revision,
      license: source.license,
      licenseUrl: `https://github.com/${source.repository}/blob/${source.revision}/${source.licensePath}`,
      sourceUrl: `https://github.com/${source.repository}/tree/${source.revision}${entry.upstreamPath ? `/${entry.upstreamPath}` : ""}`,
      files: finalFiles,
    };
  });
  return { entries: entries.sort((left, right) => left.id.localeCompare(right.id)) };
}

/** Serializes a stable TypeScript catalog that can be checked into the app. */
export function serializeGeneratedCatalog(entries) {
  const sorted = [...entries]
    .map((entry) => ({ ...entry, files: [...entry.files].sort((left, right) => left.path.localeCompare(right.path)) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return [
    'import type { CommunitySkillCatalogEntry } from "./community-skill-catalog";',
    "",
    "/** Generated by npm run refresh:community-skills -- --write. Do not edit manually. */",
    `export const COMMUNITY_SKILL_CATALOG: readonly CommunitySkillCatalogEntry[] = ${JSON.stringify(sorted, null, 2)} as const;`,
    "",
  ].join("\n");
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

async function refresh(mode) {
  const candidates = validateCandidates(readJson("community-skills/candidates.json"));
  const sources = validateSources(readJson("community-skills/sources.json"));
  const approvedIds = new Set(sources.flatMap((source) => source.entries.map((entry) => entry.id)));
  for (const candidate of candidates) {
    if (candidate.resolution === "included" && !approvedIds.has(candidate.catalogId)) {
      fail(`included 候选未在 sources.json 中批准：${candidate.catalogId}`);
    }
  }
  const entries = [];
  for (const source of [...sources].sort((left, right) => left.repository.localeCompare(right.repository))) {
    const zipUrl = `https://codeload.github.com/${source.repository}/zip/${source.revision}`;
    const response = await fetch(zipUrl);
    if (!response.ok) fail(`下载归档失败 (${response.status})：${source.repository}`);
    entries.push(...buildManifestFromArchive(new Uint8Array(await response.arrayBuffer()), source).entries);
  }
  const serialized = serializeGeneratedCatalog(entries);
  if (mode === "--write") {
    fs.writeFileSync(generatedCatalogPath, serialized, "utf8");
    return;
  }
  if (!fs.existsSync(generatedCatalogPath) || fs.readFileSync(generatedCatalogPath, "utf8") !== serialized) {
    fail("生成的社区 Skill 目录已过期；运行 npm run refresh:community-skills -- --write");
  }
}

async function main() {
  const mode = process.argv.slice(2).find((argument) => argument === "--write" || argument === "--check");
  if (!mode || process.argv.slice(2).length !== 1) fail("用法：refresh-community-skill-catalog.mjs --write | --check");
  await refresh(mode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
