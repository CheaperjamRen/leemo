import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import LiveStatusBar from "./LiveStatusBar";

describe("LiveStatusBar", () => {
  it("renders a user-facing action instead of the internal tool name", () => {
    render(<LiveStatusBar toolName="Read" />);
    expect(screen.getByText("正在读取文件…")).toBeInTheDocument();

    render(<LiveStatusBar toolName="mcp__leemo-scheduler__create_scheduled_task" />);
    expect(screen.getByText("正在创建定时任务…")).toBeInTheDocument();
    expect(screen.queryByText(/mcp__|scheduled_task/i)).not.toBeInTheDocument();
  });
  it("renders nothing without a tool name", () => {
    const { container } = render(<LiveStatusBar />);
    expect(container.textContent).toBe("");
  });
});
