import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SlashMenu from "./SlashMenu";
import type { SkillInfo } from "../../bridge/contract";

const skill = (name: string, description = `${name} 说明`): SkillInfo => ({
  name,
  description,
  qualifiedName: `leemo:${name}`,
  dir: `/skills/${name}`,
  source: "user",
});

const defaults = {
  skills: [skill("pdf"), skill("期末速通")],
  selectedIndex: 0,
  onPick: vi.fn(),
  onHover: vi.fn(),
};

describe("SlashMenu", () => {
  it("lists each skill's bare name and description", () => {
    render(<SlashMenu {...defaults} />);
    expect(screen.getByText("/pdf")).toBeInTheDocument();
    expect(screen.getByText("/期末速通")).toBeInTheDocument();
    expect(screen.getByText("pdf 说明")).toBeInTheDocument();
  });

  it("NEVER renders the leemo: prefix (铁律 §二)", () => {
    // The user installed `pdf`; every surface must say `pdf`. The qualified name
    // exists only in the SDK call and in SkillInfo.qualifiedName.
    const { container } = render(<SlashMenu {...defaults} />);
    expect(container.textContent).not.toContain("leemo:");
  });

  it("marks the selected row for assistive tech", () => {
    render(<SlashMenu {...defaults} selectedIndex={1} />);
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("exposes a listbox so keyboard nav is announced", () => {
    render(<SlashMenu {...defaults} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("calls onPick with the clicked skill", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<SlashMenu {...defaults} onPick={onPick} />);
    await user.click(screen.getByText("/期末速通"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "期末速通" }));
  });

  it("reports hover so the mouse and the keyboard share one selection", async () => {
    const user = userEvent.setup();
    const onHover = vi.fn();
    render(<SlashMenu {...defaults} onHover={onHover} />);
    await user.hover(screen.getByText("/期末速通"));
    expect(onHover).toHaveBeenCalledWith(1);
  });

  it("renders nothing at all when there are no skills to show", () => {
    // The caller decides whether to mount it; an empty popup floating over the
    // input would just be a grey box.
    const { container } = render(<SlashMenu {...defaults} skills={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("handles a skill with no description without leaving a stray element", () => {
    render(<SlashMenu {...defaults} skills={[skill("bare", "")]} />);
    expect(screen.getByText("/bare")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
