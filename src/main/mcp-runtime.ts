import path from "node:path";
import type { BuiltinMcpRuntime } from "../host/mcp-config";

export interface PlaywrightRuntimeInputs {
  packageJsonPath: string;
  executablePath: string;
  dataDir: string;
  browser: "chrome" | "msedge";
}

export interface ComputerRuntimeInputs {
  executablePath: string;
}

export interface ComputerExecutableInputs {
  isPackaged: boolean;
  resourcesPath: string;
  moduleDir: string;
}

/** Build a no-external-Node runtime. Electron re-enters itself as Node for the
 * bundled CLI; Playwright then launches the user's installed Chrome/Edge. */
export function buildPlaywrightMcpRuntime(inputs: PlaywrightRuntimeInputs): BuiltinMcpRuntime {
  const packageDir = path.dirname(inputs.packageJsonPath);
  return {
    playwright: {
      type: "stdio",
      command: inputs.executablePath,
      args: [
        path.join(packageDir, "cli.js"),
        "--browser", inputs.browser,
        "--user-data-dir", path.join(inputs.dataDir, "browser-profile"),
        "--output-dir", path.join(inputs.dataDir, "browser-output"),
        "--caps", "vision,pdf,devtools",
        "--viewport-size", "1280x800",
      ],
      env: { ELECTRON_RUN_AS_NODE: "1" },
      timeout: 60_000,
    },
  };
}

/** The Windows runtime is a verified self-contained executable. It intentionally
 * has no npm, Python, or globally installed .NET dependency at user runtime. */
export function buildComputerMcpRuntime(inputs: ComputerRuntimeInputs): BuiltinMcpRuntime {
  return {
    computer: {
      type: "stdio",
      command: inputs.executablePath,
      args: [],
      timeout: 30_000,
    },
  };
}

export function resolveComputerMcpExecutable(inputs: ComputerExecutableInputs): string {
  return inputs.isPackaged
    ? path.join(inputs.resourcesPath, "windows-mcp", "Sbroenne.WindowsMcp.exe")
    : path.resolve(inputs.moduleDir, "..", "bundled-runtime", "windows-mcp", "release", "Sbroenne.WindowsMcp.exe");
}

export function detectBrowserChannel(
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): "chrome" | "msedge" {
  const candidates = [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.some(exists) ? "chrome" : "msedge";
}
