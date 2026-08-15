import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  hasExternalGeminiLogin,
  launchExternalGeminiLogin,
  resolveExternalGeminiCli,
  type SpawnDetached,
  type GeminiCliProbe,
} from "../../src/main/gemini-cli";

function probeOf(existing: string[], files: Record<string, string> = {}): GeminiCliProbe {
  const normalized = new Set(existing.map((value) => path.win32.normalize(value).toLowerCase()));
  return {
    exists: vi.fn((candidate: string) => {
      return normalized.has(path.win32.normalize(candidate).toLowerCase());
    }),
    readText: vi.fn((candidate: string) => {
      const match = Object.entries(files).find(([key]) =>
        path.win32.normalize(key).toLowerCase() === path.win32.normalize(candidate).toLowerCase());
      if (!match) throw new Error("missing");
      return match[1];
    }),
    join: path.win32.join,
  };
}

describe("external Gemini CLI discovery", () => {
  it("resolves the user's npm-installed CLI through node without bundling it", () => {
    const appData = "C:\\Users\\me\\AppData\\Roaming";
    const script = path.win32.join(
      appData,
      "npm",
      "node_modules",
      "@google",
      "gemini-cli",
      "bundle",
      "gemini.js",
    );
    expect(resolveExternalGeminiCli({
      platform: "win32",
      env: { APPDATA: appData, PATH: "C:\\Windows\\System32" },
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      probe: probeOf([script]),
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      argsPrefix: [script],
      source: "npm",
    });
  });

  it("accepts an explicit user-owned executable but never searches app resources", () => {
    const executable = "D:\\Tools\\gemini.exe";
    const probe = probeOf([executable]);
    expect(resolveExternalGeminiCli({
      platform: "win32",
      env: { LEEMO_GEMINI_CLI_PATH: executable, PATH: "E:\\Leemo\\resources" },
      nodeExecutable: "node.exe",
      probe,
    })).toEqual({ command: executable, argsPrefix: [], source: "override" });
    expect(probe.exists).not.toHaveBeenCalledWith(expect.stringMatching(/resources.*gemini/i));
  });

  it("returns undefined when only a command shim or bundled-looking path exists", () => {
    const root = "E:\\Leemo\\resources";
    expect(resolveExternalGeminiCli({
      platform: "win32",
      env: { PATH: root },
      nodeExecutable: "node.exe",
      resourcesPath: root,
      probe: probeOf([
        path.win32.join(root, "gemini.cmd"),
        path.win32.join(root, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js"),
      ]),
    })).toBeUndefined();
  });
});

describe("external Gemini login marker", () => {
  it("recognizes a locally selected Google login without reading account contents", () => {
    const home = "C:\\Users\\me";
    const settings = path.win32.join(home, ".gemini", "settings.json");
    const accounts = path.win32.join(home, ".gemini", "google_accounts.json");
    const probe = probeOf([settings, accounts], {
      [settings]: JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }),
    });
    expect(hasExternalGeminiLogin({ env: { USERPROFILE: home }, probe })).toBe(true);
    expect(probe.readText).toHaveBeenCalledTimes(1);
    expect(probe.readText).not.toHaveBeenCalledWith(accounts);
  });

  it("fails closed for a missing, malformed, or API-key login", () => {
    const home = "C:\\Users\\me";
    const settings = path.win32.join(home, ".gemini", "settings.json");
    const accounts = path.win32.join(home, ".gemini", "google_accounts.json");
    expect(hasExternalGeminiLogin({
      env: { USERPROFILE: home },
      probe: probeOf([settings, accounts], { [settings]: "not-json" }),
    })).toBe(false);
    expect(hasExternalGeminiLogin({
      env: { USERPROFILE: home },
      probe: probeOf([settings, accounts], {
        [settings]: JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }),
      }),
    })).toBe(false);
  });
});

describe("external Gemini login launcher", () => {
  it("opens the user-owned client in a separate Windows console", () => {
    const child = { unref: vi.fn() };
    const spawnDetached = vi.fn<SpawnDetached>(() => child);
    launchExternalGeminiLogin(
      {
        command: "C:\\Program Files\\Leemo\\Leemo.exe",
        argsPrefix: ["C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js"],
        source: "npm",
      },
      {
        platform: "win32",
        env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
        spawnDetached,
      },
    );
    expect(spawnDetached).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      expect.arrayContaining(["start", "C:\\Program Files\\Leemo\\Leemo.exe"]),
      expect.objectContaining({ detached: true, windowsHide: true, stdio: "ignore" }),
    );
    expect(spawnDetached.mock.calls[0]?.[2].env?.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
