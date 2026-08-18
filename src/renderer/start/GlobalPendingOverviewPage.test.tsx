import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GlobalOverviewDisplayItem } from "../stores/global-pending-overview";
import GlobalPendingOverviewPage from "./GlobalPendingOverviewPage";

const items: GlobalOverviewDisplayItem[] = [
  { id: "1", anchorSourceId: "task:t1", sourceIds: ["task:t1", "conversation:c1"], title: "产品故事", progressSummary: "有初稿", nextStep: "补 PRD", projectLabel: "求职准备", priority: "now", sourceMissing: false },
  { id: "2", anchorSourceId: "conversation:c2", sourceIds: ["conversation:c2"], title: "整理研究", progressSummary: "待确认", priority: "soon", sourceMissing: false },
];

describe("GlobalPendingOverviewPage", () => {
  it("groups by real project, keeps uncertain collapsed, and exposes only correction actions", async () => {
    const openSource = vi.fn();
    const priority = vi.fn();
    const ignore = vi.fn();
    const end = vi.fn();
    render(<GlobalPendingOverviewPage items={items} uncertainSourceIds={["conversation:c9"]} sourceLabels={{ "task:t1": "待办：产品故事", "conversation:c1": "会话：产品故事讨论", "conversation:c9": "会话：待确认线索" }} onOpenSource={openSource} onSetPriority={priority} onIgnore={ignore} onEnd={end} onRestore={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "求职准备" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未归组" })).toBeInTheDocument();
    expect(screen.getByText("尚不确定的来源（1）").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    const card = screen.getByRole("article", { name: "产品故事" });
    await userEvent.click(within(card).getByRole("button", { name: "打开来源 待办：产品故事" }));
    await userEvent.click(within(card).getByRole("button", { name: "稍后处理产品故事" }));
    await userEvent.click(within(card).getByRole("button", { name: "不再关注产品故事" }));
    await userEvent.click(within(card).getByRole("button", { name: "已经结束产品故事" }));
    expect(openSource).toHaveBeenCalledWith("task:t1", ["task:t1", "conversation:c1"]);
    expect(priority).toHaveBeenCalledWith("task:t1", "later");
    expect(ignore).toHaveBeenCalledWith("task:t1");
    expect(end).toHaveBeenCalledWith("task:t1");
  });
});
