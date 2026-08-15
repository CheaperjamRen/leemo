import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LeemoSwitch from "./LeemoSwitch";

describe("LeemoSwitch", () => {
  it("reports the state accessibly and asks for the opposite state when clicked", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <LeemoSwitch checked={false} onCheckedChange={onCheckedChange} label="关闭窗口后继续运行" />,
    );

    const control = screen.getByRole("switch", { name: "关闭窗口后继续运行" });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveClass("h-[18px]", "w-[30px]", "rounded-full");
    const thumb = screen.getByTestId("leemo-switch-thumb");
    expect(thumb).toHaveClass("h-[14px]", "w-[14px]", "rounded-full");
    expect(thumb).toHaveAttribute("data-side", "left");
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    rerender(<LeemoSwitch checked onCheckedChange={onCheckedChange} label="关闭窗口后继续运行" />);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("leemo-switch-thumb")).toHaveAttribute("data-side", "right");
  });
});
