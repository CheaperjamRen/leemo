import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const rendererRoot = join(process.cwd(), "src", "renderer");
const forbiddenCharacterIcons = ["🔧", "📊", "📄", "💬", "📦", "🧠", "⚙", "⚠", "✓", "▧"];

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) return [];
    return [path];
  });
}

describe("renderer icon integrity", () => {
  it("uses the icon system instead of character placeholders", () => {
    const violations = productionTsxFiles(rendererRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbiddenCharacterIcons
        .filter((icon) => source.includes(icon))
        .map((icon) => `${relative(process.cwd(), path)} contains ${icon}`);
    });

    expect(violations).toEqual([]);
  });
});
