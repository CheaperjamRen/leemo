import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useElementBelowWidth } from "./useElementBreakpoint";

describe("useElementBelowWidth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not rerender its owner for every resize pixel on the same side of a breakpoint", () => {
    let notifyResize: ((width: number) => void) | undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = (width) => callback([{
          contentRect: { width },
        } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    let renders = 0;

    function Probe() {
      renders += 1;
      const ref = useRef<HTMLDivElement>(null);
      const compact = useElementBelowWidth(ref, 1024);
      return <div ref={ref} data-testid="probe" data-compact={String(compact)} />;
    }

    try {
      render(<Probe />);
      const initialRenders = renders;
      act(() => {
        notifyResize?.(1400);
        notifyResize?.(1320);
        notifyResize?.(1180);
      });
      expect(renders).toBe(initialRenders);
      expect(screen.getByTestId("probe")).toHaveAttribute("data-compact", "false");

      act(() => notifyResize?.(960));
      expect(renders).toBe(initialRenders + 1);
      expect(screen.getByTestId("probe")).toHaveAttribute("data-compact", "true");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });
});
