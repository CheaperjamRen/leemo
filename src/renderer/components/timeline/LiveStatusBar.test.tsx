import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import LiveStatusBar from "./LiveStatusBar";

describe("LiveStatusBar", () => {
  it("renders the running tool name", () => {
    render(<LiveStatusBar toolName="Read" />);
    expect(screen.getByText(/Read/)).toBeInTheDocument();
  });
  it("renders nothing without a tool name", () => {
    const { container } = render(<LiveStatusBar />);
    expect(container.textContent).toBe("");
  });
});
