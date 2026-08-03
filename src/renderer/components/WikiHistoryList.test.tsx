import { render, screen, act } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { useContext } from "react";
import { BridgeProvider, BridgeContext } from "../bridge/context";
import type { BridgeStores } from "../bridge/context";
import WikiHistoryList from "./WikiHistoryList";

function setup(query = "") {
  let stores!: BridgeStores;
  function Capture() {
    stores = useContext(BridgeContext)!;
    return null;
  }
  render(
    <BridgeProvider>
      <Capture />
      <WikiHistoryList query={query} />
    </BridgeProvider>
  );
  return { wiki: () => stores.wikiEntries, ui: () => stores.ui };
}

function seedEntries(wiki: () => ReturnType<ReturnType<typeof setup>["wiki"]>) {
  act(() => {
    wiki().setState({
      entries: [
        { id: "e1", filePath: "/books/数据结构/第五章.pptx", quotedText: "遍历", turns: [{ question: "深度优先是什么？", answer: "沿一条分支继续。" }, { question: "广度优先是什么？", answer: "逐层访问。" }], createdAt: 1 },
        { id: "e2", filePath: "/books/数据结构/第五章.pptx", quotedText: "平衡树", turns: [{ question: "红黑树有什么用？", answer: "保持近似平衡。" }], createdAt: 2 },
        { id: "e3", filePath: "/books/高数/极限.md", quotedText: "连续", turns: [{ question: "连续的定义？", answer: "极限等于函数值。" }], createdAt: 3 },
      ],
    });
  });
}

describe("WikiHistoryList", () => {
  it("renders empty state when there are no entries", () => {
    setup();
    expect(screen.getByText("还没有小问答记录")).toBeInTheDocument();
  });

  it("groups entries by filePath", () => {
    const { wiki } = setup();
    seedEntries(wiki);
    // Two distinct file groups
    expect(screen.getAllByTestId("wiki-file-group")).toHaveLength(2);
    expect(screen.getByText(/第五章\.pptx/)).toBeInTheDocument();
    expect(screen.getByText(/极限\.md/)).toBeInTheDocument();
  });

  it("shows turn count per entry", () => {
    const { wiki } = setup();
    seedEntries(wiki);
    expect(screen.getByText(/2 轮/)).toBeInTheDocument();
    expect(screen.getAllByText(/1 轮/)).toHaveLength(2);
  });

  it("calls openPreview on entry click", async () => {
    const user = userEvent.setup();
    const { wiki, ui } = setup();
    seedEntries(wiki);

    await user.click(screen.getByText("遍历"));
    expect(ui().getState().previewActivePath).toBe("/books/数据结构/第五章.pptx");
    expect(ui().getState().previewOpen).toBe(true);
  });

  it.each([
    ["平衡树", "平衡树"],
    ["红黑树", "平衡树"],
    ["近似平衡", "平衡树"],
    ["极限.md", "连续"],
  ])("filters by quote, question, answer, or file path: %s", (query, expected) => {
    const { wiki } = setup(query);
    seedEntries(wiki);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getAllByTestId("wiki-file-group")).toHaveLength(1);
  });

  it("shows a distinct no-match state for a non-empty query", () => {
    const { wiki } = setup("量子纠缠");
    seedEntries(wiki);
    expect(screen.getByText("没有匹配的小问答")).toBeInTheDocument();
  });
});
