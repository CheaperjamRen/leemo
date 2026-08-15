import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SkillInfo } from "../bridge/contract";
import { parseSkillFrontmatterFields } from "./skill-frontmatter";

export const SUPERPOWERS_PLUGIN_NAME = "superpowers";
export const SUPERPOWERS_COLLECTION_LABEL = "Superpowers 开发方法套件";

export const SUPERPOWERS_SKILL_NAMES = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
] as const;

export type SuperpowersSkillName = (typeof SUPERPOWERS_SKILL_NAMES)[number];

interface SuperpowersManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  mode: "100644" | "100755";
}

interface SuperpowersBundleManifest {
  schemaVersion?: unknown;
  repository?: unknown;
  revision?: unknown;
  version?: unknown;
  author?: unknown;
  license?: unknown;
  licenseFile?: unknown;
  skills?: unknown;
  files?: unknown;
}

export interface VerifiedSuperpowersPayloadFile extends SuperpowersManifestFile {
  absolute: string;
}

export interface VerifiedSuperpowersPayload {
  root: string;
  revision: string;
  files: VerifiedSuperpowersPayloadFile[];
}

interface ProductCopy {
  name: string;
  description: string;
}

const PRODUCT_COPY: Record<SuperpowersSkillName, ProductCopy> = {
  brainstorming: {
    name: "需求与方案梳理",
    description: "先厘清目标、边界和选择，再把想法收敛成可执行的设计。",
  },
  "dispatching-parallel-agents": {
    name: "并行任务分工",
    description: "识别互不依赖的工作，并把它们拆给多个协作者并行推进。",
  },
  "executing-plans": {
    name: "按计划执行",
    description: "按已确认的实施计划逐项开发、验证并汇报检查点。",
  },
  "finishing-a-development-branch": {
    name: "开发分支收尾",
    description: "在验证完成后整理分支，并选择合并、提交评审或保留现场。",
  },
  "receiving-code-review": {
    name: "处理代码评审意见",
    description: "先验证评审意见是否适合当前代码，再逐条实施或有依据地说明。",
  },
  "requesting-code-review": {
    name: "发起代码评审",
    description: "在大改动或合并前组织一轮有上下文、有边界的独立代码评审。",
  },
  "subagent-driven-development": {
    name: "分任务协作开发",
    description: "把实施计划拆成独立任务，通过实现与复核两道步骤推进。",
  },
  "systematic-debugging": {
    name: "系统化调试",
    description: "先定位根因、复现和验证，再动手修复异常行为。",
  },
  "test-driven-development": {
    name: "测试驱动开发",
    description: "先写能证明行为的失败测试，再用最小实现让它通过。",
  },
  "using-git-worktrees": {
    name: "隔离开发工作区",
    description: "为功能开发创建隔离工作区，避免污染当前分支与未完成改动。",
  },
  "using-superpowers": {
    name: "开发流程调度",
    description: "在开始任务前识别合适的工作方法，并按对应流程推进。",
  },
  "verification-before-completion": {
    name: "完成前验证",
    description: "在宣称完成前运行新鲜、完整且能直接证明结论的验证。",
  },
  "writing-plans": {
    name: "编写实施计划",
    description: "把已经确认的方案拆成文件、步骤、验证方式和清晰交付物。",
  },
  "writing-skills": {
    name: "编写工作技能",
    description: "创建、修改并验证可复用的工作流程说明。",
  },
};

const SUPERPOWERS_REPOSITORY = "https://github.com/obra/superpowers.git";
const SUPERPOWERS_UPSTREAM_REVISION = "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9";
const SUPERPOWERS_UPSTREAM_VERSION = "6.2.0";
const SUPERPOWERS_LICENSE_SHA256 = "0da33ed814ee87e72db078f489c4447af72f13d9f25d9e17476f32efd77705fc";
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
  ".cache",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "node_modules",
]);

export interface SuperpowersSkillDefinition extends SkillInfo {
  id: `superpowers:${SuperpowersSkillName}`;
  directory: SuperpowersSkillName;
  sourceDir: string;
  source: "builtin";
  category: "developer";
  defaultEnabled: false;
  available: true;
  collectionId: "superpowers";
  collectionLabel: typeof SUPERPOWERS_COLLECTION_LABEL;
}

export type SuperpowersSkillRuntimeSnapshot =
  | { status: "preparing"; skills: SuperpowersSkillDefinition[] }
  | { status: "error"; error: string; skills: SuperpowersSkillDefinition[] }
  | {
      status: "ready";
      pluginPath: string;
      revision: string;
      skills: SuperpowersSkillDefinition[];
    };

export interface SuperpowersSkillRuntime {
  snapshot(): SuperpowersSkillRuntimeSnapshot;
  ensureReady(): Promise<SuperpowersSkillRuntimeSnapshot>;
}

export type SuperpowersSkillCard = SkillInfo & {
  collectionId: "superpowers";
  collectionLabel: typeof SUPERPOWERS_COLLECTION_LABEL;
};

function readManifest(root: string): SuperpowersBundleManifest {
  const manifestFile = path.join(root, "manifest.json");
  try {
    const info = fs.lstatSync(manifestFile);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("not a real file");
    const parsed = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as SuperpowersBundleManifest;
  } catch {
    throw new Error("Superpowers 开发方法套件的 manifest.json 无效。");
  }
}

function assertRealDirectory(root: string, label: string): string {
  let info: fs.Stats;
  try {
    info = fs.lstatSync(root);
  } catch {
    throw new Error(`Superpowers 开发方法套件缺少${label}。`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Superpowers 开发方法套件的${label}必须是真实目录。`);
  }
  return fs.realpathSync.native(root);
}

function sameList(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((name, index) => name === expected[index]);
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function collectPayloadFiles(root: string): Array<{ absolute: string; path: string; info: fs.Stats }> {
  const files: Array<{ absolute: string; path: string; info: fs.Stats }> = [];
  const addFile = (absolute: string, relative: string): void => {
    const info = fs.lstatSync(absolute);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Superpowers 离线包必须使用真实普通文件：${relative}`);
    }
    files.push({ absolute, path: relative, info });
  };
  addFile(path.join(root, "LICENSE.upstream"), "LICENSE.upstream");

  const visit = (directory: string, relativeRoot: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = `${relativeRoot}/${entry.name}`;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`Superpowers 离线包不允许链接：${relative}`);
      if (info.isDirectory()) {
        const lower = entry.name.toLocaleLowerCase();
        if (FORBIDDEN_DIRECTORIES.has(lower) || lower.includes("staging")) {
          throw new Error(`Superpowers 离线包不允许缓存、依赖或 staging 目录：${relative}`);
        }
        const realDirectory = fs.realpathSync.native(absolute);
        if (!within(root, realDirectory)) {
          throw new Error(`Superpowers 离线包目录越过 release 边界：${relative}`);
        }
        visit(realDirectory, relative);
      } else if (info.isFile()) {
        if (entry.name.toLocaleLowerCase().endsWith(".pyc")) {
          throw new Error(`Superpowers 离线包不允许 Python 缓存：${relative}`);
        }
        files.push({ absolute, path: relative, info });
      } else {
        throw new Error(`Superpowers 离线包包含不支持的文件类型：${relative}`);
      }
    }
  };
  visit(path.join(root, "skills"), "skills");
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function safeManifestPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) return false;
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) return false;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  if (value === "LICENSE.upstream") return true;
  return parts.length >= 3
    && parts[0] === "skills"
    && SUPERPOWERS_SKILL_NAMES.includes(parts[1] as SuperpowersSkillName);
}

function verifyManifestFiles(
  manifestFiles: unknown,
  actualFiles: ReturnType<typeof collectPayloadFiles>,
): VerifiedSuperpowersPayloadFile[] {
  if (!Array.isArray(manifestFiles)) {
    throw new Error("Superpowers 开发方法套件 manifest.files 必须是完整数组。");
  }
  const entries: SuperpowersManifestFile[] = manifestFiles.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Superpowers manifest.files[${index}] 不是有效条目。`);
    }
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).sort().join(",") !== "bytes,mode,path,sha256") {
      throw new Error(`Superpowers manifest.files[${index}] 字段无效。`);
    }
    if (!safeManifestPath(entry.path)) {
      throw new Error(`Superpowers manifest.files[${index}] path 路径不安全。`);
    }
    if (!Number.isSafeInteger(entry.bytes) || (entry.bytes as number) < 0) {
      throw new Error(`Superpowers manifest ${entry.path} 的 bytes 无效。`);
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
      throw new Error(`Superpowers manifest ${entry.path} 的 sha256 无效。`);
    }
    const expectedMode = EXECUTABLE_FILES.has(entry.path) ? "100755" : "100644";
    if (entry.mode !== expectedMode) {
      throw new Error(`Superpowers manifest ${entry.path} 的 mode 必须是 ${expectedMode}。`);
    }
    return {
      path: entry.path,
      bytes: entry.bytes as number,
      sha256: entry.sha256,
      mode: expectedMode,
    };
  });
  const manifestPaths = entries.map((entry) => entry.path);
  const sortedPaths = [...manifestPaths].sort((left, right) => left.localeCompare(right, "en"));
  if (!sameList(manifestPaths, sortedPaths) || new Set(manifestPaths).size !== manifestPaths.length) {
    throw new Error("Superpowers manifest.files 必须按 path 排序且不能重复。");
  }
  const actualPaths = actualFiles.map((file) => file.path);
  if (!sameList(manifestPaths, actualPaths)) {
    throw new Error("Superpowers manifest 文件清单与实际 payload 不一致。");
  }

  return entries.map((entry, index) => {
    const actual = actualFiles[index];
    const data = fs.readFileSync(actual.absolute);
    if (actual.info.size !== entry.bytes || data.byteLength !== entry.bytes) {
      throw new Error(`Superpowers manifest ${entry.path} 的 bytes 与 payload 不一致。`);
    }
    if (createHash("sha256").update(data).digest("hex") !== entry.sha256) {
      throw new Error(`Superpowers manifest ${entry.path} 的 sha256 与 payload 不一致。`);
    }
    if (process.platform !== "win32") {
      const executable = (actual.info.mode & 0o111) !== 0;
      if (executable !== (entry.mode === "100755")) {
        throw new Error(`Superpowers payload ${entry.path} 的实际 mode 与 manifest 不一致。`);
      }
    }
    return { ...entry, absolute: actual.absolute };
  });
}

export function verifySuperpowersPayload(rootPath: string): VerifiedSuperpowersPayload {
  const root = assertRealDirectory(path.resolve(rootPath), " release 目录");
  const rootEntries = fs.readdirSync(root).sort((left, right) => left.localeCompare(right, "en"));
  if (!sameList(rootEntries, ["LICENSE.upstream", "manifest.json", "skills"])) {
    throw new Error("Superpowers 开发方法套件 release 目录必须且只能包含许可证、清单和 skills。");
  }
  const manifest = readManifest(root);
  if (manifest.schemaVersion !== 1
      || manifest.repository !== SUPERPOWERS_REPOSITORY
      || manifest.revision !== SUPERPOWERS_UPSTREAM_REVISION
      || manifest.version !== SUPERPOWERS_UPSTREAM_VERSION
      || manifest.author !== "Jesse Vincent"
      || manifest.license !== "MIT"
      || manifest.licenseFile !== "LICENSE.upstream") {
    throw new Error("Superpowers 开发方法套件清单的来源、版本或许可证无效。");
  }
  if (!Array.isArray(manifest.skills)
      || manifest.skills.length !== SUPERPOWERS_SKILL_NAMES.length
      || manifest.skills.some((name, index) => name !== SUPERPOWERS_SKILL_NAMES[index])) {
    throw new Error("Superpowers 开发方法套件必须且只能包含固定的 14 项技能。");
  }

  const skillRoot = assertRealDirectory(path.join(root, "skills"), " skills 目录");
  const actualNames = fs.readdirSync(skillRoot, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!sameList(actualNames, SUPERPOWERS_SKILL_NAMES)) {
    throw new Error("Superpowers 开发方法套件必须且只能包含固定的 14 项技能目录。");
  }
  const files = verifyManifestFiles(manifest.files, collectPayloadFiles(root));
  if (files.find((file) => file.path === "LICENSE.upstream")?.sha256 !== SUPERPOWERS_LICENSE_SHA256) {
    throw new Error("Superpowers 开发方法套件的许可证不是固定上游 LICENSE。");
  }
  return { root, revision: SUPERPOWERS_UPSTREAM_REVISION, files };
}

export function discoverSuperpowersSkills(rootPath: string): SuperpowersSkillDefinition[] {
  const verified = verifySuperpowersPayload(rootPath);
  const root = verified.root;
  const revision = verified.revision;
  const skillRoot = path.join(root, "skills");

  return SUPERPOWERS_SKILL_NAMES.map((directory) => {
    const sourceDir = assertRealDirectory(path.join(skillRoot, directory), `技能目录 ${directory}`);
    const skillFile = path.join(sourceDir, "SKILL.md");
    const skillInfo = fs.lstatSync(skillFile);
    if (skillInfo.isSymbolicLink() || !skillInfo.isFile()) {
      throw new Error(`Superpowers 技能缺少真实的 SKILL.md：${directory}`);
    }
    const fields = parseSkillFrontmatterFields(fs.readFileSync(skillFile, "utf8"));
    if (fields?.name !== directory || typeof fields.description !== "string" || !fields.description.trim()) {
      throw new Error(`Superpowers 技能的名称或说明无效：${directory}`);
    }
    const productCopy = PRODUCT_COPY[directory];
    return {
      id: `superpowers:${directory}`,
      directory,
      sourceDir,
      name: productCopy.name,
      commandName: directory,
      description: productCopy.description,
      qualifiedName: `${SUPERPOWERS_PLUGIN_NAME}:${directory}`,
      source: "builtin",
      category: "developer",
      categoryLabel: "开发",
      defaultEnabled: false,
      available: true,
      trust: "community",
      sourceKind: "leemo",
      sourceLabel: "社区精选",
      sourceUrl: `https://github.com/obra/superpowers/tree/${revision}/skills/${directory}`,
      repository: "obra/superpowers",
      revision,
      license: "MIT",
      scanStatus: "scanned",
      canRemove: false,
      canUpdate: false,
      collectionId: "superpowers",
      collectionLabel: SUPERPOWERS_COLLECTION_LABEL,
    };
  });
}

export function superpowersSkillMetadata(
  snapshot: SuperpowersSkillRuntimeSnapshot,
): SuperpowersSkillCard[] {
  const available = snapshot.status === "ready";
  const unavailableReason = snapshot.status === "preparing"
    ? "正在准备 Superpowers 开发方法套件，稍后即可使用。"
    : snapshot.status === "error"
      ? snapshot.error
      : undefined;
  return snapshot.skills.map(({ directory: _directory, sourceDir: _sourceDir, ...skill }) => ({
    ...skill,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  }));
}
