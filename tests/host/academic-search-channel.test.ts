import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AcademicSearchOutcome } from "../../src/bridge/contract";
import { createBridgeHost } from "../../src/host/bridge-host";

const XML = readFileSync(new URL("../fixtures/search/arxiv-success.xml", import.meta.url), "utf8");

function makeHost(fetchFn: typeof fetch) {
  return createBridgeHost({
    catalog: [],
    fetchFn,
    dataDir: "E:\\tmp\\leemo-academic-data",
    workspaceRoot: "E:\\tmp\\leemo-academic-workspace",
    push: () => {},
  });
}

describe("bridge:searchAcademic", () => {
  it("提供 typed 诊断入口，并复用 host 级缓存", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() { return XML; },
    })) as unknown as typeof fetch;
    const host = makeHost(fetchFn);
    const first = await host.handleInvoke("bridge:searchAcademic", { query: "Active Recall" });
    const second = await host.handleInvoke("bridge:searchAcademic", { query: " active   recall " });
    expect((first as AcademicSearchOutcome).papers[0]?.url).toContain("arxiv.org/abs/");
    expect((first as AcademicSearchOutcome).cached).toBe(false);
    expect((second as AcademicSearchOutcome).cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it("上游失败会拒绝通道，不把错误伪装成空论文列表", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 503,
      async text() { return "unavailable"; },
    })) as unknown as typeof fetch;
    const host = makeHost(fetchFn);
    await expect(host.handleInvoke("bridge:searchAcademic", { query: "q" }))
      .rejects.toThrow("学术检索");
    host.dispose();
  });
});
