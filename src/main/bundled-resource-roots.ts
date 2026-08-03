import path from "node:path";

export function resolveBundledSkillRoot(options: {
  packaged: boolean;
  appPath: string;
  mainDirectory: string;
}): string {
  return options.packaged
    ? path.join(options.appPath, "bundled-skills")
    : path.resolve(options.mainDirectory, "..", "bundled-skills");
}

export function resolveOfficeBundleRoot(options: {
  packaged: boolean;
  appPath: string;
  mainDirectory: string;
}): string {
  return options.packaged
    ? path.join(options.appPath, "bundled-skills", "office", "release")
    : path.resolve(options.mainDirectory, "..", "bundled-skills", "office", "release");
}
