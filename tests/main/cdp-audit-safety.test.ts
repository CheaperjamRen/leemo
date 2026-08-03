import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..");

function script(name: string): string {
  return fs.readFileSync(path.join(root, "scripts", name), "utf8");
}

describe("CDP visual audit safety", () => {
  it("always clears device metrics after the public settings layout audit", () => {
    const name = "verify-settings-layout.mjs";
    expect(script(name)).toMatch(
      /finally\s*\{[\s\S]*?Emulation\.clearDeviceMetricsOverride/,
    );
  });

  it.each([
    "verify-memory-workspace.mjs",
    "verify-memory-restart.mjs",
  ])("keeps the r10 memory journey inside an isolated app root in %s", (name) => {
    const source = script(name);
    expect(source).toContain("--leemo-e2e-root=");
    expect(source).toContain("127.0.0.1");
    expect(source).not.toMatch(/USERPROFILE[^\n]+["']Leemo["']/);
    expect(source).not.toMatch(/writeFileSync\([^,]*(?:MEMORY|ledger|CLAUDE)/i);
  });
});
