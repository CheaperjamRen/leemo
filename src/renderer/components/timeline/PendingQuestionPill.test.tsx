import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PendingQuestionPill from "./PendingQuestionPill";

describe("PendingQuestionPill", () => {
  it("is hidden when show is false", () => {
    render(<PendingQuestionPill show={false} onClick={() => {}} />);
    expect(screen.queryByText(/有个问题等你回答/)).not.toBeInTheDocument();
  });

  it("shows the labeled hint and fires onClick", () => {
    const onClick = vi.fn();
    render(<PendingQuestionPill show onClick={onClick} />);
    fireEvent.click(screen.getByText(/有个问题等你回答/));
    expect(onClick).toHaveBeenCalled();
  });
});
