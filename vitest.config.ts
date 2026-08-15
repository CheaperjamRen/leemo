import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  test: {
    // jsdom plus the document/PDF engines is memory-heavy on Windows. Keep the
    // standard local command and CI on the same stable concurrency budget.
    maxWorkers: 2,
    projects: [
      {
        // Existing node suite — behavior UNCHANGED (same include + aliases).
        test: { name: "node", include: ["tests/**/*.test.ts"], environment: "node" },
        resolve: {
          alias: [
            { find: /^@\//, replacement: `${root}/src/gateway/vendor/llms/src/` },
            { find: /^@vendor\//, replacement: `${root}/src/gateway/vendor/` },
            { find: /^@gateway\//, replacement: `${root}/src/gateway/` },
          ],
        },
      },
      {
        // New renderer suite — jsdom.
        plugins: [react()],
        test: {
          name: "renderer",
          include: ["src/renderer/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["src/renderer/test/setup.ts"],
        },
        resolve: { alias: [{ find: /^@renderer\//, replacement: `${root}/src/renderer/` }] },
      },
    ],
  },
});
