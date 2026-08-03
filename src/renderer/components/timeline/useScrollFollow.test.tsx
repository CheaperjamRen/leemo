import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BackToBottom from "./BackToBottom";

describe("BackToBottom", () => {
  it("is hidden when show is false", () => {
    render(<BackToBottom show={false} onClick={() => {}} />);
    expect(screen.queryByRole("button", { name: /回到底部/ })).not.toBeInTheDocument();
  });
  it("shows and fires onClick", () => {
    const onClick = vi.fn();
    render(<BackToBottom show onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: /回到底部/ }));
    expect(onClick).toHaveBeenCalled();
  });
});
