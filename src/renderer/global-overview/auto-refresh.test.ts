import { describe, expect, it } from "vitest";
import { normalizeGlobalOverviewTime, shouldAutoRefresh } from "./auto-refresh";

function at(hour: number, minute: number): number {
  return new Date(2026, 7, 18, hour, minute, 0, 0).getTime();
}

describe("global overview foreground auto refresh gate", () => {
  it("is opt-in, waits for the configured local threshold, and attempts at most once per day", () => {
    expect(shouldAutoRefresh({ enabled: false, localTime: "09:00", now: at(10, 0) })).toBe(false);
    expect(shouldAutoRefresh({ enabled: true, localTime: "09:00", now: at(8, 59) })).toBe(false);
    expect(shouldAutoRefresh({ enabled: true, localTime: "09:00", now: at(9, 1) })).toBe(true);
    expect(shouldAutoRefresh({
      enabled: true,
      localTime: "09:00",
      now: at(9, 1),
      lastAutoAttemptDate: "2026-08-18",
    })).toBe(false);
  });

  it("lets a pre-threshold manual refresh coexist but suppresses auto after a post-threshold success", () => {
    expect(shouldAutoRefresh({
      enabled: true,
      localTime: "09:00",
      now: at(9, 5),
      lastSuccessfulAt: at(8, 30),
    })).toBe(true);
    expect(shouldAutoRefresh({
      enabled: true,
      localTime: "09:00",
      now: at(9, 5),
      lastSuccessfulAt: at(9, 2),
    })).toBe(false);
  });

  it("normalizes malformed persisted times to the calm 09:00 default", () => {
    expect(normalizeGlobalOverviewTime("18:30")).toBe("18:30");
    expect(normalizeGlobalOverviewTime("9:00")).toBe("09:00");
    expect(normalizeGlobalOverviewTime("99:88")).toBe("09:00");
    expect(normalizeGlobalOverviewTime("bad")).toBe("09:00");
  });
});
