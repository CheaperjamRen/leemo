import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkbenchConversationScopePicker, {
  type WorkbenchConversationScopeOption,
} from "./WorkbenchConversationScopePicker";

const options: WorkbenchConversationScopeOption[] = [
  {
    workspaceId: "leemo-home",
    bookId: null,
    label: "Leemo 工作台",
    kind: "default",
  },
  {
    workspaceId: "leemo-home",
    bookId: "career",
    label: "秋招与求职",
    kind: "notebook",
  },
  {
    workspaceId: "project",
    bookId: null,
    label: "毕业设计",
    kind: "workspace",
  },
  {
    workspaceId: "leemo-home",
    bookId: "archived",
    label: "旧本子",
    kind: "notebook",
    archived: true,
  },
];

describe("WorkbenchConversationScopePicker", () => {
  it("selects a visible notebook and omits archived destinations", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <WorkbenchConversationScopePicker
        value={{ workspaceId: "leemo-home", bookId: null }}
        options={options}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "对话归属：Leemo 工作台" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);

    expect(screen.getByRole("menu", { name: "选择对话归属" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /旧本子/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "将对话放入 秋招与求职" }));

    expect(onChange).toHaveBeenCalledWith({ workspaceId: "leemo-home", bookId: "career" });
    expect(screen.queryByRole("menu", { name: "选择对话归属" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("dismisses on Escape and outside click, returning keyboard focus", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <WorkbenchConversationScopePicker
          value={{ workspaceId: "project", bookId: null }}
          options={options}
          onChange={vi.fn()}
        />
        <button type="button">空白区域</button>
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "对话归属：毕业设计" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "选择对话归属" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "空白区域" }));
    expect(screen.queryByRole("menu", { name: "选择对话归属" })).not.toBeInTheDocument();
  });

  it("locks the destination after the conversation has started", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchConversationScopePicker
        value={{ workspaceId: "leemo-home", bookId: null }}
        options={options}
        onChange={vi.fn()}
        disabled
      />,
    );

    const trigger = screen.getByRole("button", { name: "对话归属：Leemo 工作台" });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("menu", { name: "选择对话归属" })).not.toBeInTheDocument();
  });
});
