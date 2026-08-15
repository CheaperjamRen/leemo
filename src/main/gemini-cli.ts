import path from "node:path";
import { spawn, type SpawnOptions } from "node:child_process";

export interface GeminiCliLaunch {
  command: string;
  argsPrefix: string[];
  source: "npm" | "executable" | "override";
}

export interface GeminiCliProbe {
  exists(path: string): boolean;
  readText(path: string): string;
  join(...parts: string[]): string;
}

export interface ResolveExternalGeminiCliOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  nodeExecutable: string;
  probe: Pick<GeminiCliProbe, "exists" | "join">;
  resourcesPath?: string;
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const separator = platform === "win32" ? ";" : ":";
  return (env.PATH ?? env.Path ?? env.path ?? "")
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function isInside(candidate: string, root: string | undefined, platform: NodeJS.Platform): boolean {
  if (!root) return false;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const normalizedCandidate = pathApi.resolve(candidate);
  const normalizedRoot = pathApi.resolve(root);
  const compareCandidate = platform === "win32" ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const compareRoot = platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  return compareCandidate === compareRoot || compareCandidate.startsWith(`${compareRoot}${pathApi.sep}`);
}

function launchFor(
  candidate: string,
  source: GeminiCliLaunch["source"],
  options: ResolveExternalGeminiCliOptions,
): GeminiCliLaunch | undefined {
  if (!options.probe.exists(candidate) || isInside(candidate, options.resourcesPath, options.platform)) {
    return undefined;
  }
  const ext = (options.platform === "win32" ? path.win32 : path.posix).extname(candidate).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { command: options.nodeExecutable, argsPrefix: [candidate], source };
  }
  if (options.platform === "win32" && ext !== ".exe") return undefined;
  return { command: candidate, argsPrefix: [], source };
}

/** Finds only user-owned installs. App resources are an explicit exclusion so
 * adding a provider can never silently grow the Leemo installer by a CLI. */
export function resolveExternalGeminiCli(
  options: ResolveExternalGeminiCliOptions,
): GeminiCliLaunch | undefined {
  const override = options.env.LEEMO_GEMINI_CLI_PATH?.trim();
  if (override) {
    const resolved = launchFor(override, "override", options);
    if (resolved) return resolved;
  }

  const roots = new Set(pathEntries(options.env, options.platform));
  if (options.platform === "win32" && options.env.APPDATA) {
    roots.add(options.probe.join(options.env.APPDATA, "npm"));
  }
  if (options.platform !== "win32" && options.env.NPM_CONFIG_PREFIX) {
    roots.add(options.probe.join(options.env.NPM_CONFIG_PREFIX, "bin"));
  }

  for (const root of roots) {
    const npmScript = options.platform === "win32"
      ? options.probe.join(root, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
      : options.probe.join(root, "..", "lib", "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
    const npmLaunch = launchFor(npmScript, "npm", options);
    if (npmLaunch) return npmLaunch;

    const executable = options.probe.join(root, options.platform === "win32" ? "gemini.exe" : "gemini");
    const executableLaunch = launchFor(executable, "executable", options);
    if (executableLaunch) return executableLaunch;
  }
  return undefined;
}

export interface ExternalGeminiLoginOptions {
  env: NodeJS.ProcessEnv;
  probe: GeminiCliProbe;
}

export interface DetachedChild {
  unref(): void;
}

export type SpawnDetached = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => DetachedChild;

export interface LaunchExternalGeminiLoginOptions {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  spawnDetached?: SpawnDetached;
}

/** The account file may contain personal information, so only its existence is
 * inspected. The selected auth method is the minimum non-secret state needed
 * to distinguish a Google subscription from an API-key configuration. */
export function hasExternalGeminiLogin(options: ExternalGeminiLoginOptions): boolean {
  const configuredHome = options.env.GEMINI_CLI_HOME?.trim();
  const userHome = options.env.USERPROFILE?.trim() || options.env.HOME?.trim();
  if (!configuredHome && !userHome) return false;
  const root = configuredHome ?? options.probe.join(userHome!, ".gemini");
  const settingsPath = options.probe.join(root, "settings.json");
  const accountsPath = options.probe.join(root, "google_accounts.json");
  if (!options.probe.exists(settingsPath) || !options.probe.exists(accountsPath)) return false;
  try {
    const parsed = JSON.parse(options.probe.readText(settingsPath)) as {
      security?: { auth?: { selectedType?: unknown } };
    };
    return parsed.security?.auth?.selectedType === "oauth-personal";
  } catch {
    return false;
  }
}

/** Opens the user's own Gemini client. On Windows `start` gives the interactive
 * login flow a real console; Leemo itself never receives the resulting token. */
export function launchExternalGeminiLogin(
  launch: GeminiCliLaunch,
  options: LaunchExternalGeminiLoginOptions,
): void {
  const spawnDetached = options.spawnDetached ?? (spawn as unknown as SpawnDetached);
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  if (launch.source === "npm") {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  const command = options.platform === "win32"
    ? options.env.ComSpec ?? options.env.COMSPEC ?? "cmd.exe"
    : launch.command;
  const args = options.platform === "win32"
    ? ["/d", "/s", "/c", "start", '"Gemini Login"', launch.command, ...launch.argsPrefix]
    : [...launch.argsPrefix];
  const child = spawnDetached(command, args, {
    detached: true,
    windowsHide: options.platform === "win32",
    stdio: "ignore",
    env,
  });
  child.unref();
}
