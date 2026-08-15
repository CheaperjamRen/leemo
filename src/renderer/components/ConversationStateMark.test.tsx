import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ConversationStateMark from "./ConversationStateMark";

describe("ConversationStateMark", () => {
  it("renders one unread dot with an honest tooltip even when the source status says completed", () => {
    render(<ConversationStateMark marker="unread" label="课程报告" detail="任务已完成" />);

    const mark = screen.getByRole("img", { name: "课程报告：未读" });
    expect(mark).toHaveAttribute("title", "未读");
    expect(mark.querySelector("svg")).toBeNull();
  });

  it("renders a spinner or error icon, never a visible lifecycle label", () => {
    const { rerender } = render(<ConversationStateMark marker="running" label="任务" />);
    expect(screen.getByRole("img", { name: "任务：进行中" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByText("进行中")).not.toBeInTheDocument();

    rerender(<ConversationStateMark marker="error" label="任务" detail="模型请求失败" />);
    expect(screen.getByRole("img", { name: "任务：报错" })).toHaveAttribute("title", "模型请求失败");
    expect(screen.queryByText("报错")).not.toBeInTheDocument();
  });
});
