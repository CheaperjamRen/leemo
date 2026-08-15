// Realistic Provider fixtures for Bridge B1 tests.
//
// Shapes mirror 06 §3.1 (Provider 目录) and the two wiring modes of §3.2:
//   - DeepSeek: apiFormat=anthropic → DIRECT wiring (real key rides ANTHROPIC_AUTH_TOKEN)
//   - relay2:   apiFormat=openai    → GATEWAY wiring (placeholder token, real key MUST NOT leak)
//
// All `apiKey` values are OBVIOUSLY FAKE test sentinels (test-key-…). The gateway
// fixture deliberately carries an apiKey so the "gateway env has no real key"
// assertion is a real leak test, not a vacuous one.

import type { Provider } from "../../../src/bridge/providers";

/** DeepSeek — cn_official, anthropic protocol → direct wiring. */
export const deepseekDirect: Provider = {
  id: "deepseek",
  name: "DeepSeek",
  category: "cn_official",
  apiFormat: "anthropic",
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKey: "test-key-deepseek-DIRECTKEY-000000000000",
  models: ["deepseek-v4pro", "deepseek-v4flash"],
  modelCapabilities: {
    "deepseek-v4pro": { thinking: true, vision: false },
    "deepseek-v4flash": { thinking: false, vision: false },
  },
  envTemplate: {},
};

/** DeepSeek variant whose envTemplate remaps the HAIKU slot to the flash model.
 *  Exercises "template override for one slot, modelId default for the rest". */
export const deepseekWithTemplate: Provider = {
  ...deepseekDirect,
  id: "deepseek-tpl",
  envTemplate: { ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4flash" },
};

/** relay2 — a custom OpenAI-protocol relay → gateway wiring. Carries a real-key
 *  sentinel that must never surface in the SDK child env. */
export const relay2Gateway: Provider = {
  id: "relay2",
  name: "Relay2 (中转站)",
  category: "custom",
  apiFormat: "openai",
  baseUrl: "https://relay.example.com/v1",
  apiKey: "test-key-relay-SHOULD-NEVER-LEAK-111111",
  models: ["gpt-5.6-luna"],
  modelCapabilities: { "gpt-5.6-luna": { thinking: false, vision: true } },
  envTemplate: {},
};

/** A second anthropic-direct provider (distinct id) for per-provider CONFIG_DIR
 *  isolation tests. */
export const glmDirect: Provider = {
  id: "glm",
  name: "智谱 GLM",
  category: "cn_official",
  apiFormat: "anthropic",
  baseUrl: "https://open.bigmodel.cn/api/anthropic",
  apiKey: "test-key-glm-DIRECTKEY-222222222222",
  models: ["glm-5", "glm-5-air"],
  modelCapabilities: { "glm-5": { thinking: true, vision: true } },
  envTemplate: {},
};
