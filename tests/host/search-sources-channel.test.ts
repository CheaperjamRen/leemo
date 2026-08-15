// 轮 4 卡 H：搜索源 key 的两条 IPC 通道。
// 最要紧的两条：① 状态里绝不含 key 本身；② 没有加密件时必须报错，不能静默
// 假装存好了（那样用户会以为配好了，而搜索永远用不上那把 key）。
import { describe, it, expect, beforeEach } from "vitest";
import { createBridgeHost, type ProviderConfigStore } from "../../src/host/bridge-host";
import type { ProviderConfigFile } from "../../src/host/provider-config";
import type { SearchSourceStatus } from "../../src/bridge/contract";

function makeStore(initial?: ProviderConfigFile["searchKeys"]) {
  let config: ProviderConfigFile = { version: 1, providers: {}, searchKeys: initial };
  return {
    store: {
      read: () => config,
      write: (c: ProviderConfigFile) => {
        config = c;
      },
    } satisfies ProviderConfigStore,
    current: () => config,
  };
}

function hostWith(store?: ProviderConfigStore) {
  return createBridgeHost({
    catalog: [],
    providerStore: store,
    dataDir: "E:\\tmp\\data",
    workspaceRoot: "E:\\tmp\\workspace",
    push: () => {},
  });
}

const ENV = [
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

describe("搜索源 key 通道 (轮 4 卡 H)", () => {
  beforeEach(() => {
    // 环境变量会让 configured 变 true，干扰断言。
    for (const n of ENV) delete process.env[n];
  });

  it("列出十二个通用源，AnySearch 免 key、Bing 明确标为已退役", async () => {
    const host = hostWith(makeStore().store);
    const list = (await host.handleInvoke("bridge:getSearchSources", undefined)) as SearchSourceStatus[];
    expect(list.map((s) => s.id)).toEqual([
      "anysearch",
      "doubao",
      "metaso",
      "tavily",
      "bocha",
      "google",
      "exa",
      "brave",
      "serpapi",
      "serper",
      "bing",
      "firecrawl",
    ]);
    expect(list.find((s) => s.id === "anysearch")?.keyless).toBe(true);
    expect(list.find((s) => s.id === "tavily")?.keyless).toBe(false);
    expect(list.find((s) => s.id === "bing")).toMatchObject({
      configured: false,
      blockedReason: expect.stringContaining("停止服务"),
    });
  });

  it("状态里绝不含 key 本身 —— 明文 key 不出主进程（照 getProviderConfig 的同一条规矩）", async () => {
    const host = hostWith(makeStore({
      tavily: "tvly-secret-value",
      google: "google-secret-value",
      googleCx: "cx-secret-value",
    }).store);
    const list = await host.handleInvoke("bridge:getSearchSources", undefined);
    expect(JSON.stringify(list)).not.toContain("tvly-secret-value");
    expect(JSON.stringify(list)).not.toContain("google-secret-value");
    expect(JSON.stringify(list)).not.toContain("cx-secret-value");
    expect((list as SearchSourceStatus[]).find((s) => s.id === "tavily")?.configured).toBe(true);
    expect((list as SearchSourceStatus[]).find((s) => s.id === "google")).toMatchObject({
      configured: true,
      configuredFields: ["apiKey", "engineId"],
    });
  });

  it("存进去的 key 落到加密件里，并立刻反映成 configured", async () => {
    const { store, current } = makeStore();
    const host = hostWith(store);
    const list = (await host.handleInvoke("bridge:saveSearchKey", {
      source: "tavily",
      apiKey: "tvly-new",
    })) as SearchSourceStatus[];
    expect(current().searchKeys?.tavily).toBe("tvly-new");
    expect(list.find((s) => s.id === "tavily")?.configured).toBe(true);
  });

  it("新增来源配置写入后，重建 host 仍恢复已配置状态", async () => {
    const { store, current } = makeStore();
    await hostWith(store).handleInvoke("bridge:saveSearchKey", {
      source: "exa",
      apiKey: "exa-new",
    });
    expect(current().searchKeys?.exa).toBe("exa-new");

    const restarted = hostWith(store);
    const list = await restarted.handleInvoke("bridge:getSearchSources", undefined) as SearchSourceStatus[];
    expect(list.find((source) => source.id === "exa")?.configured).toBe(true);
  });

  it("Bing Search API 已退役，拒绝保存并给出可理解原因", async () => {
    const { store } = makeStore();
    await expect(hostWith(store).handleInvoke("bridge:saveSearchKey", {
      source: "bing",
      apiKey: "must-not-store",
    })).rejects.toThrow("停止服务");
  });

  it("空串 = 清除那把 key（用户要能撤回，而不是只能覆盖）", async () => {
    const { store, current } = makeStore({ tavily: "tvly-old" });
    const host = hostWith(store);
    const list = (await host.handleInvoke("bridge:saveSearchKey", {
      source: "tavily",
      apiKey: "",
    })) as SearchSourceStatus[];
    expect(current().searchKeys?.tavily).toBeUndefined();
    expect(list.find((s) => s.id === "tavily")?.configured).toBe(false);
  });

  it("存 key 时会 trim（用户从网页复制常带尾随空白）", async () => {
    const { store, current } = makeStore();
    await hostWith(store).handleInvoke("bridge:saveSearchKey", { source: "bocha", apiKey: "  sk-b  " });
    expect(current().searchKeys?.bocha).toBe("sk-b");
  });

  it("存一把不影响另一把", async () => {
    const { store, current } = makeStore({ tavily: "tvly-keep" });
    await hostWith(store).handleInvoke("bridge:saveSearchKey", { source: "bocha", apiKey: "sk-b" });
    expect(current().searchKeys?.tavily).toBe("tvly-keep");
    expect(current().searchKeys?.bocha).toBe("sk-b");
  });

  it("Google 的 Key 与搜索引擎 ID 同次保存，状态只回字段是否齐全", async () => {
    const { store, current } = makeStore();
    const list = (await hostWith(store).handleInvoke("bridge:saveSearchKey", {
      source: "google",
      apiKey: "  google-key  ",
      engineId: "  cx-id  ",
    })) as SearchSourceStatus[];

    expect(current().searchKeys).toMatchObject({ google: "google-key", googleCx: "cx-id" });
    expect(list.find((s) => s.id === "google")).toMatchObject({
      configured: true,
      configuredFields: ["apiKey", "engineId"],
    });
    expect(JSON.stringify(list)).not.toContain("google-key");
    expect(JSON.stringify(list)).not.toContain("cx-id");
  });

  it("Google 缺任一字段时拒绝保存且不破坏旧配置", async () => {
    const { store, current } = makeStore({ google: "old-key", googleCx: "old-cx" });
    await expect(hostWith(store).handleInvoke("bridge:saveSearchKey", {
      source: "google",
      apiKey: "new-key",
      engineId: "",
    })).rejects.toThrow("Google");
    expect(current().searchKeys).toMatchObject({ google: "old-key", googleCx: "old-cx" });
  });

  it("Google 两个空字段会一起清除，不留下半份不可用配置", async () => {
    const { store, current } = makeStore({ google: "old-key", googleCx: "old-cx" });
    const list = (await hostWith(store).handleInvoke("bridge:saveSearchKey", {
      source: "google",
      apiKey: "",
      engineId: "",
    })) as SearchSourceStatus[];
    expect(current().searchKeys?.google).toBeUndefined();
    expect(current().searchKeys?.googleCx).toBeUndefined();
    expect(list.find((s) => s.id === "google")?.configured).toBe(false);
  });

  it("没有加密件时抛错，不静默假装存好了 —— 否则用户以为配好了，搜索却永远用不上", async () => {
    await expect(
      hostWith(undefined).handleInvoke("bridge:saveSearchKey", { source: "tavily", apiKey: "tvly-x" })
    ).rejects.toThrow();
  });

  it("没有加密件时仍能读状态（设置页要打得开，只是全是未配置）", async () => {
    const list = (await hostWith(undefined).handleInvoke(
      "bridge:getSearchSources",
      undefined
    )) as SearchSourceStatus[];
    expect(list).toHaveLength(12);
    expect(list.every((s) => !s.configured)).toBe(true);
  });
});
