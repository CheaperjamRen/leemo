// 轮 4 卡 H：搜索 key 的来源优先级。
// 钉住三件容易静默出错的事：加密件优先于环境变量、坏加密件退化而不炸、
// 全空也返回可用对象（默认源 AnySearch 免 key，全空照样能搜）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadSearchKeys, type ProviderConfigStore } from "../../src/host/bridge-host";
import type { ProviderConfigFile } from "../../src/host/provider-config";

function storeOf(searchKeys: ProviderConfigFile["searchKeys"]): ProviderConfigStore {
  return {
    read: () => ({ version: 1, providers: {}, searchKeys }),
    write: () => {},
  };
}

const ENV_NAMES = [
  "ANYSEARCH_API_KEY",
  "TAVILY_API_KEY",
  "BOCHA_API_KEY",
  "DOUBAO_SEARCH_API_KEY",
  "METASO_API_KEY",
  "GOOGLE_SEARCH_API_KEY",
  "GOOGLE_SEARCH_ENGINE_ID",
  "EXA_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "SERPAPI_API_KEY",
  "SERPER_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;

describe("loadSearchKeys", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const n of ENV_NAMES) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
  });
  afterEach(() => {
    for (const n of ENV_NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  it("读加密件里存的 key（用户在设置页存的那把要真被用上）", () => {
    const keys = loadSearchKeys(storeOf({
      tavily: "tvly-stored",
      bocha: "sk-b",
      doubao: "doubao-key",
      metaso: "metaso-key",
      google: "google-key",
      googleCx: "google-cx",
      exa: "exa-key",
      brave: "brave-key",
      serpapi: "serpapi-key",
      serper: "serper-key",
      firecrawl: "firecrawl-key",
    }));
    expect(keys.tavilyKey).toBe("tvly-stored");
    expect(keys.bochaKey).toBe("sk-b");
    expect(keys.doubaoKey).toBe("doubao-key");
    expect(keys.metasoKey).toBe("metaso-key");
    expect(keys.googleKey).toBe("google-key");
    expect(keys.googleCx).toBe("google-cx");
    expect(keys.exaKey).toBe("exa-key");
    expect(keys.braveKey).toBe("brave-key");
    expect(keys.serpapiKey).toBe("serpapi-key");
    expect(keys.serperKey).toBe("serper-key");
    expect(keys.firecrawlKey).toBe("firecrawl-key");
  });

  it("加密件优先于环境变量 —— 用户在界面上明确存过的东西，不该被一个陈旧的环境变量悄悄盖掉", () => {
    process.env.TAVILY_API_KEY = "tvly-from-env";
    const keys = loadSearchKeys(storeOf({ tavily: "tvly-stored" }));
    expect(keys.tavilyKey).toBe("tvly-stored");
  });

  it("加密件里没有那一项时，才退到环境变量（探针脚本与 CI 靠它）", () => {
    process.env.TAVILY_API_KEY = "tvly-from-env";
    const keys = loadSearchKeys(storeOf({ anysearch: "as-stored" }));
    expect(keys.anysearchKey).toBe("as-stored");
    expect(keys.tavilyKey).toBe("tvly-from-env");
  });

  it("空串/纯空白视为没存，继续退到环境变量", () => {
    process.env.TAVILY_API_KEY = "tvly-from-env";
    const keys = loadSearchKeys(storeOf({ tavily: "   " }));
    expect(keys.tavilyKey).toBe("tvly-from-env");
  });

  it("加密件读取抛异常时退化而不炸 —— 免 key 的默认源必须照常可用", () => {
    process.env.TAVILY_API_KEY = "tvly-from-env";
    const broken: ProviderConfigStore = {
      read: () => {
        throw new Error("cannot decrypt");
      },
      write: () => {},
    };
    const keys = loadSearchKeys(broken);
    expect(keys.tavilyKey).toBe("tvly-from-env");
  });

  it("没有 store 也不炸（dev/测试路径没配 providerStore）", () => {
    expect(() => loadSearchKeys(undefined)).not.toThrow();
  });

  it("全空返回全 undefined —— 但这不是错误状态：AnySearch 免 key，搜索照样能用", () => {
    const keys = loadSearchKeys(storeOf(undefined));
    expect(keys).toEqual({
      anysearchKey: undefined,
      tavilyKey: undefined,
      bochaKey: undefined,
      doubaoKey: undefined,
      metasoKey: undefined,
      googleKey: undefined,
      googleCx: undefined,
      exaKey: undefined,
      braveKey: undefined,
      serpapiKey: undefined,
      serperKey: undefined,
      firecrawlKey: undefined,
    });
  });
});
