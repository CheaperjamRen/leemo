// Runtime ESM resolve hook (loader-thread): map the vendor path aliases the
// vendored @musistudio/llms core imports by (@vendor/*, @/*) to real source
// files, so non-vitest entrypoints (gateway:dev) run under tsx/node. These
// aliases are wired for tests in vitest.config.ts and for typecheck in
// tsconfig.json (→ dist/vendor-types, types-only); this is the third,
// runtime leg. Registered by dev.ts before it imports the server. NEW file.
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

// this file lives at <root>/src/gateway/alias-hook.mjs
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(HERE, "vendor");
const LLMS = path.join(VENDOR, "llms", "src");

function mapAlias(spec) {
  if (spec.startsWith("@vendor/")) return path.join(VENDOR, spec.slice(8));
  if (spec.startsWith("@/")) return path.join(LLMS, spec.slice(2));
  return undefined;
}

export async function resolve(specifier, context, nextResolve) {
  const mapped = mapAlias(specifier);
  if (mapped) return nextResolve(pathToFileURL(mapped).href, context);
  return nextResolve(specifier, context);
}
