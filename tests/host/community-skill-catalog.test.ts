import { describe, expect, it } from "vitest";
import {
  COMMUNITY_SKILL_CATALOG,
  communityCatalogEntry,
} from "../../src/host/community-skill-catalog";

describe("community Skill catalog", () => {
  it("binds every trusted card to a pinned revision, license, and exact file manifest", () => {
    expect(COMMUNITY_SKILL_CATALOG.length).toBeGreaterThanOrEqual(8);
    for (const entry of COMMUNITY_SKILL_CATALOG) {
      expect(entry.revision).toMatch(/^[a-f0-9]{40}$/u);
      expect(entry.license).toBe("MIT");
      expect(entry.files[0]?.path).toBe("SKILL.md");
      expect(new Set(entry.files.map((file) => file.path)).size).toBe(entry.files.length);
      for (const file of entry.files) {
        expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(file.bytes).toBeGreaterThan(0);
      }
    }
  });

  it("keeps learning and career as open labels instead of a closed category enum", () => {
    expect(COMMUNITY_SKILL_CATALOG.some((entry) => entry.category === "learning")).toBe(true);
    expect(COMMUNITY_SKILL_CATALOG.some((entry) => entry.category === "development")).toBe(true);
    expect(communityCatalogEntry("missing")).toBeUndefined();
  });

  it("installs grill-me as a complete dependency rather than its broken wrapper", () => {
    const entry = communityCatalogEntry("grill-me");
    expect(entry).toMatchObject({ name: "grill-me", upstreamPath: "skills/productivity/grilling" });
  });
});
