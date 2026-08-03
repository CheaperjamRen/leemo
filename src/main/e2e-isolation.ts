import fs from "node:fs";
import path from "node:path";

const FLAG = "--leemo-e2e-root=";
const WORKSPACE_FLAG = "--leemo-e2e-workspace=";
const ROOT_PREFIX = "leemo-e2e-";

export interface E2EIsolationPaths {
  root: string;
  home: string;
  userData: string;
  sessionData: string;
}

interface AppPathSetter {
  setPath(name: string, target: string): void;
}

function samePath(left: string, right: string): boolean {
  const a = path.normalize(left);
  const b = path.normalize(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function reject(target: string, detail: string): never {
  throw new Error(`拒绝 E2E 隔离路径 ${target}：${detail}`);
}

export function resolveE2EIsolationRoot(argv: string[], tempDirectory: string): string | undefined {
  const flags = argv.filter((argument) => argument.startsWith(FLAG));
  if (flags.length === 0) return undefined;
  if (flags.length > 1) throw new Error("--leemo-e2e-root 只能传一次");

  const supplied = flags[0]!.slice(FLAG.length).trim();
  if (!supplied) reject("(empty)", "路径不能为空");
  const resolved = path.resolve(supplied);

  let info: fs.Stats;
  try {
    info = fs.lstatSync(resolved);
  } catch {
    reject(resolved, "目录不存在");
  }
  if (info.isSymbolicLink()) reject(resolved, "符号链接不允许");
  if (!info.isDirectory()) reject(resolved, "目标不是目录");

  const canonicalRoot = fs.realpathSync(resolved);
  const canonicalTemp = fs.realpathSync(tempDirectory);
  if (
    !samePath(path.dirname(canonicalRoot), canonicalTemp)
    || !path.basename(canonicalRoot).startsWith(ROOT_PREFIX)
  ) {
    reject(canonicalRoot, `必须是 ${canonicalTemp} 下以 ${ROOT_PREFIX} 开头的一级目录`);
  }
  return canonicalRoot;
}

/**
 * Controlled replacement for the native folder picker in packaged acceptance.
 * It is deliberately unusable without the stronger temp-root isolation flag,
 * and can only name a real, non-symlinked descendant of that one run's root.
 */
export function resolveE2EWorkspaceCandidate(
  argv: string[],
  isolationRoot: string | undefined,
): string | undefined {
  const flags = argv.filter((argument) => argument.startsWith(WORKSPACE_FLAG));
  if (flags.length === 0) return undefined;
  if (flags.length > 1) throw new Error("--leemo-e2e-workspace 只能传一次");
  if (!isolationRoot) throw new Error("--leemo-e2e-workspace 只能和 --leemo-e2e-root 一起使用");

  const supplied = flags[0]!.slice(WORKSPACE_FLAG.length).trim();
  if (!supplied) reject("(empty)", "工作区路径不能为空");
  const resolved = path.resolve(supplied);
  let info: fs.Stats;
  try {
    info = fs.lstatSync(resolved);
  } catch {
    reject(resolved, "工作区目录不存在");
  }
  if (info.isSymbolicLink()) reject(resolved, "工作区符号链接不允许");
  if (!info.isDirectory()) reject(resolved, "工作区目标不是目录");

  const canonicalRoot = fs.realpathSync(isolationRoot);
  const canonicalCandidate = fs.realpathSync(resolved);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    reject(canonicalCandidate, "工作区必须位于本次 E2E 隔离目录内");
  }
  return canonicalCandidate;
}

function ensurePrivateDirectory(target: string): void {
  if (fs.existsSync(target)) {
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink() || !info.isDirectory()) reject(target, "隔离子目录必须是普通目录");
    return;
  }
  fs.mkdirSync(target);
}

export function applyE2EIsolationFromArgv(
  app: AppPathSetter,
  argv: string[],
  tempDirectory: string,
): E2EIsolationPaths | undefined {
  const root = resolveE2EIsolationRoot(argv, tempDirectory);
  if (!root) return undefined;

  const paths: E2EIsolationPaths = {
    root,
    home: path.join(root, "home"),
    userData: path.join(root, "user-data"),
    sessionData: path.join(root, "session-data"),
  };
  ensurePrivateDirectory(paths.home);
  ensurePrivateDirectory(paths.userData);
  ensurePrivateDirectory(paths.sessionData);

  app.setPath("home", paths.home);
  app.setPath("userData", paths.userData);
  app.setPath("sessionData", paths.sessionData);
  return paths;
}
