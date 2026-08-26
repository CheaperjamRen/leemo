import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "../bridge/context";
import TopBar from "./TopBar";

describe("TopBar", () => {
  it("keeps the dense 64px desktop chrome and its primary controls in one global row", () => {
    render(
      <BridgeProvider>
        <TopBar onOpenHistory={vi.fn()} />
      </BridgeProvider>,
    );

    const topbar = screen.getByRole("banner");
    expect(topbar).toHaveClass("h-16", "px-5");

    const identity = within(topbar).getByTestId("topbar-product-identity");
    expect(identity.querySelector("svg")).toHaveAttribute("width", "24");
    expect(within(identity).getByText("Leemo")).toHaveClass("text-[18px]");

    expect(within(topbar).getByRole("button", { name: "历史对话" })).toHaveClass("leemo-topbar-history");
    expect(within(topbar).getByRole("navigation", { name: "工作区切换" })).toHaveClass("leemo-mode-switcher-topbar");

    const controls = within(topbar).getAllByRole("button");
    expect(controls.slice(0, 6).map((control) => control.getAttribute("aria-label"))).toEqual([
      "历史对话",
      "切换到开始",
      "切换到工作台",
      "切换到搭子",
      "设置",
      expect.stringMatching(/^通知，\d+ 条未读$/),
    ]);
  });

  it("keeps optional buddy actions outside the approved mode, settings, and notification cluster", () => {
    render(
      <BridgeProvider>
        <TopBar
          onOpenHistory={vi.fn()}
          onDailyReview={vi.fn()}
          onStartRelationship={vi.fn()}
          onStartNewTopic={vi.fn()}
        />
      </BridgeProvider>,
    );

    const topbar = screen.getByRole("banner");
    const auxiliaryControls = within(topbar).getByTestId("topbar-auxiliary-controls");
    const primaryControls = within(topbar).getByTestId("topbar-primary-controls");

    expect(within(auxiliaryControls).getAllByRole("button").map((control) => control.getAttribute("aria-label"))).toEqual([
      "让 momo 认识我",
      "新话题",
      "回顾今天",
    ]);
    expect(within(primaryControls).getAllByRole("button").map((control) => control.getAttribute("aria-label"))).toEqual([
      "切换到开始",
      "切换到工作台",
      "切换到搭子",
      "设置",
      expect.stringMatching(/^通知，\d+ 条未读$/),
    ]);
  });

  it("keeps the new-topic action visible and truthfully disabled during an active interaction", () => {
    render(
      <BridgeProvider>
        <TopBar
          onOpenHistory={vi.fn()}
          onStartNewTopic={vi.fn()}
          newTopicDisabled
        />
      </BridgeProvider>,
    );

    expect(screen.getByRole("button", { name: "新话题" })).toBeDisabled();
  });

  it("uses the global top-left control as the only workbench sidebar toggle", async () => {
    const user = userEvent.setup();
    const onOpenHistory = vi.fn();
    const { rerender } = render(
      <BridgeProvider>
        <TopBar onOpenHistory={onOpenHistory} navigationControl="sidebar-expanded" />
      </BridgeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(onOpenHistory).toHaveBeenCalledOnce();

    rerender(
      <BridgeProvider>
        <TopBar onOpenHistory={onOpenHistory} navigationControl="sidebar-collapsed" />
      </BridgeProvider>,
    );
    expect(screen.getByRole("button", { name: "展开侧栏" })).toBeInTheDocument();
  });

  it("uses three compact square app-window controls instead of the tall native titlebar hit areas", async () => {
    const user = userEvent.setup();
    const minimize = vi.fn(async () => undefined);
    const toggleMaximize = vi.fn(async () => ({ maximized: true }));
    const close = vi.fn(async () => undefined);
    Object.defineProperty(window, "leemoWindow", {
      configurable: true,
      value: {
        minimize,
        toggleMaximize,
        close,
        getState: vi.fn(async () => ({ maximized: false })),
        onMaximizedChanged: vi.fn(() => () => undefined),
      },
    });

    try {
      render(
        <BridgeProvider>
          <TopBar onOpenHistory={vi.fn()} />
        </BridgeProvider>,
      );

      const controls = screen.getByRole("group", { name: "窗口控制" });
      const minimizeButton = within(controls).getByRole("button", { name: "最小化" });
      const maximizeButton = within(controls).getByRole("button", { name: "最大化" });
      const closeButton = within(controls).getByRole("button", { name: "关闭窗口" });
      expect(minimizeButton).toHaveClass("leemo-window-control");
      expect(maximizeButton).toHaveClass("leemo-window-control");
      expect(closeButton).toHaveClass("leemo-window-control", "leemo-window-control-close");

      await user.click(minimizeButton);
      await user.click(maximizeButton);
      await user.click(closeButton);
      expect(minimize).toHaveBeenCalledOnce();
      expect(toggleMaximize).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      delete (window as Window & { leemoWindow?: unknown }).leemoWindow;
    }
  });
});
