import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewTopicDialog from "./NewTopicDialog";

describe("NewTopicDialog", () => {
  it("explains the relationship boundary and confirms only after an explicit action", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <NewTopicDialog
        open
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("alertdialog", { name: "开始新话题？" });
    expect(dialog).toHaveTextContent("之前的聊天会继续保留");
    expect(dialog).toHaveTextContent("momo 会把下一条消息当作新的开始");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "开始" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open while work is pending and supports escape when idle", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <NewTopicDialog open busy onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    expect(screen.getByRole("button", { name: "正在准备" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();

    rerender(<NewTopicDialog open busy={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders nothing while closed", () => {
    render(<NewTopicDialog open={false} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
