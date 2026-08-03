import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function verifyElectronRuntime(root) {
  const electronRoot = path.join(root, "node_modules", "electron");
  const packageFile = path.join(electronRoot, "package.json");
  const dist = path.join(electronRoot, "dist");
  const executable = path.join(dist, "electron.exe");
  const versionFile = path.join(dist, "version");

  if (!fs.existsSync(packageFile) || !fs.existsSync(executable) || !fs.existsSync(versionFile)) {
    throw new Error(
      "缺少本地 Electron 运行时。请先运行 npm ci，确认 node_modules/electron/dist/electron.exe 已安装后再打包。",
    );
  }

  const packageVersion = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;
  const distVersion = fs.readFileSync(versionFile, "utf8").trim();
  if (typeof packageVersion !== "string" || packageVersion !== distVersion) {
    throw new Error(
      `Electron 运行时版本不一致：依赖是 ${String(packageVersion)}，dist 是 ${distVersion || "未知"}。请重新运行 npm ci。`,
    );
  }

  return distVersion;
}

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(argumentValue("--root") ?? defaultRoot);

try {
  const version = verifyElectronRuntime(root);
  console.log(`[verify-electron-runtime] Electron ${version} 本地运行时可用。`);
} catch (error) {
  console.error(`[verify-electron-runtime] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
