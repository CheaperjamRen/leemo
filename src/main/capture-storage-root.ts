import path from "node:path";

export interface CaptureStorageRootResolution {
  root: string;
  usedDefault: boolean;
}

export function defaultCaptureStorageRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, ".leemo", "files");
}

export function resolveCaptureStorageRoot(
  settings: Readonly<Record<string, unknown>>,
  workspaceRoot: string,
): CaptureStorageRootResolution {
  const value = settings.captureStorageRoot;
  if (typeof value === "string" && value.trim() && path.isAbsolute(value.trim())) {
    return { root: path.resolve(value.trim()), usedDefault: false };
  }
  return { root: defaultCaptureStorageRoot(workspaceRoot), usedDefault: true };
}
