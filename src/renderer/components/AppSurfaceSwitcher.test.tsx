import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BridgeProvider, useSettings } from "../bridge/context";
import AppSurfaceSwitcher from "./AppSurfaceSwitcher";

function Probe() {
  const surface = useSettings((state) => state.surface);
  const mode = useSettings((state) => state.mode);
  return <output>{surface}:{mode}</output>;
}

describe("AppSurfaceSwitcher", () => {
  it("keeps the product surfaces in start, workbench, buddy order", () => {
    render(<BridgeProvider><AppSurfaceSwitcher /></BridgeProvider>);
    const nav = screen.getByRole("navigation", { name: "工作区切换" });
    expect(Array.from(nav.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"))).toEqual([
      "切换到开始",
      "切换到工作台",
      "切换到搭子",
    ]);
  });

  it("keeps Start separate from the two Agent modes", async () => {
    render(<BridgeProvider><AppSurfaceSwitcher /><Probe /></BridgeProvider>);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "切换到开始" }));
    expect(screen.getByText("start:buddy")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换到工作台" }));
    expect(screen.getByText("workbench:workbench")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "工作区切换" })).toBeInTheDocument();
  });
});
