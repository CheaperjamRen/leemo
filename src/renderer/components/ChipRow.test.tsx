import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChipRow from "./ChipRow";
import type { SkillInfo } from "../../bridge/contract";

const skill = (name: string): SkillInfo => ({
  name,
  description: `${name} 说明`,
  qualifiedName: `leemo:${name}`,
  dir: `/skills/${name}`,
  source: "user",
});

describe("ChipRow — the three conversation starters (unchanged)", () => {
  it("renders the existing starter chips", () => {
    render(<ChipRow onPick={vi.fn()} />);
    expect(screen.getByText("帮我规划今天")).toBeInTheDocument();
    expect(screen.getByText("继续昨天的复习")).toBeInTheDocument();
    expect(screen.getByText("随便聊聊")).toBeInTheDocument();
  });

  it("hands the starter text to onPick", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ChipRow onPick={onPick} />);
    await user.click(screen.getByText("随便聊聊"));
    expect(onPick).toHaveBeenCalledWith("随便聊聊");
  });

  it("looks exactly like before on a machine with zero skills (no empty row)", () => {
    render(<ChipRow onPick={vi.fn()} skills={[]} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("ChipRow — skill trigger chips (轮 2 卡 E)", () => {
  it("appends a chip per enabled skill AFTER the starters", () => {
    render(<ChipRow onPick={vi.fn()} skills={[skill("pdf"), skill("期末速通")]} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.slice(0, 3)).toEqual(["帮我规划今天", "继续昨天的复习", "随便聊聊"]);
    expect(labels.slice(3)).toEqual(["/pdf", "/期末速通"]);
  });

  it("caps the skill chips at three so the row never wraps out of control", () => {
    const many = ["a", "b", "c", "d", "e"].map(skill);
    render(<ChipRow onPick={vi.fn()} skills={many} />);
    expect(screen.getAllByRole("button")).toHaveLength(6); // 3 starters + 3 skills
    expect(screen.queryByText("/d")).not.toBeInTheDocument();
  });

  it("clicking a skill chip drafts '/<bare name> '", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ChipRow onPick={onPick} skills={[skill("pdf")]} />);
    await user.click(screen.getByText("/pdf"));
    expect(onPick).toHaveBeenCalledWith("/pdf ");
  });

  it("NEVER renders the leemo: prefix (铁律 §二)", () => {
    const { container } = render(<ChipRow onPick={vi.fn()} skills={[skill("pdf")]} />);
    expect(container.textContent).not.toContain("leemo:");
  });

  it("gives each skill chip an accessible label naming the bare skill", () => {
    render(<ChipRow onPick={vi.fn()} skills={[skill("pdf")]} />);
    expect(screen.getByLabelText("触发技能 pdf")).toBeInTheDocument();
  });
});
