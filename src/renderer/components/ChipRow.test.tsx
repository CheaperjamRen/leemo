import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChipRow from "./ChipRow";

describe("ChipRow — responsive natural conversation starters", () => {
  it("renders natural scenarios without leaking slash commands into the landing page", () => {
    render(<ChipRow onPick={vi.fn()} />);
    expect(screen.getByText("帮我规划今天")).toBeInTheDocument();
    expect(screen.getByText("继续昨天的复习")).toBeInTheDocument();
    expect(screen.getByText("随便聊聊")).toBeInTheDocument();
    expect(screen.getByText("帮我理清思路")).toBeInTheDocument();
    expect(screen.getByText("一起做个决定")).toBeInTheDocument();
    expect(screen.queryByText(/^\//u)).not.toBeInTheDocument();
  });

  it("hands the starter text to onPick", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ChipRow onPick={onPick} />);
    await user.click(screen.getByText("随便聊聊"));
    expect(onPick).toHaveBeenCalledWith("随便聊聊");
  });

  it("keeps the row single-line so CSS can hide low-priority prompts instead of wrapping", () => {
    const { container } = render(<ChipRow onPick={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass("flex-nowrap", "overflow-hidden");
  });
});
