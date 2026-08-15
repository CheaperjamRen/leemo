import path from "node:path";

export interface AboutRuntimeInfo {
  version: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

export interface AboutInfo extends AboutRuntimeInfo {
  diagnostics: string;
}

export type AboutIpcResult =
  | { ok: true; response: AboutInfo }
  | { ok: true }
  | { ok: false; error: string };

export interface AboutIpcDependencies {
  isAuthorized(sender: unknown): boolean;
  getInfo(): AboutRuntimeInfo;
  getLogsDirectory(): string;
  ensureDirectory(directory: string): Promise<void>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  openPath(target: string): Promise<string>;
}

function diagnosticSummary(info: AboutRuntimeInfo): string {
  return [
    `Leemo ${info.version}`,
    `平台: ${info.platform}`,
    `架构: ${info.arch}`,
    `运行方式: ${info.packaged ? "已打包" : "开发模式"}`,
  ].join("\n");
}

function aboutInfo(dependencies: AboutIpcDependencies): AboutInfo {
  const info = dependencies.getInfo();
  return { ...info, diagnostics: diagnosticSummary(info) };
}

export function createAboutIpcHandler(dependencies: AboutIpcDependencies) {
  return async (sender: unknown, request: unknown): Promise<AboutIpcResult> => {
    if (!dependencies.isAuthorized(sender)) {
      return { ok: false, error: "无法确认设置窗口身份。" };
    }
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return { ok: false, error: "关于信息请求格式不正确。" };
    }

    const operation = (request as { op?: unknown }).op;
    if (operation === "getInfo") {
      try {
        return { ok: true, response: aboutInfo(dependencies) };
      } catch {
        return { ok: false, error: "诊断信息读取失败，请稍后重试。" };
      }
    }
    if (operation !== "openLogsDirectory") {
      return { ok: false, error: "未知的关于信息操作。" };
    }

    try {
      const directory = dependencies.getLogsDirectory();
      const summary = `${diagnosticSummary(dependencies.getInfo())}\n`;
      await dependencies.ensureDirectory(directory);
      await dependencies.writeTextFile(path.join(directory, "Leemo-diagnostics.txt"), summary);
      const openError = await dependencies.openPath(directory);
      return openError
        ? { ok: false, error: "日志文件夹没有打开，请稍后重试。" }
        : { ok: true };
    } catch {
      // Filesystem errors often include absolute paths. Keep them in main and
      // return only a stable user-facing message to the renderer.
      return { ok: false, error: "日志文件夹没有打开，请稍后重试。" };
    }
  };
}
