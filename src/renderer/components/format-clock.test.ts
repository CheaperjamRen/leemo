import { describe, it, expect } from "vitest";
import { formatClock } from "./format-clock";

describe("formatClock", () => {
  it("renders 月日 · 周几 · HH:MM from a Date (2026-07-22 is a Wednesday)", () => {
    expect(formatClock(new Date(2026, 6, 22, 14, 23))).toBe("7月22日 · 周三 · 14:23");
  });

  it("zero-pads hours and minutes", () => {
    expect(formatClock(new Date(2026, 6, 22, 9, 5))).toBe("7月22日 · 周三 · 09:05");
  });

  it("maps weekday correctly across the week (2026-12-01 is a Tuesday)", () => {
    expect(formatClock(new Date(2026, 11, 1, 0, 0))).toBe("12月1日 · 周二 · 00:00");
  });

  it("handles midnight and the last minute of the day", () => {
    expect(formatClock(new Date(2026, 6, 22, 0, 0))).toBe("7月22日 · 周三 · 00:00");
    expect(formatClock(new Date(2026, 6, 22, 23, 59))).toBe("7月22日 · 周三 · 23:59");
  });
});
