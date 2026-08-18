import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeProvider } from "../bridge/context";
import StartShell from "./StartShell";

describe("StartShell", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the quiet Start shell with one navigation and no composer", () => {
    render(<BridgeProvider><StartShell /></BridgeProvider>);
    expect(screen.getByRole("navigation", { name: "开始导航" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "开始" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("输入消息…")).not.toBeInTheDocument();
  });

  it("opens the sidebar as an overlay at the authority 960px breakpoint", async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 1023px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    render(<BridgeProvider><StartShell /></BridgeProvider>);

    await userEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("navigation", { name: "开始导航" }).closest("aside")).toHaveClass("is-mobile-open");
    expect(screen.getByRole("button", { name: "关闭开始导航" })).toBeInTheDocument();
  });

  it("opens the document library as a second-level Start view and gives writing the wider rail", async () => {
    const { container } = render(<BridgeProvider><StartShell /></BridgeProvider>);

    await userEvent.click(screen.getByRole("button", { name: "我的文档" }));
    expect(screen.getByTestId("start-documents-view")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".leemo-start-shell__body")).toHaveClass("is-sidebar-collapsed"));
    expect(screen.queryByPlaceholderText("输入消息…")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "首页" }));
    await waitFor(() => expect(container.querySelector(".leemo-start-shell__body")).not.toHaveClass("is-sidebar-collapsed"));
  });
});
