import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  OFFICE_SKILL_DEFINITIONS,
  OFFICE_SKILL_PLUGIN_NAME,
  type OfficeSkillRuntime,
  type OfficeSkillRuntimeSnapshot,
} from "../host/office-skills";
export interface OfficeSkillProvisionerOptions {
  configDir: string;
  /** Build-time bundle stored under bundled-skills/office/release. */
  bundledRoot?: string;
}

interface InstalledOfficePlugin {
  installPath: string;
  skillRoot: string;
  revision?: string;
  source: "bundled";
}

const OFFICE_SKILL_NAMES = OFFICE_SKILL_DEFINITIONS.map((skill) => skill.officeId).sort();
const FORBIDDEN_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "node_modules",
]);

function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("运行组件") || message.includes("内置 Office 技能包")
    ? message
    : "Office 能力暂时不可用，稍后会自动重试。";
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function visitFiles(root: string, onFile: (file: string, relative: string) => void): void {
  const visit = (directory: string, relativeRoot: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`内置 Office 技能包不允许包含链接：${relative}`);
      }
      if (info.isDirectory()) {
        const lower = entry.name.toLocaleLowerCase();
        if (FORBIDDEN_DIRECTORIES.has(lower) || lower.includes("staging")) {
          throw new Error(`内置 Office 技能包不允许包含缓存、依赖或 staging 目录：${relative}`);
        }
        visit(absolute, relative);
      } else if (info.isFile()) {
        if (entry.name.toLocaleLowerCase().endsWith(".pyc")) {
          throw new Error(`内置 Office 技能包不允许包含 Python 缓存：${relative}`);
        }
        onFile(absolute, relative);
      } else {
        throw new Error(`内置 Office 技能包包含不支持的文件类型：${relative}`);
      }
    }
  };
  visit(root, "");
}

function bundledRevision(skillRoot: string): string {
  const hash = createHash("sha256");
  const files: Array<{ file: string; relative: string }> = [];
  visitFiles(skillRoot, (file, relative) => files.push({ file, relative }));
  for (const { file, relative } of files.sort((left, right) => left.relative.localeCompare(right.relative, "en"))) {
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return `bundled-${hash.digest("hex").slice(0, 16)}`;
}

/**
 * Read a bundle deliberately supplied by the product owner at build time.
 * The source is validated before it is copied to app data so packaged ASAR
 * files are never executed in place and malformed trees cannot escape.
 */
function readBundledOfficePlugin(rootPath: string | undefined): InstalledOfficePlugin | undefined {
  if (!rootPath) return undefined;
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root)) return undefined;
  if (fs.lstatSync(root).isSymbolicLink()) {
    throw new Error("内置 Office 技能包根目录不能是链接。");
  }
  const realRoot = fs.realpathSync.native(root);
  const rootEntries = fs.readdirSync(realRoot, { withFileTypes: true });
  const nestedSkillRoot = path.join(realRoot, "skills");
  if (rootEntries.length !== 1 || rootEntries[0]?.name !== "skills") {
    throw new Error("内置 Office 技能包 release 目录只能包含 skills 目录。");
  }
  const nestedSkillInfo = fs.lstatSync(nestedSkillRoot);
  if (nestedSkillInfo.isSymbolicLink() || !nestedSkillInfo.isDirectory()) {
    throw new Error("内置 Office 技能包 release/skills 必须是真实目录。");
  }
  const skillRoot = nestedSkillRoot;
  const actualNames = fs.readdirSync(skillRoot, { withFileTypes: true })
    .map((entry) => entry.name)
    .sort();
  if (actualNames.length !== OFFICE_SKILL_NAMES.length
      || actualNames.some((name, index) => name !== OFFICE_SKILL_NAMES[index])) {
    throw new Error("内置 Office 技能包必须且只能包含 docx、xlsx、pptx、pdf 四个技能目录。");
  }
  for (const skill of OFFICE_SKILL_DEFINITIONS) {
    const skillDir = path.join(skillRoot, skill.officeId);
    const info = fs.lstatSync(skillDir);
    const realSkill = fs.realpathSync.native(skillDir);
    if (info.isSymbolicLink() || !info.isDirectory() || !within(realRoot, realSkill)) {
      throw new Error(`内置 Office 技能目录无效：${skill.officeId}`);
    }
    visitFiles(realSkill, () => undefined);
    const skillFile = path.join(realSkill, "SKILL.md");
    if (!fs.existsSync(skillFile) || !fs.lstatSync(skillFile).isFile()) {
      throw new Error(`内置 Office 技能缺少 SKILL.md：${skill.officeId}`);
    }
  }
  return {
    installPath: realRoot,
    skillRoot,
    revision: bundledRevision(skillRoot),
    source: "bundled",
  };
}

function adapterRootFor(configDir: string): string {
  return path.join(configDir, "runtime", OFFICE_SKILL_PLUGIN_NAME);
}

function adapterIsCurrent(
  adapterRoot: string,
  installed: InstalledOfficePlugin,
): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(adapterRoot, ".claude-plugin", "plugin.json"),
      "utf8",
    )) as { name?: unknown; version?: unknown };
    if (manifest.name !== OFFICE_SKILL_PLUGIN_NAME) return false;
    if ((manifest.version ?? undefined) !== (installed.revision ?? undefined)) return false;
    const skillRoot = path.join(adapterRoot, "skills");
    const names = fs.readdirSync(skillRoot).sort();
    return names.length === OFFICE_SKILL_NAMES.length
      && names.every((name, index) => name === OFFICE_SKILL_NAMES[index])
      && OFFICE_SKILL_DEFINITIONS.every((skill) => {
        const skillDir = path.join(skillRoot, skill.officeId);
        return fs.lstatSync(skillDir).isDirectory()
          && !fs.lstatSync(skillDir).isSymbolicLink()
          && fs.lstatSync(path.join(skillDir, "SKILL.md")).isFile();
      });
  } catch {
    return false;
  }
}

function copySkill(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  visitFiles(source, (file, relative) => {
    const destination = path.join(target, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
  });
}

function materializeAdapter(configDir: string, installed: InstalledOfficePlugin): string {
  const adapterRoot = adapterRootFor(configDir);
  if (adapterIsCurrent(adapterRoot, installed)) return adapterRoot;

  const staging = `${adapterRoot}.staging`;
  const backup = `${adapterRoot}.backup`;
  fs.rmSync(staging, { recursive: true, force: true });
  if (fs.existsSync(backup)) {
    if (fs.existsSync(adapterRoot)) fs.rmSync(backup, { recursive: true, force: true });
    else fs.renameSync(backup, adapterRoot);
  }
  fs.mkdirSync(path.join(staging, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(staging, "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(staging, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({
      name: OFFICE_SKILL_PLUGIN_NAME,
      description: "Leemo 内置 Office 文档能力",
      ...(installed.revision ? { version: installed.revision } : {}),
    }, null, 2)}\n`,
    "utf8",
  );
  for (const skill of OFFICE_SKILL_DEFINITIONS) {
    const source = path.join(installed.skillRoot, skill.officeId);
    const target = path.join(staging, "skills", skill.officeId);
    copySkill(source, target);
  }

  let movedCurrent = false;
  let installedStaging = false;
  try {
    if (fs.existsSync(adapterRoot)) {
      fs.renameSync(adapterRoot, backup);
      movedCurrent = true;
    }
    fs.renameSync(staging, adapterRoot);
    installedStaging = true;
    if (!adapterIsCurrent(adapterRoot, installed)) {
      throw new Error("Office Skill 适配目录校验失败。");
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return adapterRoot;
  } catch (error) {
    if (installedStaging) fs.rmSync(adapterRoot, { recursive: true, force: true });
    if (movedCurrent && fs.existsSync(backup) && !fs.existsSync(adapterRoot)) {
      fs.renameSync(backup, adapterRoot);
    }
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function createOfficeSkillProvisioner(
  options: OfficeSkillProvisionerOptions,
): OfficeSkillRuntime {
  const configDir = path.resolve(options.configDir);
  let state: OfficeSkillRuntimeSnapshot = { status: "preparing" };
  let inFlight: Promise<OfficeSkillRuntimeSnapshot> | undefined;

  const prepare = async (): Promise<OfficeSkillRuntimeSnapshot> => {
    state = { status: "preparing" };
    try {
      const installed = readBundledOfficePlugin(options.bundledRoot);
      if (!installed) {
        throw new Error(
          "内置 Office 技能包未找到。请将 docx、xlsx、pptx、pdf 四个技能目录放入 bundled-skills/office/release/skills 后重新打包。",
        );
      }
      const pluginPath = materializeAdapter(configDir, installed);
      state = {
        status: "ready",
        pluginPath,
        ...(installed.revision ? { revision: installed.revision } : {}),
        source: installed.source,
      };
    } catch (error: unknown) {
      state = { status: "error", error: userFacingError(error) };
    }
    return state;
  };

  return {
    snapshot: () => ({ ...state }),
    ensureReady: () => {
      if (state.status === "ready") return Promise.resolve({ ...state });
      inFlight ??= prepare().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
