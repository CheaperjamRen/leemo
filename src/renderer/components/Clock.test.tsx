import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import Clock from "./Clock";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Clock", () => {
  it("shows the current system time on mount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 22, 14, 23));
    render(<Clock />);
    expect(screen.getByText("7月22日 · 周三 · 14:23")).toBeInTheDocument();
  });

  it("ticks forward as wall-clock minutes pass", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 22, 14, 23, 50));
    render(<Clock />);
    expect(screen.getByText(/14:23/)).toBeInTheDocument();
    act(() => {
      vi.setSystemTime(new Date(2026, 6, 22, 14, 24, 10));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/14:24/)).toBeInTheDocument();
  });

  it("clears its interval on unmount (no orphaned timer)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 22, 14, 23));
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<Clock />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
