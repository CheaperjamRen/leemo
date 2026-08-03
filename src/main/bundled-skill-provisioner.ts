import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BUNDLED_SKILL_PLUGIN_NAME,
  discoverBundledSkills,
  type BundledSkillDefinition,
  type BundledSkillRuntime,
  type BundledSkillRuntimeSnapshot,
} from "../host/bundled-skills";

export interface BundledSkillProvisionerOptions {
  configDir: string;
  bundledRoot: string;
}

const FORBIDDEN_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);

function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("内置技能库") || message.includes("SKILL.md") || message.includes("Skill")
    ? message
    : "内置技能暂时不可用，稍后会自动重试。";
}

function visitFiles(root: string, onFile: (file: string, relative: string) => void): void {
  const visit = (directory: string, relativeRoot: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (FORBIDDEN_DIRECTORIES.has(entry.name)) {
        throw new Error(`内置 Skill 不允许包含目录：${entry.name}`);
      }
      const absolute = path.join(directory, entry.name);
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) throw new Error(`内置 Skill 不允许包含符号链接：${relative}`);
      if (info.isDirectory()) {
        visit(absolute, relative);
      } else if (info.isFile()) {
        if (entry.name.toLocaleLowerCase().endsWith(".pyc")) {
          throw new Error(`内置 Skill 不允许包含 Python 缓存：${relative}`);
        }
        onFile(absolute, relative);
      } else {
        throw new Error(`内置 Skill 包含不支持的文件类型：${relative}`);
      }
    }
  };
  visit(root, "");
}

function revisionFor(skills: readonly BundledSkillDefinition[]): string {
  const hash = createHash("sha256");
  for (const skill of [...skills].sort((left, right) => left.id.localeCompare(right.id, "en"))) {
    hash.update(skill.id);
    hash.update(skill.defaultEnabled ? "\u0001" : "\u0000");
    visitFiles(skill.sourceDir, (file, relative) => {
      hash.update(relative.replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(fs.readFileSync(file));
      hash.update("\0");
    });
  }
  return `sha256-${hash.digest("hex").slice(0, 20)}`;
}

function pluginRootFor(configDir: string): string {
  return path.join(configDir, "runtime", BUNDLED_SKILL_PLUGIN_NAME);
}

function pluginIsCurrent(pluginRoot: string, revision: string, skills: readonly BundledSkillDefinition[]): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      "utf8",
    )) as { name?: unknown; version?: unknown };
    return manifest.name === BUNDLED_SKILL_PLUGIN_NAME
      && manifest.version === revision
      && skills.every((skill) => fs.existsSync(path.join(pluginRoot, "skills", skill.directory, "SKILL.md")));
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

function materialize(
  configDir: string,
  revision: string,
  skills: readonly BundledSkillDefinition[],
): string {
  const pluginRoot = pluginRootFor(configDir);
  if (pluginIsCurrent(pluginRoot, revision, skills)) return pluginRoot;
  const staging = `${pluginRoot}.staging`;
  const backup = `${pluginRoot}.backup`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(staging, "skills"), { recursive: true });
  fs.writeFileSync(
    path.join(staging, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({
      name: BUNDLED_SKILL_PLUGIN_NAME,
      description: "Leemo 离线精选技能库",
      version: revision,
    }, null, 2)}\n`,
    "utf8",
  );
  for (const skill of skills) {
    copySkill(skill.sourceDir, path.join(staging, "skills", skill.directory));
  }

  let movedCurrent = false;
  try {
    if (fs.existsSync(pluginRoot)) {
      fs.renameSync(pluginRoot, backup);
      movedCurrent = true;
    }
    fs.renameSync(staging, pluginRoot);
    fs.rmSync(backup, { recursive: true, force: true });
    if (!pluginIsCurrent(pluginRoot, revision, skills)) throw new Error("内置技能运行目录校验失败。");
    return pluginRoot;
  } catch (error) {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    if (movedCurrent && fs.existsSync(backup)) fs.renameSync(backup, pluginRoot);
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export function createBundledSkillProvisioner(
  options: BundledSkillProvisionerOptions,
): BundledSkillRuntime {
  const configDir = path.resolve(options.configDir);
  let skills: BundledSkillDefinition[] = [];
  let discoveryError: unknown;
  try {
    skills = discoverBundledSkills(options.bundledRoot);
  } catch (error) {
    discoveryError = error;
  }
  let state: BundledSkillRuntimeSnapshot = discoveryError
    ? { status: "error", error: userFacingError(discoveryError), skills }
    : { status: "preparing", skills };
  let inFlight: Promise<BundledSkillRuntimeSnapshot> | undefined;

  const prepare = async (): Promise<BundledSkillRuntimeSnapshot> => {
    if (discoveryError) return state;
    state = { status: "preparing", skills };
    try {
      const revision = revisionFor(skills);
      const pluginPath = materialize(configDir, revision, skills);
      state = { status: "ready", pluginPath, revision, skills };
    } catch (error: unknown) {
      state = { status: "error", error: userFacingError(error), skills };
    }
    return state;
  };

  return {
    snapshot: () => ({ ...state, skills: [...state.skills] }),
    ensureReady: () => {
      if (state.status === "ready" || discoveryError) return Promise.resolve({ ...state, skills: [...state.skills] });
      inFlight ??= prepare().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
