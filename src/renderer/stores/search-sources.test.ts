import { describe, it, expect, vi } from "vitest";
import { createSearchSourcesStore } from "./search-sources";
import type { BridgeClient } from "../bridge/client";
import type { SearchSourceStatus } from "../../bridge/contract";

const SOURCES: SearchSourceStatus[] = [
  { id: "anysearch", label: "AnySearch", keyless: true, configured: false, configuredFields: [], note: "不配也能用" },
  { id: "doubao", label: "豆包搜索", keyless: false, configured: false, configuredFields: [], note: "中文时效" },
  { id: "metaso", label: "秘塔搜索", keyless: false, configured: false, configuredFields: [], note: "中文研究" },
  { id: "tavily", label: "Tavily", keyless: false, configured: true, configuredFields: ["apiKey"], note: "兜底源" },
  { id: "bocha", label: "博查", keyless: false, configured: false, configuredFields: [], note: "可选" },
  { id: "google", label: "Google", keyless: false, configured: false, configuredFields: [], note: "兼容" },
];

function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "bridge:getSearchSources") return SOURCES;
    if (channel === "bridge:saveSearchKey") return SOURCES;
    throw new Error(`unexpected channel ${channel}`);
  });
  return { invoke, ...over } as unknown as BridgeClient & { invoke: typeof invoke };
}

describe("createSearchSourcesStore", () => {
  it("starts empty and idle — nothing is fetched until asked", () => {
    const s = createSearchSourcesStore(fakeClient()).getState();
    expect(s.list).toEqual([]);
    expect(s.status).toBe("idle");
  });

  it("refresh loads the six common web sources", async () => {
    const store = createSearchSourcesStore(fakeClient());
    await store.getState().refresh();
    expect(store.getState().status).toBe("ready");
    expect(store.getState().list.map((x) => x.id)).toEqual([
      "anysearch", "doubao", "metaso", "tavily", "bocha", "google",
    ]);
  });

  it("a load failure becomes an ERROR state, not a silently empty list", async () => {
    // 空列表 + ready 会让用户以为"没有可配的源"，而真相是"读不出来"。
    const client = fakeClient({
      invoke: vi.fn(async () => {
        throw new Error("no encrypted store");
      }),
    });
    const store = createSearchSourcesStore(client);
    await store.getState().refresh();
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toContain("no encrypted store");
    expect(store.getState().list).toEqual([]);
  });

  it("saveCredentials forwards the complete draft and adopts the returned statuses", async () => {
    const client = fakeClient();
    const store = createSearchSourcesStore(client);
    await expect(store.getState().saveCredentials({ source: "google", apiKey: "g-key", engineId: "cx-id" })).resolves.toBe(true);
    expect(client.invoke).toHaveBeenCalledWith("bridge:saveSearchKey", {
      source: "google",
      apiKey: "g-key",
      engineId: "cx-id",
    });
    expect(store.getState().list.map((x) => x.id)).toContain("tavily");
  });

  it("an EMPTY STRING is forwarded as-is — empty means CLEAR, not 'nothing to do'", async () => {
    // 用户必须能撤回一把配错的 key，而不是只能覆盖。若这里把空串当"没填"跳过，
    // 界面上就没有任何删除入口。
    const client = fakeClient();
    await createSearchSourcesStore(client).getState().saveCredentials({ source: "bocha", apiKey: "" });
    expect(client.invoke).toHaveBeenCalledWith("bridge:saveSearchKey", { source: "bocha", apiKey: "" });
  });

  it("a save failure surfaces the real error and NEVER pretends it saved", async () => {
    const client = fakeClient({
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:getSearchSources") return SOURCES;
        throw new Error("safeStorage unavailable");
      }),
    });
    const store = createSearchSourcesStore(client);
    await expect(store.getState().saveCredentials({ source: "tavily", apiKey: "x" })).resolves.toBe(false);
    expect(store.getState().saveError.tavily).toContain("safeStorage unavailable");
    expect(store.getState().saving.tavily).toBeUndefined();
  });

  it("per-source save state is isolated — one source failing does not mark the others", async () => {
    let calls = 0;
    const client = fakeClient({
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:getSearchSources") return SOURCES;
        calls++;
        if (calls === 1) throw new Error("boom");
        return SOURCES;
      }),
    });
    const store = createSearchSourcesStore(client);
    await store.getState().saveCredentials({ source: "tavily", apiKey: "a" });
    await store.getState().saveCredentials({ source: "bocha", apiKey: "b" });
    expect(store.getState().saveError.tavily).toContain("boom");
    expect(store.getState().saveError.bocha).toBeUndefined();
  });

  it("a retry clears the previous error for that source", async () => {
    let first = true;
    const client = fakeClient({
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:getSearchSources") return SOURCES;
        if (first) {
          first = false;
          throw new Error("transient");
        }
        return SOURCES;
      }),
    });
    const store = createSearchSourcesStore(client);
    await store.getState().saveCredentials({ source: "tavily", apiKey: "a" });
    expect(store.getState().saveError.tavily).toBeDefined();
    await store.getState().saveCredentials({ source: "tavily", apiKey: "a" });
    expect(store.getState().saveError.tavily).toBeUndefined();
  });

  it("a non-array reply becomes an error, not a crash later during render", async () => {
    // 通道没实现/老 host/夹具会回 undefined。若直接进 state，渲染时 list.map
    // 会把整个设置页打白 —— 那是一次 IPC 形状问题变成整页事故。
    const client = fakeClient({ invoke: vi.fn(async () => undefined) });
    const store = createSearchSourcesStore(client);
    await store.getState().refresh();
    expect(store.getState().status).toBe("error");
    expect(Array.isArray(store.getState().list)).toBe(true);
  });

  it("a malformed save reply keeps the previous list intact", async () => {
    let n = 0;
    const client = fakeClient({
      invoke: vi.fn(async () => {
        n++;
        return n === 1 ? SOURCES : undefined;
      }),
    });
    const store = createSearchSourcesStore(client);
    await store.getState().refresh();
    await store.getState().saveCredentials({ source: "tavily", apiKey: "x" });
    expect(store.getState().list.map((s) => s.id)).toEqual([
      "anysearch", "doubao", "metaso", "tavily", "bocha", "google",
    ]);
  });

  it("no state field can carry a plaintext key (structural, not incidental)", async () => {
    // 承重：只要状态里出现过 key，它就可能进 DOM/日志/devtools 快照。
    const store = createSearchSourcesStore(fakeClient());
    await store.getState().refresh();
    await store.getState().saveCredentials({ source: "tavily", apiKey: "tvly-SUPER-SECRET-VALUE" });
    const blob = JSON.stringify(store.getState());
    expect(blob).not.toContain("tvly-SUPER-SECRET-VALUE");
    expect(blob).not.toContain("SUPER-SECRET");
  });
});
