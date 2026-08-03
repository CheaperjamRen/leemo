import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..", "..");

describe("Office runtime release probe", () => {
  it("runs Python in UTF-8 without polluting the bundled skills or borrowing Codex runtimes", () => {
    const source = fs.readFileSync(path.join(root, "scripts", "verify-office-runtime.mjs"), "utf8");

    expect(source).toMatch(/PYTHONDONTWRITEBYTECODE:\s*["']1["']/);
    expect(source).toMatch(/PYTHONUTF8:\s*["']1["']/);
    expect(source).toMatch(/PYTHONIOENCODING:\s*["']utf-8["']/);
    expect(source).toMatch(/codex-runtimes/);
  });
});
