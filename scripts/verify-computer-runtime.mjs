import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NtExecutable, NtExecutableResource } from "resedit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "bundled-runtime", "windows-mcp", "release");
const manifestPath = path.join(releaseDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const executablePath = path.join(releaseDir, manifest.executable.name);
const bytes = fs.readFileSync(executablePath);
const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();

if (bytes.byteLength !== manifest.executable.size) {
  throw new Error(`Windows computer runtime size mismatch: ${bytes.byteLength}`);
}
if (hash !== manifest.executable.sha256) {
  throw new Error(`Windows computer runtime hash mismatch: ${hash}`);
}
if (!fs.existsSync(path.join(releaseDir, "LICENSE.txt"))) {
  throw new Error("Windows computer runtime license is missing");
}
const dpiPatch = manifest.patches?.find((patch) => patch.name === "per-monitor-v2-dpi-awareness");
if (!dpiPatch) {
  throw new Error("Windows computer runtime Per-Monitor V2 patch metadata is missing");
}
for (const patch of manifest.patches) {
  const patchPath = path.resolve(releaseDir, patch.source);
  if (!fs.existsSync(patchPath)) {
    throw new Error(`Windows computer runtime patch source is missing: ${patch.source}`);
  }
  const patchBytes = fs.readFileSync(patchPath);
  const canonicalPatchBytes = path.extname(patchPath).toLowerCase() === ".manifest"
    ? Buffer.from(patchBytes.toString("utf8").replace(/\r\n?/g, "\n"), "utf8")
    : patchBytes;
  const patchHash = createHash("sha256")
    .update(canonicalPatchBytes)
    .digest("hex")
    .toUpperCase();
  if (patchHash !== patch.sha256) {
    throw new Error(`Windows computer runtime patch hash mismatch: ${patch.name}`);
  }
}

const executable = NtExecutable.from(bytes);
const resources = NtExecutableResource.from(executable);
const embeddedManifest = resources.entries.find((entry) => entry.type === 24 && entry.id === 1);
if (!embeddedManifest || !Buffer.from(embeddedManifest.bin).toString("utf8").includes("PerMonitorV2")) {
  throw new Error("Windows computer runtime is not Per-Monitor V2 DPI aware");
}

console.log(`Windows computer runtime verified (${manifest.version}; ${bytes.byteLength} bytes; ${hash})`);
