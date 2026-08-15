import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import AnchoredLayer, { placeAnchoredLayer } from "./AnchoredLayer";

describe("placeAnchoredLayer", () => {
  it("flips a bottom-end layer above the trigger and keeps it inside the viewport", () => {
    expect(placeAnchoredLayer({
      anchor: { top: 710, right: 992, bottom: 742, left: 932, width: 60, height: 32 },
      layer: { width: 220, height: 180 },
      viewport: { width: 1000, height: 760 },
      preferred: "bottom-end",
      gap: 8,
      padding: 8,
    })).toEqual({ top: 522, left: 772, placement: "top-end" });
  });
});

describe("AnchoredLayer", () => {
  it("renders in a fixed portal layer and dismisses on Escape", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const anchorRef = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchorRef}>锚点</button>
        <AnchoredLayer open anchor={anchorRef} onDismiss={onDismiss} ariaLabel="用量详情">
          <span>输入 2.4k</span>
        </AnchoredLayer>
      </>,
    );

    const layer = screen.getByRole("dialog", { name: "用量详情" });
    expect(layer).toHaveAttribute("data-anchored-layer");
    expect(layer).toHaveStyle({ position: "fixed" });
    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
