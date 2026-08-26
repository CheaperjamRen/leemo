import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("main relationship-history wiring", () => {
  it("queries the disposable SQLite index without hydrating the whole application snapshot", () => {
    const source = fs.readFileSync(path.resolve("src", "main", "main.ts"), "utf8");
    const start = source.indexOf("searchBuddyHistory:");
    const end = source.indexOf("memoryDir:", start);
    const wiring = source.slice(start, end);

    expect(wiring).toContain("loadRelationshipHistoryCandidates(database, query)");
    expect(wiring).toContain("searchRelationshipHistoryCandidates");
    expect(wiring).not.toContain("activePersistence.loadAll()");
  });
});
