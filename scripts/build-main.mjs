// Bundles the Electron main + preload from src/main/** into dist-electron/.
// Chosen over electron-vite (heavy) / raw tsx (can't be an electron entry):
// esbuild is a ~1-file, zero-config bundle step that keeps npm deps external
// so the SDK still spawns its CLI child process from node_modules at runtime.
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const outdir = path.join(root, "dist-electron");
const documentEngineSource = path.join(root, "src", "host", "document-engine.ts");
const skillPackageSource = path.join(root, "src", "host", "skill-package.ts");
const learningServiceSource = path.join(root, "src", "main", "learning-service.ts");
const acpSdkSource = path.join(root, "node_modules", "@agentclientprotocol", "sdk", "dist", "acp.js");
const prebundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "leemo-host-prebundle-"));
const documentEnginePrebundle = path.join(prebundleDir, "document-engine.mjs");
const skillPackagePrebundle = path.join(prebundleDir, "skill-package.mjs");
const learningServicePrebundle = path.join(prebundleDir, "learning-service.mjs");
const acpSdkPrebundle = path.join(prebundleDir, "agent-client-protocol-sdk.mjs");

const common = {
  bundle: true,
  platform: "node",
  target: "node22", // Electron 43 ships Node 22
  // The gateway's vendored transformer uses its original TypeScript aliases.
  // They are local source, not npm packages, so resolve them before
  // `packages: external` decides which bare imports stay external.
  alias: {
    "@vendor": path.join(root, "src", "gateway", "vendor"),
    "@": path.join(root, "src", "gateway", "vendor", "llms", "src"),
  },
  // Keep all npm deps external — resolved from node_modules at runtime. The
  // claude-agent-sdk in particular spawns a CLI child process and must not be
  // inlined. Only our own src/** is bundled.
  packages: "external",
  sourcemap: true,
  logLevel: "info",
};

try {
  // Document and Skill package parsers have small, self-contained runtime
  // dependencies. Bundle these modules first, then inline the results into
  // the otherwise externalized main process bundle. This keeps the packaged
  // app independent of npm's document/ZIP parser imports at runtime.
  await Promise.all([
    build({
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      packages: "bundle",
      entryPoints: [documentEngineSource],
      outfile: documentEnginePrebundle,
      sourcemap: false,
      logLevel: "info",
    }),
    build({
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      packages: "bundle",
      entryPoints: [learningServiceSource],
      outfile: learningServicePrebundle,
      sourcemap: false,
      logLevel: "info",
    }),
    build({
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      packages: "bundle",
      entryPoints: [skillPackageSource],
      outfile: skillPackagePrebundle,
      sourcemap: false,
      logLevel: "info",
    }),
    build({
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      packages: "bundle",
      entryPoints: [acpSdkSource],
      outfile: acpSdkPrebundle,
      sourcemap: false,
      logLevel: "info",
    }),
  ]);

  const bundleHostPrebundles = {
    // Keep the historical plugin name prefix so the build contract remains
    // discoverable to the existing packaging test and maintenance tooling.
    name: "bundle-document-engine-and-skill-package",
    setup(buildApi) {
      buildApi.onResolve({ filter: /document-engine$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        const resolvedTs = path.resolve(args.resolveDir, `${args.path}.ts`);
        if (resolved === documentEngineSource || resolvedTs === documentEngineSource) {
          return { path: documentEnginePrebundle };
        }
        return undefined;
      });
      buildApi.onResolve({ filter: /skill-package$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        const resolvedTs = path.resolve(args.resolveDir, `${args.path}.ts`);
        if (resolved === skillPackageSource || resolvedTs === skillPackageSource) {
          return { path: skillPackagePrebundle };
        }
        return undefined;
      });
      buildApi.onResolve({ filter: /learning-service$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        const resolvedTs = path.resolve(args.resolveDir, `${args.path}.ts`);
        if (resolved === learningServiceSource || resolvedTs === learningServiceSource) {
          return { path: learningServicePrebundle };
        }
        return undefined;
      });
      buildApi.onResolve({ filter: /^@agentclientprotocol\/sdk$/ }, () => ({
        path: acpSdkPrebundle,
      }));
    },
  };

  await Promise.all([
    build({
      ...common,
      entryPoints: [path.join(root, "src/main/main.ts")],
      outfile: path.join(outdir, "main.mjs"),
      format: "esm",
      plugins: [bundleHostPrebundles],
      // esbuild leaves import.meta.url intact in ESM output — main.ts relies on it.
    }),
    build({
      ...common,
      entryPoints: [path.join(root, "src/main/preload.ts")],
      outfile: path.join(outdir, "preload.cjs"),
      format: "cjs", // sandboxed preload must be CommonJS
    }),
    build({
      ...common,
      entryPoints: [path.join(root, "src/main/quick-capture-preload.ts")],
      outfile: path.join(outdir, "quick-capture-preload.cjs"),
      format: "cjs",
    }),
  ]);

  const mainBundle = fs.readFileSync(path.join(outdir, "main.mjs"), "utf8");
  if (/(?:from|import\()\s*["']@(?:vendor\/|\/)/.test(mainBundle)) {
    throw new Error("[build-main] unresolved local gateway alias remained in main.mjs");
  }
  if (/(?:from|import\()\s*["']@agentclientprotocol\/sdk["']/.test(mainBundle)) {
    throw new Error("[build-main] ACP SDK remained external in main.mjs");
  }

  console.log("[build-main] main + main-window preload + quick-capture preload ready");
} finally {
  fs.rmSync(prebundleDir, { recursive: true, force: true });
}
