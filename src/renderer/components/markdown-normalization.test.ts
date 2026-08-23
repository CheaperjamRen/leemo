import { describe, expect, it } from "vitest";
import { markdownPreviewText, normalizeLegacyMarkdown } from "./markdown-normalization";

describe("legacy markdown normalization", () => {
  it("repairs escaped emphasis and LaTeX without touching ordinary prose escapes", () => {
    const source = String.raw`\*\*重点\*\*

$$F\_0 = 0, \\quad F\_1 = 1$$

C:\\Temp\\file`;
    const normalized = normalizeLegacyMarkdown(source);
    expect(normalized).toContain("**重点**");
    expect(normalized).toContain(String.raw`F_0 = 0, \quad F_1 = 1`);
    expect(normalized).toContain(String.raw`C:\\Temp\\file`);
  });

  it("removes callout and Markdown decoration from compact list previews", () => {
    expect(markdownPreviewText("> [!CAUTION] >\n\n## **主线**\n\n- [ ] 打磨 PRD")).toBe("主线 打磨 PRD");
  });

  it("removes an empty legacy callout marker instead of showing raw syntax", () => {
    expect(normalizeLegacyMarkdown("> [!CAUTION]\n> ")).toBe("");
    expect(normalizeLegacyMarkdown("> [!CAUTION]\n> 保留正文")).toBe("> [!CAUTION]\n> 保留正文");
  });
});
