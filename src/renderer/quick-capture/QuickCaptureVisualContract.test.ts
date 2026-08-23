import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(
  path.resolve("src", "renderer", "quick-capture", "QuickCaptureApp.css"),
  "utf8",
);
const editorSource = readFileSync(
  path.resolve("src", "renderer", "components", "CaptureEditor.css"),
  "utf8",
);

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing visual contract selector: ${selector}`);
  return match[1];
}

describe("quick capture visual contract", () => {
  it("uses the same 40px rhythm for the custom title bar and formatting bar", () => {
    expect(rule(shellSource, ".quick-capture")).toContain("--quick-capture-chrome-height: 40px;");
    expect(rule(shellSource, ".quick-capture__close")).toContain(
      "height: var(--quick-capture-chrome-height);",
    );
    expect(rule(editorSource, ".capture-editor--capture .capture-editor__toolbar")).toContain(
      "height: var(--quick-capture-chrome-height);",
    );
  });

  it("keeps title and body on one uninterrupted writing surface", () => {
    const title = rule(shellSource, ".quick-capture__title");
    const toolbar = rule(editorSource, ".capture-editor--capture .capture-editor__toolbar");
    const content = rule(editorSource, ".capture-editor--capture .capture-editor__content");
    const placeholder = rule(editorSource, ".capture-editor--capture .capture-editor__placeholder");

    expect(title).toContain("height: 42px;");
    expect(title).toContain("border: 0;");
    expect(title).toContain("font-size: 18px;");
    expect(toolbar).toContain("border-bottom: 0;");
    expect(content).toContain("font-size: 16px;");
    expect(content).toContain("line-height: 1.65;");
    expect(placeholder).toContain("font-size: 16px;");
    expect(placeholder).toContain("line-height: 1.65;");
  });
});
