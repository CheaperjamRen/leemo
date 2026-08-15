import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LeemoMark from "./LeemoMark";

describe("LeemoMark", () => {
  it("renders the brand mark at the requested size and stays decorative by default", () => {
    const { container } = render(<LeemoMark size={16} />);

    const mark = container.querySelector("svg");
    expect(mark).toHaveAttribute("width", "16");
    expect(mark).toHaveAttribute("height", "16");
    expect(mark).toHaveAttribute("data-tone", "brand");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).not.toHaveAttribute("role");
    expect(mark?.querySelectorAll("[data-mark-block]")).toHaveLength(2);
    expect(mark?.querySelector("[data-mark-passage]")).toHaveAttribute("fill", "var(--leemo-brand-passage)");
    expect(mark?.querySelector("[data-mark-signal]")).toHaveAttribute("fill", "var(--leemo-brand-signal)");
  });

  it("supports one-color and reverse tones with an optional accessible label", () => {
    const { container, rerender } = render(<LeemoMark size={24} tone="one-color" label="Leemo" />);

    let mark = screen.getByRole("img", { name: "Leemo" });
    expect(mark).toHaveAttribute("data-tone", "one-color");
    expect(mark).not.toHaveAttribute("aria-hidden");
    expect(mark.querySelectorAll("[data-mark-block][fill='currentColor']")).toHaveLength(2);
    expect(mark.querySelector("[data-mark-signal]")).toHaveAttribute("fill", "currentColor");

    rerender(<LeemoMark size={32} tone="reverse" label="Leemo" />);
    mark = screen.getByRole("img", { name: "Leemo" });
    expect(mark).toHaveAttribute("width", "32");
    expect(mark).toHaveAttribute("data-tone", "reverse");
    expect(container.querySelector("[data-mark-backdrop]")).toHaveAttribute("fill", "var(--leemo-brand-mark)");
    expect(mark.querySelectorAll("[data-mark-block][fill='var(--leemo-brand-passage)']")).toHaveLength(2);
  });
});
