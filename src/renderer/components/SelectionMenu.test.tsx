import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BridgeProvider } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import SelectionMenu from "./SelectionMenu";
import WikiPopup from "./WikiPopup";

function Wrapper({ filePath, onRewrite, client, withPopup = false }: {
  filePath: string | null;
  onRewrite?: (text: string) => void;
  client?: BridgeClient;
  withPopup?: boolean;
}) {
  return (
    <BridgeProvider client={client}>
      <SelectionMenu workspaceId="leemo-home" filePath={filePath} onRewrite={onRewrite} />
      {withPopup && <WikiPopup />}
    </BridgeProvider>
  );
}

function selected(text = "selected text") {
  const mockRange = {
    getBoundingClientRect: () => ({ left: 100, top: 200, right: 260, bottom: 220, width: 160, height: 20 }),
  };
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => mockRange,
  } as unknown as Selection);
}

function wikiClient() {
  const invoke = vi.fn(async (channel: string, _request?: unknown) => {
    if (channel === "bridge:createConversation") return { conversationId: "wiki-selection-1" };
    return undefined;
  });
  return {
    client: {
      invoke,
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient,
    invoke,
  };
}

describe("SelectionMenu", () => {
  beforeEach(() => {
    vi.spyOn(window, "getSelection").mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(screen.getByText("问 momo")).toBeInTheDocument();
    expect(screen.getByText("解释")).toBeInTheDocument();
    expect(screen.getByText("摘要")).toBeInTheDocument();
    expect(screen.getByText("翻译")).toBeInTheDocument();
    expect(screen.getByText("复制")).toBeInTheDocument();
    expect(screen.queryByText("高亮")).not.toBeInTheDocument();
  });

  it("stays inside a narrow preview viewport instead of escaping off-screen", () => {
    vi.stubGlobal("innerWidth", 320);
    selected();
    render(<Wrapper filePath="/a.pdf" />);
    fireEvent.mouseUp(document);
    expect(screen.getByTestId("selection-menu")).toHaveStyle({ left: "96px", width: "216px" });
    expect(screen.getByText("解释")).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: "解释" })).toBeInTheDocument();
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

  it("opens the real momo selection conversation without inventing a preset question", () => {
    const { client, invoke } = wikiClient();
    selected();
    render(<Wrapper filePath="/a.md" client={client} withPopup />);
    fireEvent.mouseUp(document);
    fireEvent.click(screen.getByText("问 momo"));
    expect(screen.getByTestId("wiki-popup")).toHaveTextContent("selected text");
    expect(invoke).not.toHaveBeenCalledWith("bridge:send", expect.anything());
    expect(screen.queryByTestId("selection-menu")).not.toBeInTheDocument();
  });

  it.each([
    ["解释", "请解释这段内容，用简洁的中文说明它在说什么。"],
    ["摘要", "请概括这段内容的核心意思。"],
    ["翻译", "把这段内容翻译成中文。"],
  ])("sends %s through the real selection-context conversation", async (label, question) => {
    const { client, invoke } = wikiClient();
    selected("Multi-head attention joins information from several representation subspaces.");
    render(<Wrapper filePath="papers/attention.pdf" client={client} withPopup />);
    fireEvent.mouseUp(document);
    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      "bridge:send",
      expect.objectContaining({
        conversationId: "wiki-selection-1",
        prompt: expect.stringContaining(`用户的问题：${question}`),
      }),
    ));
    const send = invoke.mock.calls.find(([channel]) => channel === "bridge:send")?.[1] as { prompt?: string } | undefined;
    expect(send?.prompt).toContain('"workspacePath": "papers/attention.pdf"');
    expect(send?.prompt).toContain('"selectedText": "Multi-head attention joins information from several representation subspaces."');
    expect(screen.getByTestId("wiki-popup")).toBeInTheDocument();
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
