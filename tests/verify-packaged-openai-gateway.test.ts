import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const rootPrefix = "leemo-e2e-r9-openai-";

function ownedAuditRoots(): Set<string> {
  return new Set(
    fs.readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(rootPrefix))
      .map((entry) => path.join(os.tmpdir(), entry.name)),
  );
}

function runHarness(env: NodeJS.ProcessEnv): Promise<{ code: number | null; elapsedMs: number }> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-packaged-openai-gateway.mjs"], {
      cwd: repoRoot,
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, elapsedMs: Date.now() - startedAt }));
  });
}

describe.skipIf(process.platform !== "win32")("packaged OpenAI gateway acceptance harness", () => {
  it("invalidates stale facts and cleans owned state when the packaged process exits early", async () => {
    const auditTag = `openai-gateway-failure-${process.pid}-${Date.now()}`;
    const factsPath = path.join(repoRoot, "docs", "research", "audit-shots", `${auditTag}-facts.json`);
    const rootsBefore = ownedAuditRoots();
    fs.writeFileSync(factsPath, '{"packaged":true}\n');

    try {
      const result = await runHarness({
        ...process.env,
        LEEMO_AUDIT_TAG: auditTag,
        // Node exits immediately on the Electron-only command-line switches.
        LEEMO_PACKAGED_EXE: process.execPath,
        LEEMO_INSTALLER_EXE: process.execPath,
      });

      expect(result.code).not.toBe(0);
      expect(result.elapsedMs).toBeLessThan(5_000);
      expect(fs.existsSync(factsPath)).toBe(false);
      expect([...ownedAuditRoots()].filter((root) => !rootsBefore.has(root))).toEqual([]);
    } finally {
      fs.rmSync(factsPath, { force: true });
      for (const root of ownedAuditRoots()) {
        if (!rootsBefore.has(root)) fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }, 25_000);
});
