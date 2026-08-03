import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");
const buildScript = fs.readFileSync(path.join(root, "scripts", "build-main.mjs"), "utf8");

const DOCUMENT_PACKAGES = [
  "pdfjs-dist",
  "docx",
  "pptxgenjs",
  "fflate",
  "fast-xml-parser",
] as const;

describe("document runtime bundle", () => {
  it("prebundles document-engine with package bundling before the externalized main build", () => {
    expect(buildScript).toMatch(/document-engine\.ts/);
    expect(buildScript).toMatch(/documentEnginePrebundle/);
    expect(buildScript).toMatch(/packages:\s*["']bundle["']/);
    expect(buildScript).toMatch(/bundle-document-engine/);
  });

  it("uses a temporary staging directory and removes it even when a build fails", () => {
    expect(buildScript).toMatch(/mkdtempSync/);
    expect(buildScript).toMatch(/finally/);
    expect(buildScript).toMatch(/rmSync/);
  });

  it("leaves no bare document-package import in a built main bundle", () => {
    const mainPath = path.join(root, "dist-electron", "main.mjs");
    if (!fs.existsSync(mainPath)) return;
    const main = fs.readFileSync(mainPath, "utf8");
    for (const packageName of DOCUMENT_PACKAGES) {
      const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(main, `${packageName} remained a runtime import`).not.toMatch(
        new RegExp(`(?:from\\s*|import\\(|require\\()\\s*["']${escaped}(?:/|["'])`),
      );
    }
  });
});
