/**
 * Provider catalog — the READ side of provider configuration (轮 3 卡 F).
 *
 * Folds two sources into the live list the host serves:
 *   1. `ProviderConfigFile` — what the user configured in the app (authoritative)
 *   2. `env`                — the `.env` dev/bootstrap channel (fallback only)
 *
 * ── Two invariants worth not breaking ─────────────────────────────────────
 * • Curated preset families are ALWAYS listed, with or without credentials, so the
 *   settings page can show 「还能配哪些家」 and the first-run wizard has something
 *   to offer. An unconfigured entry carries `spec.configured === false` and an
 *   EMPTY `provider.apiKey` — never a placeholder that could reach an upstream
 *   and come back as a mystery 401. Refusing to start a conversation on such an
 *   entry is the host's job (bridge-host), not this module's.
 * • `provider` carries the real key (process-in), `spec` never does (IPC
 *   projection). That boundary is 宪法级.
 *
 * `id` is an INSTANCE id and `kind` is the FAMILY: the presets pin `id === kind`
 * for stable back-references, and any number of extra instances of the same kind
 * (a second DeepSeek account, three relays) coexist with their own ids.
 */

import type { Provider, EnvTemplate, ModelCapabilities, ModelContextPolicy } from "../bridge/providers";
import { cloneModelCapabilityEvidenceMap } from "../bridge/model-capabilities";
import type {
  ModelCapabilityEvidence,
  ProviderApiFormat,
  ProviderAuthMode,
  ProviderCapabilities,
  ProviderProductKind,
  ProviderSpec,
  TaskModelRouting,
} from "../bridge/contract";
import type { ProviderConfigFile, StoredProvider } from "./provider-config";
import type { ProviderOpts } from "../gateway/core/provider-opts";

/**
 * 这家怎么提供**原生**联网搜索（轮 4 卡 H3，全部逐家实测）。
 *
 *   "passthrough" — 它自己的 anthropic 端点实现了 `web_search` 服务端工具，
 *                   把 CC 的嵌套搜索请求原样转发过去就有真结果（层①）。
 *   "vendorApi"   — 兼容层没实现，但厂商自己有搜索 API，转译过去（层②）。
 *   "none"        — 两条都实测不成立。**不猜端点**，直落层③外部源。
 *   undefined     — 没测过（自定义实例 / 中转站）。运行时试一次层①并记住结果。
 *
 * 这是**数据**而不是契约变更（B3 冻结时留的扩展轴，与 modelDiscovery/balanceApi
 * 同一先例）：将来某家上线了搜索，改这张表即可，判定逻辑一行不动。
 */
export interface NativeSearchSpec {
  mode: "passthrough" | "vendorApi" | "none";
  /** mode==="vendorApi" 时的适配器标签（见 vendor-search.ts）。 */
  vendor?: string;
  /** mode==="vendorApi" 时的搜索端点。baseUrl 被改过时会跟着换 host。 */
  searchApiUrl?: string;
  /** 实测日期 —— 厂商上线/下线搜索能力时，这一栏是判断"该复测了"的依据。 */
  measuredAt?: string;
}

export interface CatalogEntry {
  provider: Provider;
  spec: ProviderSpec;
  /** Host-only execution backend. This never enters ProviderSpec/IPC, so
   * product UI stays Leemo-native instead of exposing implementation brands. */
  executionEngine: "claude-agent-sdk" | "openai-app-server" | "gemini-acp";
  balanceBaseUrl?: string;
  /** Vendor endpoint that lists models. NOT derivable from baseUrl — 卡 F
   *  Providers expose different URL and payload shapes, so this stays explicit. */
  modelsUrl?: string;
  /** Authentication header used by setup probes/discovery. Runtime wiring is
   * still handled by the native Harness/gateway path. */
  apiKeyHeader?: "authorization" | "x-api-key";
  /** Extra request headers (relays / private gateways). */
  headers?: Record<string, string>;
  /** 原生搜索能力（轮 4 卡 H3 实测）。undefined = 未测，运行时探。 */
  nativeSearch?: NativeSearchSpec;
  /** Product-level task choices; internal aliases stay on `provider`. */
  taskModelRouting?: TaskModelRouting;
  gatewayOpts?: Partial<ProviderOpts>;
}

/** A preset family definition. Exported so the settings page and the tests read
 *  the same table the catalog builds from. */
export interface PresetProvider {
  /** Stable canonical instance id — equals `kind` for every preset. */
  id: string;
  kind: string;
  name: string;
  baseUrl: string;
  modelsUrl?: string;
  apiFormat: ProviderApiFormat;
  authMode: ProviderAuthMode;
  productKind: ProviderProductKind;
  searchAliases?: readonly string[];
  summary?: string;
  gatewayOpts?: Partial<ProviderOpts>;
  apiKeyHeader?: "authorization" | "x-api-key";
  category: "cn_official" | "official" | "custom";
  executionEngine?: CatalogEntry["executionEngine"];
  /** Curated picks; `models[0]` is the family default. */
  models: readonly string[];
  modelCapabilities: Readonly<Record<string, ModelCapabilities>>;
  capabilities: ProviderCapabilities;
  apiKeyUrl?: string;
  keyEnv?: string;
  modelEnv?: string;
  /** Only 通义 has one: users get a per-workspace域名 that is faster for them. */
  baseUrlEnv?: string;
  balanceBaseUrl?: string;
  /** 原生联网搜索机制（轮 4 卡 H3 逐家实测，见 NativeSearchSpec）。 */
  nativeSearch?: NativeSearchSpec;
}

const COMMON = {
  apiFormat: "anthropic",
  authMode: "api-key",
  productKind: "metered-api",
  category: "cn_official",
} as const;

/**
 * The original four preset families use 主控 probe data (real requests,
 * 2026-07-26). Later additions use their vendors' official API documentation.
 * Do not "improve" the model names or endpoints here: each was measured.
 * `balanceApi` is per-family measured truth (GLM and 百炼 have no balance
 * endpoint), and `qwen3.7-max` really does lack vision while its siblings have
 * it. DeepSeek accepts an image block and answers 200 while saying it cannot see
 * the image — hence `vision:false` despite the 200.
 */
export const PRESET_PROVIDERS: readonly PresetProvider[] = [
  {
    ...COMMON,
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    modelsUrl: "https://api.deepseek.com/models",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    modelCapabilities: {
      "deepseek-v4-flash": { thinking: true, vision: false },
      "deepseek-v4-pro": { thinking: true, vision: false },
    },
    capabilities: {
      balanceApi: true,
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    // Balance lives at the bare host, not under /anthropic (B2 balance.ts).
    balanceBaseUrl: "https://api.deepseek.com",
    // 实测 2026-07-27：自家 anthropic 端点真的实现了 web_search 服务端工具 ——
    // JSON 臂 10 个 url、SSE 臂 10 个 url，且回 usage.server_tool_use
    // .web_search_requests=1（= 确实计在用户自己的额度上）。走层① 原样透传。
    nativeSearch: { mode: "passthrough", measuredAt: "2026-07-27" },
  },
  {
    ...COMMON,
    id: "glm",
    kind: "glm",
    name: "GLM（智谱）",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    modelsUrl: "https://open.bigmodel.cn/api/anthropic/v1/models",
    models: ["glm-5.2", "glm-4.7", "glm-4.5-air"],
    modelCapabilities: {
      "glm-5.2": { thinking: true, vision: true },
      "glm-4.7": { thinking: true, vision: true },
      "glm-4.5-air": { thinking: true, vision: true },
    },
    capabilities: {
      balanceApi: false, // measured: 智谱 exposes no balance endpoint
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    keyEnv: "GLM_API_KEY",
    modelEnv: "GLM_MODEL",
    // 实测 2026-07-27：anthropic 兼容层**没有**实现服务端工具 —— HTTP 200、零链接、
    // 模型自陈"我无法执行实时网络搜索"（台账点名的"空壳"）。但智谱自己有独立搜索
    // 端点，10 条 / 1558ms、当天真新闻 ⇒ 走层② 转译。详见 vendor-search.ts。
    nativeSearch: {
      mode: "vendorApi",
      vendor: "glm",
      searchApiUrl: "https://open.bigmodel.cn/api/paas/v4/web_search",
      measuredAt: "2026-07-27",
    },
  },
  {
    ...COMMON,
    id: "kimi",
    kind: "kimi",
    name: "Kimi（月之暗面）",
    baseUrl: "https://api.moonshot.cn/anthropic",
    modelsUrl: "https://api.moonshot.cn/v1/models",
    models: ["kimi-k2.5", "kimi-k3", "kimi-k2.6"],
    modelCapabilities: {
      "kimi-k2.5": { thinking: true, vision: true },
      "kimi-k3": { thinking: true, vision: true },
      "kimi-k2.6": { thinking: true, vision: true },
    },
    capabilities: {
      balanceApi: true,
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    keyEnv: "KIMI_API_KEY",
    modelEnv: "KIMI_MODEL",
    // No balanceBaseUrl: balance.ts hardcodes Moonshot's own balance endpoint.
    // 实测 2026-07-27：**台账 §⑧ 从未测过 Kimi，这是本轮新发现** —— 它的 anthropic
    // 端点同样实现了 web_search 服务端工具（JSON 臂 14 个 url、SSE 臂 7 个）。代价是
    // 慢：22~30s（DeepSeek 5s）。走层① 透传。
    nativeSearch: { mode: "passthrough", measuredAt: "2026-07-27" },
  },
  {
    ...COMMON,
    id: "qwen",
    kind: "qwen",
    name: "通义千问（百炼）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelsUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    apiFormat: "openai",
    models: ["qwen3.7-flash", "qwen3.7-plus", "qwen3.7-max"],
    modelCapabilities: {
      "qwen3.7-flash": { thinking: true, vision: true },
      "qwen3.7-plus": { thinking: true, vision: true },
      "qwen3.7-max": { thinking: true, vision: false }, // measured exception
    },
    capabilities: {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    keyEnv: "DASHSCOPE_API_KEY",
    modelEnv: "QWEN_MODEL",
    baseUrlEnv: "QWEN_BASE_URL",
    // 实测 2026-07-27：两条路都不成立，**六个变量全试过**（
    // smoke/probe-native-search-l2.mjs + -qwen.mjs）：
    //   · anthropic 端点无服务端工具 ⇒ 空壳
    //   · compatible-mode `enable_search` + search_options（forced_search/
    //     enable_source/enable_citation）、裸 enable_search、流式、qwen-plus、
    //     qwen-max、DashScope 原生协议 —— 全部 **零个 url**
    // 最像"能用"的那次最危险：HTTP 200、正文带 `[1][3]` 角标、报了具体气温，但
    // 引的是 7月22日 的数据（当天是 7月27日）且拿不到任何来源链接。照卡 F「200
    // 会骗人」的纪律记为 none —— **不编端点**，直落层③外部源。
    nativeSearch: { mode: "none", measuredAt: "2026-07-27" },
  },
  {
    id: "openai",
    kind: "openai",
    name: "OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    modelsUrl: "https://api.openai.com/v1/models",
    apiFormat: "openai-responses",
    authMode: "api-key",
    productKind: "metered-api",
    category: "official",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: true },
    apiKeyUrl: "https://platform.openai.com/api-keys",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    searchAliases: ["GPT", "Responses", "OpenAI 官方 API"],
  },
  {
    id: "anthropic",
    kind: "anthropic",
    name: "Anthropic API",
    baseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic",
    authMode: "api-key",
    productKind: "metered-api",
    category: "official",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false, requiresProxy: true },
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    searchAliases: ["Claude", "Anthropic 官方 API"],
  },
  {
    id: "claude-subscription",
    kind: "claude-subscription",
    name: "Claude 订阅",
    // Native subscription traffic is selected by authMode and intentionally
    // carries no endpoint override. The isolated account directory is the
    // source of truth for both login and runtime.
    baseUrl: "",
    apiFormat: "anthropic",
    authMode: "oauth-subscription",
    productKind: "consumer-subscription",
    category: "official",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true, requiresProxy: true },
    searchAliases: ["Claude Pro", "Claude Max", "Claude 订阅登录"],
    summary: "使用已有 Claude 订阅登录，无需 API Key",
  },
  {
    id: "chatgpt-subscription",
    kind: "chatgpt-subscription",
    name: "ChatGPT 订阅",
    baseUrl: "",
    apiFormat: "openai-responses",
    authMode: "oauth-subscription",
    productKind: "consumer-subscription",
    category: "official",
    executionEngine: "openai-app-server",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true, requiresProxy: true },
    searchAliases: ["ChatGPT Plus", "ChatGPT Pro", "OpenAI 订阅登录"],
    summary: "使用已有 ChatGPT 订阅，无需 API Key",
  },
  {
    id: "gemini-subscription",
    kind: "gemini-subscription",
    name: "Gemini 订阅",
    baseUrl: "",
    apiFormat: "openai",
    authMode: "oauth-subscription",
    productKind: "consumer-subscription",
    category: "official",
    executionEngine: "gemini-acp",
    models: ["auto", "gemini-2.5-pro", "gemini-2.5-flash"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true, requiresProxy: true },
    searchAliases: ["Google AI Pro", "Google AI Ultra", "Gemini 登录"],
    summary: "使用已有 Gemini 订阅，无需 API Key",
  },
  {
    id: "tokenflux",
    kind: "tokenflux",
    name: "TokenFlux",
    baseUrl: "https://tokenflux.dev/v1",
    modelsUrl: "https://tokenflux.dev/v1/models",
    apiFormat: "openai-responses",
    authMode: "api-key",
    productKind: "aggregator",
    category: "official",
    models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: false },
    apiKeyUrl: "https://tokenflux.dev",
    keyEnv: "TOKENFLUX_API_KEY",
    modelEnv: "TOKENFLUX_MODEL",
    searchAliases: ["词元流动", "GPT 中转", "Responses"],
  },
  {
    id: "kimi-code",
    kind: "kimi-code",
    name: "Kimi Code",
    baseUrl: "https://api.kimi.com/coding/",
    modelsUrl: "https://api.kimi.com/coding/v1/models",
    apiFormat: "anthropic",
    authMode: "plan-key",
    productKind: "coding-plan",
    category: "cn_official",
    models: ["kimi-for-coding", "kimi-for-coding-highspeed"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: true, requiresProxy: false },
    apiKeyUrl: "https://www.kimi.com/code",
    keyEnv: "KIMI_CODE_API_KEY",
    modelEnv: "KIMI_CODE_MODEL",
    searchAliases: ["Kimi Coding Plan", "月之暗面套餐", "Kimi 编程套餐"],
  },
  {
    id: "glm-coding-plan",
    kind: "glm-coding-plan",
    name: "GLM Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    modelsUrl: "https://open.bigmodel.cn/api/anthropic/v1/models",
    apiFormat: "anthropic",
    authMode: "plan-key",
    productKind: "coding-plan",
    category: "cn_official",
    models: ["glm-5.2", "glm-4.7"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: true, requiresProxy: false },
    apiKeyUrl: "https://open.bigmodel.cn/subscribe",
    keyEnv: "GLM_CODING_PLAN_API_KEY",
    modelEnv: "GLM_CODING_PLAN_MODEL",
    searchAliases: ["智谱编程套餐", "GLM 套餐"],
  },
  {
    id: "qwen-coding-plan",
    kind: "qwen-coding-plan",
    name: "通义 Coding Plan",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    apiFormat: "anthropic",
    authMode: "plan-key",
    productKind: "coding-plan",
    category: "cn_official",
    models: ["qwen3.5-plus", "qwen3-coder-plus"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true, requiresProxy: false },
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    keyEnv: "QWEN_CODING_PLAN_API_KEY",
    modelEnv: "QWEN_CODING_PLAN_MODEL",
    searchAliases: ["百炼 Coding Plan", "阿里云编程套餐", "千问套餐"],
  },
  {
    id: "qwen-token-plan",
    kind: "qwen-token-plan",
    name: "通义 Token Plan",
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    apiFormat: "anthropic",
    authMode: "plan-key",
    productKind: "coding-plan",
    category: "cn_official",
    models: ["qwen3.5-plus", "qwen3-coder-plus"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: true, requiresProxy: false },
    apiKeyUrl: "https://bailian.console.aliyun.com/",
    keyEnv: "QWEN_TOKEN_PLAN_API_KEY",
    modelEnv: "QWEN_TOKEN_PLAN_MODEL",
    searchAliases: ["百炼 Token Plan", "阿里云包月套餐", "千问套餐"],
  },
  {
    id: "minimax-token-plan",
    kind: "minimax-token-plan",
    name: "MiniMax Token Plan",
    baseUrl: "https://api.minimaxi.com/anthropic",
    modelsUrl: "https://api.minimaxi.com/anthropic/v1/models",
    apiFormat: "anthropic",
    authMode: "plan-key",
    productKind: "coding-plan",
    apiKeyHeader: "x-api-key",
    category: "cn_official",
    models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: true, requiresProxy: false },
    apiKeyUrl: "https://platform.minimaxi.com/",
    keyEnv: "MINIMAX_TOKEN_PLAN_API_KEY",
    modelEnv: "MINIMAX_TOKEN_PLAN_MODEL",
    searchAliases: ["MiniMax 套餐", "海螺编程套餐"],
  },
  {
    id: "volcengine-coding-plan",
    kind: "volcengine-coding-plan",
    name: "火山方舟 Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    apiFormat: "anthropic",
    authMode: "plan-key",
    productKind: "coding-plan",
    category: "cn_official",
    models: ["ark-code-latest"],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: false,
      subscriptionPlan: true,
      requiresProxy: false,
    },
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
    keyEnv: "ARK_CODING_PLAN_API_KEY",
    modelEnv: "ARK_CODING_PLAN_MODEL",
    searchAliases: ["豆包编程套餐", "火山 Coding Plan", "Ark Coding Plan"],
  },
  {
    id: "mimo",
    kind: "mimo",
    name: "MiMo API",
    baseUrl: "https://api.xiaomimimo.com/v1",
    modelsUrl: "https://api.xiaomimimo.com/v1/models",
    apiFormat: "openai-responses",
    authMode: "api-key",
    productKind: "metered-api",
    category: "cn_official",
    models: [],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: false },
    apiKeyUrl: "https://platform.xiaomimimo.com/",
    keyEnv: "MIMO_API_KEY",
    modelEnv: "MIMO_MODEL",
    searchAliases: ["小米 MiMo", "小米大模型"],
    gatewayOpts: { responsesDialect: "mimo" },
  },
  {
    id: "mimo-token-plan",
    kind: "mimo-token-plan",
    name: "MiMo Token Plan",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    modelsUrl: "https://token-plan-cn.xiaomimimo.com/v1/models",
    apiFormat: "openai-responses",
    authMode: "plan-key",
    productKind: "coding-plan",
    category: "cn_official",
    models: [],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: true, requiresProxy: false },
    apiKeyUrl: "https://platform.xiaomimimo.com/",
    keyEnv: "MIMO_TOKEN_PLAN_API_KEY",
    modelEnv: "MIMO_TOKEN_PLAN_MODEL",
    searchAliases: ["小米套餐", "MiMo 编程套餐"],
    gatewayOpts: { responsesDialect: "mimo" },
  },
  {
    id: "nvidia",
    kind: "nvidia",
    name: "NVIDIA API Catalog",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    modelsUrl: "https://integrate.api.nvidia.com/v1/models",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "metered-api",
    category: "official",
    models: [],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: true },
    apiKeyUrl: "https://build.nvidia.com/",
    keyEnv: "NVIDIA_API_KEY",
    modelEnv: "NVIDIA_MODEL",
    searchAliases: ["NVIDIA NIM", "英伟达模型"],
  },
  {
    id: "gemini",
    kind: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "metered-api",
    category: "official",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: true },
    apiKeyUrl: "https://aistudio.google.com/apikey",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    searchAliases: ["谷歌 Gemini", "Google AI Studio"],
  },
  {
    id: "modelscope",
    kind: "modelscope",
    name: "ModelScope 魔搭",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    modelsUrl: "https://api-inference.modelscope.cn/v1/models",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "aggregator",
    category: "cn_official",
    models: [],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: false },
    apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    keyEnv: "MODELSCOPE_API_KEY",
    modelEnv: "MODELSCOPE_MODEL",
    searchAliases: ["魔搭社区", "阿里 ModelScope"],
  },
  {
    id: "groq",
    kind: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modelsUrl: "https://api.groq.com/openai/v1/models",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "metered-api",
    category: "official",
    models: [],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: true, subscriptionPlan: false, requiresProxy: true },
    apiKeyUrl: "https://console.groq.com/keys",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    searchAliases: ["GroqCloud", "高速推理"],
  },
  {
    id: "huawei-maas",
    kind: "huawei-maas",
    name: "华为云 MaaS（openPangu）",
    baseUrl: "https://api.modelarts-maas.com/openai/v1",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "metered-api",
    category: "cn_official",
    models: [],
    modelCapabilities: {},
    capabilities: { balanceApi: false, modelDiscovery: false, subscriptionPlan: false, requiresProxy: false },
    apiKeyUrl: "https://console.huaweicloud.com/modelarts/",
    keyEnv: "HUAWEI_MAAS_API_KEY",
    modelEnv: "HUAWEI_MAAS_MODEL",
    searchAliases: ["openPangu", "盘古大模型", "ModelArts MaaS"],
    summary: "模型名请从华为云部署详情复制",
  },
  {
    id: "minimax",
    kind: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/anthropic",
    modelsUrl: "https://api.minimaxi.com/anthropic/v1/models",
    apiFormat: "anthropic",
    authMode: "api-key",
    productKind: "metered-api",
    apiKeyHeader: "x-api-key",
    category: "cn_official",
    models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5"],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://platform.minimaxi.com/",
    keyEnv: "MINIMAX_API_KEY",
    modelEnv: "MINIMAX_MODEL",
  },
  {
    id: "doubao",
    kind: "doubao",
    name: "豆包（火山方舟）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "metered-api",
    category: "cn_official",
    // Official quickstart example verified 2026-08-03. Users can replace it
    // with another enabled Ark model/endpoint id in the same setup page.
    models: ["doubao-seed-2-0-lite-260215"],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: false,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
    keyEnv: "ARK_API_KEY",
    modelEnv: "ARK_MODEL",
  },
  {
    id: "siliconflow",
    kind: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    modelsUrl: "https://api.siliconflow.cn/v1/models",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "metered-api",
    category: "cn_official",
    models: [],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: false,
    },
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
    keyEnv: "SILICONFLOW_API_KEY",
    modelEnv: "SILICONFLOW_MODEL",
  },
  {
    id: "openrouter",
    kind: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    apiFormat: "openai",
    authMode: "api-key",
    productKind: "aggregator",
    category: "official",
    models: [],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      requiresProxy: true,
    },
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
  },
  {
    id: "ollama",
    kind: "ollama",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    modelsUrl: "http://127.0.0.1:11434/v1/models",
    apiFormat: "openai",
    authMode: "none",
    productKind: "local",
    category: "official",
    models: [],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      local: true,
      requiresProxy: false,
    },
  },
  {
    id: "lmstudio",
    kind: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    modelsUrl: "http://127.0.0.1:1234/v1/models",
    apiFormat: "openai",
    authMode: "none",
    productKind: "local",
    category: "official",
    models: [],
    modelCapabilities: {},
    capabilities: {
      balanceApi: false,
      modelDiscovery: true,
      subscriptionPlan: false,
      local: true,
      requiresProxy: false,
    },
  },
];

const PRESET_BY_ID = new Map(PRESET_PROVIDERS.map((p) => [p.id, p]));
const PRESET_BY_KIND = new Map(PRESET_PROVIDERS.map((p) => [p.kind, p]));

/** Internal request-auth metadata for unsaved additional instances. */
export function providerApiKeyHeaderForKind(
  kind: string | undefined,
): "authorization" | "x-api-key" | undefined {
  return kind ? PRESET_BY_KIND.get(kind)?.apiKeyHeader : undefined;
}

function taskModelRoutingForStored(stored: StoredProvider | undefined): TaskModelRouting | undefined {
  if (!stored) return undefined;
  if (stored.taskModelRouting !== undefined) {
    return {
      ...(stored.taskModelRouting.fastModelId?.trim()
        ? { fastModelId: stored.taskModelRouting.fastModelId.trim() }
        : {}),
      ...(stored.taskModelRouting.subagentModelId?.trim()
        ? { subagentModelId: stored.taskModelRouting.subagentModelId.trim() }
        : {}),
    };
  }
  if (!stored.envTemplate) return undefined;
  const fastModelId = stored.envTemplate.ANTHROPIC_DEFAULT_HAIKU_MODEL
    ?? stored.envTemplate.ANTHROPIC_SMALL_FAST_MODEL;
  return {
    ...(fastModelId?.trim() ? { fastModelId: fastModelId.trim() } : {}),
    ...(stored.envTemplate.CLAUDE_CODE_SUBAGENT_MODEL?.trim()
      ? { subagentModelId: stored.envTemplate.CLAUDE_CODE_SUBAGENT_MODEL.trim() }
      : {}),
  };
}

function envTemplateForTaskRouting(routing: TaskModelRouting | undefined): EnvTemplate {
  const out: EnvTemplate = {};
  if (routing?.fastModelId) {
    out.ANTHROPIC_DEFAULT_HAIKU_MODEL = routing.fastModelId;
  }
  if (routing?.subagentModelId) {
    out.CLAUDE_CODE_SUBAGENT_MODEL = routing.subagentModelId;
  }
  return out;
}

/** 通义's workspace override changes the HOST, so the discovery URL has to move
 *  with it — same host, `/compatible-mode/v1/models`. Falls back to the preset
 *  URL if the override isn't a parseable absolute URL. */
function modelsUrlForHost(baseUrl: string, presetModelsUrl: string): string {
  try {
    const u = new URL(baseUrl);
    const path = new URL(presetModelsUrl).pathname;
    return `${u.origin}${path}`;
  } catch {
    return presetModelsUrl;
  }
}

/**
 * 搜索端点也得跟着 baseUrl 换 host（同 modelsUrlForHost 的理由）：用户把 GLM 指到
 * 自己的代理域名时，搜索请求还发去 open.bigmodel.cn 就会拿他的 key 去打官方 ——
 * 要么 401，要么绕过了他刻意选的通道。baseUrl 没被改动时原样保留。
 */
function nativeSearchForHost(spec: NativeSearchSpec, baseUrl: string, presetBaseUrl: string): NativeSearchSpec {
  if (baseUrl === presetBaseUrl || !spec.searchApiUrl) return spec;
  try {
    const path = new URL(spec.searchApiUrl).pathname;
    return { ...spec, searchApiUrl: `${new URL(baseUrl).origin}${path}` };
  } catch {
    return spec;
  }
}

/** Put `first` at the head of `rest` without duplicating it. */
function hoist(first: string | undefined, rest: readonly string[]): string[] {
  if (!first) return [...rest];
  return [first, ...rest.filter((m) => m !== first)];
}

interface Resolved {
  id: string;
  kind: string;
  name: string;
  baseUrl: string;
  apiFormat: ProviderApiFormat;
  authMode: ProviderAuthMode;
  productKind: ProviderProductKind;
  searchAliases?: string[];
  summary?: string;
  category: "cn_official" | "official" | "custom";
  executionEngine: CatalogEntry["executionEngine"];
  apiKey: string;
  models: string[];
  modelCapabilities: Record<string, ModelCapabilities>;
  modelContextPolicies?: Record<string, ModelContextPolicy>;
  modelCapabilityEvidence?: Record<string, ModelCapabilityEvidence>;
  taskModelRouting?: TaskModelRouting;
  capabilities: ProviderCapabilities;
  envTemplate: EnvTemplate;
  headers?: Record<string, string>;
  modelsUrl?: string;
  apiKeyHeader?: "authorization" | "x-api-key";
  apiKeyUrl?: string;
  balanceBaseUrl?: string;
  nativeSearch?: NativeSearchSpec;
  gatewayOpts?: Partial<ProviderOpts>;
  saved: boolean;
}

const FALLBACK_CAPS: ProviderCapabilities = {
  balanceApi: false,
  modelDiscovery: false,
  subscriptionPlan: false,
};

function toEntry(r: Resolved): CatalogEntry {
  const provider: Provider = {
    id: r.id,
    name: r.name,
    category: r.category,
    apiFormat: r.apiFormat,
    authMode: r.authMode,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    models: r.models,
    modelCapabilities: r.modelCapabilities,
    ...(r.modelContextPolicies ? {
      modelContextPolicies: Object.fromEntries(
        Object.entries(r.modelContextPolicies).map(([modelId, policy]) => [modelId, { ...policy }]),
      ),
    } : {}),
    envTemplate: r.envTemplate,
  };
  const spec: ProviderSpec = {
    id: r.id,
    name: r.name,
    kind: r.kind,
    category: r.category,
    apiFormat: r.apiFormat,
    authMode: r.authMode,
    productKind: r.productKind,
    ...(r.searchAliases ? { searchAliases: [...r.searchAliases] } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    baseUrl: r.baseUrl,
    models: r.models,
    modelCapabilities: r.modelCapabilities,
    ...(r.modelContextPolicies ? {
      modelContextPolicies: Object.fromEntries(
        Object.entries(r.modelContextPolicies).map(([modelId, policy]) => [modelId, { ...policy }]),
      ),
    } : {}),
    capabilities: r.capabilities,
    // Local services deliberately have no key; they become usable after the
    // user saves at least one concrete model. Cloud/API instances need both.
    configured: r.models.length > 0 && (
      r.authMode === "none" || r.authMode === "oauth-subscription"
        ? r.saved
        : r.apiKey.length > 0
    ),
    saved: r.saved,
  };
  if (r.modelCapabilityEvidence) {
    spec.modelCapabilityEvidence = cloneModelCapabilityEvidenceMap(r.modelCapabilityEvidence);
  }
  if (r.apiKeyUrl) spec.apiKeyUrl = r.apiKeyUrl;
  if (r.modelsUrl) spec.modelsUrl = r.modelsUrl;

  const entry: CatalogEntry = { provider, spec, executionEngine: r.executionEngine };
  if (r.balanceBaseUrl) entry.balanceBaseUrl = r.balanceBaseUrl;
  if (r.modelsUrl) entry.modelsUrl = r.modelsUrl;
  if (r.apiKeyHeader) entry.apiKeyHeader = r.apiKeyHeader;
  if (r.headers) entry.headers = r.headers;
  // 缺省不写 ⇒ 保持 undefined = "没实测过"，与 mode:"none"（实测不成立）刻意区分：
  // 前者运行时探一次层①，后者直接跳过。
  if (r.nativeSearch) entry.nativeSearch = r.nativeSearch;
  if (r.taskModelRouting !== undefined) entry.taskModelRouting = { ...r.taskModelRouting };
  if (r.gatewayOpts) entry.gatewayOpts = { ...r.gatewayOpts };
  return entry;
}

/** Resolve one PRESET family: stored instance (if any) over env over preset. */
function resolvePreset(
  preset: PresetProvider,
  env: Record<string, string | undefined>,
  stored: StoredProvider | undefined,
): Resolved {
  // Key precedence: app config > env. `.env` is the bootstrap channel only.
  const apiKey = stored?.apiKey || (preset.keyEnv ? env[preset.keyEnv] : undefined) || "";

  const envBaseUrl = preset.baseUrlEnv ? env[preset.baseUrlEnv] : undefined;
  const baseUrl = stored?.baseUrl || envBaseUrl || preset.baseUrl;
  const apiFormat = stored?.apiFormat ?? (
    preset.kind === "qwen" && envBaseUrl && /\/apps\/anthropic\/?$/i.test(baseUrl)
      ? "anthropic"
      : preset.apiFormat
  );

  const storedModelsUrl = stored?.modelsUrl;
  const modelsUrl = storedModelsUrl ?? (preset.modelsUrl
    ? (baseUrl === preset.baseUrl ? preset.modelsUrl : modelsUrlForHost(baseUrl, preset.modelsUrl))
    : undefined);

  // Stored list wins; otherwise the curated picks, with <KIND>_MODEL hoisted to
  // the default slot so a dev's .env pin still decides models[0].
  const models = stored?.models
    ? [...stored.models]
    : hoist(preset.modelEnv ? env[preset.modelEnv] : undefined, preset.models);
  const taskModelRouting = taskModelRoutingForStored(stored);

  return {
    id: preset.id,
    kind: preset.kind,
    name: stored?.name || preset.name,
    baseUrl,
    apiFormat,
    authMode: stored?.authMode ?? preset.authMode,
    productKind: stored?.productKind ?? preset.productKind,
    searchAliases: preset.searchAliases ? [...preset.searchAliases] : undefined,
    summary: preset.summary,
    category: stored?.category ?? preset.category,
    executionEngine: preset.executionEngine ?? "claude-agent-sdk",
    apiKey,
    models,
    modelCapabilities: { ...preset.modelCapabilities, ...(stored?.modelCapabilities ?? {}) },
    modelContextPolicies: stored?.modelContextPolicies,
    modelCapabilityEvidence: stored?.modelCapabilityEvidence,
    taskModelRouting,
    capabilities: { ...preset.capabilities, ...(stored?.capabilities ?? {}) },
    envTemplate: envTemplateForTaskRouting(taskModelRouting),
    headers: stored?.headers,
    modelsUrl,
    apiKeyHeader: preset.apiKeyHeader,
    apiKeyUrl: stored?.apiKeyUrl || preset.apiKeyUrl,
    balanceBaseUrl: preset.balanceBaseUrl,
    nativeSearch: preset.nativeSearch
      ? nativeSearchForHost(preset.nativeSearch, baseUrl, preset.baseUrl)
      : undefined,
    gatewayOpts: preset.gatewayOpts ? { ...preset.gatewayOpts } : undefined,
    saved: stored !== undefined,
  };
}

/** Resolve one NON-preset instance. A same-kind instance inherits the family's
 *  convenience data (modelsUrl / apiKeyUrl / capabilities / per-model flags) but
 *  NEVER its env key: a second DeepSeek account must not silently authenticate
 *  as the first one. */
function resolveCustom(id: string, stored: StoredProvider): Resolved {
  const family = PRESET_BY_KIND.get(stored.kind);
  const modelsUrl =
    stored.modelsUrl ??
    (family?.modelsUrl
      ? stored.baseUrl === family.baseUrl
        ? family.modelsUrl
        : modelsUrlForHost(stored.baseUrl, family.modelsUrl)
      : undefined);
  const taskModelRouting = taskModelRoutingForStored(stored);

  return {
    id,
    kind: stored.kind,
    name: stored.name,
    baseUrl: stored.baseUrl,
    apiFormat: stored.apiFormat,
    authMode: stored.authMode ?? family?.authMode ?? "api-key",
    productKind: stored.productKind ?? family?.productKind ?? "self-hosted",
    searchAliases: family?.searchAliases ? [...family.searchAliases] : undefined,
    summary: family?.summary,
    category: stored.category,
    executionEngine: family?.executionEngine ?? "claude-agent-sdk",
    apiKey: stored.apiKey || "",
    models: stored.models ? [...stored.models] : family ? [...family.models] : [],
    modelCapabilities: { ...(family?.modelCapabilities ?? {}), ...(stored.modelCapabilities ?? {}) },
    modelContextPolicies: stored.modelContextPolicies,
    modelCapabilityEvidence: stored.modelCapabilityEvidence,
    taskModelRouting,
    capabilities: {
      ...(family?.capabilities ?? FALLBACK_CAPS),
      ...(stored.capabilities ?? {}),
    },
    envTemplate: envTemplateForTaskRouting(taskModelRouting),
    headers: stored.headers,
    modelsUrl,
    apiKeyHeader: family?.apiKeyHeader,
    apiKeyUrl: stored.apiKeyUrl || family?.apiKeyUrl,
    balanceBaseUrl: family?.balanceBaseUrl,
    // 同 kind 的额外实例继承家族的搜索机制（第二个 DeepSeek 账号照样能搜），但
    // **未知 kind 一律留 undefined** —— 中转站/自建端点没实测过，交给运行时探层①
    // 并记住结果，而不是替它宣称"能"或"不能"。
    nativeSearch: family?.nativeSearch
      ? nativeSearchForHost(family.nativeSearch, stored.baseUrl, family.baseUrl)
      : undefined,
    gatewayOpts: family?.gatewayOpts ? { ...family.gatewayOpts } : undefined,
    saved: true,
  };
}

/**
 * Build the live catalog: curated presets (always) followed by every custom
 * instance in config insertion order.
 *
 * @param env    process env / decrypted bootstrap source
 * @param config the user's saved provider config (omit for env-only, e.g. the
 *               ws dev harness which has no Electron safeStorage)
 */
export function buildCatalog(
  env: Record<string, string | undefined>,
  config?: ProviderConfigFile,
): CatalogEntry[] {
  const stored = config?.providers ?? {};
  const entries: CatalogEntry[] = PRESET_PROVIDERS.map((preset) =>
    toEntry(resolvePreset(preset, env, stored[preset.id])),
  );

  for (const [id, instance] of Object.entries(stored)) {
    if (PRESET_BY_ID.has(id)) continue; // already folded in above
    entries.push(toEntry(resolveCustom(id, instance)));
  }

  return entries;
}
