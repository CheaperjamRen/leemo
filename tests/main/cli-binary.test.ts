// 轮 5 打包：打包后到哪儿找原生 CLI。
//
// 这一格的价值全在一条上：asar 里的路径 `existsSync` **为真**但 `spawn` 必然失败。
// 所以"找到了"不等于"能用"，我们必须解到 app.asar.unpacked 那份真文件。
// 下面的假 probe 刻意让 asar 内的路径也 exists=true，钉住我们没有挑错那一个。
import { describe, it, expect } from "vitest";
import {
  resolveCliBinary,
  platformPackage,
  binaryName,
  type CliBinaryProbe,
} from "../../src/main/cli-binary";

/** 用 POSIX 分隔符拼，断言里好读；真实现用 path.join。 */
function probeOf(present: string[], onError?: string): CliBinaryProbe {
  const set = new Set(present);
  return {
    join: (...parts) => parts.join("/"),
    exists: (p) => {
      if (onError !== undefined && p === onError) throw new Error("EPERM");
      return set.has(p);
    },
  };
}

const R = "C:/app/resources";
const PKG = "@anthropic-ai/claude-agent-sdk-win32-x64";

describe("platformPackage / binaryName", () => {
  it("按 SDK 自己的命名规则拼平台包名", () => {
    expect(platformPackage("win32", "x64")).toBe("@anthropic-ai/claude-agent-sdk-win32-x64");
    expect(platformPackage("darwin", "arm64")).toBe("@anthropic-ai/claude-agent-sdk-darwin-arm64");
  });

  it("只有 win32 带 .exe", () => {
    expect(binaryName("win32")).toBe("claude.exe");
    expect(binaryName("darwin")).toBe("claude");
    expect(binaryName("linux")).toBe("claude");
  });
});

describe("resolveCliBinary", () => {
  it("dev 态返回 undefined 且**完全不碰文件系统** —— 那时 SDK 自己解得对，抢这个活只会解错", () => {
    let touched = 0;
    const probe: CliBinaryProbe = {
      join: (...p) => p.join("/"),
      exists: () => {
        touched++;
        return true;
      },
    };
    const got = resolveCliBinary({
      packaged: false,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe,
    });
    expect(got).toBeUndefined();
    expect(touched).toBe(0);
  });

  it("打包态解到 app.asar.unpacked 下那份真文件", () => {
    const want = `${R}/app.asar.unpacked/node_modules/${PKG}/claude.exe`;
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe: probeOf([want]),
    });
    expect(got).toBe(want);
  });

  it("asar 内路径 exists 为真时**仍然**选 unpacked 那份（本卡的核心判据）", () => {
    // 这正是 Electron 的真实行为：fs 被打了 asar 补丁，asar 里的路径 exists=true。
    // 挑错了就是"装完能开窗、一发消息 spawn 失败"。
    const inAsar = `${R}/app.asar/node_modules/${PKG}/claude.exe`;
    const unpacked = `${R}/app.asar.unpacked/node_modules/${PKG}/claude.exe`;
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe: probeOf([inAsar, unpacked]),
    });
    expect(got).toBe(unpacked);
    expect(got).not.toContain("app.asar/");
  });

  it("asar 关掉时落到 app/node_modules（换配置不用改这里）", () => {
    const want = `${R}/app/node_modules/${PKG}/claude.exe`;
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe: probeOf([want]),
    });
    expect(got).toBe(want);
  });

  it("extraResources 式布局兜底", () => {
    const want = `${R}/node_modules/${PKG}/claude.exe`;
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe: probeOf([want]),
    });
    expect(want).toBe(got);
  });

  it("一个都不在时返回 undefined，不抛 —— 抛在启动阶段会变成整个 App 起不来", () => {
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe: probeOf([]),
    });
    expect(got).toBeUndefined();
  });

  it("某个候选探测抛错不影响后面的候选", () => {
    const boom = `${R}/app.asar.unpacked/node_modules/${PKG}/claude.exe`;
    const want = `${R}/app/node_modules/${PKG}/claude.exe`;
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "win32",
      arch: "x64",
      probe: probeOf([want], boom),
    });
    expect(got).toBe(want);
  });

  it("mac/arm64 走对应的平台包与无后缀二进制名", () => {
    const want = `${R}/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`;
    const got = resolveCliBinary({
      packaged: true,
      resourcesPath: R,
      platform: "darwin",
      arch: "arm64",
      probe: probeOf([want]),
    });
    expect(got).toBe(want);
  });
});
