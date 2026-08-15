import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NtExecutable, NtExecutableResource } from "resedit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.join(root, "bundled-runtime", "windows-mcp");
const releaseDir = path.join(runtimeDir, "release");
const releaseManifestPath = path.join(releaseDir, "manifest.json");
const dpiManifestPath = path.join(runtimeDir, "dpi-awareness.manifest");
const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, "utf8"));
const executablePath = path.join(releaseDir, releaseManifest.executable.name);
const executableBytes = fs.readFileSync(executablePath);
const dpiManifestBytes = Buffer.from(
  fs.readFileSync(dpiManifestPath, "utf8").replace(/\r\n?/g, "\n"),
  "utf8",
);

const executable = NtExecutable.from(executableBytes);
const resources = NtExecutableResource.from(executable);
const manifestResource = resources.entries.find((entry) => entry.type === 24 && entry.id === 1);

if (!manifestResource) {
  throw new Error("Windows computer runtime has no RT_MANIFEST resource to patch");
}

const currentManifest = Buffer.from(manifestResource.bin).toString("utf8");
let patchedBytes = executableBytes;

if (!currentManifest.includes("PerMonitorV2")) {
  manifestResource.bin = dpiManifestBytes.buffer.slice(
    dpiManifestBytes.byteOffset,
    dpiManifestBytes.byteOffset + dpiManifestBytes.byteLength,
  );
  resources.outputResource(executable);
  patchedBytes = Buffer.from(executable.generate());

  // A .NET single-file executable stores its managed payload after the PE image.
  // Losing even one byte here would leave a valid-looking but unlaunchable runtime.
  if (patchedBytes.byteLength !== executableBytes.byteLength) {
    throw new Error(
      `Refusing to replace Windows runtime: size changed from ${executableBytes.byteLength} to ${patchedBytes.byteLength}`,
    );
  }

  fs.writeFileSync(executablePath, patchedBytes);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
releaseManifest.executable.size = patchedBytes.byteLength;
releaseManifest.executable.sha256 = sha256(patchedBytes);
releaseManifest.patches = [
  {
    name: "per-monitor-v2-dpi-awareness",
    source: "../dpi-awareness.manifest",
    sha256: sha256(dpiManifestBytes),
  },
];
fs.writeFileSync(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);

console.log(
  currentManifest.includes("PerMonitorV2")
    ? "Windows computer runtime already uses Per-Monitor V2 DPI awareness"
    : "Patched Windows computer runtime with Per-Monitor V2 DPI awareness",
);
