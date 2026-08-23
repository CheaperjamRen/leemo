import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GlobalOverviewSnapshot } from "../../bridge/global-pending-overview";
import type { GlobalOverviewDisplayItem } from "../stores/global-pending-overview";
import GlobalPendingOverviewCard from "./GlobalPendingOverviewCard";

const snapshot: GlobalOverviewSnapshot = {
  version: 1,
  id: "s1",
  generatedAt: new Date(2026, 7, 18, 9, 12).getTime(),
  trigger: "manual",
  providerId: "deepseek",
  modelId: "deepseek-chat",
  items: [],
  uncertainSourceIds: [],
};

const items: GlobalOverviewDisplayItem[] = Array.from({ length: 4 }, (_, index) => ({
  id: `i${index}`,
  anchorSourceId: `task:t${index}`,
  sourceIds: [`task:t${index}`, `conversation:c${index}`],
  title: `事项 ${index + 1}`,
  progressSummary: "已有进展，仍需继续。",
  priority: index === 0 ? "now" : "soon",
  sourceMissing: false,
}));

describe("GlobalPendingOverviewCard", () => {
  it("starts quiet and calls nothing before the user clicks", async () => {
    const refresh = vi.fn();
    render(<GlobalPendingOverviewCard snapshot={null} items={[]} status="idle" error={null} onRefresh={refresh} onOpenBoard={vi.fn()} onOpenItem={vi.fn()} />);

    expect(screen.getByRole("button", { name: "为我梳理待完成事项" })).not.toHaveAccessibleDescription();
    expect(screen.getByText("还没有梳理过待完成事项。")).toBeInTheDocument();
    expect(screen.getByText("还没有梳理过待完成事项。").parentElement).toHaveAttribute("data-empty-layout", "compact");
    expect(screen.queryByText(/使用当前模型|计入用量|调用模型|叫醒 AI/)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "为我梳理待完成事项" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the old three-row snapshot visible while updating and shows an exact time", () => {
    render(<GlobalPendingOverviewCard snapshot={snapshot} items={items} status="refreshing" error={null} onRefresh={vi.fn()} onOpenBoard={vi.fn()} onOpenItem={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: /打开事项/ })).toHaveLength(3);
    expect(screen.queryByText("事项 4")).not.toBeInTheDocument();
    expect(screen.getByText("09:12 更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在梳理" })).toBeDisabled();
    expect(screen.getAllByText(/2 个来源/)).toHaveLength(3);
  });

  it("preserves rows on failure and keeps diagnostics folded", () => {
    render(<GlobalPendingOverviewCard snapshot={snapshot} items={items.slice(0, 1)} status="error" error="网络连接失败：ECONNRESET" onRefresh={vi.fn()} onOpenBoard={vi.fn()} onOpenItem={vi.fn()} />);

    expect(screen.getByText("事项 1")).toBeInTheDocument();
    expect(screen.getByText("上次梳理仍可用，本次更新没有完成。")).toBeInTheDocument();
    expect(screen.queryByText(/ECONNRESET/)).not.toBeVisible();
    expect(screen.getByText("查看原因").closest("details")).not.toHaveAttribute("open");
  });
});
