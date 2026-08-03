import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  loadSkillArchive,
  loadSkillDirectory,
  loadSkillFiles,
  type SkillPackageCandidate,
} from "./skill-package";
import {
  scanSkillPackage,
  type SkillScanStatus,
  type SkillSecurityFinding,
  type SkillSecurityReport,
} from "./skill-security";
import { skillsRootFor } from "./skills";
import {
  COMMUNITY_SKILL_CATALOG,
  type CommunitySkillCatalogEntry,
} from "./community-skill-catalog";

export type SkillSourceKind = "local-folder" | "local-archive" | "github" | "skillsh";
export type SkillTrust = "community" | "personal";
export type ManagedSkillScanStatus = "unscanned" | SkillScanStatus;

export interface SkillCandidateInspection {
  name: string;
  description: string;
  scan?: SkillSecurityReport;
}

export interface SkillSourceInspection {
  source: string;
  resolvedSource: string;
  sourceKind: SkillSourceKind;
  sourceLabel: string;
  candidates: SkillCandidateInspection[];
  repository?: string;
  revision?: string;
  license?: string;
}

export interface ManagedSkillRecord {
  id: string;
  name: string;
  description: string;
  dir: string;
  trust: SkillTrust;
  sourceKind: SkillSourceKind;
  sourceLabel: string;
  source: string;
  resolvedSource: string;
  candidate: string;
  scanStatus: ManagedSkillScanStatus;
  findings: SkillSecurityFinding[];
  category?: string;
  categoryLabel?: string;
  catalogId?: string;
  installedAt: number;
  updatedAt: number;
  repository?: string;
  revision?: string;
  license?: string;
}

export interface SkillInstallRequest {
  source: string;
  candidate?: string;
  securityScan?: boolean;
}

export interface SkillInstallResult {
  installed: ManagedSkillRecord[];
}

export interface CommunitySkillCatalogView {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryLabel: string;
  author: string;
  repository: string;
  revision: string;
  license: string;
  sourceUrl: string;
  installed: boolean;
  scanStatus: "scanned";
}

export interface SkillAdminService {
  inspect(source: string, options?: { securityScan?: boolean }): Promise<SkillSourceInspection>;
  install(request: SkillInstallRequest): Promise<SkillInstallResult>;
  listCatalog(): CommunitySkillCatalogView[];
  installCatalog(idOrName: string): Promise<SkillInstallResult>;
  scanManaged(idOrName: string): ManagedSkillRecord;
  listManaged(): ManagedSkillRecord[];
  remove(idOrName: string): void;
  metadataForDir(dir: string): ManagedSkillRecord | undefined;
}

interface RegistryFile {
  version: 1;
  skills: ManagedSkillRecord[];
}

export interface SkillAdminServiceOptions {
  memoryDir: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  communityCatalog?: readonly CommunitySkillCatalogEntry[];
}

interface LoadedSource {
  inspection: SkillSourceInspection;
  candidates: SkillPackageCandidate[];
}

interface RemoteLocation {
  sourceKind: "github" | "skillsh";
  original: string;
  owner: string;
  repo: string;
  ref?: string;
  prefix?: string;
  requestedName?: string;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

function cleanSegment(value: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`${label}不合法。`);
  }
  if (!/^[a-z0-9_.-]+$/iu.test(decoded) || decoded === "." || decoded === "..") {
    throw new Error(`${label}不合法。`);
  }
  return decoded;
}

function parseRemoteLocation(source: string): RemoteLocation {
  let url: URL;
  try {
    url = new URL(source.trim());
  } catch {
    throw new Error("请输入有效的 Skill 链接。");
  }
  if (url.protocol !== "https:") throw new Error("远程 Skill 只支持 HTTPS 来源。");
  const parts = url.pathname.split("/").filter(Boolean);
  const host = url.hostname.toLocaleLowerCase();

  if (host === "skills.sh" || host === "www.skills.sh") {
    if (parts.length < 3) throw new Error("skill.sh 链接没有指向具体 Skill。");
    return {
      sourceKind: "skillsh",
      original: source.trim(),
      owner: cleanSegment(parts[0], "skill.sh 作者"),
      repo: cleanSegment(parts[1], "skill.sh 仓库").replace(/\.git$/iu, ""),
      requestedName: cleanSegment(parts[2], "Skill 名称"),
    };
  }

  if (host === "raw.githubusercontent.com") {
    if (parts.length < 4) throw new Error("GitHub Raw 链接不完整。");
    const file = parts.slice(3).map((part) => decodeURIComponent(part)).join("/");
    if (!file.toLocaleLowerCase().endsWith("/skill.md") && file.toLocaleLowerCase() !== "skill.md") {
      throw new Error("GitHub Raw 链接必须指向 SKILL.md。");
    }
    return {
      sourceKind: "github",
      original: source.trim(),
      owner: cleanSegment(parts[0], "GitHub 作者"),
      repo: cleanSegment(parts[1], "GitHub 仓库").replace(/\.git$/iu, ""),
      ref: cleanSegment(parts[2], "GitHub 版本"),
      prefix: file === "SKILL.md" ? "" : file.slice(0, -"/SKILL.md".length),
    };
  }

  if (host !== "github.com" && host !== "www.github.com") {
    throw new Error("当前远程安装只支持 GitHub 和 skill.sh 链接。");
  }
  if (parts.length < 2) throw new Error("GitHub 链接没有指向仓库。");
  const location: RemoteLocation = {
    sourceKind: "github",
    original: source.trim(),
    owner: cleanSegment(parts[0], "GitHub 作者"),
    repo: cleanSegment(parts[1], "GitHub 仓库").replace(/\.git$/iu, ""),
  };
  const mode = parts[2];
  if (mode === undefined) return location;
  if ((mode !== "tree" && mode !== "blob") || parts.length < 4) {
    throw new Error("GitHub 链接格式不受支持，请使用仓库、Skill 文件夹或 SKILL.md 链接。");
  }
  location.ref = cleanSegment(parts[3], "GitHub 版本");
  const rest = parts.slice(4).map((part) => decodeURIComponent(part)).join("/");
  if (mode === "blob") {
    if (!rest.toLocaleLowerCase().endsWith("skill.md")) throw new Error("GitHub 文件链接必须指向 SKILL.md。");
    location.prefix = rest.toLocaleLowerCase() === "skill.md" ? "" : rest.slice(0, -"/SKILL.md".length);
  } else {
    location.prefix = rest.replace(/\/+$/u, "");
  }
  return location;
}

function rawGitHubUrl(owner: string, repo: string, revision: string, file: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${revision}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isManagedSkillDirectory(skillsRoot: string, candidate: string): boolean {
  const rel = relative(resolve(skillsRoot), resolve(candidate));
  return /^[^\\/]+$/u.test(rel) && /^managed-[a-f0-9]{12}$/iu.test(rel);
}

function registryFor(memoryDir: string): string {
  return join(memoryDir, ".leemo", "skills", "registry.json");
}

function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const backup = `${path}.backup-${randomUUID()}`;
  writeFileSync(temporary, contents, "utf8");
  const hadCurrent = existsSync(path);
  try {
    if (hadCurrent) renameSync(path, backup);
    renameSync(temporary, path);
    if (hadCurrent) rmSync(backup, { force: true });
  } catch (error) {
    rmSync(temporary, { force: true });
    if (!existsSync(path) && existsSync(backup)) renameSync(backup, path);
    throw error;
  }
}

function cloneRecord(record: ManagedSkillRecord): ManagedSkillRecord {
  return { ...record, findings: record.findings.map((finding) => ({ ...finding })) };
}

function rawCatalogFileUrl(entry: CommunitySkillCatalogEntry, file: CommunitySkillCatalogEntry["files"][number]): string {
  const [owner, repo] = entry.repository.split("/");
  const fullPath = (file.sourcePath ?? `${entry.upstreamPath}/${file.path}`).split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${entry.revision}/${fullPath}`;
}

function readRegistry(path: string): RegistryFile {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
    if (value.version === 1 && Array.isArray(value.skills)) {
      return { version: 1, skills: value.skills.map(cloneRecord) };
    }
  } catch {
    // First run and a damaged optional registry both degrade to no managed
    // Skills. Existing user folders remain untouched and still scan normally.
  }
  return { version: 1, skills: [] };
}

function chooseCandidate(candidates: readonly SkillPackageCandidate[], requested: string | undefined): SkillPackageCandidate {
  if (requested) {
    const match = candidates.find((candidate) => candidate.name.toLocaleLowerCase() === requested.trim().toLocaleLowerCase());
    if (!match) throw new Error(`没有找到名为“${requested}”的 Skill。`);
    return match;
  }
  if (candidates.length === 1) return candidates[0];
  throw new Error("这个来源包含多个 Skills，请先选择要安装的那一个。");
}

function writeCandidate(root: string, candidate: SkillPackageCandidate): void {
  mkdirSync(root, { recursive: true });
  for (const file of candidate.files) {
    const destination = resolve(root, ...file.path.split("/"));
    if (!isInside(root, destination)) throw new Error(`Skill 包含不安全路径：${file.path}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.contents);
  }
}

function candidateInspection(
  candidate: SkillPackageCandidate,
  securityScan: boolean,
): SkillCandidateInspection {
  return {
    name: candidate.name,
    description: candidate.description,
    ...(securityScan ? { scan: scanSkillPackage(candidate.files) } : {}),
  };
}

/** The curated Grill Me card uses the upstream `grilling` implementation but
 * gives it the product-facing bare name. The bytes are verified first; this
 * tiny frontmatter-only adaptation keeps the implementation intact while
 * avoiding a wrapper that points at a missing sibling Skill. */
function renameSkillFrontmatter(candidate: SkillPackageCandidate, name: string): SkillPackageCandidate {
  const skillFile = candidate.files.find((file) => file.path === "SKILL.md");
  if (!skillFile || candidate.name === name) return candidate;
  const lines = skillFile.contents.toString("utf8").split(/\r?\n/u);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (lines[0]?.trim() !== "---" || end < 0) throw new Error("社区 Skill 的固定版本头部格式不受支持。");
  const nameLine = lines.findIndex((line, index) => index > 0 && index < end && /^\s*name\s*:/iu.test(line));
  if (nameLine < 0) throw new Error("社区 Skill 缺少可验证的名称。");
  lines[nameLine] = `name: ${JSON.stringify(name)}`;
  const files = candidate.files.map((file) => file.path === "SKILL.md"
    ? { ...file, contents: Buffer.from(lines.join("\n"), "utf8") }
    : { ...file, contents: Buffer.from(file.contents) });
  return { ...candidate, name, files };
}

function localSource(source: string, securityScan: boolean): LoadedSource {
  const absolute = resolve(source.trim());
  if (!source.trim() || !existsSync(absolute)) throw new Error("找不到这个 Skill 来源。");
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error("Skill 来源不能是符号链接。");
  const archive = stat.isFile() && extname(absolute).toLowerCase() === ".zip";
  const loaded = archive
    ? loadSkillArchive(readFileSync(absolute))
    : loadSkillDirectory(absolute);
  const sourceKind: SkillSourceKind = archive ? "local-archive" : "local-folder";
  return {
    candidates: loaded.candidates,
    inspection: {
      source: absolute,
      resolvedSource: absolute,
      sourceKind,
      sourceLabel: "本地导入",
      candidates: loaded.candidates.map((candidate) => candidateInspection(candidate, securityScan)),
    },
  };
}

export function createSkillAdminService(options: SkillAdminServiceOptions): SkillAdminService {
  const memoryDir = resolve(options.memoryDir);
  const skillsRoot = skillsRootFor(memoryDir);
  const registryPath = registryFor(memoryDir);
  const now = options.now ?? Date.now;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const communityCatalog = options.communityCatalog ?? COMMUNITY_SKILL_CATALOG;
  let registry = readRegistry(registryPath);

  const writeRegistry = (next: RegistryFile): void => {
    atomicWrite(registryPath, `${JSON.stringify(next, null, 2)}\n`);
    registry = next;
  };

  const request = async (url: string, accept: string): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchFn(url, {
          headers: { "User-Agent": "Leemo-Skills/1.0", Accept: accept },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) return response;
        if (response.status === 403 || response.status === 429) {
          throw new Error("GitHub 匿名访问额度暂时用完，请稍后再试或导入本地 ZIP。");
        }
        if (response.status === 404) throw new Error("GitHub 地址不存在、仓库私有或路径不正确。");
        if (response.status < 500 || attempt === 1) throw new Error(`GitHub 请求失败（HTTP ${response.status}）。`);
        lastError = new Error(`GitHub 暂时不可用（HTTP ${response.status}）。`);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (/访问额度|地址不存在|仓库私有|HTTP 4\d\d/u.test(message)) throw error;
        if (attempt === 1) throw new Error("连接 GitHub 超时或网络不可用，也可以先下载 ZIP 再导入。", { cause: error });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("连接 GitHub 失败。");
  };

  const requestJson = async <T>(url: string): Promise<T> => {
    const response = await request(url, "application/vnd.github+json");
    try {
      return await response.json() as T;
    } catch (error) {
      throw new Error("GitHub 返回了无法解析的数据。", { cause: error });
    }
  };

  const loadRemote = async (source: string, securityScan: boolean): Promise<LoadedSource> => {
    const location = parseRemoteLocation(source);
    const repository = `${location.owner}/${location.repo}`;
    const metadata = await requestJson<{ default_branch?: string; license?: { spdx_id?: string } }>(
      `https://api.github.com/repos/${location.owner}/${location.repo}`,
    );
    const ref = location.ref ?? metadata.default_branch ?? "main";
    const commit = await requestJson<{ sha?: string }>(
      `https://api.github.com/repos/${location.owner}/${location.repo}/commits/${encodeURIComponent(ref)}`,
    );
    if (!commit.sha || !/^[a-f0-9]{7,64}$/iu.test(commit.sha)) throw new Error("GitHub 没有返回可固定的提交版本。");
    const revision = commit.sha;
    const tree = await requestJson<{ truncated?: boolean; tree?: GitTreeEntry[] }>(
      `https://api.github.com/repos/${location.owner}/${location.repo}/git/trees/${revision}?recursive=1`,
    );
    if (tree.truncated) throw new Error("GitHub 仓库过大，请粘贴具体 Skill 文件夹链接。");
    if (!Array.isArray(tree.tree)) throw new Error("GitHub 仓库目录不可用。");

    const prefix = location.prefix?.replace(/^\/+|\/+$/gu, "");
    let skillEntries = tree.tree.filter((entry) => (
      entry.type === "blob"
      && (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md"))
      && (prefix === undefined || prefix === "" || entry.path === `${prefix}/SKILL.md` || entry.path.startsWith(`${prefix}/`))
    ));
    if (skillEntries.length === 0) throw new Error("这个来源下没有找到符合规范的 SKILL.md。");
    if (skillEntries.length > 50) throw new Error("找到的 Skills 太多，请粘贴更具体的文件夹链接。");

    const headerFiles = await Promise.all(skillEntries.map(async (entry) => {
      const response = await request(
        rawGitHubUrl(location.owner, location.repo, revision, entry.path),
        "text/plain",
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      return { path: entry.path, contents: bytes };
    }));
    let headerCandidates = loadSkillFiles(headerFiles).candidates;
    if (location.requestedName) {
      const requested = location.requestedName.toLocaleLowerCase();
      headerCandidates = headerCandidates.filter((candidate) => (
        candidate.name.toLocaleLowerCase() === requested
        || basename(candidate.root).toLocaleLowerCase() === requested
      ));
      if (headerCandidates.length === 0) throw new Error(`skill.sh 指向的“${location.requestedName}”不在上游仓库中。`);
      skillEntries = skillEntries.filter((entry) => headerCandidates.some((candidate) => (
        entry.path === (candidate.root ? `${candidate.root}/SKILL.md` : "SKILL.md")
      )));
    }

    const selectedRoots = headerCandidates.map((candidate) => candidate.root);
    const selectedEntries = tree.tree.filter((entry) => selectedRoots.some((root) => {
      const pathPrefix = root ? `${root}/` : "";
      return entry.path.startsWith(pathPrefix);
    }));
    const unsupported = selectedEntries.find((entry) => entry.mode === "120000" || entry.type === "commit");
    if (unsupported) throw new Error(`Skill 包含符号链接或子模块：${unsupported.path}`);
    const blobs = selectedEntries.filter((entry) => entry.type === "blob");
    if (blobs.length > 200) throw new Error("Skill 超过 200 个文件，已停止安装。");
    const declaredBytes = blobs.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    if (declaredBytes > 5 * 1024 * 1024) throw new Error("Skill 超过 5MB，已停止安装。");

    const downloaded = await Promise.all(blobs.map(async (entry) => {
      const response = await request(
        rawGitHubUrl(location.owner, location.repo, revision, entry.path),
        "application/octet-stream, text/plain;q=0.9",
      );
      return { path: entry.path, contents: Buffer.from(await response.arrayBuffer()) };
    }));
    let candidates = loadSkillFiles(downloaded).candidates;
    if (location.requestedName) {
      const requested = location.requestedName.toLocaleLowerCase();
      candidates = candidates.filter((candidate) => candidate.name.toLocaleLowerCase() === requested || basename(candidate.root).toLocaleLowerCase() === requested);
    }
    candidates.sort((left, right) => left.name.localeCompare(right.name));

    const exactRoot = candidates.length === 1 ? candidates[0].root : prefix;
    const resolvedSource = exactRoot
      ? `https://github.com/${repository}/tree/${revision}/${exactRoot}`
      : `https://github.com/${repository}/tree/${revision}`;
    const license = metadata.license?.spdx_id && metadata.license.spdx_id !== "NOASSERTION"
      ? metadata.license.spdx_id
      : undefined;
    return {
      candidates,
      inspection: {
        source: location.original,
        resolvedSource,
        sourceKind: location.sourceKind,
        sourceLabel: location.owner,
        repository,
        revision,
        ...(license ? { license } : {}),
        candidates: candidates.map((candidate) => candidateInspection(candidate, securityScan)),
      },
    };
  };

  const load = async (source: string, securityScan = false): Promise<LoadedSource> => {
    if (/^https?:\/\//iu.test(source.trim())) {
      return await loadRemote(source, securityScan);
    }
    return localSource(source, securityScan);
  };

  function findUnmanagedSkill(idOrName: string): {
    dir: string;
    candidate: SkillPackageCandidate;
  } | undefined {
    if (!existsSync(skillsRoot)) return undefined;
    const key = idOrName.trim().toLocaleLowerCase();
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const dir = join(skillsRoot, entry.name);
      try {
        const loaded = loadSkillDirectory(dir);
        const candidate = loaded.candidates.find((item) => (
          item.name.toLocaleLowerCase() === key
          || `custom:leemo:${item.name}`.toLocaleLowerCase() === key
        ));
        if (candidate) return { dir, candidate };
      } catch {
        // A malformed sibling should not prevent scanning another user Skill.
      }
    }
    return undefined;
  }

  const installCandidate = (
    candidate: SkillPackageCandidate,
    inspection: SkillSourceInspection,
    trust: SkillTrust,
    scan: SkillSecurityReport | undefined,
    catalog?: CommunitySkillCatalogEntry,
  ): ManagedSkillRecord => {
    if (registry.skills.some((record) => record.name.toLocaleLowerCase() === candidate.name.toLocaleLowerCase())) {
      throw new Error(`Skill“${candidate.name}”已经安装；请使用更新操作。`);
    }
    if (findUnmanagedSkill(candidate.name)) {
      throw new Error(`技能目录里已经有同名 Skill“${candidate.name}”；请先重命名或移除其中一个。`);
    }
    mkdirSync(skillsRoot, { recursive: true });
    const hash = createHash("sha256")
      .update(`${candidate.name}\n${inspection.resolvedSource}`)
      .digest("hex")
      .slice(0, 12);
    const id = `managed:${hash}`;
    const destination = join(skillsRoot, `managed-${hash}`);
    const staging = join(skillsRoot, `.install-${randomUUID()}`);
    if (existsSync(destination)) throw new Error("安装目录已经存在，但注册信息缺失；请先在文件夹中检查。");

    try {
      writeCandidate(staging, candidate);
      renameSync(staging, destination);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }

    const timestamp = now();
    const record: ManagedSkillRecord = {
      id,
      name: catalog?.name ?? candidate.name,
      description: catalog?.description ?? candidate.description,
      dir: destination,
      trust,
      sourceKind: inspection.sourceKind,
      sourceLabel: catalog?.author ?? inspection.sourceLabel,
      source: catalog?.sourceUrl ?? inspection.source,
      resolvedSource: catalog?.sourceUrl ?? inspection.resolvedSource,
      candidate: candidate.name,
      scanStatus: scan?.status ?? "unscanned",
      findings: scan?.findings.map((finding) => ({ ...finding })) ?? [],
      installedAt: timestamp,
      updatedAt: timestamp,
      ...(catalog ? { category: catalog.category, categoryLabel: catalog.categoryLabel, catalogId: catalog.id } : {}),
      ...(inspection.repository ? { repository: inspection.repository } : {}),
      ...(inspection.revision ? { revision: inspection.revision } : {}),
      ...(inspection.license ? { license: inspection.license } : {}),
    };
    const next = { version: 1 as const, skills: [...registry.skills, record] };
    try {
      writeRegistry(next);
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      throw error;
    }
    return cloneRecord(record);
  };

  return {
    async inspect(source, inspectOptions = {}) {
      return (await load(source, inspectOptions.securityScan === true)).inspection;
    },

    async install(request) {
      const loaded = await load(request.source);
      const candidate = chooseCandidate(loaded.candidates, request.candidate);
      const scan = request.securityScan === true ? scanSkillPackage(candidate.files) : undefined;
      return { installed: [installCandidate(candidate, loaded.inspection, "personal", scan)] };
    },

    listCatalog() {
      return communityCatalog.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        category: entry.category,
        categoryLabel: entry.categoryLabel,
        author: entry.author,
        repository: entry.repository,
        revision: entry.revision,
        license: entry.license,
        sourceUrl: entry.sourceUrl,
        installed: registry.skills.some((record) => record.catalogId === entry.id),
        scanStatus: "scanned" as const,
      }));
    },

    async installCatalog(idOrName) {
      const key = idOrName.trim().toLocaleLowerCase();
      const entry = communityCatalog.find((candidate) => candidate.id.toLocaleLowerCase() === key || candidate.name.toLocaleLowerCase() === key);
      if (!entry) throw new Error("这个 Skill 不在 Leemo 的社区可信目录中。");
      if (registry.skills.some((record) => record.catalogId === entry.id)) throw new Error(`Skill“${entry.name}”已经安装。`);
      const files = await Promise.all(entry.files.map(async (file) => {
        const response = await request(rawCatalogFileUrl(entry, file), "application/octet-stream, text/plain;q=0.9");
        const contents = Buffer.from(await response.arrayBuffer());
        const digest = createHash("sha256").update(contents).digest("hex");
        if (contents.byteLength !== file.bytes || digest !== file.sha256) {
          throw new Error(`社区 Skill“${entry.name}”的固定版本校验失败，已停止安装。`);
        }
        return { path: file.path, contents };
      }));
      const loaded = loadSkillFiles(files);
      const upstream = chooseCandidate(loaded.candidates, undefined);
      const candidate: SkillPackageCandidate = {
        ...renameSkillFrontmatter(upstream, entry.name),
        description: entry.description,
        category: entry.category,
        categoryLabel: entry.categoryLabel,
      };
      const scan = scanSkillPackage(candidate.files);
      if (scan.status !== "scanned") {
        throw new Error(`社区可信 Skill“${entry.name}”没有通过 Leemo 预审，已停止从精选目录安装；用户仍可自行提供来源安装。`);
      }
      const inspection: SkillSourceInspection = {
        source: entry.sourceUrl,
        resolvedSource: entry.sourceUrl,
        sourceKind: "github",
        sourceLabel: entry.author,
        repository: entry.repository,
        revision: entry.revision,
        license: entry.license,
        candidates: [candidateInspection(candidate, true)],
      };
      return { installed: [installCandidate(candidate, inspection, "community", scan, entry)] };
    },

    scanManaged(idOrName) {
      const record = registry.skills.find((candidate) => {
        const key = idOrName.trim().toLocaleLowerCase();
        return candidate.id.toLocaleLowerCase() === key || candidate.name.toLocaleLowerCase() === key;
      });
      if (record) {
        if (!isManagedSkillDirectory(skillsRoot, record.dir) || !existsSync(record.dir)) throw new Error("已安装 Skill 的目录不可用。");
      }
      const unmanaged = record ? undefined : findUnmanagedSkill(idOrName);
      if (!record && !unmanaged) throw new Error("没有找到这个已安装的 Skill。");
      const dir = record?.dir ?? unmanaged!.dir;
      const loaded = record ? loadSkillDirectory(dir) : undefined;
      const candidate = record
        ? chooseCandidate(loaded!.candidates, record.candidate)
        : unmanaged!.candidate;
      const scan = scanSkillPackage(candidate.files);
      if (!record) {
        const timestamp = now();
        return {
          id: `custom:leemo:${candidate.name}`,
          name: candidate.name,
          description: candidate.description,
          dir,
          trust: "personal" as const,
          sourceKind: "local-folder" as const,
          sourceLabel: "本地文件夹",
          source: dir,
          resolvedSource: dir,
          candidate: candidate.name,
          scanStatus: scan.status,
          findings: scan.findings.map((finding) => ({ ...finding })),
          installedAt: timestamp,
          updatedAt: timestamp,
        };
      }
      const updated: ManagedSkillRecord = {
        ...record,
        scanStatus: scan.status,
        findings: scan.findings.map((finding) => ({ ...finding })),
        updatedAt: now(),
      };
      writeRegistry({ version: 1, skills: registry.skills.map((candidateRecord) => candidateRecord.id === record.id ? updated : candidateRecord) });
      return cloneRecord(updated);
    },

    listManaged() {
      return registry.skills.map(cloneRecord).sort((left, right) => left.name.localeCompare(right.name));
    },

    remove(idOrName) {
      const key = idOrName.trim().toLocaleLowerCase();
      const record = registry.skills.find((candidate) => candidate.id.toLocaleLowerCase() === key || candidate.name.toLocaleLowerCase() === key);
      if (!record) throw new Error("这个 Skill 不由 Leemo 管理，不能替你删除文件。");
      if (!isManagedSkillDirectory(skillsRoot, record.dir)) throw new Error("Skill 注册目录不安全，已停止删除。");
      const backup = `${record.dir}.remove-${randomUUID()}`;
      const existed = existsSync(record.dir);
      if (existed) renameSync(record.dir, backup);
      try {
        writeRegistry({ version: 1, skills: registry.skills.filter((candidate) => candidate.id !== record.id) });
        if (existed) rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        if (existed && existsSync(backup) && !existsSync(record.dir)) renameSync(backup, record.dir);
        throw error;
      }
    },

    metadataForDir(dir) {
      const normalized = normalizePath(dir);
      const record = registry.skills.find((candidate) => normalizePath(candidate.dir) === normalized);
      return record ? cloneRecord(record) : undefined;
    },
  };
}
