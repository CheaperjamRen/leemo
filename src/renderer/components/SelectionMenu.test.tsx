import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BridgeProvider } from "../bridge/context";
import SelectionMenu from "./SelectionMenu";

function Wrapper({ filePath, onRewrite }: { filePath: string | null; onRewrite?: (text: string) => void }) {
  return (
    <BridgeProvider>
      <SelectionMenu workspaceId="leemo-home" filePath={filePath} onRewrite={onRewrite} />
    </BridgeProvider>
  );
}

describe("SelectionMenu", () => {
  beforeEach(() => {
    vi.spyOn(window, "getSelection").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hidden when no selection", () => {
    render(<Wrapper filePath="/a.md" />);
    expect(screen.queryByTestId("selection-menu")).not.toBeInTheDocument();
  });

  it("shows menu on mouseup with selection", () => {
    const mockRange = {
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => "hello world",
      getRangeAt: () => mockRange,
    } as unknown as Selection);

    render(<Wrapper filePath="/a.md" />);
    fireEvent.mouseUp(document);
    expect(screen.getByTestId("selection-menu")).toBeInTheDocument();
    expect(screen.getByText("问一下")).toBeInTheDocument();
    expect(screen.getByText("翻译")).toBeInTheDocument();
    expect(screen.getByText("复制")).toBeInTheDocument();
    expect(screen.queryByText("高亮")).not.toBeInTheDocument();
  });

  it("hands the exact selection to the main momo rewrite flow", () => {
    const onRewrite = vi.fn();
    const mockRange = {
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => "needs rewriting",
      getRangeAt: () => mockRange,
    } as unknown as Selection);

    render(<Wrapper filePath="/a.md" onRewrite={onRewrite} />);
    fireEvent.mouseUp(document);
    fireEvent.click(screen.getByText("改写"));
    expect(onRewrite).toHaveBeenCalledWith("needs rewriting");
  });

  it("calls openPopup on 问一下 click", () => {
    const mockRange = {
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => "selected text",
      getRangeAt: () => mockRange,
    } as unknown as Selection);

    render(<Wrapper filePath="/a.md" />);
    fireEvent.mouseUp(document);
    fireEvent.click(screen.getByText("问一下"));
    expect(screen.queryByTestId("selection-menu")).not.toBeInTheDocument();
  });

  it("calls clipboard on 复制 click", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const mockRange = {
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      toString: () => "copy me",
      getRangeAt: () => mockRange,
    } as unknown as Selection);

    render(<Wrapper filePath="/a.md" />);
    fireEvent.mouseUp(document);
    fireEvent.click(screen.getByText("复制"));
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  it("hides on selection clear", () => {
    const mockRange = {
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 }),
    };
    vi.spyOn(window, "getSelection")
      .mockReturnValueOnce({
        rangeCount: 1,
        isCollapsed: false,
        toString: () => "text",
        getRangeAt: () => mockRange,
      } as unknown as Selection)
      .mockReturnValue({ isCollapsed: true } as unknown as Selection);

    render(<Wrapper filePath="/a.md" />);
    fireEvent.mouseUp(document);
    expect(screen.getByTestId("selection-menu")).toBeInTheDocument();
    fireEvent.click(document);
    expect(screen.queryByTestId("selection-menu")).not.toBeInTheDocument();
  });
});
