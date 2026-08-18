import { describe, expect, it, vi } from "vitest";
import { openOverviewSource } from "./open-overview-source";

describe("openOverviewSource", () => {
  it.each([
    [{ kind: "task", id: "t1" } as const, "openTask", "t1"],
    [{ kind: "conversation", id: "c1" } as const, "openConversation", "c1"],
    [{ kind: "artifact", id: "a1" } as const, "openArtifact", "a1"],
  ])("routes %o to the exact local object", (target, method, id) => {
    const deps = { openTask: vi.fn(), openConversation: vi.fn(), openArtifact: vi.fn(), openRun: vi.fn(), reportMissing: vi.fn() };
    openOverviewSource(target, deps);
    expect(deps[method as "openTask"]).toHaveBeenCalledWith(id);
    expect(deps.reportMissing).not.toHaveBeenCalled();
  });

  it("routes runs with both ids and reports malformed targets without browser navigation", () => {
    const deps = { openTask: vi.fn(), openConversation: vi.fn(), openArtifact: vi.fn(), openRun: vi.fn(), reportMissing: vi.fn() };
    openOverviewSource({ kind: "run", conversationId: "c1", runId: "r1" }, deps);
    expect(deps.openRun).toHaveBeenCalledWith("c1", "r1");

    openOverviewSource({ kind: "task", id: "" }, deps);
    expect(deps.reportMissing).toHaveBeenCalledWith({ kind: "task", id: "" });
  });
});
