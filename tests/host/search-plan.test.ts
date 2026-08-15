import { describe, it, expect, vi } from "vitest";
import { buildSearchPlan } from "../../src/host/search-plan";
import { buildCatalog, type CatalogEntry, type NativeSearchSpec } from "../../src/host/provider-catalog";

/** 造一个最小 catalog 条目。只填计划构建真的会读的字段。 */
function entry(
  id: string,
  opts: {
    apiKey?: string;
    apiFormat?: "anthropic" | "openai";
    nativeSearch?: NativeSearchSpec;
    models?: string[];
  } = {}
): CatalogEntry {
  const e = {
    provider: {
      id,
      name: id,
      category: "cn_official" as const,
      apiFormat: opts.apiFormat ?? ("anthropic" as const),
      baseUrl: `https://${id}.example.com/anthropic`,
      apiKey: opts.apiKey ?? "test-key-key",
      models: opts.models ?? [`${id}-model`],
      modelCapabilities: {},
      envTemplate: {},
    },
    spec: {} as CatalogEntry["spec"],
  } as CatalogEntry;
  if (opts.nativeSearch) e.nativeSearch = opts.nativeSearch;
  return e;
}

const PASSTHROUGH: NativeSearchSpec = { mode: "passthrough", measuredAt: "2026-07-27" };
const GLM_API: NativeSearchSpec = {
  mode: "vendorApi",
  vendor: "glm",
  searchApiUrl: "https://open.bigmodel.cn/api/paas/v4/web_search",
};
const NONE: NativeSearchSpec = { mode: "none", measuredAt: "2026-07-27" };

const noopFetch = (() => {
  throw new Error("fetch should not be called while building a plan");
}) as unknown as typeof fetch;

describe("buildSearchPlan —— 层序（只有这一家自己的路）", () => {
  it("实测能透传的家（DeepSeek/Kimi）拿到层①", () => {
    const plan = buildSearchPlan([entry("deepseek", { nativeSearch: PASSTHROUGH })], "deepseek", noopFetch);
    expect(plan.passthrough).toMatchObject({
      baseUrl: "https://deepseek.example.com/anthropic",
      apiKey: "test-key-key",
    });
  });

  it("实测是空壳的家（GLM）**不给层①**，但有层② 自己的搜索 API", () => {
    const plan = buildSearchPlan([entry("glm", { nativeSearch: GLM_API })], "glm", noopFetch);
    expect(plan.passthrough).toBeUndefined();
    expect(plan.vendorSearch).toMatchObject({ id: "glm" });
  });

  it('mode:"none"（通义，实测两条都不成立）⇒ 计划全空，直落外部源', () => {
    const plan = buildSearchPlan([entry("qwen", { nativeSearch: NONE })], "qwen", noopFetch);
    expect(plan.passthrough).toBeUndefined();
    expect(plan.vendorSearch).toBeUndefined();
  });

  it("未实测的家（中转站/自建）给层① —— 运行时探一次，由空壳判据兜着", () => {
    // 这条锁的是 undefined 与 mode:"none" 的**刻意区分**：没测过要探一次，
    // 测过不成立就别浪费。把两者混成一个值会失掉这个区分。
    const plan = buildSearchPlan([entry("relay")], "relay", noopFetch);
    expect(plan.passthrough).toBeDefined();
    expect(plan.vendorSearch).toBeUndefined();
  });
});

describe("硬边界：绝不跨 provider 花别家的额度（用户 7/27 拍板）", () => {
  // 这一组是本文件最承重的部分。我原先实现了"这家不能搜就借另一家已配置好的
  // provider"，用户否掉：**选了这个 API 就是只想花这个 API 的额度**，自动扣别家的钱
  // 是他从没同意过的支出，比掉外部源更坏。以下每条都在钉"别家的存在不改变计划"。

  it("通义 + GLM 都配好：通义的计划里**没有** GLM，掉外部源", () => {
    const plan = buildSearchPlan(
      [entry("qwen", { nativeSearch: NONE }), entry("glm", { nativeSearch: GLM_API })],
      "qwen",
      noopFetch
    );
    expect(plan.passthrough).toBeUndefined();
    expect(plan.vendorSearch).toBeUndefined();
  });

  it("通义 + 四家全配好：计划仍然全空（不借 DeepSeek、不借 Kimi、不借 GLM）", () => {
    const plan = buildSearchPlan(
      [
        entry("qwen", { nativeSearch: NONE }),
        entry("deepseek", { nativeSearch: PASSTHROUGH }),
        entry("kimi", { nativeSearch: PASSTHROUGH }),
        entry("glm", { nativeSearch: GLM_API }),
      ],
      "qwen",
      noopFetch
    );
    expect(plan).toEqual({});
  });

  it("层② 的 id 永远等于 selfId —— 供货方不可能是别家", () => {
    const catalog = [
      entry("glm", { nativeSearch: GLM_API }),
      entry("glm-second-account", { nativeSearch: GLM_API }),
      entry("deepseek", { nativeSearch: PASSTHROUGH }),
    ];
    for (const id of ["glm", "glm-second-account"]) {
      expect(buildSearchPlan(catalog, id, noopFetch).vendorSearch?.id).toBe(id);
    }
  });

  it("层① 的 baseUrl/key 永远来自 selfId 那一条", () => {
    const catalog = [
      entry("deepseek", { nativeSearch: PASSTHROUGH, apiKey: "sk-ds" }),
      entry("kimi", { nativeSearch: PASSTHROUGH, apiKey: "sk-kimi" }),
    ];
    expect(buildSearchPlan(catalog, "kimi", noopFetch).passthrough).toEqual({
      baseUrl: "https://kimi.example.com/anthropic",
      apiKey: "sk-kimi",
    });
  });

  it("能搜的家自己 key 空了，也不去借别家（掉外部源）", () => {
    const plan = buildSearchPlan(
      [entry("glm", { nativeSearch: GLM_API, apiKey: "" }), entry("deepseek", { nativeSearch: PASSTHROUGH })],
      "glm",
      noopFetch
    );
    expect(plan).toEqual({});
  });
});

describe("buildSearchPlan —— 排除不能用的家", () => {
  it("空 key ⇒ 计划全空（catalog 里永远列着预置项，拿去搜只会 401）", () => {
    expect(buildSearchPlan([entry("glm", { nativeSearch: GLM_API, apiKey: "" })], "glm", noopFetch)).toEqual({});
    expect(
      buildSearchPlan([entry("deepseek", { nativeSearch: PASSTHROUGH, apiKey: "   " })], "deepseek", noopFetch)
    ).toEqual({});
  });

  it("openai 家（走网关）计划全空 —— 网关会剥服务端工具，透传只换回空壳", () => {
    const plan = buildSearchPlan(
      [entry("relay-openai", { nativeSearch: PASSTHROUGH, apiFormat: "openai" })],
      "relay-openai",
      noopFetch
    );
    expect(plan).toEqual({});
  });

  it("vendorApi 缺 searchApiUrl / 未知 vendor 标签 ⇒ 跳过层②，不抛", () => {
    const catalog = [
      entry("a", { nativeSearch: { mode: "vendorApi", vendor: "glm" } }),
      entry("b", { nativeSearch: { mode: "vendorApi", vendor: "unknown-vendor", searchApiUrl: "https://x.example.com" } }),
    ];
    expect(buildSearchPlan(catalog, "a", noopFetch).vendorSearch).toBeUndefined();
    expect(buildSearchPlan(catalog, "b", noopFetch).vendorSearch).toBeUndefined();
  });

  it("selfId 不在 catalog 里（provider 刚被删）⇒ 计划全空", () => {
    expect(buildSearchPlan([entry("glm", { nativeSearch: GLM_API })], "ghost", noopFetch)).toEqual({});
  });
});

describe("buildSearchPlan × 真 catalog —— 四家预置的实测事实落到计划上", () => {
  const ENV = {
    DEEPSEEK_API_KEY: "sk-ds",
    GLM_API_KEY: "sk-glm",
    KIMI_API_KEY: "sk-kimi",
    DASHSCOPE_API_KEY: "sk-qwen",
  };

  it("DeepSeek：层① 在（它自己的端点）", () => {
    const plan = buildSearchPlan(buildCatalog(ENV), "deepseek", noopFetch);
    expect(plan.passthrough?.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(plan.vendorSearch).toBeUndefined();
  });

  it("Kimi：本轮新发现的那家，同样拿到层①", () => {
    const plan = buildSearchPlan(buildCatalog(ENV), "kimi", noopFetch);
    expect(plan.passthrough?.baseUrl).toBe("https://api.moonshot.cn/anthropic");
  });

  it("GLM：无层①，层② 是自己的 /paas/v4/web_search", () => {
    const plan = buildSearchPlan(buildCatalog(ENV), "glm", noopFetch);
    expect(plan.passthrough).toBeUndefined();
    expect(plan.vendorSearch?.id).toBe("glm");
  });

  it("通义：四家全配好也**不借任何一家** ⇒ 计划全空，掉外部源", () => {
    expect(buildSearchPlan(buildCatalog(ENV), "qwen", noopFetch)).toEqual({});
  });

  it("GLM 的 baseUrl 被改到自建域名时，搜索端点跟着换 host（别拿用户的 key 去打官方）", () => {
    const catalog = buildCatalog(ENV, {
      version: 1,
      providers: {
        glm: {
          kind: "glm",
          name: "GLM 自建",
          baseUrl: "https://my-proxy.internal/api/anthropic",
          apiFormat: "anthropic",
          category: "cn_official",
          apiKey: "sk-glm-custom",
        },
      },
    });
    const glm = catalog.find((e) => e.provider.id === "glm")!;
    expect(glm.nativeSearch?.searchApiUrl).toBe("https://my-proxy.internal/api/paas/v4/web_search");
  });

  it("未知 kind 的自定义实例：nativeSearch 留 undefined（不替它宣称能不能搜）", () => {
    const catalog = buildCatalog(ENV, {
      version: 1,
      providers: {
        relay2: {
          kind: "relay",
          name: "中转站",
          baseUrl: "https://relay.example.com",
          apiFormat: "anthropic",
          category: "custom",
          apiKey: "sk-relay",
        },
      },
    });
    const relay = catalog.find((e) => e.provider.id === "relay2")!;
    expect(relay.nativeSearch).toBeUndefined();
    const plan = buildSearchPlan(catalog, "relay2", noopFetch);
    expect(plan.passthrough).toBeDefined(); // 运行时探一次
    expect(plan.vendorSearch).toBeUndefined();
  });
});

describe("buildSearchPlan —— 层② 真的会去调对应的适配器", () => {
  it("GLM 候选打的是 /paas/v4/web_search，带自己的 key", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ search_result: [{ title: "T", link: "https://x.example.com", content: "c" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const plan = buildSearchPlan(
      buildCatalog({ GLM_API_KEY: "sk-glm-live" }),
      "glm",
      fetchFn as unknown as typeof fetch
    );
    expect(await plan.vendorSearch!.search("上海 今天 天气")).toEqual([
      { title: "T", url: "https://x.example.com", snippet: "c" },
    ]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/web_search");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-glm-live");
  });

  it("通义对话时一个请求都不该发出去（没有任何候选可调）", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    const plan = buildSearchPlan(
      buildCatalog({ DASHSCOPE_API_KEY: "sk-qwen", GLM_API_KEY: "sk-glm", DEEPSEEK_API_KEY: "sk-ds" }),
      "qwen",
      fetchFn as unknown as typeof fetch
    );
    expect(plan.vendorSearch).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
