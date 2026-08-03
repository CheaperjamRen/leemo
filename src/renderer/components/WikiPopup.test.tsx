import { render, screen, act, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { useContext } from "react";
import { BridgeProvider, BridgeContext } from "../bridge/context";
import type { BridgeStores } from "../bridge/context";
import type { BridgeClient } from "../bridge/client";
import WikiPopup from "./WikiPopup";

function fakeClient() {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "bridge:createConversation") return { conversationId: "wiki-cid-1" };
    return undefined;
  });
  return { invoke, subscribe: vi.fn(() => () => {}) } as unknown as BridgeClient;
}

function setup(client?: BridgeClient) {
  let stores!: BridgeStores;
  function Capture() {
    stores = useContext(BridgeContext)!;
    return null;
  }
  render(
    <BridgeProvider client={client}>
      <Capture />
      <WikiPopup />
    </BridgeProvider>
  );
  return {
    wiki: () => stores.wikiEntries,
    ui: () => stores.ui,
  };
}

describe("WikiPopup", () => {
  it("renders null when active is null", () => {
    setup();
    expect(screen.queryByTestId("wiki-popup")).not.toBeInTheDocument();
  });

  it("renders quoted text and filePath in the citation bar", () => {
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/books/数据结构/notes.md", "遍历的时间复杂度"));
    expect(screen.getByTestId("wiki-popup")).toBeInTheDocument();
    expect(screen.getByText(/遍历的时间复杂度/)).toBeInTheDocument();
    expect(screen.getByText(/notes\.md/)).toBeInTheDocument();
  });

  it("renders turns when the entry has answers", () => {
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));
    act(() => {
      const st = wiki().getState();
      const entryId = st.active!.entryId;
      wiki().setState({
        entries: st.entries.map((e) => e.id === entryId ? { ...e, turns: [{ question: "这是什么？", answer: "这是一棵二叉树。" }] } : e),
      });
    });
    expect(screen.getByText("这是什么？")).toBeInTheDocument();
    expect(screen.getByText("这是一棵二叉树。")).toBeInTheDocument();
  });

  it("shows loading state while streaming with no turns", () => {
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));
    act(() => {
      const st = wiki().getState();
      wiki().setState({ active: { ...st.active!, streaming: true } });
    });
    expect(screen.getByTestId("wiki-loading")).toBeInTheDocument();
  });

  it("shows the followup input when answered", () => {
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));
    act(() => {
      const st = wiki().getState();
      const entryId = st.active!.entryId;
      wiki().setState({
        entries: st.entries.map((e) => e.id === entryId ? { ...e, turns: [{ question: "q", answer: "a" }] } : e),
      });
    });
    expect(screen.getByPlaceholderText("追问…")).toBeInTheDocument();
  });

  it("calls ask (createConversation + send) on Enter in the followup input", async () => {
    const client = fakeClient();
    const user = userEvent.setup();
    const { wiki } = setup(client);
    act(() => wiki().getState().openPopup("/a.md", "quote"));

    const input = screen.getByPlaceholderText("追问…");
    await user.type(input, "什么是平衡树");
    await user.keyboard("{Enter}");

    expect(client.invoke).toHaveBeenCalledWith("bridge:createConversation", expect.objectContaining({ purpose: "wiki" }));
  });

  it("does not submit on Shift+Enter", async () => {
    const client = fakeClient();
    const user = userEvent.setup();
    const { wiki } = setup(client);
    act(() => wiki().getState().openPopup("/a.md", "quote"));

    const input = screen.getByPlaceholderText("追问…");
    await user.type(input, "草稿");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(client.invoke).not.toHaveBeenCalledWith("bridge:createConversation", expect.anything());
  });

  it("keeps the question and shows a compact retryable error when sending fails", async () => {
    const client = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === "bridge:createConversation") throw new Error("模型连接失败，请检查设置。");
        return undefined;
      }),
      subscribe: vi.fn(() => () => {}),
    } as unknown as BridgeClient;
    const user = userEvent.setup();
    const { wiki } = setup(client);
    act(() => wiki().getState().openPopup("/a.md", "quote"));

    const input = screen.getByPlaceholderText("追问…");
    await user.type(input, "这句话是什么意思");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("模型连接失败，请检查设置。");
    await waitFor(() => expect(input).toHaveValue("这句话是什么意思"));
  });

  it("restores a question when an async model failure arrives after send acknowledgement", async () => {
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));
    act(() => {
      const active = wiki().getState().active!;
      wiki().setState({
        active: {
          ...active,
          streaming: false,
          error: "模型本次没有完成回答。",
          failedQuestion: "请换个角度解释",
        },
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("模型本次没有完成回答。");
    expect(screen.getByPlaceholderText("追问…")).toHaveValue("请换个角度解释");
  });

  it("calls closePopup on the close button", async () => {
    const user = userEvent.setup();
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));
    expect(screen.getByTestId("wiki-popup")).toBeInTheDocument();

    await user.click(screen.getByLabelText("关闭"));
    expect(wiki().getState().active).toBeNull();
    expect(screen.queryByTestId("wiki-popup")).not.toBeInTheDocument();
  });

  it("toggles detailed on the switch", async () => {
    const user = userEvent.setup();
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));

    await user.click(screen.getByLabelText("详细一点"));
    expect(wiki().getState().active?.detailed).toBe(true);
  });

  it("disables the followup input while streaming", () => {
    const { wiki } = setup();
    act(() => wiki().getState().openPopup("/a.md", "quote"));
    act(() => {
      const st = wiki().getState();
      const entryId = st.active!.entryId;
      wiki().setState({
        entries: st.entries.map((e) => e.id === entryId ? { ...e, turns: [{ question: "q", answer: "a" }] } : e),
        active: { ...st.active!, streaming: true },
      });
    });
    expect(screen.getByPlaceholderText("追问…")).toBeDisabled();
  });
});
