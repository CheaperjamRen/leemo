import { describe, expect, it } from "vitest";
import { normalizeMomoE2EScenario } from "../../src/main/e2e-momo-verifier";

describe("momo 打包验收 normalizer seam", () => {
  it("用确定性 raw SDK 场景覆盖 estimated、exact、iterations 与 compact 顺序", async () => {
    const identity = { providerId: "e2e-provider", modelId: "shared-model", cwd: "." };
    const estimated = await normalizeMomoE2EScenario("estimated", identity);
    const exact = await normalizeMomoE2EScenario("exact", identity);
    const compacted = await normalizeMomoE2EScenario("compact-iterations", identity);

    expect(estimated).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "context.live", currentTokens: 43_212, providerId: "e2e-provider" }),
    ]));
    expect(exact).toEqual([
      expect.objectContaining({ type: "context.snapshot", currentTokens: 81_000, providerId: "e2e-provider" }),
    ]);
    expect(compacted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "context.live", currentTokens: 119_520 }),
      expect.objectContaining({ type: "compact.boundary", postTokens: 30_000 }),
    ]));
    const billing = compacted.find((event) => event.type === "usage.final");
    expect(billing).toMatchObject({
      type: "usage.final",
      usage: { inputTokens: 20_000, cacheReadTokens: 200_000, outputTokens: 100 },
    });
    expect(billing?.type === "usage.final" ? billing.usage : {}).not.toHaveProperty("contextInputTokens");
  });
});
