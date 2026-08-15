import fs from "node:fs";
import path from "node:path";
import type { SkillInfo } from "../bridge/contract";
import { parseSkillFrontmatterFields } from "./skill-frontmatter";

export const BUNDLED_SKILL_PLUGIN_NAME = "leemo-library";

const GROUPS = [
  { directory: "default-enabled", label: "默认启用", defaultEnabled: true },
  { directory: "optional", label: "按需启用", defaultEnabled: false },
] as const;

const FORBIDDEN_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);

interface SkillHeader {
  name: string;
  description: string;
  category?: string;
  categoryLabel?: string;
}

interface BundledCatalogEntry {
  displayName?: string;
  description?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  repository?: string;
  revision?: string;
  license?: string;
  category?: string;
  categoryLabel?: string;
  setupMessage?: string;
}

interface BundledCatalog {
  version?: number;
  skills?: Record<string, BundledCatalogEntry>;
}

export interface BundledSkillDefinition extends SkillInfo {
  id: `bundled:${string}`;
  directory: string;
  sourceDir: string;
  source: "builtin";
  defaultEnabled: boolean;
  available: true;
}

export type BundledSkillRuntimeSnapshot =
  | { status: "preparing"; skills: BundledSkillDefinition[] }
  | { status: "error"; error: string; skills: BundledSkillDefinition[] }
  | {
      status: "ready";
      pluginPath: string;
      revision: string;
      skills: BundledSkillDefinition[];
    };

export interface BundledSkillRuntime {
  snapshot(): BundledSkillRuntimeSnapshot;
  ensureReady(): Promise<BundledSkillRuntimeSnapshot>;
}

function cleanScalar(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  if (!clean || clean.length > maxLength || /[\u0000-\u001f]/u.test(clean)) return undefined;
  return clean;
}

function cleanDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  if (!clean || clean.length > 2_000 || /[\u0000-\u0009\u000b-\u001f]/u.test(clean)) return undefined;
  return clean;
}

function parseFrontmatter(raw: string, file: string): SkillHeader {
  const lines = raw.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") throw new Error(`${file} 缺少有效的 SKILL.md frontmatter。`);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new Error(`${file} 的 SKILL.md frontmatter 未闭合。`);
  const fields = parseSkillFrontmatterFields(raw) ?? {};
  const name = cleanScalar(fields.name, 64);
  const description = cleanDescription(fields.description);
  if (!name || name.includes(":")) throw new Error(`${file} 的 Skill name 无效。`);
  if (!description) throw new Error(`${file} 的 Skill description 不能为空。`);
  const category = cleanScalar(fields.category, 48);
  const categoryLabel = cleanScalar(fields["category-label"] ?? fields.category_label, 32);
  return {
    name,
    description,
    ...(category ? { category } : {}),
    ...(categoryLabel ? { categoryLabel } : {}),
  };
}

function readCatalog(root: string): Record<string, BundledCatalogEntry> {
  const file = path.join(root, "catalog.json");
  if (!fs.existsSync(file)) return {};
  let parsed: BundledCatalog;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as BundledCatalog;
  } catch {
    throw new Error("bundled-skills/catalog.json 不是有效 JSON。");
  }
  if (parsed.skills === undefined) return {};
  if (!parsed.skills || typeof parsed.skills !== "object" || Array.isArray(parsed.skills)) {
    throw new Error("bundled-skills/catalog.json 的 skills 必须是对象。");
  }
  return parsed.skills;
}

function catalogScalar(
  entry: BundledCatalogEntry | undefined,
  key: keyof BundledCatalogEntry,
  maxLength: number,
): string | undefined {
  return cleanScalar(entry?.[key], maxLength);
}

export function discoverBundledSkills(rootPath: string): BundledSkillDefinition[] {
  const root = path.resolve(rootPath);
  const catalog = readCatalog(root);
  const found: BundledSkillDefinition[] = [];
  const directories = new Set<string>();
  const triggerNames = new Set<string>();
  const displayNames = new Set<string>();

  for (const group of GROUPS) {
    const groupRoot = path.join(root, group.directory);
    if (!fs.existsSync(groupRoot) || !fs.statSync(groupRoot).isDirectory()) {
      throw new Error(`内置技能库缺少“${group.label}”目录：bundled-skills/${group.directory}`);
    }
    const entries = fs.readdirSync(groupRoot, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (FORBIDDEN_DIRECTORIES.has(entry.name)) {
        throw new Error(`内置 Skill 不允许包含目录：${entry.name}`);
      }
      const directoryKey = entry.name.toLocaleLowerCase();
      if (directories.has(directoryKey)) throw new Error(`内置 Skill 目录名重复：${entry.name}`);
      directories.add(directoryKey);

      const sourceDir = path.join(groupRoot, entry.name);
      const skillFile = path.join(sourceDir, "SKILL.md");
      if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
        throw new Error(`${group.label}/${entry.name} 缺少 SKILL.md。`);
      }
      const header = parseFrontmatter(fs.readFileSync(skillFile, "utf8"), skillFile);
      const triggerKey = header.name.toLocaleLowerCase();
      if (triggerNames.has(triggerKey)) throw new Error(`内置 Skill 触发名重复：${header.name}`);
      triggerNames.add(triggerKey);

      const metadata = catalog[entry.name];
      const displayName = catalogScalar(metadata, "displayName", 64) ?? header.name;
      if (displayName.includes(":")) throw new Error(`${entry.name} 的展示名称无效。`);
      const displayKey = displayName.toLocaleLowerCase();
      if (displayNames.has(displayKey)) throw new Error(`内置 Skill 展示名称重复：${displayName}`);
      displayNames.add(displayKey);
      const description = catalogScalar(metadata, "description", 240) ?? header.description;
      const category = catalogScalar(metadata, "category", 48) ?? header.category ?? "other";
      const categoryLabel = catalogScalar(metadata, "categoryLabel", 32)
        ?? header.categoryLabel
        ?? (category === "other" ? "其他" : category);
      const sourceLabel = catalogScalar(metadata, "sourceLabel", 64) ?? "Leemo 精选";
      const sourceUrl = catalogScalar(metadata, "sourceUrl", 500);
      const repository = catalogScalar(metadata, "repository", 200);
      const revision = catalogScalar(metadata, "revision", 120);
      const license = catalogScalar(metadata, "license", 80);
      const setupMessage = catalogScalar(metadata, "setupMessage", 500);

      found.push({
        id: `bundled:${entry.name}`,
        directory: entry.name,
        sourceDir,
        name: displayName,
        commandName: header.name,
        description,
        qualifiedName: `${BUNDLED_SKILL_PLUGIN_NAME}:${header.name}`,
        source: "builtin",
        category,
        categoryLabel,
        defaultEnabled: group.defaultEnabled,
        available: true,
        trust: "leemo",
        sourceKind: "leemo",
        sourceLabel,
        scanStatus: "scanned",
        canRemove: false,
        canUpdate: false,
        ...(setupMessage ? { setupRequired: true, setupMessage } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(repository ? { repository } : {}),
        ...(revision ? { revision } : {}),
        ...(license ? { license } : {}),
      });
    }
  }

  const catalogDirectories = Object.keys(catalog);
  for (const directory of catalogDirectories) {
    if (!directories.has(directory.toLocaleLowerCase())) {
      throw new Error(`bundled-skills catalog 引用了不存在的目录：${directory}`);
    }
  }
  return found;
}

export function bundledSkillMetadata(snapshot: BundledSkillRuntimeSnapshot): SkillInfo[] {
  const available = snapshot.status === "ready";
  const unavailableReason = snapshot.status === "preparing"
    ? "正在准备内置技能，稍后即可使用。"
    : snapshot.status === "error"
      ? snapshot.error
      : undefined;
  return snapshot.skills.map(({ directory: _directory, sourceDir: _sourceDir, ...skill }) => ({
    ...skill,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  }));
}
