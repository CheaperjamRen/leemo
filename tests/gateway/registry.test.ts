import { describe, it, expect } from "vitest";
import { ProviderRegistry, fromEnv } from "@gateway/registry";

// B0 — registry.fromEnv per-provider ProviderOpts channel.
//
// Background: the whole-branch final review flagged that fromEnv hardcoded
// `opts:{}`, so flattenSchemas / maxTokensField / reasoningInjection / etc. were
// tested-but-unreachable through the production entry point. B0 adds an optional
// `RELAY2_OPTS` JSON env var that merges into the relay2 provider's opts.
// Tests inject a fake env object (never touch the real .env).

const REQUIRED = {
  RELAY2_BASE_URL: "https://relay.example.com/v1",
  RELAY2_API_KEY: "sk-fake-0000000000000000",
  RELAY2_MODEL: "gpt-x",
};

describe("registry.fromEnv ProviderOpts channel (B0)", () => {
  it("without RELAY2_OPTS, relay2 resolves with empty opts (back-compat)", () => {
    const { registry, configured } = fromEnv({ ...REQUIRED } as any);
    expect(configured).toBe(true);
    const resolved = registry.resolve("relay2");
    expect(resolved).toBeDefined();
    expect(resolved!.opts).toEqual({});
  });

  it("RELAY2_OPTS JSON is parsed and merged into the relay2 provider opts", () => {
    const env = {
      ...REQUIRED,
      RELAY2_OPTS: JSON.stringify({
        usageBackfill: "off",
        maxTokensField: "max_completion_tokens",
        flattenSchemas: true,
      }),
    };
    const { registry } = fromEnv(env as any);
    const resolved = registry.resolve("relay2");
    expect(resolved!.opts).toEqual({
      usageBackfill: "off",
      maxTokensField: "max_completion_tokens",
      flattenSchemas: true,
    });
  });

  it("malformed RELAY2_OPTS JSON is reported as a config problem, NOT silently dropped", () => {
    const env = { ...REQUIRED, RELAY2_OPTS: "{not valid json" };
    const result = fromEnv(env as any);
    // configured stays false and the bad var is surfaced in `missing` so dev.ts
    // reports it readably instead of booting with silently-ignored opts.
    expect(result.configured).toBe(false);
    expect(result.missing).toContain("RELAY2_OPTS");
  });

  it("empty/whitespace RELAY2_OPTS is treated as absent (empty opts, configured)", () => {
    const env = { ...REQUIRED, RELAY2_OPTS: "   " };
    const { registry, configured } = fromEnv(env as any);
    expect(configured).toBe(true);
    expect(registry.resolve("relay2")!.opts).toEqual({});
  });

  it("the ProviderRegistry constructor path already carries opts through resolve()", () => {
    // Pin the constructor contract fromEnv relies on: opts round-trip verbatim.
    const registry = new ProviderRegistry({
      records: [
        {
          id: "p1",
          baseUrl: "http://x",
          apiKey: "k",
          model: "m",
          apiFormat: "openai",
          opts: { reasoningInjection: "off", includeUsage: false },
        },
      ],
    });
    expect(registry.resolve("p1")!.opts).toEqual({ reasoningInjection: "off", includeUsage: false });
  });

  it("reads a live record source so saved desktop settings take effect without restart", () => {
    let records = [{
      id: "p1", baseUrl: "http://one", apiKey: "key-one", model: "m1",
      apiFormat: "openai" as const, headers: { "X-Route": "one" },
    }];
    const registry = new ProviderRegistry({ records: () => records });

    expect(registry.resolve("p1")).toMatchObject({ baseUrl: "http://one", headers: { "X-Route": "one" } });
    records = [{
      id: "p1", baseUrl: "http://two", apiKey: "key-two", model: "m2",
      apiFormat: "openai" as const, headers: { "X-Route": "two" },
    }];
    expect(registry.resolve("p1")).toMatchObject({ baseUrl: "http://two", apiKey: "key-two", model: "m2" });
  });

  it("exposes every configured model for a provider, not only its default", () => {
    const registry = new ProviderRegistry({
      records: [{
        id: "p1", baseUrl: "http://one", apiKey: "key-one", model: "m1",
        models: ["m1", "m2", "m3"], apiFormat: "openai" as const,
      }],
    });

    expect(registry.models().map(({ id }) => id)).toEqual([
      "claude-m1",
      "claude-m2",
      "claude-m3",
    ]);
  });

  it("redacts custom header values as secrets", () => {
    const lines: string[] = [];
    const registry = new ProviderRegistry({
      records: [{
        id: "p1", baseUrl: "http://one", apiKey: "key-one", model: "m1",
        apiFormat: "openai" as const,
        headers: { "X-Relay-Token": "header-secret-value" },
      }],
      logSink: (line) => lines.push(line),
    });

    registry.logger.error("invalid header header-secret-value");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("header-secret-value");
    expect(lines[0]).toContain("[REDACTED]");
  });
});
