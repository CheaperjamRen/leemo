import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BridgeProvider } from "../bridge/context";
import ModeSwitcher from "./ModeSwitcher";

describe("ModeSwitcher", () => {
  it("offers the two user-facing modes without leaking implementation names", async () => {
    const user = userEvent.setup();
    render(<BridgeProvider><ModeSwitcher /></BridgeProvider>);
    expect(screen.getByRole("navigation", { name: "模式切换" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到搭子" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到工作台" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "切换到搭子" }));
    expect(screen.getByRole("button", { name: "切换到搭子" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has a compact icon-only variant for a collapsed sidebar", () => {
    render(<BridgeProvider><ModeSwitcher compact collapsed /></BridgeProvider>);
    expect(screen.queryByText("搭子")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到工作台" })).toBeInTheDocument();
  });
});
