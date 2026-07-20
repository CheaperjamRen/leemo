// Leemo gateway — manual dev launcher (`npm run gateway:dev`).
//
// Reads .env for RELAY2_* (via Node's built-in process.loadEnvFile — no dotenv
// dependency), builds a ProviderRegistry, starts the gateway on 127.0.0.1:0 and
// prints the port + the SDK env you need to point Claude Code at it. When
// RELAY2_* is unset it reports that readably instead of crashing.
//
// Runtime alias bootstrap: the vendored @musistudio/llms core imports by the
// @vendor/* and @/* path aliases. Those are wired for vitest (vitest.config.ts)
// and for typecheck (tsconfig → dist/vendor-types, types-only), but tsx/node do
// NOT read tsconfig paths for module resolution. So before importing anything
// that transitively pulls the vendor core, we register alias-hook.mjs on the
// loader thread. The server/registry are then imported DYNAMICALLY (after the
// hook is live). This is the only entrypoint that runs the gateway outside
// vitest, so it is the only place the third resolver leg is needed.
//
// NEVER prints a key. The registry's logger is redacting, and dev.ts never
// touches apiKey at all.

import { register } from "node:module";

register("./alias-hook.mjs", import.meta.url);

async function main(): Promise<void> {
  // Load .env if present; ignore if it isn't (env may be set another way).
  try {
    process.loadEnvFile();
  } catch {
    // no .env file — fall through to process.env as-is
  }

  // Dynamic imports: must run AFTER register() so the vendor aliases resolve.
  const { startGateway } = await import("./server");
  const { fromEnv } = await import("./registry");

  const { registry, configured, missing } = fromEnv();
  if (!configured) {
    console.error(
      `[gateway:dev] RELAY2_* not configured — missing: ${missing.join(", ")}.\n` +
        `Add them to E:\\Leemo\\.env (RELAY2_BASE_URL / RELAY2_API_KEY / RELAY2_MODEL) and re-run.\n` +
        `Starting anyway with an EMPTY registry (only /health and /v1/models will respond usefully).`
    );
  }

  const gw = await startGateway(registry);
  const base = `http://127.0.0.1:${gw.port}`;
  const ids = registry.ids();
  console.log(`[gateway:dev] listening on ${base}`);
  console.log(`[gateway:dev] providers: ${ids.length ? ids.join(", ") : "(none)"}`);
  if (ids.length) {
    console.log(`[gateway:dev] point the SDK at it with:`);
    console.log(`    ANTHROPIC_BASE_URL=${base}`);
    console.log(`    ANTHROPIC_AUTH_TOKEN=leemo-gw:${ids[0]}`);
  }
  console.log(`[gateway:dev] health:  ${base}/health`);
  console.log(`[gateway:dev] models:  ${base}/v1/models`);
  console.log(`[gateway:dev] Ctrl+C to stop.`);

  const shutdown = () => {
    console.log(`\n[gateway:dev] shutting down…`);
    gw.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e: unknown) => {
  console.error(`[gateway:dev] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
