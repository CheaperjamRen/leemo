import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("02 §2.1 铁律: components never touch the bridge port directly", () => {
  it("no component imports bridge/client or bridge/fixture-client", () => {
    const offenders = walk(path.resolve("src/renderer/components")).filter((f) =>
      /bridge\/(client|fixture-client)/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
