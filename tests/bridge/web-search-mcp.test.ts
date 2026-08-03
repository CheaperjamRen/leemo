// 轮 4 卡 H：搜索 MCP 壳。钉住三件事 —— 限定名不漂、key 每次调用重解、
// 全挂时给的是"照实说失败"而不是空结果（防幻觉是自建而非装第三方的核心理由）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { createWebSearchMcp, LEEMO_WEB_SEARCH_TOOL } from "../../src/bridge/web-search-mcp";

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  } as unknown as Response;
}

const ONE_HIT = {
  code: 0,
  data: { results: [{ title: "T", url: "https://e.com/1", snippet: "S", content: "x".repeat(3000) }] },
};

describe("createWebSearchMcp", () => {
  afterEach(() => vi.restoreAllMocks());

  it("限定名与 createSdkMcpServer 里的声明一致，不会漂", () => {
    expect(LEEMO_WEB_SEARCH_TOOL).toBe("mcp__leemo-web-search__web_search");
  });

  it("能造出可插进 SDK mcpServers 的 server", () => {
    expect(createWebSearchMcp().server).toBeTruthy();
  });

  it("有结果时返回带 URL 的文本，且不含被裁掉的正文", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(ONE_HIT));
    const r = await createWebSearchMcp().runWebSearch("泰勒展开");
    expect(r.isError).toBe(false);
    expect(r.text).toContain("https://e.com/1");
    expect(r.text).toContain("anysearch");
    expect(r.text).not.toContain("xxxx");
  });

  it("每次调用都重解 key —— 设置页刚配的 key 不用重启就生效", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(ONE_HIT));
    const resolveKeys = vi.fn(() => ({ tavilyKey: "tvly-x" }));
    const mcp = createWebSearchMcp({ resolveKeys });
    expect(resolveKeys).not.toHaveBeenCalled(); // 造壳时不解
    await mcp.runWebSearch("a");
    await mcp.runWebSearch("b");
    expect(resolveKeys).toHaveBeenCalledTimes(2);
  });

  it("key 解析本身炸了，也不该挡住免 key 的默认源", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(ONE_HIT));
    const r = await createWebSearchMcp({
      resolveKeys: () => {
        throw new Error("加密件坏了");
      },
    }).runWebSearch("q");
    expect(r.isError).toBe(false);
    expect(r.text).toContain("https://e.com/1");
  });

  it("空 query 直接报错，不白打一趟网络", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await createWebSearchMcp().runWebSearch("   ");
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("全挂时给的是「照实说、别编」的指令，不是空结果", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const r = await createWebSearchMcp().runWebSearch("q");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("搜索失败");
    expect(r.text).toMatch(/不要.*编造/);
    expect(r.text).toMatch(/不要声称自己搜过/);
  });
});
