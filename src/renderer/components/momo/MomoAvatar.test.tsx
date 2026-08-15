import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MomoAvatar, { type MomoState } from "./MomoAvatar";

const states: MomoState[] = [
  "calm",
  "listening",
  "thinking",
  "waiting",
  "happy",
  "laugh",
  "concern",
  "sleepy",
  "completed",
  "curious",
];

describe("MomoAvatar", () => {
  it("keeps the size-only call compatible and defaults to calm", () => {
    render(<MomoAvatar size={26} />);

    const avatar = screen.getByRole("img", { name: "momo 的头像" });
    expect(avatar).toHaveAttribute("width", "26");
    expect(avatar).toHaveAttribute("height", "26");
    expect(avatar).toHaveAttribute("data-momo-state", "calm");
    expect(avatar).toHaveAttribute("data-momo-expression", "calm");
  });

  it("exposes one stable semantic marker for every supported state", () => {
    render(
      <>
        {states.map((state) => <MomoAvatar key={state} state={state} />)}
      </>,
    );

    expect(screen.getAllByRole("img").map((avatar) => avatar.getAttribute("data-momo-state"))).toEqual(states);
    for (const avatar of screen.getAllByRole("img")) {
      expect(avatar).toHaveAttribute("data-momo-expression");
    }
  });

  it("keeps non-essential state decorations out of message-size avatars", () => {
    const { container, rerender } = render(<MomoAvatar size={26} state="completed" />);
    expect(container.querySelector("[data-momo-decoration]")).not.toBeInTheDocument();

    rerender(<MomoAvatar size={32} state="completed" />);
    expect(container.querySelector("[data-momo-decoration='completed']")).toBeInTheDocument();
  });
});
