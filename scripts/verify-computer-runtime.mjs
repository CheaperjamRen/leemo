import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`Windows computer runtime verified (${manifest.version}; ${bytes.byteLength} bytes; ${hash})`);
