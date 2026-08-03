// 轮 5 打包：把"打包产物能不能显示出来"钉成测试。
//
// 这两格都来自实机抓到的真 bug / 真约束，不是形式主义：
//
// ① `base: "./"`。默认的 `"/"` 会让产物写 `<script src="/assets/index-xxx.js">`，
//    而打包后渲染端是 file:// 加载 —— `/assets/…` 在 file: 下解成**文件系统根**，
//    JS/CSS 双双 404。症状是纯白窗口 + `readyState:"complete"` + **控制台零错误**，
//    dev 下永远看不见（那时 http://localhost:5173/ 在供货）。第一个安装包就是这样
//    白屏的，靠实机验收才抓到。
//
// ② 原生 CLI 与 better-sqlite3 必须在 asarUnpack 里。asar 是一个大文件里的虚拟
//    文件系统：`existsSync` 为真，`spawn`/`dlopen` 却必然失败。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");

describe("vite 产物路径（打包后 file:// 能加载）", () => {
  it("vite.config.ts 必须设 base 为相对路径", () => {
    const src = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");
    // 只认相对基址。写死字符串比 import 配置轻，也不需要把插件都加载起来。
    expect(src).toMatch(/base:\s*["']\.\/?["']/);
  });

  it("开发服务器不监听安装包产物", () => {
    const src = fs.readFileSync(path.join(root, "vite.config.ts"), "utf8");
    // electron-builder 会生成 Chromium 的锁定文件；Windows 上 Chokidar
    // 触碰它们会抛 EBUSY，并让整个 Vite 进程退出。
    expect(src).toMatch(/dist-package\*\/\*\*/);
  });

  it("如果 dist/index.html 已构建，它引用的资源必须是相对路径", () => {
    const indexPath = path.join(root, "dist", "index.html");
    if (!fs.existsSync(indexPath)) return; // 没构建就跳过，不制造假失败
    const html = fs.readFileSync(indexPath, "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    const absolute = refs.filter((r) => r.startsWith("/"));
    expect(absolute, `这些资源是绝对路径，file:// 下会 404：${absolute.join(", ")}`).toEqual([]);
    // 至少得真有一个 assets 引用，否则这条断言可能只是在空数组上通过。
    expect(refs.some((r) => r.includes("assets/"))).toBe(true);
  });
});

describe("electron-builder 配置（原生件必须摊在 asar 外）", () => {
  const yml = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");

  it("复用 npm 已安装的 Electron 运行时，不在打包时重复联网下载", () => {
    expect(yml).toMatch(/electronDist:\s*node_modules\/electron\/dist/);
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["electron:pack:base"]).toContain("verify:electron-runtime");
  });

  it("原生 CLI 的平台包在 asarUnpack 里", () => {
    expect(yml).toMatch(/asarUnpack:/);
    expect(yml).toMatch(/claude-agent-sdk-win32-x64/);
  });

  it("把 Office 源包放进 ASAR，首次启动再展开，不产生数百个 loose 文件", () => {
    expect(yml).toMatch(/files:[\s\S]*bundled-skills\/office\/release\/\*\*\/\*/u);
    expect(yml).not.toMatch(/extraResources:[\s\S]*from:\s*bundled-skills\/office/u);
    expect(fs.existsSync(path.join(root, "bundled-skills", "office", "README.md"))).toBe(true);
  });

  it("把开发者精选技能装入 ASAR，而不是新增 loose extraResources", () => {
    expect(yml).toMatch(/files:[\s\S]*bundled-skills\/default-enabled\/\*\*\/\*/u);
    expect(yml).toMatch(/files:[\s\S]*bundled-skills\/optional\/\*\*\/\*/u);
    expect(yml).toMatch(/files:[\s\S]*bundled-skills\/catalog\.json/u);
    expect(yml).not.toMatch(/extraResources:[\s\S]*from:\s*bundled-skills\/(?:default-enabled|optional)/u);
  });

  it("better-sqlite3 在 asarUnpack 里（.node 要 dlopen）", () => {
    expect(yml).toMatch(/better-sqlite3/);
  });

  it("把哈希固定的单文件 Windows 操作组件放进 extraResources", () => {
    expect(yml).toMatch(/extraResources:[\s\S]*from:\s*bundled-runtime\/windows-mcp\/release/u);
    expect(yml).toMatch(/to:\s*windows-mcp/u);
    expect(fs.existsSync(path.join(root, "bundled-runtime", "windows-mcp", "release", "Sbroenne.WindowsMcp.exe"))).toBe(true);
    expect(fs.existsSync(path.join(root, "bundled-runtime", "windows-mcp", "release", "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "bundled-runtime", "windows-mcp", "release", "LICENSE.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toMatch(/verify:computer-runtime/);
  });

  it("win 目标产出 nsis 安装包", () => {
    expect(yml).toMatch(/nsis/);
  });

  it("productName 是 Leemo（userData 目录名与加密件作用域都跟着它）", () => {
    expect(yml).toMatch(/productName:\s*Leemo/);
  });

  it("Windows 安装包使用 Leemo 自己的图标，而不是 Electron 默认图标", () => {
    expect(yml).toMatch(/icon:\s*build\/icon\.svg/);
    expect(fs.existsSync(path.join(root, "build", "icon.svg"))).toBe(true);
  });
});

describe("生产依赖边界（renderer 已被 Vite 打包，不重复塞进 asar）", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("仅构建期或开发网关使用的包留在 devDependencies", () => {
    const buildOnly = [
      "json5",
      "jsonrepair",
      "pdfjs-dist",
      "docx",
      "pptxgenjs",
      "fflate",
      "fast-xml-parser",
      "react",
      "react-dom",
      "react-markdown",
      "remark-gfm",
      "uuid",
      "zustand",
    ];
    for (const name of buildOnly) {
      expect(packageJson.dependencies?.[name], `${name} 不应重复进入生产 asar`).toBeUndefined();
      expect(packageJson.devDependencies?.[name], `${name} 仍需供本地构建/测试使用`).toBeTruthy();
    }
  });

  it("主进程运行时依赖仍留在 dependencies", () => {
    const runtime = [
      "@anthropic-ai/claude-agent-sdk",
      "@modelcontextprotocol/sdk",
      "@playwright/mcp",
      "better-sqlite3",
      "gpt-tokenizer",
      "zod",
    ];
    for (const name of runtime) {
      expect(packageJson.dependencies?.[name], `${name} 必须随安装包发布`).toBeTruthy();
    }
  });
});
