import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMUNITY_SKILL_CATALOG,
  communityCatalogEntry,
} from "../../src/host/community-skill-catalog";

interface CandidateRecord {
  competitor: "colaos" | "newmax" | "workbuddy";
  externalId: string;
  resolution: "included" | "duplicate" | "not-a-skill" | "private" | "license-unknown" | "origin-unresolved" | "runtime-blocked";
  catalogId?: string;
  installability?: "blocked-family-bundle";
  inventorySource?: string;
  observedScope?: string;
  reason: string;
}

interface SourceRecord {
  repository: string;
  revision: string;
  license: string;
  licensePath: string;
  entries: Array<{
    id: string;
    upstreamPath: string;
    kind?: "family";
    setupMessage?: string;
    members?: Array<{ id: string; upstreamPath: string; name: string; description: string }>;
  }>;
}

const root = path.resolve(__dirname, "..", "..");
const candidates = JSON.parse(fs.readFileSync(path.join(root, "community-skills", "candidates.json"), "utf8")) as CandidateRecord[];
const sources = JSON.parse(fs.readFileSync(path.join(root, "community-skills", "sources.json"), "utf8")) as SourceRecord[];

describe("community Skill catalog", () => {
  it("derives every card from one pinned approved-source registry", () => {
    const approvedEntries = sources.flatMap((source) => source.entries.map((entry) => ({ ...entry, source })));
    const approvedKeys = new Set(approvedEntries.map(({ source, upstreamPath }) => `${source.repository}:${upstreamPath}`));

    expect(sources.length).toBeGreaterThanOrEqual(9);
    expect(approvedEntries).toHaveLength(COMMUNITY_SKILL_CATALOG.length);
    expect(approvedKeys.size).toBe(approvedEntries.length);
    expect(COMMUNITY_SKILL_CATALOG.some((entry) => entry.repository === "obra/superpowers")).toBe(false);
    expect(sources.some((source) => source.repository === "obra/superpowers")).toBe(false);

    for (const source of sources) {
      expect(source.repository).toMatch(/^[^/\s]+\/[^/\s]+$/u);
      expect(source.revision).toMatch(/^[a-f0-9]{40}$/u);
      expect(source.licensePath).not.toMatch(/^(?:[A-Za-z]:|[/\\])|(?:^|[/\\])\.\.(?:[/\\]|$)/u);
    }
    for (const entry of COMMUNITY_SKILL_CATALOG) {
      expect(approvedKeys.has(`${entry.repository}:${entry.upstreamPath}`)).toBe(true);
      expect(entry.revision).toMatch(/^[a-f0-9]{40}$/u);
      expect(entry.licenseUrl).toContain(entry.revision);
      expect(entry.sourceUrl).toContain(entry.revision);
    }
  });

  it("keeps competitor accounting distinct from independently curated entries", () => {
    const catalogIds = new Set(COMMUNITY_SKILL_CATALOG.map((entry) => entry.id));
    const included = candidates.filter((candidate) => candidate.resolution === "included");
    const ledgerKeys = candidates.map((candidate) => `${candidate.competitor}:${candidate.externalId}`);

    expect(candidates).toHaveLength(216);
    expect(new Set(ledgerKeys).size).toBe(ledgerKeys.length);
    expect(candidates.filter((candidate) => candidate.resolution === "duplicate")).toHaveLength(5);
    expect(included.filter((candidate) => !candidate.catalogId || !catalogIds.has(candidate.catalogId))).toEqual([]);
    expect(included.every((candidate) => candidate.catalogId && catalogIds.has(candidate.catalogId))).toBe(true);
    expect(candidates.some((candidate) => candidate.catalogId === "human-writing")).toBe(false);
    expect(candidates.every((candidate) => candidate.reason.trim().length > 0)).toBe(true);

    const colaSnapshot = candidates.filter((candidate) => candidate.competitor === "colaos" && candidate.observedScope === "historical-candidate-snapshot");
    expect(colaSnapshot).toHaveLength(42);
    expect(colaSnapshot.every((candidate) => candidate.inventorySource)).toBe(true);

    const currentNewMaxSkills = candidates.filter((candidate) => candidate.competitor === "newmax" && candidate.observedScope === "current-installed-skill-2026-08-07");
    expect(currentNewMaxSkills).toHaveLength(59);
    expect(candidates.filter((candidate) => candidate.competitor === "newmax")).toHaveLength(70);
    const xhsMembers = currentNewMaxSkills.filter((candidate) => candidate.externalId.startsWith("xhs-"));
    expect(xhsMembers).toHaveLength(5);
    expect(xhsMembers.every((candidate) => (
      candidate.resolution === "included" && candidate.catalogId === "xiaohongshu-skills"
    ))).toBe(true);

    const currentWorkBuddyConnectors = candidates.filter((candidate) => candidate.competitor === "workbuddy" && candidate.observedScope === "current-connector-index-2026-08-07");
    expect(currentWorkBuddyConnectors).toHaveLength(81);
    expect(currentWorkBuddyConnectors.every((candidate) => candidate.resolution === "private" || candidate.resolution === "not-a-skill")).toBe(true);
    expect(currentWorkBuddyConnectors.every((candidate) => candidate.catalogId === undefined)).toBe(true);
    expect(candidates.filter((candidate) => candidate.competitor === "workbuddy" && candidate.observedScope === "historical-built-in-snapshot")).toHaveLength(23);
  });

  it("ships the pinned featured human-writing Skill with its complete method", () => {
    const entry = communityCatalogEntry("human-writing");

    expect(entry).toMatchObject({
      repository: "KKKKhazix/human-writing",
      revision: "4fda173f3fef7fb808f3eba991eeb2528ea4b189",
      upstreamPath: "human-writing",
      category: "writing",
      categoryLabel: "写作与表达",
      featured: true,
      author: "KKKKhazix",
    });
    const paths = entry?.files.map((file) => file.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining([
      "SKILL.md",
      "VERSION",
      "agents/openai.yaml",
      "dist/human-writing-lite.md",
      "scripts/check_prose.py",
      "LICENSE.upstream",
    ]));
    expect(paths.filter((filePath) => filePath.startsWith("references/") && filePath.endsWith(".md"))).toHaveLength(5);
  });

  it("publishes the pinned Xiaohongshu repository as one five-member family card", () => {
    const entry = communityCatalogEntry("xiaohongshu-skills");

    expect(COMMUNITY_SKILL_CATALOG.filter((candidate) => (
      candidate.repository === "autoclaw-cc/xiaohongshu-skills"
    ))).toHaveLength(1);
    expect(entry).toMatchObject({
      kind: "family",
      repository: "autoclaw-cc/xiaohongshu-skills",
      revision: "b043748282a57e347c52f517dfb59819121134ab",
      license: "MIT",
      name: "小红书工具组",
      memberCount: 5,
      members: [
        { id: "xhs-auth", upstreamPath: "skills/xhs-auth", name: expect.any(String), description: expect.any(String) },
        { id: "xhs-content-ops", upstreamPath: "skills/xhs-content-ops", name: expect.any(String), description: expect.any(String) },
        { id: "xhs-explore", upstreamPath: "skills/xhs-explore", name: expect.any(String), description: expect.any(String) },
        { id: "xhs-interact", upstreamPath: "skills/xhs-interact", name: expect.any(String), description: expect.any(String) },
        { id: "xhs-publish", upstreamPath: "skills/xhs-publish", name: expect.any(String), description: expect.any(String) },
      ],
    });
    const paths = entry?.files.map((file) => file.path) ?? [];
    expect(paths).not.toContain("SKILL.md");
    expect(paths.filter((filePath) => filePath.endsWith("/SKILL.md"))).toHaveLength(5);
    expect(paths).toEqual(expect.arrayContaining([
      "LICENSE.upstream",
      "extension/manifest.json",
      "pyproject.toml",
      "scripts/cli.py",
      "skills/xhs-auth/SKILL.md",
      "skills/xhs-content-ops/SKILL.md",
      "skills/xhs-explore/SKILL.md",
      "skills/xhs-interact/SKILL.md",
      "skills/xhs-publish/SKILL.md",
      "uv.lock",
    ]));
    expect(new Set(paths.map((filePath) => filePath.toLowerCase())).size).toBe(paths.length);
  });

  it("publishes the official Lark CLI repository as one opt-in 27-member family", () => {
    const entry = communityCatalogEntry("lark-cli");

    expect(COMMUNITY_SKILL_CATALOG.filter((candidate) => (
      candidate.repository === "larksuite/cli"
    ))).toHaveLength(1);
    expect(entry).toMatchObject({
      kind: "family",
      repository: "larksuite/cli",
      revision: "841953496b41a06bb670396f3d9f8fba943766ed",
      license: "MIT",
      memberCount: 27,
      setupMessage: expect.stringContaining("lark-cli"),
    });
    const paths = entry?.files.map((file) => file.path) ?? [];
    expect(paths).not.toContain("SKILL.md");
    expect(paths.filter((filePath) => filePath.endsWith("/SKILL.md"))).toHaveLength(27);
    expect(paths).toEqual(expect.arrayContaining([
      "LICENSE.upstream",
      "skills/lark-doc/SKILL.md",
      "skills/lark-shared/SKILL.md",
      "skills/lark-workflow-standup-report/SKILL.md",
    ]));
  });

  it("records installable, collision-free file manifests", () => {
    const catalogIds = COMMUNITY_SKILL_CATALOG.map((entry) => entry.id);
    const sourceKeys = COMMUNITY_SKILL_CATALOG.map((entry) => `${entry.repository}:${entry.upstreamPath}`);
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
    expect(new Set(sourceKeys).size).toBe(sourceKeys.length);

    for (const entry of COMMUNITY_SKILL_CATALOG) {
      const paths = entry.files.map((file) => file.path);
      if (entry.kind === "family") {
        expect(paths).not.toContain("SKILL.md");
        expect(paths.filter((filePath) => filePath.endsWith("/SKILL.md"))).toHaveLength(entry.memberCount);
      } else {
        expect(paths.filter((filePath) => filePath === "SKILL.md")).toHaveLength(1);
      }
      expect(paths.filter((filePath) => filePath === "LICENSE.upstream")).toHaveLength(1);
      expect(new Set(paths.map((filePath) => filePath.toLowerCase())).size).toBe(paths.length);
      for (const file of entry.files) {
        expect(path.posix.isAbsolute(file.path)).toBe(false);
        expect(file.path.split("/")).not.toContain("..");
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
  });

  it("keeps useful categories discoverable and supports id-or-name lookup", () => {
    for (const category of ["writing", "productivity", "image", "knowledge", "development"]) {
      expect(COMMUNITY_SKILL_CATALOG.some((entry) => entry.category === category)).toBe(true);
    }
    expect(COMMUNITY_SKILL_CATALOG.filter((entry) => entry.featured).length).toBeGreaterThanOrEqual(8);
    expect(communityCatalogEntry("missing")).toBeUndefined();
    expect(communityCatalogEntry("HUMAN-WRITING")?.id).toBe("human-writing");
  });
});
