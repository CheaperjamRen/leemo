import { describe, it, expect } from "vitest";
import { buildConversationEnv } from "../../src/bridge/providers";
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

// The 4 model-alias slots CC honors (宪法 B4). ANTHROPIC_MODEL is the primary;
// the other three are the SONNET / HAIKU / SUBAGENT class overrides.
const SLOT_MODEL = "ANTHROPIC_MODEL";
const SLOT_SONNET = "ANTHROPIC_DEFAULT_SONNET_MODEL";
const SLOT_HAIKU = "ANTHROPIC_DEFAULT_HAIKU_MODEL";
const SLOT_SUBAGENT = "CLAUDE_CODE_SUBAGENT_MODEL";

describe("buildConversationEnv — DIRECT wiring (apiFormat=anthropic)", () => {
  it("points BASE_URL at the provider endpoint and AUTH_TOKEN at the real key", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(
      "sk-test-deepseek-DIRECTKEY-000000000000"
    );
  });

  it("maps all 4 model-alias slots to the chosen modelId by default", () => {
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env[SLOT_MODEL]).toBe("deepseek-v4pro");
    expect(env[SLOT_SONNET]).toBe("deepseek-v4pro");
    expect(env[SLOT_HAIKU]).toBe("deepseek-v4pro");
    expect(env[SLOT_SUBAGENT]).toBe("deepseek-v4pro");
  });

  it("blanks ANTHROPIC_API_KEY so an ambient key can never override AUTH_TOKEN", () => {
    // Phase 0 buildEnv sets ANTHROPIC_API_KEY:'' for exactly this reason.
    const env = buildConversationEnv(deepseekDirect, "deepseek-v4pro");
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("honors an envTemplate slot override while defaulting the untouched slots", () => {
    // deepseekWithTemplate remaps only the HAIKU slot to the flash model.
    const env = buildConversationEnv(deepseekWithTemplate, "deepseek-v4pro");
    expect(env[SLOT_HAIKU]).toBe("deepseek-v4flash"); // template wins
    expect(env[SLOT_MODEL]).toBe("deepseek-v4pro"); // default
    expect(env[SLOT_SONNET]).toBe("deepseek-v4pro"); // default
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
    expect(env[SLOT_MODEL]).toBe("claude-gpt-5.6-luna");
    expect(env[SLOT_SONNET]).toBe("claude-gpt-5.6-luna");
    expect(env[SLOT_HAIKU]).toBe("claude-gpt-5.6-luna");
    expect(env[SLOT_SUBAGENT]).toBe("claude-gpt-5.6-luna");
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
