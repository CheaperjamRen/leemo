import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SUPERPOWERS_PLUGIN_NAME,
  discoverSuperpowersSkills,
  verifySuperpowersPayload,
  type SuperpowersSkillDefinition,
  type SuperpowersSkillRuntime,
  type SuperpowersSkillRuntimeSnapshot,
  type VerifiedSuperpowersPayloadFile,
} from "../host/superpowers-skills";

export interface SuperpowersSkillProvisionerOptions {
  configDir: string;
  bundledRoot: string;
}

const FORBIDDEN_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  "node_modules",
]);
const RETRYABLE_RENAME_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const RENAME_RETRY_DELAYS_MS = [20, 50, 100, 200] as const;

async function renameWithShortRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (error: unknown) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (typeof code !== "string"
          || !RETRYABLE_RENAME_CODES.has(code)
          || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]);
      });
    }
  }
}

function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Superpowers")
    ? message
    : "Superpowers 开发方法套件暂时不可用，稍后会自动重试。";
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function visitFiles(
  root: string,
  onFile: (file: string, relative: string, info: fs.Stats) => void,
): void {
  const realRoot = fs.realpathSync.native(root);
  const visit = (directory: string, relativeRoot: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`Superpowers 离线包不允许包含链接：${relative}`);
      }
      if (info.isDirectory()) {
        const lower = entry.name.toLocaleLowerCase();
        if (FORBIDDEN_DIRECTORIES.has(lower) || lower.includes("staging")) {
          throw new Error(`Superpowers 离线包不允许包含缓存、依赖或 staging 目录：${relative}`);
        }
        const realDirectory = fs.realpathSync.native(absolute);
        if (!within(realRoot, realDirectory)) {
          throw new Error(`Superpowers 离线包目录越过了 release 边界：${relative}`);
        }
        visit(realDirectory, relative);
      } else if (info.isFile()) {
        if (entry.name.toLocaleLowerCase().endsWith(".pyc")) {
          throw new Error(`Superpowers 离线包不允许包含 Python 缓存：${relative}`);
        }
        onFile(absolute, relative, info);
      } else {
        throw new Error(`Superpowers 离线包包含不支持的文件类型：${relative}`);
      }
    }
  };
  visit(realRoot, "");
}

function contentRevision(files: readonly VerifiedSuperpowersPayloadFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(String(file.bytes));
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
    hash.update(file.mode);
    hash.update("\0");
  }
  return `sha256-${hash.digest("hex").slice(0, 20)}`;
}

function pluginRootFor(configDir: string): string {
  return path.join(configDir, "runtime", SUPERPOWERS_PLUGIN_NAME);
}

function pluginIsCurrent(
  pluginRoot: string,
  revision: string,
  expectedFiles: readonly VerifiedSuperpowersPayloadFile[],
): boolean {
  try {
    const rootInfo = fs.lstatSync(pluginRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return false;
    const realRoot = fs.realpathSync.native(pluginRoot);
    const rootEntries = fs.readdirSync(realRoot).sort((left, right) => left.localeCompare(right, "en"));
    if (rootEntries.length !== 2 || rootEntries[0] !== ".claude-plugin" || rootEntries[1] !== "skills") {
      return false;
    }
    const manifestRoot = path.join(realRoot, ".claude-plugin");
    const manifestRootInfo = fs.lstatSync(manifestRoot);
    if (manifestRootInfo.isSymbolicLink() || !manifestRootInfo.isDirectory()) return false;
    const realManifestRoot = fs.realpathSync.native(manifestRoot);
    if (!within(realRoot, realManifestRoot)) return false;
    if (fs.readdirSync(realManifestRoot).join("\0") !== "plugin.json") return false;
    const manifestFile = path.join(pluginRoot, ".claude-plugin", "plugin.json");
    const manifestInfo = fs.lstatSync(manifestFile);
    if (manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) return false;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
    if (Object.keys(manifest).sort().join(",") !== "description,name,version"
        || manifest.name !== SUPERPOWERS_PLUGIN_NAME
        || manifest.description !== "Superpowers 开发方法套件"
        || manifest.version !== revision) {
      return false;
    }
    const skillRoot = path.join(realRoot, "skills");
    const skillRootInfo = fs.lstatSync(skillRoot);
    if (skillRootInfo.isSymbolicLink() || !skillRootInfo.isDirectory()) return false;
    const realSkillRoot = fs.realpathSync.native(skillRoot);
    if (!within(realRoot, realSkillRoot)) return false;

    const expectedSkillFiles = expectedFiles.filter((file) => file.path.startsWith("skills/"));
    const expectedDirectories = new Set<string>(["skills"]);
    for (const file of expectedSkillFiles) {
      let directory = path.posix.dirname(file.path);
      while (directory !== ".") {
        expectedDirectories.add(directory);
        directory = path.posix.dirname(directory);
      }
    }
    const actualDirectories = new Set<string>(["skills"]);
    const actualFiles: Array<{ path: string; absolute: string; info: fs.Stats }> = [];
    const visit = (directory: string, relativeRoot: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
        const absolute = path.join(directory, entry.name);
        const relative = `${relativeRoot}/${entry.name}`;
        const info = fs.lstatSync(absolute);
        if (info.isSymbolicLink()) throw new Error("linked runtime entry");
        if (info.isDirectory()) {
          const realDirectory = fs.realpathSync.native(absolute);
          if (!within(realRoot, realDirectory)) throw new Error("runtime directory escaped");
          actualDirectories.add(relative);
          visit(realDirectory, relative);
        } else if (info.isFile()) {
          actualFiles.push({ path: relative, absolute, info });
        } else {
          throw new Error("unsupported runtime entry");
        }
      }
    };
    visit(realSkillRoot, "skills");
    const actualDirectoryList = [...actualDirectories].sort((left, right) => left.localeCompare(right, "en"));
    const expectedDirectoryList = [...expectedDirectories].sort((left, right) => left.localeCompare(right, "en"));
    if (actualDirectoryList.length !== expectedDirectoryList.length
        || actualDirectoryList.some((directory, index) => directory !== expectedDirectoryList[index])) {
      return false;
    }
    if (actualFiles.length !== expectedSkillFiles.length) return false;
    for (let index = 0; index < actualFiles.length; index += 1) {
      const actual = actualFiles[index];
      const expected = expectedSkillFiles[index];
      if (actual.path !== expected.path || actual.info.size !== expected.bytes) return false;
      const data = fs.readFileSync(actual.absolute);
      if (data.byteLength !== expected.bytes
          || createHash("sha256").update(data).digest("hex") !== expected.sha256) {
        return false;
      }
      if (process.platform !== "win32"
          && ((actual.info.mode & 0o111) !== 0) !== (expected.mode === "100755")) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function copySkill(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  visitFiles(source, (file, relative, info) => {
    const destination = path.join(target, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
    fs.chmodSync(destination, info.mode & 0o777);
  });
}

async function materialize(
  configDir: string,
  revision: string,
  skills: readonly SuperpowersSkillDefinition[],
  expectedFiles: readonly VerifiedSuperpowersPayloadFile[],
): Promise<string> {
  const pluginRoot = pluginRootFor(configDir);
  const staging = `${pluginRoot}.staging`;
  const backup = `${pluginRoot}.backup`;
  fs.rmSync(staging, { recursive: true, force: true });
  if (pluginIsCurrent(pluginRoot, revision, expectedFiles)) {
    fs.rmSync(backup, { recursive: true, force: true });
    return pluginRoot;
  }
  if (pluginIsCurrent(backup, revision, expectedFiles)) {
    fs.rmSync(pluginRoot, { recursive: true, force: true });
    await renameWithShortRetry(backup, pluginRoot);
    if (!pluginIsCurrent(pluginRoot, revision, expectedFiles)) {
      throw new Error("Superpowers 开发方法套件 backup 恢复后校验失败。");
    }
    return pluginRoot;
  }
  if (fs.existsSync(backup)) {
    fs.rmSync(backup, { recursive: true, force: true });
  }

  let movedCurrent = false;
  let installedStaging = false;
  try {
    fs.mkdirSync(path.join(staging, ".claude-plugin"), { recursive: true });
    fs.mkdirSync(path.join(staging, "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(staging, ".claude-plugin", "plugin.json"),
      `${JSON.stringify({
        name: SUPERPOWERS_PLUGIN_NAME,
        description: "Superpowers 开发方法套件",
        version: revision,
      }, null, 2)}\n`,
      "utf8",
    );
    for (const skill of skills) {
      copySkill(skill.sourceDir, path.join(staging, "skills", skill.directory));
    }
    if (!pluginIsCurrent(staging, revision, expectedFiles)) {
      throw new Error("Superpowers 开发方法套件 staging 目录校验失败。");
    }

    if (fs.existsSync(pluginRoot)) {
      await renameWithShortRetry(pluginRoot, backup);
      movedCurrent = true;
    }
    await renameWithShortRetry(staging, pluginRoot);
    installedStaging = true;
    if (!pluginIsCurrent(pluginRoot, revision, expectedFiles)) {
      throw new Error("Superpowers 开发方法套件运行目录校验失败。");
    }
    fs.rmSync(backup, { recursive: true, force: true });
    return pluginRoot;
  } catch (error) {
    if (installedStaging) fs.rmSync(pluginRoot, { recursive: true, force: true });
    if (movedCurrent && fs.existsSync(backup) && !fs.existsSync(pluginRoot)) {
      await renameWithShortRetry(backup, pluginRoot);
    }
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function cloneSnapshot(snapshot: SuperpowersSkillRuntimeSnapshot): SuperpowersSkillRuntimeSnapshot {
  return { ...snapshot, skills: [...snapshot.skills] };
}

export function createSuperpowersSkillProvisioner(
  options: SuperpowersSkillProvisionerOptions,
): SuperpowersSkillRuntime {
  const configDir = path.resolve(options.configDir);
  let skills: SuperpowersSkillDefinition[] = [];
  let state: SuperpowersSkillRuntimeSnapshot;
  try {
    skills = discoverSuperpowersSkills(options.bundledRoot);
    state = { status: "preparing", skills };
  } catch (error) {
    state = { status: "error", error: userFacingError(error), skills };
  }
  let inFlight: Promise<SuperpowersSkillRuntimeSnapshot> | undefined;

  const prepare = async (): Promise<SuperpowersSkillRuntimeSnapshot> => {
    let payload: ReturnType<typeof verifySuperpowersPayload>;
    try {
      skills = discoverSuperpowersSkills(options.bundledRoot);
      payload = verifySuperpowersPayload(options.bundledRoot);
    } catch (error: unknown) {
      skills = [];
      state = { status: "error", error: userFacingError(error), skills };
      return cloneSnapshot(state);
    }
    state = { status: "preparing", skills };
    try {
      const revision = contentRevision(payload.files);
      const pluginPath = await materialize(configDir, revision, skills, payload.files);
      state = { status: "ready", pluginPath, revision, skills };
    } catch (error: unknown) {
      state = { status: "error", error: userFacingError(error), skills };
    }
    return cloneSnapshot(state);
  };

  return {
    snapshot: () => cloneSnapshot(state),
    ensureReady: () => {
      if (inFlight) return inFlight;
      if (state.status === "ready") return Promise.resolve(cloneSnapshot(state));
      inFlight = Promise.resolve().then(prepare).finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
