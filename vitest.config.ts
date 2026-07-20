import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirror tsconfig paths so vitest resolves the same aliases as tsc.
// forward slashes → cross-platform safe on Windows.
const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/src/gateway/vendor/llms/src/` },
      { find: /^@vendor\//, replacement: `${root}/src/gateway/vendor/` },
      { find: /^@gateway\//, replacement: `${root}/src/gateway/` },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
