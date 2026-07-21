import { describe, it, expect } from "vitest";
import { buildConversationEnv, sanitizeHostEnv } from "../../src/bridge/providers";
import {
  deepseekDirect,
  deepseekWithTemplate,
  relay2Gateway,
} from "./fixtures/providers";

// B1 Step 1 — providers.buildConversationEnv pure env builder.
//
// Two wiring modes (06 §3.2). The function is a PURE mapping from
// (provider, modelId, gatewayPort?) to the env object handed to the SDK child.
// It does NOT read process.env, .env, or the filesystem — those are the pool's
// concern. Every assertion below pins an exact VALUE, not mere presence.

// The 6 CC model-alias slots CC honors (宪法 B4 + Phase 0 smoke/lib.mjs parity).
// ANTHROPIC_MODEL is the primary; the rest are SONNET / OPUS / HAIKU /
// SMALL_FAST / SUBAGENT class overrides.
const SLOT_MODEL = "ANTHROPIC_MODEL";
const SLOT_SONNET = "ANTHROPIC_DEFAULT_SONNET_MODEL";
const SLOT_OPUS = "ANTHROPIC_DEFAULT_OPUS_MODEL";
const SLOT_HAIKU = "ANTHROPIC_DEFAULT_HAIKU_MODEL";
const SLOT_SMALL = "ANTHROPIC_SMALL_FAST_MODEL";
const SLOT_SUBAGENT = "CLAUDE_CODE_SUBAGENT_MODEL";
const ALL_SLOTS = [
  SLOT_MODEL,
  SLOT_SONNET,
  SLOT_OPUS,
  SLOT_HAIKU,
  SLOT_SMALL,
  SLOT_SUBAGENT,
];

describe("buildConversationEnv — DIRECT wiring (apiFormat=anthropic)", () => {
  it("points BASE_URL at the provider endpoint and AUTH_TOKEN at the real key", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(
      "sk-test-deepseek-DIRECTKEY-000000000000"
    );
  });

  it("maps all 6 model-alias slots to the chosen modelId by default", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    for (const slot of ALL_SLOTS) expect(env[slot]).toBe("deepseek-v4pro");
  });

  it("blanks ANTHROPIC_API_KEY so an ambient key can never override AUTH_TOKEN", () => {
    // Phase 0 buildEnv sets ANTHROPIC_API_KEY:'' for exactly this reason.
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("sets CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 (Phase 0 smoke/lib parity)", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
  });

  it("honors an envTemplate slot override while defaulting the untouched slots", () => {
    // deepseekWithTemplate remaps only the HAIKU slot to the flash model.
    const env = buildConversationEnv(deepseekWithTemplate, "deepseek-v4pro");
    expect(env[SLOT_HAIKU]).toBe("deepseek-v4flash"); // template wins
    expect(env[SLOT_MODEL]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_SONNET]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_OPUS]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_SMALL]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_SUBAGENT]).toBe("deepseek-v4pro"); // default
  });

  it("reflects the modelId argument, not the provider's first model", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4flash");
    expect(env[SLOT_MODEL]).toBe("deepseek-v4flash");
  });
});

describe("buildConversationEnv — GATEWAY wiring (apiFormat=openai)", () => {
  it("points BASE_URL at the loopback gateway on the injected port", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:61340");
  });

  it("uses the placeholder token leemo-gw:<providerId>, NOT the real key", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("leemo-gw:relay2");
  });

  it("disguises the model with the claude- prefix (G3 /v1/models semantics)", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    for (const slot of ALL_SLOTS) expect(env[slot]).toBe("claude-gpt-5.6-luna");
  });

  it("carries NO real key anywhere in the env (leak assertion)", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    const blob = JSON.stringify(env);
    expect(blob).not.toContain(relay2Gateway.apiKey);
    expect(blob).not.toContain("sk-test-relay");
    // and specifically the AUTH_TOKEN slot is the placeholder, key-shaped-free
    expect(env.ANTHROPIC_AUTH_TOKEN).not.toContain("sk-");
  });

  it("blanks ANTHROPIC_API_KEY in gateway mode too", () => {
    const env = buildConversationEnv(relay2Gateway, "gpt-5.6-luna", 61340);
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("throws when an openai provider is wired without a gateway port", () => {
    // Gateway mode is meaningless without the local gateway's port; failing
    // loud beats silently emitting http://127.0.0.1:undefined.
    expect(() => buildConversationEnv(relay2Gateway, "gpt-5.6-luna")).toThrow(
      /gateway port/i
    );
  });
});

describe("buildConversationEnv — purity", () => {
  it("does not mutate the provider or its envTemplate", () => {
    const before = JSON.stringify(deepseekWithTemplate);
    buildConversationEnv(deepseekWithTemplate, "deepseek-v4pro");
    expect(JSON.stringify(deepseekWithTemplate)).toBe(before);
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    const b = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("sanitizeHostEnv — strip secret-shaped host vars before spread", () => {
  // The SDK REPLACES the child env, so the pool must spread process.env for
  // PATH/HOME/etc. But process.env in production carries the gateway's real
  // upstream keys (RELAY2_API_KEY etc.) and any sibling-provider secrets — a
  // child that runs bash could printenv them. sanitizeHostEnv drops every
  // secret-shaped var; the conversation's OWN token is re-applied afterward by
  // buildConversationEnv (ANTHROPIC_AUTH_TOKEN), so direct wiring is unaffected.

  it("drops *_API_KEY (incl. ANTHROPIC_API_KEY) and *_AUTH_TOKEN", () => {
    const clean = sanitizeHostEnv({
      RELAY2_API_KEY: "sk-test-relay-should-be-stripped",
      ANTHROPIC_API_KEY: "sk-test-anthropic-should-be-stripped",
      SOME_VENDOR_AUTH_TOKEN: "sk-test-vendor-token",
      PATH: "/usr/bin",
    });
    expect(clean.RELAY2_API_KEY).toBeUndefined();
    expect(clean.ANTHROPIC_API_KEY).toBeUndefined();
    expect(clean.SOME_VENDOR_AUTH_TOKEN).toBeUndefined();
    expect(clean.PATH).toBe("/usr/bin"); // benign system var preserved
  });

  it("drops *_SECRET and *_ACCESS_KEY shapes", () => {
    const clean = sanitizeHostEnv({
      MY_SECRET: "s1",
      DB_SECRET_VALUE: "s2",
      AWS_ACCESS_KEY_ID: "AKIA-test",
      AWS_SECRET_ACCESS_KEY: "sk-test-aws",
      HOME: "/home/momo",
    });
    expect(clean.MY_SECRET).toBeUndefined();
    expect(clean.DB_SECRET_VALUE).toBeUndefined();
    expect(clean.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(clean.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(clean.HOME).toBe("/home/momo");
  });

  it("is case-insensitive on the sensitive suffixes", () => {
    const clean = sanitizeHostEnv({
      relay2_api_key: "sk-test-lower",
      Some_Auth_Token: "sk-test-mixed",
      LANG: "en_US.UTF-8",
    });
    expect(clean.relay2_api_key).toBeUndefined();
    expect(clean.Some_Auth_Token).toBeUndefined();
    expect(clean.LANG).toBe("en_US.UTF-8");
  });

  it("does not mutate its input and returns a fresh object", () => {
    const input = { RELAY2_API_KEY: "sk-test", PATH: "/bin" };
    const clean = sanitizeHostEnv(input);
    expect(clean).not.toBe(input);
    expect(input.RELAY2_API_KEY).toBe("sk-test"); // original untouched
  });
});
