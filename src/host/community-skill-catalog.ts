import { COMMUNITY_SKILL_CATALOG } from "./community-skill-catalog.generated";
import type { SkillCategory } from "../bridge/contract";

export interface CommunitySkillFile {
  path: string;
  /** Defaults to `<upstreamPath>/<path>`. Used for the repository license,
   * which is installed beside the Skill as LICENSE.upstream. */
  sourcePath?: string;
  bytes: number;
  sha256: string;
}

interface CommunitySkillCatalogBase {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  category: string;
  categoryLabel: string;
  featured: boolean;
  author: string;
  repository: string;
  revision: string;
  upstreamPath: string;
  license: "MIT" | "Apache-2.0";
  licenseUrl: string;
  sourceUrl: string;
  /** Honest one-time runtime/account prerequisite shown before installation. */
  setupMessage?: string;
  files: readonly CommunitySkillFile[];
}

export interface CommunitySkillCatalogFamilyMember {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  /** Repository-relative path retained for family installation and discovery. */
  upstreamPath: string;
  category?: SkillCategory;
  categoryLabel?: string;
}

export interface CommunitySkillCatalogSkillEntry extends CommunitySkillCatalogBase {
  /** Older generated entries omit this field and remain ordinary Skills. */
  kind?: "skill";
  memberCount?: never;
  members?: never;
}

export interface CommunitySkillCatalogFamilyEntry extends CommunitySkillCatalogBase {
  kind: "family";
  memberCount: number;
  members: readonly CommunitySkillCatalogFamilyMember[];
}

export type CommunitySkillCatalogEntry =
  | CommunitySkillCatalogSkillEntry
  | CommunitySkillCatalogFamilyEntry;

export { COMMUNITY_SKILL_CATALOG };

export function communityCatalogEntry(idOrName: string): CommunitySkillCatalogEntry | undefined {
  const key = idOrName.trim().toLocaleLowerCase();
  return COMMUNITY_SKILL_CATALOG.find((entry) => entry.id.toLocaleLowerCase() === key || entry.name.toLocaleLowerCase() === key);
}
